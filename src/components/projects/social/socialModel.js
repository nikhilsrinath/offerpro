/* ══════════════════════════════════════════════════════════════════════════
   Social (0119): the words and shapes the pages share. Platforms, the
   approval flow of a post, campaign and launch kinds, and the small date
   sums the calendar and the figures need. No React here.
   ══════════════════════════════════════════════════════════════════════════ */

/** The platforms a post can go to, and a project can have figures for. The
    colour is the platform's own, used only as a small dot beside its name. */
export const PLATFORMS = [
    { id: 'instagram', label: 'Instagram', color: '#D6249F' },
    { id: 'facebook', label: 'Facebook', color: '#1877F2' },
    { id: 'linkedin', label: 'LinkedIn', color: '#0A66C2' },
    { id: 'x', label: 'X', color: '#71717A' },
    { id: 'youtube', label: 'YouTube', color: '#FF0000' },
    { id: 'google_business', label: 'Google Business', color: '#34A853' },
    { id: 'whatsapp', label: 'WhatsApp', color: '#25D366' },
    { id: 'threads', label: 'Threads', color: '#52525B' },
    { id: 'pinterest', label: 'Pinterest', color: '#E60023' },
    { id: 'other', label: 'Other', color: '#94A3B8' },
];
const PLATFORM_BY_ID = Object.fromEntries(PLATFORMS.map((p) => [p.id, p]));
export const platformOf = (id) => PLATFORM_BY_ID[id] || PLATFORM_BY_ID.other;

/** A post's place in the approval flow, in order. */
export const POST_STATUSES = [
    { id: 'idea', label: 'Idea', tone: 'mute' },
    { id: 'draft', label: 'Draft', tone: 'neutral' },
    { id: 'review', label: 'Internal review', tone: 'warn' },
    { id: 'client_review', label: 'Client approval', tone: 'warn' },
    { id: 'scheduled', label: 'Scheduled', tone: 'accent' },
    { id: 'published', label: 'Published', tone: 'up' },
];
export const postStatusOf = (id) => POST_STATUSES.find((s) => s.id === id) || POST_STATUSES[0];
/** Waiting on someone to say yes: the team, or the client. */
export const awaitingApproval = (p) => p.status === 'review' || p.status === 'client_review';

export const CAMPAIGN_KINDS = [
    { id: 'social', label: 'Social Media' },
    { id: 'email', label: 'Email' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'offline', label: 'Offline' },
    { id: 'influencer', label: 'Influencer' },
];
export const campaignKindOf = (id) => CAMPAIGN_KINDS.find((k) => k.id === id) || CAMPAIGN_KINDS[0];
export const CAMPAIGN_STATUSES = [
    { id: 'planned', label: 'Planned', tone: 'mute' },
    { id: 'live', label: 'Live', tone: 'up' },
    { id: 'paused', label: 'Paused', tone: 'warn' },
    { id: 'completed', label: 'Completed', tone: 'neutral' },
    { id: 'cancelled', label: 'Cancelled', tone: 'mute' },
];
export const campaignStatusOf = (id) => CAMPAIGN_STATUSES.find((s) => s.id === id) || CAMPAIGN_STATUSES[0];

export const LAUNCH_KINDS = [
    { id: 'product', label: 'Product' },
    { id: 'service', label: 'Service' },
];
export const LAUNCH_STATUSES = [
    { id: 'planning', label: 'Planning', tone: 'mute' },
    { id: 'ready', label: 'Ready', tone: 'accent' },
    { id: 'launched', label: 'Launched', tone: 'up' },
    { id: 'reviewed', label: 'Reviewed', tone: 'neutral' },
    { id: 'cancelled', label: 'Cancelled', tone: 'mute' },
];
export const launchStatusOf = (id) => LAUNCH_STATUSES.find((s) => s.id === id) || LAUNCH_STATUSES[0];

/** What a new launch's checklist starts with; every item can be renamed or removed. */
export const DEFAULT_CHECKLIST = [
    'Target customer and problem agreed',
    'Positioning and key message written',
    'Pricing and offer final',
    'Landing page or listing live',
    'Launch creatives approved',
    'Sales and support briefed',
    'Launch campaigns scheduled',
    'Success measures set',
].map((text) => ({ text, done: false }));

/** Share of a launch's checklist that is done, 0–1; null when it has none. */
export function readiness(launch) {
    const list = Array.isArray(launch?.checklist) ? launch.checklist.filter((c) => c && c.text) : [];
    if (!list.length) return null;
    return list.filter((c) => c.done).length / list.length;
}

/* ── dates ───────────────────────────────────────────────────────────────── */

const pad2 = (n) => String(n).padStart(2, '0');
/** A Date as YYYY-MM-DD in local time. */
export const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** The local day a stored timestamp falls on, or null. */
export const dayOf = (iso) => (iso ? dayKey(new Date(iso)) : null);
/** YYYY-MM-01 of the month a Date is in. */
export const monthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
/** The month before YYYY-MM-01. */
export function prevMonth(key) {
    const [y, m] = key.split('-').map(Number);
    return m === 1 ? `${y - 1}-12-01` : `${y}-${pad2(m - 1)}-01`;
}
/** "Nov 2026" for YYYY-MM-01. */
export function monthLabel(key) {
    const [y, m] = String(key).split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

/**
 * The weeks of a month grid, Monday first: 5 or 6 rows of 7 Dates, padded
 * with the days of the months either side.
 */
export function monthGrid(year, month) {
    const first = new Date(year, month, 1);
    const lead = (first.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - lead);
    const days = new Date(year, month + 1, 0).getDate();
    const rows = Math.ceil((lead + days) / 7);
    return Array.from({ length: rows }, (_, w) => Array.from({ length: 7 }, (__, d) => (
        new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d))));
}

/** A <input type="datetime-local"> value for a stored timestamp, and back. */
export function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${dayKey(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
export function fromLocalInput(v) {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "10:30" for a stored timestamp. */
export const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');

/* ── figures ─────────────────────────────────────────────────────────────── */

/** Whole numbers with Indian grouping; a dash for none. */
export const count = (n) => (n == null || n === '' ? '-' : Number(n).toLocaleString('en-IN'));

/** Engagement rate, engagements ÷ reach, as a percentage with two decimals. */
export function engagementRate(m) {
    if (!m || !m.reach || m.engagements == null) return null;
    return (Number(m.engagements) / Number(m.reach)) * 100;
}

/** The change from `before` to `now`, as "+12.50%" / "-3.00%", or null. */
export function change(now, before) {
    if (now == null || before == null || Number(before) === 0) return null;
    const pct = ((Number(now) - Number(before)) / Number(before)) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

/**
 * The latest month with any figures, and each platform's row for it and for
 * the month before: { month, rows: [{ platform, now, before }] }.
 */
export function latestFigures(metrics) {
    if (!metrics.length) return { month: null, rows: [] };
    const month = metrics.reduce((a, m) => (m.period > a ? m.period : a), metrics[0].period);
    const before = prevMonth(month);
    const platforms = [...new Set(metrics.map((m) => m.platform))];
    const rows = platforms.map((platform) => ({
        platform,
        now: metrics.find((m) => m.platform === platform && m.period === month) || null,
        before: metrics.find((m) => m.platform === platform && m.period === before) || null,
    })).filter((r) => r.now);
    return { month, rows };
}

/** Sum of one figure across rows, or null when none of them has it. */
export function sumOf(rows, key) {
    const vals = rows.map((r) => r?.[key]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, v) => a + Number(v), 0) : null;
}

/** A competitor's latest snapshot for a platform, or null. */
export function latestSnapshot(competitor, platform) {
    const list = (competitor?.snapshots || []).filter((s) => !platform || s.platform === platform);
    return list.reduce((a, s) => (!a || String(s.date) > String(a.date) ? s : a), null);
}

/** "Something went wrong" in words, for a save that the database refused. */
export function socialError(e) {
    const m = e?.message || String(e || '');
    if (/social_(posts|campaigns|launches|competitors|metrics)/.test(m) && /relation|schema cache|does not exist/.test(m)) {
        return 'Social is not set up on this database yet: migration 0119 has to be applied first.';
    }
    if (/social_metrics_one_per_month|duplicate key/.test(m)) return 'That platform already has figures for that month. Edit that row instead.';
    if (/social_campaigns_dates/.test(m)) return 'The end date is before the start date.';
    if (/row-level security|permission denied|42501/.test(m)) return 'You do not have permission to do that.';
    return m || 'That did not save. Try again.';
}
