import { describe, it, expect, afterEach } from 'vitest';
import { __setFetch, checkKey, enrichCompany, searchCompanies, findPeople, revealPerson, ApolloError } from './apolloApi.js';

/*
 * The Apollo client: the right endpoint, the key only in its header, and
 * every refusal turned into something a person can act on.
 */

const calls = [];
function respond(status, body) {
  __setFetch(async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
}
afterEach(() => { calls.length = 0; __setFetch(null); });

describe('apolloApi', () => {
  it('checks a key with the health endpoint, sending it only as x-api-key', async () => {
    respond(200, { healthy: true, is_logged_in: true });
    await expect(checkKey('KEY123456789')).resolves.toBe(true);
    expect(calls[0].url).toBe('https://api.apollo.io/api/v1/auth/health');
    expect(calls[0].init.headers['x-api-key']).toBe('KEY123456789');
    expect(calls[0].url).not.toContain('KEY123');
  });

  it('refuses a key Apollo is not logged in with', async () => {
    respond(200, { healthy: true, is_logged_in: false });
    await expect(checkKey('KEY123456789')).rejects.toMatchObject({ code: 'bad_key', status: 400 });
  });

  it('explains 401, 403, 429 in words', async () => {
    respond(401, { error: 'Invalid access credentials. KEY123456789' });
    const e = await enrichCompany('KEY123456789', { domain: 'kite.io' }).catch((x) => x);
    expect(e).toBeInstanceOf(ApolloError);
    expect(e.message).toMatch(/did not accept this API key/);
    expect(e.message).not.toContain('KEY123');

    respond(403, {});
    await expect(findPeople('k'.repeat(20), { domain: 'kite.io' })).rejects.toThrow(/People API Search/);
    respond(429, {});
    await expect(enrichCompany('k'.repeat(20), { domain: 'kite.io' })).rejects.toMatchObject({ status: 429 });
  });

  it('enriches by domain and normalizes', async () => {
    respond(200, { organization: { id: 'o1', name: 'Kite', primary_domain: 'kite.io', estimated_num_employees: 30 } });
    const p = await enrichCompany('k'.repeat(20), { domain: 'kite.io' });
    expect(calls[0].url).toBe('https://api.apollo.io/api/v1/organizations/enrich?domain=kite.io');
    expect(p).toMatchObject({ name: 'Kite', domain: 'kite.io', employees: 30 });
  });

  it('is null when Apollo has no such company', async () => {
    respond(200, { organization: null });
    await expect(enrichCompany('k'.repeat(20), { domain: 'nobody.example' })).resolves.toBeNull();
  });

  it('searches by name, de-duplicating domains', async () => {
    respond(200, { organizations: [
      { id: 'a', name: 'Kite', primary_domain: 'kite.io' },
      { id: 'b', name: 'Kite Inc', primary_domain: 'kite.io' },
      { id: 'c', name: 'No domain' },
    ] });
    const list = await searchCompanies('k'.repeat(20), 'Kite');
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ q_organization_name: 'Kite', per_page: 6 });
    expect(list.map((c) => c.name)).toEqual(['Kite']);
  });

  it('asks for decision makers at a domain', async () => {
    respond(200, { people: [{ id: 'p1abcdef', first_name: 'Asha', last_name_obfuscated: 'R***', title: 'CEO' }], total_entries: 1 });
    const out = await findPeople('k'.repeat(20), { domain: 'kite.io' });
    const body = JSON.parse(calls[0].init.body);
    expect(calls[0].url).toBe('https://api.apollo.io/api/v1/mixed_people/api_search');
    expect(body.q_organization_domains_list).toEqual(['kite.io']);
    expect(body.person_seniorities).toContain('founder');
    expect(out).toEqual({ people: [{ id: 'p1abcdef', name: 'Asha R***', title: 'CEO', has_email: false }], total: 1 });
  });

  it('reveals a person without personal emails', async () => {
    respond(200, { person: { id: 'p1abcdef', name: 'Asha Raman', email: 'asha@kite.io', email_status: 'verified' } });
    const p = await revealPerson('k'.repeat(20), 'p1abcdef');
    expect(calls[0].url).toBe('https://api.apollo.io/api/v1/people/match?id=p1abcdef&reveal_personal_emails=false');
    expect(p.email).toBe('asha@kite.io');
  });

  it('says so when Apollo cannot be reached', async () => {
    __setFetch(async () => { throw new TypeError('fetch failed'); });
    await expect(checkKey('k'.repeat(20))).rejects.toMatchObject({ code: 'unreachable', status: 502 });
  });
});
