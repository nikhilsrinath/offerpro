import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Plus, ChevronRight, ArrowUp, ArrowDown, Trash2, UserCog, Flag, Trophy, XCircle, Calendar,
} from 'lucide-react';
import { Page, Toolbar, Btn, Seg, Search, Dropdown, Avatar, Status, RowMenu, Empty, Muted } from '../ui/edge';
import { useT, fmtDate, useDialog } from '../ui/edgeUtils';
import { useSection } from '../financial/financeHooks';
import { useAuth } from '../../context/AuthContext';
import { orgStore } from '../../services/orgStore';
import { confirmDialog } from '../../services/confirm';
import { useToast } from '../shared/Toast';
import { initialQuery } from '../../services/urlQuery';
import { formatCurrency, baseCurrency } from '../../shared/currency.js';
import PipelineBar from './PipelineBar';
import DealRecord from './DealRecord';
import { DealForm, OwnerForm, ReasonForm } from './DealForms';
import {
    STAGES, stateOf, stageLabel, probabilityOf, filterDeals, sortDeals, matchesDeal,
    stageChange, stateChange, defaultProbability,
} from './dealModel';
import './crm.css';

const VIEW_KEY = 'opstead.crm.view';
const readView = () => { try { return localStorage.getItem(VIEW_KEY) === 'board' ? 'board' : 'list'; } catch { return 'list'; } };
const writeView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };

const money = (v, cur) => formatCurrency(v || 0, { currency: cur || baseCurrency() });

/* The open deal, over the whole page: a full-height panel from the right on
   a dimmed backdrop, like every other side panel. Esc, the backdrop or the
   record's close button shut it; a form opened from inside it stacks above
   and takes Esc first (useDialog). */
function RecordPanel({ t, vars, label, onClose, children }) {
    const backRef = useRef(null);
    const sheetRef = useRef(null);
    useDialog(sheetRef, onClose, true);
    // The page under the panel does not scroll while it is open.
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, []);
    return (
        <div ref={backRef} className="crm-panel-backdrop"
            onMouseDown={(e) => { if (e.target === backRef.current) onClose(); }}
            style={{ ...vars, background: t.isDark ? 'rgba(0,0,0,.62)' : 'rgba(20,28,32,.34)' }}>
            <div ref={sheetRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
                className="crm-panel" style={{ background: t.card, borderLeft: '1px solid ' + t.lineStrong, boxShadow: t.shadow }}>
                {children}
            </div>
        </div>
    );
}

/* The CRM: deals in one pipeline. The list (or board) fills the page; a
   deal opens over it in a panel from the right, only when it is clicked.
   `project` (a project's Client Management › CRM tab) shows that project's
   deals and starts new ones on it. */
export default function DealsPage({ project = null }) {
    const t = useT();
    const toast = useToast();
    const [params, setParams] = useSearchParams();
    const { user } = useAuth();
    const userId = user?.id || null;

    const deals = useSection('crm_deals');
    const activities = useSection('crm_deal_activities');
    const clients = useSection('customers');
    const employees = useSection('employees');
    const projects = useSection('projects');
    const finDocs = useSection('fin_docs');
    const quotations = useMemo(() => finDocs.filter((d) => d.type === 'quotation'), [finDocs]);

    const can = {
        create: orgStore.can('clients', 'create'),
        edit: orgStore.can('clients', 'edit'),
        delete: orgStore.can('clients', 'delete'),
    };

    const [query, setQuery] = useState(initialQuery);
    const [stateFilter, setStateFilter] = useState('open');
    const [owner, setOwner] = useState('');
    const [view, setViewRaw] = useState(readView);
    const setView = (v) => { setViewRaw(v); writeView(v); };
    const [sort, setSort] = useState({ key: 'created', dir: 'desc' });
    const [picked, setPicked] = useState(() => new Set());
    const [form, setForm] = useState(null); // { deal?, defaults? }
    const [bulkPanel, setBulkPanel] = useState(null);

    const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);
    const empById = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);
    const projectById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);

    const scoped = useMemo(() => (project
        ? deals.filter((d) => d.project_id === project.id || (!d.project_id && project.client_id && d.client_id === project.client_id))
        : deals), [deals, project]);

    const shown = useMemo(() => {
        const list = filterDeals(scoped, { state: stateFilter, owner, userId })
            .filter((d) => matchesDeal(d, query, clientById[d.client_id]?.name));
        return sortDeals(list, sort);
    }, [scoped, stateFilter, owner, userId, query, clientById, sort]);


    const selectedId = params.get('deal');
    const selected = selectedId ? deals.find((d) => d.id === selectedId) || null : null;
    const open = (id) => setParams((p) => { const n = new URLSearchParams(p); n.set('deal', id); return n; });
    const close = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('deal'); n.delete('tab'); return n; }, { replace: true });

    // A deal that was deleted (or never existed) closes its pane.
    useEffect(() => {
        if (selectedId && deals.length && !selected) close();
    }, [selectedId, deals.length, selected]); // eslint-disable-line react-hooks/exhaustive-deps

    const newDeal = (defaults = {}) => setForm({ defaults: {
        project_id: project?.id || '', client_id: project?.client_id || '', ...defaults,
    } });

    const pickedDeals = shown.filter((d) => picked.has(d.id));
    const togglePick = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const allPicked = shown.length > 0 && shown.every((d) => picked.has(d.id));
    const pickAll = () => setPicked(allPicked ? new Set() : new Set(shown.map((d) => d.id)));

    const bulk = async (fn, msg) => {
        try {
            for (const d of pickedDeals) await fn(d);
            toast(msg, 'success');
            setPicked(new Set());
        } catch (e) { toast(e.message, 'error'); }
    };
    const bulkDelete = async () => {
        if (!(await confirmDialog({ title: 'Delete Deals', message: `Delete ${pickedDeals.length} ${pickedDeals.length === 1 ? 'deal' : 'deals'} and their timelines? This cannot be undone.`, confirmLabel: 'Delete' }))) return;
        bulk((d) => orgStore.removeItem('crm_deals', d.id), `${pickedDeals.length} deleted`);
    };


    const ownerOptions = [{ id: '', label: 'Everyone' }, ...employees
        .filter((e) => scoped.some((d) => d.owner_id === e.id))
        .map((e) => ({ id: e.id, label: e.full_name || e.name }))];

    const stateOptions = [
        { id: 'open', label: 'Open' }, { id: 'won', label: 'Won' }, { id: 'lost', label: 'Lost' },
        { id: 'closed', label: 'All Closed' }, { id: 'starred', label: 'Starred' }, { id: 'all', label: 'All Deals' },
    ];

    const vars = {
        '--crm-accent': t.accent, '--crm-teal': t.teal, '--crm-alt': t.panelAlt, '--crm-soft': t.accentSoft, '--crm-line': t.line,
    };

    return (
        <Page>
            <div style={vars}>
                <Toolbar sticky={false} right={can.create && (
                    <Btn primary onClick={() => newDeal()}><Plus size={14} aria-hidden="true" /> New Deal</Btn>
                )}>
                    <Search value={query} onChange={setQuery} placeholder="Search deals, organisations, contacts…" width={280} />
                    <Dropdown label="Show" value={stateFilter} onChange={setStateFilter} options={stateOptions} />
                    {ownerOptions.length > 1 && <Dropdown label="Owner" value={owner} onChange={setOwner} options={ownerOptions} />}
                    <Seg size="md" value={view} onChange={setView} label="View" options={[{ id: 'list', label: 'List' }, { id: 'board', label: 'Board' }]} />
                </Toolbar>

                {picked.size > 0 && view === 'list' && (
                    <div role="region" aria-label="Bulk actions" style={{
                        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 12px', marginBottom: 10,
                        background: t.accentSoft, borderRadius: 10, border: '1px solid ' + t.line,
                    }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: t.softText || t.text }}>{picked.size} selected</span>
                        <div style={{ flex: 1 }} />
                        {can.edit && <RowMenu text="Move To Stage" label="Move selected to stage" items={STAGES.map((s) => ({
                            label: s.label, icon: Flag, onClick: () => bulk((d) => orgStore.updateItem('crm_deals', d.id, stageChange(d, s.id)), `Moved to ${s.label}`),
                        }))} />}
                        {can.edit && <RowMenu text="Set State" label="Set state of selected" items={[
                            { label: 'Open', icon: Flag, onClick: () => bulk((d) => orgStore.updateItem('crm_deals', d.id, stateChange(d, 'open')), 'Reopened') },
                            { label: 'Won', icon: Trophy, onClick: () => bulk((d) => orgStore.updateItem('crm_deals', d.id, stateChange(d, 'won')), 'Marked won') },
                            { label: 'Lost', icon: XCircle, onClick: () => setBulkPanel('lost') },
                            { label: 'Suspended', icon: Calendar, onClick: () => bulk((d) => orgStore.updateItem('crm_deals', d.id, stateChange(d, 'suspended')), 'Suspended') },
                        ]} />}
                        {can.edit && <Btn onClick={() => setBulkPanel('owner')}><UserCog size={14} aria-hidden="true" /> Change Owner</Btn>}
                        {can.delete && <Btn danger onClick={bulkDelete}><Trash2 size={14} aria-hidden="true" /> Delete</Btn>}
                        <Btn onClick={() => setPicked(new Set())}>Clear</Btn>
                    </div>
                )}

                {view === 'board' ? (
                    <Board deals={shown} t={t} clientById={clientById} empById={empById} can={can}
                        onOpen={open} onNew={(stage) => newDeal({ stage })} />
                ) : (
                    <DealTable deals={shown} t={t} clientById={clientById} empById={empById}
                        selectedId={selectedId} onOpen={open} sort={sort} onSort={setSort}
                        picked={picked} onPick={togglePick} allPicked={allPicked} onPickAll={pickAll}
                        empty={scoped.length === 0
                            ? <Empty action={can.create && <Btn primary onClick={() => newDeal()}><Plus size={14} aria-hidden="true" /> New Deal</Btn>}>
                                No deals yet. A deal is one sale you are working on: its organisation, its value, and how far along it is.
                            </Empty>
                            : <Empty>No deals match. Change the filters above.</Empty>} />
                )}

                {/* The open deal: a panel over the whole page, from the right. */}
                {selected && (
                    <RecordPanel t={t} vars={vars} label={`Deal: ${selected.name}`} onClose={close}>
                        <DealRecord key={selected.id} deal={selected}
                            client={clientById[selected.client_id]} owner={empById[selected.owner_id]}
                            project={projectById[selected.project_id]} activities={activities} quotations={quotations}
                            employees={employees} userId={userId} can={can}
                            onClose={close} onOpen={open} onEdit={() => setForm({ deal: selected })} />
                    </RecordPanel>
                )}
            </div>

            {form && (
                <DealForm deal={form.deal} defaults={form.defaults} clients={clients} employees={employees} projects={projects}
                    onClose={() => setForm(null)} />
            )}
            {bulkPanel === 'owner' && <OwnerForm deals={pickedDeals} employees={employees} onClose={() => { setBulkPanel(null); setPicked(new Set()); }} />}
            {bulkPanel === 'lost' && (
                <ReasonForm deal={{ name: `${pickedDeals.length} deals` }} state="lost" onClose={() => setBulkPanel(null)}
                    onConfirm={(reason) => bulk((d) => orgStore.updateItem('crm_deals', d.id, stateChange(d, 'lost', reason)), 'Marked lost')} />
            )}
        </Page>
    );
}

/* ── The list ─────────────────────────────────────────────────────────────── */

function DealTable({ deals, t, narrow, clientById, empById, selectedId, onOpen, sort, onSort, picked, onPick, allPicked, onPickAll, empty }) {
    const cols = [
        { key: 'name', label: 'Deal Name', sort: 'name' },
        { key: 'org', label: 'Organisation' },
        { key: 'pipeline', label: 'Pipeline', sort: 'stage', width: narrow ? 150 : 210 },
        ...(narrow ? [] : [
            { key: 'value', label: 'Value', sort: 'value', align: 'right' },
            { key: 'prob', label: 'Probability', sort: 'probability', align: 'right' },
            { key: 'close', label: 'Expected Close', sort: 'close' },
            { key: 'owner', label: 'Owner' },
            { key: 'state', label: 'State' },
        ]),
    ];
    const flip = (key) => onSort(sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'close' ? 'asc' : 'desc' });
    const today = new Date().toISOString().slice(0, 10);
    const cell = { padding: '9px 12px', borderTop: '1px solid ' + t.line, fontSize: 12.5, color: t.text, verticalAlign: 'middle' };

    if (!deals.length) return <div style={{ border: '1px solid ' + t.line, borderRadius: narrow ? 0 : 12, background: t.card }}>{empty}</div>;

    return (
        <div style={{ border: narrow ? 'none' : '1px solid ' + t.line, borderRadius: narrow ? 0 : 12, overflow: narrow ? 'visible' : 'auto', background: t.card }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }} aria-label="Deals">
                <thead style={narrow ? { position: 'sticky', top: 0, zIndex: 2 } : undefined}>
                    <tr>
                        <th scope="col" style={{ width: 38, padding: '8px 0 8px 12px' }}>
                            <input type="checkbox" checked={allPicked} onChange={onPickAll} aria-label="Select all deals" />
                        </th>
                        {cols.map((c) => (
                            <th key={c.key} scope="col" aria-sort={sort.key === c.sort ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                                style={{ textAlign: c.align || 'left', padding: '8px 12px', whiteSpace: 'nowrap', width: c.width }}>
                                {c.sort ? (
                                    <button type="button" className="crm-sort" onClick={() => flip(c.sort)}>
                                        {c.label}
                                        {sort.key === c.sort && (sort.dir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)}
                                    </button>
                                ) : c.label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {deals.map((d) => {
                        const client = clientById[d.client_id];
                        const owner = empById[d.owner_id];
                        const sel = d.id === selectedId;
                        const late = d.state === 'open' && d.expected_close && d.expected_close < today;
                        return (
                            <tr key={d.id} className="crm-row" tabIndex={0} aria-selected={sel}
                                onClick={() => onOpen(d.id)}
                                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(d.id); } }}>
                                <td style={{ ...cell, padding: '9px 0 9px 12px' }} onClick={(e) => e.stopPropagation()}>
                                    <input type="checkbox" checked={picked.has(d.id)} onChange={() => onPick(d.id)} aria-label={`Select ${d.name}`} />
                                </td>
                                <td style={{ ...cell, maxWidth: narrow ? 170 : 280 }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                                        <Avatar name={client?.name || d.name} size={26} />
                                        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontWeight: 500, color: t.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.name}>{d.name}</span>
                                            {narrow && <span style={{ fontSize: 11.5, color: t.faint, fontVariantNumeric: 'tabular-nums' }}>{d.value != null ? money(d.value, d.currency) : 'No value'}</span>}
                                        </span>
                                        {(d.starred_by || []).length > 0 && <span aria-hidden="true" style={{ color: '#e0a020', fontSize: 12 }}>★</span>}
                                    </span>
                                </td>
                                <td style={{ ...cell, color: client ? t.text : t.faint, maxWidth: narrow ? 130 : 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={client?.name}>
                                    {client?.name || '-'}
                                </td>
                                <td style={cell}><PipelineBar deal={d} /></td>
                                {!narrow && (
                                    <>
                                        <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{d.value != null ? money(d.value, d.currency) : '-'}</td>
                                        <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{probabilityOf(d).toFixed(2)}%</td>
                                        <td style={{ ...cell, whiteSpace: 'nowrap', color: late ? t.down : t.dim }}>{d.expected_close ? fmtDate(d.expected_close) : '-'}</td>
                                        <td style={{ ...cell, color: owner ? t.text : t.faint, whiteSpace: 'nowrap' }}>{owner ? owner.full_name || owner.name : 'Unassigned'}</td>
                                        <td style={cell}><Status tone={stateOf(d.state).tone}>{stateOf(d.state).label}</Status></td>
                                    </>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

/* ── The board ────────────────────────────────────────────────────────────── */

function Board({ deals, t, clientById, empById, can, onOpen, onNew }) {
    const toast = useToast();
    const [over, setOver] = useState(null);
    const dragging = useRef(null);
    const move = async (id, stage) => {
        const d = deals.find((x) => x.id === id);
        if (!d || d.stage === stage) return;
        try {
            await orgStore.updateItem('crm_deals', id, stageChange(d, stage));
            toast(`${d.name} moved to ${stageLabel(stage)}`, 'success');
        } catch (e) { toast(e.message, 'error'); }
    };

    return (
        <div className="edge-scroll" style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, minmax(230px, 1fr))`, gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
            {STAGES.map((s) => {
                const col = deals.filter((d) => d.stage === s.id);
                const total = col.reduce((a, d) => a + (!d.currency || d.currency === baseCurrency() ? Number(d.value) || 0 : 0), 0);
                return (
                    <section key={s.id} aria-label={`${s.label}: ${col.length} deals`}
                        className={over === s.id ? 'crm-col-drop' : undefined}
                        onDragOver={can.edit ? (e) => { e.preventDefault(); if (over !== s.id) setOver(s.id); } : undefined}
                        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
                        onDrop={can.edit ? (e) => { e.preventDefault(); setOver(null); if (dragging.current) move(dragging.current, s.id); dragging.current = null; } : undefined}
                        style={{ background: t.panelAlt, border: '1px solid ' + t.line, borderRadius: 12, padding: 8, minHeight: 320, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <header style={{ padding: '4px 4px 2px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 12.5, fontWeight: 600, color: t.text }}>{s.label}</span>
                                <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 5, background: t.accentSoft, color: t.softText || t.accent }}>{col.length}</span>
                                <div style={{ flex: 1 }} />
                                {can.create && (
                                    <button type="button" className="crm-icon-btn" onClick={() => onNew(s.id)} aria-label={`New deal in ${s.label}`} title="New deal here">
                                        <Plus size={14} aria-hidden="true" color={t.dim} />
                                    </button>
                                )}
                            </div>
                            <Muted size={11.5}>{money(total)} · {defaultProbability(s.id)}% default</Muted>
                        </header>
                        {col.map((d) => {
                            const client = clientById[d.client_id];
                            const owner = empById[d.owner_id];
                            return (
                                <article key={d.id} className="crm-card" tabIndex={0} draggable={can.edit}
                                    aria-label={`${d.name}, ${client?.name || 'no organisation'}`}
                                    onDragStart={(e) => { dragging.current = d.id; e.dataTransfer.effectAllowed = 'move'; }}
                                    onDragEnd={() => { dragging.current = null; setOver(null); }}
                                    onClick={() => onOpen(d.id)}
                                    onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(d.id); } }}
                                    style={{ background: t.card, border: '1px solid ' + t.line, borderRadius: 10, padding: '10px 11px' }}>
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 12.5, fontWeight: 600, color: t.text, overflowWrap: 'anywhere' }}>{d.name}</div>
                                            <div style={{ fontSize: 11.5, color: t.dim, marginTop: 2 }}>{client?.name || 'No organisation'}</div>
                                        </div>
                                        {can.edit && (
                                            <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                                                <RowMenu size="xs" label={`Move ${d.name}`} items={STAGES.filter((x) => x.id !== d.stage).map((x) => ({
                                                    label: `Move To ${x.label}`, icon: ChevronRight, onClick: () => move(d.id, x.id),
                                                }))} />
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                                        <span style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: t.text }}>{d.value != null ? money(d.value, d.currency) : '-'}</span>
                                        <span style={{ fontSize: 11.5, color: t.faint }}>{probabilityOf(d).toFixed(2)}%</span>
                                        <div style={{ flex: 1 }} />
                                        {owner && <Avatar name={owner.full_name || owner.name} size={20} />}
                                    </div>
                                    {d.expected_close && (
                                        <div style={{ fontSize: 11.5, color: d.expected_close < new Date().toISOString().slice(0, 10) ? t.down : t.faint, marginTop: 4 }}>
                                            Close {fmtDate(d.expected_close)}
                                        </div>
                                    )}
                                </article>
                            );
                        })}
                        {col.length === 0 && <div style={{ fontSize: 11.5, color: t.faint, textAlign: 'center', padding: '18px 6px' }}>Drop a deal here</div>}
                    </section>
                );
            })}
        </div>
    );
}
