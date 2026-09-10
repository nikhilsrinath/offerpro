/**
 * Company Memory Service
 * Extracts intelligence from org data and stores structured memory
 */

import { supabase } from '../lib/supabase';
import { orgStore } from './orgStore';

// Memory lives in one row per org: ai_company_memory(org_id, memory jsonb).
// Firebase wrote it to RTDB `memory/{orgId}` and Firestore `memory/{orgId}` at
// the same time and the two drifted.
async function readMemoryRow(orgId: string): Promise<CompanyMemory | null> {
  const { data, error } = await supabase
    .from('ai_company_memory').select('memory').eq('org_id', orgId).maybeSingle();
  if (error) throw error;
  return (data?.memory as CompanyMemory) ?? null;
}

async function writeMemoryRow(orgId: string, memory: CompanyMemory): Promise<void> {
  const { error } = await supabase
    .from('ai_company_memory')
    .upsert({ org_id: orgId, memory }, { onConflict: 'org_id' });
  if (error) throw error;
}

export interface CompanyFacts {
  company_name: string;
  industry: string;
  team_size: number;
  country: string;
  city: string;
  website?: string;
  description?: string;
  key_metrics: {
    total_revenue?: number;
    pending_revenue?: number;
    invoice_count?: number;
    employee_count?: number;
    lead_count?: number;
    customer_count?: number;
    total_documents?: number;
    offer_count?: number;
    nda_count?: number;
    mou_count?: number;
  };
}

export interface CompanyMemory {
  facts: CompanyFacts;
  insights: string[];
  opportunities: string[];
  risks: string[];
  updated_at: string;
  onboarding?: OnboardingData;
}

export interface OnboardingData {
  firstName?: string;
  lastName?: string;
  role?: string;
  companyName?: string;
  companyStage?: string;
  description?: string;
  targetCustomer?: string;
  painPoints?: string;
  completed: boolean;
  currentQuestionIndex: number;
  updated_at: string;
}

export interface OnboardingQuestion {
  id: string;
  text: string;
  type: 'text' | 'select' | 'textarea';
  field: keyof OnboardingData;
  placeholder?: string;
  options?: string[];
}

const MAX_ITEMS_PER_CATEGORY = 20;

// ============================================================================
// ONBOARDING QUESTIONS
// ============================================================================

export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  { id: "1", text: "Welcome to EdgeOS Co-founder! Let's get started. What's your first name?", type: "text", field: "firstName", placeholder: "e.g. Nikhil" },
  { id: "2", text: "Nice to meet you. And your last name?", type: "text", field: "lastName" },
  { id: "3", text: "What's your role at the company?", type: "select", field: "role", options: ["Founder", "Co-founder", "CEO", "CTO", "Operator", "Other"] },
  { id: "4", text: "What is your company's name?", type: "text", field: "companyName", placeholder: "e.g. Acme Inc" },
  { id: "5", text: "At what stage is your company currently?", type: "select", field: "companyStage", options: ["Idea", "MVP", "Early Revenue", "Scaling", "Established"] },
  { id: "6", text: "Tell me more about what your company does? (Up to 1400 characters)", type: "textarea", field: "description", placeholder: "Describe your mission and product..." },
  { id: "7", text: "Who is your target customer or user?", type: "text", field: "targetCustomer", placeholder: "e.g. Solo-founders, Indie Hackers, CEOs" },
  { id: "8", text: "What are the main pain points your product solves?", type: "textarea", field: "painPoints", placeholder: "e.g. Slow speed to market, decision fatigue..." },
];

/**
 * Get the current onboarding question to ask
 */
export function getCurrentOnboardingQuestion(memory: CompanyMemory | null): OnboardingQuestion | null {
  if (!memory?.onboarding) {
    // First question if no onboarding data exists
    return ONBOARDING_QUESTIONS[0];
  }

  const onboarding = memory.onboarding;

  // If completed, no more questions
  if (onboarding.completed) {
    return null;
  }

  // Get next question based on current index
  const nextIndex = onboarding.currentQuestionIndex || 0;
  if (nextIndex < ONBOARDING_QUESTIONS.length) {
    return ONBOARDING_QUESTIONS[nextIndex];
  }

  return null;
}

/**
 * Check if onboarding is complete
 */
export function isOnboardingComplete(memory: CompanyMemory | null): boolean {
  return memory?.onboarding?.completed === true;
}

/**
 * Save an onboarding answer and advance to next question
 */
export async function saveOnboardingAnswer(
  orgId: string,
  memory: CompanyMemory | null,
  field: keyof OnboardingData,
  value: string
): Promise<CompanyMemory | null> {
  if (!orgId) return null;

  try {
    const currentIndex = memory?.onboarding?.currentQuestionIndex || 0;
    const isLastQuestion = currentIndex >= ONBOARDING_QUESTIONS.length - 1;

    const updatedOnboarding: OnboardingData = {
      ...memory?.onboarding,
      [field]: value,
      currentQuestionIndex: currentIndex + 1,
      completed: isLastQuestion,
      updated_at: new Date().toISOString(),
    };

    // Merge with existing memory
    const updatedMemory: CompanyMemory = {
      ...(memory || {
        facts: {} as CompanyFacts,
        insights: [],
        opportunities: [],
        risks: [],
        updated_at: new Date().toISOString(),
      }),
      onboarding: updatedOnboarding,
      updated_at: new Date().toISOString(),
    };

    await writeMemoryRow(orgId, updatedMemory);

    console.log('[Onboarding] Saved answer for field:', field);
    console.log('[Onboarding] Next question index:', updatedOnboarding.currentQuestionIndex);
    console.log('[Onboarding] Completed:', updatedOnboarding.completed);

    return updatedMemory;
  } catch (error) {
    console.error('[Onboarding] Failed to save answer:', error);
    return null;
  }
}

/**
 * Try to extract onboarding answer from user message
 * Returns the detected field and value, or null if not an onboarding answer
 */
export function extractOnboardingAnswer(
  message: string,
  currentQuestion: OnboardingQuestion | null
): { field: keyof OnboardingData; value: string } | null {
  if (!currentQuestion) return null;

  const trimmed = message.trim();
  if (!trimmed) return null;

  // For select type, check if answer matches one of the options
  if (currentQuestion.type === 'select' && currentQuestion.options) {
    const lowerMsg = trimmed.toLowerCase();
    const match = currentQuestion.options.find(opt =>
      opt.toLowerCase() === lowerMsg ||
      lowerMsg.includes(opt.toLowerCase())
    );
    if (match) {
      return { field: currentQuestion.field, value: match };
    }
  }

  // For text/textarea, accept any non-empty answer
  return { field: currentQuestion.field, value: trimmed };
}

/**
 * Build onboarding prompt for AI
 */
export function buildOnboardingPrompt(question: OnboardingQuestion, memory?: CompanyMemory | null): string {
  // Get user's name if available
  const firstName = memory?.onboarding?.firstName || '';
  const lastName = memory?.onboarding?.lastName || '';
  const userName = firstName ? `${firstName} ${lastName}`.trim() : '';

  let greeting = 'Welcome to EdgeOS Co-founder!';
  if (userName) {
    greeting = `Hi ${firstName}! Great to meet you.`;
  }

  let prompt = `You are the AI Co-founder for this company. ${greeting} You need to learn about the company to provide better assistance.

CURRENT QUESTION TO ASK:
"${question.text}"

INSTRUCTIONS:
- Greet the user warmly by name if you know it
- Ask this EXACT question
- Wait for their answer (do not ask multiple questions)
- Be friendly, personal, and welcoming
- Speak as an AI co-founder who will work alongside them
- If it's a select question, list the options clearly`;

  if (question.type === 'select' && question.options) {
    prompt += `\n\nOPTIONS (user must pick one):\n${question.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`;
  }

  if (question.placeholder) {
    prompt += `\n\nEXAMPLE: "${question.placeholder}"`;
  }

  return prompt;
}

/**
 * Extract company intelligence from raw org data
 */
export function extractCompanyMemory(orgData: any): Partial<CompanyMemory> {
  if (!orgData) return { facts: {} as CompanyFacts, insights: [], opportunities: [], risks: [] };

  // Extract facts
  const facts: CompanyFacts = {
    company_name: orgData.company_name || orgData._profile?.company_name || 'Unknown',
    industry: orgData.industry || orgData._profile?.industry || 'Unknown',
    team_size: extractTeamSize(orgData),
    country: orgData.country || orgData._profile?.country || 'Unknown',
    city: orgData.city || orgData._profile?.city || 'Unknown',
    website: orgData.company_website || orgData._profile?.company_website,
    description: orgData.company_description || orgData._profile?.company_description,
    key_metrics: extractKeyMetrics(orgData),
  };

  // Extract insights
  const insights: string[] = [];
  const opportunities: string[] = [];
  const risks: string[] = [];

  // Analyze CRM data
  analyzeCRM(orgData, insights, opportunities, risks);

  // Analyze financial data
  analyzeFinancials(orgData, insights, opportunities, risks);

  // Analyze team structure
  analyzeTeam(orgData, insights, opportunities, risks);

  // Analyze documents/offers
  analyzeDocuments(orgData, insights, opportunities, risks);

  return {
    facts,
    insights: deduplicateAndLimit(insights),
    opportunities: deduplicateAndLimit(opportunities),
    risks: deduplicateAndLimit(risks),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Fetch and process company memory from Firebase
 */
export async function loadCompanyMemory(orgId: string): Promise<CompanyMemory | null> {
  if (!orgId) return null;

  try {
    // The Firebase version called .val() on a Firestore snapshot — an
    // RTDB-only method — so this path always threw and memory never loaded.
    const existing = await readMemoryRow(orgId);
    if (existing) return existing;

    // Nothing stored yet: derive it from the org profile and persist.
    const { data: orgData, error } = await supabase
      .from('organizations').select('*').eq('id', orgId).maybeSingle();
    if (error) throw error;
    if (!orgData) return null;

    const memory = extractCompanyMemory(orgData) as CompanyMemory;
    await writeMemoryRow(orgId, memory);
    return memory;
  } catch (error) {
    console.error('[companyMemory] Failed to load memory:', error);
    return null;
  }
}

/**
 * Update company memory after new data or conversation
 */
export async function updateCompanyMemory(
  orgId: string,
  updates: Partial<CompanyMemory>
): Promise<void> {
  if (!orgId) return;

  try {
    const existing = (await readMemoryRow(orgId)) ?? ({} as CompanyMemory);

    const merged: CompanyMemory = {
      facts: { ...existing.facts, ...updates.facts },
      insights: mergeArrays(existing.insights, updates.insights || []),
      opportunities: mergeArrays(existing.opportunities, updates.opportunities || []),
      risks: mergeArrays(existing.risks, updates.risks || []),
      updated_at: new Date().toISOString(),
    };

    await writeMemoryRow(orgId, merged);
  } catch (error) {
    console.error('[companyMemory] Failed to update memory:', error);
  }
}

/**
 * Get top relevant memory items for chat context
 */
export function getRelevantMemory(memory: CompanyMemory | null): {
  facts: CompanyFacts | null;
  topInsights: string[];
  topOpportunities: string[];
  topRisks: string[];
} {
  if (!memory) {
    return { facts: null, topInsights: [], topOpportunities: [], topRisks: [] };
  }

  return {
    facts: memory.facts,
    topInsights: (memory.insights || []).slice(0, 3),
    topOpportunities: (memory.opportunities || []).slice(0, 3),
    topRisks: (memory.risks || []).slice(0, 3),
  };
}

/**
 * Refresh memory from current org data
 */
export async function refreshMemory(orgId: string): Promise<CompanyMemory | null> {
  if (!orgId) return null;

  try {
    const { data: orgData, error } = await supabase
      .from('organizations').select('*').eq('id', orgId).maybeSingle();
    if (error) throw error;
    if (!orgData) return null;

    const memory = extractCompanyMemory(orgData) as CompanyMemory;

    await updateCompanyMemory(orgId, memory);
    return memory;
  } catch (error) {
    console.error('[companyMemory] Failed to refresh memory:', error);
    return null;
  }
}

// Helper functions

function extractTeamSize(orgData: any): number {
  const employees = orgData.employees;
  if (employees && typeof employees === 'object') {
    return Object.keys(employees).length;
  }
  if (orgData.company_size) {
    const match = orgData.company_size.match(/\d+/);
    if (match) return parseInt(match[0], 10);
  }
  return 1;
}

function extractKeyMetrics(orgData: any): CompanyFacts['key_metrics'] {
  const metrics: CompanyFacts['key_metrics'] = {};

  // Count employees
  const employees = orgData.employees;
  if (employees && typeof employees === 'object') {
    metrics.employee_count = Object.keys(employees).length;
  }

  // Count CRM leads. The key is `crm_leads`; `crm`/`leads` are Firebase-era
  // names kept only so an old cached payload still reads.
  const crm = orgData.crm_leads || orgData.crm || orgData.leads;
  if (crm && typeof crm === 'object') {
    const items = Object.values(crm);
    // Everything not yet resolved either way is still a lead in the pipeline.
    metrics.lead_count = items.filter(
      (l: any) => (l.stage || 'lead') !== 'deal' && (l.stage || 'lead') !== 'not_deal'
    ).length;
  }

  // Clients come from the customers table, not from the pipeline. There is no
  // 'customer' or 'won' stage in crm_leads — the old filter for them always
  // returned zero.
  const clients = orgData.customers;
  if (clients && typeof clients === 'object') {
    metrics.customer_count = Object.keys(clients).length;
  }

  // Financial metrics from fin_docs
  const finDocs = orgData.fin_docs;
  if (finDocs && typeof finDocs === 'object') {
    const invoices = Object.values(finDocs).filter((d: any) => d.type === 'invoice');
    const paidInvoices = invoices.filter((d: any) => d.status === 'paid');
    metrics.total_revenue = paidInvoices.reduce((acc: number, d: any) => acc + (d.grand_total || d.amount || 0), 0);
    metrics.invoice_count = invoices.length;
  }

  // Pending revenue
  if (finDocs && typeof finDocs === 'object') {
    const pendingInvoices = Object.values(finDocs).filter((d: any) => d.type === 'invoice' && (d.status === 'pending' || d.status === 'sent'));
    metrics.pending_revenue = pendingInvoices.reduce((acc: number, d: any) => acc + (d.grand_total || d.amount || 0), 0);
  }

  // Count HR records (offers, NDAs, MOUs)
  const records = orgData.records;
  if (records && typeof records === 'object') {
    const allRecords = Object.values(records);
    metrics.offer_count = allRecords.filter((r: any) => r.type === 'offer').length;
    metrics.nda_count = allRecords.filter((r: any) => r.type === 'nda').length;
    metrics.mou_count = allRecords.filter((r: any) => r.type === 'mou').length;
  }

  // Calculate total documents (invoices + offers + NDAs + MOUs)
  metrics.total_documents = 
    (metrics.invoice_count || 0) + 
    (metrics.offer_count || 0) + 
    (metrics.nda_count || 0) + 
    (metrics.mou_count || 0);

  return metrics;
}

function analyzeCRM(orgData: any, insights: string[], opportunities: string[], risks: string[]) {
  const crm = orgData.crm_leads || orgData.crm || orgData.leads;
  if (!crm || typeof crm !== 'object') return;

  const items = Object.values(crm) as any[];

  // Find high-value deals
  items.forEach((item: any) => {
    const value = item.value || item.deal_value || item.amount || 0;
    const notes = item.notes || item.description || '';
    const stage = item.stage || item.status || '';

    // High-value opportunity detection
    if (value >= 20000 || notes.toLowerCase().includes('20k') || notes.toLowerCase().includes('large')) {
      opportunities.push(`Potential large deal (${value > 0 ? value.toLocaleString() : 'significant'} value) from ${item.company_name || item.person_name || item.name || 'a lead'}`);
    }

    // Deal in negotiation
    if (stage.toLowerCase().includes('negotiation') || stage.toLowerCase().includes('proposal')) {
      insights.push(`Active negotiation with ${item.company_name || item.person_name || item.name || 'a lead'} at ${stage}`);
    }

    // Stuck deals
    if (stage.toLowerCase().includes('stuck') || stage.toLowerCase().includes('delayed')) {
      risks.push(`Deal with ${item.company_name || item.person_name || item.name || 'a lead'} appears stalled at ${stage}`);
    }
  });

  // Pipeline summary. The real stages are lead / contacted / deal / not_deal;
  // 'customer' and 'won' were never among them.
  const open = items.filter((i: any) => {
    const s = i.stage || 'lead';
    return s !== 'deal' && s !== 'not_deal';
  }).length;
  const won = items.filter((i: any) => i.stage === 'deal').length;

  if (open > 5) {
    opportunities.push(`${open} active leads in pipeline - potential for growth`);
  }
  if (won > 0) {
    insights.push(`${won} deal${won > 1 ? 's' : ''} won in the CRM`);
  }

  const clientCount = Object.keys(orgData.customers || {}).length;
  if (clientCount > 0) {
    insights.push(`${clientCount} client${clientCount > 1 ? 's' : ''} in the directory`);
  }
}

function analyzeFinancials(orgData: any, insights: string[], opportunities: string[], risks: string[]) {
  const finDocs = orgData.fin_docs;
  if (!finDocs || typeof finDocs !== 'object') return;

  const docs = Object.values(finDocs) as any[];
  const invoices = docs.filter((d: any) => d.type === 'invoice');
  const paid = invoices.filter((d: any) => d.status === 'paid');
  const pending = invoices.filter((d: any) => d.status === 'pending' || d.status === 'sent');

  // Revenue insights
  const totalPaid = paid.reduce((acc: number, d: any) => acc + (d.grand_total || d.amount || 0), 0);
  const totalPending = pending.reduce((acc: number, d: any) => acc + (d.grand_total || d.amount || 0), 0);

  if (totalPaid > 100000) {
    insights.push(`Strong revenue base: ${totalPaid.toLocaleString()} collected to date`);
  }
  if (totalPending > 50000) {
    opportunities.push(`${totalPending.toLocaleString()} in pending invoices - collection opportunity`);
  }
  if (pending.length > 5) {
    risks.push(`${pending.length} unpaid invoices - cash flow attention needed`);
  }

  // Quotation conversion
  const quotations = docs.filter((d: any) => d.type === 'quotation').length;
  if (quotations > 3 && invoices.length < quotations / 2) {
    opportunities.push(`Low quotation-to-invoice ratio - follow-up on ${quotations} open quotes`);
  }
}

function analyzeTeam(orgData: any, insights: string[], opportunities: string[], risks: string[]) {
  const employees = orgData.employees;
  if (!employees || typeof employees !== 'object') {
    risks.push('No employee data - potential single-point-of-failure risk');
    return;
  }

  const empList = Object.values(employees) as any[];
  const count = empList.length;

  if (count === 1) {
    risks.push('Solo founder operation - capacity constraint for scaling');
  } else if (count < 5) {
    insights.push(`Small but focused team of ${count} people`);
  } else if (count >= 10) {
    insights.push(`Established team with ${count} employees`);
  }

  // Check for key roles
  const roles = empList.map((e: any) => (e.role || e.designation || '').toLowerCase());
  const hasSales = roles.some((r: string) => r.includes('sales') || r.includes('business'));
  const hasTech = roles.some((r: string) => r.includes('tech') || r.includes('developer') || r.includes('engineer'));

  if (!hasSales && count > 2) {
    opportunities.push('Consider adding dedicated sales role to accelerate growth');
  }
  if (!hasTech && count > 2) {
    risks.push('No technical role identified - product/tech dependency risk');
  }
}

function analyzeDocuments(orgData: any, insights: string[], opportunities: string[], risks: string[]) {
  const records = orgData.records || orgData.documents;
  if (!records || typeof records !== 'object') return;

  const docs = Object.values(records) as any[];
  const offers = docs.filter((d: any) => d.type === 'offer').length;
  const ndas = docs.filter((d: any) => d.type === 'nda').length;
  const mous = docs.filter((d: any) => d.type === 'mou').length;

  if (offers > 0) {
    insights.push(`${offers} offer letter${offers > 1 ? 's' : ''} generated - active hiring`);
  }
  if (ndas > 0) {
    insights.push(`${ndas} NDA${ndas > 1 ? 's' : ''} signed - IP protection active`);
  }
  if (mous > 0) {
    insights.push(`${mous} MoU${mous > 1 ? 's' : ''} in place - partnership activity`);
  }
}

function deduplicateAndLimit(items: string[]): string[] {
  const unique = [...new Set(items.map(i => i.toLowerCase().trim()))];
  return unique
    .map(original => items.find(i => i.toLowerCase().trim() === original) || original)
    .slice(0, MAX_ITEMS_PER_CATEGORY);
}

function mergeArrays(existing: string[] = [], newItems: string[]): string[] {
  const combined = [...existing, ...newItems];
  return deduplicateAndLimit(combined);
}

export default {
  extractCompanyMemory,
  loadCompanyMemory,
  updateCompanyMemory,
  getRelevantMemory,
  refreshMemory,
};

// ============================================================================
// INTENT DETECTION & RAW DATA SYSTEM
// ============================================================================

export type QueryIntent = 'factual' | 'reasoning' | 'combined';

const FACTUAL_KEYWORDS = [
  'who', 'list', 'show', 'names', 'details', 'what are', 'how many',
  'employees', 'team members', 'staff', 'people', 'roles',
  'customers', 'leads', 'contacts', 'clients',
  'tasks', 'task board', 'projects', 'invoices', 'documents', 'records',
  'revenue', 'money', 'paid', 'pending', 'collected', 'earnings',
  'financial', 'bill', 'quotation', 'proforma', 'expense', 'cost',
  'tell me about', 'give me', 'find', 'search',
  'email', 'phone', 'contact', 'address', 'location',
  'founder', 'boss', 'owner', 'ceo', 'you', 'me',
  'assign', 'assigned', 'deadline', 'overdue', 'due', 'working on',
  'doing', 'responsible', 'in progress', 'completed',
];

const REASONING_KEYWORDS = [
  'should', 'recommend', 'advice', 'suggest', 'strategy',
  'risk', 'opportunity', 'growth', 'plan', 'decision',
  'analyze', 'evaluate', 'assess', 'think', 'consider',
  'why', 'how to', 'best way', 'improve', 'optimize'
];

/**
 * Detect query intent: factual, reasoning, or combined
 */
export function detectQueryIntent(message: string): QueryIntent {
  const lowerMsg = message.toLowerCase();

  const hasFactual = FACTUAL_KEYWORDS.some(kw => lowerMsg.includes(kw));
  const hasReasoning = REASONING_KEYWORDS.some(kw => lowerMsg.includes(kw));

  console.log('[Intent Detection] Message:', message);
  console.log('[Intent Detection] Factual keywords found:', hasFactual);
  console.log('[Intent Detection] Reasoning keywords found:', hasReasoning);

  if (hasFactual && hasReasoning) return 'combined';
  if (hasFactual) return 'factual';
  if (hasReasoning) return 'reasoning';

  // Default to reasoning for ambiguous queries
  return 'reasoning';
}

/**
 * Read org data from the in-memory orgStore cache.
 * Never hits Firebase — orgStore is loaded once on login and updated
 * locally on every write, so newly added employees/invoices/etc. are
 * visible to the AI immediately with zero reads.
 *
 * If the cache isn't populated yet (e.g. AI opened before OrgContext
 * finished bootstrapping), this triggers a one-time orgStore.load().
 */
export async function fetchRawOrgData(orgId: string): Promise<any | null> {
  if (!orgId) return null;

  if (!orgStore.isLoaded() || orgStore.getOrgId() !== orgId) {
    console.log('[Raw Data] orgStore not loaded — bootstrapping for', orgId);
    await orgStore.load(orgId);
  }

  const cache = orgStore.getCache();
  const profile = cache._profile || {};
  const orgData: any = {
    ...cache,
    _profile: profile,
    company_name: profile.company_name,
  };
  console.log('[Raw Data] Served from orgStore cache (no Firebase read)');
  return orgData;
}

/**
 * Format raw financial documents (invoices, quotes) for AI prompt
 */
// What counts as collected, and what counts as issued-but-unpaid.
//
// These mirror app.catalog_is_collected() and app.catalog_is_sold() in
// 0011_product_catalog.sql, which is the database's definition of a sale and
// the one Product Performance and Sales by Countries already use. The filter
// here used to be `status === 'pending' || status === 'sent'`, which missed
// viewed, partially_paid, overdue, payment_submitted and advance_paid — so the
// AI under-reported outstanding money and disagreed with every other screen.
const COLLECTED_STATUSES = new Set(['paid']);
const UNPAID_ISSUED_STATUSES = new Set([
  'pending', 'sent', 'viewed', 'partially_paid', 'overdue',
  'payment_submitted', 'advance_paid',
]);

function formatFinancials(finDocs: any, expenses: any): string {
  if ((!finDocs || typeof finDocs !== 'object') && (!expenses || typeof expenses !== 'object')) {
    return 'No financial records available.';
  }

  const docs = Object.values(finDocs || {}) as any[];
  const expList = Object.values(expenses || {}) as any[];

  // 1. Invoices & Revenue Summary
  const invoices = docs.filter(d => d.type === 'invoice');
  const paid = invoices.filter(d => COLLECTED_STATUSES.has(d.status));
  const pending = invoices.filter(d => UNPAID_ISSUED_STATUSES.has(d.status));
  
  const totalPaid = paid.reduce((acc, d) => acc + (d.grand_total || d.amount || 0), 0);
  const totalPending = pending.reduce((acc, d) => acc + (d.grand_total || d.amount || 0), 0);

  // 2. Formatting Line Items
  const formatDoc = (d: any, idx: number) => {
    const type = (d.type || 'document').toUpperCase();
    const id = d.invoice_number || d.id;
    // clientName is what orgStore's financialDocFromRow() emits (bill_to_name);
    // the other three are Firebase-era aliases that survive only via `payload`.
    const client = d.clientName || d.client_name || d.issued_to || d.customer_name || 'Client';
    const amount = d.grand_total || d.amount || 0;
    const status = d.status || 'draft';
    const date = d.issue_date || d.created_at || '';
    return `${idx + 1}. [${type} ${id}] ${client} - ₹${amount.toLocaleString()} (${status}) ${date ? `on ${date}` : ''}`;
  };

  const sections: string[] = [];
  sections.push(`FINANCIAL SUMMARY:
- Total Collected: ₹${totalPaid.toLocaleString()}
- Total Pending: ₹${totalPending.toLocaleString()}
- Total Invoices: ${invoices.length} (${paid.length} paid, ${pending.length} unpaid)`);

  if (invoices.length > 0) {
    sections.push(`INVOICES:\n${invoices.map(formatDoc).join('\n')}`);
  }

  const quotes = docs.filter(d => d.type === 'quotation' || d.type === 'proforma');
  if (quotes.length > 0) {
    sections.push(`QUOTATIONS & PROFORMAS:\n${quotes.map(formatDoc).join('\n')}`);
  }

  if (expList.length > 0) {
    const totalExp = expList.reduce((acc, e) => acc + (e.amount || 0), 0);
    const expStrings = expList.slice(0, 10).map((e, idx) => 
      `${idx + 1}. ${e.category || 'General'}: ₹${(e.amount || 0).toLocaleString()} - ${e.description || 'No description'}`
    );
    sections.push(`EXPENSES (Total: ₹${totalExp.toLocaleString()}):\n${expStrings.join('\n')}`);
  }

  return sections.join('\n\n');
}

/**
 * Format the ROADMAP for the AI prompt — orgStore's `products` section, which
 * is ProductPlanner's backlog. What the company SELLS is a different section
 * (`catalog`) and a different formatter; see formatCatalog below.
 */
function formatProducts(products: any): string {
  if (!products || typeof products !== 'object') return 'No product roadmap data available.';
  const items = Object.values(products) as any[];
  if (items.length === 0) return 'No roadmap items found.';

  const formatted = items.map((p, idx) =>
    `${idx + 1}. ${p.name || 'Unnamed'} — ${p.status || 'planned'} (${p.priority || 'medium'} priority)${p.due_date ? `, due ${p.due_date}` : ''}`
  );
  return `PRODUCT ROADMAP (planned/in-progress work, NOT the sales catalogue):\n${formatted.join('\n')}`;
}

/**
 * Format the sellable catalogue and its sales performance.
 *
 * units_sold / revenue / revenue_paid / last_sold_at are maintained in Postgres
 * by app.recompute_catalog_sales() off the issued invoices, so these are the
 * same numbers the Products page shows — the model is not asked to add anything
 * up, only to read the ranking. That matters: totals an LLM derives itself from
 * a list of invoices are exactly the kind of number it gets confidently wrong.
 */
function formatCatalog(catalog: any): string {
  if (!catalog || typeof catalog !== 'object') return 'No product catalogue available.';
  const items = (Object.values(catalog) as any[]).filter((p) => !p.archived_at);
  if (items.length === 0) return 'The product catalogue is empty.';

  const money = (n: any) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;
  const ranked = [...items].sort((a, b) => (Number(b.revenue) || 0) - (Number(a.revenue) || 0));

  const lines = ranked.map((p, idx) => {
    const parts = [`${idx + 1}. ${p.name || 'Unnamed'}`];
    if (p.sku) parts.push(`[${p.sku}]`);
    parts.push(`— ${money(p.unit_price)} per ${p.unit || 'Nos'}`);
    parts.push(`(${p.category || 'Uncategorised'}, ${p.tax_rate ?? 18}% GST${p.hsn_sac ? `, HSN ${p.hsn_sac}` : ''})`);
    if (Number(p.units_sold) > 0) {
      parts.push(`| sold ${Number(p.units_sold).toLocaleString('en-IN')} units across ${p.invoice_count} invoice(s), ${money(p.revenue)} billed, ${money(p.revenue_paid)} collected, last sold ${p.last_sold_at || 'unknown'}`);
    } else {
      parts.push('| no recorded sales yet');
    }
    if (p.track_inventory) parts.push(`| stock on hand: ${p.stock_qty}`);
    return parts.join(' ');
  });

  const sold = ranked.filter((p) => Number(p.units_sold) > 0);
  const header = sold.length > 0
    ? `PRODUCT CATALOGUE & SALES (${items.length} products, ranked by revenue billed; best seller: ${sold[0].name}):`
    : `PRODUCT CATALOGUE (${items.length} products, none sold yet):`;

  return `${header}\n${lines.join('\n')}\n`
    + 'Note: these totals cover invoices that have been issued (sent/viewed/overdue/part-paid/paid). '
    + 'Quotations and proformas are NOT counted as sales. "Collected" is the paid-only subset. '
    + 'Figures are all-time; the Products page has a date filter for a specific window.';
}

/**
 * Format raw employees data for AI prompt
 */
function formatEmployees(employees: any): string {
  if (!employees || typeof employees !== 'object') return 'No employee data available.';

  const empList = Object.values(employees) as any[];
  if (empList.length === 0) return 'No employees found.';

  const formatted = empList.map((e, idx) => {
    const name = e.studentName || e.name || e.fullName || 'Unknown';
    const role = e.designation || e.role || e.position || 'No role';
    const dept = e.department || e.dept || '';
    const email = e.email || '';

    let line = `${idx + 1}. ${name} → ${role}`;
    if (dept) line += ` (${dept})`;
    if (email) line += ` [${email}]`;
    return line;
  });

  return `Employees (${empList.length} total):\n${formatted.join('\n')}`;
}

/**
 * Format raw CRM data for AI prompt
 */
// The stages CRM.jsx actually renders (its COLUMNS array at CRM.jsx:10-15).
const CRM_STAGE_LABELS: Record<string, string> = {
  lead: 'Lead',
  contacted: 'Contacted',
  deal: 'Deal (won)',
  not_deal: 'Not a deal (lost)',
};

function formatCRM(crm: any): string {
  if (!crm || typeof crm !== 'object') return 'No CRM data available.';

  const items = Object.values(crm) as any[];
  if (items.length === 0) return 'No CRM entries found.';

  // company_name / person_name / stage / value are what orgStore's
  // crm_leads.fromRow emits. This used to read item.name / item.company /
  // item.contact and bucket on stages named 'customer' and 'won' — none of
  // which exist — so every lead rendered as "Unknown [unknown]" and both
  // buckets were empty on real data.
  const nameOf = (i: any) =>
    i.company_name || i.person_name || i.name || i.company || 'Unnamed lead';

  const formatItem = (item: any, idx: number) => {
    const contact = item.person_name && item.company_name ? ` (contact: ${item.person_name})` : '';
    const parts = [`${idx + 1}. ${nameOf(item)}${contact}`];
    if (item.value) parts.push(`Value: ₹${Number(item.value).toLocaleString('en-IN')}`);
    if (item.email) parts.push(item.email);
    if (item.phone) parts.push(item.phone);
    let out = parts.join(' - ');
    const notes = item.notes ? String(item.notes) : '';
    if (notes) out += `\n   Notes: ${notes.substring(0, 120)}${notes.length > 120 ? '...' : ''}`;
    return out;
  };

  const byStage = new Map<string, any[]>();
  for (const item of items) {
    const stage = item.stage || 'lead';
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage)!.push(item);
  }

  const openValue = items
    .filter(i => i.stage !== 'not_deal')
    .reduce((acc, i) => acc + (Number(i.value) || 0), 0);
  const wonValue = (byStage.get('deal') || [])
    .reduce((acc, i) => acc + (Number(i.value) || 0), 0);

  const sections: string[] = [];
  sections.push(`CRM PIPELINE (${items.length} lead${items.length === 1 ? '' : 's'}):
- Open pipeline value (excludes lost): ₹${openValue.toLocaleString('en-IN')}
- Won (stage "deal"): ${(byStage.get('deal') || []).length} worth ₹${wonValue.toLocaleString('en-IN')}`);

  const ORDER = ['lead', 'contacted', 'deal', 'not_deal'];
  for (const stage of ORDER) {
    const group = byStage.get(stage);
    if (!group?.length) continue;
    sections.push(`${CRM_STAGE_LABELS[stage]} (${group.length}):\n${group.map(formatItem).join('\n')}`);
  }
  // stage has no check constraint in 0001_init.sql, so an unrecognised value is
  // reported rather than silently dropped.
  for (const [stage, group] of byStage) {
    if (ORDER.includes(stage)) continue;
    sections.push(`Other stage "${stage}" (${group.length}):\n${group.map(formatItem).join('\n')}`);
  }

  return sections.join('\n\n');
}

/**
 * Format the client directory — the `customers` table — for the AI prompt.
 *
 * There was no formatter for this section at all, so nothing in the AI's
 * context ever mentioned a client. Deliberately separate from formatCRM: a lead
 * is someone being pursued, a client is someone on the books, and answering
 * "how many clients do we have" from the pipeline would be wrong.
 */
function formatCustomers(customers: any): string {
  if (!customers || typeof customers !== 'object') return 'No client directory available.';

  const list = Object.values(customers) as any[];
  if (list.length === 0) return 'No clients in the directory yet.';

  const withGstin = list.filter(c => c.buyerGSTIN).length;
  const countries = [...new Set(list.map(c => c.country_code).filter(Boolean))];

  const formatItem = (c: any, idx: number) => {
    const detail: string[] = [];
    if (c.clientEmail) detail.push(c.clientEmail);
    if (c.contactPhone) detail.push(c.contactPhone);
    if (c.buyerGSTIN) detail.push(`GSTIN ${c.buyerGSTIN}`);
    if (c.buyerState) detail.push(c.buyerState);
    if (c.country_code) detail.push(c.country_code);
    const head = `${idx + 1}. ${c.clientName || c.name || 'Unnamed'}`;
    const line = detail.length ? `${head} - ${detail.join(' - ')}` : head;
    return c.clientAddress ? `${line}\n   ${c.clientAddress}` : line;
  };

  const header = [`CLIENT DIRECTORY (${list.length} client${list.length === 1 ? '' : 's'}):`];
  if (withGstin) header.push(`- ${withGstin} with a GSTIN on file`);
  if (countries.length) header.push(`- Countries: ${countries.join(', ')}`);

  return `${header.join('\n')}\n${list.map(formatItem).join('\n')}`;
}

/**
 * Format raw tasks data for AI prompt
 */
function formatTasks(tasks: any): string {
  if (!tasks || typeof tasks !== 'object') return 'No tasks assigned yet.';

  const taskList = Object.values(tasks) as any[];
  if (taskList.length === 0) return 'No tasks found.';

  const formatted = taskList.map((t, idx) => {
    const title    = t.title || 'Untitled';
    const status   = (t.status || 'pending').toUpperCase();
    const assignee = t.assignedName || 'Unassigned';   // ← real name, not push-ID
    const role     = t.assignedRole ? ` (${t.assignedRole})` : '';
    const deadline = t.deadline || '';                  // ← correct field name
    const priority = t.priority || 'medium';
    const desc     = t.description || '';

    const lines = [`${idx + 1}. "${title}" [${status}] [${priority} priority]`];
    lines.push(`   Assigned to: ${assignee}${role}`);
    if (deadline) lines.push(`   Deadline: ${deadline}`);
    if (desc)     lines.push(`   Details: ${desc}`);
    if (t.notes)  lines.push(`   Notes: ${t.notes}`);
    return lines.join('\n');
  });

  return `TASKS (${taskList.length} total):\n${formatted.join('\n\n')}`;
}

/**
 * Format raw company info for AI prompt
 */
function formatCompanyInfo(orgData: any): string {
  const profile = orgData._profile || orgData;

  const founderName = profile.owner_full_name || profile.founder_name || profile.owner_name || profile.first_name || profile.name || 'Unknown';

  const lines = [
    `Company: ${profile.company_name || 'Unknown'}`,
    `Founder/Boss: ${founderName}`,
    `Industry: ${profile.industry || 'Unknown'}`,
    `Size: ${profile.company_size || 'Unknown'}`,
    `Location: ${profile.city || 'Unknown'}, ${profile.country || 'Unknown'}`,
  ];

  if (profile.company_website) lines.push(`Website: ${profile.company_website}`);
  if (profile.company_description) lines.push(`Description: ${profile.company_description}`);

  return `Company Information:\n${lines.join('\n')}`;
}

/**
 * Format raw data based on query intent and specific sections needed
 */
export function formatRawDataForPrompt(
  orgData: any,
  intent: QueryIntent,
  message: string
): string {
  if (!orgData) return 'No company data available.';

  const lowerMsg = message.toLowerCase();
  const sections: string[] = [];

  // Determine which sections to include based on query
  const needsEmployees = lowerMsg.includes('employee') || lowerMsg.includes('team') ||
                        lowerMsg.includes('staff') || lowerMsg.includes('who') ||
                        lowerMsg.includes('people') || lowerMsg.includes('role');

  const needsCRM = lowerMsg.includes('customer') || lowerMsg.includes('lead') ||
                   lowerMsg.includes('client') || lowerMsg.includes('crm') ||
                   lowerMsg.includes('deal') || lowerMsg.includes('contact');

  const needsFinancials = lowerMsg.includes('invoice') || lowerMsg.includes('revenue') ||
                         lowerMsg.includes('money') || lowerMsg.includes('paid') ||
                         lowerMsg.includes('earning') || lowerMsg.includes('bill') ||
                         lowerMsg.includes('quotation') || lowerMsg.includes('proforma') ||
                         lowerMsg.includes('expense') || lowerMsg.includes('cost') ||
                         lowerMsg.includes('financial') || lowerMsg.includes('price');

  const needsTasks = lowerMsg.includes('task') || lowerMsg.includes('assign') ||
                     lowerMsg.includes('deadline') || lowerMsg.includes('overdue') ||
                     lowerMsg.includes('working on') || lowerMsg.includes('doing') ||
                     lowerMsg.includes('in progress') || lowerMsg.includes('project') ||
                     lowerMsg.includes('due') || lowerMsg.includes('responsible') ||
                     lowerMsg.includes('pending work') || lowerMsg.includes('assignment');

  // Sales-catalogue questions. Kept separate from needsFinancials so "what is
  // our best seller" pulls the catalogue without dragging in every invoice, and
  // separate from the roadmap below so "what are we building" does not.
  const needsProducts = lowerMsg.includes('product') || lowerMsg.includes('sku') ||
                        lowerMsg.includes('catalog') || lowerMsg.includes('catalogue') ||
                        lowerMsg.includes('best-selling') || lowerMsg.includes('best selling') ||
                        lowerMsg.includes('bestseller') || lowerMsg.includes('best seller') ||
                        lowerMsg.includes('top selling') || lowerMsg.includes('sell') ||
                        lowerMsg.includes('sold') || lowerMsg.includes('sales') ||
                        lowerMsg.includes('service') || lowerMsg.includes('inventory') ||
                        lowerMsg.includes('stock') || lowerMsg.includes('hsn');

  const needsRoadmap = lowerMsg.includes('roadmap') || lowerMsg.includes('planner') ||
                       lowerMsg.includes('building') || lowerMsg.includes('backlog') ||
                       lowerMsg.includes('shipping') || lowerMsg.includes('launch');

  const needsCompany = lowerMsg.includes('company') || lowerMsg.includes('business') ||
                       lowerMsg.includes('about us') || lowerMsg.includes('info') ||
                       lowerMsg.includes('founder') || lowerMsg.includes('boss') ||
                       lowerMsg.includes('owner') || lowerMsg.includes('who') ||
                       lowerMsg.includes('you') || lowerMsg.includes('me');

  // ALWAYS include basic company identity as the foundation of the context
  sections.push(formatCompanyInfo(orgData));

  console.log('[Raw Data Formatter] Sections needed:', {
    employees: needsEmployees,
    crm: needsCRM,
    financials: needsFinancials,
    products: needsProducts,
    roadmap: needsRoadmap,
    tasks: needsTasks,
    company: needsCompany,
    intent,
  });

  // Include relevant data sections based on query content — regardless of intent type.
  // Reasoning queries ("should I hire?") need the same raw data as factual queries
  // to avoid hallucination.
  if (needsEmployees) {
    sections.push(formatEmployees(orgData.employees));
  }
  if (needsCRM) {
    // orgStore's section key is `crm_leads`. `crm` and `leads` are Firebase-era
    // names that no longer exist in the cache, so this read was always
    // undefined and formatCRM always returned "No CRM data available."
    sections.push(formatCRM(orgData.crm_leads || orgData.crm || orgData.leads));
    sections.push(formatCustomers(orgData.customers));
  }
  if (needsFinancials) {
    sections.push(formatFinancials(orgData.fin_docs, orgData.expenses));
  }
  if (needsFinancials || needsProducts) {
    // The catalogue is what answers "what is our best-selling product this
    // quarter" — a question the invoices alone cannot answer, because without
    // catalog_item_id the model would be matching product names against
    // free-text line descriptions and guessing.
    sections.push(formatCatalog(orgData.catalog));
  }
  if (needsRoadmap) {
    sections.push(formatProducts(orgData.products));
  }
  if (needsTasks) {
    sections.push(formatTasks(orgData.tasks));
    // Always show employees alongside tasks so AI can correlate names ↔ roles
    if (!needsEmployees) sections.push(formatEmployees(orgData.employees));
  }

  // If no specific section was matched (e.g. general reasoning query), include
  // all org data so the AI has full context
  if (!needsEmployees && !needsCRM && !needsFinancials && !needsProducts
      && !needsRoadmap && !needsTasks) {
    sections.push(formatEmployees(orgData.employees));
    sections.push(formatFinancials(orgData.fin_docs, orgData.expenses));
    sections.push(formatCatalog(orgData.catalog));
    sections.push(formatCRM(orgData.crm_leads || orgData.crm || orgData.leads));
    sections.push(formatCustomers(orgData.customers));
    sections.push(formatTasks(orgData.tasks));
  }

  const result = sections.join('\n\n');
  console.log('[Raw Data Formatter] Formatted length:', result.length);
  return result || 'No specific data available for this query.';
}

/**
 * Get the appropriate data based on intent
 * ALWAYS fetches fresh org data from /organizations/{orgId} for every query
 */
export async function getContextForQuery(
  orgId: string,
  message: string,
  memory: CompanyMemory | null
): Promise<{
  intent: QueryIntent;
  rawData: string;
  memoryInsights: { insights: string[]; opportunities: string[]; risks: string[] };
}> {
  const intent = detectQueryIntent(message);
  console.log('[Context] Detected intent:', intent);

  let rawData = '';
  let memoryInsights = { insights: [] as string[], opportunities: [] as string[], risks: [] as string[] };

  // ALWAYS fetch raw data from /organizations/{orgId} for EVERY query
  // This ensures AI knows owner name, company info, employees, etc.
  console.log('[Context] Fetching fresh org data from /organizations/' + orgId);
  const orgData = await fetchRawOrgData(orgId);
  if (orgData) {
    rawData = formatRawDataForPrompt(orgData, intent, message);
    console.log('[Context] Fresh org data loaded - Owner:', orgData._profile?.owner_name || orgData.company_name);
  } else {
    console.log('[Context] WARNING: Could not fetch org data from Firebase');
  }

  // Get memory insights for reasoning or combined queries
  if (intent === 'reasoning' || intent === 'combined') {
    if (memory) {
      memoryInsights = {
        insights: (memory.insights || []).slice(0, 3),
        opportunities: (memory.opportunities || []).slice(0, 3),
        risks: (memory.risks || []).slice(0, 3),
      };
    }
  }

  console.log('[Context] Raw data length:', rawData.length);
  console.log('[Context] Memory insights count:', memoryInsights.insights.length);

  return { intent, rawData, memoryInsights };
}
