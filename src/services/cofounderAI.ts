/**
 * EdgeOS Co-founder AI Service
 * Powered by NVIDIA API - meta/llama-3.1-8b-instruct
 * Optimized for sub-7-second responses
 */

import type { CompanyMemory, CompanyFacts } from './companyMemory';
import { getRelevantMemory } from './companyMemory';

// Use proxy during development to avoid CORS, direct URL for production
// @ts-ignore - Vite handles import.meta.env
const NVIDIA_API_URL = (import.meta.env as any)?.DEV 
  ? '/api/nvidia/v1/chat/completions' 
  : 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODEL = 'meta/llama-3.1-8b-instruct';

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
  orgId: string | null;
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
    orgId: activeOrg?.id || null,
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
 * Build system prompt with Company Memory
 */
function buildSystemPromptWithMemory(
  context: EdgeContext,
  memory: CompanyMemory | null
): string {
  const relevant = getRelevantMemory(memory);

  const factsSection = relevant.facts
    ? `Facts:
• Company: ${relevant.facts.company_name}
• Industry: ${relevant.facts.industry}
• Team Size: ${relevant.facts.team_size} people
• Location: ${relevant.facts.city}, ${relevant.facts.country}
${relevant.facts.key_metrics?.total_revenue ? `• Total Revenue: ₹${relevant.facts.key_metrics.total_revenue.toLocaleString()}` : ''}
${relevant.facts.key_metrics?.pending_revenue ? `• Pending Revenue: ₹${relevant.facts.key_metrics.pending_revenue.toLocaleString()}` : ''}
${relevant.facts.key_metrics?.employee_count ? `• Employees: ${relevant.facts.key_metrics.employee_count}` : ''}
${relevant.facts.key_metrics?.lead_count ? `• Active Leads: ${relevant.facts.key_metrics.lead_count}` : ''}
${relevant.facts.key_metrics?.customer_count ? `• Customers: ${relevant.facts.key_metrics.customer_count}` : ''}`
    : '';

  const insightsSection = relevant.topInsights.length > 0
    ? `Insights:\n${relevant.topInsights.map(i => `• ${i}`).join('\n')}`
    : '';

  const opportunitiesSection = relevant.topOpportunities.length > 0
    ? `Opportunities:\n${relevant.topOpportunities.map(o => `• ${o}`).join('\n')}`
    : '';

  const risksSection = relevant.topRisks.length > 0
    ? `Risks:\n${relevant.topRisks.map(r => `• ${r}`).join('\n')}`
    : '';

  return `You are an AI business assistant for ${context.company || 'this company'}.

Your mission: Provide direct, practical, context-aware advice using the company intelligence below.

${factsSection}

${insightsSection}

${opportunitiesSection}

${risksSection}

Guidelines:
- Be concise and actionable (max 100 words)
- Use the provided context to personalize answers
- If asked about decisions, consider opportunities AND risks
- Never make up data not in the context
- Focus on practical next steps`;
}

/**
 * Build system prompt with Raw Data (for factual queries)
 */
function buildSystemPromptWithRawData(
  context: EdgeContext,
  rawData: string,
  memoryInsights?: { insights: string[]; opportunities: string[]; risks: string[] }
): string {
  const dataSection = rawData
    ? `COMPANY DATA:\n${rawData}`
    : 'No specific company data available.';

  const insightsSection = memoryInsights && memoryInsights.insights.length > 0
    ? `\n\nINTELLIGENCE:\n${memoryInsights.insights.map(i => `• ${i}`).join('\n')}`
    : '';

  const opportunitiesSection = memoryInsights && memoryInsights.opportunities.length > 0
    ? `\n\nOPPORTUNITIES:\n${memoryInsights.opportunities.map(o => `• ${o}`).join('\n')}`
    : '';

  const risksSection = memoryInsights && memoryInsights.risks.length > 0
    ? `\n\nRISKS:\n${memoryInsights.risks.map(r => `• ${r}`).join('\n')}`
    : '';

  return `You are an AI assistant for ${context.company || 'this company'}.

CRITICAL INSTRUCTION:
You have been provided with ACTUAL COMPANY DATA from the database.
You MUST use this data directly to answer questions.
NEVER say "I don't have access" or "data not available" if the data is provided below.

${dataSection}${insightsSection}${opportunitiesSection}${risksSection}

ANSWER RULES:
- Answer using ONLY the data provided above
- For "who", "list", "names" queries → give exact names from the data
- For counts → give exact numbers from the data
- Be specific and factual
- If data is missing for a specific question, say exactly what's missing`;
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
  callbacks: StreamCallbacks,
  memory?: CompanyMemory | null,
  rawData?: string,
  intent?: 'factual' | 'reasoning' | 'combined'
): Promise<void> {
  const { onToken, onComplete, onError } = callbacks;

  if (!message.trim()) {
    onError?.('Message cannot be empty');
    return;
  }

  // Debug logging
  console.log('[callCofounderAI] Intent:', intent);
  console.log('[callCofounderAI] Raw data length:', rawData?.length || 0);
  console.log('[callCofounderAI] Memory available:', !!memory);

  try {
    const context = edgeContext as EdgeContext;

    // Build prompt based on intent and available data
    let systemPrompt: string;

    if (intent === 'factual' && rawData) {
      // Factual query with raw data
      systemPrompt = buildSystemPromptWithRawData(context, rawData);
      console.log('[callCofounderAI] Using RAW DATA prompt');
    } else if (intent === 'combined' && rawData && memory) {
      // Combined query with both raw data and memory insights
      const memoryInsights = {
        insights: (memory.insights || []).slice(0, 3),
        opportunities: (memory.opportunities || []).slice(0, 3),
        risks: (memory.risks || []).slice(0, 3),
      };
      systemPrompt = buildSystemPromptWithRawData(context, rawData, memoryInsights);
      console.log('[callCofounderAI] Using COMBINED prompt (raw + memory)');
    } else if (memory) {
      // Reasoning query with memory
      systemPrompt = buildSystemPromptWithMemory(context, memory);
      console.log('[callCofounderAI] Using MEMORY prompt');
    } else {
      // Fallback to basic context
      systemPrompt = buildSystemPrompt(context);
      console.log('[callCofounderAI] Using BASIC context prompt');
    }

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
        max_tokens: 256,
        temperature: 0.2,
        top_p: 0.8,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('NVIDIA API Error Response:', errorText);
      let errorMessage = `HTTP ${response.status}: Failed to get AI response`;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || errorData.message || errorMessage;
      } catch {
        if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
      }
      throw new Error(errorMessage);
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
        callCofounderAI(message, conversation, edgeContext, callbacks, memory);
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
  edgeContext: EdgeContext,
  memory?: CompanyMemory | null
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
    }, memory);
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
