// Announcements: broadcast to the whole team, one department, or members
// picked by name, now or on a send date.
//
// Who can actually read a notice is decided by RLS (0029 §6, 0111), not by
// this screen, so an announcement aimed at one department or three people
// genuinely does not reach the rest, and a scheduled one reaches nobody until
// its send date.
//
// A board: pinned notices first, each one a plain card whose audience and
// dates sit on a single footer line. Pinning is a toggle on the card rather
// than a checkbox in the editor, because pinning is something you decide
// about an existing notice, not while writing one.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSection } from '../financial/financeHooks';
import { useToast } from '../shared/Toast';
import { orgStore } from '../../services/orgStore';
import {
    announcementService, fmtSize, isExpired, isScheduled, audienceOf,
} from '../../services/announcementService';
import {
    Page, Toolbar, Panel, Row, Btn, Seg, Field, Input, Textarea,
    StatBand, Empty, Loading, Modal, ConfirmBtn, Status,
} from '../ui/edge';
import { useT, fmtDate } from '../ui/edgeUtils';
import AttachmentsField from '../shared/AttachmentsField';
import { SendDateField, AudienceField } from '../shared/announcementFields';
import { sendFormOf, sendAtOf, datesProblem, whenText, audienceText } from '../shared/announcementForm';

const blank = () => ({
    title: '', body: '', audienceMode: 'everyone', departmentId: '', audience: [], hadAudience: false,
    isPinned: false, expiresAt: '', keep: [], files: [], dropped: [], ...sendFormOf(null),
});

export default function Announcements() {
    const t = useT();
    const toast = useToast();
    const departments = useSection('departments');
    const employees = useSection('employees');
    const orgId = orgStore.getOrgId();

    const [tab, setTab] = useState('board');
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState('');

    const deptName = useMemo(
        () => Object.fromEntries(departments.map((d) => [d.id, d.name])), [departments],
    );
    // Everyone who can be picked by name: the current employees, A to Z.
    const people = useMemo(() => employees
        .filter((e) => !e.exited_at)
        .map((e) => ({ id: e.id, name: e.name || e.full_name || 'Unnamed', sub: [e.role, e.department].filter(Boolean).join(' · ') }))
        .sort((a, b) => a.name.localeCompare(b.name)), [employees]);
    const nameOf = useCallback((id) => people.find((p) => p.id === id)?.name || '', [people]);

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

    const scheduled = useMemo(() => items.filter((a) => isScheduled(a)), [items]);
    const live = useMemo(() => items.filter((a) => !isScheduled(a) && !isExpired(a)), [items]);
    const shown = useMemo(() => {
        const base = tab === 'board' ? live : tab === 'scheduled' ? scheduled : items;
        return [...base].sort((a, b) => (tab === 'scheduled'
            ? new Date(a.published_at) - new Date(b.published_at)
            : Number(b.is_pinned) - Number(a.is_pinned) || new Date(b.published_at || 0) - new Date(a.published_at || 0)));
    }, [tab, live, scheduled, items]);

    const publish = async (form) => {
        const issue = datesProblem(form)
            || (form.audienceMode === 'members' && form.audience.length === 0 ? 'Pick at least one member, or send it to the whole team.' : '')
            || (form.audienceMode === 'department' && !form.departmentId ? 'Choose the department it is for.' : '');
        if (issue) { setProblem(issue); return; }
        setProblem('');
        setBusy(true);
        try {
            const audience = form.audienceMode === 'members' ? form.audience : [];
            await announcementService.publish(orgId, {
                id: form.id,
                title: form.title,
                body: form.body,
                departmentId: form.audienceMode === 'department' ? form.departmentId : null,
                audience, hadAudience: form.hadAudience,
                isPinned: form.isPinned,
                sendAt: sendAtOf(form),
                expiresAt: form.expiresAt || null,
                keep: form.keep || [], files: form.files || [], dropped: form.dropped || [],
            });
            const later = form.sendMode === 'later' && !form.sentAt;
            setEditing(null);
            await load();
            toast(later ? `Scheduled for ${whenText(sendAtOf(form))}` : form.id ? 'Announcement updated' : 'Announcement published', 'success');
        } catch (err) {
            setProblem(err.message || 'Could not publish.');
        } finally {
            setBusy(false);
        }
    };

    // Only the pin changes; the notice and its attachments stay as they are.
    const togglePin = async (a) => {
        setBusy(true);
        try {
            await announcementService.setPinned(a.id, !a.is_pinned);
            await load();
        } catch (err) {
            toast(err.message || 'Could not pin it.', 'error');
        } finally {
            setBusy(false);
        }
    };

    const openFile = async (f) => {
        // Opened before the await so a popup blocker sees the click.
        const w = window.open('', '_blank');
        try {
            const url = await announcementService.attachmentUrl(f.path);
            if (w) { w.opener = null; w.location.href = url; } else window.location.assign(url);
        } catch (err) {
            w?.close();
            toast(err.message || 'Could not open the attachment.', 'error');
        }
    };

    const remove = async (a) => {
        try {
            await announcementService.removeWithFiles(a);
            setItems((prev) => prev.filter((x) => x.id !== a.id));
            toast('Announcement deleted', 'success');
        } catch (err) {
            toast(err.message || 'Could not delete.', 'error');
        }
    };

    const openEditor = (a) => {
        setProblem('');
        if (!a) { setEditing(blank()); return; }
        const picked = audienceOf(a);
        setEditing({
            id: a.id, title: a.title, body: a.body,
            audienceMode: picked.length ? 'members' : a.department_id ? 'department' : 'everyone',
            departmentId: a.department_id || '', audience: picked, hadAudience: picked.length > 0,
            isPinned: a.is_pinned,
            expiresAt: a.expires_at ? a.expires_at.slice(0, 10) : '',
            keep: a.attachments || [], files: [], dropped: [],
            ...sendFormOf(a),
        });
    };

    const emptyText = {
        board: 'Nothing on the board. An announcement appears in every reader’s portal until it expires.',
        scheduled: 'Nothing scheduled. Pick Schedule under Send Date to post one later.',
        history: 'No announcements yet.',
    }[tab];

    return (
        <Page>
            {/* The headline numbers first, then the filters right over the list they narrow. */}
            <StatBand items={[
                { label: 'On the board', value: live.length },
                { label: 'Scheduled', value: scheduled.length },
                { label: 'Pinned', value: live.filter((a) => a.is_pinned).length },
                { label: 'Expired', value: items.filter((a) => isExpired(a)).length },
            ]} />

            <Toolbar right={<Btn primary onClick={() => openEditor(null)}>New Announcement</Btn>}>
                <Seg value={tab} onChange={setTab} options={[
                    { id: 'board', label: 'Board' },
                    { id: 'scheduled', label: `Scheduled${scheduled.length ? ` (${scheduled.length})` : ''}` },
                    { id: 'history', label: 'History' },
                ]} />
            </Toolbar>

            {loading ? <Loading /> : shown.length === 0 ? (
                <Panel>
                    <Empty action={<Btn primary onClick={() => openEditor(null)}>Write the First One</Btn>}>{emptyText}</Empty>
                </Panel>
            ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                    {shown.map((a) => {
                        const expired = isExpired(a);
                        const later = isScheduled(a);
                        const who = audienceText(a, { nameOf, deptName, scope: 'Whole team' });
                        return (
                            <article key={a.id} style={{
                                border: '1px solid ' + (a.is_pinned ? t.lineStrong : t.line),
                                borderLeft: later ? `3px solid ${t.teal}` : undefined,
                                borderRadius: 10, padding: 14, background: t.panel,
                                opacity: expired ? 0.62 : 1,
                            }}>
                                <Row gap={10} align="flex-start" style={{ marginBottom: 8 }}>
                                    <h3 style={{
                                        margin: 0, flex: 1, minWidth: 0, fontSize: 14,
                                        fontWeight: 500, color: t.text, letterSpacing: '-0.01em',
                                    }}>
                                        {a.is_pinned && <span style={{ color: t.faint, marginRight: 7, fontSize: 11.5 }}>Pinned</span>}
                                        {a.title}
                                    </h3>
                                    <Row gap={6}>
                                        {!later && (
                                            <Btn size="sm" onClick={() => togglePin(a)} disabled={busy}>
                                                {a.is_pinned ? 'Unpin' : 'Pin'}
                                            </Btn>
                                        )}
                                        <Btn size="sm" onClick={() => openEditor(a)}>Edit</Btn>
                                        <ConfirmBtn label="Delete" title="Delete announcement" message="It will be removed for everyone it was sent to. This cannot be undone." onConfirm={() => remove(a)} />
                                    </Row>
                                </Row>

                                <p style={{
                                    margin: '0 0 11px', fontSize: 13, color: t.dim,
                                    lineHeight: 1.75, whiteSpace: 'pre-wrap',
                                }}>{a.body}</p>

                                {a.attachments?.length > 0 && (
                                    <ul aria-label="Attachments" style={{ listStyle: 'none', margin: '0 0 11px', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {a.attachments.map((f) => (
                                            <li key={f.path}>
                                                <Btn size="sm" onClick={() => openFile(f)} aria-label={`Open attachment ${f.name}`}>
                                                    {f.name} <span style={{ color: t.faint, fontSize: 11 }}>{fmtSize(f.size)}</span>
                                                </Btn>
                                            </li>
                                        ))}
                                    </ul>
                                )}

                                <Row gap={14} wrap style={{
                                    paddingTop: 10, borderTop: '1px solid ' + t.lineSoft,
                                    fontSize: 11.5, color: t.faint,
                                }}>
                                    <span title={who.names || undefined}>
                                        <Status tone={who.label === 'Whole team' ? 'mute' : 'neutral'}>{who.label}</Status>
                                    </span>
                                    {later
                                        ? <span style={{ color: t.accent, fontWeight: 500 }}>Scheduled · goes out {whenText(a.published_at)}</span>
                                        : <span>Sent {fmtDate(a.published_at)}</span>}
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
                <Modal open onClose={() => setEditing(null)} width={700}
                    title={editing.id ? 'Edit Announcement' : 'New Announcement'}
                    note="Only the audience you choose can read it"
                    footer={
                        <>
                            <Btn onClick={() => setEditing(null)}>Cancel</Btn>
                            <Btn primary disabled={busy || !editing.title.trim() || !editing.body.trim()}
                                onClick={() => publish(editing)}>
                                {busy ? 'Saving…' : editing.id ? 'Save'
                                    : editing.sendMode === 'later' ? 'Schedule' : 'Publish'}
                            </Btn>
                        </>
                    }>
                    {problem && <div role="alert" className="prod-form-error">{problem}</div>}
                    {/* One field a row, as every side panel lays them out. */}
                    <Field required label="Title">
                        <Input value={editing.title} maxLength={200} placeholder="Office closed on Friday"
                            onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
                    </Field>
                    <Field required label="Message">
                        <Textarea rows={7} value={editing.body} placeholder="What the team needs to know…"
                            style={{ minHeight: 130 }}
                            onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                    </Field>
                    <SendDateField form={editing} setForm={setEditing} />
                    <AudienceField form={editing} setForm={setEditing} people={people} departments={departments} scope="Whole Team" />
                    <Field label="Expire Date (Optional)" hint="Leave blank to keep it up">
                        <Input type="date" value={editing.expiresAt}
                            min={editing.sendMode === 'later' && !editing.sentAt ? editing.sendDate : undefined}
                            onChange={(e) => setEditing({ ...editing, expiresAt: e.target.value })} />
                    </Field>
                    <AttachmentsField form={editing} setForm={setEditing} />
                </Modal>
            )}
        </Page>
    );
}
