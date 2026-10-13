import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Search } from 'lucide-react';
import { orgStore } from '../../services/orgStore';
import { useToast } from './Toast';

const GSTIN_RE = /^[0-9A-Z]{15}$/;
const NEW = { company_name: '', phone: '', gstin: '' };

/**
 * The vendor dropdown of a form, with Add Vendor at its foot: a vendor that
 * is not in the directory yet is added right here and chosen, without leaving
 * the form. It writes the same vendor row the Vendor Directory does; with
 * `projectId` the new vendor is put on that project too.
 */
export default function VendorSelect({ id, vendors, value, onChange, projectId = null, placeholder = 'Select a vendor…' }) {
    const toast = useToast();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [adding, setAdding] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const boxRef = useRef(null);
    const btnRef = useRef(null);

    const close = () => { setOpen(false); setAdding(null); setError(''); setQuery(''); };

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

    const chosen = vendors.find((v) => v.id === value) || null;
    const q = query.trim().toLowerCase();
    const shown = q
        ? vendors.filter((v) => [v.company_name, v.contact_name, v.gstin, v.category].some((f) => String(f || '').toLowerCase().includes(q)))
        : vendors;

    const pick = (v) => { onChange(v.id); close(); btnRef.current?.focus(); };

    const add = async () => {
        const name = adding.company_name.trim();
        const gstin = adding.gstin.trim().toUpperCase();
        if (!name) { setError('Enter the company name.'); return; }
        if (gstin && !GSTIN_RE.test(gstin)) { setError('GSTIN must be 15 letters and digits.'); return; }
        setSaving(true);
        setError('');
        try {
            const vendor = await orgStore.addItem('vendors', { company_name: name, phone: adding.phone.trim(), gstin });
            if (projectId && vendor?.id) {
                try { await orgStore.addItem('project_vendors', { project_id: projectId, vendor_id: vendor.id }); }
                catch { toast("Vendor added, but not to this project. Add it from the project's Vendor Directory.", 'error'); }
            }
            toast(`${name} added to vendors`, 'success');
            pick(vendor);
        } catch (err) {
            setError(err.message || 'Could not add the vendor.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div ref={boxRef} className="vsel" onKeyDown={onKeyDown}>
            <button ref={btnRef} id={id} type="button" className="vsel-btn" aria-haspopup="listbox" aria-expanded={open}
                onClick={() => (open ? close() : setOpen(true))}>
                <span className={chosen ? '' : 'vsel-placeholder'}>{chosen ? chosen.company_name : placeholder}</span>
                <ChevronDown size={15} aria-hidden="true" />
            </button>

            {open && (
                <div className="prodpick-panel vsel-panel">
                    {adding ? (
                        <div className="vsel-add">
                            <strong>Add Vendor</strong>
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
                            <span className="vsel-note">The rest of the vendor's details can be filled in later in the Vendor Directory.</span>
                        </div>
                    ) : (
                        <>
                            <div className="prodpick-search">
                                <Search size={13} aria-hidden="true" />
                                <input autoFocus aria-label="Search vendors" value={query} onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search vendors..." className="prodpick-search-inp" />
                            </div>
                            {shown.length === 0 ? (
                                <div className="prodpick-empty">{vendors.length === 0 ? 'No vendors yet.' : 'No vendor matches that search.'}</div>
                            ) : (
                                <div className="prodpick-list" role="listbox" aria-label="Vendors">
                                    {shown.map((v) => (
                                        <button key={v.id} type="button" role="option" aria-selected={v.id === value}
                                            className="prodpick-item vsel-item" onClick={() => pick(v)}>
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
                            <button type="button" className="vsel-add-btn"
                                onClick={() => { setAdding({ ...NEW, company_name: query.trim() }); setError(''); }}>
                                <Plus size={14} aria-hidden="true" /> Add Vendor
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
