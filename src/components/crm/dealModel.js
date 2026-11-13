// dealModel.js: the CRM's rules, with no React and no IO, so they are tested.
//
// One pipeline. A deal moves through STAGES while it is open; its STATE says
// how it ended (won, lost, abandoned) or that it is parked (suspended). The
// two are separate fields, as in every real CRM: a lost deal keeps the stage
// it reached, which is what a "where do we lose deals" report needs.

export const STAGES = [
    { id: 'lead',        label: 'Lead',        probability: 10 },
    { id: 'contacted',   label: 'Contacted',   probability: 20 },
    { id: 'qualified',   label: 'Qualified',   probability: 40 },
    { id: 'proposal',    label: 'Proposal',    probability: 60 },
    { id: 'negotiation', label: 'Negotiation', probability: 80 },
];

export const STATES = [
    { id: 'open',      label: 'Open',      tone: 'accent' },
    { id: 'won',       label: 'Won',       tone: 'up' },
    { id: 'lost',      label: 'Lost',      tone: 'down' },
    { id: 'abandoned', label: 'Abandoned', tone: 'mute' },
    { id: 'suspended', label: 'Suspended', tone: 'warn' },
];

export const PIPELINE_NAME = 'Sales Pipeline';

const STAGE_IDS = STAGES.map((s) => s.id);
export const stageIndex = (stage) => Math.max(0, STAGE_IDS.indexOf(stage));
export const stageLabel = (stage) => STAGES[stageIndex(stage)].label;
export const stateOf = (state) => STATES.find((s) => s.id === state) || STATES[0];

/** The probability a stage starts a deal on. Won is certain, a dead deal is 0. */
export function defaultProbability(stage, state = 'open') {
    if (state === 'won') return 100;
    if (state === 'lost' || state === 'abandoned') return 0;
    return STAGES[stageIndex(stage)].probability;
}

/** The probability to show: the one typed, or the stage's default. */
export function probabilityOf(deal) {
    if (deal.state === 'won') return 100;
    if (deal.state === 'lost' || deal.state === 'abandoned') return 0;
    return deal.probability == null || deal.probability === '' ? defaultProbability(deal.stage) : Number(deal.probability);
}

/**
 * Each chevron's look for a deal: 'done' (passed), 'current', 'todo' (ahead),
 * 'lost' (where a lost/abandoned deal stopped). A won deal is done throughout.
 */
export function chevronStates(deal) {
    const at = stageIndex(deal.stage);
    return STAGES.map((s, i) => {
        if (deal.state === 'won') return 'done';
        if (i < at) return 'done';
        if (i > at) return 'todo';
        if (deal.state === 'lost' || deal.state === 'abandoned') return 'lost';
        return 'current';
    });
}

const monthKey = (d) => String(d || '').slice(0, 7);

/**
 * The strip above the list. Money is summed in the base currency only: a deal
 * in another currency is counted, but its value is not added to the totals
 * (`otherCurrency` says how many), so a total never mixes currencies.
 */
export function pipelineSummary(deals, { base = 'INR', today = new Date() } = {}) {
    const thisMonth = monthKey(today.toISOString());
    let openCount = 0, openValue = 0, weighted = 0, wonCount = 0, wonValue = 0, lostCount = 0, otherCurrency = 0;
    let overdue = 0;
    const todayIso = today.toISOString().slice(0, 10);
    for (const d of deals) {
        const sameCurrency = !d.currency || d.currency === base;
        const v = sameCurrency ? Number(d.value) || 0 : 0;
        if (!sameCurrency && d.value) otherCurrency += 1;
        if (d.state === 'open') {
            openCount += 1;
            openValue += v;
            weighted += (v * probabilityOf(d)) / 100;
            if (d.expected_close && d.expected_close < todayIso) overdue += 1;
        } else if (d.state === 'won' && monthKey(d.closed_on || d.state_changed_at) === thisMonth) {
            wonCount += 1;
            wonValue += v;
        } else if (d.state === 'lost' && monthKey(d.closed_on || d.state_changed_at) === thisMonth) {
            lostCount += 1;
        }
    }
    const closed = wonCount + lostCount;
    return {
        openCount, openValue, weighted, wonCount, wonValue, lostCount, overdue, otherCurrency,
        winRate: closed ? (wonCount / closed) * 100 : null,
    };
}

/** Free-text search over what a person would type to find a deal. */
export function matchesDeal(deal, term, clientName = '') {
    const q = String(term || '').trim().toLowerCase();
    if (!q) return true;
    const hay = [deal.name, clientName, deal.source, ...(deal.contacts || []).flatMap((c) => [c.name, c.email])]
        .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
}

/** The list's state filter: 'open' | 'won' | 'lost' | 'closed' | 'all' | 'starred'. */
export function filterDeals(deals, { state = 'open', owner = '', userId = null } = {}) {
    return deals.filter((d) => {
        if (owner && d.owner_id !== owner) return false;
        if (state === 'all') return true;
        if (state === 'starred') return !!userId && (d.starred_by || []).includes(userId);
        if (state === 'closed') return d.state !== 'open';
        return d.state === state;
    });
}

const SORTERS = {
    name: (d) => String(d.name || '').toLowerCase(),
    value: (d) => Number(d.value) || 0,
    close: (d) => d.expected_close || '9999-12-31',
    stage: (d) => stageIndex(d.stage),
    probability: (d) => probabilityOf(d),
    created: (d) => d.created_at || '',
};

export function sortDeals(deals, sort) {
    const key = SORTERS[sort?.key] ? sort.key : 'created';
    const dir = sort?.dir === 'asc' ? 1 : -1;
    const get = SORTERS[key];
    return deals.slice().sort((a, b) => {
        const x = get(a), y = get(b);
        if (x < y) return -dir;
        if (x > y) return dir;
        return String(a.id).localeCompare(String(b.id));
    });
}

/** What a stage change writes. Moving an open deal keeps a typed probability
    only if someone set it by hand to something other than the old default. */
export function stageChange(deal, stage) {
    const wasDefault = deal.probability == null || Number(deal.probability) === defaultProbability(deal.stage);
    return { stage, ...(wasDefault ? { probability: defaultProbability(stage) } : {}) };
}

/** What a state change writes. */
export function stateChange(deal, state, lostReason = '') {
    const out = { state };
    if (state === 'won') out.probability = 100;
    else if (state === 'lost' || state === 'abandoned') { out.probability = 0; out.lost_reason = lostReason || null; }
    else if (state === 'open' && (deal.state === 'lost' || deal.state === 'abandoned' || deal.state === 'won')) {
        out.probability = defaultProbability(deal.stage);
        out.lost_reason = null;
    }
    return out;
}

/** A copy for Clone: same terms, back to open, nothing linked. */
export function cloneDeal(deal) {
    return {
        name: `${deal.name} (Copy)`,
        client_id: deal.client_id, owner_id: deal.owner_id,
        value: deal.value, currency: deal.currency, probability: deal.probability,
        expected_close: deal.expected_close, stage: deal.stage, state: 'open',
        source: deal.source, description: deal.description,
        contacts: deal.contacts || [], quote_ids: [], starred_by: [], project_id: null,
    };
}

/** The tiles on the Related tab. */
export function relatedCounts(deal, activities) {
    const mine = activities.filter((a) => a.deal_id === deal.id);
    return {
        contacts: (deal.contacts || []).length,
        organisations: deal.client_id ? 1 : 0,
        quotes: (deal.quote_ids || []).length,
        notes: mine.filter((a) => a.kind === 'note').length,
        tasks: mine.filter((a) => a.kind === 'task').length,
        events: mine.filter((a) => a.kind === 'event').length,
    };
}

/** The open tasks across deals that are due today or overdue. */
export function dueTasks(activities, today = new Date()) {
    const end = new Date(today); end.setHours(23, 59, 59, 999);
    return activities.filter((a) => a.kind === 'task' && !a.done && a.due_at && new Date(a.due_at) <= end);
}

/** A contact as stored on the deal. */
export function normaliseContact(c) {
    return {
        name: String(c.name || '').trim(),
        title: String(c.title || c.designation || '').trim(),
        email: String(c.email || '').trim(),
        phone: String(c.phone || '').trim(),
        linked_at: c.linked_at || new Date().toISOString().slice(0, 10),
    };
}

export const contactKey = (c) => (String(c.email || '').toLowerCase() || String(c.name || '').toLowerCase());

/** The client's own contacts that are not on the deal yet, for Add Contact. */
export function availableContacts(client, deal) {
    if (!client) return [];
    const have = new Set((deal.contacts || []).map(contactKey));
    const list = [
        client.person_name ? { name: client.person_name, email: client.email, phone: client.phone, title: client.contact_designation } : null,
        ...(Array.isArray(client.contacts) ? client.contacts : []),
    ].filter((c) => c && (c.name || c.email));
    const seen = new Set();
    return list.map(normaliseContact).filter((c) => {
        const k = contactKey(c);
        if (!k || have.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}
