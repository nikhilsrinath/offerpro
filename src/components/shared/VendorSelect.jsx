import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, Plus, Search } from 'lucide-react';
import { orgStore } from '../../services/orgStore';
import { useSection } from '../financial/financeHooks';
import { useToast } from './Toast';
import VendorFormDialog from './VendorFormDialog';

const matches = (v, q) => [v.company_name, v.contact_name, v.gstin, v.category]
    .some((f) => String(f || '').toLowerCase().includes(q));

/**
 * The vendor dropdown of a form, with Add Vendor at its foot: a vendor that
 * is not in the directory yet is added right here and chosen, without leaving
 * the form. It opens the same New Vendor panel the Vendor Directory does.
 *
 * With `projectId` the list is the project's vendors only (project_vendors),
 * and Add Vendor first offers every other vendor in the directory: picking one
 * puts it on the project and chooses it. A vendor new to the directory is put
 * on the project too. The vendor already chosen stays listed either way.
 *
 * `noneLabel` adds a first option that clears the choice ("Not a vendor").
 * `aside(vendor)` puts a figure at the right of each vendor (what is pending).
 */
export default function VendorSelect({ id, vendors, value, onChange, projectId = null, placeholder = 'Select a vendor…', noneLabel = null, disabled = false, aside = null }) {
    const toast = useToast();
    const links = useSection('project_vendors');
    const projects = useSection('projects');
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    // 'browse' is the directory's other vendors, for a project.
    const [browsing, setBrowsing] = useState(false);
    // The New Vendor panel, with what was typed in the search as its name.
    // Kept apart from `open`: the panel sits outside the dropdown.
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

    // Esc closes the dropdown only, not the form it sits in.
    const onKeyDown = (e) => {
        if (e.key !== 'Escape' || !open) return;
        e.stopPropagation();
        close();
        btnRef.current?.focus();
    };

    const onProject = projectId
        ? new Set(links.filter((l) => l.project_id === projectId).map((l) => l.vendor_id))
        : null;
    const own = onProject ? vendors.filter((v) => onProject.has(v.id) || v.id === value) : vendors;
    const others = onProject ? vendors.filter((v) => !onProject.has(v.id)) : [];

    const chosen = vendors.find((v) => v.id === value) || null;
    const q = query.trim().toLowerCase();
    const list = browsing ? others : own;
    const shown = q ? list.filter((v) => matches(v, q)) : list;

    const pick = (v) => { onChange(v.id); close(); btnRef.current?.focus(); };

    const link = async (vendorId) => {
        try { await orgStore.addItem('project_vendors', { project_id: projectId, vendor_id: vendorId }); return true; }
        catch { return false; }
    };

    // A directory vendor put on the project, and chosen.
    const attach = async (v) => {
        setSaving(true);
        const ok = await link(v.id);
        setSaving(false);
        if (ok) toast(`${v.company_name} added to this project`, 'success');
        else toast(`${v.company_name} chosen, but not added to this project. Add it from the project's Vendor Directory.`, 'error');
        pick(v);
    };

    const emptyText = q ? 'No vendor matches that search.'
        : browsing ? 'Every vendor in the directory is already on this project.'
            : projectId ? 'No vendors on this project yet.' : 'No vendors yet.';

    return (
        <div ref={boxRef} className="vsel" onKeyDown={onKeyDown}>
            <button ref={btnRef} id={id} type="button" className="vsel-btn" aria-haspopup="listbox" aria-expanded={open} disabled={disabled}
                onClick={() => (open ? close() : setOpen(true))}>
                <span className={chosen ? '' : 'vsel-placeholder'}>{chosen ? chosen.company_name : noneLabel || placeholder}</span>
                <ChevronDown size={15} aria-hidden="true" />
            </button>

            {open && (
                <div className="prodpick-panel vsel-panel">
                        <div className="prodpick-search">
                            <Search size={13} aria-hidden="true" />
                            <input key={browsing ? 'all' : 'own'} autoFocus aria-label={browsing ? 'Search all vendors' : 'Search vendors'}
                                value={query} onChange={(e) => setQuery(e.target.value)}
                                placeholder={browsing ? 'Search all vendors...' : 'Search vendors...'} className="prodpick-search-inp" />
                        </div>
                        {browsing && <div className="vsel-note vsel-head">Pick a vendor to add it to this project.</div>}
                        {noneLabel && !browsing && !q && (
                            <button type="button" role="option" aria-selected={!value} className="prodpick-item vsel-item"
                                onClick={() => { onChange(''); close(); btnRef.current?.focus(); }}>
                                <span className="prodpick-item-main"><span className="prodpick-item-name">{noneLabel}</span></span>
                                {!value && <Check size={13} className="prodpick-item-check" aria-hidden="true" />}
                            </button>
                        )}
                        {shown.length === 0 ? (
                            <div className="prodpick-empty">{emptyText}</div>
                        ) : (
                            <div className="prodpick-list" role="listbox" aria-label={browsing ? 'All vendors' : 'Vendors'}>
                                {shown.map((v) => (
                                    <button key={v.id} type="button" role="option" aria-selected={v.id === value} disabled={saving}
                                        className="prodpick-item vsel-item" onClick={() => (browsing ? attach(v) : pick(v))}>
                                        <span className="prodpick-item-main">
                                            <span className="prodpick-item-name">{v.company_name}</span>
                                            {(v.category || v.gstin) && (
                                                <span className="prodpick-item-meta">{[v.category, v.gstin].filter(Boolean).join(' · ')}</span>
                                            )}
                                        </span>
                                        {aside && <span className="prodpick-item-price">{aside(v)}</span>}
                                        {v.id === value && <Check size={13} className="prodpick-item-check" aria-hidden="true" />}
                                    </button>
                                ))}
                            </div>
                        )}
                        {browsing && (
                            <button type="button" className="vsel-add-btn" onClick={() => { setBrowsing(false); setQuery(''); }}>
                                <ChevronLeft size={14} aria-hidden="true" /> Project Vendors
                            </button>
                        )}
                        {projectId && !browsing ? (
                            <button type="button" className="vsel-add-btn" onClick={() => { setBrowsing(true); setQuery(''); }}>
                                <Plus size={14} aria-hidden="true" /> Add Vendor
                            </button>
                        ) : (
                            <button type="button" className="vsel-add-btn"
                                onClick={() => { const name = query.trim(); close(); setCreating(name); }}>
                                <Plus size={14} aria-hidden="true" /> {projectId ? 'New Vendor' : 'Add Vendor'}
                            </button>
                        )}
                </div>
            )}
            {creating !== null && (
                <VendorFormDialog initialName={creating} project={projectId ? projects.find((p) => p.id === projectId) || { id: projectId } : null}
                    onClose={() => { setCreating(null); btnRef.current?.focus(); }}
                    onSaved={(v) => v?.id && onChange(v.id)} />
            )}
        </div>
    );
}
