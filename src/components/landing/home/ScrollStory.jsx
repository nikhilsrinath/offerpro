// Scroll-scrubbed stories for the home page: "Why Teams Move To Opstead"
// and "Get Started In Three Steps". Both pin a full-height stage and drive
// every transform from the section's scroll progress, so scrolling forward
// plays the story and scrolling back rewinds it. Reduced motion renders the
// finished frames as a plain stacked layout.
import React, { useRef } from 'react';
import {
    motion, useScroll, useSpring, useTransform, useMotionValue, useReducedMotion,
} from 'framer-motion';
import {
    BookOpen, FolderKanban, Users, Truck, Wallet, Building2, FileText, Sun, Sparkles,
    CalendarDays, Handshake, ShieldCheck, LineChart, Library, Activity, Receipt,
    PieChart, Landmark, Table2, ListTodo, FolderOpen, MessageSquare, Calculator, Check,
} from 'lucide-react';
import { Scaled } from './ProductScreens';
import { money } from './landingData';
import './scrollStory.css';

const SPRING = { stiffness: 140, damping: 28, mass: 0.35 };

/** Smoothed 0..1 progress of a tall section scrolling past a pinned stage. */
function useStageProgress(ref, still) {
    const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
    const smooth = useSpring(scrollYProgress, SPRING);
    const done = useMotionValue(1);
    return still ? done : smooth;
}

/** 0..1 between a and b, clamped. */
const useRange = (p, a, b) => useTransform(p, [a, b], [0, 1], { clamp: true });

/* ══════════════ Why Teams Move To Opstead ══════════════ */

const TOOLS = [
    { icon: Table2, label: 'Spreadsheets', x: '-34vw', y: '-24vh', d: 1.3 },
    { icon: Calculator, label: 'Accounting Tool', x: '30vw', y: '-28vh', d: 0.8 },
    { icon: ListTodo, label: 'Task App', x: '-38vw', y: '20vh', d: 0.9 },
    { icon: FolderOpen, label: 'Templates Folder', x: '34vw', y: '22vh', d: 1.2 },
    { icon: MessageSquare, label: 'Chat Threads', x: '-12vw', y: '34vh', d: 1.5 },
    { icon: Receipt, label: 'Paper Bills', x: '14vw', y: '-38vh', d: 1.1 },
];

const REASONS = [
    { from: 7, to: 1, title: 'Ledger For Everything', body: 'Project, client and vendor ledgers are slices of one General Ledger. Edit an entry anywhere and it changes everywhere.', Viz: LedgerViz },
    { from: 0, to: 10, title: 'Modules, One Login', body: 'Projects, clients, vendors, financials, CRM, company, documents, Today, AI and Workspace share the same records.', Viz: ModulesViz },
    { from: 0, to: 5, title: 'AI Agents On Watch', body: 'Deadlines, cash, deals, knowledge and operations, checked on a schedule you set.', Viz: AgentsViz },
    { from: 4, to: 0, title: 'Double Entry By Hand', body: 'Record a payment once. It reaches the project, the party, the P&L and the tax report.', Viz: EntryViz },
];

// Timeline of the Why section (fractions of its scroll length).
const INTRO_END = 0.24;
const TRACK_START = 0.3;
const TRACK_END = 0.95;
const center = (i) => TRACK_START + (i * (TRACK_END - TRACK_START)) / (REASONS.length - 1);

function ToolChip({ tool, p }) {
    const Icon = tool.icon;
    const x = useTransform(p, [0, 0.07, 0.2], [`calc(${tool.x} * ${tool.d})`, tool.x, '0vw']);
    const y = useTransform(p, [0, 0.07, 0.2], [`calc(${tool.y} * ${tool.d})`, tool.y, '0vh']);
    const scale = useTransform(p, [0.07, 0.2], [1, 0.35]);
    const rotate = useTransform(p, [0, 0.2], [tool.d > 1 ? -8 : 7, 0]);
    const opacity = useTransform(p, [0, 0.03, 0.15, 0.2], [0, 1, 1, 0]);
    return (
        <motion.span className="op-ws-tool" style={{ x, y, scale, rotate, opacity }}>
            <Icon size={15} /> {tool.label}
        </motion.span>
    );
}

function Counter({ lp, from, to }) {
    const value = useTransform(lp, (v) => Math.round(from + (to - from) * v));
    return <motion.span>{value}</motion.span>;
}

function ReasonPanel({ reason, index, p, still }) {
    const c = center(index);
    const lp = useRange(p, index === 0 ? INTRO_END - 0.02 : c - 0.15, c + 0.01);
    // Parallax: the number travels faster than the copy, the visual slower.
    // The first panel is already at rest when the track arrives and the
    // last one stays at rest after it lands.
    const first = index === 0;
    const last = index === REASONS.length - 1;
    const range = [c - 0.2, c, c + 0.2];
    const drift = (d) => [first ? '0vw' : `${d}vw`, '0vw', last ? '0vw' : `${-d}vw`];
    const numX = useTransform(p, range, drift(19));
    const copyX = useTransform(p, range, drift(6.5));
    const vizX = useTransform(p, range, drift(-4.5));
    const vizScale = useTransform(p, range, [first ? 1 : 0.9, 1, last ? 1 : 0.9]);
    const Viz = reason.Viz;
    return (
        <div className="op-ws-panel">
            <div className="op-ws-panel-inner">
                <div className="op-ws-copy">
                    <motion.span className="op-ws-num" style={still ? undefined : { x: numX }} aria-hidden="true">
                        <Counter lp={lp} from={reason.from} to={reason.to} />
                    </motion.span>
                    <motion.div style={still ? undefined : { x: copyX }}>
                        <h3><span className="sr-only">{reason.to} </span>{reason.title}</h3>
                        <p>{reason.body}</p>
                    </motion.div>
                </div>
                <motion.div className="op-ws-viz" style={still ? undefined : { x: vizX, scale: vizScale }} aria-hidden="true">
                    <Viz lp={lp} />
                </motion.div>
            </div>
        </div>
    );
}

function ProgressDot({ p, i, label }) {
    const c = center(i);
    const half = (TRACK_END - TRACK_START) / (REASONS.length - 1) / 2;
    const last = i === REASONS.length - 1;
    const active = useTransform(
        p,
        [c - half, c - half + 0.02, c + half - 0.02, c + half],
        [i === 0 ? 1 : 0, 1, 1, last ? 1 : 0],
    );
    const fill = useRange(p, c - half * 2, c);
    return (
        <motion.li style={{ '--a': active }}>
            <span className="op-ws-dot-bar"><motion.i style={{ scaleX: i === 0 ? 1 : fill }} /></span>
            <small>{label}</small>
        </motion.li>
    );
}

export function WhyStory() {
    const ref = useRef(null);
    const still = useReducedMotion();
    const p = useStageProgress(ref, still);

    const headScale = useTransform(p, [0, INTRO_END], [1, 0.82]);
    const headY = useTransform(p, [0, INTRO_END], ['0vh', '-8vh']);
    const headOpacity = useTransform(p, [0.09, 0.15], [1, 0]);
    const coreScale = useTransform(p, [0.12, 0.2, INTRO_END + 0.02], [0.2, 1, 0.6]);
    const coreOpacity = useTransform(p, [0.12, 0.17, 0.22, INTRO_END + 0.02], [0, 1, 1, 0]);
    const ringScale = useTransform(p, [0.17, INTRO_END + 0.02], [0.6, 3.2]);
    const ringOpacity = useTransform(p, [0.17, 0.2, INTRO_END + 0.02], [0, 0.6, 0]);
    const trackOpacity = useTransform(p, [INTRO_END - 0.02, TRACK_START - 0.02], [0, 1]);
    const trackY = useTransform(p, [INTRO_END - 0.02, TRACK_START - 0.02], [60, 0]);
    const trackX = useTransform(p, [TRACK_START, TRACK_END], ['0%', `-${(100 * (REASONS.length - 1)) / REASONS.length}%`]);
    const bgY1 = useTransform(p, [0, 1], ['0%', '-30%']);
    const bgY2 = useTransform(p, [0, 1], ['10%', '-60%']);
    const gridX = useTransform(p, [0, 1], ['0px', '-220px']);

    if (still) {
        return (
            <section className="op-ws is-still" id="why">
                <div className="op-wrap op-section-head">
                    <h2>Why Teams Move To Opstead</h2>
                    <p>Spreadsheets, an accounting tool, a task app and a folder of templates, replaced by one place that agrees with itself.</p>
                </div>
                {REASONS.map((r, i) => <ReasonPanel key={r.title} reason={r} index={i} p={p} still />)}
            </section>
        );
    }

    return (
        <section className="op-ws" id="why" ref={ref}>
            <div className="op-ws-stage">
                <div className="op-ws-bg" aria-hidden="true">
                    <motion.i className="b1" style={{ y: bgY1 }} />
                    <motion.i className="b2" style={{ y: bgY2 }} />
                    <motion.span className="op-ws-grid" style={{ x: gridX }} />
                </div>

                <div className="op-ws-intro" aria-hidden="true">
                    {TOOLS.map((t) => <ToolChip key={t.label} tool={t} p={p} />)}
                    <motion.span className="op-ws-ring" style={{ scale: ringScale, opacity: ringOpacity }} />
                    <motion.span className="op-ws-core" style={{ scale: coreScale, opacity: coreOpacity }}>
                        <img src="/opstead-logo-white.png" alt="" />
                    </motion.span>
                </div>

                <motion.div className="op-ws-head" style={{ scale: headScale, y: headY, opacity: headOpacity }}>
                    <h2>Why Teams Move To Opstead</h2>
                    <p>Spreadsheets, an accounting tool, a task app and a folder of templates, replaced by one place that agrees with itself.</p>
                    <span className="op-ws-hint">Scroll</span>
                </motion.div>

                <motion.div className="op-ws-track-wrap" style={{ opacity: trackOpacity, y: trackY }}>
                    <div className="op-ws-eyebrow op-wrap">Why Teams Move To Opstead</div>
                    <motion.div className="op-ws-track" style={{ x: trackX, width: `${REASONS.length * 100}%` }}>
                        {REASONS.map((r, i) => <ReasonPanel key={r.title} reason={r} index={i} p={p} />)}
                    </motion.div>
                    <ol className="op-ws-dots op-wrap">
                        {REASONS.map((r, i) => <ProgressDot key={r.title} p={p} i={i} label={r.title} />)}
                    </ol>
                </motion.div>
            </div>
        </section>
    );
}

/* ── Reason visuals, each driven by its own 0..1 progress ── */

function LedgerViz({ lp }) {
    const slices = [
        { label: 'Project Ledger', sub: 'Harbor Residences', x: -170 },
        { label: 'Client Ledger', sub: 'Harbor Developers', x: 0 },
        { label: 'Vendor Ledger', sub: 'Arcline Prints', x: 170 },
    ];
    const spread = useRange(lp, 0.15, 0.7);
    const sync = useRange(lp, 0.75, 0.95);
    const draw = useRange(lp, 0.3, 0.75);
    const syncBg = useTransform(sync, [0, 1], ['rgba(37,158,149,0)', 'rgba(37,158,149,0.16)']);
    return (
        <div className="op-vz op-vz-ledger">
            <svg className="op-vz-lines" viewBox="-240 0 480 300" preserveAspectRatio="none">
                {slices.map((s) => (
                    <motion.path key={s.label} d={`M0 96 C 0 130, ${s.x} 124, ${s.x} 158`} style={{ pathLength: draw }} />
                ))}
            </svg>
            <div className="op-vz-gl">
                <span className="op-vz-gl-head"><BookOpen size={13} /> General Ledger</span>
                {[['Receipt RC-118', 236000], ['Bill BL-2219', 104300]].map(([k, v], i) => (
                    <motion.span key={k} className="op-vz-row" style={i === 0 ? { background: syncBg } : undefined}>
                        <small>{k}</small><b>{money(v)}</b>
                    </motion.span>
                ))}
            </div>
            {slices.map((s) => (
                <LedgerSlice key={s.label} slice={s} spread={spread} syncBg={syncBg} />
            ))}
        </div>
    );
}

function LedgerSlice({ slice, spread, syncBg }) {
    const x = useTransform(spread, [0, 1], [0, slice.x]);
    const y = useTransform(spread, [0, 1], [-60, 0]);
    const opacity = useTransform(spread, [0, 0.3], [0, 1]);
    return (
        <motion.div className="op-vz-slice" style={{ x, y, opacity }}>
            <b>{slice.label}</b>
            <small>{slice.sub}</small>
            <motion.span className="op-vz-row" style={{ background: syncBg }}><small>RC-118</small><b>{money(236000)}</b></motion.span>
        </motion.div>
    );
}

const MODULES = [
    [FolderKanban, 'Projects'], [Users, 'Clients'], [Truck, 'Vendors'], [Wallet, 'Financials'], [Handshake, 'CRM'],
    [Building2, 'Company'], [FileText, 'Documents'], [Sun, 'Today'], [Sparkles, 'AI'], [CalendarDays, 'Workspace'],
];

function ModulesViz({ lp }) {
    const login = useRange(lp, 0.82, 0.98);
    const loginScale = useTransform(login, [0, 1], [0.8, 1]);
    return (
        <div className="op-vz op-vz-modules">
            <div className="op-vz-mod-grid">
                {MODULES.map(([Icon, label], i) => <ModuleTile key={label} Icon={Icon} label={label} lp={lp} i={i} />)}
            </div>
            <motion.span className="op-vz-login" style={{ opacity: login, scale: loginScale }}>
                <ShieldCheck size={14} /> One login, one set of records
            </motion.span>
        </div>
    );
}

function ModuleTile({ Icon, label, lp, i }) {
    const t = useRange(lp, i * 0.07, i * 0.07 + 0.2);
    const y = useTransform(t, [0, 1], [40, 0]);
    const rotate = useTransform(t, [0, 1], [i % 2 ? 10 : -10, 0]);
    return (
        <motion.span className="op-vz-mod" style={{ opacity: t, y, rotate, scale: t }}>
            <Icon size={18} /><small>{label}</small>
        </motion.span>
    );
}

const AGENTS = [
    [ShieldCheck, 'Compliance And Deadline', 'GST return due in 4 days'],
    [LineChart, 'Business Intelligence', 'Weekly summary ready'],
    [Library, 'Internal Knowledge', '312 passages indexed'],
    [Handshake, 'Deal Intelligence', '3 deals need a follow-up'],
    [Activity, 'Operations Monitoring', '2 projects over budget'],
];

function AgentsViz({ lp }) {
    return (
        <div className="op-vz op-vz-agents">
            {AGENTS.map(([Icon, name, note], i) => <AgentRow key={name} Icon={Icon} name={name} note={note} lp={lp} i={i} />)}
        </div>
    );
}

function AgentRow({ Icon, name, note, lp, i }) {
    const t = useRange(lp, 0.1 + i * 0.15, 0.22 + i * 0.15);
    const x = useTransform(t, [0, 1], [i % 2 ? 50 : -50, 0]);
    const knob = useTransform(t, [0.4, 1], [0, 14]);
    const track = useTransform(t, [0.4, 1], ['#CBD5DF', '#259E95']);
    const noteOpacity = useTransform(t, [0.7, 1], [0, 1]);
    return (
        <motion.div className="op-vz-agent" style={{ opacity: t, x }}>
            <span className="op-vz-agent-icon"><Icon size={14} /></span>
            <span><b>{name}</b><motion.small style={{ opacity: noteOpacity }}>{note}</motion.small></span>
            <motion.span className="op-vz-switch" style={{ background: track }}><motion.i style={{ x: knob }} /></motion.span>
        </motion.div>
    );
}

const TARGETS = [
    [FolderKanban, 'Project Ledger', 40],
    [Truck, 'Vendor Ledger', 110],
    [PieChart, 'Profit And Loss', 180],
    [Landmark, 'GST Report', 250],
];

function EntryViz({ lp }) {
    const pay = useRange(lp, 0, 0.2);
    const payX = useTransform(pay, [0, 1], [-50, 0]);
    return (
        <div className="op-vz op-vz-entry">
            <motion.div className="op-vz-pay" style={{ opacity: pay, x: payX }}>
                <small>Payment recorded</small>
                <b>{money(62580)}</b>
                <span>Arcline Prints, BL-2219</span>
            </motion.div>
            <svg className="op-vz-flow" viewBox="0 0 120 290" preserveAspectRatio="none">
                {TARGETS.map(([, label, y], i) => <FlowPath key={label} y={y} lp={lp} i={i} />)}
            </svg>
            <div className="op-vz-targets">
                {TARGETS.map(([Icon, label], i) => <Target key={label} Icon={Icon} label={label} lp={lp} i={i} />)}
            </div>
        </div>
    );
}

function FlowPath({ y, lp, i }) {
    const draw = useRange(lp, 0.2 + i * 0.12, 0.42 + i * 0.12);
    return <motion.path d={`M0 145 C 60 145, 60 ${y}, 120 ${y}`} style={{ pathLength: draw }} />;
}

function Target({ Icon, label, lp, i }) {
    const t = useRange(lp, 0.36 + i * 0.12, 0.46 + i * 0.12);
    const bg = useTransform(t, [0, 1], ['#FFFFFF', '#DCF1EE']);
    const check = useTransform(t, [0.5, 1], [0, 1]);
    return (
        <motion.span className="op-vz-target" style={{ background: bg }}>
            <Icon size={14} /> {label}
            <motion.i style={{ opacity: check, scale: check }}><Check size={11} /></motion.i>
        </motion.span>
    );
}

/* ══════════════ Get Started In Three Steps ══════════════ */

const BADGES = [
    [{ t: 'GSTIN verified', icon: ShieldCheck, x: '-12%', y: '14%' }, { t: 'Currency set to INR', icon: Wallet, x: '86%', y: '64%' }],
    [{ t: '4 parties linked', icon: Users, x: '-10%', y: '58%' }, { t: 'Roles decide access', icon: ShieldCheck, x: '84%', y: '10%' }],
    [{ t: '6 tasks due today', icon: ListTodo, x: '-12%', y: '30%' }, { t: `${money(743500)} coming in`, icon: Wallet, x: '82%', y: '72%' }],
];

function StepItem({ step, i, p, n }) {
    const a = i / n;
    const b = (i + 1) / n;
    const active = useTransform(p, [a - 0.04, a + 0.02, b - 0.02, b + 0.04], i === 0 ? [1, 1, 1, 0] : i === n - 1 ? [0, 1, 1, 1] : [0, 1, 1, 0]);
    return (
        <motion.li className="op-st-item" style={{ '--a': active }}>
            <span className="op-st-no">{String(i + 1).padStart(2, '0')}</span>
            <div><h3>{step.title}</h3><p>{step.body}</p></div>
        </motion.li>
    );
}

function StepLayer({ step, i, p, n }) {
    const Screen = step.Screen;
    const a = i / n;
    const reveal = useTransform(p, [a - 0.06, a + 0.04], [100, 0], { clamp: true });
    const clipPath = useTransform(reveal, (v) => `inset(0 0 0 ${v}%)`);
    const scale = useTransform(p, [a - 0.06, a + 0.04, (i + 1) / n + 0.04], [1.06, 1, i === n - 1 ? 1 : 0.97]);
    return (
        <motion.div className="op-st-layer" style={i === 0 ? { scale } : { clipPath, scale }}>
            <Screen />
        </motion.div>
    );
}

function Badge({ badge, i, p, n, k }) {
    const a = i / n;
    const b = (i + 1) / n;
    const opacity = useTransform(p, [a, a + 0.06, b - 0.04, b], i === n - 1 ? [0, 1, 1, 1] : [0, 1, 1, 0]);
    const y = useTransform(p, [a, b], k ? [70, -70] : [-40, 50]);
    const Icon = badge.icon;
    return (
        <motion.span className="op-st-badge" style={{ left: badge.x, top: badge.y, opacity, y }}>
            <span><Icon size={13} /></span>{badge.t}
        </motion.span>
    );
}

function BigNumber({ i, p, n }) {
    const a = i / n;
    const b = (i + 1) / n;
    const opacity = useTransform(p, [a - 0.03, a + 0.04, b - 0.04, b + 0.03], i === 0 ? [1, 1, 1, 0] : i === n - 1 ? [0, 1, 1, 1] : [0, 1, 1, 0]);
    const y = useTransform(p, [a - 0.1, b + 0.1], ['30%', '-30%']);
    return <motion.span className="op-st-big" style={{ opacity, y }}>{String(i + 1).padStart(2, '0')}</motion.span>;
}

export function StepsStory({ steps }) {
    const ref = useRef(null);
    const still = useReducedMotion();
    const p = useStageProgress(ref, still);
    const n = steps.length;

    const { scrollYProgress: enter } = useScroll({ target: ref, offset: ['start end', 'start start'] });
    const enterS = useSpring(enter, SPRING);
    const rotateX = useTransform(enterS, [0, 1], [24, 0]);
    const rotateY = useTransform(enterS, [0, 1], [-16, 0]);
    const drift = useTransform(p, [0, 1], [30, -30]);
    const deviceEnterY = useTransform(enterS, [0, 1], [120, 0]);
    const deviceY = useTransform(() => deviceEnterY.get() + drift.get());
    const rail = useTransform(p, [0, 1], [0, 1]);
    const blobA = useTransform(p, [0, 1], ['-10%', '40%']);
    const blobB = useTransform(p, [0, 1], ['30%', '-40%']);

    if (still) {
        return (
            <section className="op-st is-still">
                <div className="op-wrap op-section-head">
                    <h2>Get Started In Three Steps</h2>
                    <p>No migration project. Set up the company, add the people you work with, and start from Today.</p>
                </div>
                <div className="op-wrap op-st-still-list">
                    {steps.map((s, i) => {
                        const Screen = s.Screen;
                        return (
                            <div key={s.title} className="op-st-still-item">
                                <div><span className="op-st-no">{String(i + 1).padStart(2, '0')}</span><h3>{s.title}</h3><p>{s.body}</p></div>
                                <div className="op-st-device"><Scaled width={820}><Screen /></Scaled></div>
                            </div>
                        );
                    })}
                </div>
            </section>
        );
    }

    return (
        <section className="op-st" ref={ref} style={{ height: `${n * 100 + 60}vh` }}>
            <div className="op-st-stage">
                <div className="op-st-bg" aria-hidden="true">
                    <motion.i className="b1" style={{ y: blobA }} />
                    <motion.i className="b2" style={{ y: blobB }} />
                </div>
                <div className="op-wrap op-st-grid">
                    <div className="op-st-text">
                        <h2>Get Started In Three Steps</h2>
                        <p className="op-st-lede">No migration project. Set up the company, add the people you work with, and start from Today.</p>
                        <div className="op-st-list-wrap">
                            <span className="op-st-rail" aria-hidden="true"><motion.i style={{ scaleY: rail }} /></span>
                            <ol className="op-st-list">
                                {steps.map((s, i) => <StepItem key={s.title} step={s} i={i} p={p} n={n} />)}
                            </ol>
                        </div>
                    </div>
                    <div className="op-st-visual" aria-hidden="true">
                        {steps.map((s, i) => <BigNumber key={s.title} i={i} p={p} n={n} />)}
                        <motion.div className="op-st-device" style={{ rotateX, rotateY, y: deviceY }}>
                            <Scaled width={820}>
                                <div className="op-st-layers">
                                    {steps.map((s, i) => <StepLayer key={s.title} step={s} i={i} p={p} n={n} />)}
                                </div>
                            </Scaled>
                        </motion.div>
                        {BADGES.slice(0, n).flatMap((pair, i) => pair.map((b, k) => (
                            <Badge key={b.t} badge={b} i={i} p={p} n={n} k={k} />
                        )))}
                    </div>
                </div>
            </div>
        </section>
    );
}
