import React, { createContext, forwardRef, useContext, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Panel, Row, Btn, Seg, Search, Select, Field, Input, Empty, Grid, DialogSheet } from '../../ui/edge';
import { useT, MONO, fmtDate } from '../../ui/edgeUtils';
import { useToast } from '../../shared/Toast';
import { useSection } from '../../financial/financeHooks';
import { orgStore } from '../../../services/orgStore';
import { confirmDialog } from '../../../services/confirm';
import {
    putObject, removeObjects, openObject, uploadProjectFile, pdfBlob, docxBlob, downloadBlob, fileError, letterheadData,
} from '../../../services/projectFiles';
import {
    PLACEHOLDER_GROUPS, PLACEHOLDER_BY_KEY, placeholderValues, availablePlaceholders, fillPlaceholders, findPlaceholders,
    sanitizeHtml, htmlToText, escapeHtml, folderPath,
} from '../../../services/projectWorkspace';
import { RowMenu } from '../pm/pmUi';
import { useProjectClients, useProjectVendors, useSetup, todayIso } from '../parties/partyData';
import { SetupGate, Bar } from '../parties/partyUi';
import { SwitchRow } from '../../bulk/shared/BulkKit';

/* ══════════════════════════════════════════════════════════════════════════
   Documents Management › Custom Templates, reusable documents for this
   project, written once with {{variables}} and filled from what the project
   already knows: your company, the project, its client and vendors.

   The page lists the templates as cards. Writing, editing or using one opens
   the template studio: a full-window workspace with the templates on the
   left, the document in the middle, and on the right either the variables to
   insert (while writing) or what to fill and where to save (while using).
   Only variables this project can actually fill are offered; anything still
   empty when you use a template gets a box to type it in.

   An uploaded Word or PDF template is kept as a file to download; only an
   HTML or text upload becomes editable.
   ══════════════════════════════════════════════════════════════════════════ */

const CATEGORIES = [
    { id: 'proposal', label: 'Proposal' }, { id: 'quotation', label: 'Quotation' }, { id: 'invoice', label: 'Invoice' },
    { id: 'report', label: 'Report' }, { id: 'agreement', label: 'Agreement' }, { id: 'minutes', label: 'Meeting minutes' },
    { id: 'other', label: 'Other' },
];
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
const typeOf = (x) => (x.category === 'other' && x.type_label) || CAT[x.category] || 'Other';
const has = (v) => v != null && String(v).trim() !== '';
const needs0084 = (e) => /letterhead|type_label/i.test(e?.message || '');

const STARTERS = [
    { id: 'blank', label: 'Blank page', note: 'Start from nothing', category: 'other', name: '', body_html: '<p></p>' },
    {
        id: 'proposal', label: 'Proposal', note: 'Scope, timeline and value', category: 'proposal', name: 'Project proposal',
        body_html: '<h1>Proposal: {{project_name}}</h1><p>Prepared by <b>{{company_name}}</b> on {{date}}.</p>'
            + '<h2>Scope</h2><p></p><h2>Timeline</h2><p>From {{project_start}} to {{project_end}}.</p><h2>Investment</h2><p>{{amount}}</p>',
    },
    {
        id: 'minutes', label: 'Meeting minutes', note: 'Attendees, decisions, actions', category: 'minutes', name: 'Meeting minutes',
        body_html: '<h1>Meeting minutes</h1><p><b>Project:</b> {{project_name}} ({{project_code}})<br><b>Date:</b> {{date}}<br><b>Chaired by:</b> {{project_manager}}</p>'
            + '<h2>Attendees</h2><ul><li></li></ul><h2>Decisions</h2><ul><li></li></ul><h2>Action items</h2><ol><li></li></ol>',
    },
    {
        id: 'letter', label: 'Letter on letterhead', note: 'A formal letter with your header', category: 'other', type_label: 'Letter',
        letterhead: true, name: 'Letter',
        body_html: '<p>{{date}}</p><p>To,<br>{{client_name}}<br>{{client_address}}</p><p><b>Subject:</b> </p><p>Dear Sir or Madam,</p><p></p>'
            + '<p>Regards,<br>{{project_manager}}<br>{{company_name}}</p>',
    },
];

function useNarrow() {
    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 960);
    useEffect(() => {
        const on = () => setNarrow(window.innerWidth < 960);
        window.addEventListener('resize', on);
        return () => window.removeEventListener('resize', on);
    }, []);
    return narrow;
}

/* ── what the variables fill from ─────────────────────────────────────────── */

function useFillData(project) {
    const { clients } = useProjectClients(project);
    const { vendors } = useProjectVendors(project);
    const employees = useSection('employees');
    return useMemo(() => {
        const m = employees.find((e) => e.id === project.manager_employee_id);
        return { clients, vendors, manager: m?.name || m?.full_name || '', profile: orgStore.getProfile() || {} };
    }, [clients, vendors, employees, project.manager_employee_id]);
}

function valuesFor(project, data, clientId, vendorId) {
    return placeholderValues({
        project,
        client: data.clients.find((c) => c.id === clientId) || null,
        vendor: data.vendors.find((v) => v.id === vendorId) || null,
        manager: data.manager,
        company: data.profile,
        today: todayIso(),
    });
}

/** The writes every view shares: duplicate, delete, and the row menu built on them. */
function useTemplateActions(project, templates, after = {}) {
    const toast = useToast();
    const can = {
        create: orgStore.can('project_files', 'create'),
        edit: orgStore.can('project_files', 'edit'),
        remove: orgStore.can('project_files', 'delete'),
    };
    const duplicate = async (x) => {
        try {
            const row = await orgStore.addItem('project_templates', {
                project_id: project.id, name: `${x.name} (copy)`.slice(0, 200), category: x.category,
                body_html: x.body_html, file_path: x.file_path, file_name: x.file_name,
                ...('letterhead' in x ? { letterhead: x.letterhead, type_label: x.type_label } : {}),
            });
            after.duplicated?.(row);
            toast('Duplicated', 'success');
        } catch (e) { toast(fileError(e), 'error'); }
    };
    const remove = async (x) => {
        const ok = await confirmDialog({ title: `Delete “${x.name}”?`, message: 'Documents already generated from it are kept.', confirmLabel: 'Delete', tone: 'danger' });
        if (!ok) return;
        try {
            await orgStore.removeItem('project_templates', x.id);
            // A duplicate may share the uploaded file; only remove it when nothing else points at it.
            if (x.file_path && !templates.some((o) => o.id !== x.id && o.file_path === x.file_path)) await removeObjects([x.file_path]);
            after.removed?.(x);
            toast('Template deleted', 'success');
        } catch (e) { toast(fileError(e), 'error'); }
    };
    const download = (x) => openObject(x.file_path, { download: x.file_name }).catch((e) => toast(fileError(e), 'error'));
    const menuFor = (x, extra = []) => [
        ...extra,
        x.file_path && { label: 'Download file', onSelect: () => download(x) },
        can.create && { label: 'Duplicate', onSelect: () => duplicate(x) },
        can.remove && { label: 'Delete', danger: true, onSelect: () => remove(x) },
    ];
    return { can, duplicate, remove, download, menuFor };
}

/* ══════════════════════════════════════════════════════════════════════════
   The page: the templates as cards.
   ══════════════════════════════════════════════════════════════════════════ */

export default function ProjectTemplates({ project, onOpen }) {
    const toast = useToast();
    const setup = useSetup('project_templates', ['project_templates']);
    const all = useSection('project_templates');
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('');
    const [studio, setStudio] = useState(null);   // { mode: 'new' | 'edit' | 'use', id?, draft? }
    const upload = useRef(null);
    const [busy, setBusy] = useState(false);

    const templates = useMemo(() => all.filter((x) => x.project_id === project.id), [all, project.id]);
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return templates.filter((x) => (!category || x.category === category)
            && (!q || x.name.toLowerCase().includes(q) || typeOf(x).toLowerCase().includes(q) || htmlToText(x.body_html).toLowerCase().includes(q)))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [templates, query, category]);
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, templates.filter((x) => x.category === c.id).length]));
    const { can, download, menuFor } = useTemplateActions(project, templates);

    // An uploaded template: HTML and text open in the studio to finish; anything else is kept as a file.
    const onUpload = async (file) => {
        if (!file) return;
        setBusy(true);
        try {
            const name = file.name.replace(/\.[^.]+$/, '').slice(0, 200) || 'Uploaded template';
            if (/\.(html?|txt|md)$/i.test(file.name) || /^text\//.test(file.type)) {
                if (file.size > 400000) throw new Error('A text template can be 400 KB at most.');
                const text = await file.text();
                const body = /\.html?$/i.test(file.name) || /html/.test(file.type)
                    ? sanitizeHtml(text)
                    : text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
                setStudio({ mode: 'edit', draft: { name, category: 'other', type_label: '', letterhead: false, body_html: body } });
            } else {
                const path = await putObject(project.id, file);
                await orgStore.addItem('project_templates', {
                    project_id: project.id, name, category: 'other', body_html: '', file_path: path, file_name: file.name,
                });
                toast('Template file uploaded', 'success');
            }
        } catch (e) { toast(fileError(e), 'error'); } finally {
            setBusy(false);
            if (upload.current) upload.current.value = '';
        }
    };

    const use = (x) => (x.body_html ? setStudio({ mode: 'use', id: x.id }) : download(x));
    const cardMenu = (x) => menuFor(x, [
        x.body_html && { label: 'Use template', onSelect: () => setStudio({ mode: 'use', id: x.id }) },
        can.edit && x.body_html && { label: 'Edit', onSelect: () => setStudio({ mode: 'edit', id: x.id }) },
    ]);

    return (
        <SetupGate setup={setup} what="custom templates">
            <Panel title="Templates" note={`${templates.length} for this project`}
                actions={<Row gap={6}>
                    {templates.some((x) => x.body_html) && <Btn size="sm" onClick={() => use(templates.find((x) => x.body_html))}>Generate document</Btn>}
                    {can.create && (
                        <>
                            <input ref={upload} type="file" hidden accept=".html,.htm,.txt,.md,.doc,.docx,.pdf,.odt,.rtf" aria-label="Upload a template file" onChange={(e) => onUpload(e.target.files?.[0])} />
                            <Btn size="sm" disabled={busy} onClick={() => upload.current?.click()}>{busy ? 'Uploading…' : 'Upload'}</Btn>
                            <Btn size="sm" primary onClick={() => setStudio({ mode: 'new' })}>New template</Btn>
                        </>
                    )}
                </Row>}>
                {templates.length === 0 ? (
                    <Empty action={can.create && <Btn primary onClick={() => setStudio({ mode: 'new' })}>Write the first template</Btn>}>
                        No templates yet. Write proposals, letters, reports or meeting minutes once, with variables like
                        {' {{company_name}} '}that fill themselves from the project.
                    </Empty>
                ) : (
                    <>
                        <Bar>
                            <Search value={query} onChange={setQuery} placeholder="Search templates" width={210} />
                            <Select aria-label="Type" value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 170, height: 29 }}>
                                <option value="">Every type</option>
                                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}{counts[c.id] ? ` (${counts[c.id]})` : ''}</option>)}
                            </Select>
                            {(query || category) && <Btn size="sm" onClick={() => { setQuery(''); setCategory(''); }}>Clear</Btn>}
                        </Bar>
                        {shown.length === 0 ? <Empty>No template matches.</Empty> : (
                            <div style={{ padding: 12 }}>
                                <Grid min={250} gap={10}>
                                    {shown.map((x) => (
                                        <TemplateCard key={x.id} template={x} onPrimary={() => use(x)}
                                            menu={<RowMenu label={`Actions for ${x.name}`} items={cardMenu(x)}>⋯</RowMenu>} />
                                    ))}
                                </Grid>
                            </div>
                        )}
                    </>
                )}
            </Panel>

            {studio && (
                <TemplateStudio project={project} templates={templates} start={studio}
                    onClose={() => setStudio(null)} onOpenDocs={onOpen ? () => { setStudio(null); onOpen('documents'); } : null} />
            )}
        </SetupGate>
    );
}

function TemplateCard({ template: x, menu, onPrimary }) {
    const t = useT();
    const text = htmlToText(x.body_html);
    const vars = findPlaceholders(x.body_html).length;
    return (
        <div style={{ border: '1px solid ' + t.line, borderRadius: 10, background: t.panel, display: 'grid', minWidth: 0 }}>
            <div style={{ padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, color: t.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: t.faint }}>
                        {typeOf(x)}{x.letterhead ? ' · letterhead' : ''} · {x.body_html ? `${vars} variable${vars === 1 ? '' : 's'}` : `file: ${x.file_name}`} · {fmtDate(x.updated_at)}
                    </span>
                </span>
                {menu}
            </div>
            <p style={{
                margin: 0, padding: '0 12px', fontSize: 12, color: t.dim, lineHeight: 1.6, height: 58, overflow: 'hidden',
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
            }}>{text || (x.file_path ? 'An uploaded file, kept to download.' : 'Empty.')}</p>
            <div style={{ padding: 10 }}>
                <Btn size="sm" full onClick={onPrimary}>{x.body_html ? 'Use template' : 'Download file'}</Btn>
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════════
   The template studio: a full-window workspace over the page.
   ══════════════════════════════════════════════════════════════════════════ */

function TemplateStudio({ project, templates, start, onClose, onOpenDocs }) {
    const t = useT();
    const data = useFillData(project);
    const narrow = useNarrow();
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('');
    const [selectedId, setSelectedId] = useState(start.id || null);
    // The template being written: a new one, an upload to finish, or an existing one.
    const [draft, setDraft] = useState(() => start.draft || (start.mode === 'edit' && templates.find((x) => x.id === start.id)) || null);
    const [picking, setPicking] = useState(start.mode === 'new');

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return templates.filter((x) => (!category || x.category === category)
            && (!q || x.name.toLowerCase().includes(q) || typeOf(x).toLowerCase().includes(q) || htmlToText(x.body_html).toLowerCase().includes(q)))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [templates, query, category]);
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, templates.filter((x) => x.category === c.id).length]));
    const selected = templates.find((x) => x.id === selectedId) || shown[0] || templates[0] || null;
    const { can, menuFor } = useTemplateActions(project, templates, {
        duplicated: (row) => row?.id && setSelectedId(row.id),
        removed: () => setSelectedId(null),
    });

    const select = (id) => { setSelectedId(id); setDraft(null); setPicking(false); };
    const startFrom = (s) => {
        setPicking(false);
        setDraft({ name: s.name, category: s.category, type_label: s.type_label || '', letterhead: !!s.letterhead, body_html: s.body_html });
    };
    // Writing is the one state with something to lose.
    const close = async () => {
        if (draft && !(await confirmDialog({ title: 'Close without saving?', message: 'The template you are writing is not saved yet.', confirmLabel: 'Close', tone: 'danger' }))) return;
        onClose();
    };

    let main;
    if (draft) {
        main = <Editor key={draft.id || 'new'} project={project} data={data} draft={draft} onCancel={() => (templates.length ? setDraft(null) : onClose())} onSaved={(id) => select(id)} />;
    } else if (picking || !selected) {
        main = <Starters project={project} data={data} canCreate={can.create} first={!templates.length} onPick={startFrom}
            onCancel={() => (templates.length ? setPicking(false) : onClose())} />;
    } else if (selected.body_html) {
        main = (
            <Composer key={selected.id} project={project} data={data} template={selected} canEdit={can.edit}
                menu={menuFor(selected)} onEdit={() => setDraft(selected)} onOpenDocs={onOpenDocs} />
        );
    } else {
        main = <FileTemplate template={selected} menu={menuFor(selected)} />;
    }

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 300, padding: narrow ? 0 : 16, display: 'flex',
            background: t.isDark ? 'rgba(0,0,0,.62)' : 'rgba(20,28,32,.34)', fontFamily: MONO,
        }}>
            <DialogSheet label={`Templates for ${project.name}`} onClose={close} className="edge-page" style={{
                flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', color: t.text,
                background: t.panel, border: narrow ? 'none' : '1px solid ' + t.lineStrong, borderRadius: narrow ? 0 : 12,
                boxShadow: t.shadow, animation: 'edgePop .16s cubic-bezier(.16,1,.3,1)',
            }}>
                <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px 0 16px', height: 46, flexShrink: 0, borderBottom: '1px solid ' + t.line }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>Template studio</span>
                    <span style={{ fontSize: 12, color: t.faint, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {project.code ? `${project.code} · ` : ''}{project.name}
                    </span>
                    <button type="button" onClick={close} aria-label="Close" title="Close (Esc)" className="edge-btn" style={{
                        width: 30, height: 30, borderRadius: 6, cursor: 'pointer', background: 'transparent', border: '1px solid transparent',
                        color: t.faint, fontFamily: MONO, fontSize: 17, lineHeight: 1,
                    }}>×</button>
                </header>
                <Narrow.Provider value={narrow}>
                    <div style={{
                        flex: 1, minHeight: 0, display: 'grid', overflowY: narrow ? 'auto' : 'hidden',
                        gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : '248px minmax(0, 1fr) 300px',
                        gridTemplateRows: narrow ? 'auto' : 'minmax(0, 1fr)',
                    }}>
                        <Rail templates={templates} shown={shown} activeId={draft ? draft.id : (picking ? null : selected?.id)}
                            onSelect={select} query={query} setQuery={setQuery} category={category} setCategory={setCategory}
                            counts={counts} can={can} narrow={narrow} picking={picking && !draft}
                            onNew={() => { setDraft(null); setPicking(true); }} />
                        {main}
                    </div>
                </Narrow.Provider>
            </DialogSheet>
        </div>
    );
}

/* ── layout pieces ────────────────────────────────────────────────────────── */

const Narrow = createContext(false);

function Pane({ children, side, style }) {
    const t = useT();
    const narrow = useContext(Narrow);
    return (
        <section style={{
            minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
            background: side ? t.panel : t.panelAlt,
            ...(narrow ? { borderTop: '1px solid ' + t.line, maxHeight: side ? 'none' : '80vh' } : { borderLeft: '1px solid ' + t.line }),
            ...style,
        }}>{children}</section>
    );
}

function PaneHead({ title, note, children }) {
    const t = useT();
    return (
        <header style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', minHeight: 52, flexShrink: 0,
            borderBottom: '1px solid ' + t.line, background: t.panel,
        }}>
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
                {note && <span style={{ display: 'block', fontSize: 11.5, color: t.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{note}</span>}
            </span>
            {children}
        </header>
    );
}

function Scroll({ children, pad = 14, style }) {
    return <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: pad, ...style }}>{children}</div>;
}

function Section({ title, note, children }) {
    const t = useT();
    return (
        <div style={{ display: 'grid', gap: 8, paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid ' + t.lineSoft }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 500, color: t.text }}>{title}</span>
                {note && <span style={{ fontSize: 11.5, color: t.faint }}>{note}</span>}
            </div>
            {children}
        </div>
    );
}

/* ── the list of templates ────────────────────────────────────────────────── */

function Rail({ templates, shown, activeId, onSelect, query, setQuery, category, setCategory, counts, can, narrow, picking, onNew }) {
    const t = useT();
    return (
        <aside aria-label="Templates" style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: t.panel, maxHeight: narrow ? 360 : 'none' }}>
            <PaneHead title="Templates" note={`${templates.length} in this project`} />
            <div style={{ display: 'grid', gap: 8, padding: '10px 12px', borderBottom: '1px solid ' + t.lineSoft }}>
                {can.create && (
                    <Btn primary full onClick={onNew} aria-pressed={picking}>New template</Btn>
                )}
                {templates.length > 0 && (
                    <>
                        <Search value={query} onChange={setQuery} placeholder="Search templates" width="100%" />
                        <Select aria-label="Type" value={category} onChange={(e) => setCategory(e.target.value)} style={{ height: 29, fontSize: 12.5 }}>
                            <option value="">Every type</option>
                            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}{counts[c.id] ? ` (${counts[c.id]})` : ''}</option>)}
                        </Select>
                    </>
                )}
            </div>
            <div role="list" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 6 }}>
                {templates.length === 0 && (
                    <p style={{ margin: 0, padding: '14px 8px', fontSize: 12, color: t.faint, lineHeight: 1.6 }}>
                        Nothing here yet. Pick a starting point to write the first one.
                    </p>
                )}
                {templates.length > 0 && shown.length === 0 && (
                    <p style={{ margin: 0, padding: '14px 8px', fontSize: 12, color: t.faint }}>No template matches.</p>
                )}
                {shown.map((x) => {
                    const active = x.id === activeId;
                    const vars = findPlaceholders(x.body_html).length;
                    return (
                        <div role="listitem" key={x.id}>
                            <button type="button" onClick={() => onSelect(x.id)} aria-current={active ? 'true' : undefined} className="edge-btn"
                                style={{
                                    display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 2,
                                    borderRadius: 8, border: '1px solid ' + (active ? t.lineStrong : 'transparent'),
                                    background: active ? t.raised : 'transparent', color: t.text, cursor: 'pointer', fontFamily: MONO,
                                }}>
                                <span style={{ display: 'block', fontSize: 13, fontWeight: active ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span>
                                <span style={{ display: 'block', fontSize: 11.5, color: t.faint, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {typeOf(x)}{x.letterhead ? ' · letterhead' : ''} · {x.body_html ? `${vars} variable${vars === 1 ? '' : 's'}` : 'file'}
                                </span>
                            </button>
                        </div>
                    );
                })}
            </div>
        </aside>
    );
}

/* ── starting points ──────────────────────────────────────────────────────── */

function Starters({ project, data, canCreate, first, onPick, onCancel }) {
    const t = useT();
    const values = useMemo(() => valuesFor(project, data, project.client_id || data.clients[0]?.id, data.vendors[0]?.id), [project, data]);
    return (
        <>
            <Pane>
                <PaneHead title={first ? 'Write once, fill from the project' : 'New template'}
                    note="Pick a starting point. You can change everything after">
                    {onCancel && <Btn size="sm" onClick={onCancel}>Cancel</Btn>}
                </PaneHead>
                <Scroll pad={20}>
                    {!canCreate ? (
                        <p style={{ fontSize: 13, color: t.faint }}>Your role can use templates but not write them.</p>
                    ) : (
                        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                            {STARTERS.map((s) => (
                                <button key={s.id} type="button" onClick={() => onPick(s)} className="edge-btn"
                                    style={{
                                        display: 'grid', gridTemplateRows: '120px auto', textAlign: 'left', padding: 0, overflow: 'hidden',
                                        border: '1px solid ' + t.line, borderRadius: 10, background: t.panel, cursor: 'pointer', fontFamily: MONO, color: t.text,
                                    }}>
                                    <span aria-hidden="true" style={{ position: 'relative', background: t.panelAlt, borderBottom: '1px solid ' + t.lineSoft, overflow: 'hidden' }}>
                                        <span style={{
                                            position: 'absolute', left: 18, right: 18, top: 14, bottom: -10, background: '#fff', borderRadius: 4,
                                            boxShadow: '0 1px 3px rgba(0,0,0,.12)', padding: '10px 12px', color: '#333',
                                            fontSize: 6.5, lineHeight: 1.5, overflow: 'hidden',
                                        }}>
                                            {s.letterhead && <span style={{ display: 'block', borderBottom: '1px solid #ddd', paddingBottom: 4, marginBottom: 5, textAlign: 'right', fontWeight: 700 }}>{(values.company_name || 'Your company').toUpperCase()}</span>}
                                            <span dangerouslySetInnerHTML={{ __html: fillPlaceholders(s.body_html, values) }} />
                                        </span>
                                    </span>
                                    <span style={{ padding: '10px 12px' }}>
                                        <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{s.label}</span>
                                        <span style={{ display: 'block', fontSize: 11.5, color: t.faint, marginTop: 2 }}>{s.note}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </Scroll>
            </Pane>
            <Pane side>
                <PaneHead title="What this project can fill" note="These variables have a value here" />
                <Variables values={values} />
            </Pane>
        </>
    );
}

/* ── the variables list ───────────────────────────────────────────────────── */

/** Only variables with a value in this project. With `onInsert` each one is a button. */
function Variables({ values, onInsert, used = [] }) {
    const t = useT();
    const [q, setQ] = useState('');
    const list = availablePlaceholders(values);
    const needle = q.trim().toLowerCase();
    const match = (p) => !needle || p.label.toLowerCase().includes(needle) || p.key.includes(needle) || String(values[p.key]).toLowerCase().includes(needle);
    const missing = PLACEHOLDER_GROUPS.filter((g) => (g.id === 'client' || g.id === 'vendor') && !list.some((p) => p.group === g.id));
    return (
        <>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid ' + t.lineSoft }}>
                <Search value={q} onChange={setQ} placeholder="Find a variable" width="100%" />
            </div>
            <Scroll pad="6px 8px 12px">
                {PLACEHOLDER_GROUPS.map((g) => {
                    const items = list.filter((p) => p.group === g.id && match(p));
                    if (!items.length) return null;
                    return (
                        <div key={g.id} style={{ marginBottom: 6 }}>
                            <div style={{ fontSize: 11.5, color: t.faint, padding: '8px 6px 4px' }}>{g.label}</div>
                            {items.map((p) => {
                                const body = (
                                    <>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: t.text }}>
                                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
                                            {used.includes(p.key) && <span style={{ fontSize: 10.5, color: t.up }}>in use</span>}
                                        </span>
                                        <span style={{ display: 'block', fontSize: 11.5, color: t.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{values[p.key]}</span>
                                    </>
                                );
                                const box = { display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: 7, border: '1px solid transparent', background: 'transparent', fontFamily: MONO };
                                return onInsert ? (
                                    <button key={p.key} type="button" className="edge-btn" style={{ ...box, cursor: 'pointer' }}
                                        title={`Insert {{${p.key}}}`} aria-label={`Insert ${p.label}`}
                                        onMouseDown={(e) => e.preventDefault()} onClick={() => onInsert(p.key)}>{body}</button>
                                ) : <div key={p.key} style={box}>{body}</div>;
                            })}
                        </div>
                    );
                })}
                {list.length > 0 && !list.some(match) && <p style={{ fontSize: 12, color: t.faint, padding: '8px 6px' }}>No variable matches.</p>}
                {missing.length > 0 && !needle && (
                    <p style={{ fontSize: 11.5, color: t.faint, lineHeight: 1.6, padding: '8px 6px 0', margin: 0 }}>
                        Add a {missing.map((g) => g.label.toLowerCase()).join(' or ')} to this project to use {missing.length > 1 ? 'their' : 'its'} details too.
                    </p>
                )}
            </Scroll>
        </>
    );
}

/* ── the rich-text editor ─────────────────────────────────────────────────── */

const TOOLS = [
    { cmd: 'bold', label: 'B', name: 'Bold', style: { fontWeight: 700 } },
    { cmd: 'italic', label: 'I', name: 'Italic', style: { fontStyle: 'italic' } },
    { cmd: 'underline', label: 'U', name: 'Underline', style: { textDecoration: 'underline' } },
    { cmd: 'formatBlock', arg: 'H1', label: 'H1', name: 'Heading' },
    { cmd: 'formatBlock', arg: 'H2', label: 'H2', name: 'Subheading' },
    { cmd: 'formatBlock', arg: 'P', label: '¶', name: 'Paragraph' },
    { cmd: 'insertUnorderedList', label: '• List', name: 'Bulleted list' },
    { cmd: 'insertOrderedList', label: '1. List', name: 'Numbered list' },
];

/**
 * contentEditable with a small toolbar. `resetKey` reloads `value` into it;
 * otherwise it is uncontrolled. `insert(key)` (through the ref) puts
 * {{key}} where the caret last was, even after focus moved to a side panel.
 */
const RichEditor = forwardRef(function RichEditor({ value, onChange, resetKey, label, paper = false }, ref) {
    const t = useT();
    const box = useRef(null);
    const range = useRef(null);
    useEffect(() => { if (box.current) box.current.innerHTML = sanitizeHtml(value); }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        const keep = () => {
            const sel = document.getSelection();
            if (sel?.rangeCount && box.current?.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange();
        };
        document.addEventListener('selectionchange', keep);
        return () => document.removeEventListener('selectionchange', keep);
    }, []);
    const restore = () => {
        box.current?.focus();
        const sel = document.getSelection();
        if (range.current && sel) { sel.removeAllRanges(); sel.addRange(range.current); }
    };
    const run = (tool) => {
        restore();
        document.execCommand(tool.cmd, false, tool.arg);
        onChange(box.current.innerHTML);
    };
    useImperativeHandle(ref, () => ({
        insert(key) {
            restore();
            document.execCommand('insertText', false, `{{${key}}}`);
            onChange(box.current.innerHTML);
        },
    }));
    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: paper ? undefined : 1 }}>
            {!paper && (
                <div role="toolbar" aria-label="Formatting" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 14px', borderBottom: '1px solid ' + t.line, background: t.panel, flexShrink: 0 }}>
                    {TOOLS.map((tool) => (
                        <button key={tool.name} type="button" aria-label={tool.name} title={tool.name}
                            onMouseDown={(e) => e.preventDefault()} onClick={() => run(tool)} className="edge-btn"
                            style={{
                                height: 27, minWidth: 30, padding: '0 8px', borderRadius: 6, border: '1px solid ' + t.line, background: t.panel,
                                color: t.text, cursor: 'pointer', fontFamily: MONO, fontSize: 12, ...tool.style,
                            }}>{tool.label}</button>
                    ))}
                </div>
            )}
            <div ref={box} role="textbox" aria-multiline="true" aria-label={label} contentEditable suppressContentEditableWarning
                onInput={(e) => onChange(e.currentTarget.innerHTML)}
                className="eo-rich"
                style={paper
                    ? { minHeight: 360, fontSize: 13, lineHeight: 1.7, color: '#16181a', outline: 'none' }
                    : { flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 22px', fontSize: 13.5, lineHeight: 1.7, color: t.text, outline: 'none', background: t.panel }} />
            <style>{`
                .eo-rich h1 { font-size: 22px; margin: 6px 0 10px; } .eo-rich h2 { font-size: 16px; margin: 14px 0 6px; }
                .eo-rich h3 { font-size: 14.5px; } .eo-rich p { margin: 0 0 8px; } .eo-rich ul, .eo-rich ol { margin: 0 0 8px; padding-left: 22px; }
            `}</style>
        </div>
    );
});

/* ── writing a template ───────────────────────────────────────────────────── */

function Editor({ project, data, draft, onCancel, onSaved }) {
    const t = useT();
    const toast = useToast();
    const editor = useRef(null);
    const [name, setName] = useState(draft.name || '');
    const [category, setCategory] = useState(draft.category || 'proposal');
    const [typeLabel, setTypeLabel] = useState(draft.type_label || '');
    const [letterhead, setLetterhead] = useState(!!draft.letterhead);
    const [html, setHtml] = useState(draft.body_html ?? '<p></p>');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const values = useMemo(() => valuesFor(project, data, project.client_id || data.clients[0]?.id, data.vendors[0]?.id), [project, data]);
    const used = findPlaceholders(html);
    const notVariables = used.filter((k) => !PLACEHOLDER_BY_KEY[k]);
    const noValue = used.filter((k) => PLACEHOLDER_BY_KEY[k] && !has(values[k]));
    const other = category === 'other';

    const save = async () => {
        const body = sanitizeHtml(html);
        if (!name.trim()) { setError('Give the template a name.'); return; }
        if (!htmlToText(body).trim()) { setError('The template is empty.'); return; }
        setSaving(true);
        setError('');
        const base = { project_id: project.id, name: name.trim().slice(0, 200), category, body_html: body };
        // Sent only when there is something to say, so a database without 0084 still saves.
        const extra = other || draft.letterhead || draft.type_label
            ? { type_label: other ? typeLabel.trim().slice(0, 60) : '', letterhead: other && letterhead } : null;
        const write = (row) => (draft.id ? orgStore.updateItem('project_templates', draft.id, row).then(() => ({ id: draft.id })) : orgStore.addItem('project_templates', row));
        try {
            let row;
            try {
                row = await write(extra ? { ...base, ...extra } : base);
            } catch (e) {
                if (!extra || !needs0084(e)) throw e;
                row = await write(base);
                toast('Saved. The type name and letterhead switch start working once database update 0084 is applied.', 'info', 6000);
            }
            toast(draft.id ? 'Template saved' : 'Template created', 'success');
            onSaved(row?.id || null);
        } catch (e) { setError(fileError(e)); } finally { setSaving(false); }
    };

    return (
        <>
            <Pane>
                <PaneHead title={draft.id ? `Editing “${draft.name}”` : 'New template'} note="Click a variable on the right to drop it in at the cursor">
                    <Btn size="sm" onClick={onCancel}>Cancel</Btn>
                    <Btn size="sm" primary disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save template'}</Btn>
                </PaneHead>
                <div style={{ display: 'grid', gap: 10, padding: '12px 14px', borderBottom: '1px solid ' + t.line, background: t.panel, flexShrink: 0 }}>
                    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)' }}>
                        <Field required label="Name"><Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder="Project proposal" /></Field>
                        <Field label="Type">
                            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </Select>
                        </Field>
                    </div>
                    {other && (
                        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'end' }}>
                            <Field label="Type name">
                                <Input value={typeLabel} maxLength={60} onChange={(e) => setTypeLabel(e.target.value)} placeholder="Work order, site visit note…" />
                            </Field>
                            <SwitchRow checked={letterhead} onChange={setLetterhead} title="Print on letterhead"
                                note="Your logo, name and contact details on top" />
                        </div>
                    )}
                </div>
                <RichEditor ref={editor} value={html} onChange={setHtml} resetKey={draft.id || 'new'} label="Template body" />
                {(notVariables.length > 0 || noValue.length > 0 || error) && (
                    <div style={{ display: 'grid', gap: 4, padding: '8px 14px', borderTop: '1px solid ' + t.line, background: t.panel, fontSize: 12, flexShrink: 0 }}>
                        {notVariables.length > 0 && (
                            <span role="status" style={{ color: t.down }}>Not a variable, so it stays as typed: {notVariables.map((k) => `{{${k}}}`).join(', ')}</span>
                        )}
                        {noValue.length > 0 && (
                            <span role="status" style={{ color: t.dim }}>
                                Nothing to fill from yet. You will type these when you use the template: {noValue.map((k) => PLACEHOLDER_BY_KEY[k].label.toLowerCase()).join(', ')}
                            </span>
                        )}
                        {error && <span role="alert" style={{ color: t.down }}>{error}</span>}
                    </div>
                )}
            </Pane>
            <Pane side>
                <PaneHead title="Variables" note={`${availablePlaceholders(values).length} this project can fill`} />
                <Variables values={values} used={used} onInsert={(key) => editor.current?.insert(key)} />
            </Pane>
        </>
    );
}

/* ── using a template ─────────────────────────────────────────────────────── */

function Letterhead({ lh }) {
    const lines = [lh.cin && `CIN: ${lh.cin}`, lh.companyAddress, lh.companyPhone, lh.companyEmail, lh.companyWebsite].filter(Boolean);
    return (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', paddingBottom: 12, marginBottom: 18, borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                {lh.companyLogo && <img src={lh.companyLogo} alt="" style={{ maxHeight: 44, maxWidth: 140, objectFit: 'contain', display: 'block' }} />}
                {lh.companyTagline && <div style={{ fontSize: 9, fontStyle: 'italic', color: '#666', marginTop: 4 }}>{lh.companyTagline}</div>}
            </div>
            <div style={{ textAlign: 'right', fontSize: 9.5, color: '#333', lineHeight: 1.5 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#000', letterSpacing: '0.02em' }}>{(lh.companyName || 'Your company').toUpperCase()}</div>
                {lines.map((l) => <div key={l}>{l}</div>)}
            </div>
        </div>
    );
}

function Composer({ project, data, template, canEdit, menu, onEdit, onOpenDocs }) {
    const t = useT();
    const toast = useToast();
    const folders = useSection('project_folders').filter((f) => f.project_id === project.id);
    const [clientId, setClientId] = useState(project.client_id || data.clients[0]?.id || '');
    const [vendorId, setVendorId] = useState(data.vendors[0]?.id || '');
    const [typed, setTyped] = useState({});
    const [html, setHtml] = useState('');
    const [key, setKey] = useState(0);
    const [name, setName] = useState(`${template.name} · ${project.code || project.name}`.slice(0, 200));
    const [folderId, setFolderId] = useState('');
    const [format, setFormat] = useState('pdf');
    const [busy, setBusy] = useState('');
    const [saved, setSaved] = useState(null);

    const known = useMemo(() => valuesFor(project, data, clientId, vendorId), [project, data, clientId, vendorId]);
    const values = useMemo(() => {
        const out = { ...known };
        Object.entries(typed).forEach(([k, v]) => { if (has(v) && !has(known[k])) out[k] = v; });
        return out;
    }, [known, typed]);
    const used = useMemo(() => findPlaceholders(template.body_html), [template.body_html]);
    const toType = used.filter((k) => !has(known[k]));
    const left = used.filter((k) => !has(values[k]));
    const usesClient = used.some((k) => k.startsWith('client_'));
    const usesVendor = used.some((k) => k.startsWith('vendor_'));
    const letterhead = template.letterhead ? letterheadData(data.profile) : null;

    // Refill whenever the template or what it fills from changes; edits made
    // in the document after that are kept until then.
    useEffect(() => {
        setHtml(fillPlaceholders(template.body_html, values));
        setKey((k) => k + 1);
        setSaved(null);
    }, [template.body_html, values]);

    const fileName = (ext) => `${(name.trim() || 'document').replace(/[\\/:*?"<>|]+/g, '-')}.${ext}`;
    const build = (kind) => (kind === 'pdf'
        ? pdfBlob(sanitizeHtml(html), { title: name, letterhead })
        : docxBlob(sanitizeHtml(html), { letterhead }));
    const download = async (kind) => {
        setBusy(kind);
        try { downloadBlob(await build(kind), fileName(kind)); } catch (e) { toast(fileError(e), 'error'); } finally { setBusy(''); }
    };
    const save = async () => {
        if (!name.trim()) { toast('Give the document a name.', 'error'); return; }
        setBusy('save');
        try {
            const blob = await build(format);
            const file = new File([blob], fileName(format), { type: blob.type });
            const row = await uploadProjectFile(project.id, file, { folderId: folderId || null, tags: ['generated', template.category] });
            setSaved(row);
            toast(row._newVersion ? `Saved as version ${row.version} of ${row.name}` : 'Saved to Project Documents', 'success');
        } catch (e) { toast(fileError(e), 'error'); } finally { setBusy(''); }
    };
    const setOne = useCallback((k, v) => setTyped((s) => ({ ...s, [k]: v })), []);

    return (
        <>
            <Pane>
                <PaneHead title={template.name}
                    note={`${typeOf(template)}${template.letterhead ? ' · on letterhead' : ''} · ${used.length} variable${used.length === 1 ? '' : 's'} · updated ${fmtDate(template.updated_at)}`}>
                    {canEdit && <Btn size="sm" onClick={onEdit}>Edit template</Btn>}
                    <RowMenu label={`More for ${template.name}`} items={menu}>⋯</RowMenu>
                </PaneHead>
                <Scroll pad="22px 22px 28px">
                    <div style={{
                        maxWidth: 720, margin: '0 auto', background: '#fff', color: '#16181a', borderRadius: 4,
                        boxShadow: '0 1px 2px rgba(0,0,0,.08), 0 8px 28px -12px rgba(0,0,0,.25)', padding: '40px 52px 48px',
                    }}>
                        {letterhead && <Letterhead lh={letterhead} />}
                        <RichEditor paper value={html} onChange={setHtml} resetKey={key} label="Document" />
                    </div>
                    <p style={{ textAlign: 'center', fontSize: 11.5, color: t.faint, margin: '10px 0 0' }}>
                        This is the document. Click into it to make last changes before you save.
                    </p>
                </Scroll>
            </Pane>
            <Pane side>
                <PaneHead title="Use this template" note={left.length ? `${left.length} still to fill` : 'Every variable is filled'} />
                <Scroll>
                    {(usesClient || usesVendor) && (
                        <Section title="Fill from">
                            {usesClient && (data.clients.length > 0 ? (
                                <Field label="Client">
                                    <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                                        {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </Select>
                                </Field>
                            ) : <span style={{ fontSize: 12, color: t.faint }}>No client on this project. Type the client details below.</span>)}
                            {usesVendor && (data.vendors.length > 0 ? (
                                <Field label="Vendor">
                                    <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                                        <option value="">None</option>
                                        {data.vendors.map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}
                                    </Select>
                                </Field>
                            ) : <span style={{ fontSize: 12, color: t.faint }}>No vendor on this project. Type the vendor details below.</span>)}
                        </Section>
                    )}
                    {toType.length > 0 && (
                        <Section title="Type what the project does not know" note={`${toType.length}`}>
                            {toType.map((k) => (
                                <Field key={k} label={PLACEHOLDER_BY_KEY[k]?.label || k.replace(/_/g, ' ')}>
                                    <Input value={typed[k] || ''} onChange={(e) => setOne(k, e.target.value)} placeholder={`{{${k}}}`} />
                                </Field>
                            ))}
                        </Section>
                    )}
                    <Section title="Save">
                        <Field required label="Document name"><Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} /></Field>
                        <Field label="Folder">
                            <Select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                                <option value="">Top level</option>
                                {folders.map((f) => ({ id: f.id, path: folderPath(folders, f.id).map((x) => x.name).join(' / ') }))
                                    .sort((a, b) => a.path.localeCompare(b.path))
                                    .map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
                            </Select>
                        </Field>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 12, color: t.faint }}>Save as</span>
                            <Seg size="sm" value={format} onChange={setFormat} label="Save as" options={[{ id: 'pdf', label: 'PDF' }, { id: 'docx', label: 'Word' }]} />
                        </div>
                    </Section>
                </Scroll>
                <div style={{ display: 'grid', gap: 8, padding: 12, borderTop: '1px solid ' + t.line, flexShrink: 0 }}>
                    {left.length > 0 && (
                        <span role="status" style={{ fontSize: 11.5, color: t.down }}>
                            Still empty: {left.map((k) => `{{${k}}}`).join(', ')}
                        </span>
                    )}
                    {saved && (
                        <span role="status" style={{ fontSize: 12, color: t.up }}>
                            Saved as “{saved.name}”.{' '}
                            {onOpenDocs && <button type="button" onClick={onOpenDocs} style={{ background: 'none', border: 0, padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', fontFamily: MONO, fontSize: 12 }}>Open Project Documents</button>}
                        </span>
                    )}
                    {orgStore.can('project_files', 'create') && (
                        <Btn primary full disabled={!!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save to Project Documents'}</Btn>
                    )}
                    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
                        <Btn full disabled={!!busy} onClick={() => download('pdf')}>{busy === 'pdf' ? 'Making…' : 'Download PDF'}</Btn>
                        <Btn full disabled={!!busy} onClick={() => download('docx')}>{busy === 'docx' ? 'Making…' : 'Download Word'}</Btn>
                    </div>
                </div>
            </Pane>
        </>
    );
}

/* ── an uploaded file kept as it is ───────────────────────────────────────── */

function FileTemplate({ template, menu }) {
    const t = useT();
    const toast = useToast();
    const get = () => openObject(template.file_path, { download: template.file_name }).catch((e) => toast(fileError(e), 'error'));
    return (
        <>
            <Pane>
                <PaneHead title={template.name} note={`${typeOf(template)} · uploaded file · ${fmtDate(template.updated_at)}`}>
                    <RowMenu label={`More for ${template.name}`} items={menu}>⋯</RowMenu>
                </PaneHead>
                <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24 }}>
                    <div style={{ textAlign: 'center', maxWidth: 360 }}>
                        <div aria-hidden="true" style={{
                            width: 64, height: 80, margin: '0 auto 14px', borderRadius: 6, border: '1px solid ' + t.lineStrong, background: t.panel,
                            display: 'grid', placeItems: 'center', fontSize: 11, color: t.dim, fontWeight: 600,
                        }}>{(template.file_name.split('.').pop() || 'file').toUpperCase()}</div>
                        <div style={{ fontSize: 13.5, color: t.text, wordBreak: 'break-all' }}>{template.file_name}</div>
                        <p style={{ fontSize: 12, color: t.faint, lineHeight: 1.6 }}>
                            Word and PDF uploads are kept as files to download and fill by hand. Upload an HTML or text version to fill it from the project here.
                        </p>
                        <Btn primary onClick={get}>Download file</Btn>
                    </div>
                </div>
            </Pane>
            <Pane side>
                <PaneHead title="About this file" />
                <Scroll>
                    <p style={{ fontSize: 12, color: t.faint, lineHeight: 1.6, margin: 0 }}>
                        Variables only fill in templates written here. Use New template to write this one so it fills itself.
                    </p>
                </Scroll>
            </Pane>
        </>
    );
}
