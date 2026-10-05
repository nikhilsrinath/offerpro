import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Panel, Row, Btn, Seg, Search, Select, Field, Input, Empty, Modal, Muted, Table, Tr, Td,
} from '../../ui/edge';
import { useT, MONO, fmtDate } from '../../ui/edgeUtils';
import { useToast } from '../../shared/Toast';
import { useSection } from '../../financial/financeHooks';
import { orgStore } from '../../../services/orgStore';
import { confirmDialog } from '../../../services/confirm';
import {
    uploadProjectFile, restoreVersion, deleteProjectFiles, deleteFolder, signedUrl, openObject, fileError,
} from '../../../services/projectFiles';
import {
    FILE_KINDS, fileKind, canPreview, fmtBytes, folderPath, folderSubtree,
} from '../../../services/projectWorkspace';
import { RowMenu } from '../pm/pmUi';
import ProjectDocuments from '../ProjectDocuments';
import { useSetup, useUserNames } from '../parties/partyData';
import { SetupGate, Bar } from '../parties/partyUi';
import {
    Folder, File as FileIcon, FileText, FileImage, FileSpreadsheet, FileArchive, FileType2, Presentation,
} from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   Documents Management › Project Documents — every file the project holds.

   Folders nest as deep as needed. Dropping or choosing files uploads them
   into the folder you are in; a file with a name that is already there
   becomes its next version, and every earlier version can be opened or made
   current again. Files attached elsewhere on the project (communications,
   approvals, invoices, vendors, generated documents) sit in "Attached
   elsewhere", so this is the one place they can all be found.

   It opens on Business documents (ProjectDocuments): the quotations,
   proformas, invoices, agreements and vendor bills, each startable from
   "New document" already pointed at this project.

   A folder or file can be limited to some roles. Owners and admins always
   see everything; the database hides the rest, including whatever is inside
   a hidden folder.
   ══════════════════════════════════════════════════════════════════════════ */

const ROLES = [
    { id: 'member', label: 'Members' },
    { id: 'viewer', label: 'Viewers' },
    { id: 'employee', label: 'Employees (project members)' },
];
const LINKED = '__linked';
const LINK_LABEL = {
    communication: 'Client communication', approval: 'Approval', invoice: 'Invoice / payment', payment: 'Payment',
    vendor: 'Vendor document', client: 'Client document', generated: 'Generated from a template',
};
const KIND_ICON = { pdf: FileType2, image: FileImage, doc: FileText, sheet: FileSpreadsheet, slides: Presentation, text: FileText, archive: FileArchive, other: FileIcon };
const KIND_LABEL = { pdf: 'PDF', image: 'Image', doc: 'Document', sheet: 'Spreadsheet', slides: 'Slides', text: 'Text', archive: 'Archive', other: 'File' };

export default function ProjectFiles({ project, view, onView }) {
    // The choice is the last part of the path (…/project-documents/general-documents),
    // so a form opened from Business documents comes back to it.
    const tab = view === 'files' ? 'files' : 'business';
    const choose = onView;
    return (
        <div style={{ display: 'grid', gap: 14 }}>
            <Seg value={tab} onChange={choose} label="Documents" options={[
                { id: 'business', label: 'Business documents' },
                { id: 'files', label: 'General Documents' },
            ]} />
            {tab === 'files' ? <FilesView project={project} /> : <ProjectDocuments project={project} onUploaded={() => choose('files')} />}
        </div>
    );
}

function FilesView({ project }) {
    const t = useT();
    const toast = useToast();
    const setup = useSetup('project_files', ['project_folders', 'project_files', 'project_file_versions']);
    const allFolders = useSection('project_folders');
    const allFiles = useSection('project_files');
    const nameOf = useUserNames();
    const input = useRef(null);

    const [at, setAt] = useState(null);         // folder id, LINKED, or null (the top)
    const [view, setView] = useState(() => { try { return localStorage.getItem('eo-docs-view') || 'list'; } catch { return 'list'; } });
    const [query, setQuery] = useState('');
    const [tag, setTag] = useState('');
    const [kind, setKind] = useState('');
    const [uploader, setUploader] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [drag, setDrag] = useState(false);
    const [busy, setBusy] = useState('');
    const [dialog, setDialog] = useState(null);  // { kind, target }

    useEffect(() => { try { localStorage.setItem('eo-docs-view', view); } catch { /* private mode */ } }, [view]);

    const can = {
        create: orgStore.can('project_files', 'create'),
        edit: orgStore.can('project_files', 'edit'),
        remove: orgStore.can('project_files', 'delete'),
    };
    const folders = useMemo(() => allFolders.filter((f) => f.project_id === project.id), [allFolders, project.id]);
    const files = useMemo(() => allFiles.filter((f) => f.project_id === project.id), [allFiles, project.id]);
    const inFolder = at && at !== LINKED ? at : null;

    // A folder that disappeared (deleted, or hidden by a role change) sends you back to the top.
    useEffect(() => { if (at && at !== LINKED && !folders.some((f) => f.id === at)) setAt(null); }, [at, folders]);

    const tags = useMemo(() => [...new Set(files.flatMap((f) => f.tags))].sort(), [files]);
    const uploaders = useMemo(() => [...new Set(files.map((f) => f.created_by).filter(Boolean))], [files]);
    const searching = !!(query || tag || kind || uploader || from || to);

    const listed = useMemo(() => {
        const q = query.trim().toLowerCase();
        const match = (f) => (!q || f.name.toLowerCase().includes(q) || f.tags.some((x) => x.includes(q)))
            && (!tag || f.tags.includes(tag)) && (!kind || fileKind(f.mime_type, f.name) === kind)
            && (!uploader || f.created_by === uploader)
            && (!from || String(f.updated_at).slice(0, 10) >= from) && (!to || String(f.updated_at).slice(0, 10) <= to);
        if (searching) return { folders: [], files: files.filter(match) };
        if (at === LINKED) return { folders: [], files: files.filter((f) => f.link_type) };
        return {
            folders: folders.filter((f) => (f.parent_id || null) === inFolder).sort((a, b) => a.name.localeCompare(b.name)),
            files: files.filter((f) => !f.link_type && (f.folder_id || null) === inFolder),
        };
    }, [files, folders, at, inFolder, searching, query, tag, kind, uploader, from, to]);
    const sortedFiles = [...listed.files].sort((a, b) => a.name.localeCompare(b.name));
    const linkedCount = files.filter((f) => f.link_type).length;
    const crumbs = inFolder ? folderPath(folders, inFolder) : [];

    const upload = async (list) => {
        if (!list.length || !can.create) return;
        if (at === LINKED) { toast('Open a folder (or the top) to upload into it.', 'error'); return; }
        setBusy('upload');
        let added = 0; let versions = 0;
        try {
            for (const f of list) {
                const row = await uploadProjectFile(project.id, f, { folderId: inFolder });
                if (row._newVersion) versions += 1; else added += 1;
            }
            toast([added && `${added} uploaded`, versions && `${versions} saved as a new version`].filter(Boolean).join(', '), 'success');
        } catch (e) {
            toast(fileError(e), 'error');
        } finally {
            setBusy('');
            if (input.current) input.current.value = '';
        }
    };

    const onDrop = (e) => {
        e.preventDefault(); setDrag(false);
        if (e.dataTransfer?.files?.length) upload([...e.dataTransfer.files]);
    };

    const removeFolder = async (folder) => {
        const sub = folderSubtree(folders, folder.id);
        const n = files.filter((f) => sub.has(f.folder_id)).length;
        const ok = await confirmDialog({
            title: `Delete “${folder.name}”?`,
            message: n ? `It holds ${n} file${n === 1 ? '' : 's'} (with every version) and ${sub.size - 1} subfolder${sub.size === 2 ? '' : 's'}. All of it is deleted. This cannot be undone.`
                : 'The folder is empty. This cannot be undone.',
            confirmLabel: 'Delete', tone: 'danger',
        });
        if (!ok) return;
        try { await deleteFolder(folder, sub); toast('Folder deleted', 'success'); } catch (e) { toast(fileError(e), 'error'); }
    };
    const removeFile = async (file) => {
        const ok = await confirmDialog({
            title: `Delete “${file.name}”?`, message: 'Every version is deleted. This cannot be undone.', confirmLabel: 'Delete', tone: 'danger',
        });
        if (!ok) return;
        try { await deleteProjectFiles([file]); toast('File deleted', 'success'); } catch (e) { toast(fileError(e), 'error'); }
    };
    const download = (f) => openObject(f.storage_path, { download: f.name }).catch((e) => toast(fileError(e), 'error'));

    const folderMenu = (f) => [
        { label: 'Open', onSelect: () => setAt(f.id) },
        can.edit && { label: 'Rename', onSelect: () => setDialog({ kind: 'folder', target: f }) },
        can.edit && { label: 'Who can see it', onSelect: () => setDialog({ kind: 'access', target: f, section: 'project_folders' }) },
        can.remove && { label: 'Delete', danger: true, onSelect: () => removeFolder(f) },
    ];
    const fileMenu = (f) => [
        canPreview(f.mime_type, f.name) && { label: 'Preview', onSelect: () => setDialog({ kind: 'preview', target: f }) },
        { label: 'Download', onSelect: () => download(f) },
        { label: `Versions (${f.version})`, onSelect: () => setDialog({ kind: 'versions', target: f }) },
        can.edit && { label: 'Rename & tags', onSelect: () => setDialog({ kind: 'file', target: f }) },
        can.edit && !f.link_type && { label: 'Move to…', onSelect: () => setDialog({ kind: 'move', target: f }) },
        can.edit && { label: 'Who can see it', onSelect: () => setDialog({ kind: 'access', target: f, section: 'project_files' }) },
        can.remove && { label: 'Delete', danger: true, onSelect: () => removeFile(f) },
    ];
    const openFile = (f) => (canPreview(f.mime_type, f.name) ? setDialog({ kind: 'preview', target: f }) : download(f));
    const pathOf = (f) => (f.link_type ? LINK_LABEL[f.link_type] : folderPath(folders, f.folder_id).map((x) => x.name).join(' / ') || 'Top');

    const empty = !listed.folders.length && !sortedFiles.length;

    return (
        <SetupGate setup={setup} what="project documents">
            <section aria-label="Project documents"
                onDragOver={(e) => { if (can.create && at !== LINKED && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDrag(true); } }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); }}
                onDrop={onDrop}
                style={{
                    border: '1px solid ' + (drag ? t.text : t.line), borderRadius: 10, background: t.panel, overflow: 'hidden',
                    outline: drag ? `2px dashed ${t.text}` : 'none', outlineOffset: -6,
                }}>
                {/* — where you are, and what you can do there — */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 13px', borderBottom: '1px solid ' + t.lineSoft }}>
                    <nav aria-label="Folder path" style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', flex: '1 1 240px', minWidth: 0, fontSize: 13 }}>
                        <Crumb onClick={() => setAt(null)} current={!at && !searching}>All documents</Crumb>
                        {at === LINKED && <><Sep /><Crumb current>Attached elsewhere</Crumb></>}
                        {crumbs.map((c, i) => (
                            <React.Fragment key={c.id}><Sep /><Crumb onClick={() => setAt(c.id)} current={i === crumbs.length - 1}>{c.name}</Crumb></React.Fragment>
                        ))}
                    </nav>
                    <Seg size="sm" value={view} onChange={setView} label="Layout" options={[{ id: 'list', label: 'List' }, { id: 'grid', label: 'Grid' }]} />
                    {can.create && at !== LINKED && <Btn size="sm" onClick={() => setDialog({ kind: 'folder', target: null })}>New folder</Btn>}
                    {can.create && at !== LINKED && (
                        <>
                            <input ref={input} type="file" multiple hidden aria-label="Upload files" onChange={(e) => upload([...(e.target.files || [])])} />
                            <Btn size="sm" primary disabled={busy === 'upload'} onClick={() => input.current?.click()}>{busy === 'upload' ? 'Uploading…' : 'Upload'}</Btn>
                        </>
                    )}
                </div>

                <Bar>
                    <Search value={query} onChange={setQuery} placeholder="Search names and tags" width={210} />
                    {tags.length > 0 && (
                        <Select aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value)} style={{ width: 130, height: 29 }}>
                            <option value="">Any tag</option>
                            {tags.map((x) => <option key={x} value={x}>#{x}</option>)}
                        </Select>
                    )}
                    <Select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 130, height: 29 }}>
                        <option value="">Any type</option>
                        {[...FILE_KINDS, { id: 'other', label: 'Other' }].map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                    </Select>
                    {uploaders.length > 1 && (
                        <Select aria-label="Uploaded by" value={uploader} onChange={(e) => setUploader(e.target.value)} style={{ width: 150, height: 29 }}>
                            <option value="">Anyone</option>
                            {uploaders.map((u) => <option key={u} value={u}>{nameOf(u)}</option>)}
                        </Select>
                    )}
                    <Input type="date" aria-label="Modified from" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 140, height: 29 }} />
                    <Input type="date" aria-label="Modified to" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={{ width: 140, height: 29 }} />
                    {searching && <Btn size="sm" onClick={() => { setQuery(''); setTag(''); setKind(''); setUploader(''); setFrom(''); setTo(''); }}>Clear</Btn>}
                </Bar>

                {searching && <div style={{ padding: '8px 13px 0', fontSize: 12, color: t.faint }}>{sortedFiles.length} file{sortedFiles.length === 1 ? '' : 's'} across every folder</div>}

                {/* — the listing — */}
                {!searching && !at && linkedCount > 0 && (
                    <div style={{ padding: '10px 13px 0' }}>
                        <FolderTile name="Attached elsewhere" note={`${linkedCount} file${linkedCount === 1 ? '' : 's'} from communications, approvals, invoices, vendors…`}
                            view="list" onOpen={() => setAt(LINKED)} />
                    </div>
                )}
                {empty ? (
                    <Empty action={!searching && can.create && at !== LINKED && (
                        <Row gap={8} style={{ justifyContent: 'center' }} wrap>
                            <Btn primary onClick={() => input.current?.click()}>Upload files</Btn>
                            <Btn onClick={() => setDialog({ kind: 'folder', target: null })}>New folder</Btn>
                        </Row>
                    )}>
                        {searching ? 'No file matches.' : at ? 'This folder is empty. Drop files here or upload them.'
                            : 'No documents yet. Drop files anywhere on this panel, or upload them, and organise them into folders.'}
                    </Empty>
                ) : view === 'grid' ? (
                    <div style={{ display: 'grid', gap: 10, padding: 13, gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
                        {listed.folders.map((f) => (
                            <FolderTile key={f.id} name={f.name} restricted={!!f.visible_roles} view="grid" onOpen={() => setAt(f.id)}
                                menu={<RowMenu label={`Actions for folder ${f.name}`} items={folderMenu(f)}>⋯</RowMenu>} />
                        ))}
                        {sortedFiles.map((f) => (
                            <FileTile key={f.id} file={f} onOpen={() => openFile(f)} sub={searching || at === LINKED ? pathOf(f) : null}
                                menu={<RowMenu label={`Actions for ${f.name}`} items={fileMenu(f)}>⋯</RowMenu>} />
                        ))}
                    </div>
                ) : (
                    <div style={{ padding: 13 }}>
                        <Table cols={[
                            { key: 'n', label: 'Name' }, { key: 't', label: 'Type' }, { key: 's', label: 'Size', align: 'right' }, { key: 'u', label: 'Uploaded by' },
                            { key: 'c', label: 'Uploaded' }, { key: 'm', label: 'Last modified' }, { key: 'v', label: 'Version', align: 'right' },
                            { key: 'x', label: '', align: 'right' },
                        ]}>
                            {listed.folders.map((f) => (
                                <Tr key={f.id}>
                                    <Td>
                                        <button type="button" onClick={() => setAt(f.id)} className="edge-btn" style={linkBtn(t)}>
                                            <Icon folder />
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                                            {f.visible_roles && <span style={{ fontSize: 10.5, color: t.faint }}>restricted</span>}
                                        </button>
                                    </Td>
                                    <Td muted nowrap>Folder</Td>
                                    <Td align="right" muted>{files.filter((x) => x.folder_id === f.id).length} files</Td>
                                    <Td muted>{nameOf(f.created_by)}</Td>
                                    <Td muted nowrap>{fmtDate(f.created_at)}</Td>
                                    <Td muted nowrap>{fmtDate(f.updated_at)}</Td>
                                    <Td align="right" muted>—</Td>
                                    <Td align="right"><RowMenu label={`Actions for folder ${f.name}`} items={folderMenu(f)}>⋯</RowMenu></Td>
                                </Tr>
                            ))}
                            {sortedFiles.map((f) => (
                                <Tr key={f.id}>
                                    <Td>
                                        <button type="button" onClick={() => openFile(f)} className="edge-btn" style={linkBtn(t)}>
                                            <Icon kind={fileKind(f.mime_type, f.name)} />
                                            <span style={{ minWidth: 0 }}>
                                                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                                                {(f.tags.length > 0 || searching || at === LINKED || f.visible_roles) && (
                                                    <span style={{ display: 'block', fontSize: 11, color: t.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {[(searching || at === LINKED) && pathOf(f), f.visible_roles && 'restricted', ...f.tags.map((x) => `#${x}`)].filter(Boolean).join(' · ')}
                                                    </span>
                                                )}
                                            </span>
                                        </button>
                                    </Td>
                                    <Td muted nowrap>File · {KIND_LABEL[fileKind(f.mime_type, f.name)]}</Td>
                                    <Td align="right" muted nowrap>{fmtBytes(f.size_bytes)}</Td>
                                    <Td muted nowrap>{nameOf(f.created_by)}</Td>
                                    <Td muted nowrap>{fmtDate(f.created_at)}</Td>
                                    <Td muted nowrap>{fmtDate(f.updated_at)}</Td>
                                    <Td align="right">v{f.version}</Td>
                                    <Td align="right"><RowMenu label={`Actions for ${f.name}`} items={fileMenu(f)}>⋯</RowMenu></Td>
                                </Tr>
                            ))}
                        </Table>
                    </div>
                )}
                {can.create && at !== LINKED && !empty && (
                    <div style={{ padding: '0 13px 12px', fontSize: 11.5, color: t.faint }}>
                        Drop files anywhere here to upload. A file with the same name becomes a new version.
                    </div>
                )}
            </section>

            {dialog?.kind === 'folder' && <FolderDialog project={project} parentId={inFolder} folder={dialog.target} onClose={() => setDialog(null)} />}
            {dialog?.kind === 'file' && <FileDialog file={dialog.target} tags={tags} onClose={() => setDialog(null)} />}
            {dialog?.kind === 'move' && <MoveDialog file={dialog.target} folders={folders} onClose={() => setDialog(null)} />}
            {dialog?.kind === 'access' && <AccessDialog target={dialog.target} section={dialog.section} onClose={() => setDialog(null)} />}
            {dialog?.kind === 'versions' && <VersionsDialog file={dialog.target} nameOf={nameOf} canRestore={can.edit} onClose={() => setDialog(null)} />}
            {dialog?.kind === 'preview' && <PreviewDialog file={dialog.target} onDownload={() => download(dialog.target)} onClose={() => setDialog(null)} />}
        </SetupGate>
    );
}

const linkBtn = (t) => ({
    display: 'flex', alignItems: 'center', gap: 9, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer',
    color: t.text, fontFamily: MONO, fontSize: 13, textAlign: 'left', maxWidth: 420, minWidth: 0,
});

function Crumb({ children, onClick, current }) {
    const t = useT();
    if (current || !onClick) return <span aria-current={current ? 'page' : undefined} style={{ color: t.text, fontWeight: 500 }}>{children}</span>;
    return (
        <button type="button" onClick={onClick} className="edge-btn" style={{
            border: 'none', background: 'transparent', padding: '2px 4px', borderRadius: 5, cursor: 'pointer',
            color: t.dim, fontFamily: MONO, fontSize: 13,
        }}>{children}</button>
    );
}
function Sep() {
    const t = useT();
    return <span aria-hidden="true" style={{ color: t.ghost }}>/</span>;
}

function Icon({ kind, folder, size = 30 }) {
    const t = useT();
    const Glyph = folder ? Folder : KIND_ICON[kind] || FileIcon;
    return (
        <span aria-hidden="true" style={{
            width: size, height: size, flexShrink: 0, borderRadius: 6, display: 'grid', placeItems: 'center',
            color: folder ? t.text : t.dim,
            background: folder ? t.raised : t.panelAlt, border: '1px solid ' + t.line,
        }}><Glyph size={Math.round(size * 0.5)} strokeWidth={1.75} /></span>
    );
}

function FolderTile({ name, note, restricted, view, onOpen, menu }) {
    const t = useT();
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 8, border: '1px solid ' + t.line, borderRadius: 9,
            padding: view === 'grid' ? 10 : '8px 10px', background: t.panel, minWidth: 0,
        }}>
            <button type="button" onClick={onOpen} className="edge-btn" style={{ ...linkBtn(t), flex: 1 }}>
                <Icon folder />
                <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                    {(note || restricted) && <span style={{ display: 'block', fontSize: 11, color: t.faint }}>{note || 'restricted'}</span>}
                </span>
            </button>
            {menu}
        </div>
    );
}

function FileTile({ file: f, sub, onOpen, menu }) {
    const t = useT();
    const [thumb, setThumb] = useState(null);
    const image = fileKind(f.mime_type, f.name) === 'image';
    useEffect(() => {
        let cancelled = false;
        if (image) signedUrl(f.storage_path).then((u) => { if (!cancelled) setThumb(u); }).catch(() => {});
        return () => { cancelled = true; };
    }, [image, f.storage_path]);
    return (
        <div style={{ border: '1px solid ' + t.line, borderRadius: 9, background: t.panel, overflow: 'hidden', display: 'grid', minWidth: 0 }}>
            <button type="button" onClick={onOpen} className="edge-btn" aria-label={`Open ${f.name}`} style={{
                height: 96, border: 'none', borderBottom: '1px solid ' + t.lineSoft, background: t.panelAlt, cursor: 'pointer',
                display: 'grid', placeItems: 'center', padding: 0,
            }}>
                {thumb ? <img src={thumb} alt="" style={{ maxWidth: '100%', maxHeight: 96, objectFit: 'cover' }} /> : <Icon kind={fileKind(f.mime_type, f.name)} size={42} />}
            </button>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '8px 8px 8px 10px' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.name}>{f.name}</span>
                    <span style={{ display: 'block', fontSize: 11, color: t.faint }}>{fmtBytes(f.size_bytes)} · v{f.version} · {fmtDate(f.updated_at)}</span>
                    {sub && <span style={{ display: 'block', fontSize: 11, color: t.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
                </span>
                {menu}
            </div>
        </div>
    );
}

/* ── dialogs ──────────────────────────────────────────────────────────────── */

function FolderDialog({ project, parentId, folder, onClose }) {
    const t = useT();
    const toast = useToast();
    const [name, setName] = useState(folder?.name || '');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const save = async () => {
        const n = name.trim();
        if (!n) { setError('Give the folder a name.'); return; }
        if (/[/\\]/.test(n)) { setError('A folder name cannot contain / or \\.'); return; }
        setSaving(true);
        try {
            if (folder) await orgStore.updateItem('project_folders', folder.id, { name: n });
            else await orgStore.addItem('project_folders', { project_id: project.id, parent_id: parentId, name: n });
            toast(folder ? 'Folder renamed' : 'Folder created', 'success');
            onClose();
        } catch (e) { setError(fileError(e)); } finally { setSaving(false); }
    };
    return (
        <Modal open onClose={onClose} width={420} title={folder ? 'Rename folder' : 'New folder'}
            footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={saving} onClick={save}>{folder ? 'Rename' : 'Create'}</Btn></>}>
            <Field required label="Name">
                <Input value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
            </Field>
            {error && <div role="alert" style={{ marginTop: 8, fontSize: 12.5, color: t.down }}>{error}</div>}
        </Modal>
    );
}

function FileDialog({ file, tags: known, onClose }) {
    const t = useT();
    const toast = useToast();
    const [name, setName] = useState(file.name);
    const [tags, setTags] = useState(file.tags.join(', '));
    const [error, setError] = useState('');
    const save = async () => {
        if (!name.trim()) { setError('Give the file a name.'); return; }
        const list = [...new Set(tags.split(',').map((x) => x.trim().toLowerCase().replace(/^#/, '')).filter(Boolean))];
        if (list.some((x) => x.length > 40)) { setError('Keep each tag under 40 characters.'); return; }
        try {
            await orgStore.updateItem('project_files', file.id, { name: name.trim(), tags: list });
            toast('Saved', 'success');
            onClose();
        } catch (e) { setError(fileError(e)); }
    };
    return (
        <Modal open onClose={onClose} width={460} title="Rename & tag"
            footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary onClick={save}>Save</Btn></>}>
            <div style={{ display: 'grid', gap: 12 }}>
                <Field required label="Name"><Input value={name} maxLength={255} onChange={(e) => setName(e.target.value)} /></Field>
                <Field label="Tags" hint={known.length ? `Separate with commas. In use: ${known.slice(0, 8).join(', ')}` : 'Separate with commas, e.g. contract, signed'}>
                    <Input value={tags} onChange={(e) => setTags(e.target.value)} />
                </Field>
                {error && <div role="alert" style={{ fontSize: 12.5, color: t.down }}>{error}</div>}
            </div>
        </Modal>
    );
}

function MoveDialog({ file, folders, onClose }) {
    const toast = useToast();
    const [to, setTo] = useState(file.folder_id || '');
    const options = folders.map((f) => ({ id: f.id, path: folderPath(folders, f.id).map((x) => x.name).join(' / ') }))
        .sort((a, b) => a.path.localeCompare(b.path));
    const save = async () => {
        try {
            await orgStore.updateItem('project_files', file.id, { folder_id: to || null });
            toast('Moved', 'success');
            onClose();
        } catch (e) { toast(fileError(e), 'error'); }
    };
    return (
        <Modal open onClose={onClose} width={440} title={`Move “${file.name}”`}
            footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary onClick={save}>Move</Btn></>}>
            <Field label="To">
                <Select value={to} onChange={(e) => setTo(e.target.value)}>
                    <option value="">Top level</option>
                    {options.map((o) => <option key={o.id} value={o.id}>{o.path}</option>)}
                </Select>
            </Field>
        </Modal>
    );
}

function AccessDialog({ target, section, onClose }) {
    const t = useT();
    const toast = useToast();
    const [limited, setLimited] = useState(!!target.visible_roles);
    const [roles, setRoles] = useState(new Set(target.visible_roles || ['member']));
    const toggle = (r) => setRoles((s) => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n; });
    const save = async () => {
        try {
            await orgStore.updateItem(section, target.id, { visible_roles: limited ? [...roles] : null });
            toast('Access updated', 'success');
            onClose();
        } catch (e) { toast(fileError(e), 'error'); }
    };
    const folder = section === 'project_folders';
    return (
        <Modal open onClose={onClose} width={460} title={`Who can see “${target.name}”`}
            note={folder ? 'Applies to everything inside it as well' : undefined}
            footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary onClick={save}>Save</Btn></>}>
            <div style={{ display: 'grid', gap: 10 }}>
                <Seg value={limited ? 'some' : 'all'} onChange={(v) => setLimited(v === 'some')} label="Visibility" options={[
                    { id: 'all', label: 'Everyone with access' }, { id: 'some', label: 'Only some roles' },
                ]} />
                {limited && (
                    <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
                        <legend style={{ fontSize: 12, color: t.faint, padding: 0, marginBottom: 4 }}>Owners and admins always see it. Also:</legend>
                        {ROLES.map((r) => (
                            <label key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', minHeight: 24 }}>
                                <input type="checkbox" checked={roles.has(r.id)} onChange={() => toggle(r.id)} />
                                {r.label}
                            </label>
                        ))}
                    </fieldset>
                )}
                <Muted>“Everyone with access” means anyone whose role may view project files, plus the project’s members.</Muted>
            </div>
        </Modal>
    );
}

function VersionsDialog({ file, nameOf, canRestore, onClose }) {
    const toast = useToast();
    const all = useSection('project_file_versions');
    const versions = all.filter((v) => v.file_id === file.id).sort((a, b) => b.version - a.version);
    const [busy, setBusy] = useState('');
    const restore = async (v) => {
        setBusy(v.id);
        try { await restoreVersion(file, v); toast(`Version ${v.version} restored as version ${file.version + 1}`, 'success'); onClose(); }
        catch (e) { toast(fileError(e), 'error'); } finally { setBusy(''); }
    };
    return (
        <Modal open onClose={onClose} width={640} title={`Versions of “${file.name}”`} note={`Current: version ${file.version}`}
            footer={<Btn primary onClick={onClose}>Done</Btn>}>
            {versions.length === 0 ? <Muted>No version history recorded.</Muted> : (
                <Table cols={[
                    { key: 'v', label: 'Version' }, { key: 'd', label: 'Uploaded' }, { key: 'u', label: 'By' },
                    { key: 's', label: 'Size', align: 'right' }, { key: 'x', label: '', align: 'right' },
                ]}>
                    {versions.map((v) => (
                        <Tr key={v.id}>
                            <Td nowrap>v{v.version}{v.version === file.version ? ' · current' : ''}{v.note && <div style={{ fontSize: 11, opacity: 0.7 }}>{v.note}</div>}</Td>
                            <Td muted nowrap>{new Date(v.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</Td>
                            <Td muted nowrap>{nameOf(v.uploaded_by)}</Td>
                            <Td align="right" muted nowrap>{fmtBytes(v.size_bytes)}</Td>
                            <Td align="right">
                                <Row gap={6} style={{ justifyContent: 'flex-end' }}>
                                    <Btn size="sm" onClick={() => openObject(v.storage_path, { download: file.name }).catch((e) => toast(fileError(e), 'error'))}>Download</Btn>
                                    {canRestore && v.version !== file.version && (
                                        <Btn size="sm" disabled={busy === v.id} onClick={() => restore(v)}>Restore</Btn>
                                    )}
                                </Row>
                            </Td>
                        </Tr>
                    ))}
                </Table>
            )}
        </Modal>
    );
}

function PreviewDialog({ file, onDownload, onClose }) {
    const t = useT();
    const [url, setUrl] = useState(null);
    const [text, setText] = useState(null);
    const [error, setError] = useState('');
    const kind = fileKind(file.mime_type, file.name);
    useEffect(() => {
        let cancelled = false;
        signedUrl(file.storage_path).then(async (u) => {
            if (cancelled) return;
            setUrl(u);
            if (kind === 'text') {
                const res = await fetch(u);
                const body = await res.text();
                if (!cancelled) setText(body.slice(0, 200000));
            }
        }).catch((e) => { if (!cancelled) setError(fileError(e, 'The file could not be opened.')); });
        return () => { cancelled = true; };
    }, [file.storage_path, kind]);
    return (
        <Modal open onClose={onClose} width={900} title={file.name} note={`${fmtBytes(file.size_bytes)} · version ${file.version}`}
            footer={<><Btn onClick={onDownload}>Download</Btn><Btn primary onClick={onClose}>Close</Btn></>}>
            {error ? <div role="alert" style={{ color: t.down, fontSize: 13 }}>{error}</div> : !url ? <Muted>Loading…</Muted> : (
                kind === 'pdf' ? <iframe title={file.name} src={url} style={{ width: '100%', height: '70vh', border: '1px solid ' + t.line, borderRadius: 8 }} />
                    : kind === 'image' ? <img src={url} alt={file.name} style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block', margin: '0 auto' }} />
                        : <pre style={{ margin: 0, maxHeight: '70vh', overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 12.5, fontFamily: MONO, color: t.text }}>{text ?? 'Loading…'}</pre>
            )}
        </Modal>
    );
}
