import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Panel, Row, Btn, Seg, Search, Field, Input, Textarea, Empty, Loading, Modal, ConfirmBtn, Status,
} from '../../ui/edge';
import { useT } from '../../ui/edgeUtils';
import { useToast } from '../../shared/Toast';
import { orgStore } from '../../../services/orgStore';
import {
    announcementService, PRIORITIES, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_COUNT,
} from '../../../services/announcementService';
import { useProjectPeople, teamError, needsMigration } from './teamData';

/* ══════════════════════════════════════════════════════════════════════════
   Team Management › Announcements — notices for this project's people only.

   The same announcements as the company board, with a project on them: the
   database lets a project notice be read by the project's current members
   (and by whoever may read every announcement), and nobody else. Pinned
   first, then newest; urgent and important say so in words at the top of
   the card, and a coloured edge repeats it.
   ══════════════════════════════════════════════════════════════════════════ */

const BLANK = { title: '', body: '', priority: 'normal', isPinned: false, expiresAt: '', keep: [], files: [], dropped: [] };
const isExpired = (a) => !!a.expires_at && new Date(a.expires_at) < new Date();
const PRIORITY = Object.fromEntries(PRIORITIES.map((p) => [p.id, p]));
const RANK = { urgent: 0, important: 1, normal: 2 };

const fmtWhen = (iso) => (iso
    ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—');
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((b || 0) / 1024))} KB`);

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
        return e?.name || (userId ? 'A former member' : 'EdgeOS');
    }, [team.employees]);

    const live = useMemo(() => items.filter((a) => !isExpired(a)), [items]);
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (show === 'board' ? live : items)
            .filter((a) => priority === 'all' || a.priority === priority)
            .filter((a) => !q || `${a.title} ${a.body} ${(a.attachments || []).map((f) => f.name).join(' ')}`.toLowerCase().includes(q))
            .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned)
                || new Date(b.published_at || 0) - new Date(a.published_at || 0));
    }, [items, live, show, priority, query]);

    const counts = useMemo(() => Object.fromEntries(PRIORITIES.map((p) => [p.id, live.filter((a) => a.priority === p.id).length])), [live]);

    const save = async (form) => {
        setBusy(true);
        try {
            await announcementService.publishForProject(orgId, project.id, {
                id: form.id, title: form.title, body: form.body, priority: form.priority, isPinned: form.isPinned,
                // A date input gives a local calendar day; expire at the end of it.
                expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
                keep: form.keep, files: form.files, dropped: form.dropped,
            });
            setEditing(null);
            await load();
            toast(form.id ? 'Announcement updated' : 'Announcement posted to the project', 'success');
        } catch (e) {
            toast(teamError(e, 'Could not publish.'), 'error');
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

    const openEditor = (a) => setEditing(a ? {
        id: a.id, title: a.title, body: a.body, priority: a.priority || 'normal', isPinned: a.is_pinned,
        expiresAt: a.expires_at ? a.expires_at.slice(0, 10) : '', keep: a.attachments || [], files: [], dropped: [],
    } : { ...BLANK });

    if (state === 'loading') return <Panel><Loading>Loading announcements…</Loading></Panel>;
    if (state === 'missing') {
        return <Panel><Empty>Project announcements are not set up on this workspace yet. They need database migration 0073.</Empty></Panel>;
    }
    if (state === 'error') {
        return <Panel><Empty action={<Btn onClick={() => { setState('loading'); load(); }}>Try again</Btn>}>{error}</Empty></Panel>;
    }

    return (
        <div style={{ display: 'grid', gap: 14 }}>
            <Row gap={8} wrap>
                <Seg size="sm" value={show} onChange={setShow} label="Show" options={[
                    { id: 'board', label: 'Current', count: live.length },
                    { id: 'all', label: 'Everything', count: items.length },
                ]} />
                <Seg size="sm" value={priority} onChange={setPriority} label="Priority" options={[
                    { id: 'all', label: 'Any priority' },
                    ...[...PRIORITIES].sort((a, b) => RANK[a.id] - RANK[b.id]).map((p) => ({ ...p, count: counts[p.id] })),
                ]} />
                {items.length > 0 && <Search value={query} onChange={setQuery} placeholder="Search announcements" width={220} />}
                <div style={{ flex: 1 }} />
                {canCreate && <Btn primary onClick={() => openEditor(null)}>New announcement</Btn>}
            </Row>
            <div style={{ fontSize: 12, color: t.faint, marginTop: -6 }}>
                Seen by the {team.current.length} {team.current.length === 1 ? 'person' : 'people'} on this project, and by whoever manages announcements.
            </div>

            {shown.length === 0 ? (
                <Panel>
                    <Empty action={items.length === 0 && canCreate
                        ? <Btn primary onClick={() => openEditor(null)}>Post the first one</Btn>
                        : (query || priority !== 'all') && <Btn onClick={() => { setQuery(''); setPriority('all'); }}>Clear filters</Btn>}>
                        {items.length === 0
                            ? 'No announcements on this project yet. Post one to reach everyone on the team at once.'
                            : show === 'board' && live.length === 0 ? 'Nothing current — every announcement here has expired.' : 'No announcements match these filters.'}
                    </Empty>
                </Panel>
            ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                    {shown.map((a) => {
                        const expired = isExpired(a);
                        const pr = PRIORITY[a.priority] || PRIORITY.normal;
                        const edge = a.priority === 'urgent' ? t.down : a.priority === 'important' ? '#f59e0b' : null;
                        const edited = a.updated_at && a.published_at && new Date(a.updated_at) - new Date(a.published_at) > 60000;
                        return (
                            <article key={a.id} aria-label={a.title} style={{
                                border: '1px solid ' + (a.is_pinned ? t.lineStrong : t.line),
                                boxShadow: edge ? `inset 3px 0 0 ${edge}` : undefined,
                                borderRadius: 10, padding: '14px 14px 12px 16px', background: t.panel,
                                opacity: expired ? 0.62 : 1,
                            }}>
                                <Row gap={10} align="flex-start" wrap style={{ marginBottom: 8 }}>
                                    <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                                        <Row gap={10} wrap style={{ marginBottom: 4 }}>
                                            {a.is_pinned && <span style={{ fontSize: 11, letterSpacing: '0.08em', color: t.faint }}>PINNED</span>}
                                            {a.priority !== 'normal' && <Status tone={pr.tone}>{pr.label}</Status>}
                                        </Row>
                                        <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 500, color: t.text, letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>
                                            {a.title}
                                        </h3>
                                    </div>
                                    <Row gap={6} wrap>
                                        {canEdit && <Btn size="sm" onClick={() => togglePin(a)} disabled={busy}>{a.is_pinned ? 'Unpin' : 'Pin'}</Btn>}
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
                                    <span>{authorOf(a.created_by)}</span>
                                    <span>{fmtWhen(a.published_at)}</span>
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

            {editing && <Editor form={editing} setForm={setEditing} busy={busy} onClose={() => setEditing(null)} onSave={save} />}
        </div>
    );
}

function Editor({ form, setForm, busy, onClose, onSave }) {
    const t = useT();
    const input = useRef(null);
    const [problem, setProblem] = useState('');
    const count = form.keep.length + form.files.length;

    const addFiles = (list) => {
        const files = [...list];
        const big = files.filter((f) => f.size > ATTACHMENT_MAX_BYTES);
        const ok = files.filter((f) => f.size <= ATTACHMENT_MAX_BYTES).slice(0, Math.max(0, ATTACHMENT_MAX_COUNT - count));
        setProblem(big.length
            ? `${big.map((f) => f.name).join(', ')} ${big.length === 1 ? 'is' : 'are'} over 10 MB.`
            : ok.length < files.length ? `At most ${ATTACHMENT_MAX_COUNT} attachments.` : '');
        setForm({ ...form, files: [...form.files, ...ok] });
        if (input.current) input.current.value = '';
    };

    return (
        <Modal open onClose={onClose} width={580}
            title={form.id ? 'Edit announcement' : 'New announcement'}
            note="Only this project’s people see it"
            footer={<>
                <Btn onClick={onClose}>Cancel</Btn>
                <Btn primary disabled={busy || !form.title.trim() || !form.body.trim()} onClick={() => onSave(form)}>
                    {busy ? 'Saving…' : form.id ? 'Save' : 'Post'}
                </Btn>
            </>}>
            <Field required label="Title">
                <Input value={form.title} maxLength={200} placeholder="Sprint review moved to Thursday"
                    onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <div style={{ height: 12 }} />
            <Field required label="Message">
                <Textarea rows={6} value={form.body} placeholder="What the team needs to know…" style={{ minHeight: 120 }}
                    onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </Field>
            <div style={{ height: 12 }} />
            <Row gap={13} align="flex-end" wrap>
                <div style={{ flex: '1 1 260px' }}>
                    <Field label="Priority">
                        <Seg value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} label="Priority" options={PRIORITIES} />
                    </Field>
                </div>
                <div style={{ flex: '1 1 160px' }}>
                    <Field label="Expires" hint="Blank keeps it up">
                        <Input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
                    </Field>
                </div>
            </Row>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12.5, color: t.dim, cursor: 'pointer', minHeight: 24 }}>
                <input type="checkbox" checked={form.isPinned} onChange={(e) => setForm({ ...form, isPinned: e.target.checked })} />
                Pin to the top
            </label>

            <div style={{ height: 14 }} />
            <fieldset style={{ border: 'none', margin: 0, padding: 0, minWidth: 0 }}>
                <legend style={{ padding: 0, fontSize: 10.5, letterSpacing: '0.09em', color: t.faint, marginBottom: 5 }}>
                    ATTACHMENTS ({count}/{ATTACHMENT_MAX_COUNT})
                </legend>
                <div style={{ display: 'grid', gap: 6 }}>
                    {[...form.keep.map((f) => ({ f, kept: true })), ...form.files.map((f) => ({ f, kept: false }))].map(({ f, kept }, i) => (
                        <Row key={(kept ? f.path : `new-${i}-${f.name}`)} gap={8} style={{
                            border: '1px solid ' + t.line, borderRadius: 7, padding: '5px 5px 5px 10px',
                        }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                            <span style={{ fontSize: 11, color: t.faint }}>{kept ? fmtSize(f.size) : `${fmtSize(f.size)} · new`}</span>
                            <Btn size="sm" aria-label={`Remove ${f.name}`} onClick={() => setForm(kept
                                ? { ...form, keep: form.keep.filter((x) => x !== f), dropped: [...form.dropped, f] }
                                : { ...form, files: form.files.filter((x) => x !== f) })}>Remove</Btn>
                        </Row>
                    ))}
                    <input ref={input} type="file" multiple aria-label="Add attachments" disabled={count >= ATTACHMENT_MAX_COUNT}
                        onChange={(e) => addFiles(e.target.files || [])}
                        style={{ fontSize: 12.5, color: t.dim, maxWidth: '100%' }} />
                    <span style={{ fontSize: 11, color: t.faint }}>Up to 10 MB each.</span>
                </div>
            </fieldset>
            {problem && <div role="alert" style={{ marginTop: 8, fontSize: 12.5, color: t.down }}>{problem}</div>}
        </Modal>
    );
}
