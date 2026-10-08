import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Building2, CornerDownLeft, FileText, FolderKanban, ListChecks, Package, Receipt, Search, Target, Truck, UserRound,
} from 'lucide-react';
import { useSection } from '../financial/financeHooks';
import { docNumber } from '../../services/documentStore';

/* ══════════════════════════════════════════════════════════════════════════
   Search the whole workspace from the top bar: projects, clients, leads,
   employees, documents, vendors, products, bills and tasks. Plain matching
   over what is already loaded, instantly and offline, no AI.

   Every word typed has to appear somewhere in the record; a name that starts
   with the query ranks first. A result opens the page the record lives on,
   with that page's own search filled in (?q=), or the record itself where
   the app has a page for one.
   ══════════════════════════════════════════════════════════════════════════ */

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent || '');
const PER_GROUP = 4;
const LIMIT = 24;

const DOC_LABEL = {
    invoice: 'Invoice', quotation: 'Quotation', proforma: 'Proforma', offer: 'Offer letter', certificate: 'Certificate',
    nda: 'NDA', mou: 'MoU', agreement: 'Agreement', role_change: 'Role change', termination: 'Termination notice',
};
const DOC_PAGE = { invoice: '/billing/invoices', quotation: '/billing/quotations', proforma: '/billing/proforma' };

const withQ = (path, q) => `${path}?q=${encodeURIComponent(q || '')}`;
const low = (v) => String(v ?? '').toLowerCase();

/** Every searchable record, flattened to { kind, title, sub, hay, to }. */
function useIndex() {
    const projects = useSection('projects');
    const customers = useSection('customers');
    const leads = useSection('crm_leads');
    const employees = useSection('employees');
    const finDocs = useSection('fin_docs');
    const records = useSection('records');
    const vendors = useSection('vendors');
    const products = useSection('products');
    const bills = useSection('purchase_invoices');
    const tasks = useSection('tasks');

    return useMemo(() => {
        const clientName = Object.fromEntries(customers.map((c) => [c.id, c.name || c.clientName || '']));
        const vendorName = Object.fromEntries(vendors.map((v) => [v.id, v.company_name || '']));
        const projectName = Object.fromEntries(projects.map((p) => [p.id, p.name || p.code || '']));
        const out = [];
        const add = (kind, title, sub, fields, to) => {
            if (!title) return;
            out.push({ kind, title: String(title), sub, hay: low([title, ...fields].filter(Boolean).join(' ')), to });
        };

        projects.forEach((p) => add('Projects', p.name || p.code,
            [p.code, p.client_id ? clientName[p.client_id] || 'Client' : 'Internal'].filter(Boolean).join(' · '),
            [p.code, clientName[p.client_id], ...(p.tags || [])], `/projects/${p.id}`));
        customers.forEach((c) => add('Clients', c.name || c.clientName,
            [c.contact_name || c.contactPerson, c.email].filter(Boolean).join(' · '),
            [c.email, c.phone, c.gstin, c.contact_name, c.contactPerson, c.city], withQ('/client-directory', c.name || c.clientName)));
        leads.forEach((l) => add('Leads', l.company_name || l.person_name,
            [l.person_name, l.stage].filter(Boolean).join(' · '),
            [l.person_name, l.email, l.phone, l.notes], withQ('/crm', l.company_name || l.person_name)));
        employees.forEach((e) => add('Employees', e.name || e.full_name,
            [e.role, e.department, e.employee_code].filter(Boolean).join(' · '),
            [e.email, e.role, e.department, e.employee_code, e.phone], withQ('/employees', e.name || e.full_name)));
        finDocs.forEach((d) => {
            const no = docNumber(d);
            const who = d.clientName || d.issued_to || d.client_name || '';
            add('Documents', `${DOC_LABEL[d.type] || 'Document'} ${no}`, [who, d.status].filter(Boolean).join(' · '),
                [no, who, d.type, d.status, projectName[d.project_id]], withQ(DOC_PAGE[d.type] || '/billing/invoices', no));
        });
        records.forEach((r) => {
            const no = r.doc_number || '';
            add('Documents', r.title || `${DOC_LABEL[r.type] || 'Document'} ${no}`,
                [DOC_LABEL[r.type], no, r.issued_to].filter(Boolean).join(' · '),
                [no, r.issued_to, r.recipient_email, DOC_LABEL[r.type], r.status], withQ('/records', r.issued_to || no));
        });
        vendors.forEach((v) => add('Vendors', v.company_name,
            [v.contact_name, v.category].filter(Boolean).join(' · '),
            [v.contact_name, v.email, v.gstin, v.category, v.phone], withQ('/vendor-directory', v.company_name)));
        products.forEach((p) => add('Products', p.name,
            [p.sku, p.category].filter(Boolean).join(' · '),
            [p.sku, p.category, p.hsn_sac], withQ('/products-directory', p.name)));
        bills.forEach((b) => add('Purchase bills', `Bill ${b.bill_number || ''}`.trim(),
            [vendorName[b.vendor_id], b.status].filter(Boolean).join(' · '),
            [b.bill_number, vendorName[b.vendor_id], b.description, b.category], withQ('/purchase-bills', b.bill_number)));
        tasks.forEach((x) => add('Tasks', x.title,
            [projectName[x.projectId], x.status === 'in-progress' ? 'in progress' : x.status].filter(Boolean).join(' · '),
            [projectName[x.projectId], x.description], `/tasks?task=${x.id}`));
        return out;
    }, [projects, customers, leads, employees, finDocs, records, vendors, products, bills, tasks]);
}

const ICON = {
    Projects: FolderKanban, Clients: Building2, Leads: Target, Employees: UserRound, Documents: FileText,
    Vendors: Truck, Products: Package, 'Purchase bills': Receipt, Tasks: ListChecks,
};
const ORDER = Object.keys(ICON);

function search(index, query) {
    const words = low(query).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const q = words.join(' ');
    const hits = [];
    index.forEach((r) => {
        if (!words.every((w) => r.hay.includes(w))) return;
        const title = low(r.title);
        const score = title === q ? 0 : title.startsWith(q) ? 1 : title.includes(q) ? 2 : 3;
        hits.push({ ...r, score });
    });
    hits.sort((a, b) => a.score - b.score || a.title.length - b.title.length);
    // A few per kind, kinds in a fixed order, so a flood of tasks cannot hide the one client.
    const groups = ORDER.map((kind) => ({ kind, items: hits.filter((h) => h.kind === kind) }))
        .filter((g) => g.items.length);
    let budget = LIMIT;
    return groups.map((g) => {
        const items = g.items.slice(0, Math.min(PER_GROUP, budget));
        budget -= items.length;
        return { ...g, total: g.items.length, items };
    }).filter((g) => g.items.length);
}

export default function GlobalSearch({ t, width = 360 }) {
    const navigate = useNavigate();
    const index = useIndex();
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const inputRef = useRef(null);
    const boxRef = useRef(null);
    const listId = useId();

    const groups = useMemo(() => search(index, q), [index, q]);
    const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
    const sel = Math.min(active, Math.max(0, flat.length - 1));

    // Ctrl/⌘ K puts the cursor in the search.
    useEffect(() => {
        const onKey = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                inputRef.current?.focus();
                inputRef.current?.select();
                setOpen(true);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const go = (r) => {
        if (!r) return;
        setOpen(false);
        setQ('');
        inputRef.current?.blur();
        navigate(r.to);
    };

    const onKeyDown = (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(flat.length - 1, Math.min(i, flat.length - 1) + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, Math.min(i, flat.length - 1) - 1)); }
        else if (e.key === 'Enter') { e.preventDefault(); go(flat[sel]); }
        else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
    };

    // Keep the highlighted row in view while arrowing through a long list.
    useEffect(() => {
        document.getElementById(`${listId}-${sel}`)?.scrollIntoView({ block: 'nearest' });
    }, [sel, listId]);

    const showList = open && q.trim().length > 0;
    let n = -1;

    return (
        <div ref={boxRef} style={{ position: 'relative', width, maxWidth: '40vw' }}>
            <div role="search" className="nm-ask" style={{
                display: 'flex', alignItems: 'center', gap: 9, height: 40, padding: '0 6px 0 12px',
                borderRadius: 11, border: '1px solid ' + (open ? t.accent : t.line), background: t.card,
                boxShadow: open ? `0 0 0 3px ${t.accentSoft}` : t.highlight, color: t.faint,
                transition: 'border-color .15s, box-shadow .15s',
            }}>
                <Search size={16} strokeWidth={1.8} aria-hidden="true" style={{ flexShrink: 0 }} />
                <input
                    ref={inputRef} value={q}
                    onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
                    onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
                    role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
                    aria-activedescendant={showList && flat.length ? `${listId}-${sel}` : undefined}
                    aria-label="Search projects, clients, leads, employees and documents"
                    placeholder="Search projects, clients, people, documents…"
                    style={{
                        flex: 1, minWidth: 0, height: '100%', border: 0, outline: 'none',
                        background: 'transparent', color: t.text, font: 'inherit', fontSize: 13.5,
                    }}
                />
                <kbd aria-hidden="true" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3, height: 24, padding: '0 7px',
                    borderRadius: 7, border: '1px solid ' + t.line, background: t.panelAlt,
                    fontFamily: 'inherit', fontSize: 11.5, color: t.dim, flexShrink: 0,
                }}>{IS_MAC ? '⌘' : 'Ctrl'} K</kbd>
            </div>

            {showList && (
                <div style={{
                    position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 500,
                    width: Math.max(width, 440), maxWidth: 'min(560px, 90vw)',
                    background: t.card, border: '1px solid ' + t.lineStrong, borderRadius: 14,
                    boxShadow: t.highlight + ', ' + t.shadow, overflow: 'hidden',
                }}>
                    <div id={listId} role="listbox" aria-label="Search results" className="edge-scroll"
                        style={{ maxHeight: 'min(460px, 70vh)', overflowY: 'auto', padding: 6 }}>
                        {groups.length === 0 ? (
                            <div style={{ padding: '22px 12px', textAlign: 'center', fontSize: 13, color: t.faint }}>
                                Nothing matches “{q.trim()}”
                            </div>
                        ) : groups.map((g) => {
                            const Icon = ICON[g.kind];
                            return (
                                <div key={g.kind} role="group" aria-label={g.kind}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px 4px', fontSize: 12, fontWeight: 500, color: t.faint }}>
                                        {g.kind}
                                        {g.total > g.items.length && <span style={{ color: t.ghost }}>· {g.total} found</span>}
                                    </div>
                                    {g.items.map((r) => {
                                        n += 1;
                                        const i = n;
                                        const on = i === sel;
                                        return (
                                            <div key={g.kind + r.to + r.title} id={`${listId}-${i}`} role="option" aria-selected={on}
                                                onMouseDown={(e) => e.preventDefault()} onClick={() => go(r)} onMouseMove={() => setActive(i)}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10,
                                                    cursor: 'pointer', background: on ? t.accentSoft : 'transparent',
                                                }}>
                                                <span aria-hidden="true" style={{
                                                    width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center',
                                                    background: on ? t.accent : t.panelAlt, color: on ? t.onAccent : t.dim,
                                                    border: '1px solid ' + (on ? 'transparent' : t.line),
                                                }}><Icon size={15} /></span>
                                                <span style={{ flex: 1, minWidth: 0 }}>
                                                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        <Highlight text={r.title} q={q} t={t} />
                                                    </span>
                                                    {r.sub && <span style={{ display: 'block', fontSize: 12, color: t.faint, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sub}</span>}
                                                </span>
                                                {on && <CornerDownLeft size={14} aria-hidden="true" style={{ color: t.accent, flexShrink: 0 }} />}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                    <div style={{
                        display: 'flex', gap: 14, padding: '8px 14px', borderTop: '1px solid ' + t.line,
                        background: t.panelAlt, fontSize: 11.5, color: t.faint,
                    }}>
                        <span>↑↓ to move</span><span>Enter to open</span><span>Esc to close</span>
                    </div>
                </div>
            )}
        </div>
    );
}

/** The query's first word, bolded in the blue where it appears in the title. */
function Highlight({ text, q, t }) {
    const w = low(q).trim().split(/\s+/)[0];
    const i = w ? low(text).indexOf(w) : -1;
    if (i < 0) return text;
    return (<>
        {text.slice(0, i)}
        <mark style={{ background: 'transparent', color: t.accent, fontWeight: 600 }}>{text.slice(i, i + w.length)}</mark>
        {text.slice(i + w.length)}
    </>);
}
