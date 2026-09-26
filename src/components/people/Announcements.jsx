// Announcements — broadcast to the whole team or one department.
//
// The audience is `department_id`: null means everyone. Who can actually read a
// notice is decided by RLS (0029 §6), not by this screen, so an announcement
// aimed at one department genuinely does not reach the rest.
//
// Redesigned as a board: pinned notices first, each one a plain card whose
// audience and dates sit on a single footer line. Pinning is a toggle on the
// card rather than a checkbox buried in the editor, because pinning is
// something you decide about an existing notice, not while writing one.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSection } from '../financial/financeHooks';
import { useToast } from '../shared/Toast';
import { orgStore } from '../../services/orgStore';
import { announcementService } from '../../services/announcementService';
import {
    Page, Toolbar, Panel, Row, Btn, Seg, Field, Input, Select, Textarea,
    StatBand, Empty, Loading, Modal, ConfirmBtn, Status,
} from '../ui/edge';
import { useT, fmtDate } from '../ui/edgeUtils';

const BLANK = { title: '', body: '', departmentId: '', isPinned: false, expiresAt: '' };
const isExpired = (a) => !!a.expires_at && new Date(a.expires_at) < new Date();

export default function Announcements() {
    const t = useT();
    const toast = useToast();
    const departments = useSection('departments');
    const orgId = orgStore.getOrgId();

    const [tab, setTab] = useState('board');
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);
    const [busy, setBusy] = useState(false);

    const deptName = useMemo(
        () => Object.fromEntries(departments.map((d) => [d.id, d.name])), [departments],
    );

    const load = useCallback(async () => {
        if (!orgId) return;
        setLoading(true);
        try {
            setItems(await announcementService.list(orgId, { includeExpired: true }));
        } catch (err) {
            toast(err.message || 'Could not load announcements.', 'error');
        } finally {
            setLoading(false);
        }
    }, [orgId, toast]);

    useEffect(() => { load(); }, [load]);

    const live = useMemo(() => items.filter((a) => !isExpired(a)), [items]);
    const shown = useMemo(() => {
        const base = tab === 'board' ? live : items;
        return [...base].sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned)
            || new Date(b.published_at || 0) - new Date(a.published_at || 0));
    }, [tab, live, items]);

    const publish = async (patch) => {
        setBusy(true);
        try {
            await announcementService.publish(orgId, {
                id: patch.id,
                title: patch.title,
                body: patch.body,
                departmentId: patch.departmentId || null,
                isPinned: patch.isPinned,
                // A date input gives a local calendar day; expire at the end of it.
                expiresAt: patch.expiresAt ? new Date(`${patch.expiresAt}T23:59:59`).toISOString() : null,
            });
            setEditing(null);
            await load();
            toast(patch.id ? 'Announcement updated' : 'Announcement published', 'success');
        } catch (err) {
            toast(err.message || 'Could not publish.', 'error');
        } finally {
            setBusy(false);
        }
    };

    const togglePin = (a) => publish({
        id: a.id, title: a.title, body: a.body,
        departmentId: a.department_id || '', isPinned: !a.is_pinned,
        expiresAt: a.expires_at ? a.expires_at.slice(0, 10) : '',
    });

    const remove = async (a) => {
        try {
            await announcementService.remove(a.id);
            setItems((prev) => prev.filter((x) => x.id !== a.id));
            toast('Announcement deleted', 'success');
        } catch (err) {
            toast(err.message || 'Could not delete.', 'error');
        }
    };

    const openEditor = (a) => setEditing(a ? {
        id: a.id, title: a.title, body: a.body,
        departmentId: a.department_id || '',
        isPinned: a.is_pinned,
        expiresAt: a.expires_at ? a.expires_at.slice(0, 10) : '',
    } : { ...BLANK });

    return (
        <Page>
            <Toolbar right={<Btn primary onClick={() => openEditor(null)}>New announcement</Btn>}>
                <Seg value={tab} onChange={setTab} options={[
                    { id: 'board', label: 'Board', count: live.length },
                    { id: 'history', label: 'History', count: items.length },
                ]} />
            </Toolbar>

            {items.length > 0 && (
                <StatBand items={[
                    { label: 'On the board', value: live.length },
                    { label: 'Pinned', value: live.filter((a) => a.is_pinned).length },
                    { label: 'Department only', value: live.filter((a) => a.department_id).length },
                    { label: 'Expired', value: items.length - live.length },
                ]} />
            )}

            {loading ? <Loading /> : shown.length === 0 ? (
                <Panel>
                    <Empty action={<Btn primary onClick={() => openEditor(null)}>Write the first one</Btn>}>
                        {tab === 'board'
                            ? 'Nothing on the board. An announcement appears in every reader’s portal until it expires.'
                            : 'No announcements yet.'}
                    </Empty>
                </Panel>
            ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                    {shown.map((a) => {
                        const expired = isExpired(a);
                        return (
                            <article key={a.id} style={{
                                border: '1px solid ' + (a.is_pinned ? t.lineStrong : t.line),
                                borderRadius: 10, padding: 14, background: t.panel,
                                opacity: expired ? 0.62 : 1,
                            }}>
                                <Row gap={10} align="flex-start" style={{ marginBottom: 8 }}>
                                    <h3 style={{
                                        margin: 0, flex: 1, minWidth: 0, fontSize: 12.5,
                                        fontWeight: 500, color: t.text, letterSpacing: '-0.01em',
                                    }}>
                                        {a.is_pinned && <span style={{ color: t.faint, marginRight: 7, fontSize: 10 }}>PINNED</span>}
                                        {a.title}
                                    </h3>
                                    <Row gap={6}>
                                        <Btn size="sm" onClick={() => togglePin(a)} disabled={busy}>
                                            {a.is_pinned ? 'Unpin' : 'Pin'}
                                        </Btn>
                                        <Btn size="sm" onClick={() => openEditor(a)}>Edit</Btn>
                                        <ConfirmBtn label="Delete" title="Delete announcement" message="It will be removed for everyone in the organisation. This cannot be undone." onConfirm={() => remove(a)} />
                                    </Row>
                                </Row>

                                <p style={{
                                    margin: '0 0 11px', fontSize: 11.5, color: t.dim,
                                    lineHeight: 1.75, whiteSpace: 'pre-wrap',
                                }}>{a.body}</p>

                                <Row gap={14} wrap style={{
                                    paddingTop: 10, borderTop: '1px solid ' + t.lineSoft,
                                    fontSize: 10, color: t.faint,
                                }}>
                                    <Status tone={a.department_id ? 'neutral' : 'mute'}>
                                        {a.department_id ? (deptName[a.department_id] || 'Department') + ' only' : 'Whole team'}
                                    </Status>
                                    <span>Posted {fmtDate(a.published_at)}</span>
                                    {a.expires_at && (
                                        <span style={{ color: expired ? t.down : t.faint }}>
                                            {expired ? 'Expired ' : 'Expires '}{fmtDate(a.expires_at)}
                                        </span>
                                    )}
                                </Row>
                            </article>
                        );
                    })}
                </div>
            )}

            {editing && (
                <Modal open onClose={() => setEditing(null)} width={560}
                    title={editing.id ? 'Edit announcement' : 'New announcement'}
                    note="A department announcement is invisible to everyone outside it"
                    footer={
                        <>
                            <Btn onClick={() => setEditing(null)}>Cancel</Btn>
                            <Btn primary disabled={busy || !editing.title.trim() || !editing.body.trim()}
                                onClick={() => publish(editing)}>
                                {busy ? 'Publishing…' : editing.id ? 'Save' : 'Publish'}
                            </Btn>
                        </>
                    }>
                    <Field label="Title">
                        <Input value={editing.title} maxLength={200} placeholder="Office closed on Friday"
                            onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
                    </Field>
                    <div style={{ height: 13 }} />
                    <Field label="Message">
                        <Textarea rows={7} value={editing.body} placeholder="What the team needs to know…"
                            style={{ minHeight: 130 }}
                            onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                    </Field>
                    <div style={{ height: 13 }} />
                    <Row gap={13} align="flex-end" wrap>
                        <div style={{ flex: '1 1 200px' }}>
                            <Field label="Audience">
                                <Select value={editing.departmentId}
                                    onChange={(e) => setEditing({ ...editing, departmentId: e.target.value })}>
                                    <option value="">Whole team</option>
                                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name} only</option>)}
                                </Select>
                            </Field>
                        </div>
                        <div style={{ flex: '1 1 160px' }}>
                            <Field label="Expires" hint="Leave blank to keep it up">
                                <Input type="date" value={editing.expiresAt}
                                    onChange={(e) => setEditing({ ...editing, expiresAt: e.target.value })} />
                            </Field>
                        </div>
                    </Row>
                </Modal>
            )}
        </Page>
    );
}
