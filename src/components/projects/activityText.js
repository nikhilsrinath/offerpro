// Human sentences for the project's audit rows (0020's write_audit, plus the
// explicit projects.status_change / projects.reopen rows from 0045 and 0052).

const STATUS = {
    planned: 'planned', active: 'active', on_hold: 'on hold', completed: 'completed', cancelled: 'cancelled',
    pending: 'pending', in_progress: 'in progress', invoiced: 'invoiced',
};
const s = (v) => STATUS[v] || String(v ?? '').replace(/_/g, ' ');

const FIELD = {
    name: 'name', description: 'description', client_id: 'client', billing_type: 'billing',
    contract_value: 'contract value', budget_labour: 'labour budget', budget_vendor: 'vendor budget',
    budget_other: 'other budget', start_date: 'start date', target_end_date: 'target end',
    actual_end_date: 'end date', tags: 'tags', archived_at: 'archive state',
    role: 'role', allocation_pct: 'time share', end_date: 'end date', bill_rate: 'bill rate',
    title: 'title', due_date: 'due date', billing_pct: 'billing share', billing_amount: 'billing amount',
    sort_order: 'order', invoice_id: 'invoice', amount: 'amount', mode: 'split',
};

const changed = (diff) => Object.keys(diff || {})
    .filter((k) => !['closed_at', 'closed_by', 'manager_employee_id', 'completed_at', 'status'].includes(k))
    .map((k) => FIELD[k] || k.replace(/_/g, ' '));

/** A sentence, or null for a row that says nothing another row does not. */
export function describeActivity(a) {
    const d = a.diff || {};
    switch (a.action) {
        case 'projects.status_change':
            return `Status ${s(d.from)} → ${s(d.to)}${d.reason ? ` — “${d.reason}”` : ''}`;
        case 'projects.reopen':
            return `Reopened${d.reason ? `: “${d.reason}”` : ''}`;
        case 'projects.insert':
            return 'Project created';
        case 'projects.update': {
            // A status move is already its own projects.status_change row.
            const f = changed(d);
            return f.length ? `Changed ${f.join(', ')}` : null;
        }
        case 'project_members.insert':
            return 'Someone joined the team';
        case 'project_members.update':
            if (d.end_date?.to) return `A membership ended on ${d.end_date.to}`;
            return `Team change: ${changed(d).join(', ') || 'updated'}`;
        case 'project_members.delete':
            return 'A membership was removed';
        case 'project_milestones.insert':
            return `Milestone added: ${d.title || ''}`.trim();
        case 'project_milestones.update':
            if (d.status) return `Milestone ${s(d.status.from)} → ${s(d.status.to)}`;
            return `Milestone changed: ${changed(d).join(', ') || 'updated'}`;
        case 'project_milestones.delete':
            return `Milestone removed: ${d.title || ''}`.trim();
        case 'project_documents.insert':
            return 'Document linked';
        case 'project_documents.delete':
            return 'Document unlinked';
        case 'project_allocations.insert':
            return d.amount ? `Money linked: ₹${Number(d.amount).toLocaleString('en-IN')}` : 'Money linked in full';
        case 'project_allocations.update':
            return 'Money split changed';
        case 'project_allocations.delete':
            return 'Money link removed';
        default:
            return String(a.action || '').replace(/[._]/g, ' ');
    }
}
