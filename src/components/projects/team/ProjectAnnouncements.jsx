import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Panel, Row, Btn, Seg, Search, Field, Input, Textarea, Empty, Loading, Modal, ConfirmBtn, Status,
} from '../../ui/edge';
import { useT } from '../../ui/edgeUtils';
import { useToast } from '../../shared/Toast';
import { orgStore } from '../../../services/orgStore';
import {
    announcementService, PRIORITIES, fmtSize, isExpired, isScheduled, audienceOf,
} from '../../../services/announcementService';
import { useProjectPeople, teamError, needsMigration } from './teamData';
import AttachmentsField from '../../shared/AttachmentsField';
import { SendDateField, AudienceField } from '../../shared/announcementFields';
import { sendFormOf, sendAtOf, datesProblem, whenText, audienceText } from '../../shared/announcementForm';

/* ══════════════════════════════════════════════════════════════════════════
   Team Management › Announcements: notices for this project's people only.

   The same announcements as the company board, with a project on them: the
   database lets a project notice be read by the project's current members
   (and by whoever may read every announcement), and nobody else. Pinned
   first, then newest; urgent and important say so in words at the top of
   the card, and a coloured edge repeats it. A notice can go to members
   picked by name, and out on a later send date (0111).
   ══════════════════════════════════════════════════════════════════════════ */

const blank = () => ({
    title: '', body: '', priority: 'normal', isPinned: false, expiresAt: '', keep: [], files: [], dropped: [],
    audienceMode: 'everyone', audience: [], hadAudience: false, ...sendFormOf(null),
});
const PRIORITY = Object.fromEntries(PRIORITIES.map((p) => [p.id, p]));
const RANK = { urgent: 0, important: 1, normal: 2 };

const fmtWhen = (iso) => (iso
    ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '-');

export default function ProjectAnnouncements({ project }) {
    const t = useT();
    const toast = useToast();
    const team = useProjectPeople(project);
    const orgId = orgStore.getOrgId();
    const [items, setItems] = useState([]);
    const [state, setState] = useState('loading');   // loading | ready | missing | error
    const [error, setError] = useState('');
    const [show, setShow] = useState('board');
    const [priority, setPriority] = useState('all');
    const [query, setQuery] = useState('');
    const [editing, setEditing] = useState(null);
    const [busy, setBusy] = useState(false);

    const canCreate = orgStore.can('announcements', 'create');
    const canEdit = orgStore.can('announcements', 'edit');
    const canDelete = orgStore.can('announcements', 'delete');

    const load = useCallback(async () => {
        if (!orgId) return;
        try {
            setItems(await announcementService.listForProject(orgId, project.id));
            setState('ready');
        } catch (e) {
            if (needsMigration(e)) { setState('missing'); return; }
            setError(teamError(e, 'Announcements could not be loaded.'));
            setState('error');
        }
    }, [orgId, project.id]);

    useEffect(() => { setState('loading'); load(); }, [load]);

    const authorOf = useCallback((userId) => {
        const e = team.employees.find((x) => x.user_id && x.user_id === userId);
        return e?.name || (userId ? 'A former member' : 'Opstead');
    }, [team.employees]);

    // Who can be picked by name: the project's current people.
    const current = team.current;
    const people = useMemo(() => current
        .map((p) => ({ id: p.id, name: p.name, sub: [p.designation, p.department].filter(Boolean).join(' · ') })), [current]);
    const empById = team.empById;
    const nameOf = useCallback((id) => empById.get(id)?.name || '', [empById]);
    const [problem, setProblem] = useState('');

    const scheduled = useMemo(() => items.filter((a) => isScheduled(a)), [items]);
    const live = useMemo(() => items.filter((a) => !isScheduled(a) && !isExpired(a)), [items]);
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (show === 'board' ? live : show === 'scheduled' ? scheduled : items)
            .filter((a) => priority === 'all' || a.priority === priority)
            .filter((a) => !q || `${a.title} ${a.body} ${(a.attachments || []).map((f) => f.name).join(' ')}`.toLowerCase().includes(q))
            .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned)
                || new Date(b.published_at || 0) - new Date(a.published_at || 0));
    }, [items, live, scheduled, show, priority, query]);


    const save = async (form) => {
        const issue = datesProblem(form)
            || (form.audienceMode === 'members' && form.audience.length === 0 ? 'Pick at least one member, or send it to everyone on the project.' : '');
        if (issue) { setProblem(issue); return; }
        setProblem('');
        setBusy(true);
        try {
            await announcementService.publishForProject(orgId, project.id, {
                id: form.id, title: form.title, body: form.body, priority: form.priority, isPinned: form.isPinned,
                sendAt: sendAtOf(form),
                expiresAt: form.expiresAt || null,
                audience: form.audienceMode === 'members' ? form.audience : [], hadAudience: form.hadAudience,
                keep: form.keep, files: form.files, dropped: form.dropped,
            });
            const later = form.sendMode === 'later' && !form.sentAt;
            setEditing(null);
            await load();
            toast(later ? `Scheduled for ${whenText(sendAtOf(form))}` : form.id ? 'Announcement updated' : 'Announcement posted to the project', 'success');
        } catch (e) {
            setProblem(teamError(e, 'Could not publish.'));
        } finally {
            setBusy(false);
        }
    };

    const togglePin = async (a) => {
        setBusy(true);
        try {
            await announcementService.setPinned(a.id, !a.is_pinned);
            setItems((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_pinned: !a.is_pinned } : x)));
            toast(a.is_pinned ? 'Unpinned' : 'Pinned to the top', 'success');
        } catch (e) {
            toast(teamError(e), 'error');
        } finally {
            setBusy(false);
        }
    };

    const remove = async (a) => {
        try {
            await announcementService.removeWithFiles(a);
            setItems((prev) => prev.filter((x) => x.id !== a.id));
            toast('Announcement deleted', 'success');
        } catch (e) {
            toast(teamError(e, 'Could not delete.'), 'error');
        }
    };

    const openFile = async (f) => {
        // Opened before the await so a popup blocker sees the click.
        const w = window.open('', '_blank');
        try {
            const url = await announcementService.attachmentUrl(f.path);
            if (w) { w.opener = null; w.location.href = url; } else window.location.assign(url);
        } catch (e) {
            w?.close();
            toast(teamError(e, 'That file could not be opened.'), 'error');
        }
    };

    const openEditor = (a) => {
        setProblem('');
        if (!a) { setEditing(blank()); return; }
        const picked = audienceOf(a);
        setEditing({
            id: a.id, title: a.title, body: a.body, priority: a.priority || 'normal', isPinned: a.is_pinned,
            expiresAt: a.expires_at ? a.expires_at.slice(0, 10) : '', keep: a.attachments || [], files: [], dropped: [],
            audienceMode: picked.length ? 'members' : 'everyone', audience: picked, hadAudience: picked.length > 0,
            ...sendFormOf(a),
        });
    };

    if (state === 'loading') return <Panel><Loading>Loading announcements…</Loading></Panel>;
    if (state === 'missing') {
        return <Panel><Empty>Project announcements are not set up on this workspace yet. They need database migration 0073.</Empty></Panel>;
    }
    if (state === 'error') {
        return <Panel><Empty action={<Btn onClick={() => { setState('loading'); load(); }}>Try again</Btn>}>{error}</Empty></Panel>;
    }

    return (
        <div style={{ display: 'grid', gap: 12 }}>
            <Row gap={8} wrap>
                <Seg size="sm" value={show} onChange={setShow} label="Show" options={[
                    { id: 'board', label: 'Current' },
                    { id: 'scheduled', label: `Scheduled${scheduled.length ? ` (${scheduled.length})` : ''}` },
                    { id: 'all', label: 'Everything' },
                ]} />
                <Seg size="sm" value={priority} onChange={setPriority} label="Priority" options={[
                    { id: 'all', label: 'Any priority' },
                    ...[...PRIORITIES].sort((a, b) => RANK[a.id] - RANK[b.id]),
                ]} />
                {items.length > 0 && <Search value={query} onChange={setQuery} placeholder="Search announcements" width={220} />}
                <div style={{ flex: 1 }} />
                {canCreate && <Btn primary onClick={() => openEditor(null)}>New Announcement</Btn>}
            </Row>
            

            {shown.length === 0 ? (
                <Panel>
                    <Empty action={items.length === 0 && canCreate
                        ? <Btn primary onClick={() => openEditor(null)}>Post the first one</Btn>
                        : (query || priority !== 'all') && <Btn onClick={() => { setQuery(''); setPriority('all'); }}>Clear filters</Btn>}>
                        {items.length === 0
                            ? 'No announcements on this project yet. Post one to reach everyone on the team at once.'
                            : show === 'scheduled' && scheduled.length === 0 ? 'Nothing scheduled. Pick Schedule under Send Date to post one later.'
                                : show === 'board' && live.length === 0 ? 'Nothing current. Every announcement here has expired or is still scheduled.' : 'No announcements match these filters.'}
                    </Empty>
                </Panel>
            ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                    {shown.map((a) => {
                        const expired = isExpired(a);
                        const later = isScheduled(a);
                        const who = audienceText(a, { nameOf, scope: 'Everyone on the project' });
                        const pr = PRIORITY[a.priority] || PRIORITY.normal;
                        const edge = a.priority === 'urgent' ? t.down : a.priority === 'important' ? '#f59e0b' : null;
                        const edited = !later && a.updated_at && a.created_at && new Date(a.updated_at) - new Date(a.created_at) > 60000
                            && new Date(a.updated_at) - new Date(a.published_at) > 60000;
                        return (
                            <article key={a.id} aria-label={a.title} style={{
                                border: '1px solid ' + (a.is_pinned ? t.lineStrong : t.line),
                                boxShadow: edge ? `inset 3px 0 0 ${edge}` : later ? `inset 3px 0 0 ${t.teal}` : undefined,
                                borderRadius: 10, padding: '14px 14px 12px 16px', background: t.panel,
                                opacity: expired ? 0.62 : 1,
                            }}>
                                <Row gap={10} align="flex-start" wrap style={{ marginBottom: 8 }}>
                                    <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                                        <Row gap={10} wrap style={{ marginBottom: 4 }}>
                                            {a.is_pinned && <span style={{ fontSize: 11, letterSpacing: 0, color: t.faint }}>Pinned</span>}
                                            {a.priority !== 'normal' && <Status tone={pr.tone}>{pr.label}</Status>}
                                        </Row>
                                        <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 500, color: t.text, letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>
                                            {a.title}
                                        </h3>
                                    </div>
                                    <Row gap={6} wrap>
                                        {canEdit && !later && <Btn size="sm" onClick={() => togglePin(a)} disabled={busy}>{a.is_pinned ? 'Unpin' : 'Pin'}</Btn>}
                                        {canEdit && <Btn size="sm" onClick={() => openEditor(a)}>Edit</Btn>}
                                        {canDelete && (
                                            <ConfirmBtn label="Delete" title="Delete announcement"
                                                message="It is removed for everyone on the project, with its attachments. This cannot be undone."
                                                onConfirm={() => remove(a)} />
                                        )}
                                    </Row>
                                </Row>

                                <p style={{ margin: '0 0 11px', fontSize: 13, color: t.dim, lineHeight: 1.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{a.body}</p>

                                {a.attachments?.length > 0 && (
                                    <ul aria-label="Attachments" style={{ listStyle: 'none', margin: '0 0 11px', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {a.attachments.map((f) => (
                                            <li key={f.path}>
                                                <Btn size="sm" onClick={() => openFile(f)} aria-label={`Open attachment ${f.name}`}>
                                                    <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                                                    <span style={{ color: t.faint, fontSize: 11 }}>{fmtSize(f.size)}</span>
                                                </Btn>
                                            </li>
                                        ))}
                                    </ul>
                                )}

                                <Row gap={14} wrap style={{ paddingTop: 10, borderTop: '1px solid ' + t.lineSoft, fontSize: 11.5, color: t.faint }}>
                                    <span title={who.names || undefined}>
                                        <Status tone={who.names ? 'neutral' : 'mute'}>{who.label}</Status>
                                    </span>
                                    <span>{authorOf(a.created_by)}</span>
                                    {later
                                        ? <span style={{ color: t.accent, fontWeight: 500 }}>Scheduled · goes out {whenText(a.published_at)}</span>
                                        : <span>{fmtWhen(a.published_at)}</span>}
                                    {edited && <span>edited {fmtWhen(a.updated_at)}</span>}
                                    {a.expires_at && (
                                        <span style={{ color: expired ? t.down : t.faint }}>
                                            {expired ? 'Expired ' : 'Until '}{fmtWhen(a.expires_at).split(',')[0]}
                                        </span>
                                    )}
                                </Row>
                            </article>
                        );
                    })}
                </div>
            )}

            {editing && <Editor form={editing} setForm={setEditing} busy={busy} problem={problem} people={people}
                onClose={() => setEditing(null)} onSave={save} />}
        </div>
    );
}

function Editor({ form, setForm, busy, problem, people, onClose, onSave }) {
    return (
        <Modal open onClose={onClose} width={680}
            title={form.id ? 'Edit Announcement' : 'New Announcement'}
            note="Only this project’s people see it, or the members you pick"
            footer={<>
                <Btn onClick={onClose}>Cancel</Btn>
                <Btn primary disabled={busy || !form.title.trim() || !form.body.trim()} onClick={() => onSave(form)}>
                    {busy ? 'Saving…' : form.id ? 'Save' : form.sendMode === 'later' ? 'Schedule' : 'Post'}
                </Btn>
            </>}>
            {problem && <div role="alert" className="prod-form-error">{problem}</div>}
            {/* One field a row, as every side panel lays them out. Pinning is on the card. */}
            <Field required label="Title">
                <Input value={form.title} maxLength={200} placeholder="Sprint review moved to Thursday"
                    onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field required label="Message">
                <Textarea rows={6} value={form.body} placeholder="What the team needs to know…" style={{ minHeight: 120 }}
                    onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </Field>
            <Field label="Priority">
                <Seg size="sm" value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} label="Priority" options={PRIORITIES} />
            </Field>
            <SendDateField form={form} setForm={setForm} />
            <AudienceField form={form} setForm={setForm} people={people} scope="Everyone on the Project" />
            <Field label="Expire Date (Optional)" hint="Leave blank to keep it up">
                <Input type="date" value={form.expiresAt}
                    min={form.sendMode === 'later' && !form.sentAt ? form.sendDate : undefined}
                    onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
            </Field>
            <AttachmentsField form={form} setForm={setForm} />
        </Modal>
    );
}
