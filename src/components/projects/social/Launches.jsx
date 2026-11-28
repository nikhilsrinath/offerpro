import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
    Panel, Row, Btn, Seg, Select, Table, Td, Empty, Muted, Modal, Field, Input, Textarea, Grid, Status, ConfirmBtn, Bar, TableBar,
} from '../../ui/edge';
import { useT } from '../../ui/edgeUtils';
import { useSection, fmtDate } from '../../financial/financeHooks';
import { useToast } from '../../shared/Toast';
import { orgStore } from '../../../services/orgStore';
import {
    LAUNCH_KINDS, LAUNCH_STATUSES, launchStatusOf, DEFAULT_CHECKLIST, readiness, socialError,
} from './socialModel';
import { useProjectRows, useSocialAccess } from './socialHooks';
import { Gap, FormError, GroupField } from './socialUi';

/* ══════════════════════════════════════════════════════════════════════════
   Social › Launches (Go-to-Market): a product or a service going to market.
   Who it is for, how it is positioned and priced, a readiness checklist,
   the campaigns that carry it, and the review once it is out. A product
   launch can name the SKU it launches.
   ══════════════════════════════════════════════════════════════════════════ */

const todayKey = () => new Date().toISOString().slice(0, 10);

export default function Launches({ project }) {
    const launches = useProjectRows('social_launches', project.id);
    const campaigns = useProjectRows('social_campaigns', project.id);
    const catalog = useSection('catalog');
    const access = useSocialAccess(project);
    const [kind, setKind] = useState('all');
    const [editing, setEditing] = useState(null);

    const rows = useMemo(() => launches.filter((l) => kind === 'all' || l.kind === kind)
        .sort((a, b) => String(a.launch_date || '9999').localeCompare(String(b.launch_date || '9999'))), [launches, kind]);
    const campaignCount = useMemo(() => campaigns.reduce((m, c) => { if (c.launch_id) m[c.launch_id] = (m[c.launch_id] || 0) + 1; return m; }, {}), [campaigns]);
    const skuById = useMemo(() => Object.fromEntries(catalog.map((c) => [c.id, c])), [catalog]);
    const blank = () => ({
        project_id: project.id, kind: kind === 'service' ? 'service' : 'product', status: 'planning',
        checklist: DEFAULT_CHECKLIST.map((c) => ({ ...c })),
    });
    const typePick = (
        <Seg label="Launch type" value={kind} onChange={setKind}
            options={[{ id: 'all', label: 'All' }, { id: 'product', label: 'Product Launch' }, { id: 'service', label: 'Service Launch' }]} />
    );
    const newBtn = access.edit && <Btn primary onClick={() => setEditing(blank())}>New launch</Btn>;

    return (
        <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
            {rows.length === 0 ? (
                <div>
                    <TableBar lead={typePick} actions={newBtn} />
                    <Panel>
                        <Empty action={access.edit && <Btn primary onClick={() => setEditing(blank())}>Plan a launch</Btn>}>
                            No launches yet. Plan a product or service launch here: the audience, the message, the price, and a checklist of what has to be ready.
                        </Empty>
                    </Panel>
                </div>
            ) : (
                    <Table id="social-launches" lead={typePick} actions={newBtn} cols={[
                        { key: 'n', label: 'Launch', always: true }, { key: 'k', label: 'Type' }, { key: 'd', label: 'Launch date' },
                        { key: 's', label: 'Status' }, { key: 'r', label: 'Readiness', width: 150 },
                        { key: 'c', label: 'Campaigns', align: 'right' }, { key: 'o', label: 'Owner', def: false },
                        { key: 'x', label: '', align: 'right', always: true },
                    ]}>
                        {(show) => rows.map((l) => {
                            const st = launchStatusOf(l.status);
                            const ready = readiness(l);
                            const due = l.launch_date && l.launch_date < todayKey() && (l.status === 'planning' || l.status === 'ready');
                            const sku = skuById[l.catalog_id];
                            return (
                                <tr key={l.id} className="edge-tr">
                                    {show('n') && <Td><span style={{ display: 'block' }}>{l.name}</span>{sku && <Muted size={11}>{sku.name}{sku.sku ? ` · ${sku.sku}` : ''}</Muted>}</Td>}
                                    {show('k') && <Td nowrap>{l.kind === 'service' ? 'Service' : 'Product'}</Td>}
                                    {show('d') && <Td nowrap>{l.launch_date ? <Status tone={due ? 'down' : 'mute'}>{fmtDate(l.launch_date)}{due ? ' · overdue' : ''}</Status> : <Muted>Not set</Muted>}</Td>}
                                    {show('s') && <Td nowrap><Status tone={st.tone}>{st.label}</Status></Td>}
                                    {show('r') && (
                                        <Td>
                                            {ready == null ? <Muted>No checklist</Muted> : (
                                                <Row gap={8}><span style={{ flex: 1 }}><Bar value={ready} max={1} height={4} /></span><Muted>{Math.round(ready * 100)}%</Muted></Row>
                                            )}
                                        </Td>
                                    )}
                                    {show('c') && <Td align="right" muted>{campaignCount[l.id] || 0}</Td>}
                                    {show('o') && <Td nowrap muted>{access.empById.get(l.owner_id)?.name || '-'}</Td>}
                                    {show('x') && <Td align="right"><Btn size="sm" onClick={() => setEditing(l)}>{access.edit ? 'Edit' : 'Open'}</Btn></Td>}
                                </tr>
                            );
                        })}
                    </Table>
            )}
            {editing && <LaunchSheet project={project} launch={editing} catalog={catalog} access={access} onClose={() => setEditing(null)} />}
        </div>
    );
}

function LaunchSheet({ project, launch, catalog, access, onClose }) {
    const t = useT();
    const toast = useToast();
    const isEdit = !!launch.id;
    const ro = !access.edit;
    const [form, setForm] = useState({
        name: launch.name || '', kind: launch.kind || 'product', catalog_id: launch.catalog_id || '',
        launch_date: launch.launch_date || '', status: launch.status || 'planning', owner_id: launch.owner_id || '',
        audience: launch.audience || '', positioning: launch.positioning || '', pricing: launch.pricing || '',
        checklist: (launch.checklist || []).map((c) => ({ text: c.text || '', done: !!c.done })), review: launch.review || '',
    });
    const [newItem, setNewItem] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
    const setItem = (i, patch) => setForm((f) => ({ ...f, checklist: f.checklist.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
    const addItem = () => {
        const text = newItem.trim();
        if (!text) return;
        setForm((f) => ({ ...f, checklist: [...f.checklist, { text, done: false }] }));
        setNewItem('');
    };

    // The SKUs of this project first, then the company's general ones, of the launch's kind.
    const skus = useMemo(() => catalog
        .filter((c) => !c.archived_at || c.id === form.catalog_id)
        .filter((c) => !c.item_kind || c.item_kind === form.kind || c.id === form.catalog_id)
        .filter((c) => !c.project_id || c.project_id === project.id)
        .sort((a, b) => (a.project_id === project.id ? 0 : 1) - (b.project_id === project.id ? 0 : 1) || String(a.name).localeCompare(String(b.name))),
    [catalog, form.kind, form.catalog_id, project.id]);
    const done = form.checklist.filter((c) => c.done && c.text.trim()).length;
    const total = form.checklist.filter((c) => c.text.trim()).length;

    const save = async () => {
        if (!form.name.trim()) { setError('Give the launch a name.'); return; }
        const data = {
            ...launch, ...form, name: form.name.trim(), catalog_id: form.catalog_id || null,
            launch_date: form.launch_date || null, owner_id: form.owner_id || null,
            checklist: form.checklist.map((c) => ({ text: c.text.trim().slice(0, 300), done: c.done })).filter((c) => c.text),
        };
        setSaving(true); setError('');
        try {
            if (isEdit) await orgStore.updateItem('social_launches', launch.id, data);
            else await orgStore.addItem('social_launches', data);
            toast(isEdit ? 'Launch saved' : 'Launch added', 'success');
            onClose();
        } catch (e) { setError(socialError(e)); } finally { setSaving(false); }
    };
    const remove = async () => {
        try { await orgStore.removeItem('social_launches', launch.id); toast('Launch deleted', 'success'); onClose(); } catch (e) { setError(socialError(e)); }
    };

    return (
        <Modal open onClose={onClose} title={isEdit ? (ro ? launch.name : 'Edit launch') : 'New launch'} width={600}
            footer={<>
                {isEdit && access.remove && <ConfirmBtn label="Delete" title="Delete launch" message={`Delete “${launch.name}”? Its campaigns stay. This cannot be undone.`} onConfirm={remove} />}
                <div style={{ flex: 1 }} />
                <Btn onClick={onClose}>{ro ? 'Close' : 'Cancel'}</Btn>
                {!ro && <Btn primary disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Btn>}
            </>}>
            <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <Field required label="Name"><Input value={form.name} onChange={set('name')} autoFocus={!isEdit} placeholder="What is launching" /></Field>
                <Gap />
                <Grid min={190} gap={12}>
                    <Field label="Type">
                        <Select value={form.kind} onChange={set('kind')}>
                            {LAUNCH_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                        </Select>
                    </Field>
                    <Field label="SKU" hint={skus.length ? undefined : 'Add it under Planning › SKU to pick it here'}>
                        <Select value={form.catalog_id} onChange={set('catalog_id')}>
                            <option value="">None</option>
                            {skus.map((c) => <option key={c.id} value={c.id}>{c.name}{c.sku ? ` · ${c.sku}` : ''}</option>)}
                        </Select>
                    </Field>
                    <Field label="Launch date"><Input type="date" value={form.launch_date} onChange={set('launch_date')} /></Field>
                    <Field label="Status">
                        <Select value={form.status} onChange={set('status')}>
                            {LAUNCH_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </Select>
                    </Field>
                    <Field label="Owner">
                        <Select value={form.owner_id} onChange={set('owner_id')}>
                            <option value="">Nobody yet</option>
                            {access.people.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </Select>
                    </Field>
                </Grid>
                <Gap />
                <Field label="Target customer"><Textarea rows={2} value={form.audience} onChange={set('audience')} placeholder="Who it is for, and the problem it solves for them" /></Field>
                <Gap />
                <Field label="Positioning and key message"><Textarea rows={3} value={form.positioning} onChange={set('positioning')} placeholder="Why it is different, in one or two lines" /></Field>
                <Gap />
                <Field label="Pricing and offer"><Textarea rows={2} value={form.pricing} onChange={set('pricing')} placeholder="Price, launch offer, plans" /></Field>
                <Gap />
                <GroupField label={`Readiness checklist${total ? ` · ${done} of ${total} done` : ''}`}>
                    <div style={{ display: 'grid', gap: 6 }}>
                        {form.checklist.map((c, i) => (
                            <Row key={i} gap={8}>
                                <input type="checkbox" checked={c.done} aria-label={`Done: ${c.text || 'item ' + (i + 1)}`}
                                    onChange={(e) => setItem(i, { done: e.target.checked })} style={{ width: 16, height: 16, flexShrink: 0, accentColor: t.accent }} />
                                <Input value={c.text} onChange={(e) => setItem(i, { text: e.target.value })} aria-label={`Checklist item ${i + 1}`}
                                    style={{ textDecoration: c.done ? 'line-through' : 'none', color: c.done ? t.faint : t.text }} />
                                {!ro && (
                                    <Btn size="sm" aria-label={`Remove ${c.text || 'item'}`} title="Remove"
                                        onClick={() => setForm((f) => ({ ...f, checklist: f.checklist.filter((_, j) => j !== i) }))}><X size={14} /></Btn>
                                )}
                            </Row>
                        ))}
                        {!ro && (
                            <Row gap={8}>
                                <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add an item"
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }} />
                                <Btn size="sm" onClick={addItem} disabled={!newItem.trim()}>Add</Btn>
                            </Row>
                        )}
                    </div>
                </GroupField>
                {(form.status === 'launched' || form.status === 'reviewed' || form.review) && (
                    <>
                        <Gap />
                        <Field label="Post-launch review"><Textarea rows={3} value={form.review} onChange={set('review')} placeholder="What happened against the plan, and what to change next time" /></Field>
                    </>
                )}
            </fieldset>
            <FormError>{error}</FormError>
        </Modal>
    );
}
