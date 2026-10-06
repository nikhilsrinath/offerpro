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
import { projectSectionPath } from './projectPaths';
import AddClientDialog from '../shared/AddClientDialog';

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

// The "Others" budgets as rows; a project saved before they had names has one
// unnamed total, shown as a row so it is not lost.
const initialOthers = (project) => {
    if (Array.isArray(project?.other_budgets) && project.other_budgets.length) {
        return project.other_budgets.map((b) => ({ name: b.name || '', amount: String(b.amount ?? '') }));
    }
    return Number(project?.budget_other) > 0 ? [{ name: 'Other', amount: String(project.budget_other) }] : [];
};

const ROLE_IDS = Object.fromEntries(MEMBER_ROLES.map((r) => [r.label.toLowerCase(), r.id]));

// The role is typed. "Manager" and "Lead" are the two the project acts on; anything
// else is a member with that title.
const roleFromText = (text) => {
    const id = ROLE_IDS[String(text || '').trim().toLowerCase()];
    return id ? { role: id, role_title: '' } : { role: 'member', role_title: String(text || '').trim() };
};

const blankMember = () => ({ employee_id: '', role: 'member', role_text: '', allocation_pct: '100', start_date: todayIso(), end_date: '' });

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
        other_budgets: initialOthers(project),
        start_date: project?.start_date || todayIso(),
        target_end_date: project?.target_end_date || '',
        status: project?.status || 'planned',
        tags: project?.tags || [], // no longer asked for; kept so an edit does not clear them
        cost_method: project?.cost_method || 'allocation',
        source_quotation_id: project?.source_quotation_id || prefill?.source_quotation_id || null,
        source_client_stage: project?.source_client_stage || prefill?.source_client_stage || null,
    }));
    const [addingClient, setAddingClient] = useState(false);
    const [members, setMembers] = useState(() => [{ ...blankMember(), role_text: 'Manager' }]);
    const [quoteMilestones] = useState(() => prefill?.milestones || []);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));
    const activeEmployees = employees.filter((e) => !e.exited_at);
    const liveClients = useMemo(() => clients
        .filter((c) => !c.archived_at || c.id === form.client_id)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))), [clients, form.client_id]);
    const setOther = (i, patch) => setForm((f) => ({ ...f, other_budgets: f.other_budgets.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
    const othersTotal = form.other_budgets.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

    // No milestone form here; a project made from a quotation keeps the quotation's lines.
    const milestones = quoteMilestones;

    const setMember = (i, patch) => setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));

    const save = async (e) => {
        e?.preventDefault();
        if (!form.name.trim()) { setError('Give the project a name.'); return; }
        if (form.kind === 'client' && !form.client_id) { setError('Choose the client, or make it an internal project.'); return; }
        if (form.target_end_date && form.start_date && form.target_end_date < form.start_date) {
            setError('The target end date is before the start.'); return;
        }
        if (members.filter((m) => roleFromText(m.role_text).role === 'manager' && m.employee_id).length > 1) {
            setError('A project has one manager at a time.'); return;
        }
        setSaving(true); setError('');
        const others = form.other_budgets
            .map((b) => ({ name: b.name.trim(), amount: Number(b.amount) || 0 }))
            .filter((b) => b.name || b.amount);
        const data = {
            ...form,
            client_id: form.kind === 'client' ? form.client_id : null,
            other_budgets: others,
            budget_other: others.reduce((sum, b) => sum + b.amount, 0),
        };
        try {
            if (isEdit) {
                await updateProject(project.id, data);
                onDone?.();
            } else {
                const { project: created, problems } = await createProject(data, {
                    members: members.filter((m) => m.employee_id).map(({ role_text, ...m }) => ({ ...m, ...roleFromText(role_text) })),
                    milestones,
                });
                if (problems.length) {
                    navigate(projectSectionPath(created.id, 'team'), { state: { problems } });
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
                        <Field required label="Client">
                            <Row gap={8}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <Select value={form.client_id} onChange={set('client_id')}>
                                        <option value="">Choose a client…</option>
                                        {liveClients.map((c) => <option key={c.id} value={c.id}>{c.name || c.clientName}</option>)}
                                    </Select>
                                </div>
                                <Btn onClick={() => setAddingClient(true)}>Add Client</Btn>
                            </Row>
                        </Field>
                        <div style={{ height: 13 }} />
                    </>
                )}
                <Field required label="Name">
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
                    <Field label="Start Date">
                        <Input type="date" value={form.start_date || ''} onChange={set('start_date')} />
                    </Field>
                    <Field label="Target End Date">
                        <Input type="date" value={form.target_end_date || ''} onChange={set('target_end_date')} />
                    </Field>
                </Grid>
            </Panel>

            <Panel title="Contract and budget" note={fin ? 'All amounts before GST' : 'Visible to people with Project financials'} pad={15} style={{ marginBottom: 14 }}>
                <Grid min={160} gap={12}>
                    <Field label="Contract value (₹)" hint="Net of GST">
                        <Input type="number" min="0" step="1" inputMode="decimal" value={form.contract_value} onChange={set('contract_value')} />
                    </Field>
                    <Field label="Currency">
                        <Input value={form.currency} maxLength={3} onChange={(e) => set('currency')(e.target.value.toUpperCase())} />
                    </Field>
                    <Field label="Labour budget (₹)">
                        <Input type="number" min="0" step="1" inputMode="decimal" value={form.budget_labour} onChange={set('budget_labour')} />
                    </Field>
                    <Field label="Vendor budget (₹)">
                        <Input type="number" min="0" step="1" inputMode="decimal" value={form.budget_vendor} onChange={set('budget_vendor')} />
                    </Field>
                </Grid>
                {form.other_budgets.length > 0 && (
                    <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                        {form.other_budgets.map((b, i) => (
                            <Grid key={i} cols="minmax(0,2fr) minmax(0,1fr) auto" gap={8}>
                                <Field label={i === 0 ? 'Others — name' : undefined}>
                                    <Input value={b.name} aria-label={`Other budget ${i + 1} name`} placeholder="e.g. Approval budget"
                                        onChange={(e) => setOther(i, { name: e.target.value })} />
                                </Field>
                                <Field label={i === 0 ? 'Amount (₹)' : undefined}>
                                    <Input type="number" min="0" step="1" inputMode="decimal" aria-label={`Other budget ${i + 1} amount`}
                                        value={b.amount} onChange={(e) => setOther(i, { amount: e.target.value })} />
                                </Field>
                                <div style={{ alignSelf: 'end' }}>
                                    <Btn size="sm" aria-label={`Remove other budget ${i + 1}`}
                                        onClick={() => setForm((f) => ({ ...f, other_budgets: f.other_budgets.filter((_, j) => j !== i) }))}>Remove</Btn>
                                </div>
                            </Grid>
                        ))}
                    </div>
                )}
                <Row gap={12} wrap style={{ marginTop: 10 }}>
                    <Btn size="sm" onClick={() => setForm((f) => ({ ...f, other_budgets: [...f.other_budgets, { name: '', amount: '' }] }))}>Others</Btn>
                    <Muted>
                        Budget total {money((Number(form.budget_labour) || 0) + (Number(form.budget_vendor) || 0) + othersTotal)}
                    </Muted>
                </Row>
            </Panel>

            {!isEdit && (
                <Panel title="Team" pad={15} style={{ marginBottom: 14 }}>
                    <datalist id="project-role-suggestions">
                        {MEMBER_ROLES.map((r) => <option key={r.id} value={r.label} />)}
                    </datalist>
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
                                    <Input value={m.role_text} list="project-role-suggestions" placeholder="Type a role"
                                        onChange={(e) => setMember(i, { role_text: e.target.value })} />
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
                                <div style={{ alignSelf: 'end', display: 'flex' }}>
                                    <Btn size="sm" aria-label={`Remove person ${i + 1}`}
                                        onClick={() => setMembers((ms) => ms.filter((_, j) => j !== i))}>Remove</Btn>
                                </div>
                            </Grid>
                        ))}
                        <div><Btn size="sm" onClick={() => setMembers((ms) => [...ms, blankMember()])}>Add a person</Btn></div>
                    </div>
                </Panel>
            )}

            {error && <div role="alert" style={{ margin: '0 0 12px', fontSize: 12.5, color: t.down }}>{error}</div>}
            <Row gap={8} style={{ justifyContent: 'flex-end' }}>
                <Btn onClick={() => (isEdit ? onDone?.() : navigate(-1))}>Cancel</Btn>
                <Btn primary type="submit" disabled={saving}>
                    {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create project'}
                </Btn>
            </Row>
            {addingClient && (
                <AddClientDialog onClose={() => setAddingClient(false)}
                    onCreated={(c) => c?.id && setForm((f) => ({ ...f, client_id: c.id }))} />
            )}
        </form>
    );

    return isEdit ? body : <Page>{body}</Page>;
}
