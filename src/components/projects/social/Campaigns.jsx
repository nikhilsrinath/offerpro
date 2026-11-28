import React, { useMemo, useState } from 'react';
import {
    Panel, Btn, Seg, Select, Table, Td, Empty, Muted, Modal, Field, Input, Textarea, Grid, Status, ConfirmBtn, StatBand, Bar, TableBar,
} from '../../ui/edge';
import { money, fmtDate } from '../../financial/financeHooks';
import { useToast } from '../../shared/Toast';
import { orgStore } from '../../../services/orgStore';
import { canSeeFinancials } from '../../../services/projectService';
import {
    CAMPAIGN_KINDS, CAMPAIGN_STATUSES, campaignKindOf, campaignStatusOf, count, socialError,
} from './socialModel';
import { useProjectRows, useSocialAccess } from './socialHooks';
import { Gap, FormError } from './socialUi';

/* ══════════════════════════════════════════════════════════════════════════
   Social › Campaigns: social media (organic or paid), email, WhatsApp,
   offline and influencer campaigns on one list, with the type as a filter.
   Every campaign has the same frame: objective, dates, owner, budget and
   spend, target and actual leads and reach. Money shows only to those who
   may see the project's financials.
   ══════════════════════════════════════════════════════════════════════════ */

const ratio = (a, b) => (a != null && b ? Number(a) / Number(b) : null);

export default function Campaigns({ project }) {
    const toast = useToast();
    const campaigns = useProjectRows('social_campaigns', project.id);
    const posts = useProjectRows('social_posts', project.id);
    const launches = useProjectRows('social_launches', project.id);
    const access = useSocialAccess(project);
    const fin = canSeeFinancials();
    const [kind, setKind] = useState('all');
    const [editing, setEditing] = useState(null);

    const rows = useMemo(() => campaigns.filter((c) => kind === 'all' || c.kind === kind)
        .sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || ''))), [campaigns, kind]);
    const postCount = useMemo(() => posts.reduce((m, p) => { if (p.campaign_id) m[p.campaign_id] = (m[p.campaign_id] || 0) + 1; return m; }, {}), [posts]);
    const launchById = useMemo(() => Object.fromEntries(launches.map((l) => [l.id, l])), [launches]);

    const counted = rows.filter((c) => c.status !== 'cancelled');
    const budget = counted.reduce((s, c) => s + (Number(c.budget) || 0), 0);
    const spent = counted.reduce((s, c) => s + (Number(c.spent) || 0), 0);
    const leads = counted.reduce((s, c) => s + (Number(c.leads) || 0), 0);
    const live = rows.filter((c) => c.status === 'live').length;
    const stats = [
        { label: 'Live campaigns', value: live, note: `${rows.length} in all` },
        { label: 'Leads', value: count(leads), note: 'From the campaigns shown' },
        ...(fin ? [
            { label: 'Spent', value: money(spent), note: budget ? `of ${money(budget)} budget` : 'No budget set' },
            { label: 'Cost per lead', value: leads && spent ? money(spent / leads) : '-', note: 'Spent ÷ leads' },
        ] : []),
    ];

    const setStatus = async (c, status) => {
        try { await orgStore.updateItem('social_campaigns', c.id, { status }); toast('Status changed', 'success'); } catch (e) { toast(socialError(e), 'error'); }
    };
    const blank = () => ({ project_id: project.id, kind: kind === 'all' ? 'social' : kind, status: 'planned', currency: project.currency });
    const typePick = <Seg label="Campaign type" value={kind} onChange={setKind} options={[{ id: 'all', label: 'All' }, ...CAMPAIGN_KINDS]} />;
    const newBtn = access.edit && <Btn primary onClick={() => setEditing(blank())}>New campaign</Btn>;

    return (
        <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
            <StatBand items={stats} />
            {rows.length === 0 ? (
                <div>
                    <TableBar lead={typePick} actions={newBtn} />
                    <Panel>
                        <Empty action={access.edit && <Btn primary onClick={() => setEditing(blank())}>Plan a campaign</Btn>}>
                            No {kind === 'all' ? '' : campaignKindOf(kind).label.toLowerCase() + ' '}campaigns yet. A campaign groups posts, emails or events around one goal, with its own budget and results.
                        </Empty>
                    </Panel>
                </div>
            ) : (
                    <Table id="social-campaigns" lead={typePick} actions={newBtn} cols={[
                        { key: 'n', label: 'Campaign', always: true }, { key: 'k', label: 'Type' }, { key: 's', label: 'Status' },
                        { key: 'd', label: 'Dates' }, { key: 'o', label: 'Owner', def: false },
                        ...(fin ? [{ key: 'b', label: 'Spent / Budget', width: 170 }] : []),
                        { key: 'l', label: 'Leads', align: 'right' }, { key: 'r', label: 'Reach', align: 'right', def: false },
                        { key: 'p', label: 'Posts', align: 'right' }, { key: 'la', label: 'Launch', def: false },
                        { key: 'x', label: '', align: 'right', always: true },
                    ]}>
                        {(show) => rows.map((c) => {
                            const st = campaignStatusOf(c.status);
                            const use = ratio(c.spent, c.budget);
                            return (
                                <tr key={c.id} className="edge-tr">
                                    {show('n') && <Td><span style={{ display: 'block' }}>{c.name}</span>{c.objective && <Muted size={11}>{c.objective.slice(0, 80)}{c.objective.length > 80 ? '…' : ''}</Muted>}</Td>}
                                    {show('k') && <Td nowrap>{campaignKindOf(c.kind).label}{c.kind === 'social' && <Muted> · {c.paid ? 'Paid' : 'Organic'}</Muted>}</Td>}
                                    {show('s') && (
                                        <Td nowrap>
                                            {access.edit ? (
                                                <Select aria-label={`Status of ${c.name}`} value={c.status} style={{ width: 128, height: 27 }}
                                                    onChange={(e) => setStatus(c, e.target.value)}>
                                                    {CAMPAIGN_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                                                </Select>
                                            ) : <Status tone={st.tone}>{st.label}</Status>}
                                        </Td>
                                    )}
                                    {show('d') && <Td nowrap muted>{c.start_date ? fmtDate(c.start_date) : '-'}{c.end_date ? ` → ${fmtDate(c.end_date)}` : ''}</Td>}
                                    {show('o') && <Td nowrap muted>{access.empById.get(c.owner_id)?.name || '-'}</Td>}
                                    {show('b') && (
                                        <Td>
                                            <div style={{ fontSize: 12.5 }}>{money(c.spent || 0)}<Muted> / {c.budget != null ? money(c.budget) : '-'}</Muted></div>
                                            {use != null && <div style={{ marginTop: 4 }}><Bar value={use} max={1} height={4} /></div>}
                                        </Td>
                                    )}
                                    {show('l') && <Td align="right" nowrap>{count(c.leads)}{c.target_leads != null && <Muted> / {count(c.target_leads)}</Muted>}</Td>}
                                    {show('r') && <Td align="right" nowrap>{count(c.reach)}{c.target_reach != null && <Muted> / {count(c.target_reach)}</Muted>}</Td>}
                                    {show('p') && <Td align="right" muted>{postCount[c.id] || 0}</Td>}
                                    {show('la') && <Td muted>{launchById[c.launch_id]?.name || '-'}</Td>}
                                    {show('x') && <Td align="right"><Btn size="sm" onClick={() => setEditing(c)}>{access.edit ? 'Edit' : 'Open'}</Btn></Td>}
                                </tr>
                            );
                        })}
                    </Table>
            )}
            {editing && <CampaignSheet campaign={editing} launches={launches} access={access} fin={fin} onClose={() => setEditing(null)} />}
        </div>
    );
}

function CampaignSheet({ campaign, launches, access, fin, onClose }) {
    const toast = useToast();
    const isEdit = !!campaign.id;
    const ro = !access.edit;
    const str = (v) => (v == null ? '' : String(v));
    const [form, setForm] = useState({
        name: campaign.name || '', kind: campaign.kind || 'social', paid: !!campaign.paid, objective: campaign.objective || '',
        status: campaign.status || 'planned', start_date: campaign.start_date || '', end_date: campaign.end_date || '',
        owner_id: campaign.owner_id || '', launch_id: campaign.launch_id || '',
        budget: str(campaign.budget), spent: str(campaign.spent),
        target_leads: str(campaign.target_leads), leads: str(campaign.leads),
        target_reach: str(campaign.target_reach), reach: str(campaign.reach), notes: campaign.notes || '',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
    const n = (v) => (v === '' ? null : Number(v));

    const save = async () => {
        if (!form.name.trim()) { setError('Give the campaign a name.'); return; }
        if (form.start_date && form.end_date && form.end_date < form.start_date) { setError('The end date is before the start date.'); return; }
        const nums = ['budget', 'spent', 'target_leads', 'leads', 'target_reach', 'reach'];
        if (nums.some((k) => form[k] !== '' && !(Number(form[k]) >= 0))) { setError('Figures cannot be negative.'); return; }
        const data = {
            ...campaign, ...form, name: form.name.trim(), paid: form.kind === 'social' ? form.paid : false,
            owner_id: form.owner_id || null, launch_id: form.launch_id || null,
            start_date: form.start_date || null, end_date: form.end_date || null,
            // Someone who cannot see money keeps what is saved.
            budget: fin ? n(form.budget) : campaign.budget ?? null, spent: fin ? n(form.spent) : campaign.spent ?? null,
            target_leads: n(form.target_leads), leads: n(form.leads), target_reach: n(form.target_reach), reach: n(form.reach),
        };
        setSaving(true); setError('');
        try {
            if (isEdit) await orgStore.updateItem('social_campaigns', campaign.id, data);
            else await orgStore.addItem('social_campaigns', data);
            toast(isEdit ? 'Campaign saved' : 'Campaign added', 'success');
            onClose();
        } catch (e) { setError(socialError(e)); } finally { setSaving(false); }
    };
    const remove = async () => {
        try { await orgStore.removeItem('social_campaigns', campaign.id); toast('Campaign deleted', 'success'); onClose(); } catch (e) { setError(socialError(e)); }
    };

    return (
        <Modal open onClose={onClose} title={isEdit ? (ro ? campaign.name : 'Edit campaign') : 'New campaign'} width={560}
            footer={<>
                {isEdit && access.remove && <ConfirmBtn label="Delete" title="Delete campaign" message={`Delete “${campaign.name}”? Its posts stay on the calendar. This cannot be undone.`} onConfirm={remove} />}
                <div style={{ flex: 1 }} />
                <Btn onClick={onClose}>{ro ? 'Close' : 'Cancel'}</Btn>
                {!ro && <Btn primary disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Btn>}
            </>}>
            <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <Field required label="Name"><Input value={form.name} onChange={set('name')} autoFocus={!isEdit} placeholder="Diwali offer, Product webinar…" /></Field>
                <Gap />
                <Grid min={190} gap={12}>
                    <Field label="Type">
                        <Select value={form.kind} onChange={set('kind')}>
                            {CAMPAIGN_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                        </Select>
                    </Field>
                    {form.kind === 'social' && (
                        <Field label="Organic or paid">
                            <Select value={form.paid ? 'paid' : 'organic'} onChange={(e) => set('paid')(e.target.value === 'paid')}>
                                <option value="organic">Organic</option>
                                <option value="paid">Paid (ads)</option>
                            </Select>
                        </Field>
                    )}
                    <Field label="Status">
                        <Select value={form.status} onChange={set('status')}>
                            {CAMPAIGN_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </Select>
                    </Field>
                    <Field label="Owner">
                        <Select value={form.owner_id} onChange={set('owner_id')}>
                            <option value="">Nobody yet</option>
                            {access.people.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </Select>
                    </Field>
                    <Field label="Start"><Input type="date" value={form.start_date} onChange={set('start_date')} /></Field>
                    <Field label="End"><Input type="date" value={form.end_date} onChange={set('end_date')} /></Field>
                </Grid>
                <Gap />
                <Field label="Objective"><Textarea rows={2} value={form.objective} onChange={set('objective')} placeholder="What this campaign has to achieve, and for whom" /></Field>
                <Gap />
                {launches.length > 0 && (
                    <>
                        <Field label="Part of launch">
                            <Select value={form.launch_id} onChange={set('launch_id')}>
                                <option value="">None</option>
                                {launches.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                            </Select>
                        </Field>
                        <Gap />
                    </>
                )}
                {fin && (
                    <>
                        <Grid min={190} gap={12}>
                            <Field label="Budget"><Input type="number" min="0" step="0.01" value={form.budget} onChange={set('budget')} /></Field>
                            <Field label="Spent so far"><Input type="number" min="0" step="0.01" value={form.spent} onChange={set('spent')} /></Field>
                        </Grid>
                        <Gap />
                    </>
                )}
                <Grid min={190} gap={12}>
                    <Field label="Target leads"><Input type="number" min="0" step="1" value={form.target_leads} onChange={set('target_leads')} /></Field>
                    <Field label="Leads so far"><Input type="number" min="0" step="1" value={form.leads} onChange={set('leads')} /></Field>
                    <Field label="Target reach"><Input type="number" min="0" step="1" value={form.target_reach} onChange={set('target_reach')} /></Field>
                    <Field label="Reach so far"><Input type="number" min="0" step="1" value={form.reach} onChange={set('reach')} /></Field>
                </Grid>
                <Gap />
                <Field label="Notes"><Textarea rows={3} value={form.notes} onChange={set('notes')} placeholder="Audience, offer, agency, what worked…" /></Field>
            </fieldset>
            <FormError>{error}</FormError>
        </Modal>
    );
}
