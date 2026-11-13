/* ══════════════════════════════════════════════════════════════════════════
   Notes: the person's own notes (workspace_notes), Google Keep style.

   Pure. A note is text or a checklist, has a colour from the brand palette
   (never an off-brand hue), can be pinned, archived, labelled and linked to a
   project or a client.
   ══════════════════════════════════════════════════════════════════════════ */

/** The note colours: each a tint of one of the palette's three colours, or none. */
export const NOTE_COLORS = [
    { id: 'default', label: 'Default' },
    { id: 'blue', label: 'Light Blue' },
    { id: 'teal', label: 'Teal' },
    { id: 'navy', label: 'Navy' },
    { id: 'grey', label: 'Grey' },
];

/** Background, border and the swatch for a note colour, from theme tokens. */
export function noteTone(t, color) {
    const mix = (c, pct) => `color-mix(in srgb, ${c} ${pct}%, ${t.card})`;
    switch (color) {
        case 'blue': return { bg: mix(t.soft, t.isDark ? 22 : 100), line: mix(t.soft, t.isDark ? 40 : 100), swatch: t.soft };
        case 'teal': return { bg: mix(t.teal, t.isDark ? 18 : 12), line: mix(t.teal, t.isDark ? 34 : 28), swatch: mix(t.teal, 55) };
        case 'navy': return { bg: mix(t.navy, t.isDark ? 40 : 8), line: mix(t.navy, t.isDark ? 60 : 20), swatch: mix(t.navy, t.isDark ? 70 : 45) };
        case 'grey': return { bg: t.panelAlt, line: t.lineStrong, swatch: t.lineStrong };
        default: return { bg: t.card, line: t.line, swatch: t.card };
    }
}

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'i' + Math.random().toString(36).slice(2));

/** A checklist item. */
export const checkItem = (text = '', done = false) => ({ id: newId(), text, done });

/** Text → checklist (one item per non-empty line) and back. */
export function toChecklist(body) {
    return String(body || '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\[[ xX]?\])\s*/, '').trim()).filter(Boolean).map((l) => checkItem(l));
}
export function toText(items) {
    return (items || []).map((i) => i.text).filter((x) => String(x).trim()).join('\n');
}

/** A note with nothing in it is not kept. */
export function isBlank(n) {
    return !String(n?.title || '').trim() && !String(n?.body || '').trim()
        && !(n?.items || []).some((i) => String(i.text || '').trim());
}

/** All labels in use, A–Z, with how many notes carry each. */
export function labelsOf(notes) {
    const m = new Map();
    (notes || []).forEach((n) => (n.labels || []).forEach((l) => {
        const k = String(l).trim();
        if (k) m.set(k, (m.get(k) || 0) + 1);
    }));
    return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => a.label.localeCompare(b.label));
}

/** Labels cleaned for saving: trimmed, no repeats (case-insensitive), at most 20. */
export function cleanLabels(list) {
    const seen = new Set();
    const out = [];
    (list || []).forEach((l) => {
        const v = String(l || '').trim().slice(0, 40);
        if (!v || seen.has(v.toLowerCase())) return;
        seen.add(v.toLowerCase());
        out.push(v);
    });
    return out.slice(0, 20);
}

const hay = (n) => [n.title, n.body, ...(n.items || []).map((i) => i.text), ...(n.labels || [])].join('\n').toLowerCase();

/**
 * The notes a view shows: { pinned, others } for Notes, { others } for the
 * Archive. Most recently changed first within each.
 */
export function viewNotes(notes, { archived = false, label = '', query = '' } = {}) {
    const q = String(query || '').trim().toLowerCase();
    const list = (notes || [])
        .filter((n) => (archived ? !!n.archived_at : !n.archived_at))
        .filter((n) => !label || (n.labels || []).includes(label))
        .filter((n) => !q || hay(n).includes(q))
        .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    if (archived) return { pinned: [], others: list };
    return { pinned: list.filter((n) => n.pinned), others: list.filter((n) => !n.pinned) };
}

/** "3 of 5 done". */
export function checklistProgress(items) {
    const all = (items || []).filter((i) => String(i.text || '').trim());
    return { done: all.filter((i) => i.done).length, total: all.length };
}

/** "Edited 2h ago" style stamp for a note. */
export function editedText(ts, now = new Date()) {
    if (!ts) return '';
    const min = Math.floor((now - new Date(ts)) / 60000);
    if (min < 1) return 'Edited just now';
    if (min < 60) return `Edited ${min}m ago`;
    if (min < 1440) return `Edited ${Math.floor(min / 60)}h ago`;
    const d = new Date(ts);
    return 'Edited ' + d.toLocaleDateString('en-GB', d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}
