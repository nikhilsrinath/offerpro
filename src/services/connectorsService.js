import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { orgStore } from './orgStore';

/**
 * The browser's side of /api/connectors. Keys never pass through here except
 * once, on Connect, straight to the server; the server never sends one back.
 *
 * Which connectors are connected is asked once per org per session and shared
 * by every screen (the Connectors page, the client and vendor forms, the CRM),
 * so connecting Apollo in one tab of the app lights it up everywhere at once.
 */

async function token() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('You are signed out. Sign in again.');
  return session.access_token;
}

async function request(method, body, query = '') {
  const res = await fetch(`/api/connectors${query}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let out = {};
  try { out = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || out.success === false) {
    const err = new Error(out.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return out;
}

/* ── the shared status ────────────────────────────────────────────────────── */

const state = { orgId: null, list: null, role: null, error: null, loading: null };
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

function setList(orgId, list, role) {
  state.orgId = orgId;
  state.list = list || [];
  if (role) state.role = role;
  state.error = null;
  notify();
}

/** Connected connectors for the org, asked once; `force` asks again. */
export async function loadConnectors(orgId, { force = false } = {}) {
  if (!orgId) return [];
  if (!force && state.orgId === orgId && state.list) return state.list;
  if (!force && state.orgId === orgId && state.loading) return state.loading;
  state.orgId = orgId;
  state.loading = request('GET', null, `?org_id=${encodeURIComponent(orgId)}`)
    .then((out) => { setList(orgId, out.connectors, out.role); return state.list; })
    .catch((err) => {
      // 0106 not applied, or offline: every connector reads as not connected.
      state.list = [];
      state.error = err.message;
      notify();
      return [];
    })
    .finally(() => { state.loading = null; });
  return state.loading;
}

/**
 * The connector's status for the org: `status` is its row, or null when it
 * is not connected. Loads on first use; every screen shares the answer.
 */
export function useConnectorFor(orgId, provider) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    if (orgId) loadConnectors(orgId);
    return () => listeners.delete(fn);
  }, [orgId]);
  const list = state.orgId === orgId ? state.list : null;
  return {
    status: (list || []).find((c) => c.provider === provider) || null,
    loaded: !!list,
    error: state.orgId === orgId ? state.error : null,
    // Your role in the org, as the server sees it: owners and admins manage connectors.
    role: state.orgId === orgId ? state.role : null,
  };
}

/* ── Apollo ───────────────────────────────────────────────────────────────── */

const apolloCall = (orgId, action, extra = {}) => request('POST', { org_id: orgId, provider: 'apollo', action, ...extra });
const updatingStatus = async (orgId, p) => { const out = await p; setList(orgId, out.connectors, out.role); return out; };

export const apolloService = {
  connect: (orgId, apiKey, settings) => updatingStatus(orgId, apolloCall(orgId, 'connect', { api_key: apiKey, settings })),
  saveSettings: (orgId, settings) => updatingStatus(orgId, apolloCall(orgId, 'settings', { settings })),
  test: (orgId) => updatingStatus(orgId, apolloCall(orgId, 'test')),
  disconnect: (orgId) => updatingStatus(orgId, apolloCall(orgId, 'disconnect')),
  logs: (orgId) => apolloCall(orgId, 'logs'),

  /** { company } for a website / email / domain, or { candidates } for a name alone. Writes nothing. */
  lookup: (orgId, { domain, website, email, name }) => apolloCall(orgId, 'company', { domain, website, email, name }),

  /**
   * Looks the record's company up and saves the details on it (as you, so
   * your role's permissions apply), filling only blank fields. Refreshes the
   * cached clients or vendors so every screen shows the result.
   */
  enrich: async (orgId, kind, id, { domain, auto = false } = {}) => {
    const out = await apolloCall(orgId, 'enrich', { kind, id, domain, auto });
    if (!out.skipped) {
      await orgStore.refreshSection(kind === 'vendor' ? 'vendors' : 'customers').catch(() => {});
      if (kind === 'client') orgStore.refreshSection('crm_leads').catch(() => {});
    }
    return out;
  },

  /** Decision makers at the company: names and titles only. Free in Apollo. */
  people: (orgId, { domain, apolloId }) => apolloCall(orgId, 'people', { domain, apollo_id: apolloId }),

  /** One person's work email and LinkedIn. Uses Apollo credits. */
  reveal: (orgId, personId) => apolloCall(orgId, 'reveal', { person_id: personId }),
};

/**
 * A person Apollo revealed, added to a client's or vendor's Contact Persons
 * (0074). The first contact becomes the primary one.
 */
export async function addApolloContact(kind, record, person) {
  const section = kind === 'vendor' ? 'vendors' : 'customers';
  const current = orgStore.getItem(section, record.id) || record;
  const contacts = Array.isArray(current.contacts) ? current.contacts : [];
  const next = [...contacts, {
    name: person.name || 'Unnamed', role: person.title || '', email: person.email || '', phone: '',
    primary: contacts.length === 0, linkedin_url: person.linkedin_url || undefined, source: 'apollo',
  }];
  await orgStore.updateItem(section, record.id, { contacts: next });
  return next;
}

/**
 * After a client or lead is added: when Apollo is connected with automatic
 * fill-in on, look its company up in the background. Never throws and never
 * blocks the save; tells the person only when something was filled in.
 */
export async function autoFillAfterCreate(orgId, kind, id, { toast } = {}) {
  try {
    if (!orgId || !id) return;
    const list = await loadConnectors(orgId);
    const apollo = list.find((c) => c.provider === 'apollo');
    if (!apollo?.settings?.auto_fill) return;
    const out = await apolloService.enrich(orgId, kind, id, { auto: true });
    if (out?.company && !out.skipped) toast?.(`Apollo filled in ${out.company.name || 'the company'}’s details`, 'success');
  } catch (err) {
    // Out of credits, key refused…: worth saying, but the record is saved.
    toast?.(`Apollo could not fill in the company: ${err.message}`, 'info');
  }
}
