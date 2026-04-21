import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
  Send, 
  ChevronLeft, 
  ChevronRight, 
  Sparkles,
  X,
  Bot,
  User,
  Trash2,
  Maximize2,
  Minimize2,
  ArrowLeft
} from 'lucide-react';
import { callCofounderAI, getSuggestedPrompts } from '../../services/cofounderAI';
import {
  loadCompanyMemory,
  refreshMemory,
  CompanyMemory,
  getContextForQuery,
  QueryIntent,
  detectQueryIntent,
  getCurrentOnboardingQuestion,
  isOnboardingComplete,
  saveOnboardingAnswer,
  extractOnboardingAnswer,
  OnboardingQuestion
} from '../../services/companyMemory';

// Types
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface EdgeContext {
  company: string;
  financials: {
    totalRevenue: number;
    pendingRevenue: number;
    avgMonthlyRevenue: number;
    lastMonthRevenue: number;
    growthRate: string;
    invoicesIssued: number;
    invoicesPaid: number;
    invoicesPending: number;
  };
  documents: {
    total: number;
    offerLetters: number;
    invoices: number;
    quotations: number;
    proformas: number;
  };
  trends: {
    monthlyRevenue: Array<{ month: string; revenue: number }>;
    documentGrowth: string;
  };
  team: {
    user: string;
    role: string;
  };
  orgId: string | null;
}

interface SuggestedPrompt {
  id: string;
  text: string;
  icon?: React.ReactNode;
}

// Suggested prompts - dynamic based on context
const getDynamicPrompts = (context?: EdgeContext): SuggestedPrompt[] => {
  if (!context) {
    return [
      { id: '1', text: 'Analyze business performance' },
      { id: '2', text: 'Should I hire right now?' },
      { id: '3', text: 'Identify growth bottlenecks' },
      { id: '4', text: 'Review team operations' },
    ];
  }
  return getSuggestedPrompts(context);
};

interface CopilotPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  isFullscreen: boolean;
  onFullscreenToggle: () => void;
  theme?: 'light' | 'dark';
  edgeContext?: EdgeContext;
}

export default function CopilotPanel({ 
  isOpen, 
  onToggle, 
  isFullscreen, 
  onFullscreenToggle,
  theme = 'light',
  edgeContext
}: CopilotPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companyMemory, setCompanyMemory] = useState<CompanyMemory | null>(null);
  const [isOnboardingMode, setIsOnboardingMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Extract orgId from edgeContext
  const orgId = useMemo(() => {
    return (edgeContext as any)?.orgId || null;
  }, [edgeContext]);

  const isDark = theme === 'dark';

  // Check for mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Auto-scroll to bottom (including streaming)
  useEffect(() => {
    if (messages.length > 0 || isStreaming) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading, isStreaming, streamingContent]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Load company memory when panel opens or orgId changes
  useEffect(() => {
    if (isOpen && orgId) {
      loadCompanyMemory(orgId).then(memory => {
        setCompanyMemory(memory);
        console.log('[CopilotPanel] Company memory loaded:', memory);
      });
    }
  }, [isOpen, orgId]);

  // Handle Send with NVIDIA AI Streaming
  const handleSend = useCallback(async (text: string = inputValue) => {
    console.log('[handleSend] Called with text:', text, 'isStreaming:', isStreaming);

    if (!text.trim() || isStreaming) {
      console.log('[handleSend] Blocked - text empty or already streaming');
      return;
    }

    const trimmedText = text.trim();
    setError(null);

    // ONBOARDING: Check manual onboarding mode
    const currentQuestion = getCurrentOnboardingQuestion(companyMemory);
    const isOnboarding = isOnboardingMode && currentQuestion !== null;

    console.log('[CopilotPanel] Manual onboarding mode:', isOnboardingMode);
    console.log('[CopilotPanel] Current question:', currentQuestion?.text);
    console.log('[CopilotPanel] Is answering onboarding:', isOnboarding);

    // ONBOARDING: If user is answering a question, save the answer first
    let updatedMemory = companyMemory;
    let nextQuestion = currentQuestion;

    if (isOnboarding && currentQuestion && orgId) {
      const answer = extractOnboardingAnswer(trimmedText, currentQuestion);
      if (answer) {
        console.log('[CopilotPanel] Saving onboarding answer:', answer.field, '=', answer.value);
        const saved = await saveOnboardingAnswer(orgId, companyMemory, answer.field, answer.value);
        if (saved) {
          updatedMemory = saved;
          setCompanyMemory(saved);
          console.log('[CopilotPanel] Onboarding answer saved successfully');

          // Get the NEXT question to ask
          nextQuestion = getCurrentOnboardingQuestion(saved);
          const onboardingComplete = isOnboardingComplete(saved);

          // If onboarding is complete, exit onboarding mode
          if (onboardingComplete) {
            setIsOnboardingMode(false);
            console.log('[CopilotPanel] Onboarding complete!');
          }
          console.log('[CopilotPanel] Next question:', nextQuestion?.text);
        }
      }
    }

    // STEP 1: Detect intent (only if not in onboarding mode)
    let intent: QueryIntent = 'reasoning';
    if (!isOnboarding) {
      intent = detectQueryIntent(trimmedText);
    }
    console.log('[CopilotPanel] Detected intent:', intent);

    // STEP 2: ALWAYS fetch fresh org data from Firebase for EVERY query
    let rawData = '';
    let memoryInsights = { insights: [] as string[], opportunities: [] as string[], risks: [] as string[] };

    if (orgId) {
      try {
        console.log('[CopilotPanel] Fetching FRESH org data from /organizations/' + orgId);
        const context = await getContextForQuery(orgId, trimmedText, updatedMemory);
        rawData = context.rawData;
        memoryInsights = context.memoryInsights;
        console.log('[CopilotPanel] Fresh context loaded - Raw data:', rawData.length, 'bytes');
      } catch (err) {
        console.error('[CopilotPanel] Failed to load context:', err);
      }
    } else {
      console.log('[CopilotPanel] No orgId available');
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmedText,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsLoading(true);
    setIsStreaming(true);
    setStreamingContent('');

    const aiMsgId = (Date.now() + 1).toString();

    // Add placeholder message that will stream
    setMessages(prev => [...prev, {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    }]);

    try {
      await callCofounderAI(
        trimmedText,
        messages,
        edgeContext || {},
        {
          onToken: (_token: string, fullContent: string) => {
            setStreamingContent(fullContent);
            setMessages(prev =>
              prev.map(m =>
                m.id === aiMsgId
                  ? { ...m, content: fullContent }
                  : m
              )
            );
          },
          onComplete: (fullContent: string) => {
            setMessages(prev =>
              prev.map(m =>
                m.id === aiMsgId
                  ? { ...m, content: fullContent, isStreaming: false }
                  : m
              )
            );
            setIsStreaming(false);
            setIsLoading(false);
            setStreamingContent('');

            // Continuous learning: refresh memory after each successful chat
            if (orgId) {
              refreshMemory(orgId).then(updatedMemory => {
                if (updatedMemory) {
                  setCompanyMemory(updatedMemory);
                  console.log('[CopilotPanel] Memory refreshed with new insights');
                }
              });
            }
          },
          onError: (errorMsg: string) => {
            setError(errorMsg);
            setMessages(prev =>
              prev.map(m =>
                m.id === aiMsgId
                  ? { ...m, content: errorMsg || 'Something went wrong. Please try again.', isStreaming: false }
                  : m
              )
            );
            setIsStreaming(false);
            setIsLoading(false);
          },
        },
        updatedMemory,
        rawData,
        intent,
        nextQuestion,
        isOnboarding
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setError(errorMsg);
      setMessages(prev => 
        prev.map(m => 
          m.id === aiMsgId 
            ? { ...m, content: errorMsg, isStreaming: false }
            : m
        )
      );
      setIsStreaming(false);
      setIsLoading(false);
    }
  }, [inputValue, isStreaming, messages, edgeContext, companyMemory, orgId, isOnboardingMode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── SHARED MOBILE COMPONENTS ────────────────────────────────

  const MobileEmptyState = () => {
    const onboardingComplete = isOnboardingComplete(companyMemory);
    const showOnboardingButton = !onboardingComplete && !isOnboardingMode;

    return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '2rem 1.5rem', textAlign: 'center', height: '100%',
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: 14, background: 'var(--bg-sunken)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem',
      }}>
        <Sparkles size={20} style={{ color: 'var(--text-muted)' }} />
      </div>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 0.5rem' }}>
        {showOnboardingButton ? 'Welcome to EdgeOS!' : 'Start thinking with your Co-founder'}
      </h3>
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '0 0 1.5rem', lineHeight: 1.6 }}>
        {showOnboardingButton
          ? 'Help me get to know you better so I can assist you more personally.'
          : 'Strategic decisions, performance analysis, and growth execution.'}
      </p>

      {/* Complete Profile Button */}
      {showOnboardingButton && (
        <button
          onClick={() => {
            setIsOnboardingMode(true);
            handleSend("Start onboarding");
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.75rem 1.5rem', background: 'var(--bg-sunken)', color: 'var(--text-primary)',
            border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 500,
            cursor: 'pointer', marginBottom: '1.5rem',
          }}
        >
          <Sparkles size={16} />
          Complete Profile
        </button>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%', maxWidth: 280 }}>
        {getDynamicPrompts(edgeContext).map((prompt: SuggestedPrompt) => (
          <button
            key={prompt.id}
            onClick={() => handleSend(prompt.text)}
            disabled={isStreaming}
            style={{
              padding: '0.75rem 1rem', background: 'transparent', border: '1px solid var(--border-subtle)',
              borderRadius: 10, cursor: isStreaming ? 'not-allowed' : 'pointer', textAlign: 'left', fontSize: '0.75rem',
              fontWeight: 500, color: 'var(--text-secondary)', transition: 'all 0.2s ease', display: 'flex', alignItems: 'center', gap: '0.75rem',
              opacity: isStreaming ? 0.6 : 1,
            }}
          >
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--text-muted)' }} />
            {prompt.text}
          </button>
        ))}
      </div>
    </div>
    );
  };

  const MobileMessageBubble = ({ message }: { message: Message }) => {
    const isUser = message.role === 'user';
    return (
      <div style={{
        display: 'flex', flexDirection: isUser ? 'row-reverse' : 'row', gap: '0.75rem',
        marginBottom: '1.25rem', alignItems: 'flex-start',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-sunken)', border: '1px solid var(--border-subtle)',
        }}>
          {isUser ? <User size={14} style={{ color: 'var(--text-muted)' }} /> : <Bot size={14} style={{ color: 'var(--text-muted)' }} />}
        </div>
        <div style={{
          maxWidth: '85%', padding: '0.875rem 1rem', borderRadius: 14,
          borderTopRightRadius: isUser ? 4 : 14, borderTopLeftRadius: isUser ? 14 : 4,
          background: isDark ? 'var(--bg-elevated)' : 'var(--bg-raised)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6,
        }}>
          {message.content}
        </div>
      </div>
    );
  };

  // ── MOBILE FULLSCREEN VERSION ───────────────────────────────

  if (isMobile) {
    if (!isOpen) {
      return (
        <button
          onClick={onToggle}
          style={{
            position: 'fixed', bottom: '1.5rem', right: '1.5rem',
            width: 56, height: 56, borderRadius: 28, background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'var(--btn-accent-shadow)', border: 'none',
            zIndex: 1000, cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <Sparkles size={24} style={{ color: 'var(--btn-accent-text)' }} />
        </button>
      );
    }

    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'var(--surface)', zIndex: 2000, display: 'flex', flexDirection: 'column',
        animation: 'copilot-slide-up 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        {/* Header */}
        <div style={{
          padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--bg-raised)',
        }}>
          <button onClick={onToggle} style={{ background: 'none', border: 'none', padding: 0 }}>
            <ArrowLeft size={24} style={{ color: 'var(--text-primary)' }} />
          </button>
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Co-founder</h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>Your AI execution partner</p>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={() => setMessages([])} style={{ background: 'none', border: 'none' }}>
            <Trash2 size={18} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Chat Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', background: 'var(--surface)' }}>
          {messages.length === 0 ? <MobileEmptyState /> : (
            <div>
              {messages.map(m => <MobileMessageBubble key={m.id} message={m} />)}
              {isLoading && <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Thinking...</div>}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div style={{
          padding: '1rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom))',
          background: 'var(--bg-raised)', borderTop: '1px solid var(--border)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', background: 'var(--bg-sunken)',
            border: '1px solid var(--border)', borderRadius: 12, padding: '0.5rem 0.5rem 0.5rem 1rem',
          }}>
            <textarea
              ref={inputRef} value={inputValue} onChange={e => setInputValue(e.target.value)}
              placeholder="Ask anything..." rows={1}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text-primary)', fontSize: '1rem', resize: 'none', maxHeight: 100,
              }}
            />
            <button
              onClick={() => handleSend()}
              disabled={isStreaming || !inputValue.trim()}
              style={{
                width: 40, height: 40, borderRadius: 10,
                background: isStreaming || !inputValue.trim() ? 'var(--bg-sunken)' : 'var(--accent)',
                border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: isStreaming || !inputValue.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              <Send size={18} style={{ color: isStreaming || !inputValue.trim() ? 'var(--text-muted)' : 'var(--btn-accent-text)' }} />
            </button>
          </div>
        </div>

        <style>{`
          @keyframes copilot-slide-up {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
        `}</style>
      </div>
    );
  }

  // ── DESKTOP PORTION (Original) ─────────────────────────────

  // Empty state component
  const EmptyState = () => {
    const onboardingComplete = isOnboardingComplete(companyMemory);
    const showOnboardingButton = !onboardingComplete && !isOnboardingMode;

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2.5rem 1.5rem',
        textAlign: 'center',
        height: '100%',
        background: 'var(--surface)',
      }}>
        <div style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: 'var(--bg-sunken)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '1.25rem',
        }}>
          <Sparkles size={24} style={{ color: 'var(--text-muted)' }} />
        </div>

        <h3 style={{
          fontSize: '1rem',
          fontWeight: 600,
          color: 'var(--text-primary)',
          margin: '0 0 0.375rem',
          letterSpacing: '-0.01em',
        }}>
          {showOnboardingButton ? 'Welcome to EdgeOS' : 'Your AI Co-founder'}
        </h3>

        <p style={{
          fontSize: '0.8125rem',
          color: 'var(--text-secondary)',
          margin: '0 0 1.5rem',
          lineHeight: 1.5,
          maxWidth: 280,
        }}>
          {showOnboardingButton
            ? 'Let me learn about your business to provide personalized guidance.'
            : 'Strategic insights and execution support for your business.'}
        </p>

        {/* Complete Profile Button */}
        {showOnboardingButton && (
          <button
            onClick={() => {
              setIsOnboardingMode(true);
              handleSend("Start onboarding");
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.625rem 1.25rem',
              background: 'var(--bg-sunken)',
              color: 'var(--text-primary)',
              border: 'none',
              borderRadius: 8,
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
              marginBottom: '1.5rem',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--surface-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-sunken)';
            }}
          >
            <Sparkles size={16} />
            Complete Profile
          </button>
        )}

        {/* Suggested Prompts */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.375rem',
          width: '100%',
          maxWidth: 300,
        }}>
          <p style={{
            fontSize: '0.6875rem',
            fontWeight: 500,
            color: 'var(--text-muted)',
            letterSpacing: '0.05em',
            margin: '0 0 0.375rem',
          }}>
            Quick Actions
          </p>
          {getDynamicPrompts(edgeContext).map((prompt: SuggestedPrompt, index: number) => (
            <button
              key={prompt.id}
              onClick={() => handleSend(prompt.text)}
              disabled={isStreaming}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.625rem',
                padding: '0.625rem 0.875rem',
                background: 'transparent',
                border: 'none',
                borderRadius: 6,
                cursor: isStreaming ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                fontSize: '0.8125rem',
                fontWeight: 400,
                color: 'var(--text-secondary)',
                transition: 'all 0.15s ease',
                opacity: isStreaming ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-sunken)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              <span style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                background: 'var(--bg-sunken)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                fontSize: '0.625rem',
                fontWeight: 600,
                color: 'var(--text-muted)',
              }}>
                {index + 1}
              </span>
              {prompt.text}
            </button>
          ))}
        </div>
      </div>
    );
  };

  // Message Bubble
  const MessageBubble = ({ message }: { message: Message }) => {
    const isUser = message.role === 'user';

    return (
      <div style={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        gap: '0.625rem',
        marginBottom: '0.75rem',
        alignItems: 'flex-start',
      }}>
        {/* Avatar */}
        <div style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          background: 'var(--bg-sunken)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          {isUser ? (
            <User size={12} style={{ color: 'var(--text-muted)' }} />
          ) : (
            <Bot size={12} style={{ color: 'var(--text-muted)' }} />
          )}
        </div>

        {/* Message Content */}
        <div style={{
          maxWidth: isFullscreen ? '70%' : '85%',
          background: isDark ? 'var(--bg-elevated)' : 'var(--bg-raised)',
          borderRadius: 12,
          borderTopRightRadius: isUser ? 4 : 12,
          borderTopLeftRadius: isUser ? 12 : 4,
          padding: '0.75rem 1rem',
          border: '1px solid var(--border-subtle)',
        }}>
          <div style={{
            fontSize: '0.8125rem',
            lineHeight: 1.5,
            color: 'var(--text-secondary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {message.content}
          </div>
          <div style={{
            fontSize: '0.625rem',
            color: 'var(--text-tertiary)',
            marginTop: '0.375rem',
            fontWeight: 400,
          }}>
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
    );
  };

  // Toggle Button (Closed State)
  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        style={{
          position: 'fixed',
          right: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 40,
          height: 80,
          background: 'var(--surface)',
          border: '1px solid var(--border-subtle)',
          borderRight: 'none',
          borderRadius: '8px 0 0 8px',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          boxShadow: 'var(--shadow-md)',
          zIndex: 100,
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.width = '44px';
          e.currentTarget.style.background = 'var(--surface-hover)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.width = '40px';
          e.currentTarget.style.background = 'var(--surface)';
        }}
      >
        <Sparkles size={16} style={{ color: 'var(--text-muted)' }} />
        <ChevronLeft size={14} style={{ color: 'var(--text-tertiary)' }} />
      </button>
    );
  }

  return (
    <div
      className={`copilot-panel ${isFullscreen ? 'fullscreen' : ''}`}
      style={{
        position: 'fixed',
        right: isFullscreen ? undefined : 0,
        left: isFullscreen ? 58 : undefined,
        top: 0,
        bottom: 0,
        width: isFullscreen ? 'calc(100% - 58px)' : 420,
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        boxShadow: isFullscreen
          ? 'none'
          : 'var(--shadow-lg)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 200,
        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.875rem 1.25rem',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-raised)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          {/* Toggle button */}
          <button
            onClick={onFullscreenToggle}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: 'transparent',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
            title={isFullscreen ? 'Collapse' : 'Expand'}
          >
            {isFullscreen ? (
              <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
            ) : (
              <ChevronLeft size={14} style={{ color: 'var(--text-muted)' }} />
            )}
          </button>

          <div>
            <h2 style={{
              fontSize: '0.875rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: 0,
              letterSpacing: '-0.01em',
            }}>
              Co-founder AI
            </h2>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          {/* Clear chat button */}
          <button
            onClick={() => setMessages([])}
            title="Clear conversation"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: 'transparent',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--error-muted)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Trash2 size={14} style={{ color: 'var(--text-muted)' }} />
          </button>

          {/* Close button (when not fullscreen) */}
          {!isFullscreen && (
            <button
              onClick={onToggle}
              title="Close"
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: 'transparent',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--accent-glow)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <X size={14} style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: isFullscreen ? '1rem 1.25rem' : '1rem',
        background: 'var(--surface)',
      }}>
        <div style={{
          maxWidth: isFullscreen ? '768px' : '100%',
          margin: '0 auto',
          width: '100%',
        }}>
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {/* Loading indicator */}
            {isLoading && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                marginBottom: '1rem',
              }}>
                <div style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: 'var(--bg-sunken)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Bot size={14} style={{ color: 'var(--text-muted)' }} />
                </div>
                <div style={{
                  display: 'flex',
                  gap: '0.25rem',
                  padding: '0.75rem 1rem',
                  background: 'var(--bg-sunken)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  borderTopLeftRadius: 4,
                }}>
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--text-muted)',
                    animation: 'copilot-typing 1s ease-in-out infinite',
                  }} />
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--text-muted)',
                    animation: 'copilot-typing 1s ease-in-out 0.2s infinite',
                  }} />
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--text-muted)',
                    animation: 'copilot-typing 1s ease-in-out 0.4s infinite',
                  }} />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
        </div>
      </div>

      {/* Input Area */}
      <div style={{
        padding: isFullscreen ? '0.875rem 1.25rem 1rem' : '0.875rem 1rem 1rem',
        background: 'var(--bg-raised)',
        borderTop: '1px solid var(--border-subtle)',
      }}>
        <div style={{
          maxWidth: isFullscreen ? '768px' : '100%',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'flex-end',
          gap: '0.625rem',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '0.625rem 0.625rem 0.625rem 0.875rem',
        }}>
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask your co-founder anything..."
            rows={1}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontSize: '0.8125rem',
              lineHeight: 1.5,
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              maxHeight: 120,
            }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!inputValue.trim() || isLoading}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: inputValue.trim() ? 'var(--bg-sunken)' : 'transparent',
              border: inputValue.trim() ? 'none' : '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s ease',
              flexShrink: 0,
            }}
          >
            <Send size={15} style={{ color: inputValue.trim() ? 'var(--text-primary)' : 'var(--text-muted)' }} />
          </button>
        </div>

        <p style={{
          fontSize: '0.6875rem',
          color: 'var(--text-muted)',
          margin: '0.5rem 0 0',
          textAlign: 'center',
          fontWeight: 500,
        }}>
          Press Enter to send, Shift + Enter for new line
        </p>
      </div>

      {/* CSS Animation for typing indicator */}
      <style>{`
        @keyframes copilot-typing {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
}
