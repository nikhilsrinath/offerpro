import { orgStore } from './orgStore';

/* ══════════════════════════════════════════════════════════════════════════
   What a vendor or product belongs to — the "Belongs to" dropdown on the
   Vendor Directory and Products Directory forms (0078).

   The dropdown has one value: GENERAL, INTERNAL, or a project id.

   A vendor is on a project through project_vendors (0074), so it also shows
   in that project's Vendor Directory; vendors.belongs_to is what it is when
   it is on no project. A product keeps its project in catalog_items.project_id,
   which takes precedence over its belongs_to.

   The pure helpers take the cached lists so they test without a store.
   ══════════════════════════════════════════════════════════════════════════ */

export const GENERAL = 'general';
export const INTERNAL = 'internal';

const isProject = (v) => !!v && v !== GENERAL && v !== INTERNAL;

/** The dropdown's value as columns: { belongs_to, project_id }. */
export const splitChoice = (choice) => (isProject(choice)
    ? { belongs_to: GENERAL, project_id: choice }
    : { belongs_to: choice === INTERNAL ? INTERNAL : GENERAL, project_id: null });

/** Project ids the vendor is on, in link order. */
export const vendorProjectIds = (vendorId, links = []) =>
    links.filter((l) => l.vendor_id === vendorId).map((l) => l.project_id);

/** What a vendor's dropdown starts on: its first project, else its belongs_to. */
export const vendorChoice = (vendor, links = []) =>
    vendorProjectIds(vendor?.id, links)[0] || (vendor?.belongs_to === INTERNAL ? INTERNAL : GENERAL);

/** What a product's dropdown starts on. */
export const productChoice = (product) =>
    product?.project_id || (product?.belongs_to === INTERNAL ? INTERNAL : GENERAL);

/**
 * Whether a row is in the list filter's scope: '' is everything, GENERAL and
 * INTERNAL the rows on no project with that belongs_to, anything else a project.
 * `projectIds` are the row's projects; `belongs` its belongs_to.
 */
export function inScope(scope, projectIds, belongs) {
    if (!scope) return true;
    if (isProject(scope)) return projectIds.includes(scope);
    if (projectIds.length) return false;
    return (belongs === INTERNAL ? INTERNAL : GENERAL) === scope;
}

/** How a choice reads on a list row. */
export function choiceLabel(choice, projects = []) {
    if (choice === INTERNAL) return 'Internal';
    if (!isProject(choice)) return 'Others';
    const p = projects.find((x) => x.id === choice);
    return p ? [p.code, p.name].filter(Boolean).join(' · ') : 'Project';
}

/**
 * Moves the vendor's project link from `from` to `to` (either may be GENERAL
 * or INTERNAL, meaning no project). Other projects the vendor is on are left
 * alone — those are managed from each project's Vendor Directory.
 */
export async function assignVendorProject(vendorId, to, from, links = []) {
    if (to === from) return;
    if (isProject(from)) {
        const link = links.find((l) => l.vendor_id === vendorId && l.project_id === from);
        if (link) await orgStore.removeItem('project_vendors', link.id);
    }
    if (isProject(to) && !links.some((l) => l.vendor_id === vendorId && l.project_id === to)) {
        await orgStore.addItem('project_vendors', { project_id: to, vendor_id: vendorId });
    }
}

/** True when a write failed only because 0078's columns are not there yet. */
export const missingBelongsTo = (e) =>
    ['42703', 'PGRST204'].includes(e?.code) && /belongs_to|project_id/.test(e?.message || '');

/**
 * Runs save(withBelongsTo). Until 0078 is applied the columns do not exist:
 * the row is then saved without them, and the result says so.
 * @returns {Promise<{ result: any, skipped: boolean }>}
 */
export async function saveWithBelongsTo(save, payload, fields = ['belongs_to', 'project_id']) {
    try {
        return { result: await save(payload), skipped: false };
    } catch (err) {
        if (!missingBelongsTo(err)) throw err;
        // Undefined rather than deleted: an update merges onto the cached row,
        // which the failed attempt already wrote the fields into.
        const rest = { ...payload };
        fields.forEach((f) => { rest[f] = undefined; });
        return { result: await save(rest), skipped: true };
    }
}
