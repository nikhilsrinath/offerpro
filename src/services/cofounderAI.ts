/**
 * EdgeOS Co-founder AI Service
 * Powered by NVIDIA API - meta/llama-3.1-8b-instruct
 * Optimized for sub-7-second responses
 */

import type { CompanyMemory, CompanyFacts, OnboardingQuestion } from './companyMemory';
import { getRelevantMemory, buildOnboardingPrompt, isOnboardingComplete, getCurrentOnboardingQuestion } from './companyMemory';

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
function buildSystemPrompt(context: EdgeContext, memory?: CompanyMemory | null, rawData?: string): string {
  // Extract user info from rawData first (fresh from Firebase)
  const ownerFromData = rawData ? extractOwnerFromRawData(rawData) : { name: '', role: '' };

  // Fallback to memory if raw data doesn't have it
  const firstName = memory?.onboarding?.firstName || '';
  const lastName = memory?.onboarding?.lastName || '';
  const userName = ownerFromData.name || (firstName ? (firstName + ' ' + lastName).trim() : 'Founder');
  const userRole = ownerFromData.role || memory?.onboarding?.role || 'Founder';

  return `You are the AI Co-founder for ${context.company}.

You are talking directly to ${userName}, the ${userRole}. Address them by name and speak as an insider who knows the business intimately.

Your mission: Help ${firstName || 'the founder'} make sharp decisions, execute fast, and grow the business.

Current Business Context:
• Revenue: ₹${context.financials.totalRevenue.toLocaleString()} total | ₹${context.financials.lastMonthRevenue.toLocaleString()} last month
• Growth: ${context.financials.growthRate} month-over-month
• Invoices: ${context.financials.invoicesPaid} paid | ${context.financials.invoicesPending} pending
• Pending Revenue: ₹${context.financials.pendingRevenue.toLocaleString()}
• Documents: ${context.documents.total} total (${context.documents.offerLetters} offers, ${context.documents.invoices} invoices)

6-Month Revenue Trend: ${context.trends.monthlyRevenue.map(m => `${m.month}: ₹${m.revenue.toLocaleString()}`).join(' | ')}

STRICT RULES - NO HALLUCINATION:
- Address ${userName} by name when appropriate
- Speak as an insider: "we", "our company", "our team" - never as an outsider
- Be direct, concise, and actionable. No fluff.
- Use ONLY the data shown above - NEVER invent employees, invoices, or scenarios
- DO NOT say things like "customer support receiving queries" or "team working on website" unless that data is explicitly provided
- If invoices count is 0, say "We have 0 invoices" - don't make up pending invoices
- If employees count is 0, say "No employees listed" - don't invent team details
- Answer ONLY based on the financial context provided above
- If asked about decisions → use format:

DECISION: [clear recommendation]
WHY: [1-2 sentence rationale using only provided data]
RISKS: [key risks from provided context only]
NEXT ACTION: [immediate next step]

- If unclear what user wants → ask 1-2 sharp clarifying questions.
- Base answers ONLY on the provided business context - never make up data.
- Keep responses under 100 words unless deep analysis requested.`;
}

/**
 * Build system prompt with Company Memory
 */
function buildSystemPromptWithMemory(
  context: EdgeContext,
  memory: CompanyMemory | null,
  rawData?: string
): string {
  const relevant = getRelevantMemory(memory);

  // Extract user info from rawData first (fresh from Firebase)
  const ownerFromData = rawData ? extractOwnerFromRawData(rawData) : { name: '', role: '' };

  // Fallback to memory if raw data doesn't have it
  const firstName = memory?.onboarding?.firstName || '';
  const lastName = memory?.onboarding?.lastName || '';
  const userName = ownerFromData.name || (firstName ? (firstName + ' ' + lastName).trim() : 'Founder');
  const userRole = ownerFromData.role || memory?.onboarding?.role || 'Founder';

  const factsSection = relevant.facts
    ? 'Facts:\n' +
      '• Company: ' + relevant.facts.company_name + '\n' +
      '• Industry: ' + relevant.facts.industry + '\n' +
      '• Team Size: ' + relevant.facts.team_size + ' people\n' +
      '• Location: ' + relevant.facts.city + ', ' + relevant.facts.country + '\n' +
      (relevant.facts.key_metrics?.total_revenue ? '• Total Revenue: ₹' + relevant.facts.key_metrics.total_revenue.toLocaleString() + '\n' : '') +
      (relevant.facts.key_metrics?.pending_revenue ? '• Pending Revenue: ₹' + relevant.facts.key_metrics.pending_revenue.toLocaleString() + '\n' : '') +
      (relevant.facts.key_metrics?.invoice_count ? '• Invoices: ' + relevant.facts.key_metrics.invoice_count + '\n' : '') +
      (relevant.facts.key_metrics?.offer_count ? '• Offers: ' + relevant.facts.key_metrics.offer_count + '\n' : '') +
      (relevant.facts.key_metrics?.nda_count ? '• NDAs: ' + relevant.facts.key_metrics.nda_count + '\n' : '') +
      (relevant.facts.key_metrics?.mou_count ? '• MOUs: ' + relevant.facts.key_metrics.mou_count + '\n' : '') +
      (relevant.facts.key_metrics?.total_documents ? '• Total Documents: ' + relevant.facts.key_metrics.total_documents + '\n' : '') +
      (relevant.facts.key_metrics?.employee_count ? '• Employees: ' + relevant.facts.key_metrics.employee_count + '\n' : '') +
      (relevant.facts.key_metrics?.lead_count ? '• Active Leads: ' + relevant.facts.key_metrics.lead_count + '\n' : '') +
      (relevant.facts.key_metrics?.customer_count ? '• Customers: ' + relevant.facts.key_metrics.customer_count : '')
    : '';

  const insightsSection = relevant.topInsights.length > 0
    ? 'Insights:\n' + relevant.topInsights.map(i => '• ' + i).join('\n')
    : '';

  const opportunitiesSection = relevant.topOpportunities.length > 0
    ? 'Opportunities:\n' + relevant.topOpportunities.map(o => '• ' + o).join('\n')
    : '';

  const risksSection = relevant.topRisks.length > 0
    ? 'Risks:\n' + relevant.topRisks.map(r => '• ' + r).join('\n')
    : '';

  return `You are the AI Co-founder for ${context.company || 'this company'}.

You are talking directly to ${userName}, the ${userRole} of the company. Address them by name and speak as an insider who knows the business intimately.

Your mission: Provide direct, practical, context-aware advice using the company intelligence below.

${factsSection}

${insightsSection}

${opportunitiesSection}

${risksSection}

⚠️  EXTREMELY IMPORTANT - NO HALLUCINATION ALLOWED:
1. You are ${userName}, the ${userRole}. Speak as an insider.
2. Use ONLY the data above. NEVER make up company names, industries, or team details.
3. DO NOT write creative descriptions about what the company does.
4. DO NOT make up "NovaTech", "Renewable Energy", "AI startup" or any fictional details.
5. If data shows "No employees", say exactly that - don't invent team members.
6. If revenue is 0, say "₹0" - don't make up numbers.
7. Answer in 1-2 sentences using ONLY the Facts above.
8. NO FLUFF. NO MARKETING LANGUAGE. ONLY FACTS FROM DATABASE.`;
}

/**
 * Extract owner name from raw org data string
 */
function extractOwnerFromRawData(rawData: string): { name: string; role: string } {
  // Look for "Owner/Founder: Name" in the raw data
  const match = rawData.match(/Owner\/Founder:\s*(.+)/i);
  if (match) {
    const fullName = match[1].trim();
    // Split into first and last name
    const parts = fullName.split(' ');
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');
    return { name: fullName, role: 'Founder' };
  }
  return { name: '', role: '' };
}

/**
 * Build system prompt with Raw Data (for factual queries)
 */
function buildSystemPromptWithRawData(
  context: EdgeContext,
  rawData: string,
  memoryInsights?: { insights: string[]; opportunities: string[]; risks: string[] },
  memory?: CompanyMemory | null
): string {
  // Extract user info from rawData (fresh from Firebase) first
  const ownerFromData = extractOwnerFromRawData(rawData);

  // Fallback to memory if raw data doesn't have it
  const firstName = ownerFromData.name || memory?.onboarding?.firstName || '';
  const lastName = memory?.onboarding?.lastName || '';
  const userName = ownerFromData.name || (firstName ? (firstName + ' ' + lastName).trim() : 'Founder');
  const userRole = ownerFromData.role || memory?.onboarding?.role || 'Founder';

  const dataSection = rawData
    ? 'COMPANY DATA:\n' + rawData
    : 'No specific company data available.';

  const insightsSection = memoryInsights && memoryInsights.insights.length > 0
    ? '\n\nINTELLIGENCE:\n' + memoryInsights.insights.map(i => '• ' + i).join('\n')
    : '';

  const opportunitiesSection = memoryInsights && memoryInsights.opportunities.length > 0
    ? '\n\nOPPORTUNITIES:\n' + memoryInsights.opportunities.map(o => '• ' + o).join('\n')
    : '';

  const risksSection = memoryInsights && memoryInsights.risks.length > 0
    ? '\n\nRISKS:\n' + memoryInsights.risks.map(r => '• ' + r).join('\n')
    : '';

  return `You are the AI Co-founder for ${context.company || 'this company'}.

You are talking directly to ${userName}, the ${userRole} of the company. Address them by name and speak as an insider who knows the business intimately.

YOU ARE AN AI CO-FOUNDER WITH ACCESS TO THE ACTUAL COMPANY DATABASE.
YOU MUST ONLY USE THE DATA BELOW - NEVER MAKE UP INFORMATION.

${dataSection}${insightsSection}${opportunitiesSection}${risksSection}

⚠️  EXTREMELY IMPORTANT RULES - READ CAREFULLY:
1. You are ${userName}, the ${userRole}. You know the business intimately.
2. Use ONLY the data shown above. If company name is "Gomma Inc", say "Gomma Inc" - NOT "NovaTech" or any made-up name.
3. If industry is "Technology", say "Technology" - NEVER make up "Renewable Energy" or other industries.
4. If employee list is empty, say "No employees in database" - DO NOT make up team members.
5. If revenue is ₹21,797.64, report exactly that number - NEVER round or change it.
6. DO NOT write creative stories about what the company does. Only state facts from the data.
7. DO NOT say "We're a cutting-edge AI-powered startup" unless that exact phrase is in the data.
8. DO NOT describe products/services unless they are explicitly listed above.
9. Answer in 1-2 short sentences maximum using ONLY the provided data.
10. If you don't have specific data to answer, say: "I don't see that data in our records."

EXAMPLE OF GOOD ANSWER:
User: "What industry are we in?"
AI: "We're in the [industry from data] industry."

EXAMPLE OF BAD ANSWER (NEVER DO THIS):
User: "What industry are we in?"
AI: "We're NovaTech, a cutting-edge AI startup in Renewable Energy..." ← MAKING THINGS UP!

YOU MUST ONLY USE THE DATA PROVIDED ABOVE. NO CREATIVE WRITING. NO HALLUCINATION.`;
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
  intent?: 'factual' | 'reasoning' | 'combined',
  currentQuestion?: OnboardingQuestion | null,
  isOnboarding?: boolean
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
  console.log('[callCofounderAI] Is onboarding:', isOnboarding);
  console.log('[callCofounderAI] Current question:', currentQuestion?.text);

  try {
    const context = edgeContext as EdgeContext;

    // Build prompt based on intent and available data
    let systemPrompt: string;

    // ONBOARDING MODE: If there's a current onboarding question, use onboarding prompt
    if (isOnboarding && currentQuestion) {
      systemPrompt = buildOnboardingPrompt(currentQuestion, memory);
      console.log('[callCofounderAI] Using ONBOARDING prompt');
    } else if (intent === 'factual' && rawData) {
      // Factual query with raw data
      systemPrompt = buildSystemPromptWithRawData(context, rawData, undefined, memory);
      console.log('[callCofounderAI] Using RAW DATA prompt');
    } else if (intent === 'combined' && rawData && memory) {
      // Combined query with both raw data and memory insights
      const memoryInsights = {
        insights: (memory.insights || []).slice(0, 3),
        opportunities: (memory.opportunities || []).slice(0, 3),
        risks: (memory.risks || []).slice(0, 3),
      };
      systemPrompt = buildSystemPromptWithRawData(context, rawData, memoryInsights, memory);
      console.log('[callCofounderAI] Using COMBINED prompt (raw + memory)');
    } else if (memory) {
      // Reasoning query with memory
      systemPrompt = buildSystemPromptWithMemory(context, memory);
      console.log('[callCofounderAI] Using MEMORY prompt');
    } else {
      // Fallback to basic context - also pass rawData for owner name
      systemPrompt = buildSystemPrompt(context, memory, rawData);
      console.log('[callCofounderAI] Using BASIC context prompt with rawData');
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
        max_tokens: 150, // Reduced for faster responses
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
