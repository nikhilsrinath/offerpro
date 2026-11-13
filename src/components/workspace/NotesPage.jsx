import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Pin, PinOff, Archive, ArchiveRestore, Trash2, Copy, ListChecks, Lock, Tag, FolderKanban, Handshake, StickyNote,
} from 'lucide-react';
import { Page, Btn, Seg, Search, Loading, Empty, Panel, RowMenu } from '../ui/edge';
import { MONO, useT } from '../ui/edgeUtils';
import { useToast } from '../shared/Toast';
import { workspaceService, useWorkspace } from '../../services/workspaceService';
import { useLive } from '../hub/useHubData';
import { useWorkspaceReady } from './useCalendarData';
import {
    NOTE_COLORS, noteTone, viewNotes, labelsOf, isBlank, checklistProgress, toChecklist, checkItem, editedText,
} from './notesModel';
import { AutoTextarea, ChecklistEditor } from './NoteEditor';
import NotePanel from './NotePanel';
import { TickBox, MissingTables, WorkspaceStyle } from './workspaceUi';

/* ══════════════════════════════════════════════════════════════════════════
   Notes, Google Keep style. A composer at the top ("Take a note…", or a
   checklist), then the notes as cards in columns: Pinned first, then the
   rest, most recently changed first. Archive keeps notes out of the way
   without deleting them. Labels filter; search reads titles, text,
   checklist lines and labels.

   On a card: tick a checklist line, pin, archive, copy, recolour or delete,
   without opening it. Clicking the card opens it in the side panel.
   ══════════════════════════════════════════════════════════════════════════ */

const PREVIEW_ITEMS = 8;

/* RowMenu draws each item's icon as a component; a colour swatch is one. */
const swatchIcons = new Map();
function swatchIcon(tone) {
    const key = tone.bg + '|' + tone.line;
    if (!swatchIcons.has(key)) {
        swatchIcons.set(key, function SwatchIcon() {
            return <span aria-hidden="true" style={{ width: 13, height: 13, borderRadius: '50%', background: tone.bg, border: '1px solid ' + tone.line, display: 'inline-block' }} />;
        });
    }
    return swatchIcons.get(key);
}

/* ── the composer ─────────────────────────────────────────────────────────── */

function Composer({ orgId, label }) {
    const t = useT();
    const toast = useToast();
    const [open, setOpen] = useState(false);
    const [f, setF] = useState({ title: '', body: '', items: [], kind: 'text', color: 'default', pinned: false });
    const box = useRef(null);
    const fRef = useRef(f);
    fRef.current = f;

    const reset = () => { setF({ title: '', body: '', items: [], kind: 'text', color: 'default', pinned: false }); setOpen(false); };
    const save = async () => {
        const cur = fRef.current;
        const note = { ...cur, items: cur.kind === 'checklist' ? cur.items.filter((i) => String(i.text).trim()) : [], labels: label ? [label] : [] };
        reset();
        if (isBlank(note)) return;
        try { await workspaceService.create('notes', orgId, note); } catch (e) { toast(e.message, 'error'); }
    };

    // Like Keep: a click anywhere outside the open composer keeps the note.
    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => { if (box.current && !box.current.contains(e.target)) save(); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const tone = noteTone(t, f.color);
    if (!open) {
        return (
            <div className="nt-composer" style={{
                display: 'flex', alignItems: 'center', gap: 6, height: 46, padding: '0 6px 0 16px', borderRadius: 12,
                background: t.card, border: '1px solid ' + t.lineStrong, boxShadow: '0 1px 2px rgba(15, 23, 42, .06)',
            }}>
                <button type="button" onClick={() => setOpen(true)} style={{
                    flex: 1, height: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'text',
                    fontFamily: MONO, fontSize: 13.5, fontWeight: 500, color: t.faint,
                }}>Take a note…</button>
                <button type="button" title="New checklist" aria-label="New checklist" className="ws-ghost-btn"
                    onClick={() => { setF((x) => ({ ...x, kind: 'checklist', items: [checkItem('')] })); setOpen(true); }}
                    style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', border: 'none', borderRadius: 8, background: 'transparent', color: t.dim, cursor: 'pointer' }}>
                    <ListChecks size={18} aria-hidden="true" />
                </button>
            </div>
        );
    }
    return (
        <div ref={box} className="nt-composer" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); save(); } }} style={{
            borderRadius: 12, background: tone.bg, border: '1px solid ' + (f.color === 'default' ? t.lineStrong : tone.line),
            boxShadow: '0 6px 20px -10px rgba(15, 23, 42, .25)', padding: '10px 14px 6px',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input value={f.title} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} placeholder="Title" aria-label="Title" maxLength={500}
                    className="ws-bare-input" style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600, height: 30, flex: 1 }} />
                <button type="button" onClick={() => setF((x) => ({ ...x, pinned: !x.pinned }))} aria-pressed={f.pinned} aria-label={f.pinned ? 'Unpin' : 'Pin'} title={f.pinned ? 'Unpin' : 'Pin'}
                    className="ws-ghost-btn" style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', color: f.pinned ? t.accent : t.faint }}>
                    {f.pinned ? <PinOff size={16} aria-hidden="true" /> : <Pin size={16} aria-hidden="true" />}
                </button>
            </div>
            <div style={{ margin: '4px 0 6px' }}>
                {f.kind === 'checklist'
                    ? <ChecklistEditor items={f.items} onChange={(items) => setF((x) => ({ ...x, items }))} autoFocusNew />
                    : <AutoTextarea value={f.body} onChange={(body) => setF((x) => ({ ...x, body }))} placeholder="Take a note…" minRows={2} aria-label="Note" autoFocus style={{ fontSize: 13.5, color: t.text }} />}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <div role="radiogroup" aria-label="Colour" style={{ display: 'flex', gap: 5, marginRight: 6 }}>
                    {NOTE_COLORS.map((c) => {
                        const on = f.color === c.id;
                        const sw = noteTone(t, c.id);
                        return (
                            <button key={c.id} type="button" role="radio" aria-checked={on} aria-label={c.label} title={c.label} onClick={() => setF((x) => ({ ...x, color: c.id }))} style={{
                                width: 20, height: 20, borderRadius: '50%', padding: 0, cursor: 'pointer', background: sw.bg,
                                border: `2px solid ${on ? t.text : sw.line}`,
                            }} />
                        );
                    })}
                </div>
                <Btn size="sm" onClick={() => setF((x) => (x.kind === 'checklist'
                    ? { ...x, kind: 'text', body: x.items.map((i) => i.text).filter(Boolean).join('\n'), items: [] }
                    : { ...x, kind: 'checklist', items: toChecklist(x.body).length ? toChecklist(x.body) : [checkItem('')], body: '' }))}>
                    {f.kind === 'checklist' ? 'Text' : 'Checklist'}
                </Btn>
                {label && <span style={{ fontSize: 11.5, color: t.faint, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Tag size={11} aria-hidden="true" />{label}</span>}
                <div style={{ flex: 1 }} />
                <Btn size="sm" onClick={reset}>Discard</Btn>
                <Btn size="sm" primary onClick={save}>Close</Btn>
            </div>
        </div>
    );
}

/* ── a card ───────────────────────────────────────────────────────────────── */

function NoteCard({ note, onOpen, projectById, clientById }) {
    const t = useT();
    const toast = useToast();
    const tone = noteTone(t, note.color);
    const checklist = note.kind === 'checklist';
    const items = note.items || [];
    const openItems = items.filter((i) => !i.done);
    const preview = [...openItems, ...items.filter((i) => i.done)].slice(0, PREVIEW_ITEMS);
    const prog = checklistProgress(items);
    const project = note.project_id ? projectById[note.project_id] : null;
    const client = note.client_id ? clientById[note.client_id] : null;

    const patch = (p, msg, undo) => workspaceService.update('notes', note.id, p)
        .then(() => msg && toast(msg, 'success', 6000, undo ? { label: 'Undo', onClick: () => workspaceService.update('notes', note.id, undo).catch((e) => toast(e.message, 'error')) } : null))
        .catch((e) => toast(e.message, 'error'));
    const tick = (id) => patch({ items: items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)) });

    const menu = [
        { label: note.pinned ? 'Unpin' : 'Pin', icon: note.pinned ? PinOff : Pin, onClick: () => patch({ pinned: !note.pinned }) },
        { label: note.archived_at ? 'Unarchive' : 'Archive', icon: note.archived_at ? ArchiveRestore : Archive,
            onClick: () => patch({ archived_at: note.archived_at ? null : new Date().toISOString(), pinned: false },
                note.archived_at ? 'Note restored' : 'Note archived', { archived_at: note.archived_at || null, pinned: !!note.pinned }) },
        { label: 'Make a copy', icon: Copy, onClick: () => workspaceService.create('notes', note.org_id, {
            title: note.title ? `${note.title} (copy)` : '', body: note.body, items: items.map((i) => ({ ...checkItem(i.text, i.done) })),
            kind: note.kind, color: note.color, labels: note.labels || [], project_id: note.project_id, client_id: note.client_id,
        }).then(() => toast('Copy made', 'success')).catch((e) => toast(e.message, 'error')) },
        ...NOTE_COLORS.filter((c) => c.id !== (note.color || 'default')).map((c) => ({ label: `Colour: ${c.label}`, icon: swatchIcon(noteTone(t, c.id)), onClick: () => patch({ color: c.id }) })),
        { label: 'Delete', icon: Trash2, tone: 'danger', onClick: () => workspaceService.remove('notes', note.id)
            .then(() => toast('Note deleted', 'success', 6000, { label: 'Undo', onClick: () => workspaceService.restore('notes', [note]).catch((e) => toast(e.message, 'error')) }))
            .catch((e) => toast(e.message, 'error')) },
    ];

    return (
        <article className="nt-card ws-row" aria-label={note.title || 'Note'} style={{
            breakInside: 'avoid', marginBottom: 12, borderRadius: 12, background: tone.bg, border: '1px solid ' + tone.line,
            overflow: 'hidden', position: 'relative',
        }}>
            <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
                style={{ padding: '12px 14px 4px', cursor: 'pointer', outline: 'none' }} className="nt-open">
                {note.title && (
                    <h3 style={{ margin: '0 22px 6px 0', fontSize: 14, fontWeight: 600, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{note.title}</h3>
                )}
                {!checklist && note.body && (
                    <p style={{
                        margin: 0, fontSize: 13, lineHeight: 1.55, color: t.text, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                        display: '-webkit-box', WebkitLineClamp: 14, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>{note.body}</p>
                )}
                {checklist && (
                    <div onClick={(e) => e.stopPropagation()} style={{ cursor: 'default' }}>
                        {preview.map((i) => (
                            <div key={i.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '3px 0' }}>
                                <span style={{ paddingTop: 1 }}><TickBox done={i.done} size={15} label={(i.done ? 'Untick: ' : 'Tick: ') + i.text} onToggle={() => tick(i.id)} /></span>
                                <span style={{ fontSize: 13, lineHeight: 1.45, color: i.done ? t.faint : t.text, textDecoration: i.done ? 'line-through' : 'none', overflowWrap: 'anywhere' }}>{i.text}</span>
                            </div>
                        ))}
                        {items.length > preview.length && <div style={{ fontSize: 11.5, color: t.faint, padding: '2px 0 0 23px' }}>+{items.length - preview.length} more</div>}
                    </div>
                )}
                {!note.title && !note.body && !items.length && <p style={{ margin: 0, fontSize: 13, color: t.faint }}>Empty note</p>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
                    {checklist && prog.total > 0 && (
                        <span className="nt-chip" style={{ color: prog.done === prog.total ? t.up : t.dim }}><ListChecks size={11} aria-hidden="true" />{prog.done}/{prog.total}</span>
                    )}
                    {(note.labels || []).map((l) => <span key={l} className="nt-chip"><Tag size={11} aria-hidden="true" />{l}</span>)}
                    {project && <span className="nt-chip"><FolderKanban size={11} aria-hidden="true" />{project.code || project.name}</span>}
                    {client && <span className="nt-chip"><Handshake size={11} aria-hidden="true" />{client.name || 'Client'}</span>}
                </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 6px 6px 14px', minHeight: 30 }}>
                <span style={{ flex: 1, fontSize: 11, color: t.faint }} className="ws-reveal">{editedText(note.updated_at)}</span>
                <span className="ws-reveal"><RowMenu label={`Actions for ${note.title || 'note'}`} items={menu} /></span>
            </div>
            <button type="button" onClick={() => patch({ pinned: !note.pinned })} aria-pressed={!!note.pinned} aria-label={note.pinned ? 'Unpin note' : 'Pin note'} title={note.pinned ? 'Unpin' : 'Pin'}
                className={'ws-ghost-btn' + (note.pinned ? '' : ' ws-reveal')} style={{
                    position: 'absolute', top: 6, right: 6, width: 28, height: 28, display: 'grid', placeItems: 'center', border: 'none', borderRadius: 8,
                    background: 'transparent', cursor: 'pointer', color: note.pinned ? t.accent : t.faint,
                }}>
                <Pin size={15} aria-hidden="true" fill={note.pinned ? 'currentColor' : 'none'} />
            </button>
        </article>
    );
}

/* ── the page ─────────────────────────────────────────────────────────────── */

export default function NotesPage() {
    const t = useT();
    const { orgId, ready } = useWorkspaceReady();
    const ws = useWorkspace('notes', orgId);
    const projects = useLive('projects', ready);
    const clients = useLive('customers', ready);
    const [params, setParams] = useSearchParams();
    const [query, setQuery] = useState('');
    const [openId, setOpenId] = useState(null);

    const archived = params.get('view') === 'archive';
    const label = params.get('label') || '';
    const setParam = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };

    const labels = useMemo(() => labelsOf(ws.rows.filter((n) => !n.archived_at)), [ws.rows]);
    const view = useMemo(() => viewNotes(ws.rows, { archived, label, query }), [ws.rows, archived, label, query]);
    const projectById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
    const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);
    const opened = openId ? ws.rows.find((n) => n.id === openId) : null;
    const archivedCount = ws.rows.filter((n) => n.archived_at).length;

    if (!orgId || !ws.ready) return <Loading>Loading your notes…</Loading>;

    const grid = (list) => (
        <div className="nt-grid">
            {list.map((n) => <NoteCard key={n.id} note={n} onOpen={() => setOpenId(n.id)} projectById={projectById} clientById={clientById} />)}
        </div>
    );
    const nothing = !view.pinned.length && !view.others.length;

    return (
        <Page>
            <WorkspaceStyle />
            {ws.missing ? <MissingTables what="Notes" /> : (
                <>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: 10, marginBottom: 14,
                        background: t.card, border: '1px solid ' + t.line, borderRadius: 12, position: 'sticky', top: 0, zIndex: 20,
                    }}>
                        <Seg value={archived ? 'archive' : 'notes'} onChange={(v) => setParam('view', v === 'archive' ? 'archive' : '')} label="Notes or archive" options={[
                            { id: 'notes', label: 'Notes' }, { id: 'archive', label: archivedCount ? `Archive (${archivedCount})` : 'Archive' },
                        ]} />
                        <Search value={query} onChange={setQuery} placeholder="Search notes…" width={240} />
                        {labels.length > 0 && (
                            <div role="group" aria-label="Filter by label" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                <button type="button" className={'nt-filter' + (!label ? ' on' : '')} aria-pressed={!label} onClick={() => setParam('label', '')}>All</button>
                                {labels.map((l) => (
                                    <button key={l.label} type="button" className={'nt-filter' + (label === l.label ? ' on' : '')} aria-pressed={label === l.label}
                                        onClick={() => setParam('label', label === l.label ? '' : l.label)}>
                                        <Tag size={11} aria-hidden="true" />{l.label}<span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{l.count}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: t.faint, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <Lock size={12} aria-hidden="true" />Only you can see your notes
                        </span>
                    </div>

                    {!archived && (
                        <div style={{ maxWidth: 620, margin: '0 auto 22px' }}>
                            <Composer orgId={orgId} label={label} />
                        </div>
                    )}

                    {nothing ? (
                        <Panel>
                            <Empty>
                                <StickyNote aria-hidden="true" size={26} style={{ color: t.ghost, display: 'block', margin: '0 auto 10px' }} />
                                {query || label ? 'No note matches.' : archived ? 'Archived notes show here.' : 'Notes you add appear here. Pin the ones you need most.'}
                            </Empty>
                        </Panel>
                    ) : (
                        <>
                            {view.pinned.length > 0 && (
                                <section aria-label="Pinned">
                                    <h2 className="nt-head">Pinned</h2>
                                    {grid(view.pinned)}
                                </section>
                            )}
                            {view.others.length > 0 && (
                                <section aria-label={archived ? 'Archived' : 'Others'}>
                                    {view.pinned.length > 0 && <h2 className="nt-head">Others</h2>}
                                    {grid(view.others)}
                                </section>
                            )}
                        </>
                    )}
                </>
            )}

            {opened && (
                <NotePanel key={opened.id} note={opened} onClose={() => setOpenId(null)}
                    projects={projects} clients={clients} allLabels={labelsOf(ws.rows)} />
            )}

            <style>{`
                .nt-grid { column-width: 250px; column-gap: 12px; }
                .nt-card { transition: box-shadow .15s, border-color .15s; }
                .nt-card:hover { box-shadow: 0 4px 14px -6px rgba(15, 23, 42, ${t.isDark ? '.6' : '.22'}); }
                .nt-open:focus-visible { box-shadow: inset 0 0 0 2px ${t.accent}; border-radius: 12px; }
                .nt-head { margin: 4px 0 8px 2px; font-size: 11.5px; font-weight: 600; color: ${t.faint}; letter-spacing: .03em; }
                .nt-chip { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 7px; border-radius: 99px;
                    font-size: 11px; font-weight: 500; color: ${t.dim}; background: color-mix(in srgb, ${t.card} 55%, transparent);
                    border: 1px solid color-mix(in srgb, ${t.lineStrong} 70%, transparent); max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
                .nt-filter { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; border-radius: 99px; cursor: pointer;
                    font-family: ${MONO}; font-size: 12px; font-weight: 500; color: ${t.dim}; background: ${t.card}; border: 1px solid ${t.line}; }
                .nt-filter:hover { border-color: ${t.lineStrong}; color: ${t.text}; }
                .nt-filter.on { background: ${t.soft}; color: ${t.softText}; border-color: transparent; font-weight: 600; }
            `}</style>
        </Page>
    );
}
