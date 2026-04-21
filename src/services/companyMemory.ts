/**
 * Company Memory Service
 * Extracts intelligence from org data and stores structured memory
 */

import { ref, get, set, update } from 'firebase/database';
import { doc, setDoc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { db, firestore } from '../lib/firebase';

// ── LOCAL CACHE FOR FAST ACCESS ─────────────────────────────
// Caches org data to avoid Firebase fetches on every query
const CACHE_TTL_MS = 30000; // 30 seconds
const orgDataCache: Map<string, { data: any; timestamp: number }> = new Map();

function getCachedOrgData(orgId: string): any | null {
  const cached = orgDataCache.get(orgId);
  if (!cached) return null;

  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL_MS) {
    orgDataCache.delete(orgId);
    return null;
  }

  console.log('[Cache] Hit for org', orgId, '- age:', age, 'ms');
  return cached.data;
}

function setCachedOrgData(orgId: string, data: any): void {
  orgDataCache.set(orgId, { data, timestamp: Date.now() });
  console.log('[Cache] Stored org data for', orgId);
}

/**
 * Clear cached org data to force fresh fetch
 */
export function clearOrgDataCache(orgId?: string): void {
  if (orgId) {
    orgDataCache.delete(orgId);
    console.log('[Cache] Cleared cache for org', orgId);
  } else {
    orgDataCache.clear();
    console.log('[Cache] Cleared all org caches');
  }
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

    // Save to Firebase (Dual-Write)
    const memoryRef = ref(db, `memory/${orgId}`);
    const rtdbPromise = set(memoryRef, updatedMemory);
    
    const fsDocRef = doc(firestore, 'memory', orgId);
    const fsPromise = setDoc(fsDocRef, updatedMemory, { merge: true });

    await Promise.all([rtdbPromise, fsPromise]);

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
    // First try to get cached memory from Firestore
    const fsDocRef = doc(firestore, 'memory', orgId);
    const memorySnap = await getDoc(fsDocRef);

    if (memorySnap.exists()) {
      return memorySnap.val() as CompanyMemory;
    }

    // If no memory exists, fetch org data and extract
    const orgDocRef = doc(firestore, 'organizations', orgId);
    const orgSnap = await getDoc(orgDocRef);

    if (!orgSnap.exists()) return null;

    const orgData = orgSnap.data();
    const memory = extractCompanyMemory(orgData) as CompanyMemory;

    // Store extracted memory (Dual-Write)
    await setDoc(fsDocRef, memory, { merge: true });
    
    const memoryRef = ref(db, `memory/${orgId}`);
    await set(memoryRef, memory);
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
    const memoryRef = ref(db, `memory/${orgId}`);
    const existingSnap = await get(memoryRef);
    const existing = existingSnap.exists() ? existingSnap.val() : {};

    const merged: CompanyMemory = {
      facts: { ...existing.facts, ...updates.facts },
      insights: mergeArrays(existing.insights, updates.insights || []),
      opportunities: mergeArrays(existing.opportunities, updates.opportunities || []),
      risks: mergeArrays(existing.risks, updates.risks || []),
      updated_at: new Date().toISOString(),
    };

    // Save to Firebase (Dual-Write)
    const rtdbPromise = set(memoryRef, merged);
    const fsDocRef = doc(firestore, 'memory', orgId);
    const fsPromise = setDoc(fsDocRef, merged, { merge: true });

    await Promise.all([rtdbPromise, fsPromise]);
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
    const orgDocRef = doc(firestore, 'organizations', orgId);
    const orgSnap = await getDoc(orgDocRef);

    if (!orgSnap.exists()) return null;

    const orgData = orgSnap.data();
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

  // Count CRM leads/customers
  const crm = orgData.crm || orgData.leads;
  if (crm && typeof crm === 'object') {
    const items = Object.values(crm);
    metrics.lead_count = items.filter((l: any) => l.status === 'lead' || l.stage === 'lead').length;
    metrics.customer_count = items.filter((l: any) => l.status === 'customer' || l.stage === 'customer' || l.status === 'won').length;
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
  const crm = orgData.crm || orgData.leads;
  if (!crm || typeof crm !== 'object') return;

  const items = Object.values(crm) as any[];

  // Find high-value deals
  items.forEach((item: any) => {
    const value = item.value || item.deal_value || item.amount || 0;
    const notes = item.notes || item.description || '';
    const stage = item.stage || item.status || '';

    // High-value opportunity detection
    if (value >= 20000 || notes.toLowerCase().includes('20k') || notes.toLowerCase().includes('large')) {
      opportunities.push(`Potential large deal (${value > 0 ? value.toLocaleString() : 'significant'} value) from ${item.name || 'lead'}`);
    }

    // Deal in negotiation
    if (stage.toLowerCase().includes('negotiation') || stage.toLowerCase().includes('proposal')) {
      insights.push(`Active negotiation with ${item.name || 'lead'} at ${stage}`);
    }

    // Stuck deals
    if (stage.toLowerCase().includes('stuck') || stage.toLowerCase().includes('delayed')) {
      risks.push(`Deal with ${item.name || 'lead'} appears stalled at ${stage}`);
    }
  });

  // Pipeline summary
  const leads = items.filter((i: any) => i.stage === 'lead' || i.status === 'lead').length;
  const customers = items.filter((i: any) => i.stage === 'customer' || i.status === 'won' || i.status === 'customer').length;

  if (leads > 5) {
    opportunities.push(`${leads} active leads in pipeline - potential for growth`);
  }
  if (customers > 0) {
    insights.push(`${customers} active customer${customers > 1 ? 's' : ''} on record`);
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
  'tasks', 'projects', 'invoices', 'documents', 'records',
  'revenue', 'money', 'paid', 'pending', 'collected', 'earnings',
  'financial', 'bill', 'quotation', 'proforma', 'expense', 'cost',
  'tell me about', 'give me', 'find', 'search',
  'email', 'phone', 'contact', 'address', 'location',
  'founder', 'boss', 'owner', 'ceo', 'you', 'me'
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
 * Fetch raw organization data from Firebase (with local cache)
 */
export async function fetchRawOrgData(orgId: string): Promise<any | null> {
  if (!orgId) return null;

  // Check cache first
  const cached = getCachedOrgData(orgId);
  if (cached) {
    console.log('[Raw Data] Using cached org data for:', orgId);
    return cached;
  }

  try {
    console.log('[Raw Data] Fetching org data from Firestore for:', orgId);
    
    // Fetch key documents in parallel
    const keyedCollections = ['employees', 'crm_leads', 'fin_docs', 'expenses', 'products'];
    const pProfile = getDoc(doc(firestore, 'organizations', orgId));
    const pKeyed = keyedCollections.map(col => 
      getDocs(query(collection(firestore, col), where('orgId', '==', orgId)))
    );

    const [profileSnap, ...keyedSnaps] = await Promise.all([pProfile, ...pKeyed]);

    if (!profileSnap.exists()) {
      console.log('[Raw Data] No profile found in Firestore');
      return null;
    }

    const orgData: any = {
      _profile: profileSnap.data(),
      company_name: profileSnap.data().company_name,
    };

    // Reconstruct nested object expected by AI data formatters
    keyedCollections.forEach((col, idx) => {
      const snap = keyedSnaps[idx];
      const data: any = {};
      snap.forEach(d => { data[d.id] = d.data(); });
      
      // Mapping to legacy keys expected by extractCompanyMemory & formatters
      if (col === 'crm_leads') orgData.crm = data;
      else orgData[col] = data;
    });

    console.log('[Raw Data] Org data reconstructed from Firestore successfully');
    setCachedOrgData(orgId, orgData);
    return orgData;
  } catch (error) {
    console.error('[Raw Data] Firestore fetch failed:', error);
    return null;
  }
}

/**
 * Format raw financial documents (invoices, quotes) for AI prompt
 */
function formatFinancials(finDocs: any, expenses: any): string {
  if ((!finDocs || typeof finDocs !== 'object') && (!expenses || typeof expenses !== 'object')) {
    return 'No financial records available.';
  }

  const docs = Object.values(finDocs || {}) as any[];
  const expList = Object.values(expenses || {}) as any[];

  // 1. Invoices & Revenue Summary
  const invoices = docs.filter(d => d.type === 'invoice');
  const paid = invoices.filter(d => d.status === 'paid');
  const pending = invoices.filter(d => d.status === 'pending' || d.status === 'sent');
  
  const totalPaid = paid.reduce((acc, d) => acc + (d.grand_total || d.amount || 0), 0);
  const totalPending = pending.reduce((acc, d) => acc + (d.grand_total || d.amount || 0), 0);

  // 2. Formatting Line Items
  const formatDoc = (d: any, idx: number) => {
    const type = (d.type || 'document').toUpperCase();
    const id = d.invoice_number || d.id;
    const client = d.client_name || d.issued_to || d.customer_name || 'Client';
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
 * Format products data for AI prompt
 */
function formatProducts(products: any): string {
  if (!products || typeof products !== 'object') return 'No product/service data available.';
  const items = Object.values(products) as any[];
  if (items.length === 0) return 'No products found.';

  const formatted = items.map((p, idx) => 
    `${idx + 1}. ${p.name || 'Unnamed'} - ₹${(p.price || p.rate || 0).toLocaleString()} (${p.category || 'General'})`
  );
  return `PRODUCTS & SERVICES:\n${formatted.join('\n')}`;
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
function formatCRM(crm: any): string {
  if (!crm || typeof crm !== 'object') return 'No CRM data available.';

  const items = Object.values(crm) as any[];
  if (items.length === 0) return 'No CRM entries found.';

  const leads = items.filter(i => i.status === 'lead' || i.stage === 'lead' || !i.status);
  const customers = items.filter(i => i.status === 'customer' || i.stage === 'customer' || i.status === 'won');

  const formatItem = (item: any, idx: number) => {
    const name = item.name || item.company || item.contact || 'Unknown';
    const status = item.status || item.stage || 'unknown';
    const value = item.value || item.deal_value || item.amount;
    const notes = item.notes || item.description;

    let line = `${idx + 1}. ${name} [${status}]`;
    if (value) line += ` (Value: ₹${value.toLocaleString()})`;
    if (notes) line += ` - ${notes.substring(0, 50)}${notes.length > 50 ? '...' : ''}`;
    return line;
  };

  let result = '';
  if (leads.length > 0) {
    result += `Leads (${leads.length}):\n${leads.map(formatItem).join('\n')}\n\n`;
  }
  if (customers.length > 0) {
    result += `Customers (${customers.length}):\n${customers.map(formatItem).join('\n')}`;
  }

  return result || 'No categorized CRM data found.';
}

/**
 * Format raw tasks data for AI prompt
 */
function formatTasks(tasks: any): string {
  if (!tasks || typeof tasks !== 'object') return 'No task data available.';

  const taskList = Object.values(tasks) as any[];
  if (taskList.length === 0) return 'No tasks found.';

  const formatted = taskList.map((t, idx) => {
    const title = t.title || t.name || t.task || 'Untitled';
    const status = t.status || 'pending';
    const assignee = t.assignee || t.assigned_to || t.assignedTo || 'Unassigned';
    const due = t.due_date || t.dueDate || '';

    let line = `${idx + 1}. ${title} [${status}]`;
    if (assignee && assignee !== 'Unassigned') line += ` → ${assignee}`;
    if (due) line += ` (Due: ${due})`;
    return line;
  });

  return `Tasks (${taskList.length} total):\n${formatted.join('\n')}`;
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

  const needsTasks = lowerMsg.includes('task') || lowerMsg.includes('project') ||
                     lowerMsg.includes('work') || lowerMsg.includes('assignment');

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
    tasks: needsTasks,
    company: needsCompany
  });

  // For factual queries, include all relevant raw data
  if (intent === 'factual' || intent === 'combined') {
    if (needsEmployees || intent === 'factual') {
      sections.push(formatEmployees(orgData.employees));
    }
    if (needsCRM || intent === 'factual') {
      sections.push(formatCRM(orgData.crm || orgData.leads));
    }
    if (needsFinancials || intent === 'factual') {
      sections.push(formatFinancials(orgData.fin_docs, orgData.expenses));
      sections.push(formatProducts(orgData.products));
    }
    if (needsTasks || intent === 'factual') {
      sections.push(formatTasks(orgData.tasks));
    }
    if (needsCompany || intent === 'factual') {
      sections.push(formatCompanyInfo(orgData));
    }
  }

  // If no specific sections matched but it's a factual query, include everything
  if (intent === 'factual' && sections.length === 0) {
    sections.push(formatCompanyInfo(orgData));
    sections.push(formatFinancials(orgData.fin_docs, orgData.expenses));
    sections.push(formatEmployees(orgData.employees));
    sections.push(formatCRM(orgData.crm || orgData.leads));
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
