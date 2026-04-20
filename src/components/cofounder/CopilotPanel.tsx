import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  ChevronLeft, 
  ChevronRight, 
  Sparkles,
  X,
  Bot,
  User
} from 'lucide-react';

// Types
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface SuggestedPrompt {
  id: string;
  text: string;
  icon?: React.ReactNode;
}

// Suggested prompts data
const SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  { id: '1', text: 'What should I focus on today?' },
  { id: '2', text: 'Analyze my business performance' },
  { id: '3', text: 'Should I hire right now?' },
  { id: '4', text: 'What are my biggest bottlenecks?' },
];

// Mock AI responses for demo
const MOCK_RESPONSES: Record<string, string> = {
  'What should I focus on today?': `Based on your current data, here's what needs attention:

**DECISION: Review Pending Invoices**
You have unpaid invoices that should be followed up.

**WHY:** Cash flow is critical for operations.

**ACTION:** Send reminder emails to overdue clients.`,
  
  'Analyze my business performance': `**Performance Summary**

📈 **Revenue Trend:** Up 12% from last month
📋 **Documents:** 47 total processed
👥 **Team:** 2 employees active

**Key Insight:** Your document-to-revenue ratio is healthy. Consider scaling operations.`,
  
  'Should I hire right now?': `**Hiring Recommendation: WAIT**

**Current Capacity:** 2 employees handling workflow efficiently
**Utilization:** 68% - Room for growth with current team

**RECOMMENDATION:** 
Optimize existing workflows first. Hire when utilization hits 85%+ consistently.`,
  
  'What are my biggest bottlenecks?': `**Identified Bottlenecks:**

1. **Document Processing** - Manual data entry
2. **Invoice Follow-ups** - No automation
3. **Team Coordination** - Missing hierarchy

**Priority Fix:** Set up automated invoice reminders first.`,
};

// Generate AI response
const generateResponse = (input: string): string => {
  const normalizedInput = input.toLowerCase().trim();
  
  // Check for exact matches first
  for (const [prompt, response] of Object.entries(MOCK_RESPONSES)) {
    if (normalizedInput === prompt.toLowerCase()) {
      return response;
    }
  }
  
  // Check for partial matches
  for (const [prompt, response] of Object.entries(MOCK_RESPONSES)) {
    if (normalizedInput.includes(prompt.toLowerCase().split(' ').slice(0, 3).join(' '))) {
      return response;
    }
  }
  
  // Default response
  return `I understand you're asking about "${input}". 

As your AI Co-founder, I can help you with:
• Business strategy and decisions
• Performance analysis
• Hiring recommendations  
• Identifying bottlenecks

What specific aspect would you like to explore?`;
};

interface CopilotPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  isFullscreen: boolean;
  onFullscreenToggle: () => void;
}

export default function CopilotPanel({ 
  isOpen, 
  onToggle, 
  isFullscreen, 
  onFullscreenToggle 
}: CopilotPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [inputValue]);

  const handleSend = async (text: string = inputValue) => {
    if (!text.trim()) return;

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    // Simulate AI thinking delay
    setTimeout(() => {
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: generateResponse(text),
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiMessage]);
      setIsLoading(false);
    }, 800 + Math.random() * 600);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePromptClick = (promptText: string) => {
    handleSend(promptText);
  };

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
        {SUGGESTED_PROMPTS.map((prompt) => (
          <button
            key={prompt.id}
            onClick={() => handlePromptClick(prompt.text)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.75rem 1rem',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: '#334155',
              transition: 'all 0.2s ease',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
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
            {message.content.split('\n\n').map((paragraph, idx) => (
              <p key={idx} style={{ margin: idx === 0 ? 0 : '0.75rem 0 0' }}>
                {paragraph.split('\n').map((line, lineIdx) => {
                  // Check for bold text (**text**)
                  if (line.startsWith('**') && line.endsWith('**')) {
                    return (
                      <span key={lineIdx} style={{ 
                        fontWeight: 700, 
                        color: isUser ? '#ffffff' : '#0f172a',
                        display: 'block',
                        marginBottom: lineIdx === 0 ? '0.25rem' : '0.5rem',
                      }}>
                        {line.replace(/\*\*/g, '')}
                      </span>
                    );
                  }
                  // Check for bullet points
                  if (line.startsWith('•') || line.match(/^\d+\./)) {
                    return (
                      <span key={lineIdx} style={{ 
                        display: 'block', 
                        marginLeft: '0.75rem',
                        marginTop: '0.25rem',
                      }}>
                        {line}
                      </span>
                    );
                  }
                  return <span key={lineIdx}>{line}<br /></span>;
                })}
              </p>
            ))}
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
        position: isFullscreen ? 'fixed' : 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: isFullscreen ? '100%' : 360,
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

        {/* Close button (when not fullscreen) */}
        {!isFullscreen && (
          <button
            onClick={onToggle}
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
