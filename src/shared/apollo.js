/**
 * Apollo.io, the parts both sides need: the browser to show and fill, the
 * server (api/_lib/apolloApi.js) to ask Apollo and store what it found.
 *
 * Pure: no network, no database. Everything Apollo answers is cut down here
 * to `company_profile`, the shape stored on clients and vendors (0106), so
 * nothing else in Opstead depends on Apollo's own field names.
 */

export const PROVIDER = 'apollo';

/* ── domains ──────────────────────────────────────────────────────────────── */

// A personal mailbox says nothing about the company: never look these up.
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'hotmail.co.in', 'outlook.com', 'outlook.in', 'live.com', 'live.in', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'rediffmail.com', 'rediff.com', 'protonmail.com', 'proton.me',
  'pm.me', 'zohomail.com', 'zohomail.in', 'yandex.com', 'yandex.ru', 'mail.com', 'gmx.com', 'gmx.net',
  'inbox.com', 'tutanota.com', 'fastmail.com', 'hey.com', 'qq.com', '163.com', 'sify.com', 'indiatimes.com',
]);

export const isFreeMailDomain = (d) => FREE_MAIL.has(String(d || '').toLowerCase());

const HOST_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * The company's domain from a website, a URL or an email address:
 * "https://www.Acme.in/about" → "acme.in", "ravi@acme.in" → "acme.in".
 * Null for anything that is not a domain, and for personal mail (gmail…).
 */
export function domainOf(value) {
  let s = String(value ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('@') && !s.includes('/')) s = s.slice(s.lastIndexOf('@') + 1);
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');   // scheme
  s = s.replace(/^[^/@]*@/, '');                  // user:pass@
  s = s.split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '');
  s = s.replace(/^www\d?\./, '');
  if (!HOST_RE.test(s)) return null;
  if (isFreeMailDomain(s)) return null;
  return s;
}

/** The first usable domain among a record's website and email addresses. */
export function domainForRecord(r = {}) {
  const contacts = Array.isArray(r.contacts) ? r.contacts.map((c) => c?.email) : [];
  for (const v of [r.website, r.clientEmail, r.email, r.alt_contact, ...contacts]) {
    const d = domainOf(v);
    if (d) return d;
  }
  return null;
}

/* ── what Apollo answers, cut down to what Opstead keeps ─────────────────── */

const str = (v, max = 300) => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return t ? (t.length > max ? `${t.slice(0, max - 1)}…` : t) : null;
};
const int = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : null);
const ratio = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v) * 10000) / 10000 : null);
const url = (v) => {
  const s = str(v, 500);
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch { return null; }
};
const titleWords = (s) => (s ? s.replace(/\b([a-z])/g, (m) => m.toUpperCase()) : s);

/**
 * Apollo's `organization` → company_profile. Headcount growth is Apollo's
 * fraction (0.12 = 12% more people than six months ago), kept as given.
 */
export function normalizeOrganization(o, { now = new Date() } = {}) {
  if (!o || typeof o !== 'object') return null;
  const domain = domainOf(o.primary_domain) || domainOf(o.website_url);
  const keywords = Array.isArray(o.keywords) ? o.keywords.map((k) => str(k, 40)).filter(Boolean).slice(0, 12) : [];
  return {
    source: PROVIDER,
    fetched_at: now.toISOString(),
    apollo_id: str(o.id, 64),
    name: str(o.name, 200),
    domain,
    website: url(o.website_url) || (domain ? `https://${domain}` : null),
    linkedin_url: url(o.linkedin_url),
    logo_url: url(o.logo_url),
    industry: titleWords(str(o.industry, 80)),
    keywords,
    employees: int(o.estimated_num_employees),
    growth_6m: ratio(o.organization_headcount_six_month_growth),
    growth_12m: ratio(o.organization_headcount_twelve_month_growth),
    annual_revenue: int(o.annual_revenue),
    annual_revenue_printed: str(o.annual_revenue_printed, 30),
    total_funding_printed: str(o.total_funding_printed, 30),
    funding_stage: str(o.latest_funding_stage, 60),
    founded_year: int(o.founded_year),
    phone: str(o.primary_phone?.number || o.phone, 40),
    address: str(o.raw_address, 300),
    city: str(o.city, 80),
    state: str(o.state, 80),
    country: str(o.country, 80),
    description: str(o.short_description || o.seo_description, 600),
  };
}

/** One company from Apollo's company search, for "which one did you mean". */
export function normalizeCandidate(o) {
  if (!o || typeof o !== 'object') return null;
  const domain = domainOf(o.primary_domain) || domainOf(o.website_url);
  return {
    apollo_id: str(o.id, 64),
    name: str(o.name, 200),
    domain,
    logo_url: url(o.logo_url),
    linkedin_url: url(o.linkedin_url),
    place: [str(o.city, 80), str(o.country, 80)].filter(Boolean).join(', ') || null,
  };
}

/**
 * A person from Apollo's people search: the free search shows a first name,
 * an obscured last name and a title, never an email or phone.
 */
export function normalizePersonPreview(p) {
  if (!p || typeof p !== 'object' || !p.id) return null;
  return {
    id: str(p.id, 64),
    name: [str(p.first_name, 80), str(p.last_name_obfuscated || p.last_name, 80)].filter(Boolean).join(' ') || 'Unnamed',
    title: str(p.title, 120),
    has_email: p.has_email === true,
  };
}

/** A person after People Enrichment (uses Apollo credits): name, title, work email, LinkedIn. */
export function normalizePerson(p) {
  if (!p || typeof p !== 'object') return null;
  const email = str(p.email, 200);
  // Apollo marks guessed or unverifiable addresses; only a verified one is offered.
  const verified = !p.email_status || p.email_status === 'verified';
  return {
    id: str(p.id, 64),
    name: str(p.name, 160) || [str(p.first_name, 80), str(p.last_name, 80)].filter(Boolean).join(' ') || null,
    title: str(p.title, 120),
    email: email && verified && !/not_unlocked|email_not_unlocked/i.test(email) ? email : null,
    email_status: str(p.email_status, 30),
    linkedin_url: url(p.linkedin_url),
  };
}

/** Seniorities that make someone a decision maker, in Apollo's own words. */
export const DECISION_MAKERS = ['owner', 'founder', 'c_suite', 'partner', 'vp', 'head', 'director'];

/* ── using it in Opstead ─────────────────────────────────────────────────── */

/** "+12%" / "−4%" from a growth fraction; null when Apollo had none. */
export function growthText(g) {
  if (g === null || g === undefined || !Number.isFinite(Number(g))) return null;
  const pct = Math.round(Number(g) * 100);
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%`;
}

/** Fast hiring: headcount up by this fraction over six months. */
export const HIRING_FAST = 0.1;
export const isHiringFast = (p) => !!p && Number.isFinite(Number(p.growth_6m)) && Number(p.growth_6m) >= HIRING_FAST
  && (p.employees === null || p.employees === undefined || p.employees >= 5);

// Apollo writes countries the common way; Opstead's list uses the ISO names.
const COUNTRY_ALIASES = {
  'united states': 'US', usa: 'US', us: 'US', 'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB',
  china: 'CN', russia: 'RU', 'south korea': 'KR', 'korea, republic of': 'KR', 'north korea': 'KP', iran: 'IR',
  vietnam: 'VN', 'viet nam': 'VN', taiwan: 'TW', turkey: 'TR', czechia: 'CZ', tanzania: 'TZ',
  'ivory coast': 'CI', macedonia: 'MK', 'north macedonia': 'MK', uae: 'AE', laos: 'LA', syria: 'SY',
  moldova: 'MD', bolivia: 'BO', venezuela: 'VE', 'the netherlands': 'NL', 'hong kong sar': 'HK',
};

/**
 * A country name → ISO code function over Opstead's country list
 * (ALL_COUNTRIES from data/worldMap.js, passed in so this module stays small).
 */
export function makeCountryCode(list = []) {
  const byName = new Map(list.map(([code, name]) => [String(name).toLowerCase(), code]));
  return (name) => {
    const k = String(name || '').trim().toLowerCase();
    return k ? (COUNTRY_ALIASES[k] || byName.get(k) || null) : null;
  };
}

/** "1,250 people" for a headcount. */
export function sizeText(n) {
  if (!Number.isFinite(Number(n)) || n === null) return null;
  const k = Number(n);
  return `${k.toLocaleString('en-IN')} ${k === 1 ? 'person' : 'people'}`;
}

/**
 * The blank fields of a client or vendor that a profile can fill. Never
 * overwrites what someone typed: only an empty field gets a value.
 * `kind` is 'client' (Client form names) or 'vendor'.
 */
export function blanksToFill(record = {}, profile, kind = 'client', { countryCode = () => null } = {}) {
  if (!profile) return {};
  const empty = (v) => v === undefined || v === null || String(v).trim() === '';
  const out = {};
  if (empty(record.website) && profile.website) out.website = profile.website.replace(/\/$/, '');
  if (kind === 'client') {
    if (empty(record.industry) && profile.industry) out.industry = profile.industry;
    if (empty(record.clientAddress) && profile.address) out.clientAddress = profile.address;
    if (empty(record.clientName) && profile.name) out.clientName = profile.name;
    const cc = countryCode(profile.country);
    if (empty(record.country_code) && cc) out.country_code = cc;
    if (empty(record.buyerState) && profile.state && (cc === 'IN' || record.country_code === 'IN')) out.buyerState = profile.state;
  } else {
    if (empty(record.address) && profile.address) out.address = profile.address;
    if (empty(record.company_name) && profile.name) out.company_name = profile.name;
    if (empty(record.state) && profile.state && countryCode(profile.country) === 'IN') out.state = profile.state;
  }
  return out;
}
