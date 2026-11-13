import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Target, Star, X, Pencil, Copy, Trash2, UserCog, Printer, CheckSquare, CalendarPlus, StickyNote,
    FilePlus, FolderKanban, ChevronDown, ChevronRight, Mail, Phone, Building2, Link2, Users, FileText,
    Calendar, MessageSquare, PhoneCall, Video, Flag, ArrowRightLeft, Sparkles, ExternalLink, UserPlus,
} from 'lucide-react';
import { Btn, Seg, RowMenu, Status, Select, Textarea, Muted, Empty } from '../ui/edge';
import { useT, fmtDate } from '../ui/edgeUtils';
import { titleCaseNode } from '../../utils/titleCase';
import { orgStore } from '../../services/orgStore';
import { confirmDialog } from '../../services/confirm';
import { useToast } from '../shared/Toast';
import { canCreateProjects } from '../../services/projectService';
import { projectRef } from '../projects/projectSlug';
import { docNumber } from '../../services/documentStore';
import { formatCurrency, baseCurrency } from '../../shared/currency.js';
import PipelineBar from './PipelineBar';
import {
    STATES, PIPELINE_NAME, stageLabel, stateOf, probabilityOf, relatedCounts, stageChange, stateChange, cloneDeal,
} from './dealModel';
import { ContactForm, ActivityForm, LinkQuoteForm, OwnerForm, ReasonForm } from './DealForms';

const money = (v, cur) => (v == null || v === '' ? '-' : formatCurrency(v, { currency: cur || baseCurrency() }));
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-');
const daysSince = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : 0);

/* One deal, the right half of the CRM. Header (what it is, star, back, edit,
   Actions), the key facts, the pipeline with its state, then Details,
   Related and Activity. */
export default function DealRecord({
    deal, client, owner, project, activities, quotations, employees, userId,
    can, onClose, onEdit, onOpen,
}) {
    const t = useT();
    const toast = useToast();
    const navigate = useNavigate();
    const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'related');
    const [panel, setPanel] = useState(null); // { kind, ... }
    const mine = useMemo(() => activities.filter((a) => a.deal_id === deal.id), [activities, deal.id]);
    const counts = relatedCounts(deal, activities);
    const starred = (deal.starred_by || []).includes(userId);
    const quotes = (deal.quote_ids || []).map((id) => quotations.find((q) => q.id === id)).filter(Boolean);
    const editable = can.edit;

    const update = async (patch, msg) => {
        try {
            await orgStore.updateItem('crm_deals', deal.id, patch);
            if (msg) toast(msg, 'success');
        } catch (e) {
            toast(e.message, 'error');
        }
    };

    const toggleStar = () => {
        if (!userId) return;
        const s = new Set(deal.starred_by || []);
        if (s.has(userId)) s.delete(userId); else s.add(userId);
        update({ starred_by: [...s] });
    };

    const moveStage = (stage) => {
        if (stage === deal.stage) return;
        update(stageChange(deal, stage), `Moved to ${stageLabel(stage)}`);
    };

    const setState = async (state) => {
        if (state === deal.state) return;
        if (state === 'lost' || state === 'abandoned') { setPanel({ kind: 'reason', state }); return; }
        await update(stateChange(deal, state), `Deal ${stateOf(state).label.toLowerCase()}`);
        if (state === 'won') {
            // A won deal's organisation is a customer now.
            if (client && client.status !== 'active') orgStore.updateItem('customers', client.id, { status: 'active' }).catch(() => {});
            if (!deal.project_id && canCreateProjects()) {
                toast(`${deal.name} won`, 'success', 9000, { label: 'Convert To Project', onClick: convert });
            }
        }
    };

    const convert = () => navigate(`/projects/new?deal=${deal.id}${deal.client_id ? `&client=${deal.client_id}` : ''}`);
    const newQuote = () => navigate('/clients/billing/quotations/new', { state: { dealId: deal.id, clientId: deal.client_id } });

    const clone = async () => {
        try {
            const c = await orgStore.addItem('crm_deals', cloneDeal(deal));
            toast('Deal cloned', 'success');
            onOpen?.(c.id);
        } catch (e) { toast(e.message, 'error'); }
    };

    const remove = async () => {
        if (!(await confirmDialog({ title: 'Delete Deal', message: `Delete “${deal.name}” and its timeline? This cannot be undone.`, confirmLabel: 'Delete' }))) return;
        try {
            await orgStore.removeItem('crm_deals', deal.id);
            toast('Deal deleted', 'success');
            onClose();
        } catch (e) { toast(e.message, 'error'); }
    };

    const printIt = () => {
        document.body.classList.add('crm-printing');
        const done = () => { document.body.classList.remove('crm-printing'); window.removeEventListener('afterprint', done); };
        window.addEventListener('afterprint', done);
        window.print();
    };

    const actions = [
        editable && { label: 'Edit This Deal', icon: Pencil, onClick: onEdit },
        can.create && { label: 'Clone This Deal', icon: Copy, onClick: clone },
        editable && { label: 'Change Record Owner', icon: UserCog, onClick: () => setPanel({ kind: 'owner' }) },
        { label: 'Print This Deal', icon: Printer, onClick: printIt },
        editable && { divider: true },
        editable && { label: 'Add New Task For Deal', icon: CheckSquare, onClick: () => setPanel({ kind: 'activity', type: 'task' }) },
        editable && { label: 'Add New Event For Deal', icon: CalendarPlus, onClick: () => setPanel({ kind: 'activity', type: 'event' }) },
        editable && { label: 'Add Note', icon: StickyNote, onClick: () => setPanel({ kind: 'activity', type: 'note' }) },
        { label: 'New Quote', icon: FilePlus, onClick: newQuote },
        deal.project_id && project
            ? { label: 'Open Project', icon: FolderKanban, onClick: () => navigate(`/projects/${projectRef(project.id)}`) }
            : canCreateProjects() && { label: 'Convert To Project', icon: ArrowRightLeft, onClick: convert },
        can.delete && { label: 'Delete This Deal', icon: Trash2, tone: 'danger', onClick: remove },
    ];

    const facts = [
        { label: 'Organisation', value: client ? (
            <button type="button" className="crm-link" onClick={() => navigate(`/clients/client-directory?q=${encodeURIComponent(client.name || '')}`)}>
                <Building2 size={13} aria-hidden="true" /> {client.name}
            </button>
        ) : '-' },
        { label: 'Expected Close', value: deal.expected_close ? fmtDate(deal.expected_close) : '-',
            warn: deal.state === 'open' && deal.expected_close && deal.expected_close < new Date().toISOString().slice(0, 10) },
        { label: 'Deal Value', value: money(deal.value, deal.currency) },
        { label: 'Probability Of Winning', value: `${probabilityOf(deal).toFixed(2)}%` },
        { label: 'Owner', value: owner ? owner.full_name || owner.name : 'Unassigned' },
        { label: deal.state === 'open' ? 'Age' : 'Closed', value: deal.state === 'open'
            ? `${daysSince(deal.created_at)} days` : fmtDate(deal.closed_on || deal.state_changed_at) },
    ];

    return (
        <section className="crm-record crm-print" aria-label={`Deal: ${deal.name}`}
            style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', background: t.card }}>
            {/* ── header ─────────────────────────────────────────────── */}
            <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid ' + t.line }}>
                <span aria-hidden="true" style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center',
                    background: t.accentSoft, color: t.accent, border: '1px solid ' + t.line,
                }}><Target size={20} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 500, color: t.faint }}>Deal</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deal.name}</h2>
                        <button type="button" onClick={toggleStar} className="crm-icon-btn no-print"
                            aria-pressed={starred} aria-label={starred ? 'Remove star' : 'Star this deal'} title={starred ? 'Starred' : 'Star'}>
                            <Star size={16} aria-hidden="true" fill={starred ? '#e0a020' : 'none'} color={starred ? '#e0a020' : t.faint} />
                        </button>
                        <Status tone={stateOf(deal.state).tone}>{stateOf(deal.state).label}</Status>
                    </div>
                </div>
                <div className="no-print" style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    {editable && <Btn onClick={onEdit} aria-label="Edit deal" title="Edit"><Pencil size={14} aria-hidden="true" /></Btn>}
                    <RowMenu text="Actions" label="Deal actions" items={actions} />
                    <Btn onClick={onClose} title="Close (Esc)" aria-label="Close deal"><X size={15} aria-hidden="true" /></Btn>
                </div>
            </header>

            <div className="edge-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {/* ── key facts ──────────────────────────────────────── */}
                <dl style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px 18px',
                    margin: 0, padding: '14px 18px', borderBottom: '1px solid ' + t.line,
                }}>
                    {facts.map((f) => (
                        <div key={f.label} style={{ minWidth: 0 }}>
                            <dt style={{ fontSize: 11.5, color: t.faint, marginBottom: 3 }}>{titleCaseNode(f.label)}</dt>
                            <dd style={{ margin: 0, fontSize: 13, fontWeight: 500, color: f.warn ? t.down : t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{f.value}</dd>
                        </div>
                    ))}
                </dl>

                {/* ── pipeline ───────────────────────────────────────── */}
                <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + t.line }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: t.text }}>Pipeline: <span style={{ fontWeight: 500, color: t.dim }}>{PIPELINE_NAME}</span></span>
                        <div style={{ flex: 1 }} />
                        <label htmlFor={`deal-state-${deal.id}`} style={{ fontSize: 12, fontWeight: 600, color: t.text }}>Deal State:</label>
                        <Select id={`deal-state-${deal.id}`} value={deal.state} disabled={!editable}
                            onChange={(e) => setState(e.target.value)} style={{ width: 140, height: 28 }}>
                            {STATES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </Select>
                    </div>
                    <PipelineBar deal={deal} size="lg" onPick={editable ? moveStage : undefined} />
                    {(deal.state === 'lost' || deal.state === 'abandoned') && (
                        <div style={{ marginTop: 10, fontSize: 12.5, color: t.dim }}>
                            {stateOf(deal.state).label} at {stageLabel(deal.stage)}{deal.lost_reason ? `: ${deal.lost_reason}` : ''}.{' '}
                            {editable && <button type="button" className="crm-link" onClick={() => setState('open')}>Reopen</button>}
                        </div>
                    )}
                    {deal.state === 'suspended' && (
                        <div style={{ marginTop: 10, fontSize: 12.5, color: t.dim }}>On hold. Stage moves are paused until it is reopened.</div>
                    )}
                </div>

                {/* ── tabs ───────────────────────────────────────────── */}
                <div className="no-print" style={{ padding: '12px 18px 0' }}>
                    <Seg value={tab} onChange={setTab} label="Deal sections" size="sm"
                        options={[{ id: 'details', label: 'Details' }, { id: 'related', label: 'Related' }, { id: 'activity', label: `Activity (${mine.length})` }]} />
                </div>

                <div style={{ padding: '14px 18px 24px' }}>
                    {tab === 'details' && <Details deal={deal} client={client} owner={owner} project={project} t={t} navigate={navigate} />}
                    {tab === 'related' && (
                        <Related deal={deal} client={client} counts={counts} quotes={quotes} mine={mine} t={t}
                            editable={editable} setPanel={setPanel} newQuote={newQuote} update={update} navigate={navigate} onEdit={onEdit} />
                    )}
                    {tab === 'activity' && <Activity deal={deal} mine={mine} editable={editable} t={t} employees={employees} />}
                </div>
            </div>

            {panel?.kind === 'contact' && <ContactForm deal={deal} client={client} contact={panel.contact} index={panel.index ?? -1} onClose={() => setPanel(null)} />}
            {panel?.kind === 'activity' && <ActivityForm deal={deal} kind={panel.type} activity={panel.activity} onClose={() => setPanel(null)} />}
            {panel?.kind === 'quote' && <LinkQuoteForm deal={deal} quotations={quotations} onClose={() => setPanel(null)} />}
            {panel?.kind === 'owner' && <OwnerForm deals={[deal]} employees={employees} onClose={() => setPanel(null)} />}
            {panel?.kind === 'reason' && (
                <ReasonForm deal={deal} state={panel.state} onClose={() => setPanel(null)}
                    onConfirm={(reason) => update(stateChange(deal, panel.state, reason), `Deal marked ${panel.state}`)} />
            )}
        </section>
    );
}

/* ── Details ──────────────────────────────────────────────────────────────── */

function Details({ deal, client, owner, project, t, navigate }) {
    const rows = [
        ['Deal Name', deal.name],
        ['Organisation', client?.name || '-'],
        ['Stage', stageLabel(deal.stage)],
        ['State', stateOf(deal.state).label],
        ['Deal Value', money(deal.value, deal.currency)],
        ['Currency', deal.currency || baseCurrency()],
        ['Probability Of Winning', `${probabilityOf(deal).toFixed(2)}%`],
        ['Weighted Value', deal.value == null ? '-' : money((Number(deal.value) * probabilityOf(deal)) / 100, deal.currency)],
        ['Expected Close Date', deal.expected_close ? fmtDate(deal.expected_close) : '-'],
        ['Closed On', deal.closed_on ? fmtDate(deal.closed_on) : '-'],
        ['Owner', owner ? owner.full_name || owner.name : 'Unassigned'],
        ['Source', deal.source || '-'],
        ['Project', project ? (
            <button type="button" className="crm-link" onClick={() => navigate(`/projects/${projectRef(project.id)}`)}>
                {project.code ? `${project.code} · ` : ''}{project.name}
            </button>
        ) : '-'],
        ['Reason Closed', deal.lost_reason || '-'],
        ['In Stage Since', fmtDate(deal.stage_changed_at)],
        ['Created', fmtDate(deal.created_at)],
        ['Last Updated', fmtDate(deal.updated_at)],
    ];
    return (
        <>
            <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', margin: 0, border: '1px solid ' + t.line, borderRadius: 12, overflow: 'hidden' }}>
                {rows.map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', gap: 12, padding: '9px 14px', borderBottom: '1px solid ' + t.line, minWidth: 0 }}>
                        <dt style={{ width: 150, flexShrink: 0, fontSize: 12, color: t.faint }}>{k}</dt>
                        <dd style={{ margin: 0, fontSize: 12.5, color: t.text, minWidth: 0, overflowWrap: 'anywhere' }}>{v}</dd>
                    </div>
                ))}
            </dl>
            <h3 style={{ fontSize: 13, fontWeight: 600, margin: '18px 0 8px', color: t.text }}>Description</h3>
            <div style={{ fontSize: 12.5, color: deal.description ? t.text : t.faint, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {deal.description || 'No description yet.'}
            </div>
        </>
    );
}

/* ── Related ──────────────────────────────────────────────────────────────── */

function Section({ id, title, count, actions, children, t }) {
    const [open, setOpen] = useState(true);
    return (
        <section id={id} style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="crm-section-toggle"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer', color: t.text, fontFamily: 'inherit' }}>
                    {open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 5, display: 'inline-grid', placeItems: 'center', background: t.accentSoft, color: t.softText || t.accent }}>{count}</span>
                </button>
                <div style={{ flex: 1 }} />
                <div className="no-print" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{actions}</div>
            </div>
            {open && children}
        </section>
    );
}

function MiniTable({ cols, rows, empty, t }) {
    return (
        <div style={{ border: '1px solid ' + t.line, borderRadius: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                    <tr>{cols.map((c) => <th key={c.label} scope="col" style={{ textAlign: c.align || 'left', padding: '8px 12px', whiteSpace: 'nowrap', width: c.width }}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                    {rows.length === 0
                        ? <tr><td colSpan={cols.length} style={{ padding: '14px 12px', color: t.faint }}>{empty}</td></tr>
                        : rows}
                </tbody>
            </table>
        </div>
    );
}

const td = (t, extra) => ({ padding: '8px 12px', borderTop: '1px solid ' + t.line, color: t.text, verticalAlign: 'middle', ...extra });

function Related({ deal, client, counts, quotes, mine, t, editable, setPanel, newQuote, update, navigate, onEdit }) {
    const tasks = mine.filter((a) => a.kind === 'task').sort((a, b) => (a.done - b.done) || String(a.due_at || '9').localeCompare(String(b.due_at || '9')));
    const events = mine.filter((a) => a.kind === 'event').sort((a, b) => String(b.due_at || '').localeCompare(String(a.due_at || '')));
    const notes = mine.filter((a) => a.kind === 'note');
    const contacts = deal.contacts || [];
    const emails = contacts.map((c) => c.email).filter(Boolean);
    const tiles = [
        { id: 'rel-contacts', label: 'Contacts', n: counts.contacts, icon: Users },
        { id: 'rel-orgs', label: 'Organisations', n: counts.organisations, icon: Building2 },
        { id: 'rel-quotes', label: 'Quotes', n: counts.quotes, icon: FileText },
        { id: 'rel-tasks', label: 'Tasks', n: counts.tasks, icon: CheckSquare },
        { id: 'rel-events', label: 'Events', n: counts.events, icon: Calendar },
        { id: 'rel-notes', label: 'Notes', n: counts.notes, icon: StickyNote },
    ];
    const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const unlinkQuote = (id) => update({ quote_ids: (deal.quote_ids || []).filter((x) => x !== id) }, 'Quotation unlinked');
    const removeContact = (i) => update({ contacts: contacts.filter((_, k) => k !== i) }, 'Contact removed');
    const toggleTask = (a) => orgStore.updateItem('crm_deal_activities', a.id, { done: !a.done }).catch(() => {});
    const removeActivity = async (a) => {
        if (!(await confirmDialog({ title: 'Delete', message: 'Delete this from the deal?', confirmLabel: 'Delete' }))) return;
        orgStore.removeItem('crm_deal_activities', a.id).catch(() => {});
    };

    return (
        <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 8 }}>
                {tiles.map((x) => (
                    <button key={x.id} type="button" className="stat-box crm-tile" onClick={() => jump(x.id)}
                        aria-label={`${x.label}: ${x.n}. Go to section`}
                        style={{ textAlign: 'left', padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit', border: 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 500, color: t.dim }}>
                            <x.icon size={13} aria-hidden="true" /> {x.label}
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4, color: t.text, fontVariantNumeric: 'tabular-nums' }}>{x.n}</div>
                    </button>
                ))}
            </div>

            <Section id="rel-contacts" title="Contacts" count={contacts.length} t={t} actions={<>
                {emails.length > 0 && <Btn size="sm" onClick={() => { window.location.href = `mailto:${emails.join(',')}?subject=${encodeURIComponent(deal.name)}`; }}><Mail size={13} aria-hidden="true" /> Email Contacts</Btn>}
                {editable && <Btn size="sm" onClick={() => setPanel({ kind: 'contact' })}><UserPlus size={13} aria-hidden="true" /> Add Contact</Btn>}
            </>}>
                <MiniTable t={t} empty="No contacts on this deal yet."
                    cols={[{ label: 'Contact Name' }, { label: 'Title' }, { label: 'Details' }, { label: 'Linked' }, { label: '', width: 44 }]}
                    rows={contacts.map((c, i) => (
                        <tr key={`${c.email || c.name}-${i}`}>
                            <td style={td(t, { fontWeight: 500 })}>{c.name || '-'}</td>
                            <td style={td(t, { color: t.dim })}>{c.title || '-'}</td>
                            <td style={td(t)}>
                                <span style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                    {c.email && <a className="crm-link" href={`mailto:${c.email}`}><Mail size={12} aria-hidden="true" /> {c.email}</a>}
                                    {c.phone && <a className="crm-link" href={`tel:${c.phone}`}><Phone size={12} aria-hidden="true" /> {c.phone}</a>}
                                    {!c.email && !c.phone && <span style={{ color: t.faint }}>-</span>}
                                </span>
                            </td>
                            <td style={td(t, { color: t.dim, whiteSpace: 'nowrap' })}>{fmtDate(c.linked_at)}</td>
                            <td style={td(t, { textAlign: 'right' })}>
                                {editable && <RowMenu label={`Actions for ${c.name || c.email}`} items={[
                                    { label: 'Edit', icon: Pencil, onClick: () => setPanel({ kind: 'contact', contact: c, index: i }) },
                                    { label: 'Remove From Deal', icon: Trash2, tone: 'danger', onClick: () => removeContact(i) },
                                ]} />}
                            </td>
                        </tr>
                    ))} />
            </Section>

            <Section id="rel-orgs" title="Organisations" count={client ? 1 : 0} t={t} actions={
                editable && <Btn size="sm" onClick={onEdit}><Link2 size={13} aria-hidden="true" /> {client ? 'Change' : 'Add Link'}</Btn>
            }>
                <MiniTable t={t} empty="This deal is not linked to an organisation."
                    cols={[{ label: 'Organisation Name' }, { label: 'Industry' }, { label: 'Details' }, { label: 'Status' }]}
                    rows={client ? [(
                        <tr key={client.id}>
                            <td style={td(t)}>
                                <button type="button" className="crm-link" onClick={() => navigate(`/clients/client-directory?q=${encodeURIComponent(client.name || '')}`)}>
                                    <Building2 size={13} aria-hidden="true" /> {client.name}
                                </button>
                            </td>
                            <td style={td(t, { color: t.dim })}>{client.industry || client.company_profile?.industry || '-'}</td>
                            <td style={td(t, { color: t.dim })}>
                                {[client.email, client.phone, client.website].filter(Boolean).join(' · ') || '-'}
                            </td>
                            <td style={td(t)}>{client.status === 'active' ? <Status tone="up">Customer</Status> : <Status>Prospect</Status>}</td>
                        </tr>
                    )] : []} />
            </Section>

            <Section id="rel-quotes" title="Quotes" count={quotes.length} t={t} actions={<>
                {editable && <Btn size="sm" onClick={() => setPanel({ kind: 'quote' })}><Link2 size={13} aria-hidden="true" /> Link Quote</Btn>}
                <Btn size="sm" onClick={newQuote}><FilePlus size={13} aria-hidden="true" /> New Quote</Btn>
            </>}>
                <MiniTable t={t} empty="No quotations yet. New Quote writes one for this deal’s organisation."
                    cols={[{ label: 'Quote Number' }, { label: 'Quote To' }, { label: 'Status' }, { label: 'Valid Until' }, { label: 'Amount', align: 'right' }, { label: '', width: 44 }]}
                    rows={quotes.map((q) => (
                        <tr key={q.id}>
                            <td style={td(t)}>
                                <button type="button" className="crm-link" onClick={() => navigate(`/clients/billing/quotations/${q.id}/edit`)}>{docNumber(q)}</button>
                            </td>
                            <td style={td(t)}>{q.clientName || '-'}</td>
                            <td style={td(t)}><QuoteStatus status={q.status} /></td>
                            <td style={td(t, { color: t.dim, whiteSpace: 'nowrap' })}>{fmtDate(q.valid_until)}</td>
                            <td style={td(t, { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' })}>{money(q.grand_total, q.currency)}</td>
                            <td style={td(t, { textAlign: 'right' })}>
                                <RowMenu label={`Actions for ${docNumber(q)}`} items={[
                                    { label: 'Open', icon: ExternalLink, onClick: () => navigate(`/clients/billing/quotations/${q.id}/edit`) },
                                    editable && { label: 'Unlink From Deal', icon: Trash2, tone: 'danger', onClick: () => unlinkQuote(q.id) },
                                ]} />
                            </td>
                        </tr>
                    ))} />
            </Section>

            <Section id="rel-tasks" title="Tasks" count={tasks.length} t={t} actions={
                editable && <Btn size="sm" onClick={() => setPanel({ kind: 'activity', type: 'task' })}><CheckSquare size={13} aria-hidden="true" /> Add Task</Btn>
            }>
                <MiniTable t={t} empty="No tasks. Add one so the next step is not forgotten."
                    cols={[{ label: '', width: 36 }, { label: 'Task' }, { label: 'Due' }, { label: '', width: 44 }]}
                    rows={tasks.map((a) => {
                        const late = !a.done && a.due_at && new Date(a.due_at) < new Date();
                        return (
                            <tr key={a.id}>
                                <td style={td(t)}>
                                    <input type="checkbox" checked={a.done} disabled={!editable} onChange={() => toggleTask(a)}
                                        aria-label={`${a.done ? 'Reopen' : 'Complete'} ${a.title}`} />
                                </td>
                                <td style={td(t, { textDecoration: a.done ? 'line-through' : 'none', color: a.done ? t.faint : t.text })}>
                                    <div style={{ fontWeight: 500 }}>{a.title}</div>
                                    {a.body && <div style={{ fontSize: 11.5, color: t.faint, marginTop: 2 }}>{a.body}</div>}
                                </td>
                                <td style={td(t, { whiteSpace: 'nowrap', color: late ? t.down : t.dim })}>{fmtWhen(a.due_at)}{late ? ' · Overdue' : ''}</td>
                                <td style={td(t, { textAlign: 'right' })}>
                                    {editable && <RowMenu label={`Actions for ${a.title}`} items={[
                                        { label: 'Edit', icon: Pencil, onClick: () => setPanel({ kind: 'activity', type: 'task', activity: a }) },
                                        { label: 'Delete', icon: Trash2, tone: 'danger', onClick: () => removeActivity(a) },
                                    ]} />}
                                </td>
                            </tr>
                        );
                    })} />
            </Section>

            <Section id="rel-events" title="Events" count={events.length} t={t} actions={
                editable && <Btn size="sm" onClick={() => setPanel({ kind: 'activity', type: 'event' })}><CalendarPlus size={13} aria-hidden="true" /> Add Event</Btn>
            }>
                <MiniTable t={t} empty="No meetings or calls scheduled."
                    cols={[{ label: 'Event' }, { label: 'When' }, { label: '', width: 44 }]}
                    rows={events.map((a) => (
                        <tr key={a.id}>
                            <td style={td(t)}>
                                <div style={{ fontWeight: 500 }}>{a.title}</div>
                                {a.body && <div style={{ fontSize: 11.5, color: t.faint, marginTop: 2 }}>{a.body}</div>}
                            </td>
                            <td style={td(t, { whiteSpace: 'nowrap', color: t.dim })}>{fmtWhen(a.due_at)}</td>
                            <td style={td(t, { textAlign: 'right' })}>
                                {editable && <RowMenu label={`Actions for ${a.title}`} items={[
                                    { label: 'Edit', icon: Pencil, onClick: () => setPanel({ kind: 'activity', type: 'event', activity: a }) },
                                    { label: 'Delete', icon: Trash2, tone: 'danger', onClick: () => removeActivity(a) },
                                ]} />}
                            </td>
                        </tr>
                    ))} />
            </Section>

            <Section id="rel-notes" title="Notes" count={notes.length} t={t} actions={
                editable && <Btn size="sm" onClick={() => setPanel({ kind: 'activity', type: 'note' })}><StickyNote size={13} aria-hidden="true" /> Add Note</Btn>
            }>
                {notes.length === 0 ? <Muted>No notes yet.</Muted> : (
                    <div style={{ display: 'grid', gap: 8 }}>
                        {notes.map((a) => (
                            <div key={a.id} style={{ border: '1px solid ' + t.line, borderRadius: 10, padding: '10px 12px', display: 'flex', gap: 10 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 12.5, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{a.body}</div>
                                    <div style={{ fontSize: 11, color: t.faint, marginTop: 6 }}>{fmtWhen(a.created_at)}</div>
                                </div>
                                {editable && <RowMenu label="Note actions" items={[
                                    { label: 'Edit', icon: Pencil, onClick: () => setPanel({ kind: 'activity', type: 'note', activity: a }) },
                                    { label: 'Delete', icon: Trash2, tone: 'danger', onClick: () => removeActivity(a) },
                                ]} />}
                            </div>
                        ))}
                    </div>
                )}
            </Section>
        </>
    );
}

function QuoteStatus({ status }) {
    const tone = { accepted: 'up', declined: 'down', rejected: 'down', sent: 'accent', viewed: 'accent', expired: 'warn' }[status] || 'neutral';
    const label = String(status || 'draft').replace(/_/g, ' ');
    return <Status tone={tone}>{label.charAt(0).toUpperCase() + label.slice(1)}</Status>;
}

/* ── Activity ─────────────────────────────────────────────────────────────── */

const KIND = {
    note: { icon: StickyNote, word: 'Note' },
    call: { icon: PhoneCall, word: 'Call' },
    email: { icon: Mail, word: 'Email' },
    meeting: { icon: Video, word: 'Meeting' },
    task: { icon: CheckSquare, word: 'Task' },
    event: { icon: Calendar, word: 'Event' },
    created: { icon: Sparkles, word: 'Created' },
    stage: { icon: Flag, word: 'Stage' },
    state: { icon: Flag, word: 'State' },
    quote: { icon: FileText, word: 'Quote' },
    project: { icon: FolderKanban, word: 'Project' },
};

function describe(a) {
    if (a.kind === 'stage') return `Stage moved from ${stageLabel(a.meta?.from)} to ${stageLabel(a.meta?.to)}`;
    if (a.kind === 'state') return `Marked ${stateOf(a.meta?.to).label}${a.meta?.from && a.meta.from !== 'open' ? ` (was ${stateOf(a.meta.from).label})` : ''}`;
    if (a.kind === 'created') return 'Deal created';
    if (a.kind === 'project') return 'Converted to a project';
    if (a.kind === 'task') return `Task: ${a.title}${a.done ? ' (done)' : ''}`;
    if (a.kind === 'event') return `Event: ${a.title}`;
    return a.title || KIND[a.kind]?.word || 'Activity';
}

function Activity({ deal, mine, editable, t }) {
    const toast = useToast();
    const [kind, setKind] = useState('note');
    const [body, setBody] = useState('');
    const [saving, setSaving] = useState(false);
    const [filter, setFilter] = useState('all');
    const list = mine
        .filter((a) => filter === 'all' || (filter === 'manual' ? !['created', 'stage', 'state', 'project'].includes(a.kind) : ['created', 'stage', 'state', 'project'].includes(a.kind)))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

    const add = async () => {
        if (!body.trim()) return;
        setSaving(true);
        try {
            await orgStore.addItem('crm_deal_activities', { deal_id: deal.id, kind, body: body.trim() });
            setBody('');
            toast(`${KIND[kind].word} logged`, 'success');
        } catch (e) { toast(e.message, 'error'); } finally { setSaving(false); }
    };

    return (
        <>
            {editable && (
                <div className="no-print" style={{ border: '1px solid ' + t.line, borderRadius: 12, padding: 12, marginBottom: 16 }}>
                    <Seg size="sm" value={kind} onChange={setKind} label="What to log"
                        options={[{ id: 'note', label: 'Note' }, { id: 'call', label: 'Call' }, { id: 'email', label: 'Email' }, { id: 'meeting', label: 'Meeting' }]} />
                    <div style={{ height: 8 }} />
                    <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} aria-label={`${KIND[kind].word} text`}
                        placeholder={kind === 'note' ? 'Add a note about this deal…' : `What happened on the ${KIND[kind].word.toLowerCase()}?`}
                        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } }} />
                    <div style={{ display: 'flex', alignItems: 'center', marginTop: 8, gap: 8 }}>
                        <Muted size={11.5}>Ctrl + Enter to save</Muted>
                        <div style={{ flex: 1 }} />
                        <Btn primary size="sm" onClick={add} disabled={saving || !body.trim()}>{saving ? 'Saving…' : `Log ${KIND[kind].word}`}</Btn>
                    </div>
                </div>
            )}
            <div style={{ marginBottom: 10 }}>
                <Seg size="sm" value={filter} onChange={setFilter} label="Show"
                    options={[{ id: 'all', label: 'Everything' }, { id: 'manual', label: 'Logged' }, { id: 'system', label: 'Changes' }]} />
            </div>
            {list.length === 0 ? <Empty>Nothing on the timeline yet.</Empty> : (
                <ol style={{ listStyle: 'none', margin: 0, padding: 0, position: 'relative' }}>
                    {list.map((a, i) => {
                        const K = KIND[a.kind] || KIND.note;
                        const sys = ['created', 'stage', 'state', 'project'].includes(a.kind);
                        return (
                            <li key={a.id} style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: 14 }}>
                                {i < list.length - 1 && <span aria-hidden="true" style={{ position: 'absolute', left: 13, top: 28, bottom: 0, width: 1, background: t.line }} />}
                                <span aria-hidden="true" style={{
                                    width: 27, height: 27, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
                                    background: sys ? t.panelAlt : t.accentSoft, color: sys ? t.dim : t.accent, border: '1px solid ' + t.line,
                                }}><K.icon size={13} /></span>
                                <div style={{ flex: 1, minWidth: 0, paddingTop: 3 }}>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: 12.5, fontWeight: sys ? 500 : 600, color: t.text }}>
                                            {sys || a.kind === 'task' || a.kind === 'event' ? describe(a) : K.word}
                                        </span>
                                        <span style={{ fontSize: 11.5, color: t.faint }}>{fmtWhen(a.created_at)}</span>
                                    </div>
                                    {a.body && <div style={{ fontSize: 12.5, color: t.dim, marginTop: 4, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{a.body}</div>}
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}
        </>
    );
}
