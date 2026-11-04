/**
 * Connectors: /api/connectors — every outside service Opstead connects to, in
 * one function (Vercel Hobby allows twelve).
 *
 *   GET  ?org_id=                 any member: which connectors are connected,
 *                                 their settings, and (owner/admin) the key's
 *                                 last four characters
 *   POST { org_id, provider, action, … }
 *
 *   provider 'apollo'
 *     connect     owner/admin   { api_key, settings: { auto_fill } } checks the
 *                               key with Apollo, then stores it encrypted
 *     settings    owner/admin   { settings: { auto_fill } }
 *     test        owner/admin   checks the stored key again
 *     disconnect  owner/admin   deletes the key; the logs stay
 *     logs        owner/admin   recent lookups and 30-day credit use
 *     company     member+       { domain | website | email | name } → one
 *                               company's details, or (a name alone) the
 *                               companies it could be. Writes nothing.
 *     enrich      member+       { kind: 'client'|'vendor', id, domain? }
 *                               looks the record's company up and saves the
 *                               details on it, filling only blank fields.
 *                               The write is made AS the person (their token),
 *                               so the clients/vendors permissions apply.
 *     people      member+       { domain | apollo_id } decision makers: names
 *                               and titles (free in Apollo)
 *     reveal      member+       { person_id } a person's work email and
 *                               LinkedIn (uses Apollo credits)
 *
 * Viewers cannot look anything up: every lookup spends the company's Apollo
 * credits. The key never leaves the server and is never sent back.
 */
import { requireUser, requireOrgRole, HttpError, sendError, readJsonBody } from './_lib/auth.js';
import { supabaseAdmin } from './_lib/supabaseAdmin.js';
import { userClient, bearerToken, friendlyDbError } from './_lib/agent/db.js';
import {
  listConnectors, readConnector, readSecret, saveConnector, updateConnector, removeConnector,
  logEvent, recentEvents, usageSince,
} from './_lib/connectorStore.js';
import { checkKey, enrichCompany, searchCompanies, findPeople, revealPerson, ApolloError } from './_lib/apolloApi.js';
import { PROVIDER as APOLLO, domainOf, domainForRecord, blanksToFill, makeCountryCode } from '../src/shared/apollo.js';
import { ALL_COUNTRIES } from '../src/data/worldMap.js';

const PROVIDERS = new Set([APOLLO]);
const ADMIN_ACTIONS = new Set(['connect', 'settings', 'test', 'disconnect', 'logs']);

export default async function handler(req, res) {
  try {
    const user = await requireUser(req);
    if (req.method === 'GET') {
      const orgId = new URL(req.url, 'http://localhost').searchParams.get('org_id');
      const m = await requireOrgRole(user.id, orgId, 'viewer');
      return res.status(200).json({ success: true, role: m.role, connectors: await statusFor(orgId, m.role) });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const body = (await readJsonBody(req)) || {};
    const { org_id: orgId, provider, action } = body;
    if (!PROVIDERS.has(provider)) throw new HttpError(400, 'Unknown connector');
    const m = await requireOrgRole(user.id, orgId, ADMIN_ACTIONS.has(action) ? 'admin' : 'member');
    const ctx = { req, user, orgId, role: m.role, body };

    const out = await apollo(action, ctx);
    return res.status(200).json({ success: true, role: m.role, ...out });
  } catch (err) {
    return sendError(res, err, 'api/connectors');
  }
}

const isAdmin = (role) => role === 'owner' || role === 'admin';

async function statusFor(orgId, role) {
  const rows = await listConnectors(orgId);
  return rows.map((r) => ({
    provider: r.provider,
    connected: true,
    settings: r.settings || {},
    connected_at: r.connected_at,
    last_used_at: r.last_used_at,
    last_error: r.last_error,
    // Which key is on file matters to whoever manages it, nobody else.
    ...(isAdmin(role) ? { key_hint: r.secret_hint } : {}),
  }));
}

const cleanSettings = (s = {}) => ({ auto_fill: s.auto_fill === true });

/* ── Apollo ───────────────────────────────────────────────────────────────── */

async function apollo(action, ctx) {
  const { orgId, user, body } = ctx;
  const log = (entry) => logEvent(orgId, APOLLO, { userId: user.id, ...entry });

  if (action === 'connect') {
    // Apollo shows keys with no spaces; a paste often brings a newline along.
    const key = String(body.api_key || '').replace(/\s+/g, '');
    if (key.length < 12 || key.length > 200) throw new HttpError(400, 'Paste the whole API key from Apollo.');
    try {
      await checkKey(key);
    } catch (err) {
      await log({ action: 'connect', ok: false, detail: err.message });
      throw err;
    }
    const existing = await readConnector(orgId, APOLLO);
    await saveConnector(orgId, APOLLO, { secret: key, settings: cleanSettings(body.settings ?? existing?.settings), userId: user.id });
    await log({ action: 'connect', detail: existing ? 'Replaced the API key.' : 'Connected Apollo.io.' });
    return { connectors: await statusFor(orgId, ctx.role) };
  }

  const row = await readConnector(orgId, APOLLO);
  if (!row) throw new HttpError(400, 'Apollo.io is not connected. An owner or admin can connect it in AI → Connectors.');

  if (action === 'settings') {
    const settings = cleanSettings(body.settings);
    await updateConnector(orgId, APOLLO, { settings });
    await log({ action: 'settings', detail: settings.auto_fill ? 'New clients and leads are filled in automatically.' : 'Company details are looked up only when someone asks.' });
    return { connectors: await statusFor(orgId, ctx.role) };
  }

  if (action === 'disconnect') {
    await removeConnector(orgId, APOLLO);
    await log({ action: 'disconnect', detail: 'Disconnected Apollo.io and deleted the API key.' });
    return { connectors: await statusFor(orgId, ctx.role) };
  }

  if (action === 'logs') {
    const [events, usage] = await Promise.all([recentEvents(orgId, APOLLO), usageSince(orgId, APOLLO)]);
    const names = await namesFor([...new Set(events.map((e) => e.actor_id).filter(Boolean))]);
    return { events: events.map((e) => ({ ...e, actor: names.get(e.actor_id) || null, actor_id: undefined })), usage };
  }

  const key = await readSecret(orgId, APOLLO);
  // Every call below reaches Apollo; remember whether it worked, so the
  // panel can say "Apollo refused the key on 3 Nov" without a test.
  const track = async (fn, entry) => {
    try {
      const result = await fn();
      await updateConnector(orgId, APOLLO, { last_used_at: new Date().toISOString(), last_error: null });
      await log({ ok: true, ...(typeof entry === 'function' ? entry(result) : entry) });
      return result;
    } catch (err) {
      const message = err instanceof HttpError ? err.message : 'Apollo lookup failed.';
      if (err instanceof ApolloError && ['bad_key', 'not_allowed', 'no_credits'].includes(err.code)) {
        await updateConnector(orgId, APOLLO, { last_error: message }).catch(() => {});
      }
      await log({ ok: false, action: typeof entry === 'function' ? entry(null).action : entry.action, detail: message });
      throw err;
    }
  };

  if (action === 'test') {
    await track(() => checkKey(key), { action: 'test', detail: 'The API key works.' });
    return { connectors: await statusFor(orgId, ctx.role) };
  }

  if (action === 'company') {
    const domain = domainOf(body.domain) || domainOf(body.website) || domainOf(body.email);
    if (domain) {
      const company = await track(() => enrichCompany(key, { domain, name: body.name || undefined }), (c) => ({
        action: 'company', credits: 1,
        detail: c ? `Looked up ${c.name || domain} (${domain}).` : `Looked up ${domain}`,
      }));
      if (!company) throw new HttpError(404, `Apollo has no company at ${domain}.`);
      return { company };
    }
    const name = String(body.name || '').trim();
    if (name.length < 2) throw new HttpError(400, 'Enter the company’s website or a business email first. A name alone also works.');
    const candidates = await track(() => searchCompanies(key, name), (list) => ({
      action: 'search', credits: 1, detail: `Searched for “${name.slice(0, 80)}”${list ? `: ${list.length} found.` : ''}`,
    }));
    if (!candidates.length) throw new HttpError(404, `Apollo found no company called “${name}”. Try its website instead.`);
    return { candidates };
  }

  if (action === 'enrich') return enrichRecord(ctx, key, track);

  if (action === 'people') {
    const domain = domainOf(body.domain);
    const apolloId = typeof body.apollo_id === 'string' && /^[a-z0-9]{6,40}$/i.test(body.apollo_id) ? body.apollo_id : null;
    if (!domain && !apolloId) throw new HttpError(400, 'Look the company up first, so Apollo knows which company to search.');
    const found = await track(() => findPeople(key, { domain, apolloId }), (r) => ({
      action: 'people', credits: 0, detail: `Found ${r ? r.people.length : 0} decision makers at ${domain || 'the company'}.`,
    }));
    return found;
  }

  if (action === 'reveal') {
    const id = String(body.person_id || '');
    if (!/^[a-z0-9]{6,40}$/i.test(id)) throw new HttpError(400, 'Pick a person from the list.');
    const person = await track(() => revealPerson(key, id), (p) => ({
      action: 'reveal', credits: 1, detail: p ? `Revealed ${p.name || 'a contact'}${p.title ? `, ${p.title}` : ''}.` : 'Revealed a contact.',
    }));
    if (!person) throw new HttpError(404, 'Apollo has no details for that person.');
    return { person };
  }

  throw new HttpError(400, 'Unknown action');
}

/* ── saving a profile onto a client or vendor, as the person ─────────────── */

const RECORD = {
  client: { table: 'clients', cols: 'id, name, email, website, industry, address, country_code, state, contacts, company_profile', minimal: 'id, name, email, company_profile' },
  vendor: { table: 'vendors', cols: 'id, company_name, email, website, address, state, contacts, company_profile', minimal: 'id, company_name, email, company_profile' },
};

const countryCode = makeCountryCode(ALL_COUNTRIES);

async function enrichRecord(ctx, key, track) {
  const { body, orgId, req } = ctx;
  const spec = RECORD[body.kind];
  if (!spec) throw new HttpError(400, 'Unknown record type');
  if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) throw new HttpError(400, 'Missing record id');

  // Read and write as the person: what they cannot see or edit, this cannot either.
  const db = userClient(bearerToken(req));
  let { data: rec, error } = await db.from(spec.table).select(spec.cols).eq('org_id', orgId).eq('id', body.id).maybeSingle();
  if (error && ['42703', 'PGRST204'].includes(error.code)) {
    ({ data: rec, error } = await db.from(spec.table).select(spec.minimal).eq('org_id', orgId).eq('id', body.id).maybeSingle());
  }
  if (error && ['42703', 'PGRST204'].includes(error.code)) {
    throw new HttpError(503, 'Company details need migration 0106_connectors.sql on this database.');
  }
  if (error) throw new HttpError(400, friendlyDbError(error));
  if (!rec) throw new HttpError(404, 'That record could not be found, or your role cannot see it.');

  // Automatic fill-in never looks a company up twice.
  if (body.auto && rec.company_profile) return { skipped: 'already_filled', company: rec.company_profile };

  const domain = domainOf(body.domain) || domainForRecord(rec);
  if (!domain) {
    if (body.auto) return { skipped: 'no_domain' };
    throw new HttpError(400, 'Add the company’s website or a business email (not Gmail or similar) first, so Apollo knows which company it is.');
  }

  const label = rec.name || rec.company_name || domain;
  const company = await track(() => enrichCompany(key, { domain }), (c) => ({
    action: body.auto ? 'auto_fill' : 'enrich', credits: 1,
    detail: c ? `${body.auto ? 'Filled in' : 'Updated'} ${label} from ${domain}.` : `Looked up ${domain} for ${label}.`,
  }));
  if (!company) {
    if (body.auto) return { skipped: 'not_found' };
    throw new HttpError(404, `Apollo has no company at ${domain}.`);
  }

  // Only blank fields; never what someone typed. Shapes differ per table.
  const asForm = body.kind === 'client'
    ? { website: rec.website, industry: rec.industry, clientAddress: rec.address, clientName: rec.name, country_code: rec.country_code, buyerState: rec.state }
    : { website: rec.website, address: rec.address, company_name: rec.company_name, state: rec.state };
  const fill = blanksToFill(asForm, company, body.kind, { countryCode });
  const patch = { company_profile: company };
  const has = (col) => col in rec;
  if (fill.website && has('website')) patch.website = fill.website;
  if (body.kind === 'client') {
    if (fill.industry && has('industry')) patch.industry = fill.industry;
    if (fill.clientAddress && has('address')) patch.address = fill.clientAddress;
    if (fill.country_code && has('country_code')) patch.country_code = fill.country_code;
    if (fill.buyerState && has('state')) patch.state = fill.buyerState;
  } else {
    if (fill.address && has('address')) patch.address = fill.address;
    if (fill.state && has('state')) patch.state = fill.state;
  }

  let { data: saved, error: werr } = await db.from(spec.table).update(patch).eq('org_id', orgId).eq('id', body.id).select('id');
  // A country Opstead's country list lacks: keep everything else.
  if (werr?.code === '23503' && patch.country_code) {
    delete patch.country_code;
    ({ data: saved, error: werr } = await db.from(spec.table).update(patch).eq('org_id', orgId).eq('id', body.id).select('id'));
  }
  if (werr) throw new HttpError(400, friendlyDbError(werr));
  if (!saved?.length) throw new HttpError(403, 'Your role cannot edit this record, so the details were not saved.');

  const filled = Object.keys(patch).filter((k) => k !== 'company_profile');
  return { company, filled };
}

/** Names for the people in the logs: their profile name, else their email. */
async function namesFor(ids) {
  const out = new Map();
  await Promise.all(ids.slice(0, 25).map(async (id) => {
    try {
      const { data } = await supabaseAdmin().auth.admin.getUserById(id);
      const u = data?.user;
      if (u) out.set(id, u.user_metadata?.full_name || u.user_metadata?.name || u.email || null);
    } catch { /* unnamed */ }
  }));
  return out;
}
