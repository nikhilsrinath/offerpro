import React, { useMemo, useRef, useState } from 'react';
import { Pin, PinOff, Archive, ArchiveRestore, X, Tag } from 'lucide-react';
import { Btn, Seg, Field, Select, Modal, ConfirmBtn } from '../ui/edge';
import { MONO, useT } from '../ui/edgeUtils';
import { useToast } from '../shared/Toast';
import { workspaceService } from '../../services/workspaceService';
import { NOTE_COLORS, noteTone, toChecklist, toText, isBlank, cleanLabels, editedText, checkItem } from './notesModel';
import { AutoTextarea, ChecklistEditor } from './NoteEditor';

/* One note open in the side panel. Like Keep, there is no Save: closing the
   panel (Done, ×, Escape or a click outside) keeps what was typed. A note
   emptied of everything is deleted on close. */

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function NotePanel({ note, onClose, projects = [], clients = [], allLabels = [] }) {
    const t = useT();
    const toast = useToast();
    const initial = useMemo(() => ({
        title: note.title || '', body: note.body || '', items: note.items || [], kind: note.kind || 'text',
        color: note.color || 'default', pinned: !!note.pinned, labels: note.labels || [],
        project_id: note.project_id || '', client_id: note.client_id || '',
    }), [note]);
    const [f, setF] = useState(initial);
    const [labelText, setLabelText] = useState('');
    const closing = useRef(false);
    const tone = noteTone(t, f.color);
    const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

    const switchKind = (kind) => setF((x) => (kind === x.kind ? x : kind === 'checklist'
        ? { ...x, kind, items: x.items.length ? x.items : (toChecklist(x.body).length ? toChecklist(x.body) : [checkItem('')]), body: '' }
        : { ...x, kind, body: x.body || toText(x.items), items: [] }));

    const addLabel = (v) => {
        const next = cleanLabels([...f.labels, v]);
        setF((x) => ({ ...x, labels: next }));
        setLabelText('');
    };

    const finish = async () => {
        if (closing.current) return;
        closing.current = true;
        const patch = {
            ...f,
            items: f.kind === 'checklist' ? f.items.filter((i) => String(i.text).trim()) : [],
            body: f.kind === 'text' ? f.body : '',
            labels: cleanLabels(f.labels),
            project_id: f.project_id || null, client_id: f.client_id || null,
        };
        try {
            if (isBlank(patch)) {
                await workspaceService.remove('notes', note.id);
                toast('Empty note discarded', 'info');
            } else if (!same(patch, { ...initial, project_id: initial.project_id || null, client_id: initial.client_id || null })) {
                await workspaceService.update('notes', note.id, patch);
            }
            onClose();
        } catch (e) {
            closing.current = false;
            toast(e.message, 'error');
        }
    };

    const archive = async () => {
        closing.current = true;
        try {
            await workspaceService.update('notes', note.id, { ...f, labels: cleanLabels(f.labels), project_id: f.project_id || null, client_id: f.client_id || null, archived_at: note.archived_at ? null : new Date().toISOString(), pinned: false });
            toast(note.archived_at ? 'Note restored' : 'Note archived', 'success', 6000, {
                label: 'Undo', onClick: () => workspaceService.update('notes', note.id, { archived_at: note.archived_at || null, pinned: !!note.pinned }).catch((e) => toast(e.message, 'error')),
            });
            onClose();
        } catch (e) { closing.current = false; toast(e.message, 'error'); }
    };

    const remove = async () => {
        closing.current = true;
        try {
            await workspaceService.remove('notes', note.id);
            toast('Note deleted', 'success', 6000, { label: 'Undo', onClick: () => workspaceService.restore('notes', [note]).catch((e) => toast(e.message, 'error')) });
            onClose();
        } catch (e) { closing.current = false; toast(e.message, 'error'); }
    };

    const suggestions = allLabels.map((l) => l.label).filter((l) => !f.labels.includes(l));
    const gap = <div style={{ height: 13 }} />;

    return (
        <Modal open onClose={finish} width={680}
            title={note.archived_at ? 'Archived note' : 'Note'}
            note={editedText(note.updated_at)}
            footer={(
                <>
                    <ConfirmBtn size="md" label="Delete" confirmLabel="Delete" title="Delete note" message="The note is deleted." onConfirm={remove} />
                    <Btn onClick={archive}>{note.archived_at ? <><ArchiveRestore size={14} aria-hidden="true" />Unarchive</> : <><Archive size={14} aria-hidden="true" />Archive</>}</Btn>
                    <div style={{ flex: 1 }} />
                    <Btn primary onClick={finish}>Done</Btn>
                </>
            )}>
            {/* The note itself, on its colour. */}
            <div style={{ background: tone.bg, border: '1px solid ' + tone.line, borderRadius: 12, padding: '12px 14px 10px', margin: '16px 20px 4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input value={f.title} onChange={set('title')} placeholder="Title" aria-label="Title" maxLength={500}
                        className="ws-bare-input" style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, height: 30, flex: 1 }} />
                    <button type="button" onClick={() => set('pinned')(!f.pinned)} aria-pressed={f.pinned} aria-label={f.pinned ? 'Unpin' : 'Pin'} title={f.pinned ? 'Unpin' : 'Pin'}
                        className="ws-ghost-btn" style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', color: f.pinned ? t.accent : t.faint }}>
                        {f.pinned ? <PinOff size={16} aria-hidden="true" /> : <Pin size={16} aria-hidden="true" />}
                    </button>
                </div>
                <div style={{ marginTop: 6 }}>
                    {f.kind === 'checklist'
                        ? <ChecklistEditor items={f.items} onChange={set('items')} autoFocusNew />
                        : <AutoTextarea value={f.body} onChange={set('body')} placeholder="Take a note…" minRows={6} aria-label="Note" style={{ fontSize: 13.5, color: t.text }} autoFocus={!f.body && !f.title} />}
                </div>
            </div>
            {gap}
            <Field label="Type">
                <Seg value={f.kind} onChange={switchKind} label="Note type" options={[{ id: 'text', label: 'Text' }, { id: 'checklist', label: 'Checklist' }]} />
            </Field>
            {gap}
            <Field label="Colour">
                <div role="radiogroup" aria-label="Colour" style={{ display: 'flex', gap: 8, alignItems: 'center', height: 32 }}>
                    {NOTE_COLORS.map((c) => {
                        const on = f.color === c.id;
                        const sw = noteTone(t, c.id);
                        return (
                            <button key={c.id} type="button" role="radio" aria-checked={on} aria-label={c.label} title={c.label} onClick={() => set('color')(c.id)} style={{
                                width: 26, height: 26, borderRadius: '50%', padding: 0, cursor: 'pointer', background: sw.bg,
                                border: `2px solid ${on ? t.text : sw.line}`, boxShadow: on ? `inset 0 0 0 2px ${t.card}` : 'none',
                            }} />
                        );
                    })}
                </div>
            </Field>
            {gap}
            <Field label="Labels" hint="Press Enter to add. Labels group notes in the bar above them">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', minHeight: 32, padding: '3px 6px', borderRadius: 7, border: '1px solid ' + t.lineStrong, background: t.panelAlt }}>
                    {f.labels.map((l) => (
                        <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 4px 0 8px', borderRadius: 99, background: t.soft, color: t.softText, fontSize: 12, fontWeight: 500 }}>
                            <Tag size={11} aria-hidden="true" />{l}
                            <button type="button" aria-label={`Remove label ${l}`} onClick={() => setF((x) => ({ ...x, labels: x.labels.filter((y) => y !== l) }))}
                                style={{ width: 18, height: 18, display: 'grid', placeItems: 'center', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', borderRadius: 99, padding: 0 }}>
                                <X size={11} aria-hidden="true" />
                            </button>
                        </span>
                    ))}
                    <input value={labelText} onChange={(e) => setLabelText(e.target.value)} list="ws-note-labels" maxLength={40}
                        onKeyDown={(e) => {
                            if ((e.key === 'Enter' || e.key === ',') && labelText.trim()) { e.preventDefault(); addLabel(labelText); }
                            else if (e.key === 'Backspace' && !labelText && f.labels.length) setF((x) => ({ ...x, labels: x.labels.slice(0, -1) }));
                        }}
                        onBlur={() => { if (labelText.trim()) addLabel(labelText); }}
                        placeholder={f.labels.length ? '' : 'Add a label'} aria-label="Add a label"
                        className="ws-bare-input" style={{ flex: 1, minWidth: 100, height: 24, fontFamily: MONO, fontSize: 13 }} />
                    <datalist id="ws-note-labels">{suggestions.map((l) => <option key={l} value={l} />)}</datalist>
                </div>
            </Field>
            {projects.length > 0 && (
                <>
                    {gap}
                    <Field label="Project" hint="Optional, to keep the note with its work">
                        <Select value={f.project_id} onChange={set('project_id')}>
                            <option value="">None</option>
                            {projects.filter((p) => !p.archived_at || p.id === f.project_id).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                        </Select>
                    </Field>
                </>
            )}
            {clients.length > 0 && (
                <>
                    {gap}
                    <Field label="Client" hint="Optional">
                        <Select value={f.client_id} onChange={set('client_id')}>
                            <option value="">None</option>
                            {clients.map((c) => <option key={c.id} value={c.id}>{c.name || c.company || 'Client'}</option>)}
                        </Select>
                    </Field>
                </>
            )}
            <p style={{ fontSize: 11.5, color: t.faint }}>Only you can see your notes. Closing the panel keeps your changes.</p>
        </Modal>
    );
}
