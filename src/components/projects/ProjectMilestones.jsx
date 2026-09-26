import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Panel, Row, Btn, Select, Table, Td, Empty, Muted, Modal, Field, Input, Textarea, Grid, Status, Bar, ConfirmBtn,
} from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useSection, money, fmtDate } from '../financial/financeHooks';
import { useToast } from '../shared/Toast';
import { orgStore } from '../../services/orgStore';
import { milestoneProgress, isClosed } from '../../services/projectAnalytics';
import { addMilestone, updateMilestone, removeMilestone } from '../../services/projectService';

/* ══════════════════════════════════════════════════════════════════════════
   Milestones: the plan, in order. Drag a row (or use ↑ ↓) to reorder.
   "Mark complete", then "Create invoice": the invoice form opens with the
   client and one line for the milestone, and on save the database links the
   invoice to the milestone and allocates it to the project (0054).
   ══════════════════════════════════════════════════════════════════════════ */

const STATUS_OPTS = [
    { id: 'pending', label: 'Pending' },
    { id: 'in_progress', label: 'In progress' },
    { id: 'completed', label: 'Completed' },
    { id: 'cancelled', label: 'Cancelled' },
];
const TONE = { pending: 'mute', in_progress: 'neutral', completed: 'up', invoiced: 'up', cancelled: 'mute' };
const today = () => new Date().toISOString().slice(0, 10);

export default function ProjectMilestones({ project }) {
    const t = useT();
    const toast = useToast();
    const navigate = useNavigate();
    const all = useSection('project_milestones');
    const tasks = useSection('tasks');
    const docs = useSection('fin_docs');
    const [editing, setEditing] = useState(null);
    const [drag, setDrag] = useState(null);
    const locked = isClosed(project);
    const canEdit = orgStore.can('project_milestones', 'edit') && !locked;
    const canAdd = orgStore.can('project_milestones', 'create') && !locked;
    const canInvoice = orgStore.can('financial_documents', 'create');

    const rows = useMemo(() => all.filter((m) => m.project_id === project.id)
        .sort((a, b) => (a.sort_order - b.sort_order) || String(a.due_date || '').localeCompare(String(b.due_date || ''))),
    [all, project.id]);
    const projectTasks = tasks.filter((x) => x.projectId === project.id);
    const docById = useMemo(() => Object.fromEntries(docs.map((d) => [d.id, d])), [docs]);
    const billedPct = rows.filter((m) => m.status !== 'cancelled').reduce((s, m) => s + (Number(m.billing_pct) || 0), 0);

    const run = async (fn, ok) => {
        try { await fn(); if (ok) toast(ok, 'success'); } catch (e) { toast(e.message, 'error'); }
    };

    // Rewrite sort_order for every row whose position changed.
    const reorder = (from, to) => run(async () => {
        if (from === to || to < 0 || to >= rows.length) return;
        const next = rows.slice();
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        for (const [i, m] of next.entries()) {
            if (m.sort_order !== i) await updateMilestone(m.id, { sort_order: i });
        }
    });

    const createInvoice = (m) => navigate('/new-invoice', {
        state: {
            projectId: project.id, milestoneId: m.id, clientId: project.client_id,
            line: { description: `${project.name} — ${m.title}`, amount: Number(m.billing_amount) || 0 },
        },
    });

    return (
        <Panel title="Milestones"
            note={billedPct ? `${Math.round(billedPct)}% of the contract is planned to bill` : locked ? 'Locked while the project is closed' : undefined}
            actions={canAdd && <Btn size="sm" primary onClick={() => setEditing({ project_id: project.id, sort_order: rows.length })}>Add milestone</Btn>}>
            {rows.length === 0 ? (
                <Empty action={canAdd && <Btn primary onClick={() => setEditing({ project_id: project.id, sort_order: 0 })}>Add the first milestone</Btn>}>
                    No milestones yet. A milestone is a stage of the work, and can bill a share of the contract.
                </Empty>
            ) : (
                <Table cols={[
                    { key: 'o', label: '', width: 64 }, { key: 't', label: 'Milestone' }, { key: 'd', label: 'Due' },
                    { key: 'b', label: 'Bills', align: 'right' }, { key: 'p', label: 'Progress', width: 120 },
                    { key: 's', label: 'Status' }, { key: 'x', label: '', align: 'right' },
                ]}>
                    {rows.map((m, i) => {
                        const prog = milestoneProgress(m, projectTasks);
                        const late = m.due_date && m.due_date < today() && (m.status === 'pending' || m.status === 'in_progress');
                        const inv = m.invoice_id ? docById[m.invoice_id] : null;
                        return (
                            <tr key={m.id} className="edge-tr"
                                draggable={canEdit} onDragStart={() => setDrag(i)}
                                onDragOver={(e) => { if (drag !== null) e.preventDefault(); }}
                                onDrop={() => { reorder(drag, i); setDrag(null); }}
                                style={{ opacity: drag === i ? 0.5 : 1 }}>
                                <Td nowrap>
                                    {canEdit && (
                                        <Row gap={2}>
                                            <Btn size="sm" aria-label={`Move ${m.title} up`} disabled={i === 0} onClick={() => reorder(i, i - 1)}>↑</Btn>
                                            <Btn size="sm" aria-label={`Move ${m.title} down`} disabled={i === rows.length - 1} onClick={() => reorder(i, i + 1)}>↓</Btn>
                                        </Row>
                                    )}
                                </Td>
                                <Td>
                                    <span style={{ display: 'block' }}>{m.title}</span>
                                    {m.description && <span style={{ display: 'block', fontSize: 9.5, color: t.faint }}>{m.description}</span>}
                                </Td>
                                <Td nowrap>{m.due_date ? <Status tone={late ? 'down' : 'mute'}>{fmtDate(m.due_date)}{late ? ' · late' : ''}</Status> : <Muted>—</Muted>}</Td>
                                <Td align="right" nowrap>
                                    {m.billing_amount != null ? money(m.billing_amount) : <Muted>—</Muted>}
                                    {m.billing_pct != null && <span style={{ color: t.faint, fontSize: 10 }}> · {m.billing_pct}%</span>}
                                </Td>
                                <Td>
                                    <Row gap={8}><span style={{ flex: 1 }}><Bar value={prog} max={1} height={4} /></span>
                                        <Muted>{Math.round(prog * 100)}%</Muted></Row>
                                </Td>
                                <Td nowrap>
                                    {canEdit && m.status !== 'invoiced' ? (
                                        <Select aria-label={`Status of ${m.title}`} value={m.status} style={{ width: 128, height: 27 }}
                                            onChange={(e) => run(() => updateMilestone(m.id, { status: e.target.value }), 'Status changed')}>
                                            {STATUS_OPTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                                        </Select>
                                    ) : (
                                        <Status tone={TONE[m.status]}>{m.status === 'invoiced' ? `Invoiced${inv ? ` · ${inv.doc_number || inv.invoiceNumber}` : ''}` : m.status.replace('_', ' ')}</Status>
                                    )}
                                </Td>
                                <Td align="right">
                                    <Row gap={6} style={{ justifyContent: 'flex-end' }}>
                                        {canEdit && (m.status === 'pending' || m.status === 'in_progress') && (
                                            <Btn size="sm" onClick={() => run(() => updateMilestone(m.id, { status: 'completed' }), 'Marked complete')}>Mark complete</Btn>
                                        )}
                                        {m.status === 'completed' && !m.invoice_id && canInvoice && (
                                            <Btn size="sm" primary onClick={() => createInvoice(m)}>Create invoice</Btn>
                                        )}
                                        {canEdit && m.status !== 'invoiced' && <Btn size="sm" onClick={() => setEditing(m)}>Edit</Btn>}
                                        {canEdit && !m.invoice_id && orgStore.can('project_milestones', 'delete') && (
                                            <ConfirmBtn label="Delete" title="Delete milestone" message={`Are you sure you want to delete “${m.title}”? This cannot be undone.`} onConfirm={() => run(() => removeMilestone(m.id), 'Deleted')} />
                                        )}
                                    </Row>
                                </Td>
                            </tr>
                        );
                    })}
                </Table>
            )}
            {editing && <MilestoneSheet project={project} milestone={editing} onClose={() => setEditing(null)} />}
        </Panel>
    );
}

function MilestoneSheet({ project, milestone, onClose }) {
    const t = useT();
    const isEdit = !!milestone.id;
    const [form, setForm] = useState({
        title: milestone.title || '', description: milestone.description || '', due_date: milestone.due_date || '',
        by: milestone.billing_pct != null ? 'pct' : milestone.billing_amount != null ? 'amount' : 'none',
        billing_pct: milestone.billing_pct ?? '', billing_amount: milestone.billing_amount ?? '',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

    const save = async () => {
        if (!form.title.trim()) { setError('Give it a title.'); return; }
        const data = {
            ...milestone, title: form.title.trim(), description: form.description, due_date: form.due_date || null,
            billing_pct: form.by === 'pct' ? Number(form.billing_pct) || null : null,
            billing_amount: form.by === 'amount' ? Number(form.billing_amount) || 0 : null,
        };
        setSaving(true); setError('');
        try {
            if (isEdit) await updateMilestone(milestone.id, data);
            else await addMilestone(project.id, data);
            onClose();
        } catch (e) { setError(e.message); } finally { setSaving(false); }
    };

    return (
        <Modal open onClose={onClose} title={isEdit ? 'Edit milestone' : 'New milestone'} width={520}
            footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Btn></>}>
            <Field label="Title"><Input value={form.title} onChange={set('title')} autoFocus /></Field>
            <div style={{ height: 12 }} />
            <Field label="Description"><Textarea rows={2} value={form.description} onChange={set('description')} /></Field>
            <div style={{ height: 12 }} />
            <Grid min={150} gap={10}>
                <Field label="Due"><Input type="date" value={form.due_date || ''} onChange={set('due_date')} /></Field>
                <Field label="Bills">
                    <Select value={form.by} onChange={set('by')}>
                        <option value="none">Nothing</option>
                        <option value="pct">A share of the contract</option>
                        <option value="amount">A fixed amount</option>
                    </Select>
                </Field>
                {form.by === 'pct' && (
                    <Field label="Share (%)" hint={project.contract_value ? `= ${money((Number(form.billing_pct) || 0) * project.contract_value / 100)}` : undefined}>
                        <Input type="number" min="0.01" max="100" step="0.01" value={form.billing_pct} onChange={set('billing_pct')} />
                    </Field>
                )}
                {form.by === 'amount' && (
                    <Field label="Amount (₹, before GST)"><Input type="number" min="0" step="0.01" value={form.billing_amount} onChange={set('billing_amount')} /></Field>
                )}
            </Grid>
            {error && <div role="alert" style={{ marginTop: 12, fontSize: 11, color: t.down }}>{error}</div>}
        </Modal>
    );
}
