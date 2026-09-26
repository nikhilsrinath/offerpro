import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import {
    Page, Toolbar, Row, Btn, Seg, Search, Table, Tr, Td, Empty, Loading, Muted, Modal,
    Field, Input, Select, Textarea, Status, StatBand, ConfirmBtn, Panel,
} from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useOrg } from '../../context/OrgContext';
import { useToast } from '../shared/Toast';
import { orgStore } from '../../services/orgStore';
import {
    libraryService, CATEGORIES, categoryLabel, validateLibraryFile, titleFromFileName, READABLE_HINT,
} from '../../services/libraryService';

/* ══════════════════════════════════════════════════════════════════════════
   General Documents — the company's file library.

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
    if (!b) return '—';
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${Math.round(b / 1024)} KB`;
    return `${(b / 1048576).toFixed(1)} MB`;
}

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function typeOf(doc) {
    const m = String(doc.file_name).toLowerCase().match(/\.([a-z0-9]{1,8})$/);
    return m ? m[1].toUpperCase() : (doc.mime_type || 'FILE').split('/').pop().toUpperCase();
}

export default function DocumentLibrary() {
    const t = useT();
    const toast = useToast();
    const { activeOrg } = useOrg();
    const orgId = activeOrg?.id;
    const inputRef = useRef(null);

    const [docs, setDocs] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('all');
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
        const jobs = list.map((f) => ({ key: crypto.randomUUID(), name: f.name, file: f, state: 'queued', error: validateLibraryFile(f) }));
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
                });
                ok += 1;
                set(job.key, { state: 'done', status: row.extraction_status, error: row.extraction_error });
                setDocs((d) => [row, ...(d || []).filter((x) => x.id !== row.id)]);
            } catch (e) {
                set(job.key, { state: 'failed', error: e.message || 'Upload failed' });
            }
        }
        if (ok) toast(`${ok} document${ok === 1 ? '' : 's'} added to the library`, 'success');
        refresh();
    }, [orgId, category, toast, refresh]);

    const onDrop = (e) => {
        e.preventDefault();
        setDragging(false);
        if (canCreate) upload(e.dataTransfer.files);
    };

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (docs || []).filter((d) => {
            if (category !== 'all' && d.category !== category) return false;
            if (!q) return true;
            return hits.has(d.id)
                || [d.title, d.file_name, d.description, d.summary, ...(d.tags || [])]
                    .some((v) => String(v || '').toLowerCase().includes(q));
        });
    }, [docs, category, query, hits]);

    const stats = useMemo(() => {
        const all = docs || [];
        return [
            { label: 'DOCUMENTS', value: all.length },
            { label: 'READABLE BY AI', value: all.filter((d) => d.chunk_count > 0).length,
              note: all.length ? `${Math.round(100 * all.filter((d) => d.chunk_count > 0).length / all.length)}% of the library` : undefined },
            { label: 'PASSAGES INDEXED', value: all.reduce((a, d) => a + (d.chunk_count || 0), 0) },
            { label: 'STORAGE', value: fmtSize(all.reduce((a, d) => a + (d.size_bytes || 0), 0)) },
        ];
    }, [docs]);

    const catOptions = useMemo(() => {
        const present = new Set((docs || []).map((d) => d.category));
        return [{ id: 'all', label: 'All' }, ...CATEGORIES.filter((c) => present.has(c.id) || c.id === category)];
    }, [docs, category]);

    const active = queue.filter((j) => j.state === 'queued' || j.state === 'working').length;

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
                    <Search value={query} onChange={setQuery} placeholder="Search names and inside documents…" width={280} />
                    {catOptions.length > 2 && (
                        <Seg value={category} onChange={setCategory} options={catOptions} size="sm" label="Category" />
                    )}
                </Toolbar>

                <StatBand items={stats} />

                {queue.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                        <Panel
                            title="Uploads"
                            note={active ? `${active} in progress — reading can take up to a minute per file` : 'finished'}
                            actions={!active && <Btn size="sm" onClick={() => setQueue([])}>Clear</Btn>}
                        >
                            <ul aria-live="polite" style={{ listStyle: 'none', margin: 0, padding: '4px 0' }}>
                                {queue.map((j) => (
                                    <li key={j.key} style={{
                                        display: 'flex', gap: 12, alignItems: 'baseline', padding: '6px 13px',
                                        fontSize: 11, borderBottom: '1px solid ' + t.lineSoft,
                                    }}>
                                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.name}</span>
                                        <QueueState job={j} />
                                    </li>
                                ))}
                            </ul>
                        </Panel>
                    </div>
                )}

                {loadError && (
                    <div role="alert" style={{ marginBottom: 14, fontSize: 11.5, color: t.down }}>
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
                                    ? 'Nothing in the library matches that.'
                                    : <>Store any file the company works from — policies, contracts, decks, price lists, scans.
                                        Drop files anywhere on this page. {READABLE_HINT}</>}
                            </Empty>
                        )}
                    >
                        {shown.map((d) => {
                            const hit = hits.get(d.id);
                            const st = STATUS[d.extraction_status] || STATUS.pending;
                            return (
                                <Tr key={d.id} onClick={() => setOpenId(d.id)} label={`Open ${d.title}`}>
                                    <Td>
                                        <div style={{ fontSize: 12, color: t.text }}>{d.title}</div>
                                        <Muted>{d.file_name}{d.page_count ? ` · ${d.page_count} ${d.extraction_method === 'pptx' ? 'slides' : d.extraction_method === 'sheet' ? 'sheets' : 'pages'}` : ''}</Muted>
                                        {hit && (
                                            <div style={{ fontSize: 10.5, color: t.dim, marginTop: 4, lineHeight: 1.5 }}>
                                                {hit.heading && <span style={{ color: t.faint }}>{hit.heading} — </span>}{hit.snippet}
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
                        fontSize: 13, color: t.text, pointerEvents: 'none',
                    }}>Drop to add to the library</div>
                )}
            </div>

            {openId && (
                <DocumentSheet
                    id={openId} orgId={orgId}
                    canEdit={canEdit} canDelete={canDelete}
                    onClose={() => setOpenId(null)}
                    onChanged={(row) => setDocs((d) => (d || []).map((x) => (x.id === row.id ? { ...x, ...row } : x)))}
                    onRemoved={(id) => { setDocs((d) => (d || []).filter((x) => x.id !== id)); setOpenId(null); }}
                />
            )}
        </Page>
    );
}

function QueueState({ job }) {
    const t = useT();
    if (job.state === 'queued') return <Muted>Waiting</Muted>;
    if (job.state === 'working') return <Status tone="mute">Uploading and reading…</Status>;
    if (job.state === 'failed') return <span style={{ fontSize: 10.5, color: t.down }}>{job.error}</span>;
    const st = STATUS[job.status] || STATUS.pending;
    return <Status tone={st.tone}>{st.label}</Status>;
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
                title: d.title, category: d.category, description: d.description || '',
                tags: (d.tags || []).join(', '),
            } : null);
        } catch (e) { toast(e.message, 'error'); onClose(); }
    }, [id, toast, onClose]);

    useEffect(() => { load(); }, [load]);

    const dirty = doc && form && (
        form.title !== doc.title || form.category !== doc.category
        || form.description !== (doc.description || '') || form.tags !== (doc.tags || []).join(', ')
    );

    const save = async () => {
        if (!form.title.trim()) { toast('A document needs a title', 'error'); return; }
        setSaving(true);
        try {
            const row = await libraryService.update(doc.id, {
                title: form.title.trim(), category: form.category,
                description: form.description.trim() || null,
                tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20),
            });
            setDoc((d) => ({ ...d, ...row }));
            onChanged(row);
            toast('Saved', 'success');
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
                    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                        <Field label="Title">
                            <Input value={form.title} maxLength={200} disabled={!canEdit}
                                onChange={(e) => setForm({ ...form, title: e.target.value })} />
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
                    <Field label="Description" hint="What this document is for — EdgeBrain reads this too" wide>
                        <Textarea rows={2} value={form.description} maxLength={2000} disabled={!canEdit}
                            onChange={(e) => setForm({ ...form, description: e.target.value })} />
                    </Field>

                    <section aria-labelledby="lib-ai-h" style={{ border: '1px solid ' + t.line, borderRadius: 10, overflow: 'hidden' }}>
                        <Row style={{ padding: '10px 13px', borderBottom: '1px solid ' + t.lineSoft }} wrap>
                            <h3 id="lib-ai-h" style={{ margin: 0, fontSize: 12, fontWeight: 500, color: t.text }}>What EdgeBrain read</h3>
                            <Status tone={st.tone}>{st.label}</Status>
                            {doc.extraction_method && <Muted>via {METHOD[doc.extraction_method] || doc.extraction_method}</Muted>}
                            {doc.chunk_count > 0 && <Muted>{doc.chunk_count} passage{doc.chunk_count === 1 ? '' : 's'} · {(doc.char_count || 0).toLocaleString('en-IN')} characters</Muted>}
                            <div style={{ flex: 1 }} />
                            {doc.content_md && <Btn size="sm" onClick={() => libraryService.downloadMarkdown(doc)}>Download .md</Btn>}
                            {canEdit && <Btn size="sm" onClick={reread} disabled={reading}>{reading ? 'Reading…' : 'Read again'}</Btn>}
                        </Row>
                        {doc.extraction_error && (
                            <div role="note" style={{ padding: '9px 13px', fontSize: 11, color: doc.extraction_status === 'failed' ? t.down : t.dim, borderBottom: '1px solid ' + t.lineSoft }}>
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
                                    fontSize: 11, lineHeight: 1.6, color: t.dim, background: t.panelAlt,
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
