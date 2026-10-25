import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Wallet, HandCoins, Truck, ListChecks, ArrowUp, ArrowUpRight, ChevronRight,
    AlertTriangle, TrendingUp, Target, Inbox, CalendarDays, UserMinus, Bell,
    Receipt, FolderKanban, FileText, Flag, CheckSquare, Plane, Clock, MessageSquareText,
} from 'lucide-react';
import { MONO, useT } from '../ui/edgeUtils';
import { Btn, Status, Loading } from '../ui/edge';
import { Tile, Card, DashStyle } from '../overview/dashKit';
import { useOrg } from '../../context/OrgContext';
import { useAssistant } from '../assistant/assistantStore';
import { headline } from '../hub/format';
import { useTodayData } from './useTodayData';
import { suggestedQuestions } from './todayModel';

/* ══════════════════════════════════════════════════════════════════════════
   Today: the owner's first page of the day. What is late, what is waiting on
   them, what falls due this week and what went well, each line one record
   that opens where it can be dealt with. Above it, a question box that hands
   straight to EdgeAI on the AI page.

   Everything here is counted from the org's own records (todayModel), so the
   page never says more than the books do.
   ══════════════════════════════════════════════════════════════════════════ */

const KIND_ICON = {
    invoice: Receipt, project: FolderKanban, bill: Truck, milestone: Flag, task: CheckSquare,
    leave: Plane, payment: HandCoins, quotation: FileText, timesheet: Clock, draft: FileText,
};

const warnOf = (t) => (t.isDark ? '#e0a020' : '#a86400');
const toneColor = (t, tone) => (tone === 'down' ? t.down : tone === 'warn' ? warnOf(t) : tone === 'up' ? t.up : t.accent);

function greeting(d = new Date()) {
    const h = d.getHours();
    return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
}

/* One record on the page: a toned icon, what it is, why, and what it is worth. */
function Item({ icon: Icon, tone, title, sub, value, onClick, compact }) {
    const t = useT();
    const c = toneColor(t, tone);
    return (
        <button type="button" onClick={onClick} className="td-item" style={{
            display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
            padding: compact ? '8px 8px' : '10px 10px', minHeight: 44, border: 'none', borderRadius: 11,
            background: 'transparent', fontFamily: MONO, color: t.text, cursor: 'pointer',
        }}>
            <span aria-hidden="true" style={{
                width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center',
                color: c, background: `color-mix(in srgb, ${c} ${t.isDark ? 15 : 10}%, transparent)`,
                boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 24%, transparent)`,
            }}><Icon size={14} strokeWidth={2} /></span>
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
                {sub && <span style={{ display: 'block', fontSize: 12, color: t.faint, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>}
            </span>
            {value && <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: tone === 'down' ? t.down : t.text }}>{value}</span>}
            <ChevronRight aria-hidden="true" size={13} className="td-arrow" style={{ color: t.faint, flexShrink: 0 }} />
        </button>
    );
}

function Quiet({ children }) {
    const t = useT();
    return <p style={{ margin: 0, padding: '14px 10px', fontSize: 13, color: t.faint, lineHeight: 1.5 }}>{children}</p>;
}

/* A column of the briefing: a heading with its count, then the lines. */
function BriefCol({ icon: Icon, title, count, tone, children }) {
    const t = useT();
    const c = toneColor(t, tone);
    return (
        <section aria-label={title} style={{
            minWidth: 0, padding: '14px 12px 8px', borderRadius: 14,
            background: t.panelAlt, border: '1px solid ' + t.line, display: 'flex', flexDirection: 'column',
        }}>
            <h3 style={{ margin: '0 0 8px', padding: '0 4px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: t.text }}>
                <Icon aria-hidden="true" size={14} strokeWidth={2.1} style={{ color: c }} />
                {title}
                {count > 0 && (
                    <span style={{ marginLeft: 'auto', minWidth: 22, height: 20, padding: '0 7px', borderRadius: 99, display: 'grid', placeItems: 'center', fontSize: 11.5, fontWeight: 600, color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>{count}</span>
                )}
            </h3>
            {children}
        </section>
    );
}

export default function TodayPage() {
    const t = useT();
    const navigate = useNavigate();
    const { activeOrg } = useOrg();
    const assistant = useAssistant();
    const { ready, loadError, model, leaveKnown } = useTodayData();
    const [q, setQ] = useState('');

    if (!ready) return <Loading>Loading today…</Loading>;

    const s = model.snapshot;
    // The company, never a name pulled from the sign-in email.
    const name = activeOrg?.company_name || activeOrg?.name || 'there';
    const now = new Date();
    const dateLine = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
    const dueToday = model.agenda[0]?.day === model.today ? model.agenda[0].items.length : 0;

    const summary = [
        model.needsYou ? `${model.needsYou} ${model.needsYou === 1 ? 'thing needs' : 'things need'} you` : 'Nothing is late and nothing is waiting on you',
        s.overdueValue > 0 ? `${headline(s.overdueValue)} is overdue from clients` : null,
        dueToday ? `${dueToday} ${dueToday === 1 ? 'item falls' : 'items fall'} due today` : null,
    ].filter(Boolean).join('. ') + '.';

    // The question goes to EdgeAI as a new chat, and the AI page shows it.
    const ask = (text) => {
        const v = String(text || '').trim();
        if (!v) return;
        if (assistant.askNew(v) !== false) navigate('/ai');
    };
    const go = (to) => () => navigate(to);

    const ATTN_MAX = 6;
    const attention = model.attention.slice(0, ATTN_MAX);
    const moreAttention = model.attention.length - attention.length;

    return (
        <div className="ov-page td-page" style={{ fontFamily: MONO, color: t.text, maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* ── greeting ─────────────────────────────────────────────── */}
            <header style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', padding: '2px 2px 4px' }}>
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: t.faint, marginBottom: 6 }}>
                        <CalendarDays aria-hidden="true" size={13} strokeWidth={2} />{dateLine}
                    </div>
                    <h2 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.15 }}>{greeting(now)}, {name}</h2>
                    <p style={{ margin: '7px 0 0', fontSize: 14, color: t.dim, lineHeight: 1.5 }}>{summary}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <Status tone={model.needsYou ? 'warn' : 'up'}>{model.needsYou ? `${model.needsYou} Need You` : 'All Clear'}</Status>
                    <Btn primary onClick={go('/ai')}><MessageSquareText aria-hidden="true" size={15} strokeWidth={2} />Ask EdgeAI</Btn>
                </div>
            </header>

            {loadError && <div role="alert" style={{ fontSize: 13, color: t.down }}>Some records could not be loaded: {loadError}. What is shown is the last copy saved in this browser.</div>}

            {/* ── ask bar ──────────────────────────────────────────────── */}
            <section aria-label="Ask EdgeAI" style={{
                border: '1px solid ' + t.line, borderRadius: 18, background: t.card, boxShadow: t.highlight, padding: 12,
                backgroundImage: `radial-gradient(120% 90% at 100% 0%, ${t.accentSoft}, transparent 60%)`,
            }}>
                <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="td-askbar" style={{
                    display: 'flex', alignItems: 'center', gap: 10, height: 52, padding: '0 6px 0 8px', borderRadius: 13,
                    background: t.panelAlt, border: '1px solid ' + t.lineStrong,
                }}>
                    <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: t.accentBtn, color: t.onAccent, flexShrink: 0 }}>
                        <MessageSquareText size={16} strokeWidth={2} />
                    </span>
                    <label htmlFor="td-ask" style={SR_ONLY}>Ask EdgeAI about your company</label>
                    <input id="td-ask" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
                        placeholder="Ask anything about your company, or tell EdgeAI what to do"
                        style={{ flex: 1, minWidth: 0, height: '100%', background: 'none', border: 'none', outline: 'none', fontFamily: MONO, fontSize: 14.5, color: t.text }} />
                    <button type="submit" disabled={!q.trim() || assistant.streaming} aria-label="Ask" title="Ask" style={{
                        width: 38, height: 38, borderRadius: 10, border: 'none', display: 'grid', placeItems: 'center', flexShrink: 0,
                        background: q.trim() ? t.accentBtn : t.raised, color: q.trim() ? t.onAccent : t.faint,
                        cursor: q.trim() ? 'pointer' : 'default',
                    }}><ArrowUp aria-hidden="true" size={17} strokeWidth={2.2} /></button>
                </form>
                <div role="group" aria-label="Suggested questions" style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
                    {suggestedQuestions(model).map((x) => (
                        <button key={x} type="button" className="td-chip" onClick={() => ask(x)} disabled={assistant.streaming} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 30, padding: '0 12px', borderRadius: 99,
                            border: '1px solid ' + t.line, background: t.panelAlt, color: t.dim, fontFamily: MONO, fontSize: 12.5, cursor: 'pointer',
                        }}>{x}<ArrowUpRight aria-hidden="true" size={12} /></button>
                    ))}
                </div>
            </section>

            {/* ── snapshot ─────────────────────────────────────────────── */}
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                <Tile icon={Wallet} label="Net Cash" value={headline(s.netCash)} tone={s.netCash < 0 ? 'down' : undefined}
                    foot={`${headline(s.cashIn)} in · ${headline(s.cashOut)} out, all time`} onClick={go('/financials/general-ledger')} />
                <Tile icon={HandCoins} label="Owed to You" value={headline(s.receivable)}
                    foot={s.overdueCount ? `${s.overdueCount} overdue · ${headline(s.overdueValue)}` : 'Nothing overdue'}
                    tone={s.overdueCount ? 'down' : undefined} onClick={go('/clients/billing/invoices')} />
                <Tile icon={Truck} label="You Owe Vendors" value={headline(s.payable)}
                    foot={s.billsThisWeek ? `${s.billsThisWeek} due this week · ${headline(s.billsThisWeekValue)}` : 'No bills due this week'}
                    onClick={go('/financials/general-ledger')} />
                <Tile icon={ListChecks} label="Open Tasks" value={String(s.openTasks)} tone={s.lateTasks ? 'down' : undefined}
                    foot={`${s.lateTasks} overdue · ${s.todayTasks} due today`} onClick={go('/projects/tasks')} />
            </div>

            {/* ── briefing ─────────────────────────────────────────────── */}
            <Card title="Today's Briefing" icon={Target} note="Worked out from your records just now. Click a line to open it.">
                <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                    <BriefCol icon={AlertTriangle} title="Needs Attention" count={model.attention.length} tone="down">
                        {attention.length === 0 && <Quiet>Nothing is late or off track.</Quiet>}
                        {attention.map((a) => (
                            <Item key={a.id} compact icon={KIND_ICON[a.kind]} tone={a.tone} title={a.title} sub={a.sub} value={a.value} onClick={go(a.to)} />
                        ))}
                        {moreAttention > 0 && <Quiet>And {moreAttention} more. The oldest and largest are shown first.</Quiet>}
                    </BriefCol>
                    <BriefCol icon={Target} title="Do These First" count={0} tone="accent">
                        {model.priorities.length === 0 && <Quiet>Nothing urgent. A good day to plan ahead.</Quiet>}
                        {model.priorities.map((p, i) => (
                            <button key={p.id} type="button" onClick={go(p.to)} className="td-item" style={{
                                display: 'flex', alignItems: 'flex-start', gap: 11, width: '100%', textAlign: 'left', padding: '9px 8px',
                                border: 'none', borderRadius: 11, background: 'transparent', fontFamily: MONO, color: t.text, cursor: 'pointer',
                            }}>
                                <span aria-hidden="true" style={{
                                    width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 700,
                                    background: i === 0 ? t.accentBtn : t.raised, color: i === 0 ? t.onAccent : t.text,
                                }}>{i + 1}</span>
                                <span style={{ flex: 1, minWidth: 0 }}>
                                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{p.title}</span>
                                    <span style={{ display: 'block', fontSize: 12, color: t.faint, marginTop: 2, lineHeight: 1.45 }}>{p.why}</span>
                                </span>
                            </button>
                        ))}
                    </BriefCol>
                    <BriefCol icon={TrendingUp} title="Going Well" count={0} tone="up">
                        {model.wins.length === 0 && <Quiet>Nothing to celebrate yet. Settled invoices, won deals and finished tasks show up here.</Quiet>}
                        {model.wins.map((w) => (
                            <div key={w.id} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '9px 8px' }}>
                                <span aria-hidden="true" style={{ width: 8, height: 8, marginTop: 6, borderRadius: 99, background: t.up, flexShrink: 0, boxShadow: `0 0 0 3px color-mix(in srgb, ${t.up} 18%, transparent)` }} />
                                <span style={{ minWidth: 0 }}>
                                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500 }}>{w.title}</span>
                                    <span style={{ display: 'block', fontSize: 12, color: t.faint, marginTop: 2 }}>{w.sub}</span>
                                </span>
                            </div>
                        ))}
                    </BriefCol>
                </div>
            </Card>

            {/* ── decisions and the week ───────────────────────────────── */}
            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
                <Card title="Waiting on You" icon={Inbox} note="Decisions nobody else can make"
                    right={model.decisions.length ? <Status tone="warn">{model.decisions.reduce((a, d) => a + d.count, 0)} Open</Status> : null}>
                    {model.decisions.length === 0 && <Quiet>Nothing is waiting on you{leaveKnown ? '' : ' (leave requests could not be checked)'}.</Quiet>}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {model.decisions.map((d) => {
                            const Icon = KIND_ICON[d.kind] || Inbox;
                            return (
                                <div key={d.id} style={{
                                    display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderRadius: 13,
                                    background: t.panelAlt, border: '1px solid ' + t.line, flexWrap: 'wrap',
                                }}>
                                    <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 11, display: 'grid', placeItems: 'center', background: t.accentSoft, color: t.accent, flexShrink: 0 }}>
                                        <Icon size={16} strokeWidth={2} />
                                    </span>
                                    <span style={{ flex: '1 1 180px', minWidth: 0 }}>
                                        <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{d.title}</span>
                                        <span style={{ display: 'block', fontSize: 12.5, color: t.faint, marginTop: 2 }}>{d.sub}</span>
                                    </span>
                                    <Btn size="sm" onClick={go(d.to)} aria-label={`${d.action}: ${d.title}`}>{d.action}</Btn>
                                </div>
                            );
                        })}
                    </div>
                </Card>

                <Card title="This Week" icon={CalendarDays} note="Due in the next seven days">
                    {model.agenda.length === 0 && <Quiet>Nothing falls due in the next seven days.</Quiet>}
                    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {model.agenda.map((g, gi) => (
                            <li key={g.day} style={{ display: 'grid', gridTemplateColumns: '78px 14px minmax(0, 1fr)', gap: 10 }}>
                                <div style={{ textAlign: 'right', paddingTop: 10 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: gi === 0 && g.label === 'Today' ? t.accent : t.text }}>{g.label}</div>
                                    <div style={{ fontSize: 11.5, color: t.faint, marginTop: 1 }}>{g.date}</div>
                                </div>
                                <div aria-hidden="true" style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                                    <span style={{ position: 'absolute', top: gi === 0 ? 16 : 0, bottom: gi === model.agenda.length - 1 ? 'auto' : 0, height: gi === model.agenda.length - 1 ? 16 : undefined, width: 2, background: t.line }} />
                                    <span style={{ position: 'relative', marginTop: 13, width: 11, height: 11, borderRadius: 99, background: t.card, border: '2.5px solid ' + (g.label === 'Today' ? t.accent : t.lineStrong) }} />
                                </div>
                                <div style={{ paddingBottom: 8, minWidth: 0 }}>
                                    {g.items.map((x) => (
                                        <Item key={x.id} compact icon={KIND_ICON[x.kind]} tone={x.kind === 'leave' ? 'accent' : x.kind === 'invoice' ? 'up' : undefined}
                                            title={x.title} sub={x.sub} value={x.value} onClick={go(x.to)} />
                                    ))}
                                </div>
                            </li>
                        ))}
                    </ol>
                </Card>
            </div>

            {/* ── people and activity ──────────────────────────────────── */}
            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
                <Card title="Who's Out" icon={UserMinus} note="On approved leave today">
                    {!leaveKnown && <Quiet>Leave could not be checked for your account.</Quiet>}
                    {leaveKnown && model.outToday.length === 0 && <Quiet>Everyone is in today.</Quiet>}
                    {model.outToday.map((p) => (
                        <Item key={p.id} compact icon={Plane} tone="accent" title={p.name}
                            sub={p.until === model.today ? 'Back tomorrow' : 'Until ' + new Date(`${p.until}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                            onClick={go('/company/attendance/leave')} />
                    ))}
                </Card>
                <Card title="Recent Activity" icon={Bell} note="The latest from clients, documents and payments">
                    {model.activity.length === 0 && <Quiet>No activity yet.</Quiet>}
                    {model.activity.map((n) => (
                        <div key={n.id} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '9px 8px', borderBottom: '1px solid ' + t.lineSoft }}>
                            <span aria-hidden="true" style={{ width: 7, height: 7, marginTop: 6, borderRadius: 99, background: n.read ? t.ghost : t.accent, flexShrink: 0 }} />
                            <span style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500 }}>{n.title}</span>
                                {n.message && <span style={{ display: 'block', fontSize: 12, color: t.faint, marginTop: 2, lineHeight: 1.45 }}>{n.message}</span>}
                            </span>
                            <span style={{ fontSize: 11.5, color: t.faint, whiteSpace: 'nowrap' }}>{n.when}</span>
                        </div>
                    ))}
                </Card>
            </div>

            <DashStyle t={t} />
            <style>{`
                .td-page .td-item { transition: background .14s; }
                .td-page .td-item:hover { background: ${t.raised} !important; }
                .td-page .td-item .td-arrow { transition: transform .15s, color .15s; }
                .td-page .td-item:hover .td-arrow { transform: translateX(3px); color: ${t.accent} !important; }
                .td-page .td-chip:hover:not(:disabled) { color: ${t.text} !important; border-color: ${t.lineStrong} !important; }
                .td-page .td-chip:disabled { opacity: .5; cursor: default; }
                .td-page .td-askbar:focus-within { border-color: ${t.ghost} !important; }
                .td-page .td-askbar input:focus, .td-page .td-askbar input:focus-visible { outline: none !important; box-shadow: none !important; border-color: transparent !important; }
                .td-page .td-askbar input::placeholder { color: ${t.faint}; }
            `}</style>
        </div>
    );
}

const SR_ONLY = {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
    overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};
