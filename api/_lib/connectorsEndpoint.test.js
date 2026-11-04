import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeDb } from './agent/testing/fakeDb.js';

/*
 * /api/connectors (kept under api/_lib: Vercel would deploy a file directly
 * in api/ as a function). Sign-in, membership, the connector tables and
 * Apollo are stubbed. What is pinned here: who may connect and who may look
 * up; that the key never goes back to the browser; that saving details onto
 * a client is done as the person and fills only blank fields; and that the
 * automatic fill-in never looks a company up twice.
 */

let role = 'admin';
let connector = null;          // the org_connectors row, or null
let secret = null;
const events = [];
let userDb = null;
const apollo = { checkKey: vi.fn(), enrichCompany: vi.fn(), searchCompanies: vi.fn(), findPeople: vi.fn(), revealPerson: vi.fn() };

vi.mock('./auth.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    requireUser: async () => ({ id: 'u-1', email: 'a@b.co' }),
    requireOrgRole: async (_u, orgId, min) => {
      const rank = { viewer: 0, member: 1, admin: 2, owner: 3 };
      if (orgId !== 'org-1') throw new real.HttpError(403, 'Not a member of this organization');
      if (rank[role] < rank[min]) throw new real.HttpError(403, `Requires ${min} access`);
      return { role };
    },
  };
});
vi.mock('./connectorStore.js', () => ({
  listConnectors: async () => (connector ? [connector] : []),
  readConnector: async () => connector,
  readSecret: async () => secret,
  saveConnector: async (_o, provider, { secret: s, settings }) => {
    secret = s;
    connector = { provider, settings, secret_hint: s.slice(-4), connected_at: 'now' };
  },
  updateConnector: async (_o, _p, patch) => { connector = { ...connector, ...patch }; },
  removeConnector: async () => { connector = null; secret = null; },
  logEvent: async (_o, _p, e) => { events.push(e); },
  recentEvents: async () => [],
  usageSince: async () => ({ days: 30, credits: 0, lookups: 0 }),
}));
vi.mock('./apolloApi.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, ...Object.fromEntries(Object.keys(apollo).map((k) => [k, (...a) => apollo[k](...a)])) };
});
vi.mock('./agent/db.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, userClient: () => userDb };
});
vi.mock('./supabaseAdmin.js', () => ({ supabaseAdmin: () => ({}) }));

const { default: handler } = await import('../connectors.js');

function call(method, body, query = '') {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; },
    };
    handler({ method, url: `/api/connectors${query}`, headers: { authorization: 'Bearer t' }, body }, res);
  });
}
const post = (body) => call('POST', { org_id: 'org-1', provider: 'apollo', ...body });

const PROFILE = { source: 'apollo', name: 'Kite Labs', domain: 'kitelabs.in', website: 'https://kitelabs.in/', industry: 'Software', employees: 40, growth_6m: 0.2, country: 'India', state: 'Karnataka', address: 'Bengaluru' };

beforeEach(() => {
  role = 'admin'; connector = null; secret = null; events.length = 0;
  Object.values(apollo).forEach((f) => f.mockReset());
  userDb = fakeDb({
    clients: [
      { id: '11111111-1111-4111-8111-111111111111', org_id: 'org-1', name: 'Kite', email: 'ravi@kitelabs.in', website: null, industry: 'Typed by hand', address: null, country_code: null, state: null, contacts: [], company_profile: null },
      { id: '22222222-2222-4222-8222-222222222222', org_id: 'org-1', name: 'Solo', email: 'solo@gmail.com', website: null, industry: null, address: null, country_code: null, state: null, contacts: [], company_profile: null },
    ],
  });
});

describe('connecting', () => {
  it('an admin connects with a key Apollo accepts; the key never comes back', async () => {
    apollo.checkKey.mockResolvedValue(true);
    const r = await post({ action: 'connect', api_key: ' abcdEFGH1234wxyz \n', settings: { auto_fill: true, junk: 1 } });
    expect(r.status).toBe(200);
    expect(apollo.checkKey).toHaveBeenCalledWith('abcdEFGH1234wxyz');
    expect(secret).toBe('abcdEFGH1234wxyz');
    expect(r.body.connectors).toEqual([expect.objectContaining({ provider: 'apollo', connected: true, settings: { auto_fill: true }, key_hint: 'wxyz' })]);
    expect(JSON.stringify(r.body)).not.toContain('abcdEFGH');
  });

  it('a key Apollo refuses is not stored, and the failure is logged', async () => {
    const { ApolloError } = await import('./apolloApi.js');
    apollo.checkKey.mockRejectedValue(new ApolloError(400, 'Apollo did not accept this API key.', 'bad_key'));
    const r = await post({ action: 'connect', api_key: 'abcdEFGH1234wxyz' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/did not accept/);
    expect(connector).toBeNull();
    expect(events).toEqual([expect.objectContaining({ action: 'connect', ok: false })]);
  });

  it('a member cannot connect, change settings or disconnect', async () => {
    role = 'member';
    for (const action of ['connect', 'settings', 'disconnect', 'test', 'logs']) {
      const r = await post({ action, api_key: 'abcdEFGH1234wxyz' });
      expect(r.status).toBe(403);
    }
    expect(apollo.checkKey).not.toHaveBeenCalled();
  });

  it('members see that it is connected, but not which key', async () => {
    connector = { provider: 'apollo', settings: { auto_fill: false }, secret_hint: 'wxyz' };
    role = 'viewer';
    const r = await call('GET', undefined, '?org_id=org-1');
    expect(r.body.connectors[0]).toMatchObject({ provider: 'apollo', connected: true });
    expect(r.body.connectors[0]).not.toHaveProperty('key_hint');
  });

  it('disconnecting removes the key', async () => {
    connector = { provider: 'apollo', settings: {} }; secret = 'abcdEFGH1234wxyz';
    const r = await post({ action: 'disconnect' });
    expect(r.body.connectors).toEqual([]);
    expect(secret).toBeNull();
  });
});

describe('looking up', () => {
  beforeEach(() => { connector = { provider: 'apollo', settings: { auto_fill: true } }; secret = 'abcdEFGH1234wxyz'; });

  it('a viewer cannot spend credits', async () => {
    role = 'viewer';
    const r = await post({ action: 'company', domain: 'kitelabs.in' });
    expect(r.status).toBe(403);
    expect(apollo.enrichCompany).not.toHaveBeenCalled();
  });

  it('nothing is looked up when Apollo is not connected', async () => {
    connector = null; role = 'member';
    const r = await post({ action: 'company', domain: 'kitelabs.in' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not connected/);
  });

  it('a website looks one company up; a name alone searches', async () => {
    role = 'member';
    apollo.enrichCompany.mockResolvedValue(PROFILE);
    let r = await post({ action: 'company', website: 'https://www.kitelabs.in/x' });
    expect(apollo.enrichCompany).toHaveBeenCalledWith('abcdEFGH1234wxyz', { domain: 'kitelabs.in', name: undefined });
    expect(r.body.company).toEqual(PROFILE);
    expect(events.at(-1)).toMatchObject({ action: 'company', credits: 1, ok: true });

    apollo.searchCompanies.mockResolvedValue([{ name: 'Kite Labs', domain: 'kitelabs.in' }]);
    r = await post({ action: 'company', name: 'Kite', email: 'me@gmail.com' });
    expect(apollo.searchCompanies).toHaveBeenCalledWith('abcdEFGH1234wxyz', 'Kite');
    expect(r.body.candidates).toHaveLength(1);
  });

  it('saves details on a client as the person, filling only blank fields', async () => {
    role = 'member';
    apollo.enrichCompany.mockResolvedValue(PROFILE);
    const r = await post({ action: 'enrich', kind: 'client', id: '11111111-1111-4111-8111-111111111111' });
    expect(r.status).toBe(200);
    expect(apollo.enrichCompany).toHaveBeenCalledWith('abcdEFGH1234wxyz', { domain: 'kitelabs.in' });
    const update = userDb.writes.find((w) => w.op === 'update');
    expect(update.table).toBe('clients');
    expect(update.patch).toEqual({ company_profile: PROFILE, website: 'https://kitelabs.in', address: 'Bengaluru', country_code: 'IN', state: 'Karnataka' });
    expect(update.patch).not.toHaveProperty('industry');
    expect(r.body.filled).toEqual(['website', 'address', 'country_code', 'state']);
  });

  it('the automatic fill-in skips personal mail and companies already filled', async () => {
    role = 'member';
    let r = await post({ action: 'enrich', kind: 'client', id: '22222222-2222-4222-8222-222222222222', auto: true });
    expect(r.body.skipped).toBe('no_domain');
    userDb = fakeDb({ clients: [{ id: '11111111-1111-4111-8111-111111111111', org_id: 'org-1', name: 'Kite', email: 'a@kitelabs.in', company_profile: PROFILE }] });
    r = await post({ action: 'enrich', kind: 'client', id: '11111111-1111-4111-8111-111111111111', auto: true });
    expect(r.body.skipped).toBe('already_filled');
    expect(apollo.enrichCompany).not.toHaveBeenCalled();
  });

  it('a role that cannot edit the client saves nothing', async () => {
    role = 'member';
    apollo.enrichCompany.mockResolvedValue(PROFILE);
    userDb = fakeDb({ clients: [{ id: '11111111-1111-4111-8111-111111111111', org_id: 'org-1', name: 'Kite', email: 'a@kitelabs.in', company_profile: null }] }, { deny: { clients: ['update'] } });
    const r = await post({ action: 'enrich', kind: 'client', id: '11111111-1111-4111-8111-111111111111' });
    expect(r.status).toBe(403);
  });

  it('people and reveal pass a valid id only', async () => {
    role = 'member';
    apollo.findPeople.mockResolvedValue({ people: [], total: 0 });
    expect((await post({ action: 'people' })).status).toBe(400);
    expect((await post({ action: 'people', domain: 'kitelabs.in' })).status).toBe(200);
    expect((await post({ action: 'reveal', person_id: '../../x' })).status).toBe(400);
    apollo.revealPerson.mockResolvedValue({ id: 'p1abcdef', name: 'Asha', email: 'asha@kitelabs.in' });
    const r = await post({ action: 'reveal', person_id: 'p1abcdef' });
    expect(r.body.person.email).toBe('asha@kitelabs.in');
    expect(events.at(-1)).toMatchObject({ action: 'reveal', credits: 1 });
  });

  it('an unknown connector is refused', async () => {
    const r = await call('POST', { org_id: 'org-1', provider: 'razorpay', action: 'connect' });
    expect(r.status).toBe(400);
  });
});
