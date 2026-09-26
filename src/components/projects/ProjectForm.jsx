import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Page, Panel, Row, Btn, Seg, Field, Input, Select, Textarea, Grid, Muted,
} from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useSection, money } from '../financial/financeHooks';
import { BILLING_TYPES, MEMBER_ROLES } from '../../services/projectAnalytics';
import {
    createProject, updateProject, prefillFromQuotation, prefillFromClient, canSeeFinancials,
} from '../../services/projectService';
import { hasFeature } from '../../services/planConfig';
import { orgStore } from '../../services/orgStore';

/* ══════════════════════════════════════════════════════════════════════════
   New project — and, with `project` passed, the edit sheet for one.

   Opened three ways: blank, from a quotation (?fromQuotation=<id>: client,
   name, net value and one milestone per line), or from a client
   (?client=<id>). The project's code is the database's; the manager is
   whoever the team rows below make manager.
   ══════════════════════════════════════════════════════════════════════════ */

const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const TEMPLATES = [
    { id: 'none', label: 'None' },
    { id: '30/70', label: '30 / 70' },
    { id: '50/50', label: '50 / 50' },
    { id: 'retainer', label: 'Monthly retainer' },
];

/** Milestones for a template, given the dates the form has. */
function templateMilestones(id, start, end) {
    if (id === '30/70') return [
        { title: 'Advance / kickoff', billing_pct: 30 },
        { title: 'Delivery', billing_pct: 70 },
    ];
    if (id === '50/50') return [
        { title: 'First half', billing_pct: 50 },
        { title: 'Completion', billing_pct: 50 },
    ];
    if (id === 'retainer') {
        const s = start ? new Date(`${start}T00:00:00`) : new Date();
        const e = end ? new Date(`${end}T00:00:00`) : null;
        const months = e ? Math.max(1, Math.min(24,
            (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1)) : 12;
        const pct = Math.round((100 / months) * 100) / 100;
        return Array.from({ length: months }, (_, i) => {
            const d = new Date(s.getFullYear(), s.getMonth() + i + 1, 0);
            return {
                title: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
                billing_pct: i === months - 1 ? Math.round((100 - pct * (months - 1)) * 100) / 100 : pct,
                due_date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
            };
        });
    }
    return [];
}

const blankMember = () => ({ employee_id: '', role: 'member', allocation_pct: '100', start_date: todayIso(), end_date: '' });

export default function ProjectForm({ project = null, onDone }) {
    const t = useT();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const clients = useSection('customers');
    const employees = useSection('employees');
    const isEdit = !!project;
    const fin = canSeeFinancials();

    const prefill = useMemo(() => {
        if (isEdit) return null;
        const q = params.get('fromQuotation');
        if (q) return prefillFromQuotation(q);
        const c = params.get('client');
        if (c) return prefillFromClient(c);
        return null;
    }, [isEdit, params]);

    const [form, setForm] = useState(() => ({
        kind: (project ? project.client_id : prefill?.client_id) ? 'client' : (project ? 'internal' : 'client'),
        name: project?.name || prefill?.name || '',
        description: project?.description || '',
        client_id: project?.client_id || prefill?.client_id || '',
        billing_type: project?.billing_type || 'fixed_price',
        currency: project?.currency || 'INR',
        contract_value: String(project?.contract_value ?? prefill?.contract_value ?? ''),
        budget_labour: String(project?.budget_labour ?? ''),
        budget_vendor: String(project?.budget_vendor ?? ''),
        budget_other: String(project?.budget_other ?? ''),
        start_date: project?.start_date || todayIso(),
        target_end_date: project?.target_end_date || '',
        status: project?.status || 'planned',
        tags: (project?.tags || []).join(', '),
        cost_method: project?.cost_method || 'allocation',
        source_quotation_id: project?.source_quotation_id || prefill?.source_quotation_id || null,
        source_client_stage: project?.source_client_stage || prefill?.source_client_stage || null,
    }));
    const [clientQuery, setClientQuery] = useState('');
    const [members, setMembers] = useState(() => [{ ...blankMember(), role: 'manager' }]);
    const [template, setTemplate] = useState('none');
    const [quoteMilestones] = useState(() => prefill?.milestones || []);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));
    const activeEmployees = employees.filter((e) => !e.exited_at);
    const liveClients = useMemo(() => {
        const q = clientQuery.trim().toLowerCase();
        return clients
            .filter((c) => !c.archived_at || c.id === form.client_id)
            .filter((c) => !q || [c.name, c.clientName, c.email, c.person_name].some((v) => String(v || '').toLowerCase().includes(q)))
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    }, [clients, clientQuery, form.client_id]);

    const milestones = quoteMilestones.length > 0 && template === 'none'
        ? quoteMilestones
        : templateMilestones(template, form.start_date, form.target_end_date);

    const setMember = (i, patch) => setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));

    const save = async (e) => {
        e?.preventDefault();
        if (!form.name.trim()) { setError('Give the project a name.'); return; }
        if (form.kind === 'client' && !form.client_id) { setError('Choose the client, or make it an internal project.'); return; }
        if (form.target_end_date && form.start_date && form.target_end_date < form.start_date) {
            setError('The target end date is before the start.'); return;
        }
        if (members.filter((m) => m.role === 'manager' && m.employee_id).length > 1) {
            setError('A project has one manager at a time.'); return;
        }
        setSaving(true); setError('');
        const data = {
            ...form,
            client_id: form.kind === 'client' ? form.client_id : null,
            tags: form.tags.split(',').map((x) => x.trim()).filter(Boolean),
        };
        try {
            if (isEdit) {
                await updateProject(project.id, data);
                onDone?.();
            } else {
                const { project: created, problems } = await createProject(data, {
                    members: members.filter((m) => m.employee_id),
                    milestones,
                });
                if (problems.length) {
                    navigate(`/projects/${created.id}?tab=team`, { state: { problems } });
                } else {
                    navigate(`/projects/${created.id}`);
                }
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const body = (
        <form onSubmit={save} noValidate>
            <Panel title="The project" pad={15} style={{ marginBottom: 14 }}>
                <Field label="Type">
                    <Seg value={form.kind} onChange={set('kind')} label="Project type" options={[
                        { id: 'client', label: 'For a client' }, { id: 'internal', label: 'Internal' },
                    ]} />
                </Field>
                <div style={{ height: 13 }} />
                {form.kind === 'client' && (
                    <>
                        <Grid cols="minmax(0,1fr) minmax(0,1fr)" gap={12}>
                            <Field label="Find client">
                                <Input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)}
                                    placeholder="Name, email, contact…" />
                            </Field>
                            <Field label="Client">
                                <Select value={form.client_id} onChange={set('client_id')}>
                                    <option value="">Choose a client…</option>
                                    {liveClients.map((c) => <option key={c.id} value={c.id}>{c.name || c.clientName}</option>)}
                                </Select>
                            </Field>
                        </Grid>
                        <div style={{ height: 13 }} />
                    </>
                )}
                <Field label="Name">
                    <Input value={form.name} onChange={set('name')} placeholder="What is being delivered" autoFocus={!isEdit} />
                </Field>
                <div style={{ height: 13 }} />
                <Field label="Description" hint="Optional — scope, links, anything the team should know">
                    <Textarea rows={3} value={form.description} onChange={set('description')} />
                </Field>
                <div style={{ height: 13 }} />
                <Grid min={180} gap={12}>
                    <Field label="Billing">
                        <Select value={form.billing_type} onChange={set('billing_type')}>
                            {BILLING_TYPES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                        </Select>
                    </Field>
                    <Field label="Start">
                        <Input type="date" value={form.start_date || ''} onChange={set('start_date')} />
                    </Field>
                    <Field label="Target end">
                        <Input type="date" value={form.target_end_date || ''} onChange={set('target_end_date')} />
                    </Field>
                    {hasFeature(orgStore.getProfile().plan || 'free', 'timesheets') && (
                        <Field label="Labour cost from" hint="Timesheets: approved hours × hourly cost">
                            <Select value={form.cost_method} onChange={set('cost_method')}>
                                <option value="allocation">Time share (allocation)</option>
                                <option value="timesheet">Timesheets</option>
                            </Select>
                        </Field>
                    )}
                    <Field label="Tags" hint="Comma separated">
                        <Input value={form.tags} onChange={set('tags')} placeholder="web, phase-1" />
                    </Field>
                </Grid>
            </Panel>

            <Panel title="Contract and budget" note={fin ? 'All amounts before GST' : 'Visible to people with Project financials'} pad={15} style={{ marginBottom: 14 }}>
                <Grid min={160} gap={12}>
                    <Field label="Contract value (₹)" hint="Net of GST">
                        <Input type="number" min="0" step="0.01" inputMode="decimal" value={form.contract_value} onChange={set('contract_value')} />
                    </Field>
                    <Field label="Currency">
                        <Input value={form.currency} maxLength={3} onChange={(e) => set('currency')(e.target.value.toUpperCase())} />
                    </Field>
                    <Field label="Labour budget (₹)">
                        <Input type="number" min="0" step="0.01" inputMode="decimal" value={form.budget_labour} onChange={set('budget_labour')} />
                    </Field>
                    <Field label="Vendor budget (₹)">
                        <Input type="number" min="0" step="0.01" inputMode="decimal" value={form.budget_vendor} onChange={set('budget_vendor')} />
                    </Field>
                    <Field label="Other budget (₹)">
                        <Input type="number" min="0" step="0.01" inputMode="decimal" value={form.budget_other} onChange={set('budget_other')} />
                    </Field>
                </Grid>
                <div style={{ marginTop: 10 }}>
                    <Muted>
                        Budget total {money((Number(form.budget_labour) || 0) + (Number(form.budget_vendor) || 0) + (Number(form.budget_other) || 0))}
                    </Muted>
                </div>
            </Panel>

            {!isEdit && (
                <Panel title="Team" note="The manager row sets the project's manager" pad={15} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'grid', gap: 10 }}>
                        {members.map((m, i) => (
                            <Grid key={i} cols="minmax(0,2fr) minmax(0,1fr) 90px minmax(0,1fr) minmax(0,1fr) auto" gap={8}>
                                <Field label={`Person ${i + 1}`}>
                                    <Select value={m.employee_id} onChange={(e) => setMember(i, { employee_id: e.target.value })}>
                                        <option value="">Choose…</option>
                                        {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.name || e.full_name}</option>)}
                                    </Select>
                                </Field>
                                <Field label="Role">
                                    <Select value={m.role} onChange={(e) => setMember(i, { role: e.target.value })}>
                                        {MEMBER_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                                    </Select>
                                </Field>
                                <Field label="Time %">
                                    <Input type="number" min="1" max="100" value={m.allocation_pct}
                                        onChange={(e) => setMember(i, { allocation_pct: e.target.value })} />
                                </Field>
                                <Field label="From">
                                    <Input type="date" value={m.start_date} onChange={(e) => setMember(i, { start_date: e.target.value })} />
                                </Field>
                                <Field label="Until">
                                    <Input type="date" value={m.end_date} onChange={(e) => setMember(i, { end_date: e.target.value })} />
                                </Field>
                                <div style={{ alignSelf: 'end' }}>
                                    <Btn size="sm" aria-label={`Remove person ${i + 1}`}
                                        onClick={() => setMembers((ms) => ms.filter((_, j) => j !== i))}>Remove</Btn>
                                </div>
                            </Grid>
                        ))}
                        <div><Btn size="sm" onClick={() => setMembers((ms) => [...ms, blankMember()])}>Add a person</Btn></div>
                    </div>
                </Panel>
            )}

            {!isEdit && (
                <Panel title="Milestones" note={quoteMilestones.length ? 'Suggested from the quotation’s lines' : 'Optional — you can add them later'} pad={15} style={{ marginBottom: 14 }}>
                    <Field label="Template">
                        <Seg size="sm" value={template} onChange={setTemplate} label="Milestone template" options={TEMPLATES} />
                    </Field>
                    {milestones.length > 0 && (
                        <ul style={{ margin: '12px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                            {milestones.map((m, i) => (
                                <li key={i} style={{ fontSize: 11, color: t.dim, display: 'flex', gap: 10 }}>
                                    <span style={{ flex: 1 }}>{m.title}</span>
                                    <span>{m.billing_pct != null
                                        ? `${m.billing_pct}%${Number(form.contract_value) ? ` · ${money((Number(form.contract_value) * m.billing_pct) / 100)}` : ''}`
                                        : money(m.billing_amount)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Panel>
            )}

            {error && <div role="alert" style={{ margin: '0 0 12px', fontSize: 11, color: t.down }}>{error}</div>}
            <Row gap={8} style={{ justifyContent: 'flex-end' }}>
                <Btn onClick={() => (isEdit ? onDone?.() : navigate(-1))}>Cancel</Btn>
                <Btn primary type="submit" disabled={saving}>
                    {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create project'}
                </Btn>
            </Row>
        </form>
    );

    return isEdit ? body : <Page><div style={{ maxWidth: 900 }}>{body}</div></Page>;
}
