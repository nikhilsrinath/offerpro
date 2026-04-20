/**
 * Company Memory Service
 * Extracts intelligence from org data and stores structured memory
 */

import { ref, get, set, update } from 'firebase/database';
import { db } from '../lib/firebase';

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
  };
}

export interface CompanyMemory {
  facts: CompanyFacts;
  insights: string[];
  opportunities: string[];
  risks: string[];
  updated_at: string;
}

const MAX_ITEMS_PER_CATEGORY = 20;

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
    // First try to get cached memory
    const memoryRef = ref(db, `memory/${orgId}`);
    const memorySnap = await get(memoryRef);

    if (memorySnap.exists()) {
      return memorySnap.val() as CompanyMemory;
    }

    // If no memory exists, fetch org data and extract
    const orgRef = ref(db, `organizations/${orgId}`);
    const orgSnap = await get(orgRef);

    if (!orgSnap.exists()) return null;

    const orgData = orgSnap.val();
    const memory = extractCompanyMemory(orgData) as CompanyMemory;

    // Store extracted memory
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

    await set(memoryRef, merged);
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
    topInsights: memory.insights.slice(0, 3),
    topOpportunities: memory.opportunities.slice(0, 3),
    topRisks: memory.risks.slice(0, 3),
  };
}

/**
 * Refresh memory from current org data
 */
export async function refreshMemory(orgId: string): Promise<CompanyMemory | null> {
  if (!orgId) return null;

  try {
    const orgRef = ref(db, `organizations/${orgId}`);
    const orgSnap = await get(orgRef);

    if (!orgSnap.exists()) return null;

    const orgData = orgSnap.val();
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
