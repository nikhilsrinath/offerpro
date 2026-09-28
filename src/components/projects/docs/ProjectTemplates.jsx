import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Panel, Row, Btn, Seg, Search, Select, Field, Input, Empty, Modal, Muted, Grid,
} from '../../ui/edge';
import { useT, MONO, fmtDate } from '../../ui/edgeUtils';
import { useToast } from '../../shared/Toast';
import { useSection } from '../../financial/financeHooks';
import { orgStore } from '../../../services/orgStore';
import { confirmDialog } from '../../../services/confirm';
import {
    putObject, removeObjects, openObject, uploadProjectFile, pdfBlob, docxBlob, downloadBlob, fileError,
} from '../../../services/projectFiles';
import {
    PLACEHOLDERS, placeholderValues, fillPlaceholders, findPlaceholders, sanitizeHtml, htmlToText, escapeHtml, folderPath,
} from '../../../services/projectWorkspace';
import { RowMenu } from '../pm/pmUi';
import { useProjectClients, useProjectVendors, useSetup, todayIso } from '../parties/partyData';
import { SetupGate, Bar } from '../parties/partyUi';

/* ══════════════════════════════════════════════════════════════════════════
   Documents Management › Custom Templates — reusable documents for this
   project, written once with {{placeholders}} and filled from what the
   project already knows: its client, a vendor, its dates and value.

   "Generate" fills a template, lets you make last edits, then saves the
   result into Project Documents as a PDF and/or downloads it as PDF or Word.
   An uploaded Word or PDF template is kept as a file to download; only an
   HTML or text upload becomes editable.
   ══════════════════════════════════════════════════════════════════════════ */

const CATEGORIES = [
    { id: 'proposal', label: 'Proposal' }, { id: 'quotation', label: 'Quotation' }, { id: 'invoice', label: 'Invoice' },
    { id: 'report', label: 'Report' }, { id: 'agreement', label: 'Agreement' }, { id: 'minutes', label: 'Meeting minutes' },
    { id: 'other', label: 'Other' },
];
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
const STARTER = '<h1>{{project_name}}</h1><p>Prepared for <b>{{client_name}}</b> on {{date}}.</p><h2>Summary</h2><p></p>';

export default function ProjectTemplates({ project, onOpen }) {
    const toast = useToast();
    const setup = useSetup('project_templates', ['project_templates']);
    const all = useSection('project_templates');
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('');
    const [editing, setEditing] = useState(null);   // template | {} new
    const [generating, setGenerating] = useState(null);
    const upload = useRef(null);
    const [busy, setBusy] = useState(false);

    const can = {
        create: orgStore.can('project_files', 'create'),
        edit: orgStore.can('project_files', 'edit'),
        remove: orgStore.can('project_files', 'delete'),
    };
    const templates = useMemo(() => all.filter((x) => x.project_id === project.id), [all, project.id]);
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return templates.filter((x) => (!category || x.category === category)
            && (!q || x.name.toLowerCase().includes(q) || htmlToText(x.body_html).toLowerCase().includes(q)))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [templates, query, category]);
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, templates.filter((x) => x.category === c.id).length]));

    const duplicate = async (x) => {
        try {
            await orgStore.addItem('project_templates', {
                project_id: project.id, name: `${x.name} (copy)`.slice(0, 200), category: x.category,
                body_html: x.body_html, file_path: x.file_path, file_name: x.file_name,
            });
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
            toast('Template deleted', 'success');
        } catch (e) { toast(fileError(e), 'error'); }
    };

    // An uploaded template: HTML and text become editable; anything else is kept as a file.
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
                setEditing({ name, category: 'other', body_html: body, _new: true });
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

    const menu = (x) => [
        x.body_html && { label: 'Generate document', onSelect: () => setGenerating(x) },
        x.file_path && { label: 'Download file', onSelect: () => openObject(x.file_path, { download: x.file_name }).catch((e) => toast(fileError(e), 'error')) },
        can.edit && { label: 'Edit', onSelect: () => setEditing(x) },
        can.create && { label: 'Duplicate', onSelect: () => duplicate(x) },
        can.remove && { label: 'Delete', danger: true, onSelect: () => remove(x) },
    ];

    return (
        <SetupGate setup={setup} what="custom templates">
            <Panel title="Templates" note={`${templates.length} for this project`}
                actions={<Row gap={6}>
                    {templates.some((x) => x.body_html) && <Btn size="sm" onClick={() => setGenerating(templates.find((x) => x.body_html))}>Generate document</Btn>}
                    {can.create && (
                        <>
                            <input ref={upload} type="file" hidden accept=".html,.htm,.txt,.md,.doc,.docx,.pdf,.odt,.rtf" aria-label="Upload a template file" onChange={(e) => onUpload(e.target.files?.[0])} />
                            <Btn size="sm" disabled={busy} onClick={() => upload.current?.click()}>{busy ? 'Uploading…' : 'Upload'}</Btn>
                            <Btn size="sm" primary onClick={() => setEditing({})}>New template</Btn>
                        </>
                    )}
                </Row>}>
                {templates.length === 0 ? (
                    <Empty action={can.create && <Btn primary onClick={() => setEditing({})}>Write the first template</Btn>}>
                        No templates yet. Write proposals, quotations, reports, agreements or meeting minutes once, with
                        placeholders like {'{{client_name}}'} that fill themselves from the project.
                    </Empty>
                ) : (
                    <>
                        <Bar>
                            <Search value={query} onChange={setQuery} placeholder="Search templates" width={210} />
                            <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 170, height: 29 }}>
                                <option value="">Every category</option>
                                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}{counts[c.id] ? ` (${counts[c.id]})` : ''}</option>)}
                            </Select>
                            {(query || category) && <Btn size="sm" onClick={() => { setQuery(''); setCategory(''); }}>Clear</Btn>}
                        </Bar>
                        {shown.length === 0 ? <Empty>No template matches.</Empty> : (
                            <div style={{ padding: 12 }}>
                                <Grid min={250} gap={10}>
                                    {shown.map((x) => (
                                        <TemplateCard key={x.id} template={x} menu={<RowMenu label={`Actions for ${x.name}`} items={menu(x)}>⋯</RowMenu>}
                                            onPrimary={() => (x.body_html ? setGenerating(x) : openObject(x.file_path, { download: x.file_name }).catch((e) => toast(fileError(e), 'error')))} />
                                    ))}
                                </Grid>
                            </div>
                        )}
                    </>
                )}
            </Panel>

            {editing && <TemplateEditor project={project} template={editing.id ? editing : null} draft={editing} onClose={() => setEditing(null)} />}
            {generating && (
                <Generate project={project} templates={templates.filter((x) => x.body_html)} initial={generating}
                    onClose={() => setGenerating(null)} onOpenDocs={onOpen ? () => onOpen('documents') : null} />
            )}
        </SetupGate>
    );
}

function TemplateCard({ template: x, menu, onPrimary }) {
    const t = useT();
    const text = htmlToText(x.body_html);
    const holes = findPlaceholders(x.body_html);
    return (
        <div style={{ border: '1px solid ' + t.line, borderRadius: 10, background: t.panel, display: 'grid', minWidth: 0 }}>
            <div style={{ padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, color: t.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: t.faint }}>
                        {CAT[x.category]} · {x.body_html ? `${holes.length} placeholder${holes.length === 1 ? '' : 's'}` : `file: ${x.file_name}`} · {fmtDate(x.updated_at)}
                    </span>
                </span>
                {menu}
            </div>
            <p style={{
                margin: 0, padding: '0 12px', fontSize: 12, color: t.dim, lineHeight: 1.6, height: 58, overflow: 'hidden',
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
            }}>{text || (x.file_path ? 'An uploaded file, kept to download.' : 'Empty.')}</p>
            <div style={{ padding: 10 }}>
                <Btn size="sm" full onClick={onPrimary}>{x.body_html ? 'Generate document' : 'Download file'}</Btn>
            </div>
        </div>
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

/** contentEditable with a small toolbar. `resetKey` reloads `value` into it; otherwise it is uncontrolled. */
function RichEditor({ value, onChange, resetKey, label }) {
    const t = useT();
    const ref = useRef(null);
    useEffect(() => { if (ref.current) ref.current.innerHTML = sanitizeHtml(value); }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const run = (tool) => {
        ref.current?.focus();
        document.execCommand(tool.cmd, false, tool.arg);
        onChange(ref.current.innerHTML);
    };
    const insert = (key) => {
        if (!key) return;
        ref.current?.focus();
        document.execCommand('insertText', false, `{{${key}}}`);
        onChange(ref.current.innerHTML);
    };
    return (
        <div style={{ border: '1px solid ' + t.line, borderRadius: 9, overflow: 'hidden' }}>
            <div role="toolbar" aria-label="Formatting" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 6, borderBottom: '1px solid ' + t.lineSoft, background: t.panelAlt }}>
                {TOOLS.map((tool) => (
                    <button key={tool.name} type="button" aria-label={tool.name} title={tool.name}
                        onMouseDown={(e) => e.preventDefault()} onClick={() => run(tool)} className="edge-btn"
                        style={{
                            height: 28, minWidth: 30, padding: '0 8px', borderRadius: 6, border: '1px solid ' + t.line, background: t.panel,
                            color: t.text, cursor: 'pointer', fontFamily: MONO, fontSize: 12, ...tool.style,
                        }}>{tool.label}</button>
                ))}
                <Select aria-label="Insert a placeholder" value="" onMouseDown={(e) => e.stopPropagation()}
                    onChange={(e) => insert(e.target.value)} style={{ width: 200, height: 28, fontSize: 12 }}>
                    <option value="">Insert placeholder…</option>
                    {PLACEHOLDERS.map((p) => <option key={p.key} value={p.key}>{p.label} — {`{{${p.key}}}`}</option>)}
                </Select>
            </div>
            <div ref={ref} role="textbox" aria-multiline="true" aria-label={label} contentEditable suppressContentEditableWarning
                onInput={(e) => onChange(e.currentTarget.innerHTML)}
                className="eo-rich"
                style={{ minHeight: 260, maxHeight: '55vh', overflowY: 'auto', padding: '12px 16px', fontSize: 13.5, lineHeight: 1.7, color: t.text, outline: 'none', background: t.panel }} />
            <style>{`
                .eo-rich h1 { font-size: 22px; margin: 8px 0; } .eo-rich h2 { font-size: 17px; margin: 8px 0; }
                .eo-rich h3 { font-size: 15px; } .eo-rich p { margin: 0 0 8px; } .eo-rich ul, .eo-rich ol { margin: 0 0 8px; padding-left: 22px; }
            `}</style>
        </div>
    );
}

function TemplateEditor({ project, template, draft, onClose }) {
    const t = useT();
    const toast = useToast();
    const [name, setName] = useState(draft.name || '');
    const [category, setCategory] = useState(draft.category || 'proposal');
    const [html, setHtml] = useState(draft.body_html ?? STARTER);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const unknown = findPlaceholders(html).filter((k) => !PLACEHOLDERS.some((p) => p.key === k));

    const save = async () => {
        const body = sanitizeHtml(html);
        if (!name.trim()) { setError('Give the template a name.'); return; }
        if (!htmlToText(body).trim()) { setError('The template is empty.'); return; }
        setSaving(true);
        try {
            const data = { project_id: project.id, name: name.trim().slice(0, 200), category, body_html: body };
            if (template) await orgStore.updateItem('project_templates', template.id, data);
            else await orgStore.addItem('project_templates', data);
            toast(template ? 'Template saved' : 'Template created', 'success');
            onClose();
        } catch (e) { setError(fileError(e)); } finally { setSaving(false); }
    };

    return (
        <Modal open onClose={onClose} width={860} title={template ? `Edit “${template.name}”` : 'New template'}
            note="Placeholders fill in when you generate a document"
            footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save template'}</Btn></>}>
            <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
                    <Field label="Name *"><Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder="Project proposal" /></Field>
                    <Field label="Type">
                        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </Select>
                    </Field>
                </div>
                <RichEditor value={html} onChange={setHtml} resetKey={template?.id || 'new'} label="Template body" />
                {unknown.length > 0 && (
                    <div role="status" style={{ fontSize: 12, color: t.down }}>
                        Not a known placeholder, so it will stay as typed: {unknown.map((k) => `{{${k}}}`).join(', ')}
                    </div>
                )}
                {error && <div role="alert" style={{ fontSize: 12.5, color: t.down }}>{error}</div>}
            </div>
        </Modal>
    );
}

/* ── generating a document ────────────────────────────────────────────────── */

function Generate({ project, templates, initial, onClose, onOpenDocs }) {
    const t = useT();
    const toast = useToast();
    const { clients } = useProjectClients(project);
    const { vendors } = useProjectVendors(project);
    const employees = useSection('employees');
    const folders = useSection('project_folders').filter((f) => f.project_id === project.id);
    const [templateId, setTemplateId] = useState(initial.id);
    const [clientId, setClientId] = useState(project.client_id || clients[0]?.id || '');
    const [vendorId, setVendorId] = useState(vendors[0]?.id || '');
    const [html, setHtml] = useState('');
    const [key, setKey] = useState(0);
    const [name, setName] = useState('');
    const [folderId, setFolderId] = useState('');
    const [format, setFormat] = useState('pdf');
    const [busy, setBusy] = useState('');
    const [saved, setSaved] = useState(null);
    const template = templates.find((x) => x.id === templateId) || templates[0];

    const values = useMemo(() => placeholderValues({
        project,
        client: clients.find((c) => c.id === clientId) || null,
        vendor: vendors.find((v) => v.id === vendorId) || null,
        manager: employees.find((e) => e.id === project.manager_employee_id)?.name || '',
        company: orgStore.getProfile()?.company_name || orgStore.getProfile()?.name || '',
        today: todayIso(),
    }), [project, clients, vendors, employees, clientId, vendorId]);

    // Refill whenever the template or the people it names change; edits made
    // after that are kept until then.
    useEffect(() => {
        if (!template) return;
        setHtml(fillPlaceholders(template.body_html, values));
        setName(`${template.name} — ${project.code || project.name}`.slice(0, 200));
        setKey((k) => k + 1);
    }, [template, values, project.code, project.name]);

    const unfilled = findPlaceholders(html);
    const needsVendor = findPlaceholders(template?.body_html).some((k) => k.startsWith('vendor_'));
    const fileName = (ext) => `${(name.trim() || 'document').replace(/[\\/:*?"<>|]+/g, '-')}.${ext}`;

    const build = async (kind) => (kind === 'pdf' ? pdfBlob(sanitizeHtml(html), { title: name }) : docxBlob(sanitizeHtml(html)));
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

    if (!template) {
        return (
            <Modal open onClose={onClose} title="Generate a document" footer={<Btn primary onClick={onClose}>Close</Btn>}>
                <Muted>No editable template yet. Write one first.</Muted>
            </Modal>
        );
    }

    return (
        <Modal open onClose={onClose} width={900} title="Generate a document" note="Filled from the project — edit anything before you save"
            footer={<>
                <Btn disabled={!!busy} onClick={() => download('pdf')}>{busy === 'pdf' ? 'Making…' : 'Download PDF'}</Btn>
                <Btn disabled={!!busy} onClick={() => download('docx')}>{busy === 'docx' ? 'Making…' : 'Download Word'}</Btn>
                <div style={{ flex: 1 }} />
                {saved && onOpenDocs && <Btn onClick={() => { onClose(); onOpenDocs(); }}>Open Project Documents</Btn>}
                {orgStore.can('project_files', 'create') && <Btn primary disabled={!!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save to Project Documents'}</Btn>}
            </>}>
            <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                    <Field label="Template">
                        <Select value={template.id} onChange={(e) => setTemplateId(e.target.value)}>
                            {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </Select>
                    </Field>
                    {clients.length > 0 && (
                        <Field label="Client">
                            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </Select>
                        </Field>
                    )}
                    {(needsVendor || vendors.length > 0) && (
                        <Field label="Vendor">
                            <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                                <option value="">None</option>
                                {vendors.map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}
                            </Select>
                        </Field>
                    )}
                </div>
                {unfilled.length > 0 && (
                    <div role="status" style={{ fontSize: 12.5, color: t.down }}>
                        Nothing to fill {unfilled.map((k) => `{{${k}}}`).join(', ')} with — type the text in below, or add it to the project, client or vendor.
                    </div>
                )}
                <RichEditor value={html} onChange={setHtml} resetKey={key} label="Document" />
                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                    <Field label="Document name"><Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} /></Field>
                    <Field label="Save into folder">
                        <Select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                            <option value="">Top level</option>
                            {folders.map((f) => ({ id: f.id, path: folderPath(folders, f.id).map((x) => x.name).join(' / ') }))
                                .sort((a, b) => a.path.localeCompare(b.path))
                                .map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
                        </Select>
                    </Field>
                    <div>
                        <span style={{ display: 'block', fontSize: 10.5, letterSpacing: '0.09em', color: t.faint, marginBottom: 5 }}>SAVE AS</span>
                        <Seg value={format} onChange={setFormat} label="Save as" options={[{ id: 'pdf', label: 'PDF' }, { id: 'docx', label: 'Word' }]} />
                    </div>
                </div>
                {saved && <div role="status" style={{ fontSize: 12.5, color: t.up }}>Saved as “{saved.name}” in Project Documents.</div>}
            </div>
        </Modal>
    );
}
