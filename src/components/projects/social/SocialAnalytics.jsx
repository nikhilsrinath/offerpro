import React, { useMemo, useState } from 'react';
import {
    Panel, Btn, Select, Table, Td, Empty, Muted, Modal, Field, Input, Textarea, Grid, ConfirmBtn, Toolbar, StatBand, Breakdown, TableTitle,
} from '../../ui/edge';
import { useToast } from '../../shared/Toast';
import { orgStore } from '../../../services/orgStore';
import {
    PLATFORMS, platformOf, monthKey, monthLabel, count, engagementRate, change, latestFigures, sumOf, socialError,
} from './socialModel';
import { useProjectRows, useSocialAccess } from './socialHooks';
import { PlatformTag, Gap, FormError } from './socialUi';

/* ══════════════════════════════════════════════════════════════════════════
   Social › Analytics: how the project's own accounts are doing, one row of
   figures per platform per month. Entered by hand for now; the platform
   connectors will fill the same rows later. The band compares the latest
   month with the one before it.
   ══════════════════════════════════════════════════════════════════════════ */

const FIGURES = [
    { key: 'followers', label: 'Followers' },
    { key: 'reach', label: 'Reach' },
    { key: 'impressions', label: 'Impressions' },
    { key: 'engagements', label: 'Engagements', hint: 'Likes, comments, shares and saves' },
    { key: 'posts', label: 'Posts' },
    { key: 'clicks', label: 'Link clicks' },
];

export default function SocialAnalytics({ project }) {
    const metrics = useProjectRows('social_metrics', project.id);
    const access = useSocialAccess(project);
    const [platform, setPlatform] = useState('');
    const [editing, setEditing] = useState(null);

    const shown = useMemo(() => metrics.filter((m) => !platform || m.platform === platform)
        .sort((a, b) => b.period.localeCompare(a.period) || a.platform.localeCompare(b.platform)), [metrics, platform]);
    const { month, rows } = latestFigures(shown);
    const now = rows.map((r) => r.now);
    const before = rows.map((r) => r.before).filter(Boolean);
    const hasBefore = before.length === rows.length && rows.length > 0;
    const total = (key) => sumOf(now, key);
    const prevTotal = (key) => (hasBefore ? sumOf(before, key) : null);
    const rate = engagementRate({ reach: total('reach'), engagements: total('engagements') });
    const prevRate = hasBefore ? engagementRate({ reach: prevTotal('reach'), engagements: prevTotal('engagements') }) : null;
    const vs = (key) => {
        const c = change(total(key), prevTotal(key));
        return c ? `${c} on the month before` : month ? monthLabel(month) : undefined;
    };
    const stats = [
        { label: 'Followers', value: count(total('followers')), note: vs('followers') },
        { label: 'Reach', value: count(total('reach')), note: vs('reach') },
        { label: 'Engagements', value: count(total('engagements')), note: vs('engagements') },
        {
            label: 'Engagement rate', value: rate == null ? '-' : `${rate.toFixed(2)}%`,
            note: rate != null && prevRate != null ? `${prevRate.toFixed(2)}% the month before` : 'Engagements ÷ reach',
        },
    ];
    const used = [...new Set(metrics.map((m) => m.platform))];
    const blank = () => ({ project_id: project.id, platform: platform || used[0] || 'instagram', period: monthKey(new Date()) });

    return (
        <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
            <Toolbar right={access.edit && <Btn primary onClick={() => setEditing(blank())}>Add figures</Btn>}>
                <Select aria-label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ width: 190 }}>
                    <option value="">All platforms</option>
                    {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
                {month && <Muted>Latest: {monthLabel(month)}</Muted>}
            </Toolbar>
            {metrics.length === 0 ? (
                <Panel>
                    <Empty action={access.edit && <Btn primary onClick={() => setEditing(blank())}>Add this month's figures</Btn>}>
                        No figures yet. Add each platform's numbers once a month (from Instagram Insights, LinkedIn Analytics and so on) to see the trend here.
                    </Empty>
                </Panel>
            ) : (
                <>
                    <StatBand items={stats} />
                    {!platform && rows.length > 1 && (
                        <Panel title="Followers by platform" note={monthLabel(month)} pad={14}>
                            <Breakdown rows={rows.filter((r) => r.now.followers != null).map((r) => ({
                                label: platformOf(r.platform).label, value: Number(r.now.followers), color: platformOf(r.platform).color,
                            }))} />
                        </Panel>
                    )}
                        <Table id="social-metrics" lead={<TableTitle note="Entered by hand">Monthly figures</TableTitle>} cols={[
                            { key: 'm', label: 'Month', always: true }, { key: 'p', label: 'Platform', always: true },
                            ...FIGURES.map((f) => ({ key: f.key, label: f.label, align: 'right', def: !['impressions', 'clicks'].includes(f.key) })),
                            { key: 'er', label: 'Eng. rate', align: 'right' },
                            { key: 'x', label: '', align: 'right', always: true },
                        ]}>
                            {(show) => shown.map((m) => {
                                const er = engagementRate(m);
                                return (
                                    <tr key={m.id} className="edge-tr">
                                        {show('m') && <Td nowrap>{monthLabel(m.period)}</Td>}
                                        {show('p') && <Td nowrap><PlatformTag id={m.platform} /></Td>}
                                        {FIGURES.map((f) => show(f.key) && <Td key={f.key} align="right" nowrap>{count(m[f.key])}</Td>)}
                                        {show('er') && <Td align="right" nowrap muted>{er == null ? '-' : `${er.toFixed(2)}%`}</Td>}
                                        {show('x') && <Td align="right">{access.edit && <Btn size="sm" onClick={() => setEditing(m)}>Edit</Btn>}</Td>}
                                    </tr>
                                );
                            })}
                        </Table>
                </>
            )}
            {editing && <MetricSheet metric={editing} access={access} onClose={() => setEditing(null)} />}
        </div>
    );
}

function MetricSheet({ metric, access, onClose }) {
    const toast = useToast();
    const isEdit = !!metric.id;
    const [form, setForm] = useState(() => ({
        platform: metric.platform || 'instagram', month: String(metric.period || '').slice(0, 7), notes: metric.notes || '',
        ...Object.fromEntries(FIGURES.map((f) => [f.key, metric[f.key] == null ? '' : String(metric[f.key])])),
    }));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

    const save = async () => {
        if (!/^\d{4}-\d{2}$/.test(form.month)) { setError('Pick the month these figures are for.'); return; }
        if (FIGURES.some((f) => form[f.key] !== '' && !(Number.isInteger(Number(form[f.key])) && Number(form[f.key]) >= 0))) {
            setError('Figures are whole numbers, zero or more.'); return;
        }
        const data = {
            ...metric, platform: form.platform, period: `${form.month}-01`, notes: form.notes,
            ...Object.fromEntries(FIGURES.map((f) => [f.key, form[f.key] === '' ? null : Number(form[f.key])])),
        };
        setSaving(true); setError('');
        try {
            if (isEdit) await orgStore.updateItem('social_metrics', metric.id, data);
            else await orgStore.addItem('social_metrics', data);
            toast('Figures saved', 'success');
            onClose();
        } catch (e) { setError(socialError(e)); } finally { setSaving(false); }
    };
    const remove = async () => {
        try { await orgStore.removeItem('social_metrics', metric.id); toast('Figures deleted', 'success'); onClose(); } catch (e) { setError(socialError(e)); }
    };

    return (
        <Modal open onClose={onClose} title={isEdit ? 'Edit figures' : 'Add figures'} width={520}
            footer={<>
                {isEdit && access.remove && <ConfirmBtn label="Delete" title="Delete figures" message="Delete this month's figures for this platform? This cannot be undone." onConfirm={remove} />}
                <div style={{ flex: 1 }} />
                <Btn onClick={onClose}>Cancel</Btn>
                <Btn primary disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Btn>
            </>}>
            <Grid min={190} gap={12}>
                <Field label="Platform">
                    <Select value={form.platform} onChange={set('platform')}>
                        {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </Select>
                </Field>
                <Field required label="Month"><Input type="month" value={form.month} onChange={set('month')} /></Field>
            </Grid>
            <Gap />
            <Grid min={150} gap={12}>
                {FIGURES.map((f) => (
                    <Field key={f.key} label={f.label} hint={f.hint}>
                        <Input type="number" min="0" step="1" value={form[f.key]} onChange={set(f.key)} />
                    </Field>
                ))}
            </Grid>
            <Gap />
            <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={set('notes')} placeholder="What moved the numbers this month" /></Field>
            <FormError>{error}</FormError>
        </Modal>
    );
}
