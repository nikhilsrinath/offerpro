import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
    Panel, Row, Btn, Select, Table, Td, Empty, Muted, Modal, Field, Input, Textarea, Grid, ConfirmBtn, Toolbar, TableTitle,
} from '../../ui/edge';
import { useT } from '../../ui/edgeUtils';
import { fmtDate } from '../../financial/financeHooks';
import { useToast } from '../../shared/Toast';
import { orgStore } from '../../../services/orgStore';
import { PLATFORMS, platformOf, count, latestFigures, latestSnapshot, engagementRate, socialError } from './socialModel';
import { useProjectRows, useSocialAccess } from './socialHooks';
import { Gap, FormError, GroupField } from './socialUi';

/* ══════════════════════════════════════════════════════════════════════════
   Social › Competitors: who the project watches, where they post, what they
   do well and badly, and their numbers over time, set against the project's
   own latest figures for one platform at a time. The platforms share little
   about other accounts, so the numbers are noted by hand from their public
   profiles (or a tool such as Semrush).
   ══════════════════════════════════════════════════════════════════════════ */

const HANDLE_PLATFORMS = ['instagram', 'facebook', 'linkedin', 'x', 'youtube'];
const todayKey = () => new Date().toISOString().slice(0, 10);
const pct = (v) => (v == null || v === '' ? '-' : `${Number(v).toFixed(2)}%`);

export default function Competitors({ project }) {
    const t = useT();
    const competitors = useProjectRows('social_competitors', project.id);
    const metrics = useProjectRows('social_metrics', project.id);
    const access = useSocialAccess(project);
    const firstWithData = competitors.flatMap((c) => c.snapshots.map((s) => s.platform))[0];
    const [platform, setPlatform] = useState(firstWithData || 'instagram');
    const [editing, setEditing] = useState(null);
    const [snapFor, setSnapFor] = useState(null);

    const mine = useMemo(() => latestFigures(metrics.filter((m) => m.platform === platform)).rows[0]?.now || null, [metrics, platform]);
    const rows = useMemo(() => [...competitors].sort((a, b) => a.name.localeCompare(b.name)), [competitors]);
    const blank = () => ({ project_id: project.id, handles: {}, snapshots: [] });

    return (
        <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
            <Toolbar right={access.edit && <Btn primary onClick={() => setEditing(blank())}>Add competitor</Btn>}>
                <Select aria-label="Compare on" value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ width: 190 }}>
                    {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
                <Muted>Latest numbers on {platformOf(platform).label}</Muted>
            </Toolbar>
            {rows.length === 0 ? (
                <Panel>
                    <Empty action={access.edit && <Btn primary onClick={() => setEditing(blank())}>Add the first competitor</Btn>}>
                        No competitors yet. Add the accounts you measure yourself against, and note their followers and activity from time to time.
                    </Empty>
                </Panel>
            ) : (
                    <Table id="social-competitors" lead={<TableTitle note={`${rows.length} competitor${rows.length === 1 ? '' : 's'}`}>Comparison</TableTitle>} cols={[
                        { key: 'n', label: 'Account', always: true }, { key: 'h', label: 'Handle' },
                        { key: 'f', label: 'Followers', align: 'right' }, { key: 'p', label: 'Posts / month', align: 'right' },
                        { key: 'e', label: 'Engagement', align: 'right' }, { key: 'd', label: 'Noted on' },
                        { key: 'x', label: '', align: 'right', always: true },
                    ]}>
                        {(show) => [
                            <tr key="you" className="edge-tr" style={{ background: t.panelAlt }}>
                                {show('n') && <Td><strong style={{ fontWeight: 600 }}>{project.name}</strong> <Muted>(you)</Muted></Td>}
                                {show('h') && <Td muted>-</Td>}
                                {show('f') && <Td align="right">{count(mine?.followers)}</Td>}
                                {show('p') && <Td align="right">{count(mine?.posts)}</Td>}
                                {show('e') && <Td align="right">{pct(engagementRate(mine))}</Td>}
                                {show('d') && <Td muted nowrap>{mine ? fmtDate(mine.period) : 'Add figures under Analytics'}</Td>}
                                {show('x') && <Td />}
                            </tr>,
                            ...rows.map((c) => {
                                const s = latestSnapshot(c, platform);
                                return (
                                    <tr key={c.id} className="edge-tr">
                                        {show('n') && (
                                            <Td>
                                                <span style={{ display: 'block' }}>{c.name}</span>
                                                {c.website && <Muted size={11}>{c.website.replace(/^https?:\/\//, '')}</Muted>}
                                            </Td>
                                        )}
                                        {show('h') && <Td muted>{c.handles?.[platform] || '-'}</Td>}
                                        {show('f') && <Td align="right">{count(s?.followers)}</Td>}
                                        {show('p') && <Td align="right">{count(s?.posts)}</Td>}
                                        {show('e') && <Td align="right">{pct(s?.engagement)}</Td>}
                                        {show('d') && <Td muted nowrap>{s ? fmtDate(s.date) : '-'}</Td>}
                                        {show('x') && (
                                            <Td align="right">
                                                <Row gap={6} style={{ justifyContent: 'flex-end' }}>
                                                    {access.edit && <Btn size="sm" onClick={() => setSnapFor(c)}>Note numbers</Btn>}
                                                    <Btn size="sm" onClick={() => setEditing(c)}>{access.edit ? 'Edit' : 'Open'}</Btn>
                                                </Row>
                                            </Td>
                                        )}
                                    </tr>
                                );
                            }),
                        ]}
                    </Table>
            )}
            {rows.some((c) => c.strengths || c.weaknesses) && (
                <Panel title="What they do well and badly">
                    <div style={{ display: 'grid', gap: 12, padding: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                        {rows.filter((c) => c.strengths || c.weaknesses).map((c) => (
                            <div key={c.id} style={{ border: '1px solid ' + t.line, borderRadius: 10, padding: 12, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{c.name}</div>
                                {c.strengths && <Note t={t} label="Strengths" text={c.strengths} />}
                                {c.weaknesses && <Note t={t} label="Weaknesses" text={c.weaknesses} />}
                            </div>
                        ))}
                    </div>
                </Panel>
            )}
            {editing && <CompetitorSheet competitor={editing} access={access} onClose={() => setEditing(null)} />}
            {snapFor && <SnapshotSheet competitor={snapFor} platform={platform} onClose={() => setSnapFor(null)} />}
        </div>
    );
}

function Note({ t, label, text }) {
    return (
        <div style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: t.faint, marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 12.5, color: t.dim, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</div>
        </div>
    );
}

function CompetitorSheet({ competitor, access, onClose }) {
    const t = useT();
    const toast = useToast();
    const isEdit = !!competitor.id;
    const ro = !access.edit;
    const [form, setForm] = useState({
        name: competitor.name || '', website: competitor.website || '', handles: { ...(competitor.handles || {}) },
        strengths: competitor.strengths || '', weaknesses: competitor.weaknesses || '', notes: competitor.notes || '',
        snapshots: [...(competitor.snapshots || [])],
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
    const setHandle = (p) => (e) => setForm((f) => ({ ...f, handles: { ...f.handles, [p]: e.target.value } }));

    const save = async () => {
        if (!form.name.trim()) { setError('Give the competitor a name.'); return; }
        const handles = Object.fromEntries(Object.entries(form.handles).map(([k, v]) => [k, String(v || '').trim()]).filter(([, v]) => v));
        const data = { ...competitor, ...form, name: form.name.trim(), handles };
        setSaving(true); setError('');
        try {
            if (isEdit) await orgStore.updateItem('social_competitors', competitor.id, data);
            else await orgStore.addItem('social_competitors', data);
            toast(isEdit ? 'Competitor saved' : 'Competitor added', 'success');
            onClose();
        } catch (e) { setError(socialError(e)); } finally { setSaving(false); }
    };
    const remove = async () => {
        try { await orgStore.removeItem('social_competitors', competitor.id); toast('Competitor deleted', 'success'); onClose(); } catch (e) { setError(socialError(e)); }
    };
    const history = [...form.snapshots].map((s, i) => ({ ...s, i })).sort((a, b) => String(b.date).localeCompare(String(a.date)));

    return (
        <Modal open onClose={onClose} title={isEdit ? (ro ? competitor.name : 'Edit competitor') : 'Add competitor'} width={600}
            footer={<>
                {isEdit && access.remove && <ConfirmBtn label="Delete" title="Delete competitor" message={`Delete “${competitor.name}” and the numbers noted for it? This cannot be undone.`} onConfirm={remove} />}
                <div style={{ flex: 1 }} />
                <Btn onClick={onClose}>{ro ? 'Close' : 'Cancel'}</Btn>
                {!ro && <Btn primary disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Btn>}
            </>}>
            <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <Grid min={190} gap={12}>
                    <Field required label="Name"><Input value={form.name} onChange={set('name')} autoFocus={!isEdit} /></Field>
                    <Field label="Website"><Input value={form.website} onChange={set('website')} placeholder="https://" /></Field>
                </Grid>
                <Gap />
                <Grid min={170} gap={12}>
                    {HANDLE_PLATFORMS.map((p) => (
                        <Field key={p} label={platformOf(p).label}><Input value={form.handles[p] || ''} onChange={setHandle(p)} placeholder="@handle or link" /></Field>
                    ))}
                </Grid>
                <Gap />
                <Field label="Strengths"><Textarea rows={2} value={form.strengths} onChange={set('strengths')} placeholder="What their content does well" /></Field>
                <Gap />
                <Field label="Weaknesses"><Textarea rows={2} value={form.weaknesses} onChange={set('weaknesses')} placeholder="Gaps you can use" /></Field>
                <Gap />
                <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={set('notes')} /></Field>
                {history.length > 0 && (
                    <>
                        <Gap />
                        <GroupField label="Numbers noted">
                            <div style={{ display: 'grid', gap: 4 }}>
                                {history.map((s) => (
                                    <Row key={s.i} gap={8} style={{ fontSize: 12.5, color: t.dim }}>
                                        <span style={{ width: 92, flexShrink: 0 }}>{fmtDate(s.date)}</span>
                                        <span style={{ width: 110, flexShrink: 0 }}>{platformOf(s.platform).label}</span>
                                        <span style={{ flex: 1, minWidth: 0 }}>{count(s.followers)} followers · {count(s.posts)} posts · {pct(s.engagement)}</span>
                                        {!ro && (
                                            <Btn size="sm" aria-label="Remove these numbers" title="Remove"
                                                onClick={() => setForm((f) => ({ ...f, snapshots: f.snapshots.filter((_, j) => j !== s.i) }))}><X size={14} /></Btn>
                                        )}
                                    </Row>
                                ))}
                            </div>
                        </GroupField>
                    </>
                )}
            </fieldset>
            <FormError>{error}</FormError>
        </Modal>
    );
}

/** Note a competitor's numbers on one platform today (or another day). */
function SnapshotSheet({ competitor, platform, onClose }) {
    const toast = useToast();
    const [form, setForm] = useState({ date: todayKey(), platform, followers: '', posts: '', engagement: '' });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

    const save = async () => {
        if (!form.date) { setError('Pick the date.'); return; }
        if (form.followers === '' && form.posts === '' && form.engagement === '') { setError('Note at least one number.'); return; }
        if (['followers', 'posts', 'engagement'].some((k) => form[k] !== '' && !(Number(form[k]) >= 0))) { setError('Numbers cannot be negative.'); return; }
        const n = (v) => (v === '' ? null : Number(v));
        const snap = { date: form.date, platform: form.platform, followers: n(form.followers), posts: n(form.posts), engagement: n(form.engagement) };
        setSaving(true); setError('');
        try {
            await orgStore.updateItem('social_competitors', competitor.id, { snapshots: [...(competitor.snapshots || []), snap] });
            toast('Numbers noted', 'success');
            onClose();
        } catch (e) { setError(socialError(e)); } finally { setSaving(false); }
    };

    return (
        <Modal open onClose={onClose} title={`Numbers for ${competitor.name}`} width={480}
            footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Btn></>}>
            <Grid min={170} gap={12}>
                <Field label="Platform">
                    <Select value={form.platform} onChange={set('platform')}>
                        {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </Select>
                </Field>
                <Field required label="Date"><Input type="date" value={form.date} onChange={set('date')} /></Field>
                <Field label="Followers"><Input type="number" min="0" step="1" value={form.followers} onChange={set('followers')} autoFocus /></Field>
                <Field label="Posts in the last month"><Input type="number" min="0" step="1" value={form.posts} onChange={set('posts')} /></Field>
                <Field label="Engagement rate (%)" hint="Average of their recent posts"><Input type="number" min="0" step="0.01" value={form.engagement} onChange={set('engagement')} /></Field>
            </Grid>
            <FormError>{error}</FormError>
        </Modal>
    );
}
