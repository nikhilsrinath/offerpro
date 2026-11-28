import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Panel, Btn, Select, Table, Tr, Td, Empty, Search, StatBand, TableBar } from '../ui/edge';
import { useT, fmtDate } from '../ui/edgeUtils';
import { useSection } from '../financial/financeHooks';
import { useToast } from '../shared/Toast';
import { openObject, fileError } from '../../services/projectFiles';
import { fileKind, fmtBytes, folderPath } from '../../services/projectWorkspace';
import { projectSectionPath } from '../projects/projectPaths';

/* ══════════════════════════════════════════════════════════════════════════
   Document Library › Project Documents: every file kept on any project, in
   one list, read-only. A file is uploaded, versioned and organised on its
   own project (Project › Documents › Project Documents); here it can be
   found across projects and opened. Who sees which file is the projects'
   own rule (RLS on project_files): the list is what the reader may open.
   ══════════════════════════════════════════════════════════════════════════ */

// Where a file attached to a record (not put in a folder) sits.
const LINK_LABEL = {
    communication: 'Client communication', approval: 'Approval', invoice: 'Invoice / payment', payment: 'Payment',
    vendor: 'Vendor document', client: 'Client document', generated: 'Generated from a template',
};
const KIND_LABEL = { pdf: 'PDF', image: 'Image', doc: 'Document', sheet: 'Spreadsheet', slides: 'Slides', text: 'Text', archive: 'Archive', other: 'File' };
const PAGE_SIZE = 50;

export default function ProjectDocumentsView() {
    const t = useT();
    const toast = useToast();
    const files = useSection('project_files');
    const folders = useSection('project_folders');
    const projects = useSection('projects');
    const [query, setQuery] = useState('');
    const [projectId, setProjectId] = useState('');
    const [kind, setKind] = useState('');
    const [page, setPage] = useState(1);

    const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
    const withProject = useMemo(() => files.filter((f) => projectById.has(f.project_id)), [files, projectById]);
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return withProject
            .filter((f) => !projectId || f.project_id === projectId)
            .filter((f) => !kind || fileKind(f.mime_type, f.name) === kind)
            .filter((f) => !q || f.name.toLowerCase().includes(q) || (f.tags || []).some((x) => x.includes(q))
                || (projectById.get(f.project_id)?.name || '').toLowerCase().includes(q))
            .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
    }, [withProject, projectId, kind, query, projectById]);
    const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    const pg = Math.min(page, pageCount);
    const rows = shown.slice((pg - 1) * PAGE_SIZE, pg * PAGE_SIZE);

    // Only the projects that hold a file, by name.
    const withFiles = useMemo(() => {
        const ids = new Set(withProject.map((f) => f.project_id));
        return projects.filter((p) => ids.has(p.id)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }, [withProject, projects]);
    const kinds = useMemo(() => [...new Set(withProject.map((f) => fileKind(f.mime_type, f.name)))].sort(), [withProject]);

    const whereOf = (f) => (f.link_type ? LINK_LABEL[f.link_type] || 'Attached'
        : folderPath(folders, f.folder_id).map((x) => x.name).join(' / ') || 'Top');
    const open = async (f) => {
        try { await openObject(f.storage_path); } catch (e) { toast(fileError(e), 'error'); }
    };
    const reset = (fn) => (v) => { fn(v); setPage(1); };

    const filters = (
        <>

            <Search value={query} onChange={reset(setQuery)} placeholder="Search file, tag or project…" width={260} />
            <Select aria-label="Project" value={projectId} onChange={(e) => reset(setProjectId)(e.target.value)} style={{ width: 200 }}>
                <option value="">Every project</option>
                {withFiles.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</option>)}
            </Select>
            {kinds.length > 1 && (
                <Select aria-label="File type" value={kind} onChange={(e) => reset(setKind)(e.target.value)} style={{ width: 150 }}>
                    <option value="">Every type</option>
                    {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k] || k}</option>)}
                </Select>
            )}
        </>
    );
    const totalBytes = withProject.reduce((s, f) => s + (f.size_bytes || 0), 0);

    return (
        <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
            <StatBand items={[
                { label: 'Documents', value: withProject.length, note: 'Across every project you can see' },
                { label: 'Projects', value: withFiles.length, note: 'With at least one document' },
                { label: 'Storage', value: fmtBytes(totalBytes) },
            ]} />
            {rows.length === 0 ? (
                <div>
                    <TableBar lead={filters} />
                    <Panel>
                        <Empty>
                            {withProject.length
                                ? 'No project document matches that.'
                                : 'No project documents yet. Files uploaded on a project (Project › Documents) are listed here.'}
                        </Empty>
                    </Panel>
                </div>
            ) : (
                <Table id="library-project-documents" lead={filters} cols={[
                    { key: 'n', label: 'Document', always: true }, { key: 'p', label: 'Project' },
                    { key: 'w', label: 'Folder' }, { key: 'k', label: 'Type' },
                    { key: 's', label: 'Size', align: 'right' }, { key: 'v', label: 'Version', align: 'right', def: false },
                    { key: 'u', label: 'Last Modified' }, { key: 'x', label: '', align: 'right', always: true },
                ]}>
                    {(show) => rows.map((f) => {
                        const p = projectById.get(f.project_id);
                        return (
                            <Tr key={f.id} onClick={() => open(f)} label={`Open ${f.name}`}>
                                {show('n') && <Td><span title={f.name} style={{ display: 'block', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span></Td>}
                                {show('p') && (
                                    <Td nowrap>
                                        <Link to={projectSectionPath(f.project_id, 'documents')} onClick={(e) => e.stopPropagation()}
                                            style={{ color: t.text, textDecoration: 'underline', textUnderlineOffset: 3 }}>
                                            {p?.name || 'Project'}
                                        </Link>
                                    </Td>
                                )}
                                {show('w') && <Td muted>{whereOf(f)}</Td>}
                                {show('k') && <Td muted nowrap>{KIND_LABEL[fileKind(f.mime_type, f.name)] || 'File'}</Td>}
                                {show('s') && <Td muted nowrap align="right">{fmtBytes(f.size_bytes)}</Td>}
                                {show('v') && <Td muted nowrap align="right">v{f.version || 1}</Td>}
                                {show('u') && <Td muted nowrap>{fmtDate(f.updated_at || f.created_at)}</Td>}
                                {show('x') && <Td align="right"><Btn size="sm" onClick={(e) => { e.stopPropagation(); open(f); }}>Open</Btn></Td>}
                            </Tr>
                        );
                    })}
                </Table>
            )}
            {pageCount > 1 && (
                <nav aria-label="Project document pages" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontSize: 12.5, color: t.faint }}>Showing {(pg - 1) * PAGE_SIZE + 1}–{Math.min(pg * PAGE_SIZE, shown.length)} of {shown.length}</span>
                    <span style={{ display: 'inline-flex', gap: 8 }}>
                        <Btn size="sm" disabled={pg === 1} onClick={() => setPage(pg - 1)}>Previous</Btn>
                        <Btn size="sm" disabled={pg === pageCount} onClick={() => setPage(pg + 1)}>Next</Btn>
                    </span>
                </nav>
            )}
        </div>
    );
}
