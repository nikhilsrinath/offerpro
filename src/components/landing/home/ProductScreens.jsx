// ProductScreens.jsx: static, data-only replicas of the main Opstead screens
// for the public landing page. They mirror the app's shell (navy rail, light
// blue stat boxes, teal accents) but read nothing from Supabase: every figure
// below is sample data for a fictional studio.
import React, { useLayoutEffect, useRef, useState } from 'react';
import {
    PieChart, FolderKanban, Handshake, Building2, Wallet, Users, FileText,
    CalendarDays, MessageSquareText, NotebookTabs, Search, Bell, Plus,
    ArrowUpRight, ArrowDownRight, AlertTriangle, Star, Receipt, Landmark,
    Clock, Sparkles, BookOpen, Filter,
    CornerDownLeft,
} from 'lucide-react';
import { money, AGENTS } from './landingData';

const RAIL = [
    { id: 'dashboard', label: 'Dashboard', icon: PieChart },
    { id: 'projects', label: 'Projects', icon: FolderKanban },
    { id: 'clients', label: 'Clients', icon: Handshake },
    { id: 'vendors', label: 'Vendors', icon: Building2 },
    { id: 'financials', label: 'Financials', icon: Wallet },
    { id: 'company', label: 'Company', icon: Users },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'today', label: 'Today', icon: CalendarDays },
    { id: 'ai', label: 'AI', icon: MessageSquareText },
    { id: 'workspace', label: 'Workspace', icon: NotebookTabs },
];

const PEOPLE = {
    AR: '#259E95', MK: '#3E6A9A', SP: '#C2763A', DV: '#7A5BB5', NJ: '#2F8F5B', RT: '#B5475B',
};

export function Avatar({ who, size = 22 }) {
    return (
        <span className="opm-avatar" style={{ width: size, height: size, background: PEOPLE[who] || '#5B6B7C', fontSize: size * 0.4 }}>
            {who}
        </span>
    );
}

export function Avatars({ list, size }) {
    return <span className="opm-avatars">{list.map((w) => <Avatar key={w} who={w} size={size} />)}</span>;
}

/** Renders children at a fixed design width and scales them down to fit. */
export function Scaled({ width, children, className = '' }) {
    const outer = useRef(null);
    const inner = useRef(null);
    const [box, setBox] = useState({ scale: 1, height: undefined });
    useLayoutEffect(() => {
        const measure = () => {
            if (!outer.current || !inner.current) return;
            const scale = Math.min(1, outer.current.clientWidth / width);
            setBox({ scale, height: inner.current.offsetHeight * scale });
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(outer.current);
        ro.observe(inner.current);
        return () => ro.disconnect();
    }, [width]);
    return (
        <div ref={outer} className={`opm-scaled ${className}`} style={{ height: box.height }}>
            <div ref={inner} style={{ width, transform: `scale(${box.scale})`, transformOrigin: 'top left' }}>
                {children}
            </div>
        </div>
    );
}

/** The app frame: browser bar, navy rail, page area. */
export function AppWindow({ active, path, children, railCollapsed = false }) {
    return (
        <div className="opm-window" aria-hidden="true">
            <div className="opm-bar">
                <span className="opm-dots"><i /><i /><i /></span>
                <span className="opm-url">opstead.app/{path}</span>
                <span className="opm-bar-right"><Search size={13} /><Bell size={13} /><Avatar who="AR" size={20} /></span>
            </div>
            <div className={`opm-body ${railCollapsed ? 'is-collapsed' : ''}`}>
                <aside className="opm-rail">
                    <div className="opm-org">
                        <span className="opm-org-mark">K</span>
                        {!railCollapsed && <span><b>Kestrel Studio</b><small>Owner</small></span>}
                    </div>
                    {RAIL.map(({ id, label, icon: Icon }) => (
                        <span key={id} className={`opm-rail-item ${active === id ? 'is-active' : ''}`}>
                            <Icon size={14} />{!railCollapsed && label}
                        </span>
                    ))}
                </aside>
                <main className="opm-page">{children}</main>
            </div>
        </div>
    );
}

function PageHead({ title, sub, children }) {
    return (
        <div className="opm-head">
            <div><h4>{title}</h4>{sub && <p>{sub}</p>}</div>
            <div className="opm-head-actions">{children}</div>
        </div>
    );
}

export function Chip({ tone = 'soft', children }) {
    return <span className={`opm-chip opm-chip-${tone}`}>{children}</span>;
}

/* ─────────────── Dashboard ─────────────── */

const FLOW = [
    { m: 'Jun', i: 62, o: 41 }, { m: 'Jul', i: 70, o: 48 }, { m: 'Aug', i: 58, o: 44 },
    { m: 'Sep', i: 81, o: 52 }, { m: 'Oct', i: 76, o: 49 }, { m: 'Nov', i: 92, o: 55 },
];

export function CashFlowChart({ height = 150 }) {
    const w = 420, h = height, pad = 22, slot = (w - pad) / FLOW.length, bw = 15;
    return (
        <svg viewBox={`0 0 ${w} ${h + 20}`} className="opm-chart">
            {[0.25, 0.5, 0.75, 1].map((t) => (
                <line key={t} x1={pad} x2={w} y1={h - h * t * 0.9} y2={h - h * t * 0.9} className="opm-grid" />
            ))}
            {FLOW.map((d, k) => {
                const x = pad + k * slot + slot / 2 - bw - 2;
                return (
                    <g key={d.m}>
                        <rect x={x} y={h - d.i * 1.5 * (h / 150)} width={bw} height={d.i * 1.5 * (h / 150)} rx="4" className="opm-bar-in" />
                        <rect x={x + bw + 4} y={h - d.o * 1.5 * (h / 150)} width={bw} height={d.o * 1.5 * (h / 150)} rx="4" className="opm-bar-out" />
                        <text x={x + bw + 2} y={h + 15} textAnchor="middle" className="opm-axis">{d.m}</text>
                    </g>
                );
            })}
        </svg>
    );
}

export function DashboardScreen() {
    const stats = [
        { label: 'Revenue', value: money(1842500), delta: '+12.40%', up: true },
        { label: 'Expenses', value: money(916240), delta: '+3.10%', up: false },
        { label: 'Receivables', value: money(475000), delta: '6 invoices', up: null },
        { label: 'Active Projects', value: '14', delta: '3 due this month', up: null },
    ];
    return (
        <AppWindow active="dashboard" path="dashboard/overview">
            <PageHead title="Overview" sub="Kestrel Studio, November 2026">
                <Chip>This Month</Chip><span className="opm-btn">Customize</span>
            </PageHead>
            <div className="opm-stats">
                {stats.map((s) => (
                    <div key={s.label} className="opm-stat">
                        <span>{s.label}</span>
                        <b>{s.value}</b>
                        <small className={s.up === true ? 'up' : s.up === false ? 'down' : ''}>
                            {s.up === true && <ArrowUpRight size={11} />}{s.up === false && <ArrowDownRight size={11} />}{s.delta}
                        </small>
                    </div>
                ))}
            </div>
            <div className="opm-grid-2">
                <div className="opm-card">
                    <div className="opm-card-head"><b>Cash In vs Cash Out</b><span className="opm-legend"><i className="in" />In<i className="out" />Out</span></div>
                    <CashFlowChart />
                </div>
                <div className="opm-card">
                    <div className="opm-card-head"><b>Needs Attention</b><Chip tone="warn">4</Chip></div>
                    <ul className="opm-list">
                        <li><Receipt size={14} className="t-blue" /><span><b>INV-042 to Larkspur Hotels</b><small>Due in 3 days, {money(184000)}</small></span></li>
                        <li><AlertTriangle size={14} className="t-warn" /><span><b>GSTR-3B for October</b><small>File by 20 Nov</small></span></li>
                        <li><Star size={14} className="t-star" /><span><b>Site survey, Harbor Residences</b><small>Starred by admin, due Friday</small></span></li>
                        <li><Landmark size={14} className="t-teal" /><span><b>2 vendor bills unpaid</b><small>{money(62350)} to Arcline Prints</small></span></li>
                    </ul>
                </div>
            </div>
            <div className="opm-card opm-projects-mini">
                <div className="opm-card-head"><b>Project Progress</b><span className="opm-link">View All</span></div>
                {[
                    ['KS-2026-007', 'Harbor Residences Interiors', 72, ['AR', 'MK', 'SP']],
                    ['KS-2026-009', 'Larkspur Hotels Rebrand', 45, ['DV', 'NJ']],
                    ['KS-2026-011', 'Verdant Foods Packaging', 18, ['RT', 'AR']],
                ].map(([code, name, pct, team]) => (
                    <div key={code} className="opm-prog-row">
                        <span className="opm-code">{code}</span><b>{name}</b>
                        <span className="opm-prog"><i style={{ width: `${pct}%` }} /></span><small>{pct}.00%</small>
                        <Avatars list={team} size={20} />
                    </div>
                ))}
            </div>
        </AppWindow>
    );
}

/* ─────────────── Projects ─────────────── */

const BOARD = [
    { title: 'To Do', tasks: [
        { t: 'Lighting plan for lobby', p: 'KS-2026-007', who: ['SP'], due: '21 Nov', tag: ['High', 'warn'] },
        { t: 'Collect brand assets from client', p: 'KS-2026-009', who: ['DV'], due: '24 Nov', tag: ['Normal', 'soft'] },
    ] },
    { title: 'In Progress', tasks: [
        { t: 'Moodboard round two', p: 'KS-2026-009', who: ['NJ', 'DV'], due: '19 Nov', tag: ['Starred', 'star'] },
        { t: 'Vendor quotes for flooring', p: 'KS-2026-007', who: ['MK'], due: '20 Nov', tag: ['Normal', 'soft'] },
    ] },
    { title: 'In Review', tasks: [
        { t: 'Packaging dieline v3', p: 'KS-2026-011', who: ['RT'], due: '18 Nov', tag: ['Review', 'blue'] },
    ] },
    { title: 'Done', tasks: [
        { t: 'Site measurements', p: 'KS-2026-007', who: ['AR', 'SP'], due: '12 Nov', tag: ['Done', 'green'] },
        { t: 'Kick-off meeting notes', p: 'KS-2026-011', who: ['RT'], due: '10 Nov', tag: ['Done', 'green'] },
    ] },
];

export function TaskCard({ task }) {
    return (
        <div className="opm-task">
            <Chip tone={task.tag[1]}>{task.tag[0]}</Chip>
            <b>{task.t}</b>
            <span className="opm-code">{task.p}</span>
            <div className="opm-task-foot"><Avatars list={task.who} size={18} /><small><Clock size={10} /> {task.due}</small></div>
        </div>
    );
}

export function ProjectsScreen() {
    return (
        <AppWindow active="projects" path="projects/ks-2026-007/tasks">
            <PageHead title="Harbor Residences Interiors" sub="KS-2026-007, client Harbor Developers">
                <Avatars list={['AR', 'MK', 'SP', 'NJ']} size={22} /><span className="opm-btn opm-btn-dark"><Plus size={12} /> Add Task</span>
            </PageHead>
            <div className="opm-tabs">
                {['Overview', 'Tasks', 'Team', 'Ledger', 'Documents', 'Whiteboard'].map((t) => (
                    <span key={t} className={t === 'Tasks' ? 'is-active' : ''}>{t}</span>
                ))}
            </div>
            <div className="opm-board">
                {BOARD.map((col) => (
                    <div key={col.title} className="opm-col">
                        <div className="opm-col-head"><b>{col.title}</b><small>{col.tasks.length}</small></div>
                        {col.tasks.map((task) => <TaskCard key={task.t} task={task} />)}
                    </div>
                ))}
            </div>
        </AppWindow>
    );
}

/* ─────────────── CRM ─────────────── */

const PIPE = [
    { stage: 'Lead', deals: [['Orbit Fintech', 'Office fit-out', 420000, 10, 'MK'], ['Cobalt Labs', 'Brand refresh', 180000, 10, 'DV']] },
    { stage: 'Contacted', deals: [['Meadow Schools', 'Campus signage', 260000, 20, 'NJ']] },
    { stage: 'Qualified', deals: [['Tidewater Spa', 'Interiors', 910000, 40, 'AR'], ['Pinecrest Bank', 'Annual report', 140000, 40, 'DV']] },
    { stage: 'Proposal', deals: [['Larkspur Hotels', 'Phase two', 1250000, 60, 'AR']] },
    { stage: 'Negotiation', deals: [['Quarry Coffee', 'Store design', 560000, 80, 'SP']] },
];

export function DealCard({ deal }) {
    const [co, what, value, prob, who] = deal;
    return (
        <div className="opm-deal">
            <b>{co}</b><small>{what}</small>
            <span className="opm-deal-val">{money(value)}</span>
            <div className="opm-task-foot"><span className="opm-prob"><i style={{ '--w': `${prob}%` }} />{prob}%</span><Avatar who={who} size={18} /></div>
        </div>
    );
}

export function CrmScreen() {
    const total = PIPE.flatMap((c) => c.deals).reduce((s, d) => s + d[2], 0);
    const weighted = PIPE.flatMap((c) => c.deals).reduce((s, d) => s + d[2] * d[3] / 100, 0);
    return (
        <AppWindow active="clients" path="clients/crm/deals">
            <PageHead title="Sales Pipeline" sub="7 open deals">
                <Chip>Open</Chip><span className="opm-btn opm-btn-dark"><Plus size={12} /> New Deal</span>
            </PageHead>
            <div className="opm-pipebar">
                <div><small>Open Value</small><b>{money(total)}</b></div>
                <div><small>Weighted</small><b>{money(weighted)}</b></div>
                <div><small>Won This Quarter</small><b>{money(2140000)}</b></div>
                <div className="opm-pipebar-steps">
                    {PIPE.map((c, k) => <span key={c.stage} style={{ opacity: 0.35 + k * 0.16 }} />)}
                </div>
            </div>
            <div className="opm-board opm-board-5">
                {PIPE.map((col) => (
                    <div key={col.stage} className="opm-col">
                        <div className="opm-col-head"><b>{col.stage}</b><small>{col.deals.length}</small></div>
                        {col.deals.map((d) => <DealCard key={d[0]} deal={d} />)}
                    </div>
                ))}
            </div>
        </AppWindow>
    );
}

/* ─────────────── Financials ─────────────── */

const LEDGER = [
    ['14 Nov', 'Larkspur Hotels', 'Client receipt', 'KS-2026-009', 'credit', 236000, 'RC-118'],
    ['13 Nov', 'Arcline Prints', 'Vendor payment', 'KS-2026-011', 'debit', 41300, 'VP-077'],
    ['12 Nov', 'Salaries, October', 'Salaries', 'General', 'debit', 384000, 'SAL-10'],
    ['11 Nov', 'Harbor Developers', 'Client receipt', 'KS-2026-007', 'credit', 412500, 'RC-117'],
    ['09 Nov', 'Studio rent', 'Rent', 'Internal', 'debit', 85000, 'EX-301'],
    ['08 Nov', 'Stoneworks Supply', 'Vendor payment', 'KS-2026-007', 'debit', 127440, 'VP-076'],
    ['06 Nov', 'Verdant Foods', 'Client receipt', 'KS-2026-011', 'credit', 95000, 'RC-116'],
];

export function FinancialsScreen() {
    const credit = LEDGER.filter((r) => r[4] === 'credit').reduce((s, r) => s + r[5], 0);
    const debit = LEDGER.filter((r) => r[4] === 'debit').reduce((s, r) => s + r[5], 0);
    return (
        <AppWindow active="financials" path="financials/general-ledger">
            <PageHead title="General Ledger" sub="Every project, client and vendor entry in one book">
                <span className="opm-btn"><Filter size={12} /> Filters</span><span className="opm-btn opm-btn-dark"><Plus size={12} /> Record Money</span>
            </PageHead>
            <div className="opm-filterrow">
                <span className="opm-seg"><i className="is-active">All</i><i>Credit</i><i>Debit</i></span>
                <span className="opm-search"><Search size={12} /> Search entries</span>
            </div>
            <div className="opm-table">
                <div className="opm-tr opm-th"><span>Date</span><span>Particulars</span><span>Type</span><span>Project</span><span>Receipt No</span><span className="r">Amount</span></div>
                {LEDGER.map((r) => (
                    <div key={r[6]} className="opm-tr">
                        <span className="muted">{r[0]}</span>
                        <span><b>{r[1]}</b><small>{r[2]}</small></span>
                        <span><Chip tone={r[4] === 'credit' ? 'green' : 'red'}>{r[4] === 'credit' ? 'Credit' : 'Debit'}</Chip></span>
                        <span className="opm-code">{r[3]}</span>
                        <span className="muted">{r[6]}</span>
                        <span className={`r num ${r[4]}`}>{r[4] === 'credit' ? '+' : '−'} {money(r[5])}</span>
                    </div>
                ))}
            </div>
            <div className="opm-totals">
                <span>Credit <b className="credit">{money(credit)}</b></span>
                <span>Debit <b className="debit">{money(debit)}</b></span>
                <span>Balance <b>{money(credit - debit)}</b></span>
            </div>
        </AppWindow>
    );
}

/* ─────────────── AI ─────────────── */

export function AiAnswer() {
    return (
        <>
            <div className="opm-msg opm-msg-user">Which clients owe us money for more than 30 days?</div>
            <div className="opm-msg opm-msg-ai">
                <span className="opm-ai-mark"><Sparkles size={12} /></span>
                <div>
                    <p>Three clients have invoices open past 30 days, <b>{money(312400)}</b> in total.</p>
                    <div className="opm-mini-table">
                        <div><span>Pinecrest Bank</span><span>INV-031</span><span className="r">{money(142000)}</span><Chip tone="red">47 days</Chip></div>
                        <div><span>Meadow Schools</span><span>INV-034</span><span className="r">{money(118400)}</span><Chip tone="warn">38 days</Chip></div>
                        <div><span>Cobalt Labs</span><span>INV-036</span><span className="r">{money(52000)}</span><Chip tone="warn">33 days</Chip></div>
                    </div>
                    <small className="opm-prov"><BookOpen size={11} /> Read 42 invoices and 18 receipts from the General Ledger</small>
                </div>
            </div>
        </>
    );
}

export function AiScreen() {
    return (
        <AppWindow active="ai" path="ai">
            <PageHead title="AI" sub="Answers from your own records">
                <span className="opm-seg"><i className="is-active">Ask</i><i>Agents</i><i>Connectors</i><i>Neurals</i></span>
            </PageHead>
            <div className="opm-ai">
                <div className="opm-chat">
                    <AiAnswer />
                    <div className="opm-composer">Ask about cash, deals, people or deadlines<span><CornerDownLeft size={12} /></span></div>
                </div>
                <div className="opm-card opm-agents">
                    <div className="opm-card-head"><b>Agents</b><small>3 on</small></div>
                    {AGENTS.map(({ name, freq, icon: Icon, on }) => (
                        <div key={name} className="opm-agent">
                            <span className="opm-agent-icon"><Icon size={13} /></span>
                            <span><b>{name}</b><small>{freq}</small></span>
                            <span className={`opm-switch ${on ? 'is-on' : ''}`}><i /></span>
                        </div>
                    ))}
                </div>
            </div>
        </AppWindow>
    );
}

