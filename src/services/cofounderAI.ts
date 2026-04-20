/**
 * EdgeOS Co-founder AI Service
 * Powered by NVIDIA API - google/gemma-4-31b-it
 * Streaming enabled for real-time responses
 */

const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODEL = 'google/gemma-4-31b-it';

// API Key - In production, use environment variables or backend proxy
// @ts-ignore - Vite handles import.meta.env
const API_KEY: string = (import.meta.env as any)?.VITE_NVIDIA_API_KEY || '';

export interface EdgeContext {
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
}

export interface SuggestedPrompt {
  id: string;
  text: string;
}

interface StreamCallbacks {
  onToken?: (token: string, fullContent: string) => void;
  onComplete?: (fullContent: string) => void;
  onError?: (error: string) => void;
}

/**
 * Build EdgeOS context from available data
 */
export function buildEdgeContext(edgeData: {
  records?: any[];
  finDocs?: any[];
  user?: any;
  activeOrg?: any;
} = {}): EdgeContext {
  const { records = [], finDocs = [], user, activeOrg } = edgeData;

  // Calculate financials
  const finInvoices = finDocs.filter((d: any) => d.type === 'invoice');
  const paidInvoices = finInvoices.filter((d: any) => d.status === 'paid');
  const revenue = paidInvoices.reduce((acc: number, d: any) => acc + (d.grand_total || d.amount || d.subtotal || 0), 0);
  const pendingInvoices = finInvoices.filter((d: any) => d.status === 'pending' || d.status === 'sent');
  const pendingRevenue = pendingInvoices.reduce((acc: number, d: any) => acc + (d.grand_total || d.amount || d.subtotal || 0), 0);

  // Calculate monthly revenue trend
  const now = new Date();
  const monthlyRevenue = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthRevenue = paidInvoices
      .filter((inv: any) => {
        const dt = new Date(inv.issue_date || inv.created_at);
        return dt.getMonth() === d.getMonth() && dt.getFullYear() === d.getFullYear();
      })
      .reduce((acc: number, inv: any) => acc + (inv.grand_total || inv.amount || inv.subtotal || 0), 0);
    monthlyRevenue.push({ month: d.toLocaleDateString('en-IN', { month: 'short' }), revenue: monthRevenue });
  }

  // Document distribution
  const docTypes = {
    offerLetters: records.filter((r: any) => r.type === 'offer').length,
    invoices: finInvoices.length,
    quotations: finDocs.filter((d: any) => d.type === 'quotation').length,
    proformas: finDocs.filter((d: any) => d.type === 'proforma').length,
    total: records.length + finDocs.length,
  };

  // Business health metrics
  const avgMonthlyRevenue = monthlyRevenue.reduce((acc, m) => acc + m.revenue, 0) / 6;
  const lastMonthRevenue = monthlyRevenue[5]?.revenue || 0;
  const prevMonthRevenue = monthlyRevenue[4]?.revenue || 0;
  const growthRate = prevMonthRevenue > 0 ? ((lastMonthRevenue - prevMonthRevenue) / prevMonthRevenue * 100).toFixed(1) : 0;

  return {
    company: activeOrg?.company_name || activeOrg?.name || 'Unknown',
    financials: {
      totalRevenue: revenue,
      pendingRevenue,
      avgMonthlyRevenue: Math.round(avgMonthlyRevenue),
      lastMonthRevenue,
      growthRate: `${growthRate}%`,
      invoicesIssued: finInvoices.length,
      invoicesPaid: paidInvoices.length,
      invoicesPending: pendingInvoices.length,
    },
    documents: docTypes,
    trends: {
      monthlyRevenue,
      documentGrowth: 'stable',
    },
    team: {
      user: user?.email || 'Unknown',
      role: user?.role || 'Admin',
    },
  };
}

/**
 * Build system prompt with EdgeOS context
 */
function buildSystemPrompt(context: EdgeContext): string {
  return `You are an elite AI Co-founder for ${context.company}.

Your mission: Help the founder make sharp decisions, execute fast, and grow the business.

Current Business Context:
• Revenue: ₹${context.financials.totalRevenue.toLocaleString()} total | ₹${context.financials.lastMonthRevenue.toLocaleString()} last month
• Growth: ${context.financials.growthRate} month-over-month
• Invoices: ${context.financials.invoicesPaid} paid | ${context.financials.invoicesPending} pending
• Pending Revenue: ₹${context.financials.pendingRevenue.toLocaleString()}
• Documents: ${context.documents.total} total (${context.documents.offerLetters} offers, ${context.documents.invoices} invoices)

6-Month Revenue Trend: ${context.trends.monthlyRevenue.map(m => `${m.month}: ₹${m.revenue.toLocaleString()}`).join(' | ')}

Personality & Rules:
- Be direct, concise, and actionable. No fluff.
- Always think like a co-founder (risk-aware, execution-focused).
- Use business terminology appropriately.
- If asked about decisions → use format:

DECISION: [clear recommendation]
WHY: [1-2 sentence rationale]
RISKS: [key risks]
NEXT ACTION: [immediate next step]

- If unclear what user wants → ask 1-2 sharp clarifying questions.
- Base answers on the provided business context when relevant.
- Never make up data not in the context.
- Keep responses under 150 words unless deep analysis requested.`;
}

/**
 * Format conversation history for API
 */
function formatConversation(messages: Array<{ role: string; content: string; id?: string }>): Array<{ role: string; content: string }> {
  // Keep last 10 messages to stay within context limits
  return messages.slice(-10).map(m => ({
    role: m.role,
    content: m.content,
  }));
}

/**
 * Call Co-founder AI with streaming
 */
export async function callCofounderAI(
  message: string,
  conversation: Array<{ role: string; content: string }>,
  edgeContext: EdgeContext | Record<string, never>,
  callbacks: StreamCallbacks
): Promise<void> {
  const { onToken, onComplete, onError } = callbacks;

  if (!message.trim()) {
    onError?.('Message cannot be empty');
    return;
  }

  try {
    const context = edgeContext as EdgeContext;
    const systemPrompt = buildSystemPrompt(context);
    const formattedConversation = formatConversation(conversation);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...formattedConversation,
      { role: 'user', content: message },
    ];

    const response = await fetch(NVIDIA_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: 2048,
        temperature: 0.7,
        top_p: 0.95,
        stream: true,
        chat_template_kwargs: { enable_thinking: true },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `HTTP ${response.status}: Failed to get AI response`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response reader');
    }

    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.trim() === '' || line.startsWith(':')) continue;
        
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          
          if (data === '[DONE]') {
            onComplete?.(fullContent);
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const token = parsed.choices?.[0]?.delta?.content || '';
            
            if (token) {
              fullContent += token;
              onToken?.(token, fullContent);
            }
          } catch (e) {
            // Skip invalid JSON chunks
          }
        }
      }
    }

    onComplete?.(fullContent);

  } catch (error) {
    console.error('Co-founder AI Error:', error);
    
    // Retry logic for transient errors
    if ((error as Error).message?.includes('429') || (error as Error).message?.includes('timeout')) {
      onError?.('Service is busy. Retrying...');
      setTimeout(() => {
        callCofounderAI(message, conversation, edgeContext, callbacks);
      }, 2000);
      return;
    }

    onError?.((error as Error).message || 'Something went wrong. Please try again.');
  }
}

/**
 * Non-streaming version for simple queries
 */
export async function callCofounderAISimple(
  message: string,
  conversation: Array<{ role: string; content: string }>,
  edgeContext: EdgeContext
): Promise<string> {
  return new Promise((resolve, reject) => {
    let fullResponse = '';
    
    callCofounderAI(message, conversation, edgeContext, {
      onToken: (_token: string, full: string) => {
        fullResponse = full;
      },
      onComplete: (full: string) => {
        resolve(full);
      },
      onError: (error: string) => {
        reject(new Error(error));
      },
    });
  });
}

/**
 * Suggested prompts based on EdgeOS context
 */
export function getSuggestedPrompts(context: EdgeContext): SuggestedPrompt[] {
  const prompts: SuggestedPrompt[] = [
    { id: '1', text: 'Analyze business performance' },
    { id: '2', text: 'Should I hire right now?' },
    { id: '3', text: 'Identify growth bottlenecks' },
  ];

  // Add context-specific prompts
  if (context.financials.invoicesPending > 0) {
    prompts.push({ 
      id: '4', 
      text: `Follow up on ₹${context.financials.pendingRevenue.toLocaleString()} pending revenue` 
    });
  }

  if (context.documents.offerLetters === 0 && context.financials.totalRevenue > 0) {
    prompts.push({ id: '5', text: 'Create offer letter template for hiring' });
  }

  // Replace last prompt with revenue analysis if significant
  if (context.financials.lastMonthRevenue > 50000) {
    prompts[2] = { id: '3', text: 'Plan revenue diversification strategy' };
  }

  return prompts.slice(0, 4);
}

export default {
  callCofounderAI,
  callCofounderAISimple,
  buildEdgeContext,
  getSuggestedPrompts,
};
