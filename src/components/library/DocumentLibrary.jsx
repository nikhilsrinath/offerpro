import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import {
    Page, Toolbar, Row, Btn, Seg, Search, Table, Tr, Td, Empty, Loading, Muted, Modal,
    Field, Input, Select, Textarea, Status, StatBand, ConfirmBtn,
} from '../ui/edge';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useT } from '../ui/edgeUtils';
import { useOrg } from '../../context/OrgContext';
import { useToast } from '../shared/Toast';
import { orgStore } from '../../services/orgStore';
import {
    libraryService, CATEGORIES, COLLECTIONS, collectionOf, categoryLabel, validateLibraryFile,
    titleFromFileName, READABLE_HINT,
} from '../../services/libraryService';

/* ══════════════════════════════════════════════════════════════════════════
   Document library: General Documents, Organisational Process Assets and
   the Lessons Learned Register. Three registers, one way of working: the
   switch at the top picks the register, and uploads land in it.

   Anything can be stored. What EdgeBrain can read (PDF, Office, sheets, text,
   images) is turned into Markdown and indexed on upload, so the copilot and
   EdgeBrain Ask can quote it with the file and page it came from. The status
   column says, per file, whether the AI can read it and why not.
   ══════════════════════════════════════════════════════════════════════════ */

const EMPTY = new Map();

const STATUS = {
    ready:       { tone: 'up',      label: 'Readable by AI' },
    partial:     { tone: 'neutral', label: 'Partly readable' },
    pending:     { tone: 'mute',    label: 'Waiting to read' },
    processing:  { tone: 'mute',    label: 'Reading…' },
    failed:      { tone: 'down',    label: 'Could not read' },
    unsupported: { tone: 'mute',    label: 'Stored only' },
};

const METHOD = {
    pdf_text: 'PDF text', ai_ocr: 'AI transcription (scan)', ai_vision: 'AI image reading',
    docx: 'Word', pptx: 'Slides', sheet: 'Spreadsheet', odf: 'OpenDocument',
    html: 'HTML', rtf: 'RTF', markdown: 'Markdown', text: 'Text', code: 'Text',
};

function fmtSize(b) {
    if (!b) return '-';
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${Math.round(b / 1024)} KB`;
    return `${(b / 1048576).toFixed(1)} MB`;
}

function fmtDate(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function typeOf(doc) {
    const m = String(doc.file_name).toLowerCase().match(/\.([a-z0-9]{1,8})$/);
    return m ? m[1].toUpperCase() : (doc.mime_type || 'FILE').split('/').pop().toUpperCase();
}

// Where each register lives: General Documents is the page itself.
const REGISTER_PATHS = { general: '', opa: 'process-assets', lessons: 'lessons-learned' };
const registerPath = (id) => '/document-library' + (REGISTER_PATHS[id] ? '/' + REGISTER_PATHS[id] : '');
const registerOfPath = (pathname) => {
    const sub = pathname.split('/')[2] || '';
    return Object.keys(REGISTER_PATHS).find((id) => REGISTER_PATHS[id] === sub) || 'general';
};

export default function DocumentLibrary() {
    const t = useT();
    const { activeOrg } = useOrg();
    const orgId = activeOrg?.id;
    const inputRef = useRef(null);

    const [docs, setDocs] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('all');

    // The register is the last part of the path (/document-library/process-assets),
    // so a link or a refresh lands on it; General Documents is the bare page.
    const location = useLocation();
    const navigate = useNavigate();
    const collection = registerOfPath(location.pathname);
    const register = collectionOf(collection);
    const setCollection = (id) => {
        setCategory('all');
        navigate(registerPath(id), { replace: true });
    };
    // Older links named the register in ?type=.
    const legacyType = new URLSearchParams(location.search).get('type');
    const [inside, setInside] = useState(new Map());
    const [queue, setQueue] = useState([]);
    const [openId, setOpenId] = useState(null);
    const [dragging, setDragging] = useState(false);

    const canCreate = orgStore.can('library_documents', 'create');
    const canEdit = orgStore.can('library_documents', 'edit');
    const canDelete = orgStore.can('library_documents', 'delete');

    const refresh = useCallback(async () => {
        if (!orgId) return;
        try {
            setDocs(await libraryService.list(orgId));
            setLoadError('');
        } catch (e) {
            setLoadError(e.message || 'The library could not be loaded.');
            setDocs([]);
        }
    }, [orgId]);

    // A switch of organisation remounts the list rather than flashing the old one.
    const [loadedFor, setLoadedFor] = useState(orgId);
    if (loadedFor !== orgId) { setLoadedFor(orgId); setDocs(null); }

    useEffect(() => {
        if (!orgId) return undefined;
        let live = true;
        libraryService.list(orgId)
            .then((rows) => { if (live) { setDocs(rows); setLoadError(''); } })
            .catch((e) => { if (live) { setLoadError(e.message || 'The library could not be loaded.'); setDocs([]); } });
        return () => { live = false; };
    }, [orgId]);

    // Search inside the files as well as their names, debounced: it is a
    // full-text query per keystroke otherwise. Under three characters the
    // in-document matches are simply ignored (see `hits` below).
    const q3 = query.trim();
    useEffect(() => {
        if (q3.length < 3) return undefined;
        const id = setTimeout(() => {
            libraryService.searchInside(orgId, q3).then(setInside).catch(() => setInside(new Map()));
        }, 300);
        return () => clearTimeout(id);
    }, [q3, orgId]);
    const hits = q3.length >= 3 ? inside : EMPTY;

    const upload = useCallback(async (files) => {
        const list = Array.from(files || []);
        if (!list.length) return;
        const jobs = list.map((f) => ({
            key: crypto.randomUUID(), name: f.name, file: f, state: 'queued',
            error: validateLibraryFile(f), register: collectionOf(collection).short,
        }));
        setQueue((q) => [...jobs.map(({ file: _f, ...j }) => ({ ...j, state: j.error ? 'failed' : 'queued' })), ...q]);
        const set = (key, patch) => setQueue((q) => q.map((j) => (j.key === key ? { ...j, ...patch } : j)));

        let ok = 0;
        // One at a time: each read can take a while, and a burst of parallel
        // reads is how a plan's AI allowance disappears on one drag-and-drop.
        for (const job of jobs) {
            if (job.error) continue;
            set(job.key, { state: 'working' });
            try {
                const row = await libraryService.upload(orgId, job.file, {
                    title: titleFromFileName(job.name),
                    category: category !== 'all' ? category : 'general',
                    collection,
                });
                ok += 1;
                set(job.key, { state: 'done', status: row.extraction_status, error: row.extraction_error });
                setDocs((d) => [row, ...(d || []).filter((x) => x.id !== row.id)]);
            } catch (e) {
                set(job.key, { state: 'failed', error: e.message || 'Upload failed' });
            }
        }
        refresh();
    }, [orgId, category, collection, refresh]);

    const onDrop = (e) => {
        e.preventDefault();
        setDragging(false);
        if (canCreate) upload(e.dataTransfer.files);
    };

    // This register's documents; everything below the switch works on these.
    const inRegister = useMemo(() => (docs || []).filter((d) => d.collection === collection), [docs, collection]);
    const counts = useMemo(() => {
        const c = { general: 0, opa: 0, lessons: 0 };
        for (const d of docs || []) if (d.collection in c) c[d.collection] += 1;
        return c;
    }, [docs]);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return inRegister.filter((d) => {
            if (category !== 'all' && d.category !== category) return false;
            if (!q) return true;
            return hits.has(d.id)
                || [d.title, d.file_name, d.description, d.summary, ...(d.tags || [])]
                    .some((v) => String(v || '').toLowerCase().includes(q));
        });
    }, [inRegister, category, query, hits]);

    const stats = useMemo(() => {
        const all = inRegister;
        return [
            { label: 'Documents', value: all.length },
            { label: 'Readable by AI', value: all.filter((d) => d.chunk_count > 0).length,
              note: all.length ? `${Math.round(100 * all.filter((d) => d.chunk_count > 0).length / all.length)}% of this register` : undefined },
            { label: 'Passages indexed', value: all.reduce((a, d) => a + (d.chunk_count || 0), 0) },
            { label: 'Storage', value: fmtSize(all.reduce((a, d) => a + (d.size_bytes || 0), 0)) },
        ];
    }, [inRegister]);

    const catOptions = useMemo(() => {
        const present = new Set(inRegister.map((d) => d.category));
        return [{ id: 'all', label: 'All' }, ...CATEGORIES.filter((c) => present.has(c.id) || c.id === category)];
    }, [inRegister, category]);

    const active = queue.filter((j) => j.state === 'queued' || j.state === 'working').length;

    if (legacyType && REGISTER_PATHS[legacyType] !== undefined) return <Navigate to={registerPath(legacyType)} replace />;

    return (
        <Page>
            <div
                onDragOver={(e) => { if (canCreate) { e.preventDefault(); setDragging(true); } }}
                onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
                onDrop={onDrop}
                style={{ position: 'relative', minHeight: '100%' }}
            >
                <Toolbar right={canCreate && (
                    <>
                        <input
                            ref={inputRef} type="file" multiple hidden
                            aria-label="Choose files to upload"
                            onChange={(e) => { upload(e.target.files); e.target.value = ''; }}
                        />
                        <Btn primary onClick={() => inputRef.current?.click()} disabled={!orgId}>
                            <Upload size={13} aria-hidden="true" /> Upload files
                        </Btn>
                    </>
                )}>
                    <div className="edge-scroll" style={{ maxWidth: '100%', overflowX: 'auto' }}>
                        <Seg
                            label="Register" value={collection} onChange={setCollection}
                            options={COLLECTIONS.map((c) => ({
                                id: c.id, label: c.label, count: docs ? counts[c.id] : undefined,
                            }))}
                        />
                    </div>
                </Toolbar>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                    <Search value={query} onChange={setQuery} placeholder="Search names and inside documents…" width={280} />
                    {catOptions.length > 2 && (
                        <Seg value={category} onChange={setCategory} options={catOptions} size="sm" label="Category" />
                    )}
                    <div style={{ flex: 1 }} />
                    <span style={{ fontSize: 12, color: t.faint, lineHeight: 1.5 }}>{register.blurb}</span>
                </div>

                <StatBand items={stats} />

                {queue.length > 0 && (
                    <UploadOverlay
                        queue={queue} active={active}
                        onMore={() => { setQueue([]); inputRef.current?.click(); }}
                        onClose={() => setQueue([])}
                    />
                )}

                {loadError && (
                    <div role="alert" style={{ marginBottom: 14, fontSize: 13, color: t.down }}>
                        {loadError}
                    </div>
                )}

                {docs === null ? <Loading>Loading the library…</Loading> : (
                    <Table
                        cols={[
                            { key: 'n', label: 'Document' }, { key: 'c', label: 'Category' },
                            { key: 't', label: 'Type' }, { key: 's', label: 'AI status' },
                            { key: 'd', label: 'Added' }, { key: 'x', label: '', align: 'right' },
                        ]}
                        empty={shown.length === 0 && (
                            <Empty action={canCreate && !query && (
                                <Btn primary onClick={() => inputRef.current?.click()}>Upload the first file</Btn>
                            )}>
                                {query || category !== 'all'
                                    ? `Nothing in ${register.label} matches that.`
                                    : <>Nothing in {register.label} yet. {register.blurb} Drop files anywhere
                                        on this page. {READABLE_HINT}</>}
                            </Empty>
                        )}
                    >
                        {shown.map((d) => {
                            const hit = hits.get(d.id);
                            const st = STATUS[d.extraction_status] || STATUS.pending;
                            return (
                                <Tr key={d.id} onClick={() => setOpenId(d.id)} label={`Open ${d.title}`}>
                                    <Td>
                                        <div style={{ fontSize: 13.5, color: t.text }}>{d.title}</div>
                                        <Muted>{d.file_name}{d.page_count ? ` · ${d.page_count} ${d.extraction_method === 'pptx' ? 'slides' : d.extraction_method === 'sheet' ? 'sheets' : 'pages'}` : ''}</Muted>
                                        {hit && (
                                            <div style={{ fontSize: 12, color: t.dim, marginTop: 4, lineHeight: 1.5 }}>
                                                {hit.heading && <span style={{ color: t.faint }}>{hit.heading} · </span>}{hit.snippet}
                                            </div>
                                        )}
                                    </Td>
                                    <Td muted nowrap>{categoryLabel(d.category)}</Td>
                                    <Td muted nowrap>{typeOf(d)} · {fmtSize(d.size_bytes)}</Td>
                                    <Td nowrap><Status tone={st.tone}>{st.label}</Status></Td>
                                    <Td muted nowrap>{fmtDate(d.created_at)}</Td>
                                    <Td align="right" nowrap>
                                        <Btn size="sm" onClick={(e) => { e.stopPropagation(); setOpenId(d.id); }} aria-label={`View ${d.title}`}>View</Btn>
                                    </Td>
                                </Tr>
                            );
                        })}
                    </Table>
                )}

                {dragging && (
                    <div aria-hidden="true" style={{
                        position: 'absolute', inset: 0, zIndex: 30, display: 'grid', placeItems: 'center',
                        border: `2px dashed ${t.lineStrong}`, borderRadius: 12,
                        background: t.isDark ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.8)',
                        fontSize: 14.5, color: t.text, pointerEvents: 'none',
                    }}>Drop to add to {register.label}</div>
                )}
            </div>

            {openId && (
                <DocumentSheet
                    id={openId} orgId={orgId}
                    canEdit={canEdit} canDelete={canDelete}
                    onClose={() => setOpenId(null)}
                    onChanged={(row) => {
                        setDocs((d) => (d || []).map((x) => (x.id === row.id ? { ...x, ...row } : x)));
                        // Moved to another register: it leaves this list, so the sheet goes with it.
                        if (row.collection && row.collection !== collection) setOpenId(null);
                    }}
                    onRemoved={(id) => { setDocs((d) => (d || []).filter((x) => x.id !== id)); setOpenId(null); }}
                />
            )}
        </Page>
    );
}

function UploadOverlay({ queue, active, onMore, onClose }) {
    const t = useT();
    const failed = queue.filter((j) => j.state === 'failed');
    const added = queue.length - failed.length;
    const busy = active > 0;
    const accent = busy ? t.text : failed.length && !added ? t.down : t.up;
    return (
        <div role="dialog" aria-modal="true" aria-label={busy ? 'Uploading' : 'Upload finished'} style={{
            position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center',
            background: t.isDark ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.75)',
        }}>
            <style>{`
                @keyframes edge-up-spin { to { transform: rotate(360deg); } }
                @keyframes edge-up-draw { to { stroke-dashoffset: 0; } }
                @keyframes edge-up-pop { 0% { transform: scale(.6); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
                @media (prefers-reduced-motion: reduce) { .edge-up-anim { animation-duration: 0.01s !important; } }
            `}</style>
            <div style={{
                width: 'min(380px, calc(100vw - 32px))', padding: '28px 24px 22px', textAlign: 'center',
                background: t.panel, border: '1px solid ' + t.line, borderRadius: 14,
                boxShadow: '0 12px 40px rgba(0,0,0,.18)',
            }}>
                <div style={{ display: 'grid', placeItems: 'center', height: 72 }}>
                    {busy ? (
                        <svg className="edge-up-anim" width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"
                            style={{ animation: 'edge-up-spin .9s linear infinite' }}>
                            <circle cx="28" cy="28" r="23" fill="none" stroke={t.line} strokeWidth="4" />
                            <path d="M28 5a23 23 0 0 1 23 23" fill="none" stroke={accent} strokeWidth="4" strokeLinecap="round" />
                        </svg>
                    ) : (
                        <svg className="edge-up-anim" width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"
                            style={{ animation: 'edge-up-pop .35s ease-out both' }}>
                            <circle cx="32" cy="32" r="28" fill="none" stroke={accent} strokeWidth="4" />
                            {failed.length && !added ? (
                                <path className="edge-up-anim" d="M22 22l20 20M42 22L22 42" fill="none" stroke={accent} strokeWidth="4" strokeLinecap="round"
                                    strokeDasharray="60" strokeDashoffset="60" style={{ animation: 'edge-up-draw .4s .25s ease-out forwards' }} />
                            ) : (
                                <path className="edge-up-anim" d="M20 33l8 8 17-18" fill="none" stroke={accent} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
                                    strokeDasharray="40" strokeDashoffset="40" style={{ animation: 'edge-up-draw .4s .25s ease-out forwards' }} />
                            )}
                        </svg>
                    )}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: t.text, marginTop: 6 }} aria-live="polite">
                    {busy ? 'Uploading…' : failed.length && !added ? 'Upload failed'
                        : `${added} file${added === 1 ? '' : 's'} uploaded`}
                </div>
                <div style={{ fontSize: 12.5, color: t.dim, marginTop: 4, lineHeight: 1.5 }}>
                    {busy ? `${active} of ${queue.length} remaining: reading can take up to a minute per file`
                        : failed.length && added ? `${failed.length} could not be added` : ''}
                </div>
                {!busy && failed.length > 0 && (
                    <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, textAlign: 'left', fontSize: 12, color: t.down }}>
                        {failed.map((j) => <li key={j.key} style={{ padding: '2px 0' }}>{j.name} · {j.error}</li>)}
                    </ul>
                )}
                {!busy && (
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18 }}>
                        <Btn onClick={onMore}>Upload more</Btn>
                        <Btn primary onClick={onClose}>Close</Btn>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ── one document ─────────────────────────────────────────────────────────── */

function DocumentSheet({ id, orgId, canEdit, canDelete, onClose, onChanged, onRemoved }) {
    const t = useT();
    const toast = useToast();
    const [doc, setDoc] = useState(null);
    const [form, setForm] = useState(null);
    const [saving, setSaving] = useState(false);
    const [reading, setReading] = useState(false);

    const load = useCallback(async () => {
        try {
            const d = await libraryService.get(id);
            setDoc(d);
            setForm(d ? {
                title: d.title, category: d.category, collection: d.collection || 'general',
                description: d.description || '',
                tags: (d.tags || []).join(', '),
            } : null);
        } catch (e) { toast(e.message, 'error'); onClose(); }
    }, [id, toast, onClose]);

    useEffect(() => { load(); }, [load]);

    const dirty = doc && form && (
        form.title !== doc.title || form.category !== doc.category
        || form.collection !== (doc.collection || 'general')
        || form.description !== (doc.description || '') || form.tags !== (doc.tags || []).join(', ')
    );

    const save = async () => {
        if (!form.title.trim()) { toast('A document needs a title', 'error'); return; }
        setSaving(true);
        try {
            const moved = form.collection !== (doc.collection || 'general');
            const row = await libraryService.update(doc.id, {
                title: form.title.trim(), category: form.category,
                ...(moved ? { collection: form.collection } : {}),
                description: form.description.trim() || null,
                tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20),
            });
            setDoc((d) => ({ ...d, ...row }));
            onChanged(row);
            toast(moved ? `Moved to ${collectionOf(row.collection).label}` : 'Saved', 'success');
        } catch (e) { toast(e.message, 'error'); } finally { setSaving(false); }
    };

    const reread = async () => {
        setReading(true);
        try {
            const r = await libraryService.process(orgId, doc.id);
            await load();
            onChanged({ id: doc.id, extraction_status: r.status, chunk_count: r.passages, page_count: r.pages });
            toast(r.status === 'ready' ? `Read ${r.passages} passage${r.passages === 1 ? '' : 's'}` : (r.error || 'Read finished'), r.status === 'failed' ? 'error' : 'success');
        } catch (e) { toast(e.message, 'error'); } finally { setReading(false); }
    };

    const remove = async () => {
        try {
            await libraryService.remove(doc);
            toast('Document deleted', 'success');
            onRemoved(doc.id);
        } catch (e) { toast(e.message, 'error'); }
    };

    const open = async (download) => {
        try { await libraryService.open(doc, { download }); } catch (e) { toast(e.message, 'error'); }
    };

    const st = doc ? (STATUS[doc.extraction_status] || STATUS.pending) : null;

    return (
        <Modal
            open onClose={onClose} width={760}
            title={doc?.title || 'Document'}
            note={doc ? `${doc.file_name} · ${fmtSize(doc.size_bytes)} · added ${fmtDate(doc.created_at)}` : undefined}
            footer={doc && (
                <>
                    {canDelete && (
                        <ConfirmBtn
                            label="Delete" title="Delete document"
                            message={`Delete “${doc.title}”? The file and everything EdgeBrain read from it are removed. This cannot be undone.`}
                            onConfirm={remove}
                        />
                    )}
                    <div style={{ flex: 1 }} />
                    <Btn onClick={() => open(false)}>Open original</Btn>
                    <Btn onClick={() => open(true)}>Download</Btn>
                    {canEdit && <Btn primary onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save details'}</Btn>}
                </>
            )}
        >
            {!doc || !form ? <Loading /> : (
                <div style={{ display: 'grid', gap: 16 }}>
                    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                        <Field required label="Title">
                            <Input value={form.title} maxLength={200} disabled={!canEdit}
                                onChange={(e) => setForm({ ...form, title: e.target.value })} />
                        </Field>
                        <Field label="Register">
                            <Select value={form.collection} disabled={!canEdit}
                                onChange={(e) => setForm({ ...form, collection: e.target.value })}>
                                {COLLECTIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </Select>
                        </Field>
                        <Field label="Category">
                            <Select value={form.category} disabled={!canEdit}
                                onChange={(e) => setForm({ ...form, category: e.target.value })}>
                                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </Select>
                        </Field>
                        <Field label="Tags" hint="Comma-separated">
                            <Input value={form.tags} disabled={!canEdit}
                                onChange={(e) => setForm({ ...form, tags: e.target.value })} />
                        </Field>
                    </div>
                    <Field label="Description" hint="What this document is for, EdgeBrain reads this too" wide>
                        <Textarea rows={2} value={form.description} maxLength={2000} disabled={!canEdit}
                            onChange={(e) => setForm({ ...form, description: e.target.value })} />
                    </Field>

                    <section aria-labelledby="lib-ai-h" style={{ border: '1px solid ' + t.line, borderRadius: 10, overflow: 'hidden' }}>
                        <Row style={{ padding: '10px 13px', borderBottom: '1px solid ' + t.lineSoft }} wrap>
                            <h3 id="lib-ai-h" style={{ margin: 0, fontSize: 13.5, fontWeight: 500, color: t.text }}>What EdgeBrain Read</h3>
                            <Status tone={st.tone}>{st.label}</Status>
                            {doc.extraction_method && <Muted>via {METHOD[doc.extraction_method] || doc.extraction_method}</Muted>}
                            {doc.chunk_count > 0 && <Muted>{doc.chunk_count} passage{doc.chunk_count === 1 ? '' : 's'} · {(doc.char_count || 0).toLocaleString('en-IN')} characters</Muted>}
                            <div style={{ flex: 1 }} />
                            {doc.content_md && <Btn size="sm" onClick={() => libraryService.downloadMarkdown(doc)}>Download .md</Btn>}
                            {canEdit && <Btn size="sm" onClick={reread} disabled={reading}>{reading ? 'Reading…' : 'Read again'}</Btn>}
                        </Row>
                        {doc.extraction_error && (
                            <div role="note" style={{ padding: '9px 13px', fontSize: 12.5, color: doc.extraction_status === 'failed' ? t.down : t.dim, borderBottom: '1px solid ' + t.lineSoft }}>
                                {doc.extraction_error}
                            </div>
                        )}
                        {doc.content_md ? (
                            <pre
                                className="edge-scroll" tabIndex={0} aria-label="Extracted text as Markdown"
                                style={{
                                    margin: 0, padding: '12px 13px', maxHeight: 360, overflow: 'auto',
                                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                    fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
                                    fontSize: 12.5, lineHeight: 1.6, color: t.dim, background: t.panelAlt,
                                }}
                            >{doc.content_md}</pre>
                        ) : (
                            <Empty>
                                {doc.extraction_status === 'processing' || doc.extraction_status === 'pending'
                                    ? 'This file has not been read yet.'
                                    : 'No text was taken from this file, so the AI cannot answer from it. The original is still stored.'}
                            </Empty>
                        )}
                    </section>
                </div>
            )}
        </Modal>
    );
}
