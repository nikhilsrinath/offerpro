import {
  normalizeOrganization, normalizeCandidate, normalizePersonPreview, normalizePerson, DECISION_MAKERS,
} from '../../src/shared/apollo.js';
import { HttpError } from './auth.js';

/**
 * Apollo.io's REST API, as Opstead uses it. Every call sends the org's own
 * key in `x-api-key` and spends that org's Apollo credits, never Opstead's.
 *
 *   health        GET  /api/v1/auth/health                 free: is the key good
 *   company       GET  /api/v1/organizations/enrich        1 credit
 *   search        POST /api/v1/mixed_companies/search      1 credit per page
 *   people        POST /api/v1/mixed_people/api_search     free: names and titles only
 *   person        POST /api/v1/people/match                credits: work email, LinkedIn
 *
 * Errors come back as sentences a person can act on; Apollo's own response
 * text is never passed through (it can echo the request).
 */

const BASE = 'https://api.apollo.io/api/v1';
const TIMEOUT_MS = 15000;

const ENDPOINT_NAME = {
  '/auth/health': 'Health',
  '/organizations/enrich': 'Organization Enrichment',
  '/mixed_companies/search': 'Organization Search',
  '/mixed_people/api_search': 'People API Search',
  '/people/match': 'People Enrichment',
};

export class ApolloError extends HttpError {
  constructor(status, message, code) {
    super(status, message);
    this.code = code;
  }
}

/** Test seam: replaced in tests, global fetch otherwise. */
let _fetch = (...args) => fetch(...args);
export function __setFetch(fn) { _fetch = fn || ((...args) => fetch(...args)); }

async function call(key, path, { method = 'GET', query = null, body = null } = {}) {
  if (!key) throw new ApolloError(400, 'Apollo is not connected for this company.', 'not_connected');
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''))}` : '';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await _fetch(`${BASE}${path}${qs}`, {
      method,
      headers: {
        'x-api-key': key,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new ApolloError(502, err?.name === 'AbortError'
      ? 'Apollo took too long to answer. Try again in a moment.'
      : 'Opstead could not reach Apollo. Try again in a moment.', 'unreachable');
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (res.ok) return data || {};

  const name = ENDPOINT_NAME[path] || 'this';
  if (res.status === 401) throw new ApolloError(400, 'Apollo did not accept this API key. Check it in Apollo under Settings → Integrations → API Keys.', 'bad_key');
  if (res.status === 403) {
    throw new ApolloError(400, `This Apollo key is not allowed to use ${name}. In Apollo, edit the key and turn on that endpoint, or make it a master key.`, 'not_allowed');
  }
  if (res.status === 422) throw new ApolloError(400, 'Apollo needs a company website or name to look up.', 'bad_request');
  if (res.status === 429) throw new ApolloError(429, 'Apollo’s rate limit was reached. Try again in a minute.', 'rate_limited');
  if (res.status === 402) throw new ApolloError(402, 'Your Apollo account is out of credits, or its plan does not include API access.', 'no_credits');
  throw new ApolloError(502, `Apollo could not answer just now (status ${res.status}). Try again later.`, 'apollo_error');
}

/** True when the key works. Throws ApolloError with the reason when it does not. */
export async function checkKey(key) {
  const out = await call(key, '/auth/health');
  if (out?.is_logged_in === false || out?.healthy === false) {
    throw new ApolloError(400, 'Apollo did not accept this API key. Check for spaces or a line break after it.', 'bad_key');
  }
  return true;
}

/** One company by domain. Null when Apollo has no match (still uses a credit). */
export async function enrichCompany(key, { domain, name } = {}) {
  const out = await call(key, '/organizations/enrich', { query: { domain, name } });
  return normalizeOrganization(out?.organization);
}

/** Companies whose name matches, for "which one did you mean". */
export async function searchCompanies(key, name, { perPage = 6 } = {}) {
  const out = await call(key, '/mixed_companies/search', {
    method: 'POST',
    body: { q_organization_name: String(name).slice(0, 120), page: 1, per_page: perPage },
  });
  const list = [...(out?.organizations || []), ...(out?.accounts || [])];
  const seen = new Set();
  return list.map(normalizeCandidate).filter((c) => c && c.domain && !seen.has(c.domain) && seen.add(c.domain)).slice(0, perPage);
}

/** Decision makers at a company: names and titles, free of credits. */
export async function findPeople(key, { domain, apolloId, perPage = 10 } = {}) {
  const body = { page: 1, per_page: perPage, person_seniorities: DECISION_MAKERS };
  if (apolloId) body.organization_ids = [apolloId];
  else body.q_organization_domains_list = [domain];
  const out = await call(key, '/mixed_people/api_search', { method: 'POST', body });
  return {
    people: (out?.people || []).map(normalizePersonPreview).filter(Boolean),
    total: Number(out?.total_entries ?? out?.pagination?.total_entries) || null,
  };
}

/** One person's work email and LinkedIn (People Enrichment: uses credits). */
export async function revealPerson(key, personId) {
  const out = await call(key, '/people/match', { method: 'POST', query: { id: personId, reveal_personal_emails: 'false' } });
  return normalizePerson(out?.person);
}
