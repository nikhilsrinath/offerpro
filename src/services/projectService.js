// projectService.js — everything the Projects screens do to the database.
//
// Rows go through orgStore's sections (projects, project_members,
// project_milestones, project_documents, project_allocations) so every screen
// shares one cache and repaints together. The money comes from the reporting
// RPCs in 0051 and never from arithmetic over cached rows: labour cost is
// derived from pay, and pay only leaves the database as an aggregate.
//
// Every thrown error has been through friendlyError(), so a screen can put
// `err.message` straight in front of a person.
import { supabase } from '../lib/supabase';
import { orgStore } from './orgStore';
import { documentStore } from './documentStore';
import { isClosed, toSplits } from './projectAnalytics';

const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ─── Errors ───────────────────────────────────────────────────────────────────
// The database raises with a CODE: prefix (0045–0052). Map each to what the
// person should do about it.
const MESSAGES = {
    ALLOCATION_EXCEEDS_SOURCE: 'That is more than this entry is worth after GST. Adjust the project split first.',
    ALLOCATION_FULL_CONFLICT: 'This entry is already allocated in full to one project, or split across several. Change the existing split instead.',
    ALLOCATION_SOURCE_NOT_FOUND: 'That entry no longer exists.',
    PROJECT_CLOSED: 'This project is closed. An owner or admin can reopen it.',
    PROJECT_HAS_HISTORY: 'This project has money or documents linked to it, so it cannot be deleted. Archive it instead.',
    MEMBER_OVERLAP: 'This person is already on the project for part of those dates.',
    MANAGER_EXISTS: 'The project already has a manager for those dates. End that role first.',
    TASK_MILESTONE_MISMATCH: 'That milestone belongs to a different project.',
    PERMISSION_DENIED: 'You do not have access to this.',
    TIMESHEET_LOCKED: 'Approved time is locked.',
    TIMESHEET_SELF_APPROVAL: 'Nobody approves their own time.',
    TIMESHEET_DECISION: 'Time is approved or rejected from the approval queue.',
    PLAN_LIMIT_PROJECTS: 'Your plan’s limit on active projects is reached. Complete or archive one, or upgrade.',
};

export function friendlyError(err) {
    const raw = String(err?.message || err || '');
    const code = raw.match(/^([A-Z_]{6,}):/)?.[1];
    if (code && MESSAGES[code]) return new Error(MESSAGES[code]);
    if (err?.code === '42501' || /row-level security|permission denied/i.test(raw)) {
        return new Error('You do not have permission to do that.');
    }
    if (err?.code === '23505') return new Error('That already exists.');
    return new Error(raw || 'Something went wrong. Try again.');
}

async function run(fn) {
    try { return await fn(); } catch (e) { throw friendlyError(e); }
}

// ─── Reads (cache) ────────────────────────────────────────────────────────────

export const listProjects = () => orgStore.getSectionAsList('projects');
export const getProject = (id) => orgStore.getItem('projects', id);
export const membersOf = (projectId) => orgStore.getSectionAsList('project_members')
    .filter((m) => m.project_id === projectId);
export const milestonesOf = (projectId) => orgStore.getSectionAsList('project_milestones')
    .filter((m) => m.project_id === projectId)
    .sort((a, b) => (a.sort_order - b.sort_order) || String(a.due_date || '').localeCompare(String(b.due_date || '')));
export const documentsOf = (projectId) => orgStore.getSectionAsList('project_documents')
    .filter((d) => d.project_id === projectId);
export const allocationsOf = (projectId) => orgStore.getSectionAsList('project_allocations')
    .filter((a) => a.project_id === projectId);
export const allocationsForSource = (sourceType, sourceId) => orgStore.getSectionAsList('project_allocations')
    .filter((a) => a.source_type === sourceType && a.source_id === sourceId);
export const tasksOf = (projectId) => orgStore.getSectionAsList('tasks')
    .filter((t) => t.projectId === projectId);

/** What the viewer may do, for showing controls. The database decides. */
export const canSeeFinancials = () => orgStore.can('project_financials', 'view');
export const canAllocate = () => orgStore.can('project_financials', 'view') && orgStore.can('project_allocations', 'create');
export const canEditProjects = () => orgStore.can('projects', 'edit');
export const canCreateProjects = () => orgStore.can('projects', 'create');
export const isOwnerOrAdmin = () => ['owner', 'admin'].includes(orgStore.getRole());

// ─── Projects ─────────────────────────────────────────────────────────────────

/**
 * Creates the project, then its team and milestones. The children are written
 * after the project row exists (they reference it); a failure part-way leaves
 * the project in place with whatever did save, and says which part failed.
 */
export async function createProject(data, { members = [], milestones = [] } = {}) {
    const project = await run(() => orgStore.addItem('projects', data));
    const problems = [];
    for (const m of members.filter((x) => x.employee_id)) {
        try { await orgStore.addItem('project_members', { ...m, project_id: project.id }); }
        catch (e) { problems.push(friendlyError(e).message); }
    }
    for (const [i, ms] of milestones.filter((x) => x.title).entries()) {
        try { await orgStore.addItem('project_milestones', { ...ms, project_id: project.id, sort_order: ms.sort_order ?? i }); }
        catch (e) { problems.push(friendlyError(e).message); }
    }
    // The manager column is derived from the memberships by the database.
    if (members.some((m) => m.role === 'manager')) await refresh('projects');
    return { project: getProject(project.id) || project, problems };
}

export const updateProject = (id, patch) => run(() => orgStore.updateItem('projects', id, patch));

/** Moves to completed or cancelled; the database stamps closed_at and locks. */
export const closeProject = (id, status = 'completed') => updateProject(id, { status });

/** Owner/admin only, with a reason that lands in the audit log. */
export async function reopenProject(id, reason) {
    await run(async () => {
        const { error } = await supabase.rpc('reopen_project', { p_project_id: id, p_reason: reason });
        if (error) throw error;
    });
    await refresh('projects');
}

export const archiveProject = (id) => updateProject(id, { archived_at: new Date().toISOString() });
export const unarchiveProject = (id) => updateProject(id, { archived_at: null });
export const deleteProject = (id) => run(() => orgStore.removeItem('projects', id));

/** A new project with this one's shape: same client, budget and team, no money links. */
export async function duplicateProject(id) {
    const p = getProject(id);
    if (!p) throw new Error('Project not found.');
    const { id: _id, code: _c, closed_at: _ca, closed_by: _cb, created_at: _cr, updated_at: _u,
        archived_at: _a, actual_end_date: _ae, ...rest } = p;
    return createProject({ ...rest, name: `${p.name} (copy)`, status: 'planned' }, {
        members: membersOf(id).filter((m) => !m.end_date || m.end_date >= today())
            .map(({ employee_id, role, allocation_pct, bill_rate }) => ({
                employee_id, role, allocation_pct, bill_rate, start_date: today(),
            })),
        milestones: milestonesOf(id).map(({ title, description, billing_pct, billing_amount, sort_order }) => ({
            title, description, billing_pct, billing_amount: billing_pct ? null : billing_amount, sort_order,
        })),
    });
}

// ─── Prefill (the "start a project" actions) ──────────────────────────────────

/** Form values for a project started from a quotation: client, name, net value, a milestone per line. */
export function prefillFromQuotation(quotationId) {
    const q = documentStore.getById(quotationId);
    if (!q || q.type !== 'quotation') return null;
    const net = Number(q.taxable_amount) || 0;
    const lines = (q.items || []).filter((it) => it.description);
    return {
        client_id: q.customer_id || null,
        name: q.subject || q.project_name || lines[0]?.description || `Project for ${q.clientName || 'client'}`,
        contract_value: net,
        source_quotation_id: q.id,
        milestones: lines.length > 1 && net > 0
            ? lines.map((it, i) => ({ title: it.description, billing_amount: Number(it.amount) || 0, sort_order: i }))
            : [],
    };
}

export function prefillFromClient(clientId) {
    const c = orgStore.getItem('customers', clientId);
    if (!c) return null;
    return { client_id: c.id, name: '', source_client_stage: c.status || null };
}

// ─── Team ─────────────────────────────────────────────────────────────────────

export const addMember = (projectId, member) =>
    run(() => orgStore.addItem('project_members', { ...member, project_id: projectId }));

export const updateMember = (memberId, patch) =>
    run(() => orgStore.updateItem('project_members', memberId, patch));

/** Memberships end; they are not deleted — labour cost needs the dates. */
export const endMember = (memberId, endDate = today()) => updateMember(memberId, { end_date: endDate });

// ─── Milestones ───────────────────────────────────────────────────────────────

export const addMilestone = (projectId, ms) =>
    run(() => orgStore.addItem('project_milestones', { ...ms, project_id: projectId }));
export const updateMilestone = (id, patch) => run(() => orgStore.updateItem('project_milestones', id, patch));
export const removeMilestone = (id) => run(() => orgStore.removeItem('project_milestones', id));

// ─── Money links ──────────────────────────────────────────────────────────────

/**
 * Makes a source's allocations exactly `splits` — [{ project_id, amount }],
 * with a single `amount: null` row meaning the whole entry and [] meaning none
 * (all overhead). One transaction (public.set_project_allocations), so a split
 * is never half-saved.
 */
export async function allocate(sourceType, sourceId, splits) {
    await run(async () => {
        const { error } = await supabase.rpc('set_project_allocations', {
            p_source_type: sourceType, p_source_id: sourceId, p_splits: splits || [],
        });
        if (error) throw error;
    });
    await refresh('project_allocations');
}

/**
 * For the forms: save the picker's rows against a source that was just saved.
 * Does nothing when the viewer cannot allocate or the picker was never touched,
 * so a form without a project behaves exactly as it did before Projects.
 */
export async function saveSplitFromPicker(sourceType, sourceId, picker) {
    if (!picker || !picker.touched || !canAllocate() || !sourceId) return;
    const { splits, error } = toSplits(picker.rows, { whole: picker.mode === 'single' });
    if (error) throw new Error(error);
    await allocate(sourceType, sourceId, splits);
}

export const unallocate = (allocationId) => run(async () => {
    await orgStore.removeItem('project_allocations', allocationId);
});

// ─── Documents ────────────────────────────────────────────────────────────────

export const linkDocument = (projectId, { recordId = null, financialDocumentId = null }) =>
    run(() => orgStore.addItem('project_documents', {
        project_id: projectId, record_id: recordId, financial_document_id: financialDocumentId,
    }));
export const unlinkDocument = (id) => run(() => orgStore.removeItem('project_documents', id));

// ─── Reports (RPCs, 0051) ─────────────────────────────────────────────────────

/** The project P&L for a period ({from, to} as YYYY-MM-DD, either may be null). */
export async function financials(projectId, period = {}) {
    return run(async () => {
        const { data, error } = await supabase.rpc('project_financials', {
            p_project_id: projectId, p_from: period.from || null, p_to: period.to || null,
        });
        if (error) throw error;
        return (data || [])[0] || null;
    });
}

export async function portfolio(period = {}) {
    return run(async () => {
        const { data, error } = await supabase.rpc('project_portfolio', {
            p_from: period.from || null, p_to: period.to || null, p_org: orgStore.getOrgId(),
        });
        if (error) throw error;
        return data || [];
    });
}

export async function employeeAllocation(date = today()) {
    return run(async () => {
        const { data, error } = await supabase.rpc('employee_allocation', {
            p_date: date, p_org: orgStore.getOrgId(),
        });
        if (error) throw error;
        return data || [];
    });
}

/**
 * The project's history: its own audit rows and its children's, newest first.
 * RLS already hides allocation history from anyone without Project financials.
 */
export async function activity(projectId, limit = 150) {
    const ids = [
        projectId,
        ...membersOf(projectId).map((m) => m.id),
        ...milestonesOf(projectId).map((m) => m.id),
        ...documentsOf(projectId).map((d) => d.id),
        ...allocationsOf(projectId).map((a) => a.id),
    ];
    return run(async () => {
        const { data, error } = await supabase.from('audit_log')
            .select('id, action, entity_type, entity_id, diff, actor_id, created_at')
            .eq('org_id', orgStore.getOrgId())
            .in('entity_id', ids)
            .order('created_at', { ascending: false })
            .limit(limit);
        if (error) throw error;
        return data || [];
    });
}

/** on_track / at_risk / off_track and why; null for a closed project. */
export async function health(projectId) {
    return run(async () => {
        const { data, error } = await supabase.rpc('project_health', { p_project_id: projectId });
        if (error) throw error;
        return (data || [])[0] || null;
    });
}

/** The reminder sweep (0056). Idempotent; called by the app's one scheduler. */
export async function runProjectReminders() {
    const org = orgStore.getOrgId();
    if (!org || !orgStore.can('projects', 'view')) return 0;
    const { data, error } = await supabase.rpc('project_reminders_run', { p_org: org });
    if (error) throw error;
    return data || 0;
}

/** The employee portal's view: your projects, no money (0052). */
export async function myProjects(orgId) {
    return run(async () => {
        const { data, error } = await supabase.rpc('my_projects', { p_org: orgId || null });
        if (error) throw error;
        return data || [];
    });
}

/** An assignee moving their own task (0057). */
export async function setMyTaskStatus(taskId, status) {
    return run(async () => {
        const { error } = await supabase.rpc('set_my_task_status', {
            p_task_id: taskId, p_status: status === 'in-progress' ? 'in_progress' : status,
        });
        if (error) throw error;
    });
}

/** Open (planned, active, on hold) and not archived — what the plan quota counts. */
export const activeProjectCount = () => listProjects()
    .filter((p) => !p.archived_at && !isClosed(p)).length;

// ─── Timesheets (0059–0060) ───────────────────────────────────────────────────

/** Approve or reject submitted entries (manager of the project, or an admin). */
export async function decideTimesheets(ids, decision, note = null) {
    const n = await run(async () => {
        const { data, error } = await supabase.rpc('decide_timesheets', { p_ids: ids, p_decision: decision, p_note: note });
        if (error) throw error;
        return data || 0;
    });
    await refresh('timesheet_entries');
    return n;
}

/** Save one day's minutes for (person, project): insert, update or remove. */
export async function saveTimeCell({ employeeId, projectId, workDate, minutes, existing }) {
    return run(async () => {
        if (existing && !(minutes > 0)) return orgStore.removeItem('timesheet_entries', existing.id);
        if (existing) return orgStore.updateItem('timesheet_entries', existing.id, { minutes, status: 'draft' });
        if (!(minutes > 0)) return null;
        return orgStore.addItem('timesheet_entries', {
            employee_id: employeeId, project_id: projectId, work_date: workDate, minutes, status: 'draft',
        });
    });
}

/** Submit every draft of a person's week. */
export async function submitWeek(entries) {
    return run(async () => {
        for (const e of entries.filter((x) => x.status === 'draft' || x.status === 'rejected')) {
            await orgStore.updateItem('timesheet_entries', e.id, { status: 'submitted' });
        }
    });
}

export async function projectHours(projectId) {
    return run(async () => {
        const { data, error } = await supabase.rpc('project_hours', { p_project_id: projectId });
        if (error) throw error;
        return data || [];
    });
}

export async function unbilledHours(projectId) {
    return run(async () => {
        const { data, error } = await supabase.rpc('unbilled_hours', { p_project_id: projectId });
        if (error) throw error;
        return data || [];
    });
}

export const refresh = (section) => orgStore.refreshSection(section).catch(() => ({}));

export const isProjectClosed = (id) => isClosed(getProject(id));

// ─── The picker's state ───────────────────────────────────────────────────────

/**
 * What the ProjectPicker should show for a source: its current split read from
 * the cache, or an empty single pick for a new entry. `touched` stays false
 * until the person changes something, and an untouched picker is never saved —
 * which is what keeps forms saving exactly as before for anyone who ignores it.
 */
export function pickerFromAllocations(sourceType, sourceId) {
    const rows = sourceId ? allocationsForSource(sourceType, sourceId) : [];
    if (rows.length === 1 && rows[0].mode === 'full') {
        return { mode: 'single', rows: [{ project_id: rows[0].project_id, amount: '' }], touched: false };
    }
    if (rows.length > 0) {
        return { mode: 'split', rows: rows.map((a) => ({ project_id: a.project_id, amount: String(a.amount ?? '') })), touched: false };
    }
    return { mode: 'single', rows: [{ project_id: '', amount: '' }], touched: false };
}

/** A picker pre-set to one project, for a form opened from a project page. */
export const pickerFor = (projectId) => ({
    mode: 'single', rows: [{ project_id: projectId || '', amount: '' }], touched: !!projectId,
});
