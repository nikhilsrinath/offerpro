import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, Plus, Search } from 'lucide-react';
import { orgStore } from '../../services/orgStore';
import { updateProject, canEditProjects } from '../../services/projectService';
import { useSection } from '../financial/financeHooks';
import { useToast } from './Toast';
import ClientFormDialog from './ClientFormDialog';

/**
 * Add Client at the foot of a type-ahead client list (the invoice, quotation
 * and proforma forms' Client name). The form opens ClientFormDialog itself,
 * outside its dropdown, so the panel outlives the list closing.
 */
export function AddClientItem({ onClick }) {
    return (
        <div role="button" tabIndex={0} className="customer-dropdown-item customer-dropdown-add"
            onMouseDown={(e) => e.preventDefault()} onClick={onClick}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, fontSize: '0.8125rem', fontWeight: 500, borderTop: '1px solid var(--border-default)', position: 'sticky', bottom: 0, background: 'var(--bg-elevated)' }}>
            <Plus size={14} aria-hidden="true" /> Add Client
        </div>
    );
}

const nameOf = (c) => c.name || c.clientName || c.person_name || 'Client';
const matches = (c, q) => [nameOf(c), c.person_name, c.email || c.clientEmail, c.gstin || c.buyerGSTIN, c.industry]
    .some((f) => String(f || '').toLowerCase().includes(q));

/**
 * The client dropdown of a form, with Add Client at its foot: the client
 * twin of VendorSelect. A client who is not in the directory yet is added
 * right here and chosen, without leaving the form, through the same Add
 * Client panel the Client Directory opens.
 *
 * With `projectId` the list is the project's clients only (its main client
 * and project_clients), and Add Client first offers every other client in the
 * directory: picking one puts them on the project and chooses them. A client
 * new to the directory is put on the project too. The client already chosen
 * stays listed either way.
 *
 * Without a project it lists `clients` when given, else the whole directory.
 * `noneLabel` adds a first option that clears the choice ("Not recorded").
 */
export default function ClientSelect({ id, clients = null, value, onChange, projectId = null, placeholder = 'Select a client…', noneLabel = null, disabled = false }) {
    const toast = useToast();
    const all = useSection('customers');
    const links = useSection('project_clients');
    const projects = useSection('projects');
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [browsing, setBrowsing] = useState(false);
    const [creating, setCreating] = useState(null);
    const [saving, setSaving] = useState(false);
    const boxRef = useRef(null);
    const btnRef = useRef(null);

    const close = () => { setOpen(false); setBrowsing(false); setQuery(''); };

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) close(); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const onKeyDown = (e) => {
        if (e.key !== 'Escape' || !open) return;
        e.stopPropagation();
        close();
        btnRef.current?.focus();
    };

    const project = projectId ? projects.find((p) => p.id === projectId) || { id: projectId } : null;
    const live = all.filter((c) => !c.archived_at || c.id === value);
    const onProject = project
        ? new Set([...links.filter((l) => l.project_id === projectId).map((l) => l.client_id), project.client_id].filter(Boolean))
        : null;
    const own = onProject ? live.filter((c) => onProject.has(c.id) || c.id === value) : (clients || live);
    const others = onProject ? live.filter((c) => !onProject.has(c.id)) : [];

    const chosen = all.find((c) => c.id === value) || (clients || []).find((c) => c.id === value) || null;
    const q = query.trim().toLowerCase();
    const list = browsing ? others : own;
    const shown = q ? list.filter((c) => matches(c, q)) : list;

    const pick = (c) => { onChange(c.id, c); close(); btnRef.current?.focus(); };

    // A directory client put on the project, and chosen. A project with no
    // main client takes them as its client, as the Add Client panel does.
    const attach = async (c) => {
        setSaving(true);
        try {
            if (!project.client_id && canEditProjects()) await updateProject(project.id, { client_id: c.id });
            else await orgStore.addItem('project_clients', { project_id: project.id, client_id: c.id });
            toast(`${nameOf(c)} added to this project`, 'success');
        } catch {
            toast(`${nameOf(c)} chosen, but not added to this project. Add them from the project's Client Directory.`, 'error');
        }
        setSaving(false);
        pick(c);
    };

    const emptyText = q ? 'No client matches that search.'
        : browsing ? 'Every client in the directory is already on this project.'
            : projectId ? 'No clients on this project yet.' : 'No clients yet.';

    return (
        <div ref={boxRef} className="vsel" onKeyDown={onKeyDown}>
            <button ref={btnRef} id={id} type="button" className="vsel-btn" aria-haspopup="listbox" aria-expanded={open} disabled={disabled}
                onClick={() => (open ? close() : setOpen(true))}>
                <span className={chosen ? '' : 'vsel-placeholder'}>{chosen ? nameOf(chosen) : noneLabel || placeholder}</span>
                <ChevronDown size={15} aria-hidden="true" />
            </button>

            {open && (
                <div className="prodpick-panel vsel-panel">
                    <div className="prodpick-search">
                        <Search size={13} aria-hidden="true" />
                        <input key={browsing ? 'all' : 'own'} autoFocus aria-label={browsing ? 'Search all clients' : 'Search clients'}
                            value={query} onChange={(e) => setQuery(e.target.value)}
                            placeholder={browsing ? 'Search all clients...' : 'Search clients...'} className="prodpick-search-inp" />
                    </div>
                    {browsing && <div className="vsel-note vsel-head">Pick a client to add them to this project.</div>}
                    {noneLabel && !browsing && !q && (
                        <button type="button" role="option" aria-selected={!value} className="prodpick-item vsel-item"
                            onClick={() => { onChange('', null); close(); btnRef.current?.focus(); }}>
                            <span className="prodpick-item-main"><span className="prodpick-item-name">{noneLabel}</span></span>
                            {!value && <Check size={13} className="prodpick-item-check" aria-hidden="true" />}
                        </button>
                    )}
                    {shown.length === 0 ? (
                        <div className="prodpick-empty">{emptyText}</div>
                    ) : (
                        <div className="prodpick-list" role="listbox" aria-label={browsing ? 'All clients' : 'Clients'}>
                            {shown.map((c) => {
                                const meta = [c.person_name && c.person_name !== nameOf(c) ? c.person_name : null, c.gstin || c.buyerGSTIN].filter(Boolean).join(' · ');
                                return (
                                    <button key={c.id} type="button" role="option" aria-selected={c.id === value} disabled={saving}
                                        className="prodpick-item vsel-item" onClick={() => (browsing ? attach(c) : pick(c))}>
                                        <span className="prodpick-item-main">
                                            <span className="prodpick-item-name">{nameOf(c)}</span>
                                            {meta && <span className="prodpick-item-meta">{meta}</span>}
                                        </span>
                                        {c.id === value && <Check size={13} className="prodpick-item-check" aria-hidden="true" />}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    {browsing && (
                        <button type="button" className="vsel-add-btn" onClick={() => { setBrowsing(false); setQuery(''); }}>
                            <ChevronLeft size={14} aria-hidden="true" /> Project Clients
                        </button>
                    )}
                    {projectId && !browsing ? (
                        <button type="button" className="vsel-add-btn" onClick={() => { setBrowsing(true); setQuery(''); }}>
                            <Plus size={14} aria-hidden="true" /> Add Client
                        </button>
                    ) : (
                        <button type="button" className="vsel-add-btn"
                            onClick={() => { const name = query.trim(); close(); setCreating(name); }}>
                            <Plus size={14} aria-hidden="true" /> {projectId ? 'New Client' : 'Add Client'}
                        </button>
                    )}
                </div>
            )}
            {creating !== null && (
                <ClientFormDialog initialName={creating} project={project}
                    onClose={() => { setCreating(null); btnRef.current?.focus(); }}
                    onSaved={(c) => c?.id && onChange(c.id, c)} />
            )}
        </div>
    );
}
