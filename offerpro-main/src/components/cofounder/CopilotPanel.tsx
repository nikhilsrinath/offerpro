import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Send,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  X,
  Bot,
  User,
  Users,
  Trash2,
  ArrowLeft,
  Scale,
  CheckCircle2,
  Mail,
  MessageCircle,
} from 'lucide-react';
import {
  callCofounderAI,
  getSuggestedPrompts,
  detectTaskAssignIntent,
  hasTaskTitle,
  parseDateFromMessage,
  buildTaskAssignPrompt,
  parseTaskAssignResponse,
  buildTaskAwareFollowUpContext,
} from '../../services/cofounderAI';
import { taskStore, Task } from '../../services/taskStore';
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
} from '../../services/companyMemory';
import {
  detectDecisionIntent,
  createDecisionContext,
  addDecisionAnswer,
  buildDecisionPrompt,
  parseDecisionResponse,
  formatDecisionFinalText,
  DecisionContext,
} from '../../services/decisionEngine';
import {
  detectFollowUpIntent,
  matchEmployee,
  buildFollowUpPrompt,
  parseFollowUpResponse,
  getEmployeeFullName,
  FollowUpDraft,
} from '../../services/followUpEngine';
// @ts-ignore
import { storageService } from '../../services/storageService';
// @ts-ignore
import { emailService } from '../../services/emailService';
import {
  detectEmployeeCreateIntent,
  detectEmployeeEditIntent,
  detectRoleChangeIntent,
  detectTerminateIntent,
  getStepPrompt,
  processEmployeeInput,
  executeEmployeeOperation,
  getEmpName,
  type EmployeeOperation,
} from '../../services/employeeAI';
// @ts-ignore
import { useOrg } from '../../context/OrgContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface TaskCreated {
  task: Task;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  isDecisionFinal?: boolean;
  followUpDraft?: FollowUpDraft;
  taskCreated?: TaskCreated;
  employeeResult?: { success: boolean; message: string; employee?: any };
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

// Render inline markdown: **bold** and *italic* only.
// Preserves newlines (pre-wrap handles them).
function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  // Match **bold** before *italic* so double-stars aren't eaten by the single-star pattern
  const regex = /\*\*(.+?)\*\*|\*([^*\n]+?)\*/gs;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) nodes.push(<strong key={m.index}>{m[1]}</strong>);
    else if (m[2] !== undefined) nodes.push(<em key={m.index}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

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

// ── Follow-up draft card ──────────────────────────────────────────────────────

const TONE_CONFIG = {
  polite: { label: 'Polite',  bg: 'rgba(16,185,129,0.1)',  color: '#10b981' },
  firm:   { label: 'Firm',    bg: 'rgba(245,158,11,0.1)',  color: '#f59e0b' },
  urgent: { label: 'Urgent',  bg: 'rgba(239,68,68,0.1)',   color: '#ef4444' },
};

function FollowUpDraftCard({
  draft,
  orgProfile,
  onCancel,
  onSent,
}: {
  draft: FollowUpDraft;
  orgProfile: any;
  onCancel: () => void;
  onSent?: (channel: 'email' | 'whatsapp', toName: string) => void;
}) {
  const [tab, setTab]         = React.useState<'email' | 'whatsapp'>('email');
  const [sent, setSent]       = React.useState<'email' | 'whatsapp' | null>(null);
  const [sending, setSending] = React.useState(false);
  const [error, setError]     = React.useState<string>('');

  const tc = TONE_CONFIG[draft.tone];

  const handleSendEmail = async () => {
    if (sending || sent) return;
    setSending(true);
    setError('');
    const emailHtml = `<div style="font-family:'Segoe UI',sans-serif;max-width:560px;padding:24px;color:#374151;line-height:1.65;white-space:pre-wrap;">${draft.emailBody.replace(/\n/g, '<br/>')}</div>`;
    const res = await emailService.sendEmail({
      to: draft.toEmail,
      subject: draft.subject,
      text: draft.emailBody,
      html: emailHtml,
      orgProfile,
      fromName: orgProfile?.company_name || '',
    });
    setSending(false);
    if (res.success) {
      setSent('email');
      onSent?.('email', draft.toName);
    } else {
      setError(res.message || 'Failed to send email.');
    }
  };

  const handleSendWhatsApp = () => {
    if (sent) return;
    const phone = draft.toPhone.replace(/\D/g, '');
    const url   = `https://wa.me/${phone}?text=${encodeURIComponent(draft.whatsappText)}`;
    window.open(url, '_blank');
    setSent('whatsapp');
    onSent?.('whatsapp', draft.toName);
  };

  if (sent) {
    return (
      <div style={{
        marginTop: '0.625rem', display: 'flex', alignItems: 'center', gap: '0.5rem',
        padding: '0.625rem 0.875rem', borderRadius: 10,
        background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)',
        fontSize: '0.8125rem', color: '#10b981',
      }}>
        <CheckCircle2 size={14} />
        {sent === 'email' ? `Email sent to ${draft.toName}` : `WhatsApp opened for ${draft.toName}`}
      </div>
    );
  }

  return (
    <div style={{
      marginTop: '0.75rem', border: '1px solid var(--border)',
      borderRadius: 12, overflow: 'hidden', background: 'var(--bg-raised)',
    }}>
      {/* Recipient header */}
      <div style={{
        padding: '0.625rem 0.875rem', display: 'flex', alignItems: 'center',
        gap: '0.625rem', background: 'var(--bg-elevated)',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.8125rem', fontWeight: 700, color: '#fff',
        }}>
          {draft.toName.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {draft.toName}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
            {[draft.employeeRole, draft.employeeDept].filter(Boolean).join(' · ')}
          </div>
        </div>
        <span style={{
          padding: '0.2rem 0.5rem', borderRadius: 5, fontSize: '0.625rem',
          fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em',
          background: tc.bg, color: tc.color,
        }}>
          {tc.label}
        </span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
        {(['email', 'whatsapp'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '0.45rem', background: 'transparent', border: 'none',
            borderBottom: tab === t ? '2px solid #6366f1' : '2px solid transparent',
            fontSize: '0.75rem', fontWeight: tab === t ? 600 : 400,
            color: tab === t ? '#6366f1' : 'var(--text-muted)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
          }}>
            {t === 'email' ? <Mail size={12} /> : <MessageCircle size={12} />}
            {t === 'email' ? 'Email' : 'WhatsApp'}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ padding: '0.75rem 0.875rem', background: 'var(--surface)' }}>
        {tab === 'email' ? (
          <>
            <div style={{ marginBottom: '0.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontWeight: 500 }}>Subject: </span>
              <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{draft.subject}</span>
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
              {draft.emailBody}
            </div>
          </>
        ) : (
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
            {draft.whatsappText || 'No WhatsApp draft available.'}
          </div>
        )}
      </div>

      {error && (
        <div style={{
          padding: '0.5rem 0.875rem', background: 'rgba(239,68,68,0.07)',
          borderTop: '1px solid rgba(239,68,68,0.2)',
          fontSize: '0.75rem', color: '#ef4444', lineHeight: 1.4,
        }}>
          {error}
        </div>
      )}

      {/* Actions */}
      <div style={{
        padding: '0.5rem 0.875rem 0.625rem', borderTop: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' as const,
        background: 'var(--bg-elevated)',
      }}>
        {draft.toEmail && (
          <button onClick={handleSendEmail} disabled={sending} style={{
            display: 'flex', alignItems: 'center', gap: '0.35rem',
            padding: '0.45rem 0.875rem', background: '#6366f1', color: '#fff',
            border: 'none', borderRadius: 7, fontSize: '0.75rem', fontWeight: 600,
            cursor: sending ? 'wait' : 'pointer', opacity: sending ? 0.7 : 1,
          }}>
            <Mail size={12} /> {sending ? 'Sending…' : 'Send Email'}
          </button>
        )}
        {draft.toPhone && draft.whatsappText && (
          <button onClick={handleSendWhatsApp} style={{
            display: 'flex', alignItems: 'center', gap: '0.35rem',
            padding: '0.45rem 0.875rem', background: '#25d366', color: '#fff',
            border: 'none', borderRadius: 7, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
          }}>
            <MessageCircle size={12} /> WhatsApp
          </button>
        )}
        <button onClick={onCancel} style={{
          marginLeft: 'auto', padding: '0.45rem 0.75rem',
          background: 'none', border: '1px solid var(--border)', borderRadius: 7,
          fontSize: '0.75rem', color: 'var(--text-muted)', cursor: 'pointer',
        }}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ── Task created card ─────────────────────────────────────────────────────────

const STATUS_PILL: Record<string, { bg: string; color: string }> = {
  pending:     { bg: 'rgba(251,191,36,0.12)', color: '#d97706' },
  'in-progress': { bg: 'rgba(59,130,246,0.12)', color: '#2563eb' },
  done:        { bg: 'rgba(16,185,129,0.12)', color: '#059669' },
  overdue:     { bg: 'rgba(239,68,68,0.12)', color: '#dc2626' },
};
const PRIORITY_DOT: Record<string, string> = { low: '#94a3b8', medium: '#d97706', high: '#dc2626' };

function TaskCreatedCard({ task, onDismiss }: { task: Task; onDismiss: () => void }) {
  const sc = STATUS_PILL[task.status] || STATUS_PILL.pending;
  const deadlineLabel = task.deadline
    ? new Date(task.deadline + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'No deadline';

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border-default)', borderRadius: 12, padding: '1rem', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle2 size={15} color="#059669" />
          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)' }}>Task Created</span>
        </div>
        <span style={{ padding: '0.15rem 0.55rem', borderRadius: 100, background: sc.bg, color: sc.color, fontSize: '0.6875rem', fontWeight: 700, textTransform: 'capitalize' }}>
          {task.status}
        </span>
      </div>
      <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{task.title}</div>
      {task.description && (
        <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{task.description}</div>
      )}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Assigned to:</span> {task.assignedName}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Due:</span> {deadlineLabel}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: PRIORITY_DOT[task.priority] || '#94a3b8', display: 'inline-block' }} />
          <span style={{ textTransform: 'capitalize' }}>{task.priority} priority</span>
        </div>
      </div>
      <button onClick={onDismiss} style={{ alignSelf: 'flex-end', padding: '0.35rem 0.75rem', background: 'none', border: '1px solid var(--border-default)', borderRadius: 7, fontSize: '0.75rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
        Dismiss
      </button>
    </div>
  );
}

// ── Employee result card ──────────────────────────────────────────────────────

function EmployeeResultCard({
  result,
  onDismiss,
}: {
  result: { success: boolean; message: string; employee?: any };
  onDismiss: () => void;
}) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: `1px solid ${result.success ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
      borderRadius: 12,
      padding: '1rem',
      marginTop: '0.5rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.625rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <CheckCircle2 size={15} color={result.success ? '#059669' : '#dc2626'} />
        <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          {result.success ? 'Done' : 'Error'}
        </span>
      </div>
      <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
        {result.message}
      </div>
      <button onClick={onDismiss} style={{
        alignSelf: 'flex-end', padding: '0.35rem 0.75rem',
        background: 'none', border: '1px solid var(--border-default)',
        borderRadius: 7, fontSize: '0.75rem', color: 'var(--text-muted)', cursor: 'pointer',
      }}>
        Dismiss
      </button>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CopilotPanel({
  isOpen,
  onToggle,
  isFullscreen,
  onFullscreenToggle,
  theme = 'light',
  edgeContext,
}: CopilotPanelProps) {
  const { activeOrg } = useOrg() as { activeOrg: any };
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const [companyMemory, setCompanyMemory] = useState<CompanyMemory | null>(null);
  const [isOnboardingMode, setIsOnboardingMode] = useState(false);

  // Decision mode state
  const [decisionCtx, setDecisionCtx] = useState<DecisionContext | null>(null);
  const [pendingOptions, setPendingOptions] = useState<string[] | null>(null);
  const [lastDecisionQuestion, setLastDecisionQuestion] = useState('');

  // Follow-up state
  const [employees, setEmployees] = useState<any[]>([]);

  // Task clarification state — set when intent fires but details are missing
  const [taskPendingEmployee, setTaskPendingEmployee] = useState<any | null>(null);

  // Employee operation state — multi-step employee management via AI
  const [employeeOp, setEmployeeOp] = useState<EmployeeOperation | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const orgId = useMemo(() => (edgeContext as any)?.orgId || null, [edgeContext]);
  const isDark = theme === 'dark';

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (messages.length > 0 || isStreaming) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading, isStreaming, streamingContent]);

  useEffect(() => () => { abortControllerRef.current?.abort(); }, []);

  useEffect(() => {
    if (isOpen && orgId) {
      loadCompanyMemory(orgId).then(memory => {
        setCompanyMemory(memory);
      });
    }
  }, [isOpen, orgId]);

  useEffect(() => {
    if (orgId) {
      storageService.getEmployees(orgId).then((list: any[]) => {
        if (Array.isArray(list)) setEmployees(list);
      });
    }
  }, [orgId]);

  // ── Clear chat (also resets decision state) ──────────────────────────────

  const clearChat = useCallback(() => {
    setMessages([]);
    setDecisionCtx(null);
    setPendingOptions(null);
    setLastDecisionQuestion('');
    setTaskPendingEmployee(null);
    setEmployeeOp(null);
  }, []);

  const cancelFollowUp = useCallback((msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, followUpDraft: undefined } : m));
  }, []);

  const dismissTaskCard = useCallback((msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, taskCreated: undefined } : m));
  }, []);

  const dismissEmployeeResult = useCallback((msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, employeeResult: undefined } : m));
  }, []);

  const handleFollowUpSent = useCallback((channel: 'email' | 'whatsapp', toName: string) => {
    const content = channel === 'email'
      ? `✓ Email sent to ${toName}.`
      : `✓ WhatsApp opened for ${toName}.`;
    setMessages(prev => [
      ...prev,
      {
        id: `sent-${Date.now()}`,
        role: 'assistant',
        content,
        timestamp: new Date(),
      },
    ]);
  }, []);

  // ── handleSend ───────────────────────────────────────────────────────────

  const handleSend = useCallback(async (text: string = inputValue) => {
    if (!text.trim() || isStreaming) return;

    const trimmedText = text.trim();

    // ── Onboarding ───────────────────────────────────────────────────────
    const currentQuestion = getCurrentOnboardingQuestion(companyMemory);
    const isOnboarding = isOnboardingMode && currentQuestion !== null;

    let updatedMemory = companyMemory;
    let nextQuestion = currentQuestion;

    if (isOnboarding && currentQuestion && orgId) {
      const answer = extractOnboardingAnswer(trimmedText, currentQuestion);
      if (answer) {
        const saved = await saveOnboardingAnswer(orgId, companyMemory, answer.field, answer.value);
        if (saved) {
          updatedMemory = saved;
          setCompanyMemory(saved);
          nextQuestion = getCurrentOnboardingQuestion(saved);
          if (isOnboardingComplete(saved)) setIsOnboardingMode(false);
        }
      }
    }

    // ── Employee operation mode (pure form flow — no AI call needed) ────────
    if (!isOnboarding) {
      // ① Continuing a multi-step employee op
      if (employeeOp !== null) {
        const { op: nextOp, done, confirmed, cancelled } = processEmployeeInput(employeeOp, trimmedText);
        const userMsg: Message = { id: Date.now().toString(), role: 'user', content: trimmedText, timestamp: new Date() };

        if (cancelled) {
          setEmployeeOp(null);
          setMessages(prev => [...prev, userMsg, {
            id: (Date.now() + 1).toString(), role: 'assistant',
            content: 'Operation cancelled.', timestamp: new Date(),
          }]);
          setInputValue('');
          return;
        }

        if (done && confirmed) {
          setEmployeeOp(null);
          const aiMsgId = (Date.now() + 1).toString();
          setMessages(prev => [...prev, userMsg, {
            id: aiMsgId, role: 'assistant',
            content: '⏳ Processing…', timestamp: new Date(), isStreaming: true,
          }]);
          setInputValue('');
          if (orgId) {
            try {
              const result = await executeEmployeeOperation(nextOp, orgId, activeOrg);
              setMessages(prev => prev.map(m =>
                m.id === aiMsgId
                  ? { ...m, content: result.message, isStreaming: false, employeeResult: result }
                  : m
              ));
              storageService.getEmployees(orgId).then((list: any[]) => {
                if (Array.isArray(list)) setEmployees(list);
              });
            } catch (err) {
              setMessages(prev => prev.map(m =>
                m.id === aiMsgId
                  ? { ...m, content: 'Operation failed. Please try again.', isStreaming: false }
                  : m
              ));
            }
          }
          return;
        }

        // Not done yet — show next question
        const nextPrompt = getStepPrompt(nextOp);
        setMessages(prev => [...prev, userMsg, {
          id: (Date.now() + 1).toString(), role: 'assistant',
          content: nextPrompt, timestamp: new Date(),
        }]);
        setEmployeeOp(nextOp);
        setInputValue('');
        return;
      }

      // ② Detect new employee intent and start the multi-step flow
      let newEmpOp: EmployeeOperation | null = null;
      if (detectEmployeeCreateIntent(trimmedText)) {
        newEmpOp = { type: 'create', step: 0, data: {} };
      } else if (detectTerminateIntent(trimmedText)) {
        const matched = matchEmployee(trimmedText, employees);
        if (matched) newEmpOp = { type: 'terminate', step: 0, data: {}, matchedEmployee: matched };
      } else if (detectRoleChangeIntent(trimmedText)) {
        const matched = matchEmployee(trimmedText, employees);
        if (matched) newEmpOp = { type: 'roleChange', step: 0, data: {}, matchedEmployee: matched };
      } else if (detectEmployeeEditIntent(trimmedText)) {
        const matched = matchEmployee(trimmedText, employees);
        if (matched) newEmpOp = { type: 'edit', step: 0, data: {}, matchedEmployee: matched };
      }

      if (newEmpOp) {
        const prompt = getStepPrompt(newEmpOp);
        const userMsg: Message = { id: Date.now().toString(), role: 'user', content: trimmedText, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg, {
          id: (Date.now() + 1).toString(), role: 'assistant',
          content: prompt, timestamp: new Date(),
        }]);
        setEmployeeOp(newEmpOp);
        setInputValue('');
        return;
      }
    }

    // ── Intent detection (skip if onboarding) ────────────────────────────
    let intent: QueryIntent = 'reasoning';
    if (!isOnboarding) intent = detectQueryIntent(trimmedText);

    // ── Fetch fresh org data ─────────────────────────────────────────────
    let rawData = '';
    if (orgId) {
      try {
        const ctx = await getContextForQuery(orgId, trimmedText, updatedMemory);
        rawData = ctx.rawData;
      } catch (err) {
        console.error('[CopilotPanel] Failed to load context:', err);
      }
    }

    // ── Decision mode wiring ─────────────────────────────────────────────
    const isInDecision = decisionCtx !== null;
    const shouldStartDecision =
      !isOnboarding && !isInDecision && detectDecisionIntent(trimmedText);

    let activeDecisionCtx = decisionCtx;
    let systemPromptOverride: string | undefined;
    let maxTokensOverride: number | undefined;

    const companyName = (edgeContext as any)?.company || 'your company';
    const decisionUserName =
      companyMemory?.onboarding?.firstName ||
      (edgeContext as any)?.team?.user ||
      'Founder';

    if (shouldStartDecision) {
      const newCtx = createDecisionContext(trimmedText);
      setDecisionCtx(newCtx);
      setPendingOptions(null);
      setLastDecisionQuestion('');
      activeDecisionCtx = newCtx;
      systemPromptOverride = buildDecisionPrompt(newCtx, rawData, companyName, decisionUserName);
      maxTokensOverride = 380;
    } else if (isInDecision) {
      const updatedCtx = addDecisionAnswer(decisionCtx!, lastDecisionQuestion, trimmedText);
      setDecisionCtx(updatedCtx);
      setPendingOptions(null);
      activeDecisionCtx = updatedCtx;
      systemPromptOverride = buildDecisionPrompt(updatedCtx, rawData, companyName, decisionUserName);
      maxTokensOverride = updatedCtx.questionCount >= 4 ? 520 : 380;
    }

    // ── Task assignment mode wiring ──────────────────────────────────────
    let isTaskMode = false;
    let activeTaskEmployee: any = null;
    let taskDeadline: string | null = null;

    if (!isOnboarding && !isInDecision && !shouldStartDecision && !systemPromptOverride) {
      // If we were waiting for task details, treat this message as the task description
      if (taskPendingEmployee) {
        isTaskMode = true;
        activeTaskEmployee = taskPendingEmployee;
        taskDeadline = parseDateFromMessage(trimmedText);
        systemPromptOverride = buildTaskAssignPrompt(
          trimmedText, taskPendingEmployee, companyName, decisionUserName,
          getEmployeeFullName(taskPendingEmployee),
        );
        maxTokensOverride = 200;
        setTaskPendingEmployee(null);
      } else if (detectTaskAssignIntent(trimmedText)) {
        const matched = matchEmployee(trimmedText, employees);
        if (matched) {
          const empFullName = getEmployeeFullName(matched);
          if (hasTaskTitle(trimmedText, empFullName)) {
            // Enough detail — create task now
            isTaskMode = true;
            activeTaskEmployee = matched;
            taskDeadline = parseDateFromMessage(trimmedText);
            systemPromptOverride = buildTaskAssignPrompt(
              trimmedText, matched, companyName, decisionUserName, empFullName,
            );
            maxTokensOverride = 200;
          } else {
            // No task details yet — ask clarifying questions, skip AI call
            const clarifyMsg = `Sure! I'll create a task for ${empFullName}. Please tell me:\n\n• What is the task? (e.g. "Fix the login bug")\n• What's the deadline? (e.g. "by Friday" or "next week")\n• What priority? (low / medium / high)`;
            const userMsg: Message = {
              id: Date.now().toString(),
              role: 'user',
              content: trimmedText,
              timestamp: new Date(),
            };
            const assistantMsg: Message = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: clarifyMsg,
              timestamp: new Date(),
            };
            setMessages(prev => [...prev, userMsg, assistantMsg]);
            setInputValue('');
            setTaskPendingEmployee(matched);
            return;
          }
        }
      }
    }

    // ── Follow-up mode wiring ────────────────────────────────────────────
    let isFollowUpMode = false;
    let activeFollowUpEmployee: any = null;

    if (!isOnboarding && !isInDecision && !shouldStartDecision && !isTaskMode && !systemPromptOverride) {
      if (detectFollowUpIntent(trimmedText)) {
        const empList: any[] = employees;
        const matched = matchEmployee(trimmedText, empList);
        if (matched) {
          isFollowUpMode = true;
          activeFollowUpEmployee = matched;
          // Inject employee's active tasks into the follow-up context
          const empTasks = taskStore.getByEmployee(matched.id);
          const taskCtx = buildTaskAwareFollowUpContext(empTasks);
          systemPromptOverride = buildFollowUpPrompt(
            trimmedText, matched, rawData + taskCtx, companyName, decisionUserName,
          );
          maxTokensOverride = 330;
        }
      }
    }

    // ── Append user message ──────────────────────────────────────────────
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
    setMessages(prev => [
      ...prev,
      { id: aiMsgId, role: 'assistant', content: '', timestamp: new Date(), isStreaming: true },
    ]);

    // ── Call AI ──────────────────────────────────────────────────────────
    try {
      await callCofounderAI(
        trimmedText,
        messages,
        edgeContext || {},
        {
          onToken: (_token: string, fullContent: string) => {
            setStreamingContent(fullContent);
            if (activeDecisionCtx === null && !isFollowUpMode && !isTaskMode) {
              setMessages(prev =>
                prev.map(m => (m.id === aiMsgId ? { ...m, content: fullContent } : m))
              );
            } else if (activeDecisionCtx !== null) {
              // Don't stream raw QUESTION:/OPTIONS: text — show placeholder instead
              setMessages(prev =>
                prev.map(m => (m.id === aiMsgId && !m.content ? { ...m, content: '…' } : m))
              );
            }
          },
          onComplete: async (fullContent: string) => {
            if (isTaskMode && activeTaskEmployee) {
              const parsed = parseTaskAssignResponse(fullContent);
              let createdTask: Task | null = null;
              if (parsed) {
                try {
                  createdTask = await taskStore.create({
                    title: parsed.title,
                    description: parsed.description,
                    priority: parsed.priority,
                    status: 'pending',
                    assignedTo: activeTaskEmployee.id,
                    assignedName: getEmployeeFullName(activeTaskEmployee),
                    assignedEmail: activeTaskEmployee.email || '',
                    assignedPhone: activeTaskEmployee.phone || '',
                    assignedRole: activeTaskEmployee.role || '',
                    assignedDept: activeTaskEmployee.department || '',
                    deadline: taskDeadline,
                    notes: '',
                    followUpSentAt: null,
                  });
                } catch (e) {
                  console.error('[CopilotPanel] Task creation failed:', e);
                }
              }
              const confirmMsg = createdTask
                ? `Task "${createdTask.title}" assigned to ${getEmployeeFullName(activeTaskEmployee)}${taskDeadline ? ` — due ${new Date(taskDeadline + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}.`
                : `I couldn't parse the task details. Please try again with a clearer description.`;
              setMessages(prev =>
                prev.map(m =>
                  m.id === aiMsgId
                    ? { ...m, content: confirmMsg, isStreaming: false, ...(createdTask ? { taskCreated: { task: createdTask } } : {}) }
                    : m
                )
              );
            } else if (activeDecisionCtx !== null) {
              const parsed = parseDecisionResponse(fullContent);

              // Guard: reject DECISION: if the model hasn't asked at least 2 questions yet.
              // This stops the AI from immediately concluding based on question phrasing.
              const tooEarly = parsed.type === 'final' && activeDecisionCtx.questionCount < 2;

              if (parsed.type === 'question' || tooEarly) {
                const question = tooEarly
                  ? 'To give you an accurate recommendation, let me understand your situation better. What is the main driver for considering this right now?'
                  : parsed.question;
                const opts = tooEarly
                  ? ['Immediate business need', 'Planning ahead for growth', 'Filling a skills gap', 'Exploring options']
                  : parsed.options.length > 0
                  ? parsed.options
                  : ['Yes', 'No', 'Partially / not sure', 'Need more time to decide'];
                setLastDecisionQuestion(question);
                setPendingOptions(opts);
                setMessages(prev =>
                  prev.map(m =>
                    m.id === aiMsgId
                      ? { ...m, content: question, isStreaming: false }
                      : m
                  )
                );
              } else {
                const formatted = formatDecisionFinalText(parsed);
                setDecisionCtx(null);
                setLastDecisionQuestion('');
                setPendingOptions(null);
                setMessages(prev =>
                  prev.map(m =>
                    m.id === aiMsgId
                      ? { ...m, content: formatted, isStreaming: false, isDecisionFinal: true }
                      : m
                  )
                );
              }
            } else if (isFollowUpMode && activeFollowUpEmployee) {
              const draft = parseFollowUpResponse(fullContent, activeFollowUpEmployee);
              const displayMsg = draft
                ? `Here's a follow-up draft for ${getEmployeeFullName(activeFollowUpEmployee)}:`
                : fullContent;
              setMessages(prev =>
                prev.map(m =>
                  m.id === aiMsgId
                    ? { ...m, content: displayMsg, isStreaming: false, ...(draft ? { followUpDraft: draft } : {}) }
                    : m
                )
              );
            } else {
              setMessages(prev =>
                prev.map(m =>
                  m.id === aiMsgId ? { ...m, content: fullContent, isStreaming: false } : m
                )
              );
            }

            setIsStreaming(false);
            setIsLoading(false);
            setStreamingContent('');

            if (orgId) {
              refreshMemory(orgId).then(mem => {
                if (mem) setCompanyMemory(mem);
              });
            }
          },
          onError: (errorMsg: string) => {
            setMessages(prev =>
              prev.map(m =>
                m.id === aiMsgId
                  ? {
                      ...m,
                      content: errorMsg || 'Something went wrong. Please try again.',
                      isStreaming: false,
                    }
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
        isOnboarding,
        systemPromptOverride,
        maxTokensOverride,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setMessages(prev =>
        prev.map(m =>
          m.id === aiMsgId ? { ...m, content: errorMsg, isStreaming: false } : m
        )
      );
      setIsStreaming(false);
      setIsLoading(false);
    }
  }, [
    inputValue,
    isStreaming,
    messages,
    edgeContext,
    companyMemory,
    orgId,
    isOnboardingMode,
    decisionCtx,
    lastDecisionQuestion,
    taskPendingEmployee,
    employeeOp,
  ]);

  const handleOptionClick = useCallback(
    (opt: string) => {
      setPendingOptions(null);
      handleSend(opt);
    },
    [handleSend],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Shared sub-components ────────────────────────────────────────────────

  // Decision mode banner (shown when active)
  const DecisionBanner = () => {
    if (!decisionCtx) return null;
    const topic =
      decisionCtx.topic.length > 45
        ? decisionCtx.topic.slice(0, 45) + '…'
        : decisionCtx.topic;
    return (
      <div
        style={{
          padding: '0.5rem 1rem',
          background: 'rgba(99,102,241,0.07)',
          borderBottom: '1px solid rgba(99,102,241,0.15)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.6875rem',
          color: '#6366f1',
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        <Scale size={12} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Deciding: "{topic}"
        </span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
          {decisionCtx.questionCount} / 5 questions
        </span>
        <button
          onClick={() => {
            setDecisionCtx(null);
            setPendingOptions(null);
            setLastDecisionQuestion('');
          }}
          title="Cancel decision mode"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            padding: '0 0 0 4px',
            lineHeight: 1,
          }}
        >
          <X size={12} />
        </button>
      </div>
    );
  };

  // Employee operation banner (shown while collecting employee data)
  const EmployeeBanner = () => {
    if (!employeeOp) return null;
    const labels: Record<string, string> = {
      create: 'Adding employee',
      edit: 'Editing employee',
      roleChange: 'Role change',
      terminate: 'Terminating',
    };
    const label = labels[employeeOp.type] || 'Employee operation';
    const empName = employeeOp.matchedEmployee ? getEmpName(employeeOp.matchedEmployee) : '';
    return (
      <div style={{
        padding: '0.5rem 1rem',
        background: 'rgba(16,185,129,0.07)',
        borderBottom: '1px solid rgba(16,185,129,0.15)',
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        fontSize: '0.6875rem', color: '#059669', fontWeight: 600, flexShrink: 0,
      }}>
        <Users size={12} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}{empName ? ` — ${empName}` : ''}
        </span>
        <button
          onClick={() => setEmployeeOp(null)}
          title="Cancel"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 0 0 4px', lineHeight: 1 }}
        >
          <X size={12} />
        </button>
      </div>
    );
  };

  // ── Decision options panel (replaces input when options are pending) ────────
  const DecisionOptionsPanel = ({ padX }: { padX: string }) => (
    <div
      style={{
        padding: `0.625rem ${padX} 0.75rem`,
        background: 'var(--bg-raised)',
        borderTop: '1px solid var(--border-subtle)',
        flexShrink: 0,
      }}
    >
      {/* Label row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '0.5rem',
      }}>
        <span style={{
          fontSize: '0.625rem', fontWeight: 600, color: 'var(--text-muted)',
          letterSpacing: '0.07em', textTransform: 'uppercase',
        }}>
          Suggested replies
        </span>
        <button
          onClick={() => setPendingOptions(null)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '0.6875rem', color: 'var(--text-muted)', padding: 0,
            display: 'flex', alignItems: 'center', gap: '0.2rem',
          }}
          title="Dismiss and type"
        >
          <X size={11} /> dismiss
        </button>
      </div>

      {/* Option list */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: '0.3rem',
        maxHeight: 220, overflowY: 'auto',
      }}>
        {(pendingOptions || []).map((opt, i) => (
          <button
            key={i}
            onClick={() => handleOptionClick(opt)}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: '0.625rem',
              padding: '0.5rem 0.75rem',
              background: 'var(--surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              fontSize: '0.8125rem',
              fontWeight: 400,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              textAlign: 'left',
              lineHeight: 1.45,
              transition: 'background 0.12s, border-color 0.12s, color 0.12s',
              width: '100%',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(99,102,241,0.06)';
              e.currentTarget.style.borderColor = 'rgba(99,102,241,0.35)';
              e.currentTarget.style.color = '#6366f1';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'var(--surface)';
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            <span style={{
              flexShrink: 0, width: 18, height: 18, borderRadius: 5,
              background: 'var(--bg-sunken)', border: '1px solid var(--border-subtle)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.625rem', fontWeight: 600, color: 'var(--text-muted)',
              marginTop: 1,
            }}>
              {i + 1}
            </span>
            <span style={{ flex: 1 }}>{opt}</span>
          </button>
        ))}
      </div>
    </div>
  );

  // ── Mobile version ───────────────────────────────────────────────────────

  const MobileEmptyState = () => {
    const onboardingComplete = isOnboardingComplete(companyMemory);
    const showOnboardingButton = !onboardingComplete && !isOnboardingMode;

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem 1.5rem',
          textAlign: 'center',
          height: '100%',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            background: 'var(--bg-sunken)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1.25rem',
          }}
        >
          <Sparkles size={20} style={{ color: 'var(--text-muted)' }} />
        </div>
        <h3
          style={{
            fontSize: '1rem',
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: '0 0 0.5rem',
          }}
        >
          {showOnboardingButton ? 'Welcome to EdgeOS!' : 'Start thinking with your Co-founder'}
        </h3>
        <p
          style={{
            fontSize: '0.8125rem',
            color: 'var(--text-secondary)',
            margin: '0 0 1.5rem',
            lineHeight: 1.6,
          }}
        >
          {showOnboardingButton
            ? 'Help me get to know you better so I can assist you more personally.'
            : 'Strategic decisions, performance analysis, and growth execution.'}
        </p>

        {showOnboardingButton && (
          <button
            onClick={() => {
              setIsOnboardingMode(true);
              handleSend('Start onboarding');
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1.5rem',
              background: 'var(--bg-sunken)',
              color: 'var(--text-primary)',
              border: 'none',
              borderRadius: 8,
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
              marginBottom: '1.5rem',
            }}
          >
            <Sparkles size={16} />
            Complete Profile
          </button>
        )}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            width: '100%',
            maxWidth: 280,
          }}
        >
          {getDynamicPrompts(edgeContext).map((prompt: SuggestedPrompt) => (
            <button
              key={prompt.id}
              onClick={() => handleSend(prompt.text)}
              disabled={isStreaming}
              style={{
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                borderRadius: 10,
                cursor: isStreaming ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                fontSize: '0.75rem',
                fontWeight: 500,
                color: 'var(--text-secondary)',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                opacity: isStreaming ? 0.6 : 1,
              }}
            >
              <div
                style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--text-muted)' }}
              />
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
      <div
        style={{
          display: 'flex',
          flexDirection: isUser ? 'row-reverse' : 'row',
          gap: '0.75rem',
          marginBottom: '1.25rem',
          alignItems: 'flex-start',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-sunken)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          {isUser ? (
            <User size={14} style={{ color: 'var(--text-muted)' }} />
          ) : (
            <Bot size={14} style={{ color: 'var(--text-muted)' }} />
          )}
        </div>
        <div style={{ maxWidth: message.followUpDraft ? '95%' : '85%' }}>
          <div
            style={{
              padding: '0.875rem 1rem',
              borderRadius: 14,
              borderTopRightRadius: isUser ? 4 : 14,
              borderTopLeftRadius: isUser ? 14 : 4,
              background: isDark ? 'var(--bg-elevated)' : 'var(--bg-raised)',
              border: message.isDecisionFinal
                ? '1px solid rgba(16,185,129,0.25)'
                : '1px solid var(--border-subtle)',
            }}
          >
            {message.isDecisionFinal && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                fontSize: '0.625rem', fontWeight: 700, color: '#10b981',
                background: 'rgba(16,185,129,0.1)', borderRadius: 4,
                padding: '0.125rem 0.375rem', marginBottom: '0.5rem',
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                <CheckCircle2 size={10} /> Recommendation Ready
              </div>
            )}
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {renderMarkdown(message.content)}
            </div>
          </div>
          {message.followUpDraft && !isUser && (
            <FollowUpDraftCard
              draft={message.followUpDraft}
              orgProfile={activeOrg}
              onCancel={() => cancelFollowUp(message.id)}
              onSent={handleFollowUpSent}
            />
          )}
          {message.taskCreated && !isUser && (
            <TaskCreatedCard
              task={message.taskCreated.task}
              onDismiss={() => dismissTaskCard(message.id)}
            />
          )}
          {message.employeeResult && !isUser && (
            <EmployeeResultCard
              result={message.employeeResult}
              onDismiss={() => dismissEmployeeResult(message.id)}
            />
          )}
        </div>
      </div>
    );
  };

  if (isMobile) {
    if (!isOpen) {
      return (
        <button
          onClick={onToggle}
          style={{
            position: 'fixed',
            bottom: '1.5rem',
            right: '1.5rem',
            width: 56,
            height: 56,
            borderRadius: 28,
            background: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--btn-accent-shadow)',
            border: 'none',
            zIndex: 1000,
            cursor: 'pointer',
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <Sparkles size={24} style={{ color: 'var(--btn-accent-text)' }} />
        </button>
      );
    }

    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'var(--surface)',
          zIndex: 2000,
          display: 'flex',
          flexDirection: 'column',
          animation: 'copilot-slide-up 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            background: 'var(--bg-raised)',
            flexShrink: 0,
          }}
        >
          <button onClick={onToggle} style={{ background: 'none', border: 'none', padding: 0 }}>
            <ArrowLeft size={24} style={{ color: 'var(--text-primary)' }} />
          </button>
          <div>
            <h2
              style={{
                fontSize: '1rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                margin: 0,
              }}
            >
              Co-founder
            </h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
              Your AI execution partner
            </p>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={clearChat} style={{ background: 'none', border: 'none' }}>
            <Trash2 size={18} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Decision / Employee banners */}
        <DecisionBanner />
        <EmployeeBanner />

        {/* Chat content */}
        <div
          style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', background: 'var(--surface)' }}
        >
          {messages.length === 0 ? (
            <MobileEmptyState />
          ) : (
            <div>
              {messages.map(m => (
                <MobileMessageBubble key={m.id} message={m} />
              ))}
              {isLoading && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Thinking…</div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Options panel OR input */}
        {pendingOptions && pendingOptions.length > 0 && !isStreaming ? (
          <DecisionOptionsPanel padX="1.25rem" />
        ) : (
          <div
            style={{
              padding: '0.75rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom))',
              background: 'var(--bg-raised)',
              borderTop: '1px solid var(--border)',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: 'var(--bg-sunken)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '0.5rem 0.5rem 0.5rem 1rem',
              }}
            >
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  employeeOp
                    ? 'Type your answer…'
                    : taskPendingEmployee
                    ? `Describe the task for ${getEmployeeFullName(taskPendingEmployee)}…`
                    : decisionCtx
                    ? 'Type a custom answer…'
                    : 'Ask anything…'
                }
                rows={1}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text-primary)',
                  fontSize: '1rem',
                  resize: 'none',
                  maxHeight: 100,
                }}
              />
              <button
                onClick={() => handleSend()}
                disabled={isStreaming || !inputValue.trim()}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background:
                    isStreaming || !inputValue.trim() ? 'var(--bg-sunken)' : 'var(--accent)',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: isStreaming || !inputValue.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                <Send
                  size={18}
                  style={{
                    color:
                      isStreaming || !inputValue.trim()
                        ? 'var(--text-muted)'
                        : 'var(--btn-accent-text)',
                  }}
                />
              </button>
            </div>
          </div>
        )}

        <style>{`
          @keyframes copilot-slide-up {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
        `}</style>
      </div>
    );
  }

  // ── Desktop version ──────────────────────────────────────────────────────

  const EmptyState = () => {
    const onboardingComplete = isOnboardingComplete(companyMemory);
    const showOnboardingButton = !onboardingComplete && !isOnboardingMode;

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2.5rem 1.5rem',
          textAlign: 'center',
          height: '100%',
          background: 'var(--surface)',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: 'var(--bg-sunken)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1.25rem',
          }}
        >
          <Sparkles size={24} style={{ color: 'var(--text-muted)' }} />
        </div>

        <h3
          style={{
            fontSize: '1rem',
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: '0 0 0.375rem',
            letterSpacing: '-0.01em',
          }}
        >
          {showOnboardingButton ? 'Welcome to EdgeOS' : 'Your AI Co-founder'}
        </h3>

        <p
          style={{
            fontSize: '0.8125rem',
            color: 'var(--text-secondary)',
            margin: '0 0 1.5rem',
            lineHeight: 1.5,
            maxWidth: 280,
          }}
        >
          {showOnboardingButton
            ? 'Let me learn about your business to provide personalized guidance.'
            : 'Strategic insights and execution support for your business.'}
        </p>

        {showOnboardingButton && (
          <button
            onClick={() => {
              setIsOnboardingMode(true);
              handleSend('Start onboarding');
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
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-sunken)'; }}
          >
            <Sparkles size={16} />
            Complete Profile
          </button>
        )}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.375rem',
            width: '100%',
            maxWidth: 300,
          }}
        >
          <p
            style={{
              fontSize: '0.6875rem',
              fontWeight: 500,
              color: 'var(--text-muted)',
              letterSpacing: '0.05em',
              margin: '0 0 0.375rem',
            }}
          >
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
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--bg-sunken)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              <span
                style={{
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
                }}
              >
                {index + 1}
              </span>
              {prompt.text}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const MessageBubble = ({ message }: { message: Message }) => {
    const isUser = message.role === 'user';

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: isUser ? 'row-reverse' : 'row',
          gap: '0.625rem',
          marginBottom: '0.75rem',
          alignItems: 'flex-start',
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: 'var(--bg-sunken)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {isUser ? (
            <User size={12} style={{ color: 'var(--text-muted)' }} />
          ) : (
            <Bot size={12} style={{ color: 'var(--text-muted)' }} />
          )}
        </div>

        {/* Bubble + optional follow-up card */}
        <div style={{ maxWidth: message.followUpDraft ? '92%' : isFullscreen ? '70%' : '85%' }}>
          <div
            style={{
              background: isDark ? 'var(--bg-elevated)' : 'var(--bg-raised)',
              borderRadius: 12,
              borderTopRightRadius: isUser ? 4 : 12,
              borderTopLeftRadius: isUser ? 12 : 4,
              padding: '0.75rem 1rem',
              border: message.isDecisionFinal
                ? '1px solid rgba(16,185,129,0.25)'
                : '1px solid var(--border-subtle)',
            }}
          >
            {message.isDecisionFinal && !isUser && (
              <div
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                  fontSize: '0.625rem', fontWeight: 700, color: '#10b981',
                  background: 'rgba(16,185,129,0.1)', borderRadius: 4,
                  padding: '0.125rem 0.375rem', marginBottom: '0.5rem',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                }}
              >
                <CheckCircle2 size={10} /> Recommendation Ready
              </div>
            )}
            <div style={{ fontSize: '0.8125rem', lineHeight: 1.55, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {renderMarkdown(message.content)}
            </div>
            <div style={{ fontSize: '0.625rem', color: 'var(--text-tertiary)', marginTop: '0.375rem', fontWeight: 400 }}>
              {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          {message.followUpDraft && !isUser && (
            <FollowUpDraftCard
              draft={message.followUpDraft}
              orgProfile={activeOrg}
              onCancel={() => cancelFollowUp(message.id)}
              onSent={handleFollowUpSent}
            />
          )}
          {message.taskCreated && !isUser && (
            <TaskCreatedCard
              task={message.taskCreated.task}
              onDismiss={() => dismissTaskCard(message.id)}
            />
          )}
          {message.employeeResult && !isUser && (
            <EmployeeResultCard
              result={message.employeeResult}
              onDismiss={() => dismissEmployeeResult(message.id)}
            />
          )}
        </div>
      </div>
    );
  };

  // Toggle button (closed state)
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
        onMouseEnter={e => {
          e.currentTarget.style.width = '44px';
          e.currentTarget.style.background = 'var(--surface-hover)';
        }}
        onMouseLeave={e => {
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
        boxShadow: isFullscreen ? 'none' : 'var(--shadow-lg)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 200,
        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.875rem 1.25rem',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-raised)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
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
            onMouseEnter={e => {
              e.currentTarget.style.background = isDark
                ? 'rgba(255,255,255,0.05)'
                : 'rgba(0,0,0,0.05)';
            }}
            onMouseLeave={e => {
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
            <h2
              style={{
                fontSize: '0.875rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
                margin: 0,
                letterSpacing: '-0.01em',
              }}
            >
              Co-founder AI
            </h2>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <button
            onClick={clearChat}
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
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--error-muted)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <Trash2 size={14} style={{ color: 'var(--text-muted)' }} />
          </button>

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
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-glow)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <X size={14} style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>
      </div>

      {/* Decision / Employee banners */}
      <DecisionBanner />
      <EmployeeBanner />

      {/* Messages area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: isFullscreen ? '1rem 1.25rem' : '1rem',
          background: 'var(--surface)',
        }}
      >
        <div
          style={{
            maxWidth: isFullscreen ? '768px' : '100%',
            margin: '0 auto',
            width: '100%',
          }}
        >
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              {messages.map(message => (
                <MessageBubble key={message.id} message={message} />
              ))}

              {/* Typing indicator */}
              {isLoading && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    marginBottom: '1rem',
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: 'var(--bg-sunken)',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Bot size={14} style={{ color: 'var(--text-muted)' }} />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.25rem',
                      padding: '0.75rem 1rem',
                      background: 'var(--bg-sunken)',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      borderTopLeftRadius: 4,
                    }}
                  >
                    {[0, 0.2, 0.4].map((delay, i) => (
                      <span
                        key={i}
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: 'var(--text-muted)',
                          animation: `copilot-typing 1s ease-in-out ${delay}s infinite`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}
        </div>
      </div>

      {/* Options panel OR input area */}
      {pendingOptions && pendingOptions.length > 0 && !isStreaming ? (
        <DecisionOptionsPanel padX={isFullscreen ? '1.25rem' : '1rem'} />
      ) : (
        <div
          style={{
            padding: isFullscreen ? '0.875rem 1.25rem 1rem' : '0.875rem 1rem 1rem',
            background: 'var(--bg-raised)',
            borderTop: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              maxWidth: isFullscreen ? '768px' : '100%',
              margin: '0 auto',
              display: 'flex',
              alignItems: 'flex-end',
              gap: '0.625rem',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '0.625rem 0.625rem 0.625rem 0.875rem',
            }}
          >
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                employeeOp
                  ? 'Type your answer…'
                  : taskPendingEmployee
                  ? `Describe the task for ${getEmployeeFullName(taskPendingEmployee)}…`
                  : decisionCtx
                  ? 'Type a custom answer…'
                  : 'Ask your co-founder anything…'
              }
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
              <Send
                size={15}
                style={{
                  color: inputValue.trim() ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              />
            </button>
          </div>

          <p
            style={{
              fontSize: '0.6875rem',
              color: 'var(--text-muted)',
              margin: '0.5rem 0 0',
              textAlign: 'center',
              fontWeight: 500,
            }}
          >
            {decisionCtx
              ? `Question ${decisionCtx.questionCount + 1} of up to 5 · Enter to send`
              : 'Press Enter to send, Shift + Enter for new line'}
          </p>
        </div>
      )}

      <style>{`
        @keyframes copilot-typing {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
}
