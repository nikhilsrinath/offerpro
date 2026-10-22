import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, Plus, Search } from 'lucide-react';
import { orgStore } from '../../services/orgStore';
import { useSection } from '../financial/financeHooks';
import { useToast } from './Toast';

const GSTIN_RE = /^[0-9A-Z]{15}$/;
const NEW = { company_name: '', phone: '', gstin: '' };

const matches = (v, q) => [v.company_name, v.contact_name, v.gstin, v.category]
    .some((f) => String(f || '').toLowerCase().includes(q));

/**
 * The vendor dropdown of a form, with Add Vendor at its foot: a vendor that
 * is not in the directory yet is added right here and chosen, without leaving
 * the form. It writes the same vendor row the Vendor Directory does.
 *
 * With `projectId` the list is the project's vendors only (project_vendors),
 * and Add Vendor first offers every other vendor in the directory: picking one
 * puts it on the project and chooses it. A vendor new to the directory is put
 * on the project too. The vendor already chosen stays listed either way.
 *
 * `noneLabel` adds a first option that clears the choice ("Not a vendor").
 */
export default function VendorSelect({ id, vendors, value, onChange, projectId = null, placeholder = 'Select a vendor…', noneLabel = null, disabled = false }) {
    const toast = useToast();
    const links = useSection('project_vendors');
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    // 'browse' is the directory's other vendors, for a project.
    const [browsing, setBrowsing] = useState(false);
    const [adding, setAdding] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const boxRef = useRef(null);
    const btnRef = useRef(null);

    const close = () => { setOpen(false); setBrowsing(false); setAdding(null); setError(''); setQuery(''); };

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

    const add = async () => {
        const name = adding.company_name.trim();
        const gstin = adding.gstin.trim().toUpperCase();
        if (!name) { setError('Enter the company name.'); return; }
        if (gstin && !GSTIN_RE.test(gstin)) { setError('GSTIN must be 15 letters and digits.'); return; }
        setSaving(true);
        setError('');
        try {
            const vendor = await orgStore.addItem('vendors', { company_name: name, phone: adding.phone.trim(), gstin });
            if (projectId && vendor?.id && !(await link(vendor.id))) {
                toast("Vendor added, but not to this project. Add it from the project's Vendor Directory.", 'error');
            }
            toast(`${name} added to vendors`, 'success');
            pick(vendor);
        } catch (err) {
            setError(err.message || 'Could not add the vendor.');
        } finally {
            setSaving(false);
        }
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
                    {adding ? (
                        <div className="vsel-add">
                            <strong>New Vendor</strong>
                            {error && <div className="prod-form-error" role="alert">{error}</div>}
                            <input aria-label="Company name" placeholder="Company name" autoFocus value={adding.company_name}
                                onChange={(e) => setAdding({ ...adding, company_name: e.target.value })}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
                            <div className="vsel-add-row">
                                <input aria-label="Phone" placeholder="Phone (optional)" value={adding.phone}
                                    onChange={(e) => setAdding({ ...adding, phone: e.target.value })}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
                                <input aria-label="GSTIN" placeholder="GSTIN (optional)" value={adding.gstin} maxLength={15}
                                    onChange={(e) => setAdding({ ...adding, gstin: e.target.value })}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
                            </div>
                            <div className="vsel-add-foot">
                                <button type="button" className="prod-btn-ghost" onClick={() => { setAdding(null); setError(''); }}>Back</button>
                                <button type="button" className="prod-btn-primary" disabled={saving} onClick={add}>
                                    {saving ? 'Adding...' : 'Add Vendor'}
                                </button>
                            </div>
                            <span className="vsel-note">
                                {projectId ? 'Added to the directory and to this project. ' : ''}
                                The rest of the vendor's details can be filled in later in the Vendor Directory.
                            </span>
                        </div>
                    ) : (
                        <>
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
                                    onClick={() => { setAdding({ ...NEW, company_name: query.trim() }); setError(''); }}>
                                    <Plus size={14} aria-hidden="true" /> {projectId ? 'New Vendor' : 'Add Vendor'}
                                </button>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
