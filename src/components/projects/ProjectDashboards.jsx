import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
    IndianRupee, Wallet, Hourglass, TrendingUp, Receipt, FileSignature, FileText, Users, Gauge,
    ListChecks, AlertTriangle, Briefcase, HeartPulse, CircleDashed, Star,
} from 'lucide-react';
import { Page, Panel, Empty, Btn } from '../ui/edge';
import { MONO } from '../ui/edgeUtils';
import { useSection } from '../financial/financeHooks';
import { balanceOf } from '../../services/financeAnalytics';
import { categoryLabel } from '../../services/financeCategories';
import { memberActive, formatHealthReasons } from '../../services/projectAnalytics';
import { health as fetchHealth, isOwnerOrAdmin } from '../../services/projectService';
import { needsAttention } from '../../services/importantTasks';
import { projectDashboards } from './projectDashboardNav';
import { fmtShort, fmtInr, fmtDay, invoiceStateOf, INVOICE_STATES } from '../overview/overviewModel';
import { TipProvider, RankBars, SplitBar, EmptyNote } from '../overview/vizKit';
import { useViz, useWinW } from '../overview/vizHooks';
import { Card, Tile, Figure, More, TileRow, CardGrid, ListRow, DashStyle } from '../overview/dashKit';
import { useProjectBoardData } from './projectBoard';
import { describeActivity } from './activityText';
import ProjectActions from './ProjectActions';
import PageTabs from './PageTabs';
import { projectSectionPath } from './projectPaths';

/* ══════════════════════════════════════════════════════════════════════════
   One project's Dashboard — the company Dashboard's flow, for one project.
   It is its own set of pages, /projects/:id/dashboard/:view, switched between
   by the tabs at the top (PageTabs). Each page is a row of figures and a few cards, built from the
   same kit as the company dashboards, so they read the same way.
   ══════════════════════════════════════════════════════════════════════════ */

const RECORD_LABEL = { nda: 'NDA', mou: 'MoU', agreement: 'Agreement', offer: 'Offer letter', certificate: 'Certificate', role_change: 'Role change', termination: 'Termination' };
const FIN_LABEL = { quotation: 'Quotation', proforma: 'Proforma', invoice: 'Invoice' };
const HEALTH = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };
const n = (v) => Number(v) || 0;

/** /projects/:projectId/dashboard/:view */
export default function ProjectDashboardPage() {
    const { projectId, view } = useParams();
    const navigate = useNavigate();
    const projects = useSection('projects');
    const project = projects.find((p) => p.id === projectId);
    const page = projectDashboards().find((x) => x.id === view);

    if (!page) return <Navigate to={`/projects/${projectId}/dashboard/overview`} replace />;
    if (!project) {
        return (
            <Page>
                <div style={{ padding: 24 }}>
                    <Panel>
                        <Empty action={<Btn onClick={() => navigate('/projects')}>All projects</Btn>}>
                            This project does not exist, or you do not have access to it.
                        </Empty>
                    </Panel>
                </div>
            </Page>
        );
    }
    return <DashboardPage key={project.id} project={project} page={page} navigate={navigate} />;
}

function DashboardPage({ project, page, navigate }) {
    const viz = useViz();
    const { t } = viz;
    const winW = useWinW();
    const [health, setHealth] = useState(null);
    useEffect(() => {
        let cancelled = false;
        fetchHealth(project.id).then((h) => { if (!cancelled) setHealth(h); }).catch(() => {});
        return () => { cancelled = true; };
    }, [project.id, project.updated_at, project.status]);
    const board = useProjectBoardData(project, health);

    const cols = winW < 900 ? 1 : winW < 1320 ? 2 : 3;
    const tileCols = (max) => Math.min(max, winW < 620 ? 1 : winW < 1100 ? 2 : max);
    // A card's link opens that section of the project.
    const open = (tab) => navigate(projectSectionPath(project.id, tab));
    const ctx = { ...viz, board, open, navigate, cols, tileCols };
    const view = page.id;
    const pad = winW < 760 ? 12 : 24;
    const name = project.name || project.code || 'Project';

    return (
        <Page fill>
            <div className="edge-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', scrollbarGutter: 'stable' }}>
                <TipProvider>
                    <div className="ov-page" style={{ padding: pad, fontFamily: MONO, color: t.text, minWidth: 0 }}>
                        <div style={{ padding: '2px 2px 18px', display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                                fontSize: 13.5, fontWeight: 600, letterSpacing: '0.08em', marginBottom: 6,
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                                <Link to={`/projects/${project.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{name.toUpperCase()}</Link>
                            </div>
                            <h1 style={{
                                margin: 0, fontSize: winW < 760 ? 24 : 32, fontWeight: 700, letterSpacing: '-0.045em', lineHeight: 1.05,
                            }}>{page.title}</h1>
                          </div>
                          {view === 'overview' && <ProjectActions project={project} />}
                        </div>
                        <PageTabs label="Dashboard pages" current={view} pages={projectDashboards()}
                            onOpen={(id) => navigate(`/projects/${project.id}/dashboard/${id}`)} />
                        {view === 'overview' && <OverviewView {...ctx} />}
                        {view === 'finance' && <FinanceView {...ctx} />}
                        {view === 'sales' && <SalesView {...ctx} />}
                        {view === 'team' && <TeamView {...ctx} />}
                        {view === 'documents' && <DocumentsView {...ctx} />}
                        <DashStyle t={t} />
                    </div>
                </TipProvider>
            </div>
        </Page>
    );
}

/** The invoices allocated to this project, with their state today. */
function useProjectInvoices(project, today) {
    const allocations = useSection('project_allocations');
    const docs = useSection('fin_docs');
    return useMemo(() => {
        const ids = new Set(allocations
            .filter((a) => a.project_id === project.id && a.source_type === 'invoice')
            .map((a) => a.source_id));
        return docs.filter((d) => ids.has(d.id))
            .map((d) => ({ ...d, state: invoiceStateOf(d, today), balance: balanceOf(d) }))
            .sort((a, b) => String(b.issue_date || '').localeCompare(String(a.issue_date || '')));
    }, [allocations, docs, project.id, today]);
}

const Loading = () => <EmptyNote>Loading…</EmptyNote>;

/* ── overview ────────────────────────────────────────────────────────────── */

function OverviewView({ board, open, navigate, t, status, cols, tileCols }) {
    const { project, today, fin, f, tasks: tk } = board;
    const employees = useSection('employees');
    const personOf = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e.name])), [employees]);
    // Tasks an owner or admin marked important (0077), until done — late first.
    const attention = useMemo(() => needsAttention(tk.all, today), [tk.all, today]);
    const pct = board.progress == null ? null : Math.round(board.progress * 100);
    const h = board.health;
    const reasons = h ? formatHealthReasons(h.reasons || []) : [];
    const late = (m) => m.due_date && m.due_date < today;
    const to = (view) => () => navigate(`/projects/${project.id}/dashboard/${view}`);
    const { timePct } = board.burn;
    const end = project.target_end_date;
    const daysLeft = end ? Math.round((new Date(`${end}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000) : null;

    return (<>
        <TileRow cols={tileCols(fin ? 6 : 4)}>
            <Tile icon={CircleDashed} label="Progress" value={pct == null ? '—' : `${pct}%`}
                foot={pct == null ? 'no plan yet' : `${board.milestones.length} milestones · ${tk.all.length} tasks`} />
            <Tile icon={HeartPulse} label="Health" value={h && HEALTH[h.health] ? HEALTH[h.health] : '—'}
                tone={h?.health === 'off_track' ? 'down' : null}
                foot={reasons[0] || (h ? 'nothing flagged' : 'not checked yet')} />
            {fin && (
                <Tile icon={IndianRupee} label="Contract" value={f === undefined ? '…' : fmtShort(f?.contract_value ?? project.contract_value)}
                    foot={f?.billed_pct == null ? 'nothing billed yet' : `${f.billed_pct}% billed`} onClick={to('finance')} />
            )}
            {fin && (
                <Tile icon={TrendingUp} label="Net margin" value={f ? fmtShort(f.net_margin) : '—'} tone={n(f?.net_margin) < 0 ? 'down' : null}
                    foot={f?.net_margin_pct == null ? 'nothing invoiced yet' : `${f.net_margin_pct}% of revenue`} onClick={to('finance')} />
            )}
            <Tile icon={Users} label="People" value={String(board.team.length)} foot="on the project today" onClick={to('team')} />
            <Tile icon={ListChecks} label="Open tasks" value={String(tk.open.length)} tone={tk.overdue.length ? 'down' : null}
                foot={tk.overdue.length ? `${tk.overdue.length} overdue` : 'none overdue'} onClick={to('team')} />
        </TileRow>

        <CardGrid cols={cols}>
            <Card style={{ gridColumn: `span ${cols}` }} title="Needs attention"
                note="tasks marked important, until they are done · late first"
                right={<More label="Tasks" onClick={() => open('wbs')} />}>
                {attention.length === 0 ? (
                    <EmptyNote>{isOwnerOrAdmin()
                        ? 'Nothing marked important. Star a task on Tasks (WBS) to list it here.'
                        : 'Nothing marked important. An owner or admin chooses what goes here.'}</EmptyNote>
                ) : attention.slice(0, 10).map(({ task, late: isLate, due }) => (
                    <ListRow key={task.id}
                        label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
                            <Star size={12} fill="currentColor" aria-hidden="true" style={{ color: t.down, flexShrink: 0 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</span>
                        </span>}
                        sub={[personOf[task.assignedTo] || 'Unassigned', task.status === 'in-progress' ? 'in progress' : null].filter(Boolean).join(' · ')}
                        value={due ? `${isLate ? 'late · ' : ''}${fmtDay(due).slice(0, 6)}` : 'no date'} tone={isLate ? 'down' : null}
                        onClick={() => navigate(projectSectionPath(project.id, 'wbs', null, { task: task.id }))} />
                ))}
                {attention.length > 10 && (
                    <div style={{ fontSize: 11.5, color: t.faint, marginTop: 8 }}>and {attention.length - 10} more</div>
                )}
            </Card>

            <Card title="Schedule" note={end ? `due ${fmtDay(end)}` : 'no end date set'}>
                <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 14 }}>
                    <Figure big label={daysLeft != null && daysLeft < 0 ? 'days over' : 'days left'}
                        value={daysLeft == null ? '—' : String(Math.abs(daysLeft))} tone={daysLeft != null && daysLeft < 0 ? 'down' : null} />
                    <Figure big label="time gone" value={timePct == null ? '—' : `${Math.round(timePct)}%`} />
                    <Figure big label="done" value={pct == null ? '—' : `${pct}%`} />
                </div>
                {timePct != null && pct != null && (
                    <div style={{ fontSize: 12, color: pct + 10 < timePct ? status.critical : t.faint }}>
                        {pct + 10 < timePct ? 'The work is behind the calendar.' : 'The work is keeping up with the calendar.'}
                    </div>
                )}
            </Card>

            <Card title="Milestones" note="what is due next" right={<More label="Milestones" onClick={() => open('milestones')} />}>
                {board.upcoming.length ? board.upcoming.slice(0, 5).map((m) => (
                    <ListRow key={m.id} label={m.title} value={m.due_date ? (late(m) ? 'Late' : fmtDay(m.due_date)) : 'No date'}
                        tone={late(m) ? 'down' : null} onClick={() => open('milestones')} />
                )) : <EmptyNote>Nothing due.</EmptyNote>}
            </Card>

            <Card title="Recent activity" note="the latest changes" right={<More label="Activity" onClick={() => open('activity')} />}>
                {board.recent === null ? <Loading /> : board.recent.length ? board.recent.slice(0, 6).map((a) => (
                    <ListRow key={a.id} label={describeActivity(a)} value={fmtDay(a.created_at)} onClick={() => open('activity')} />
                )) : <EmptyNote>Nothing yet.</EmptyNote>}
            </Card>

            {h && reasons.length > 0 && (
                <Card title="Why it is flagged" note={HEALTH[h.health]}>
                    {reasons.map((r) => <ListRow key={r} label={r} />)}
                </Card>
            )}

            <Card title="Documents" note="linked to this project" right={<More label="Documents" onClick={to('documents')} />}>
                <Figure big label="linked documents" value={String(board.docs)} />
            </Card>
        </CardGrid>
    </>);
}

/* ── finance ─────────────────────────────────────────────────────────────── */

function FinanceView({ board, open, t, cat, status, cols, tileCols }) {
    const f = board.f;
    if (f === undefined) return <Loading />;
    if (!f) return <EmptyNote>No figures for this project yet.</EmptyNote>;

    const contract = n(f.contract_value ?? board.project.contract_value);
    const invoiced = n(f.revenue_invoiced);
    const collected = n(f.revenue_collected);
    const unbilled = n(f.unbilled_value);
    const net = n(f.net_margin);
    const cats = Object.entries(f.costs_by_category || {})
        .map(([k, v]) => ({ key: k, name: categoryLabel(k), value: n(v) }))
        .sort((a, b) => b.value - a.value);
    const { timePct, burnPct } = board.burn;
    const burnAhead = timePct != null && burnPct != null && burnPct - timePct > 10;

    return (<>
        <TileRow cols={tileCols(5)}>
            <Tile icon={IndianRupee} label="Contract" value={fmtShort(contract)} exact={fmtInr(contract)}
                foot={f.billed_pct == null ? 'nothing billed yet' : `${f.billed_pct}% billed`} />
            <Tile icon={Receipt} label="Invoiced" value={fmtShort(invoiced)} exact={fmtInr(invoiced)} foot="before GST" />
            <Tile icon={Wallet} label="Collected" value={fmtShort(collected)} exact={fmtInr(collected)} foot="paid by the client" />
            <Tile icon={Hourglass} label="Outstanding" value={fmtShort(f.outstanding_receivable)} exact={fmtInr(f.outstanding_receivable)}
                tone={n(f.overdue_receivable) > 0 ? 'down' : null}
                foot={n(f.overdue_receivable) > 0 ? `${fmtShort(f.overdue_receivable)} overdue` : 'nothing overdue'} />
            <Tile icon={TrendingUp} label="Net margin" value={fmtShort(net)} exact={fmtInr(net)} tone={net < 0 ? 'down' : null}
                foot={f.net_margin_pct == null ? 'nothing invoiced yet' : `${f.net_margin_pct}% of revenue`} />
        </TileRow>

        <CardGrid cols={cols}>
            <Card title="Contract" note="how much of it is billed and paid" right={<More label="Finance" onClick={() => open('finance')} />}>
                {contract > 0 ? (
                    <SplitBar format={fmtShort} unit="Amount" parts={[
                        { id: 'collected', label: 'Collected', value: collected, color: cat[2] },
                        { id: 'awaiting', label: 'Invoiced, not paid', value: Math.max(0, invoiced - collected), color: cat[3] },
                        { id: 'unbilled', label: 'Not billed yet', value: unbilled, color: t.faint },
                    ]} />
                ) : <EmptyNote>No contract value set.</EmptyNote>}
            </Card>

            <Card title="Profit" note="what came in, less what it cost">
                <ListRow label="Invoiced revenue" value={fmtShort(invoiced)} />
                <ListRow label="Other income" value={fmtShort(f.other_income)} />
                <ListRow label="Vendor bills" value={`-${fmtShort(f.vendor_costs)}`} />
                <ListRow label="Expenses" value={`-${fmtShort(f.expense_costs)}`} />
                <ListRow label="Labour" sub="pay × time on the project" value={`-${fmtShort(f.labour_cost)}`} />
                <ListRow label="Net margin" value={fmtShort(net)} tone={net < 0 ? 'down' : 'up'} />
            </Card>

            <Card title="Budget" note={f.budget_total ? `${fmtShort(f.budget_total)} budget` : 'no budget set'}>
                <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 14 }}>
                    <Figure big label="budget used" value={burnPct == null ? '—' : `${Math.round(burnPct)}%`} tone={burnAhead ? 'down' : null} />
                    <Figure big label="time gone" value={timePct == null ? '—' : `${Math.round(timePct)}%`} />
                </div>
                <div style={{ fontSize: 12, color: burnAhead ? status.critical : t.faint, marginBottom: 12 }}>
                    {burnAhead ? 'Spending is running ahead of the schedule.' : burnPct == null ? 'Set a budget to track spending.' : 'Spending is in step with the schedule.'}
                </div>
                <div style={{ fontSize: 10.5, letterSpacing: '0.1em', color: t.faint, marginBottom: 4 }}>COSTS BY CATEGORY</div>
                <RankBars rows={cats} format={fmtShort} color={cat[1]} max={4} empty="No costs yet" />
            </Card>
        </CardGrid>
    </>);
}

/* ── sales ───────────────────────────────────────────────────────────────── */

function SalesView({ board, open, navigate, t, status, cols, tileCols }) {
    const { project, today } = board;
    const invoices = useProjectInvoices(project, today);
    const links = useSection('project_documents');
    const docs = useSection('fin_docs');
    const clients = useSection('customers');
    const projects = useSection('projects');

    const quotes = useMemo(() => {
        const byId = Object.fromEntries(docs.map((d) => [d.id, d]));
        return links
            .filter((l) => l.project_id === project.id && l.financial_document_id)
            .map((l) => byId[l.financial_document_id])
            .filter((d) => d && (d.type === 'quotation' || d.type === 'proforma'));
    }, [links, docs, project.id]);

    const client = clients.find((c) => c.id === project.client_id);
    const clientTotal = useMemo(() => (project.client_id
        ? docs.filter((d) => d.type === 'invoice' && d.customer_id === project.client_id && d.status !== 'cancelled' && d.status !== 'draft')
            .reduce((s, d) => s + n(d.grand_total), 0)
        : 0), [docs, project.client_id]);
    const sibling = projects.filter((p) => p.client_id && p.client_id === project.client_id && p.id !== project.id);

    const raised = invoices.reduce((s, d) => s + n(d.grand_total), 0);
    const owed = invoices.reduce((s, d) => s + d.balance, 0);
    const late = invoices.filter((d) => d.state === 'overdue');
    const stateColor = { paid: status.good, partial: status.warning, awaiting: t.faint, overdue: status.critical };
    const stateLabel = Object.fromEntries(INVOICE_STATES.map((s) => [s.id, s.label]));
    const quoteValue = quotes.reduce((s, d) => s + n(d.grand_total), 0);

    return (<>
        <TileRow cols={tileCols(4)}>
            <Tile icon={Briefcase} label="Deal value" value={fmtShort(project.contract_value)} exact={fmtInr(project.contract_value)}
                foot={project.billing_type ? project.billing_type.replace(/_/g, ' ') : 'contract'} />
            <Tile icon={FileSignature} label="Quotations" value={String(quotes.length)} foot={quotes.length ? `${fmtShort(quoteValue)} quoted` : 'none linked'} />
            <Tile icon={Receipt} label="Invoices" value={String(invoices.length)} foot={`${fmtShort(raised)} raised`} />
            <Tile icon={AlertTriangle} label="Awaiting" value={fmtShort(owed)} exact={fmtInr(owed)} tone={late.length ? 'down' : null}
                foot={late.length ? `${late.length} overdue` : 'nothing overdue'} />
        </TileRow>

        <CardGrid cols={cols}>
            <Card title="Invoices" note="raised on this project, newest first" right={<More label="Finance" onClick={() => open('finance')} />}>
                {invoices.length ? invoices.slice(0, 6).map((d) => (
                    <ListRow key={d.id} label={`${d.doc_number || d.invoiceNumber || 'Invoice'}`}
                        sub={`${fmtDay(d.issue_date)} · ${stateLabel[d.state]}`}
                        value={fmtShort(d.grand_total)} tone={d.state === 'overdue' ? 'down' : null}
                        onClick={() => navigate('/billing/invoices')} />
                )) : <EmptyNote>No invoices linked yet.</EmptyNote>}
                {invoices.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                        <SplitBar format={fmtShort} unit="Invoiced" parts={INVOICE_STATES.map((s) => ({
                            id: s.id, label: s.label, color: stateColor[s.id],
                            value: invoices.filter((d) => d.state === s.id).reduce((a, d) => a + n(d.grand_total), 0),
                        })).filter((p) => p.value > 0)} />
                    </div>
                )}
            </Card>

            <Card title="Quotations" note="quotations and proformas linked to it" right={<More label="Documents" onClick={() => open('documents')} />}>
                {quotes.length ? quotes.map((d) => (
                    <ListRow key={d.id} label={`${FIN_LABEL[d.type]} · ${d.doc_number || d.invoiceNumber || ''}`}
                        sub={`${fmtDay(d.issue_date)} · ${(d.status || '').replace(/_/g, ' ')}`}
                        value={fmtShort(d.grand_total)}
                        onClick={() => navigate(d.type === 'quotation' ? `/billing/quotations/${d.id}/edit` : '/billing/proforma')} />
                )) : <EmptyNote>No quotation linked. Link the one this project came from on Documents.</EmptyNote>}
            </Card>

            <Card title="Client" note={client ? 'everything you do with them' : 'internal project'}>
                {client ? (<>
                    <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.03em', marginBottom: 12 }}>{client.name || client.clientName}</div>
                    <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 12 }}>
                        <Figure big label="invoiced, all work" value={fmtShort(clientTotal)} />
                        <Figure big label="other projects" value={String(sibling.length)} />
                    </div>
                    {sibling.slice(0, 4).map((p) => (
                        <ListRow key={p.id} label={p.name || p.code} sub={p.code} onClick={() => navigate(`/projects/${p.id}`)} />
                    ))}
                    <div style={{ marginTop: 10 }}><More label="Client" to={`/client-directory?client=${client.id}`} /></div>
                </>) : <EmptyNote>This project has no client, so there is nothing to sell.</EmptyNote>}
            </Card>
        </CardGrid>
    </>);
}

/* ── team ────────────────────────────────────────────────────────────────── */

function TeamView({ board, open, cat, cols, tileCols }) {
    const { project, today } = board;
    const members = useSection('project_members');
    const employees = useSection('employees');

    const nameOf = useMemo(() => {
        const m = Object.fromEntries(employees.map((e) => [e.id, e.name]));
        return (id) => m[id] || 'Unassigned';
    }, [employees]);
    const team = useMemo(() => members
        .filter((m) => m.project_id === project.id && memberActive(m, today))
        .map((m) => ({ key: m.id, name: nameOf(m.employee_id), role: m.role, value: n(m.allocation_pct) }))
        .sort((a, b) => b.value - a.value), [members, project.id, today, nameOf]);

    const tk = board.tasks;
    const load = useMemo(() => {
        const m = new Map();
        tk.open.forEach((x) => {
            const k = x.assignedTo || 'none';
            const cur = m.get(k) || { key: k, name: x.assignedTo ? nameOf(x.assignedTo) : 'Unassigned', value: 0, late: 0 };
            cur.value += 1;
            if (tk.overdue.includes(x)) cur.late += 1;
            m.set(k, cur);
        });
        return [...m.values()].sort((a, b) => b.value - a.value);
    }, [tk, nameOf]);
    const total = team.reduce((s, m) => s + m.value, 0);

    return (<>
        <TileRow cols={tileCols(4)}>
            <Tile icon={Users} label="People" value={String(team.length)} foot={team.length ? `${team.filter((m) => m.role === 'manager').length} managing` : 'nobody yet'} />
            <Tile icon={Gauge} label="Allocated" value={`${Math.round(total)}%`} foot="sum of everyone's share" />
            <Tile icon={ListChecks} label="Open tasks" value={String(tk.open.length)} foot={`${tk.all.length - tk.open.length} done`} />
            <Tile icon={AlertTriangle} label="Overdue" value={String(tk.overdue.length)} tone={tk.overdue.length ? 'down' : null}
                foot={tk.overdue.length ? 'past their deadline' : 'all on time'} />
        </TileRow>

        <CardGrid cols={cols}>
            <Card title="Who is on it" note="share of their time on this project" right={<More label="Team" onClick={() => open('team')} />}>
                <RankBars rows={team} format={(v) => `${Math.round(v)}%`} color={cat[0]} total={0} max={8}
                    sub={(r) => r.role} empty="No one on the project yet" />
            </Card>

            <Card title="Open work" note="open tasks by person" right={<More label="Tasks" onClick={() => open('tasks')} />}>
                <RankBars rows={load} format={(v) => String(v)} color={cat[2]} max={8}
                    sub={(r) => (r.late ? `${r.late} late` : '')} empty="No open tasks" />
            </Card>

            <Card title="Due next" note="the next deadlines">
                {tk.next.length ? tk.next.slice(0, 6).map((x) => (
                    <ListRow key={x.id} label={x.title} sub={nameOf(x.assignedTo)}
                        value={fmtDay(x.deadline)} tone={x.deadline < today ? 'down' : null} onClick={() => open('tasks')} />
                )) : <EmptyNote>Nothing scheduled.</EmptyNote>}
            </Card>
        </CardGrid>
    </>);
}

/* ── documents ───────────────────────────────────────────────────────────── */

function DocumentsView({ board, open, navigate, cat, cols, tileCols }) {
    const { project, today, fin } = board;
    const links = useSection('project_documents');
    const records = useSection('records');
    const docs = useSection('fin_docs');
    const invoices = useProjectInvoices(project, today);

    const items = useMemo(() => {
        const rec = Object.fromEntries(records.map((r) => [r.id, r]));
        const fd = Object.fromEntries(docs.map((d) => [d.id, d]));
        const linked = links.filter((l) => l.project_id === project.id).map((l) => {
            const r = l.record_id ? rec[l.record_id] : null;
            const d = l.financial_document_id ? fd[l.financial_document_id] : null;
            if (r) return { id: l.id, group: 'agreements', type: RECORD_LABEL[r.type] || r.type, title: r.title || r.doc_number, date: r.issue_date, to: '/records' };
            if (d) return { id: l.id, group: 'sales', type: FIN_LABEL[d.type] || 'Document', title: d.doc_number || d.invoiceNumber, date: d.issue_date, to: d.type === 'quotation' ? `/billing/quotations/${d.id}/edit` : '/billing/proforma' };
            return null;
        }).filter(Boolean);
        const inv = fin ? invoices.map((d) => ({ id: `inv:${d.id}`, group: 'invoices', type: 'Invoice', title: d.doc_number || d.invoiceNumber, date: d.issue_date, to: '/billing/invoices' })) : [];
        return [...linked, ...inv].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    }, [links, records, docs, invoices, project.id, fin]);

    const count = (g) => items.filter((x) => x.group === g).length;
    const byType = useMemo(() => {
        const m = new Map();
        items.forEach((x) => m.set(x.type, (m.get(x.type) || 0) + 1));
        return [...m.entries()].map(([k, v]) => ({ key: k, name: k, value: v })).sort((a, b) => b.value - a.value);
    }, [items]);

    return (<>
        <TileRow cols={tileCols(4)}>
            <Tile icon={FileText} label="All documents" value={String(items.length)} foot="linked to this project" />
            <Tile icon={FileSignature} label="Agreements" value={String(count('agreements'))} foot="NDAs, MoUs, offers" />
            <Tile icon={Briefcase} label="Quotations" value={String(count('sales'))} foot="quotations and proformas" />
            <Tile icon={Receipt} label="Invoices" value={fin ? String(count('invoices')) : '—'} foot={fin ? 'raised on this project' : 'needs Project financials'} />
        </TileRow>

        <CardGrid cols={cols}>
            <Card style={{ gridColumn: `span ${Math.min(2, cols)}` }} title="Latest" note="newest first"
                right={<More label="Documents" onClick={() => open('documents')} />}>
                {items.length ? items.slice(0, 8).map((x) => (
                    <ListRow key={x.id} label={x.title || x.type} sub={x.type} value={fmtDay(x.date)} onClick={() => navigate(x.to)} />
                )) : <EmptyNote>Nothing linked yet. Link the NDA, MoU or quotation on Documents.</EmptyNote>}
            </Card>

            <Card title="By type" note="what the paperwork is">
                <RankBars rows={byType} format={(v) => String(v)} color={cat[0]} max={8} empty="No documents yet" />
            </Card>
        </CardGrid>
    </>);
}
