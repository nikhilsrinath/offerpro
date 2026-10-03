/**
 * EdgeBrain · an industry-specific work breakdown for one project.
 *
 * The model reads what the company and the project actually say about
 * themselves — the company's industry and description, the project's name,
 * description, tags and client, its milestones and any sub-projects it
 * already has — and proposes a breakdown in that industry's own terms.
 *
 * It must not invent a context. When too little is known to tell what kind
 * of work this is, the answer is "needs context" with what to fill in, never
 * a generic list dressed up as industry-specific. That judgement is the
 * model's (it reads the whole context); the one thing decided here is the
 * floor below which there is nothing to read at all.
 *
 * Nothing here writes: the suggestion goes back to the page, the person edits
 * it, and only what they accept is added to the WBS by their own session —
 * under their own permissions and RLS.
 */

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The facts the suggestion may use, and the ones that are missing. */
export function wbsContext({ org = {}, project = {}, client = null, milestones = [], existing = [] }) {
    const lines = [];
    const add = (label, value) => { if (value) lines.push(`${label}: ${value}`); };
    add('Company', clip(org.company_name, 120));
    add('Company industry', clip(org.industry, 120));
    add('Company description', clip(org.company_description, 600));
    add('Company size', clip(org.company_size, 40));
    add('Country', clip(org.country, 60));
    add('Project name', clip(project.name, 160));
    add('Project code', clip(project.code, 40));
    add('Project description', clip(project.description, 1500));
    const tags = Array.isArray(project.tags) ? project.tags.map((t) => clip(t, 40)).filter(Boolean) : [];
    add('Project tags', tags.join(', '));
    add('Billing', clip(project.billing_type, 40));
    add('Planned dates', project.start_date || project.target_end_date
        ? `${project.start_date || '?'} to ${project.target_end_date || '?'}` : '');
    if (client) add('Client', [clip(client.name, 120), client.industry ? `(${clip(client.industry, 80)})` : ''].filter(Boolean).join(' '));
    const ms = milestones.map((m) => clip(m.title, 120)).filter(Boolean).slice(0, 20);
    add('Milestones', ms.join('; '));
    const ex = existing.map((x) => clip(x.title, 120)).filter(Boolean).slice(0, 40);
    add('Sub-projects already in the WBS', ex.join('; '));

    // Something must say what kind of work this is. A bare project name with
    // nothing else is not enough to call a breakdown industry-specific.
    const missing = [];
    if (!clip(project.description, 10)) missing.push('project_description');
    if (!clip(org.industry, 2) && !clip(client?.industry, 2)) missing.push('industry');
    const describable = !missing.includes('project_description') || !missing.includes('industry')
        || !!clip(org.company_description, 10) || tags.length > 0 || ms.length > 0;
    return { text: lines.join('\n'), missing, enough: describable };
}

export const WBS_SYSTEM_PROMPT = `You plan work breakdown structures (WBS) for a company's projects.

From the context, work out the industry and the kind of project, then propose a
breakdown in that industry's own vocabulary and sequence — the phases, the
deliverables and the regulatory or quality steps people in that industry
actually follow. Use only what the context says; do not assume an industry it
does not support.

If the context does not say enough to tell what kind of work this project is,
do not guess: answer with enough_context false, and list what you would need in
"missing" (short phrases a person can act on, e.g. "what the project delivers").

Rules for the breakdown:
- 4 to 8 top-level phases (sub-projects), each with 2 to 6 tasks.
- A task may have up to 4 sub-tasks of its own where the industry needs that detail.
- Names are short (under 60 characters), specific, written as work to do.
- Do not repeat a phase that is already in "Sub-projects already in the WBS";
  add only what is missing around it.

Reply with JSON only, no prose, in exactly this shape:
{"enough_context": true, "industry": "...", "summary": "one sentence on why this breakdown fits",
 "nodes": [{"name": "Phase", "children": [{"name": "Task", "children": [{"name": "Sub-task"}]}]}]}
or
{"enough_context": false, "missing": ["..."]}`;

/**
 * The model's reply as a clean breakdown — [name, children] the page's
 * template machinery understands — or null when it is not usable.
 */
export function parseSuggestion(raw) {
    let text = String(raw || '').trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) text = fence[1];
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    let json;
    try { json = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
    if (!json || typeof json !== 'object') return null;

    if (json.enough_context === false) {
        const missing = (Array.isArray(json.missing) ? json.missing : [])
            .map((m) => clip(m, 120)).filter(Boolean).slice(0, 6);
        return { enough: false, missing };
    }

    let count = 0;
    const clean = (list, depth) => (Array.isArray(list) ? list : [])
        .map((n) => {
            const name = clip(typeof n === 'string' ? n : n?.name, 80);
            if (!name || count >= 120) return null;
            count += 1;
            const kids = depth < 2 ? clean(n?.children, depth + 1) : [];
            return kids.length ? [name, kids] : name;
        })
        .filter(Boolean)
        .slice(0, depth === 0 ? 10 : 8);
    // Top-level entries are always phases, even one the model left empty.
    const nodes = clean(json.nodes, 0).map((n) => (Array.isArray(n) ? n : [n, []]));
    if (!nodes.length) return null;
    return {
        enough: true,
        industry: clip(json.industry, 80),
        summary: clip(json.summary, 300),
        nodes,
    };
}
