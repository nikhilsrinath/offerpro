import React, { useMemo, useState } from 'react';
import {
    IndianRupee, Wallet, Hourglass, TrendingUp, Users, Gauge, ListChecks, AlertTriangle, HeartPulse,
    CircleDashed, Star, CalendarRange, Flag, History, FileText, UserCheck, PieChart, Plus, Check,
} from 'lucide-react';
import { Btn, Modal, Seg } from '../ui/edge';
import { useOrg } from '../../context/OrgContext';
import { categoryLabel } from '../../services/financeCategories';
import { formatHealthReasons } from '../../services/projectAnalytics';
import { isOwnerOrAdmin } from '../../services/projectService';
import { needsAttention } from '../../services/importantTasks';
import { fmtShort, fmtInr, fmtDay } from '../overview/overviewModel';
import { RankBars, SplitBar, EmptyNote } from '../overview/vizKit';
import { Card, Tile, Figure, FigureRow, SubLabel, More, TileRow, CardGrid, ListRow, ArrangeBar } from '../overview/dashKit';
import { useWidgetLayout } from '../hub/useWidgetLayout';
import { describeActivity } from './activityText';
import { projectSectionPath } from './projectPaths';
import { projectRef } from './projectSlug';

/* ══════════════════════════════════════════════════════════════════════════
   A project's Overview: the page a project opens on. It is built from the
   same tiles and cards as the other dashboard pages, but which ones show is
   the person's choice: Add Widget lists every figure and card, each switched
   on or off, and a card made normal or full width. Arrange (dashKit) puts
   them in the order they read them.

   One choice per person and org, shared by every project, the way the hub's
   board is (useWidgetLayout). Money widgets need Project financials; without
   it they are not offered at all.
   ══════════════════════════════════════════════════════════════════════════ */

const HEALTH = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };
const n = (v) => Number(v) || 0;
const daysTo = (end, today) => (end ? Math.round((new Date(`${end}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000) : null);
const Loading = () => <EmptyNote>Loading…</EmptyNote>;

/* ── figures ─────────────────────────────────────────────────────────────── */

/* A tile widget returns what its <Tile> shows. `to` is the dashboard page or
   project section a tap opens. */
const TILES = [
    {
        id: 'progress', title: 'Progress', icon: CircleDashed, desc: 'How much of the plan is done',
        tile: ({ board }) => {
            const pct = board.progress == null ? null : Math.round(board.progress * 100);
            return { value: pct == null ? '-' : `${pct}%`, foot: pct == null ? 'no plan yet' : `${board.milestones.length} milestones · ${board.tasks.all.length} tasks` };
        },
    },
    {
        id: 'health', title: 'Health', icon: HeartPulse, desc: 'On track, at risk or off track',
        tile: ({ board }) => {
            const h = board.health;
            const reasons = h ? formatHealthReasons(h.reasons || []) : [];
            return {
                value: h && HEALTH[h.health] ? HEALTH[h.health] : '-', tone: h?.health === 'off_track' ? 'down' : null,
                foot: reasons[0] || (h ? 'nothing flagged' : 'not checked yet'),
            };
        },
    },
    {
        id: 'contract', title: 'Contract', icon: IndianRupee, fin: true, to: 'dashboard:finance', desc: 'Contract value, and how much is billed',
        tile: ({ board: { f, project } }) => ({
            value: f === undefined ? '…' : fmtShort(f?.contract_value ?? project.contract_value),
            foot: f?.billed_pct == null ? 'nothing billed yet' : `${f.billed_pct}% billed`,
        }),
    },
    {
        id: 'margin', title: 'Net margin', icon: TrendingUp, fin: true, to: 'dashboard:finance', desc: 'Collected less everything spent on it',
        tile: ({ board: { f } }) => ({
            value: f ? fmtShort(f.net_margin) : '-', tone: n(f?.net_margin) < 0 ? 'down' : null,
            foot: f?.net_margin_pct == null ? 'nothing invoiced yet' : `${f.net_margin_pct}% of revenue`,
        }),
    },
    {
        id: 'people', title: 'People', icon: Users, to: 'dashboard:team', desc: 'Who is on the project today',
        tile: ({ board }) => ({ value: String(board.team.length), foot: 'on the project today' }),
    },
    {
        id: 'open_tasks', title: 'Open tasks', icon: ListChecks, to: 'dashboard:team', desc: 'Tasks not done yet, and how many are late',
        tile: ({ board: { tasks: tk } }) => ({
            value: String(tk.open.length), tone: tk.overdue.length ? 'down' : null,
            foot: tk.overdue.length ? `${tk.overdue.length} overdue` : 'none overdue',
        }),
    },
    // Available from Add Widget.
    {
        id: 'collected', title: 'Collected', icon: Wallet, fin: true, to: 'dashboard:finance', desc: 'What the client has paid so far',
        tile: ({ board: { f } }) => ({ value: f ? fmtShort(f.revenue_collected) : '-', exact: f ? fmtInr(f.revenue_collected) : undefined, foot: 'paid by the client' }),
    },
    {
        id: 'outstanding', title: 'Outstanding', icon: Hourglass, fin: true, to: 'dashboard:finance', desc: 'What the client still owes, and what is overdue',
        tile: ({ board: { f } }) => ({
            value: f ? fmtShort(f.outstanding_receivable) : '-', tone: n(f?.overdue_receivable) > 0 ? 'down' : null,
            foot: n(f?.overdue_receivable) > 0 ? `${fmtShort(f.overdue_receivable)} overdue` : 'nothing overdue',
        }),
    },
    {
        id: 'days_left', title: 'Days left', icon: CalendarRange, desc: 'Days to the target end date',
        tile: ({ board: { project, today } }) => {
            const d = daysTo(project.target_end_date, today);
            return {
                value: d == null ? '-' : String(Math.abs(d)), tone: d != null && d < 0 ? 'down' : null,
                foot: d == null ? 'no end date set' : d < 0 ? 'days past the end date' : `to ${fmtDay(project.target_end_date)}`,
            };
        },
    },
    {
        id: 'overdue', title: 'Overdue tasks', icon: AlertTriangle, to: 'dashboard:team', desc: 'Open tasks past their deadline',
        tile: ({ board: { tasks: tk } }) => ({
            value: String(tk.overdue.length), tone: tk.overdue.length ? 'down' : null,
            foot: tk.overdue.length ? 'past their deadline' : 'all on time',
        }),
    },
    {
        id: 'allocated', title: 'Allocated', icon: Gauge, to: 'dashboard:team', desc: "The sum of everyone's share of time on it",
        tile: ({ board }) => ({ value: `${Math.round(board.team.reduce((s, m) => s + m.pct, 0))}%`, foot: "sum of everyone's share" }),
    },
];

/* ── cards ───────────────────────────────────────────────────────────────── */

function AttentionCard({ board, navigate, t }) {
    const attention = useMemo(() => needsAttention(board.tasks.all, board.today), [board.tasks.all, board.today]);
    if (!attention.length) {
        return (
            <EmptyNote>{isOwnerOrAdmin()
                ? 'Nothing marked important. Star a task on Tasks (WBS) to list it here.'
                : 'Nothing marked important. An owner or admin chooses what goes here.'}</EmptyNote>
        );
    }
    return (<>
        {attention.slice(0, 10).map(({ task, late, due }) => (
            <ListRow key={task.id}
                label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
                    <Star size={12} fill="currentColor" aria-hidden="true" style={{ color: t.down, flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</span>
                </span>}
                sub={[task.assignedTo ? board.personName(task.assignedTo) : 'Unassigned', task.status === 'in-progress' ? 'in progress' : null].filter(Boolean).join(' · ')}
                value={due ? `${late ? 'late · ' : ''}${fmtDay(due).slice(0, 6)}` : 'no date'} tone={late ? 'down' : null}
                onClick={() => navigate(projectSectionPath(board.project.id, 'wbs', null, { task: task.id }))} />
        ))}
        {attention.length > 10 && <div style={{ fontSize: 11.5, color: t.faint, marginTop: 8 }}>and {attention.length - 10} more</div>}
    </>);
}

function ScheduleCard({ board, t, status }) {
    const { project, today } = board;
    const pct = board.progress == null ? null : Math.round(board.progress * 100);
    const { timePct } = board.burn;
    const d = daysTo(project.target_end_date, today);
    return (<>
        <FigureRow>
            <Figure big label={d != null && d < 0 ? 'days over' : 'days left'} value={d == null ? '-' : String(Math.abs(d))} tone={d != null && d < 0 ? 'down' : null} />
            <Figure big label="time gone" value={timePct == null ? '-' : `${Math.round(timePct)}%`} />
            <Figure big label="done" value={pct == null ? '-' : `${pct}%`} />
        </FigureRow>
        {timePct != null && pct != null && (
            <div style={{ fontSize: 12, color: pct + 10 < timePct ? status.critical : t.faint }}>
                {pct + 10 < timePct ? 'The work is behind the calendar.' : 'The work is keeping up with the calendar.'}
            </div>
        )}
    </>);
}

function TeamCard({ board, cat }) {
    const rows = board.team.map((m) => ({ key: m.id, name: m.name, role: m.role, value: m.pct }));
    return <RankBars rows={rows} format={(v) => `${Math.round(v)}%`} color={cat[0]} total={0} max={8} sub={(r) => r.role} empty="No one on the project yet" />;
}

function WorkloadCard({ board, cat }) {
    const tk = board.tasks;
    const rows = useMemo(() => {
        const late = new Set(tk.overdue.map((x) => x.id));
        const m = new Map();
        tk.open.forEach((x) => {
            const k = x.assignedTo || 'none';
            const cur = m.get(k) || { key: k, name: x.assignedTo ? board.personName(x.assignedTo) : 'Unassigned', value: 0, late: 0 };
            cur.value += 1;
            if (late.has(x.id)) cur.late += 1;
            m.set(k, cur);
        });
        return [...m.values()].sort((a, b) => b.value - a.value);
    }, [tk, board]);
    return <RankBars rows={rows} format={(v) => String(v)} color={cat[2]} max={8} sub={(r) => (r.late ? `${r.late} late` : '')} empty="No open tasks" />;
}

function ContractCard({ board, cat, t }) {
    const f = board.f;
    if (f === undefined) return <Loading />;
    const contract = n(f?.contract_value ?? board.project.contract_value);
    if (!contract) return <EmptyNote>No contract value set.</EmptyNote>;
    const invoiced = n(f?.revenue_invoiced);
    const collected = n(f?.revenue_collected);
    return (
        <SplitBar donut center={{ value: fmtShort(contract), label: 'Contract' }} format={fmtShort} unit="Amount" parts={[
            { id: 'collected', label: 'Collected', value: collected, color: cat[2] },
            { id: 'awaiting', label: 'Invoiced, not paid', value: Math.max(0, invoiced - collected), color: cat[3] },
            { id: 'unbilled', label: 'Not billed yet', value: n(f?.unbilled_value), color: t.faint },
        ]} />
    );
}

function ProfitCard({ board }) {
    const f = board.f;
    if (f === undefined) return <Loading />;
    if (!f) return <EmptyNote>No figures for this project yet.</EmptyNote>;
    const net = n(f.net_margin);
    return (<>
        <ListRow label="Invoiced revenue" value={fmtShort(f.revenue_invoiced)} />
        <ListRow label="Other income" value={fmtShort(f.other_income)} />
        <ListRow label="Vendor bills" value={`-${fmtShort(f.vendor_costs)}`} />
        <ListRow label="Expenses" value={`-${fmtShort(f.expense_costs)}`} />
        <ListRow label="Labour" sub="pay × time on the project" value={`-${fmtShort(f.labour_cost)}`} />
        <ListRow label="Net margin" value={fmtShort(net)} tone={net < 0 ? 'down' : 'up'} />
    </>);
}

function BudgetCard({ board, cat, t, status }) {
    const f = board.f;
    if (f === undefined) return <Loading />;
    const { timePct, burnPct } = board.burn;
    const ahead = timePct != null && burnPct != null && burnPct - timePct > 10;
    const cats = Object.entries(f?.costs_by_category || {})
        .map(([k, v]) => ({ key: k, name: categoryLabel(k), value: n(v) }))
        .sort((a, b) => b.value - a.value);
    return (<>
        <FigureRow>
            <Figure big label="budget used" value={burnPct == null ? '-' : `${Math.round(burnPct)}%`} tone={ahead ? 'down' : null} />
            <Figure big label="time gone" value={timePct == null ? '-' : `${Math.round(timePct)}%`} />
        </FigureRow>
        <div style={{ fontSize: 12, color: ahead ? status.critical : t.faint, marginBottom: 12 }}>
            {ahead ? 'Spending is running ahead of the schedule.' : burnPct == null ? 'Set a budget to track spending.' : 'Spending is in step with the schedule.'}
        </div>
        <SubLabel>Costs by category</SubLabel>
        <RankBars rows={cats} format={fmtShort} color={cat[1]} max={4} empty="No costs yet" />
    </>);
}

/* A card widget: its note, its link (`more`: [label, project section or
   dashboard page]) and its body. */
const CARDS = [
    {
        id: 'attention', title: 'Needs attention', icon: Star, size: 'lg', desc: 'Tasks marked important, until they are done',
        note: 'tasks marked important, until they are done · late first', more: ['Tasks', 'wbs'], body: AttentionCard,
    },
    {
        id: 'schedule', title: 'Schedule', icon: CalendarRange, desc: 'Days left, time gone and work done',
        note: ({ board }) => (board.project.target_end_date ? `due ${fmtDay(board.project.target_end_date)}` : 'no end date set'), body: ScheduleCard,
    },
    {
        id: 'milestones', title: 'Milestones', icon: Flag, desc: 'What is due next, and what is late', note: 'what is due next', more: ['Milestones', 'milestones'],
        body: ({ board, open }) => {
            const late = (m) => m.due_date && m.due_date < board.today;
            return board.upcoming.length ? board.upcoming.slice(0, 5).map((m) => (
                <ListRow key={m.id} label={m.title} value={m.due_date ? (late(m) ? 'Late' : fmtDay(m.due_date)) : 'No date'}
                    tone={late(m) ? 'down' : null} onClick={() => open('milestones')} />
            )) : <EmptyNote>Nothing due.</EmptyNote>;
        },
    },
    {
        id: 'activity', title: 'Recent activity', icon: History, desc: 'The latest changes to the project', note: 'the latest changes', more: ['Activity', 'activity'],
        body: ({ board, open }) => (board.recent === null ? <Loading /> : board.recent.length ? board.recent.slice(0, 6).map((a) => (
            <ListRow key={a.id} label={describeActivity(a)} value={fmtDay(a.created_at)} onClick={() => open('activity')} />
        )) : <EmptyNote>Nothing yet.</EmptyNote>),
    },
    {
        id: 'flagged', title: 'Why it is flagged', icon: HeartPulse, desc: 'The reasons behind the health check',
        note: ({ board }) => (board.health && HEALTH[board.health.health]) || 'health check',
        body: ({ board }) => {
            const reasons = board.health ? formatHealthReasons(board.health.reasons || []) : [];
            return reasons.length ? reasons.map((r) => <ListRow key={r} label={r} />) : <EmptyNote>{board.health ? 'Nothing flagged.' : 'Not checked yet.'}</EmptyNote>;
        },
    },
    {
        id: 'documents', title: 'Documents', icon: FileText, desc: 'How many documents are linked to it', note: 'linked to this project', more: ['Documents', 'dashboard:documents'],
        body: ({ board }) => <Figure big label="linked documents" value={String(board.docs)} />,
    },
    // Available from Add Widget.
    {
        id: 'team', title: 'Who is on it', icon: Users, desc: 'Each person and their share of time on it',
        note: 'share of their time on this project', more: ['Team', 'team'], body: TeamCard,
    },
    {
        id: 'workload', title: 'Open work', icon: UserCheck, desc: 'Open tasks by the person they are assigned to',
        note: 'open tasks by person', more: ['Tasks', 'tasks'], body: WorkloadCard,
    },
    {
        id: 'due_next', title: 'Due next', icon: ListChecks, desc: 'The next task deadlines', note: 'the next deadlines', more: ['Tasks', 'tasks'],
        body: ({ board, open }) => (board.tasks.next.length ? board.tasks.next.slice(0, 6).map((x) => (
            <ListRow key={x.id} label={x.title} sub={x.assignedTo ? board.personName(x.assignedTo) : 'Unassigned'}
                value={fmtDay(x.deadline)} tone={x.deadline < board.today ? 'down' : null} onClick={() => open('tasks')} />
        )) : <EmptyNote>Nothing scheduled.</EmptyNote>),
    },
    {
        id: 'contract_split', title: 'Contract split', icon: PieChart, fin: true, desc: 'How much of the contract is billed and paid',
        note: 'how much of it is billed and paid', more: ['Finance', 'finance'], body: ContractCard,
    },
    { id: 'profit', title: 'Profit', icon: TrendingUp, fin: true, desc: 'What came in, less what it cost', note: 'what came in, less what it cost', more: ['Finance', 'finance'], body: ProfitCard },
    {
        id: 'budget', title: 'Budget', icon: Gauge, fin: true, desc: 'Budget used against time, and costs by category',
        note: ({ board }) => (board.f?.budget_total ? `${fmtShort(board.f.budget_total)} budget` : 'no budget set'), body: BudgetCard,
    },
];

const ALL = [
    ...TILES.map((w) => ({ ...w, kind: 'tile', size: 'sm', sizes: ['sm'] })),
    ...CARDS.map((w) => ({ ...w, kind: 'card', size: w.size || 'md', sizes: ['md', 'lg'] })),
];
const BY_ID = new Map(ALL.map((w) => [w.id, w]));
const DEFAULTS = ['progress', 'health', 'contract', 'margin', 'people', 'open_tasks', 'attention', 'schedule', 'milestones', 'activity', 'flagged', 'documents']
    .map((id) => ({ id, size: BY_ID.get(id).size }));
const CATALOG = { key: 'edgeos.project.overview.v1', byId: BY_ID, defaults: DEFAULTS };

/* ── the page ────────────────────────────────────────────────────────────── */

/**
 * The Overview's tabs row (with Add Widget and Arrange beside the tabs) and
 * its tiles and cards. `tabs` is the dashboard's page switcher.
 */
export default function ProjectOverviewWidgets({ tabs, ctx }) {
    const { activeOrg } = useOrg();
    const [layout, lay] = useWidgetLayout(activeOrg?.id, CATALOG);
    const [picking, setPicking] = useState(false);
    const { board, navigate, t, cols, tileCols } = ctx;
    // A link names a project section, or one of the dashboard's own pages.
    const go = (to) => (to.startsWith('dashboard:')
        ? navigate(`/projects/${projectRef(board.project.id)}/dashboard/${to.slice(10)}`)
        : ctx.open(to));
    const offered = (w) => !w.fin || board.fin;
    const shown = layout.map((l) => ({ ...BY_ID.get(l.id), size: l.size })).filter(offered);
    const tiles = shown.filter((w) => w.kind === 'tile');
    const cards = shown.filter((w) => w.kind === 'card');

    return (<>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>{tabs}</div>
            <div style={{ margin: '-1px 0 14px', display: 'inline-flex', gap: 6 }}>
                <Btn size="sm" onClick={() => setPicking(true)}><Plus size={13} strokeWidth={2.2} aria-hidden="true" />Add Widget</Btn>
                <ArrangeBar />
            </div>
        </div>

        {shown.length === 0 && (
            <div style={{
                border: '1.5px dashed ' + t.lineStrong, borderRadius: 18, padding: '40px 20px', textAlign: 'center',
                display: 'grid', gap: 12, justifyItems: 'center', color: t.dim, fontSize: 13,
            }}>
                Add widgets to keep this project's money, plan, people and work in one view.
                <span style={{ display: 'inline-flex', gap: 8 }}>
                    <Btn size="sm" primary onClick={() => setPicking(true)}><Plus size={13} strokeWidth={2.2} aria-hidden="true" />Add Widget</Btn>
                    <Btn size="sm" onClick={lay.reset}>Use Default Layout</Btn>
                </span>
            </div>
        )}

        {tiles.length > 0 && (
            <TileRow cols={tileCols(Math.max(1, tiles.length))}>
                {tiles.map((w) => (
                    <Tile key={w.id} wid={w.id} icon={w.icon} label={w.title} {...w.tile(ctx)}
                        onClick={w.to ? () => go(w.to) : undefined} />
                ))}
            </TileRow>
        )}

        {cards.length > 0 && (
            <CardGrid cols={cols}>
                {cards.map((w) => {
                    const Body = w.body;
                    return (
                        <Card key={w.id} wid={w.id} title={w.title}
                            note={typeof w.note === 'function' ? w.note(ctx) : w.note}
                            style={w.size === 'lg' ? { gridColumn: `span ${cols}` } : undefined}
                            right={w.more ? <More label={w.more[0]} onClick={() => go(w.more[1])} /> : null}>
                            <Body {...ctx} />
                        </Card>
                    );
                })}
            </CardGrid>
        )}

        <Modal open={picking} onClose={() => setPicking(false)} title="Add Widget" width={620}
            note="Choose what every project's Overview shows. Arrange puts them in order."
            footer={<>
                <Btn size="sm" onClick={lay.reset}>Reset To Default</Btn>
                <Btn size="sm" primary onClick={() => setPicking(false)}>Done</Btn>
            </>}>
            <Picker layout={layout} lay={lay} offered={offered} t={t} />
        </Modal>
    </>);
}

/** Every widget this person may have, switched on or off; a card's width beside it. */
function Picker({ layout, lay, offered, t }) {
    const sizeOf = (id) => layout.find((l) => l.id === id)?.size;
    const group = (kind, label) => {
        const list = ALL.filter((w) => w.kind === kind && offered(w));
        return (
            <section style={{ marginBottom: 18 }}>
                <SubLabel>{label}</SubLabel>
                <div style={{ display: 'grid', gap: 8 }}>
                    {list.map((w) => {
                        const on = lay.has(w.id);
                        const Icon = w.icon;
                        return (
                            <div key={w.id} style={{
                                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12,
                                border: '1px solid ' + (on ? t.accent : t.line), background: on ? t.accentSoft : t.panelAlt,
                            }}>
                                <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 9, background: t.card, color: t.accent, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                                    <Icon size={14} strokeWidth={2.1} />
                                </span>
                                <span style={{ flex: 1, minWidth: 0 }}>
                                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: t.text }}>{w.title}</span>
                                    <span style={{ display: 'block', fontSize: 12, color: t.faint }}>{w.desc}</span>
                                </span>
                                {on && w.kind === 'card' && (
                                    <Seg size="sm" label={`${w.title} width`} value={sizeOf(w.id)} onChange={(s) => lay.resize(w.id, s)}
                                        options={[{ id: 'md', label: 'Normal' }, { id: 'lg', label: 'Wide' }]} />
                                )}
                                <Btn size="sm" primary={!on} aria-pressed={on} aria-label={on ? `Remove ${w.title}` : `Add ${w.title}`}
                                    onClick={() => (on ? lay.remove(w.id) : lay.add(w.id))}>
                                    {on ? <><Check size={13} strokeWidth={2.2} aria-hidden="true" />Added</> : <><Plus size={13} strokeWidth={2.2} aria-hidden="true" />Add</>}
                                </Btn>
                            </div>
                        );
                    })}
                </div>
            </section>
        );
    };
    return (<>
        {group('tile', 'Figures')}
        {group('card', 'Cards')}
    </>);
}
