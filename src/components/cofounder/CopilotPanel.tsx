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

    // ONBOARDING: Check if we need to collect onboarding info
    let onboardingComplete = isOnboardingComplete(companyMemory);
    let currentQuestion = getCurrentOnboardingQuestion(companyMemory);
    let isOnboarding = !onboardingComplete && currentQuestion !== null;

    console.log('[CopilotPanel] Onboarding complete:', onboardingComplete);
    console.log('[CopilotPanel] Current question:', currentQuestion?.text);
    console.log('[CopilotPanel] Is onboarding mode:', isOnboarding);

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
          onboardingComplete = isOnboardingComplete(saved);
          isOnboarding = !onboardingComplete && nextQuestion !== null;
          console.log('[CopilotPanel] Next question:', nextQuestion?.text);
          console.log('[CopilotPanel] Onboarding continuing:', isOnboarding);
        }
      }
    }

    // STEP 1: Detect intent (only if not in onboarding mode)
    let intent: QueryIntent = 'reasoning';
    if (!isOnboarding) {
      intent = detectQueryIntent(trimmedText);
    }
    console.log('[CopilotPanel] Detected intent:', intent);

    // STEP 2: Get appropriate context based on intent
    let rawData = '';
    let memoryInsights = { insights: [] as string[], opportunities: [] as string[], risks: [] as string[] };

    if (orgId && !isOnboarding) {
      try {
        const context = await getContextForQuery(orgId, trimmedText, updatedMemory);
        rawData = context.rawData;
        memoryInsights = context.memoryInsights;
        console.log('[CopilotPanel] Context loaded - Raw data:', rawData.length, 'bytes');
      } catch (err) {
        console.error('[CopilotPanel] Failed to load context, proceeding without raw data:', err);
        // Continue without raw data - AI will use memory or basic context
      }
    } else if (isOnboarding) {
      console.log('[CopilotPanel] Skipping context fetch - in onboarding mode');
    } else {
      console.log('[CopilotPanel] No orgId available, using basic context');
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
  }, [inputValue, isStreaming, messages, edgeContext, companyMemory, orgId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── SHARED MOBILE COMPONENTS ────────────────────────────────

  const MobileEmptyState = () => (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '2rem 1.5rem', textAlign: 'center', height: '100%',
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem',
        boxShadow: '0 8px 16px rgba(99,102,241,0.2)',
      }}>
        <Sparkles size={20} style={{ color: '#ffffff' }} />
      </div>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', margin: '0 0 0.5rem' }}>
        Start thinking with your Co-founder
      </h3>
      <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 1.5rem', lineHeight: 1.6 }}>
        Strategic decisions, performance analysis, and growth execution.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%', maxWidth: 280 }}>
        {getDynamicPrompts(edgeContext).map((prompt: SuggestedPrompt) => (
          <button
            key={prompt.id}
            onClick={() => handleSend(prompt.text)}
            disabled={isStreaming}
            style={{
              padding: '0.75rem 1rem', background: '#ffffff', border: `1px solid #f1f5f9`,
              borderRadius: 10, cursor: isStreaming ? 'not-allowed' : 'pointer', textAlign: 'left', fontSize: '0.75rem',
              fontWeight: 500, color: '#64748b', transition: 'all 0.2s ease', display: 'flex', alignItems: 'center', gap: '0.75rem',
              opacity: isStreaming ? 0.6 : 1,
            }}
          >
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#6366f1' }} />
            {prompt.text}
          </button>
        ))}
      </div>
    </div>
  );

  const MobileMessageBubble = ({ message }: { message: Message }) => {
    const isUser = message.role === 'user';
    return (
      <div style={{
        display: 'flex', flexDirection: isUser ? 'row-reverse' : 'row', gap: '0.75rem',
        marginBottom: '1.25rem', alignItems: 'flex-start',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isUser ? '#6366f1' : '#f1f5f9', border: isUser ? 'none' : `1px solid #f1f5f9`,
        }}>
          {isUser ? <User size={14} style={{ color: '#ffffff' }} /> : <Bot size={14} style={{ color: '#6366f1' }} />}
        </div>
        <div style={{
          maxWidth: '85%', padding: '0.875rem 1rem', borderRadius: 14,
          borderTopRightRadius: isUser ? 4 : 14, borderTopLeftRadius: isUser ? 14 : 4,
          background: isUser ? '#6366f1' : '#f8fafc',
          border: isUser ? 'none' : `1px solid #e2e8f0`,
          color: isUser ? '#ffffff' : '#64748b', fontSize: '0.875rem', lineHeight: 1.6,
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
            width: 56, height: 56, borderRadius: 28, background: '#6366f1',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 12px 24px rgba(99,102,241,0.3)', border: 'none',
            zIndex: 1000, cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <Sparkles size={24} style={{ color: '#ffffff' }} />
        </button>
      );
    }

    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: isDark ? '#0f172a' : '#ffffff', zIndex: 2000, display: 'flex', flexDirection: 'column',
        animation: 'copilot-slide-up 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        {/* Header */}
        <div style={{
          padding: '1rem 1.25rem', borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9'}`,
          display: 'flex', alignItems: 'center', gap: '1rem', background: isDark ? '#1e293b' : '#ffffff',
        }}>
          <button onClick={onToggle} style={{ background: 'none', border: 'none', padding: 0 }}>
            <ArrowLeft size={24} style={{ color: isDark ? '#ffffff' : '#0f172a' }} />
          </button>
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: isDark ? '#ffffff' : '#0f172a', margin: 0 }}>Co-founder</h2>
            <p style={{ fontSize: '0.75rem', color: isDark ? '#94a3b8' : '#64748b', margin: 0 }}>Your AI execution partner</p>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={() => setMessages([])} style={{ background: 'none', border: 'none' }}>
            <Trash2 size={18} style={{ color: isDark ? '#94a3b8' : '#64748b' }} />
          </button>
        </div>

        {/* Chat Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', background: isDark ? '#0f172a' : '#fafafa' }}>
          {messages.length === 0 ? <MobileEmptyState /> : (
            <div>
              {messages.map(m => <MobileMessageBubble key={m.id} message={m} />)}
              {isLoading && <div style={{ color: isDark ? '#94a3b8' : '#64748b', fontSize: '0.75rem' }}>Thinking...</div>}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div style={{
          padding: '1rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom))',
          background: isDark ? '#1e293b' : '#ffffff', borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9'}`,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', background: isDark ? 'rgba(255,255,255,0.03)' : '#f8fafc',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9'}`, borderRadius: 12, padding: '0.5rem 0.5rem 0.5rem 1rem',
          }}>
            <textarea
              ref={inputRef} value={inputValue} onChange={e => setInputValue(e.target.value)}
              placeholder="Ask anything..." rows={1}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: isDark ? '#ffffff' : '#0f172a', fontSize: '1rem', resize: 'none', maxHeight: 100,
              }}
            />
            <button
              onClick={() => handleSend()}
              disabled={isStreaming || !inputValue.trim()}
              style={{
                width: 40, height: 40, borderRadius: 10,
                background: isStreaming || !inputValue.trim() ? '#a5b4fc' : '#6366f1',
                border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: isStreaming || !inputValue.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              <Send size={18} style={{ color: '#ffffff' }} />
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
  const EmptyState = () => (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem 1.5rem',
      textAlign: 'center',
      height: '100%',
    }}>
      <div style={{
        width: 56,
        height: 56,
        borderRadius: 16,
        background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
        border: '1px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '1.25rem',
      }}>
        <Sparkles size={24} style={{ color: '#6366f1' }} />
      </div>
      
      <h3 style={{
        fontSize: '1.125rem',
        fontWeight: 600,
        color: '#0f172a',
        margin: '0 0 0.5rem',
        letterSpacing: '-0.02em',
      }}>
        Start thinking with your Co-founder
      </h3>
      
      <p style={{
        fontSize: '0.875rem',
        color: '#64748b',
        margin: '0 0 1.75rem',
        lineHeight: 1.6,
        maxWidth: 280,
      }}>
        Ask anything about decisions, tasks, growth, or operations.
      </p>

      {/* Suggested Prompts */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        width: '100%',
        maxWidth: 320,
      }}>
        {getDynamicPrompts(edgeContext).map((prompt: SuggestedPrompt) => (
          <button
            key={prompt.id}
            onClick={() => handleSend(prompt.text)}
            disabled={isStreaming}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.75rem 1rem',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              cursor: isStreaming ? 'not-allowed' : 'pointer',
              textAlign: 'left',
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: '#334155',
              transition: 'all 0.2s ease',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
              opacity: isStreaming ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f8fafc';
              e.currentTarget.style.borderColor = '#cbd5e1';
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#ffffff';
              e.currentTarget.style.borderColor = '#e2e8f0';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.02)';
            }}
          >
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#6366f1',
              flexShrink: 0,
            }} />
            {prompt.text}
          </button>
        ))}
      </div>
    </div>
  );

  // Message bubble component
  const MessageBubble = ({ message }: { message: Message }) => {
    const isUser = message.role === 'user';
    
    return (
      <div style={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        gap: '0.75rem',
        marginBottom: '1rem',
        alignItems: 'flex-start',
      }}>
        {/* Avatar */}
        <div style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: isUser ? '#6366f1' : '#f1f5f9',
          border: isUser ? 'none' : '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          {isUser ? (
            <User size={14} style={{ color: '#ffffff' }} />
          ) : (
            <Bot size={14} style={{ color: '#6366f1' }} />
          )}
        </div>

        {/* Message content */}
        <div style={{
          maxWidth: isFullscreen ? '70%' : '85%',
          background: isUser ? '#6366f1' : '#f8fafc',
          border: isUser ? 'none' : '1px solid #e2e8f0',
          borderRadius: 12,
          borderTopRightRadius: isUser ? 4 : 12,
          borderTopLeftRadius: isUser ? 12 : 4,
          padding: '0.875rem 1rem',
        }}>
          <div style={{
            fontSize: '0.875rem',
            lineHeight: 1.6,
            color: isUser ? '#ffffff' : '#334155',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {message.content}
          </div>
        </div>
      </div>
    );
  };

  // If panel is closed, show minimal toggle button
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
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRight: 'none',
          borderRadius: '8px 0 0 8px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '-2px 0 8px rgba(0,0,0,0.04)',
          zIndex: 100,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#f8fafc';
          e.currentTarget.style.width = '44px';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = '#ffffff';
          e.currentTarget.style.width = '40px';
        }}
      >
        <ChevronLeft size={18} style={{ color: '#64748b' }} />
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
        width: isFullscreen ? 'calc(100% - 58px)' : 360,
        background: '#ffffff',
        borderLeft: '1px solid #e2e8f0',
        boxShadow: isFullscreen 
          ? 'none' 
          : '-4px 0 24px rgba(0,0,0,0.06)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 200,
        transition: 'width 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem 1.25rem',
        borderBottom: '1px solid #f1f5f9',
        background: '#ffffff',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Toggle button */}
          <button
            onClick={onFullscreenToggle}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f1f5f9';
              e.currentTarget.style.borderColor = '#cbd5e1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#f8fafc';
              e.currentTarget.style.borderColor = '#e2e8f0';
            }}
            title={isFullscreen ? 'Collapse' : 'Expand to fullscreen'}
          >
            {isFullscreen ? (
              <ChevronRight size={14} style={{ color: '#64748b' }} />
            ) : (
              <ChevronLeft size={14} style={{ color: '#64748b' }} />
            )}
          </button>

          <div>
            <h2 style={{
              fontSize: '0.9375rem',
              fontWeight: 700,
              color: '#0f172a',
              margin: 0,
              letterSpacing: '-0.01em',
            }}>
              Co-founder
            </h2>
            <p style={{
              fontSize: '0.75rem',
              color: '#64748b',
              margin: 0,
            }}>
              Your AI execution partner
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Clear chat button */}
          <button
            onClick={() => setMessages([])}
            title="Clear chat"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f1f5f9';
              e.currentTarget.style.borderColor = '#cbd5e1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#f8fafc';
              e.currentTarget.style.borderColor = '#e2e8f0';
            }}
          >
            <Trash2 size={14} style={{ color: '#64748b' }} />
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
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f1f5f9';
                e.currentTarget.style.borderColor = '#cbd5e1';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#f8fafc';
                e.currentTarget.style.borderColor = '#e2e8f0';
              }}
            >
              <X size={14} style={{ color: '#64748b' }} />
            </button>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '1.25rem',
        background: '#fafafa',
      }}>
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div>
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
                  background: '#f1f5f9',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Bot size={14} style={{ color: '#6366f1' }} />
                </div>
                <div style={{
                  display: 'flex',
                  gap: '0.25rem',
                  padding: '0.75rem 1rem',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  borderTopLeftRadius: 4,
                }}>
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#cbd5e1',
                    animation: 'copilot-typing 1s ease-in-out infinite',
                  }} />
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#cbd5e1',
                    animation: 'copilot-typing 1s ease-in-out 0.2s infinite',
                  }} />
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#cbd5e1',
                    animation: 'copilot-typing 1s ease-in-out 0.4s infinite',
                  }} />
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div style={{
        padding: '1rem 1.25rem 1.25rem',
        background: '#ffffff',
        borderTop: '1px solid #f1f5f9',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '0.75rem',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: '0.75rem 0.75rem 0.75rem 1rem',
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
              fontSize: '0.875rem',
              lineHeight: 1.5,
              color: '#334155',
              fontFamily: 'inherit',
              maxHeight: 120,
            }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!inputValue.trim() || isLoading}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: inputValue.trim() ? '#6366f1' : '#e2e8f0',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s ease',
              flexShrink: 0,
            }}
          >
            <Send size={15} style={{ color: inputValue.trim() ? '#ffffff' : '#94a3b8' }} />
          </button>
        </div>
        
        <p style={{
          fontSize: '0.6875rem',
          color: '#94a3b8',
          margin: '0.5rem 0 0',
          textAlign: 'center',
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
