import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
    Panel, Row, Btn, Seg, Select, Table, Td, Empty, Muted, Modal, Field, Input, Textarea, Grid, Status, ConfirmBtn, Toolbar, TableTitle,
} from '../../ui/edge';
import { useT } from '../../ui/edgeUtils';
import { fmtDate } from '../../financial/financeHooks';
import { useToast } from '../../shared/Toast';
import { orgStore } from '../../../services/orgStore';
import {
    PLATFORMS, POST_STATUSES, postStatusOf, monthGrid, dayKey, dayOf, timeOf, toLocalInput, fromLocalInput, socialError,
} from './socialModel';
import { useProjectRows, useSocialAccess } from './socialHooks';
import { PlatformChips, PlatformDots, PlatformTag, Gap, FormError, GroupField } from './socialUi';

/* ══════════════════════════════════════════════════════════════════════════
   Social › Content Calendar: every post of the project on one calendar, all
   platforms together, with the platforms as a filter. A post goes through
   idea → draft → internal review → client approval → scheduled → published.
   Ideas without a date wait in the list under the calendar.
   ══════════════════════════════════════════════════════════════════════════ */

const MAX_IN_DAY = 3;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function useNarrow(limit = 760) {
    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < limit);
    useEffect(() => {
        const fn = () => setNarrow(window.innerWidth < limit);
        window.addEventListener('resize', fn);
        return () => window.removeEventListener('resize', fn);
    }, [limit]);
    return narrow;
}

export default function ContentCalendar({ project }) {
    const t = useT();
    const narrow = useNarrow();
    const posts = useProjectRows('social_posts', project.id);
    const campaigns = useProjectRows('social_campaigns', project.id);
    const access = useSocialAccess(project);

    const now = new Date();
    const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
    const [view, setView] = useState(() => (narrow ? 'list' : 'month'));
    const [platforms, setPlatforms] = useState([]);
    const [status, setStatus] = useState('');
    const [editing, setEditing] = useState(null);

    const shown = useMemo(() => posts.filter((p) => (!platforms.length || p.platforms.some((x) => platforms.includes(x)))
        && (!status || p.status === status)), [posts, platforms, status]);
    const dated = shown.filter((p) => p.scheduled_at);
    const undated = shown.filter((p) => !p.scheduled_at);
    const byDay = useMemo(() => {
        const map = {};
        dated.forEach((p) => { (map[dayOf(p.scheduled_at)] ||= []).push(p); });
        Object.values(map).forEach((list) => list.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)));
        return map;
    }, [dated]);

    const monthStart = new Date(cursor.y, cursor.m, 1);
    const monthName = monthStart.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const inMonth = dated.filter((p) => {
        const d = new Date(p.scheduled_at);
        return d.getFullYear() === cursor.y && d.getMonth() === cursor.m;
    }).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    const step = (n) => setCursor(({ y, m }) => {
        const d = new Date(y, m + n, 1);
        return { y: d.getFullYear(), m: d.getMonth() };
    });
    const today = dayKey(now);

    const newPost = (day) => setEditing({
        project_id: project.id, status: day ? 'draft' : 'idea', platforms: platforms.length ? platforms : [],
        scheduled_at: day ? fromLocalInput(`${day}T10:00`) : null,
    });
    const campaignById = useMemo(() => Object.fromEntries(campaigns.map((c) => [c.id, c])), [campaigns]);

    return (
        <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
            <Toolbar right={access.edit && <Btn primary onClick={() => newPost(null)}>New post</Btn>}>
                <Row gap={4}>
                    <Btn size="sm" aria-label="Previous month" onClick={() => step(-1)}><ChevronLeft size={15} /></Btn>
                    <span style={{ minWidth: 128, textAlign: 'center', fontSize: 13, fontWeight: 600, color: t.text }}>{monthName}</span>
                    <Btn size="sm" aria-label="Next month" onClick={() => step(1)}><ChevronRight size={15} /></Btn>
                </Row>
                <Btn size="sm" onClick={() => setCursor({ y: now.getFullYear(), m: now.getMonth() })}>Today</Btn>
                <Seg label="View" value={view} onChange={setView} options={[{ id: 'month', label: 'Month' }, { id: 'list', label: 'List' }]} />
                <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 168 }}>
                    <option value="">Every status</option>
                    {POST_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </Select>
            </Toolbar>
            <PlatformChips label="Show platforms" allLabel="All platforms" value={platforms} onChange={setPlatforms} />

            {view === 'month' ? (
                <Panel>
                    <div className="edge-scroll" style={{ overflowX: 'auto' }}>
                        <div style={{ minWidth: 700 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: '1px solid ' + t.line }}>
                                {WEEKDAYS.map((d) => (
                                    <div key={d} style={{ padding: '8px 10px', fontSize: 11.5, fontWeight: 600, color: t.faint }}>{d}</div>
                                ))}
                            </div>
                            {monthGrid(cursor.y, cursor.m).map((week) => (
                                <div key={dayKey(week[0])} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
                                    {week.map((d, i) => {
                                        const key = dayKey(d);
                                        const list = byDay[key] || [];
                                        const other = d.getMonth() !== cursor.m;
                                        return (
                                            <div key={key}
                                                onClick={access.edit ? () => newPost(key) : undefined}
                                                title={access.edit ? 'Add a post on this day' : undefined}
                                                style={{
                                                    minHeight: 108, padding: 6, minWidth: 0,
                                                    borderRight: i < 6 ? '1px solid ' + t.line : 'none', borderBottom: '1px solid ' + t.line,
                                                    background: other ? t.panelAlt : 'transparent', cursor: access.edit ? 'pointer' : 'default',
                                                }}>
                                                <div style={{
                                                    display: 'inline-grid', placeItems: 'center', minWidth: 22, height: 22, borderRadius: 99, padding: '0 4px',
                                                    fontSize: 12, fontWeight: key === today ? 700 : 500, marginBottom: 4,
                                                    color: key === today ? t.softText : other ? t.ghost : t.dim,
                                                    background: key === today ? t.soft : 'transparent',
                                                }}>{d.getDate()}</div>
                                                <div style={{ display: 'grid', gap: 3 }}>
                                                    {list.slice(0, MAX_IN_DAY).map((p) => (
                                                        <PostChip key={p.id} post={p} onOpen={(e) => { e.stopPropagation(); setEditing(p); }} />
                                                    ))}
                                                    {list.length > MAX_IN_DAY && (
                                                        <button type="button" onClick={(e) => { e.stopPropagation(); setView('list'); }}
                                                            style={{ all: 'unset', cursor: 'pointer', fontSize: 11, color: t.faint, padding: '0 4px' }}>
                                                            +{list.length - MAX_IN_DAY} more
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>
                </Panel>
            ) : (
                inMonth.length === 0 ? (
                    <Panel>
                        <Empty action={access.edit && <Btn primary onClick={() => newPost(dayKey(monthStart > now ? monthStart : now))}>Plan a post</Btn>}>
                            Nothing planned for {monthName}{platforms.length || status ? ' with these filters' : ''}.
                        </Empty>
                    </Panel>
                ) : (
                    <PostTable posts={inMonth} campaignById={campaignById} access={access} onOpen={setEditing} dated
                        lead={<TableTitle note={`${inMonth.length}`}>{`Posts in ${monthName}`}</TableTitle>} />
                )
            )}

            {undated.length === 0 ? (
                <Panel title="Ideas and unscheduled posts" actions={access.edit && <Btn size="sm" onClick={() => newPost(null)}>Add idea</Btn>}>
                    <Empty>No ideas waiting. Jot one down here and give it a date when it is ready.</Empty>
                </Panel>
            ) : (
                <PostTable posts={undated} campaignById={campaignById} access={access} onOpen={setEditing}
                    lead={<TableTitle note={`${undated.length}`}>Ideas and unscheduled posts</TableTitle>}
                    actions={access.edit && <Btn onClick={() => newPost(null)}>Add idea</Btn>} />
            )}

            {editing && <PostSheet project={project} post={editing} campaigns={campaigns} access={access} onClose={() => setEditing(null)} />}
        </div>
    );
}

/** One post on the calendar: time, title, platform dots, with the status as its edge colour. */
function PostChip({ post, onOpen }) {
    const t = useT();
    const st = postStatusOf(post.status);
    const edge = st.tone === 'up' ? t.up : st.tone === 'accent' ? t.accent : st.tone === 'warn' ? (t.isDark ? '#e0a020' : '#c27c00') : t.ghost;
    return (
        <button type="button" onClick={onOpen} title={`${post.title} · ${st.label}`} style={{
            all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, minWidth: 0,
            padding: '3px 6px', borderRadius: 6, fontSize: 11.5, color: t.text,
            background: t.card, border: '1px solid ' + t.line, borderLeft: `3px solid ${edge}`,
        }}>
            <span style={{ color: t.faint, flexShrink: 0 }}>{timeOf(post.scheduled_at)}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{post.title}</span>
            <PlatformDots ids={post.platforms} />
        </button>
    );
}

function PostTable({ posts, campaignById, access, onOpen, dated, lead, actions }) {
    const toast = useToast();
    const setStatus = async (p, status) => {
        try { await orgStore.updateItem('social_posts', p.id, { status }); toast('Status changed', 'success'); } catch (e) { toast(socialError(e), 'error'); }
    };
    return (
        <Table id={dated ? 'social-posts' : 'social-ideas'} lead={lead} actions={actions} cols={[
            ...(dated ? [{ key: 'd', label: 'When', always: true }] : []),
            { key: 't', label: 'Post', always: true }, { key: 'p', label: 'Platforms' }, { key: 's', label: 'Status' },
            { key: 'o', label: 'Owner' }, { key: 'c', label: 'Campaign', def: false }, { key: 'pl', label: 'Pillar', def: false },
            { key: 'x', label: '', align: 'right', always: true },
        ]}>
            {(show) => posts.map((p) => {
                const owner = access.empById.get(p.owner_id);
                return (
                    <tr key={p.id} className="edge-tr">
                        {show('d') && <Td nowrap>{fmtDate(p.scheduled_at)} <Muted>{timeOf(p.scheduled_at)}</Muted></Td>}
                        {show('t') && <Td><span style={{ display: 'block' }}>{p.title}</span>{p.caption && <Muted size={11}>{p.caption.slice(0, 90)}{p.caption.length > 90 ? '…' : ''}</Muted>}</Td>}
                        {show('p') && <Td><Row gap={8} wrap>{p.platforms.length ? p.platforms.map((x) => <PlatformTag key={x} id={x} />) : <Muted>-</Muted>}</Row></Td>}
                        {show('s') && (
                            <Td nowrap>
                                {access.edit ? (
                                    <Select aria-label={`Status of ${p.title}`} value={p.status} style={{ width: 150, height: 27 }}
                                        onChange={(e) => setStatus(p, e.target.value)}>
                                        {POST_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                                    </Select>
                                ) : <Status tone={postStatusOf(p.status).tone}>{postStatusOf(p.status).label}</Status>}
                            </Td>
                        )}
                        {show('o') && <Td muted nowrap>{owner ? owner.name : '-'}</Td>}
                        {show('c') && <Td muted>{campaignById[p.campaign_id]?.name || '-'}</Td>}
                        {show('pl') && <Td muted>{p.pillar || '-'}</Td>}
                        {show('x') && <Td align="right"><Btn size="sm" onClick={() => onOpen(p)}>{access.edit ? 'Edit' : 'Open'}</Btn></Td>}
                    </tr>
                );
            })}
        </Table>
    );
}

function PostSheet({ post, campaigns, access, onClose }) {
    const toast = useToast();
    const isEdit = !!post.id;
    const ro = !access.edit;
    const [form, setForm] = useState({
        title: post.title || '', caption: post.caption || '', platforms: post.platforms || [],
        when: toLocalInput(post.scheduled_at), status: post.status || 'idea', owner_id: post.owner_id || '',
        campaign_id: post.campaign_id || '', pillar: post.pillar || '',
        asset_links: (post.asset_links || []).join('\n'), post_url: post.post_url || '', notes: post.notes || '',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

    const save = async () => {
        if (!form.title.trim()) { setError('Give the post a title.'); return; }
        if (['scheduled', 'published'].includes(form.status) && !form.when) { setError('A scheduled or published post needs a date.'); return; }
        if (form.status !== 'idea' && !form.platforms.length) { setError('Pick at least one platform.'); return; }
        const data = {
            ...post, title: form.title.trim(), caption: form.caption, platforms: form.platforms,
            scheduled_at: fromLocalInput(form.when), status: form.status, owner_id: form.owner_id || null,
            campaign_id: form.campaign_id || null, pillar: form.pillar,
            asset_links: form.asset_links.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 20),
            post_url: form.post_url, notes: form.notes,
        };
        setSaving(true); setError('');
        try {
            if (isEdit) await orgStore.updateItem('social_posts', post.id, data);
            else await orgStore.addItem('social_posts', data);
            toast(isEdit ? 'Post saved' : 'Post added', 'success');
            onClose();
        } catch (e) { setError(socialError(e)); } finally { setSaving(false); }
    };
    const remove = async () => {
        try { await orgStore.removeItem('social_posts', post.id); toast('Post deleted', 'success'); onClose(); } catch (e) { setError(socialError(e)); }
    };

    return (
        <Modal open onClose={onClose} title={isEdit ? (ro ? post.title : 'Edit post') : 'New post'} width={560}
            footer={<>
                {isEdit && access.remove && <ConfirmBtn label="Delete" title="Delete post" message={`Delete “${post.title}”? This cannot be undone.`} onConfirm={remove} />}
                <div style={{ flex: 1 }} />
                <Btn onClick={onClose}>{ro ? 'Close' : 'Cancel'}</Btn>
                {!ro && <Btn primary disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Btn>}
            </>}>
            <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <Field required label="Title"><Input value={form.title} onChange={set('title')} autoFocus={!isEdit} placeholder="What the post is about" /></Field>
                <Gap />
                <GroupField label="Platforms">
                    <PlatformChips value={form.platforms} onChange={set('platforms')} options={PLATFORMS.map((p) => p.id)} />
                </GroupField>
                <Gap />
                <Field label="Caption"><Textarea rows={5} value={form.caption} onChange={set('caption')} placeholder="The words that go out with it, hashtags included" /></Field>
                <Gap />
                <Grid min={190} gap={12}>
                    <Field label="Date and time" hint="Leave empty to keep it as an idea"><Input type="datetime-local" value={form.when} onChange={set('when')} /></Field>
                    <Field label="Status">
                        <Select value={form.status} onChange={set('status')}>
                            {POST_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </Select>
                    </Field>
                    <Field label="Owner">
                        <Select value={form.owner_id} onChange={set('owner_id')}>
                            <option value="">Nobody yet</option>
                            {access.people.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </Select>
                    </Field>
                    <Field label="Campaign">
                        <Select value={form.campaign_id} onChange={set('campaign_id')}>
                            <option value="">None</option>
                            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </Select>
                    </Field>
                </Grid>
                <Gap />
                <Field label="Content pillar" hint="A theme you post about regularly: Tips, Behind the scenes, Offers…">
                    <Input value={form.pillar} onChange={set('pillar')} maxLength={80} />
                </Field>
                <Gap />
                <Field label="Creatives" hint="Links to the images or videos (Canva, Drive, Documents), one per line">
                    <Textarea rows={2} value={form.asset_links} onChange={set('asset_links')} />
                </Field>
                <Gap />
                {form.status === 'published' && (
                    <>
                        <Field label="Link to the live post"><Input type="url" value={form.post_url} onChange={set('post_url')} placeholder="https://" /></Field>
                        <Gap />
                    </>
                )}
                <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={set('notes')} placeholder="Feedback from the review, the client's comments…" /></Field>
            </fieldset>
            {post.published_at && <><Gap /><Muted>Published {fmtDate(post.published_at)}</Muted></>}
            <FormError>{error}</FormError>
        </Modal>
    );
}
