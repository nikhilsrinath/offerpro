import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Wallet, HandCoins, Truck, ListChecks, ArrowUp, ArrowUpRight, ChevronRight,
    Receipt, FolderKanban, FileText, Flag, CheckSquare, Plane, Clock, Sparkles,
    Plus, ArrowDownLeft,
} from 'lucide-react';
import { MONO, useT } from '../ui/edgeUtils';
import { Btn, Loading, Avatar } from '../ui/edge';
import { useOrg } from '../../context/OrgContext';
import { useAssistant } from '../assistant/assistantStore';
import { headline } from '../hub/format';
import { useTodayData } from './useTodayData';
import { suggestedQuestions } from './todayModel';

/* ══════════════════════════════════════════════════════════════════════════
   Today: the owner's first page of the day.

   One header with the day's summary and the everyday actions, one strip of
   figures, then two columns: on the left what is late and what falls due this
   week; on the right what is waiting on the owner, a question box for EdgeAI,
   who is out and the latest activity. Every line is one record and opens
   where it can be dealt with.

   Everything here is counted from the org's own records (todayModel), so the
   page never says more than the books do.
   ══════════════════════════════════════════════════════════════════════════ */

const KIND_ICON = {
    invoice: Receipt, project: FolderKanban, bill: Truck, milestone: Flag, task: CheckSquare,
    leave: Plane, payment: HandCoins, quotation: FileText, timesheet: Clock, draft: FileText,
};

const warnOf = (t) => (t.isDark ? '#e0a020' : '#b26b00');
const toneColor = (t, tone) => (tone === 'down' ? t.down : tone === 'warn' ? warnOf(t) : tone === 'up' ? t.up : tone === 'accent' ? t.accent : t.dim);

const PAD_X = 14;
const ATTN_MAX = 7;
const ACTIVITY_MAX = 5;

function greeting(d = new Date()) {
    const h = d.getHours();
    return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
}

/* A section of the page: a plain heading bar with a count, then its rows. */
function Section({ title, count, right, children, label }) {
    const t = useT();
    return (
        <section aria-label={label || title} style={{
            minWidth: 0, background: t.card, border: '1px solid ' + t.line, borderRadius: 12, overflow: 'hidden',
        }}>
            <header style={{
                display: 'flex', alignItems: 'center', gap: 8, height: 42, padding: `0 ${PAD_X}px`,
                borderBottom: '1px solid ' + t.lineSoft,
            }}>
                <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '-0.005em', color: t.text }}>{title}</h2>
                {count > 0 && (
                    <span style={{
                        minWidth: 20, height: 18, padding: '0 6px', borderRadius: 99, display: 'grid', placeItems: 'center',
                        fontSize: 11, fontWeight: 600, color: t.dim, background: t.panelAlt, border: '1px solid ' + t.line,
                        fontVariantNumeric: 'tabular-nums',
                    }}>{count}</span>
                )}
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>{right}</span>
            </header>
            {children}
        </section>
    );
}

/* One record: a small toned icon, what it is and why, what it is worth. */
function Row({ icon: Icon, tone, title, sub, value, valueTone, onClick, lead, trail, first }) {
    const t = useT();
    const c = toneColor(t, tone);
    const Tag = onClick ? 'button' : 'div';
    return (
        <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={onClick ? 'td-row td-row-on' : 'td-row'} style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 46, textAlign: 'left',
            padding: `7px ${PAD_X}px`, border: 'none', borderTop: first ? 'none' : '1px solid ' + t.lineSoft,
            background: 'transparent', fontFamily: MONO, color: t.text, cursor: onClick ? 'pointer' : 'default',
        }}>
            {lead || (Icon && (
                <span aria-hidden="true" style={{
                    width: 26, height: 26, borderRadius: 7, flexShrink: 0, display: 'grid', placeItems: 'center',
                    color: c, background: `color-mix(in srgb, ${c} ${t.isDark ? 16 : 10}%, transparent)`,
                }}><Icon size={13} strokeWidth={2} /></span>
            ))}
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500, lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
                {sub && <span style={{ display: 'block', fontSize: 11.5, color: t.faint, lineHeight: 1.35, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>}
            </span>
            {value && (
                <span style={{
                    fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
                    color: valueTone === 'down' ? t.down : t.text,
                }}>{value}</span>
            )}
            {trail}
            {onClick && !trail && <ChevronRight aria-hidden="true" size={13} className="td-chev" style={{ color: t.ghost, flexShrink: 0 }} />}
        </Tag>
    );
}

function Quiet({ children }) {
    const t = useT();
    return <p style={{ margin: 0, padding: `14px ${PAD_X}px`, fontSize: 12, color: t.faint, lineHeight: 1.5 }}>{children}</p>;
}

/* One figure in the strip at the top. */
function Figure({ icon: Icon, label, value, foot, tone, footTone = tone, onClick }) {
    const t = useT();
    return (
        <button type="button" onClick={onClick} className="td-fig"
            aria-label={`${label}: ${value}. ${foot}. Open detail`}
            style={{
                display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, textAlign: 'left',
                padding: `12px 16px`, border: 'none', background: t.card, fontFamily: MONO, color: t.text, cursor: 'pointer',
            }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: t.dim }}>
                <Icon aria-hidden="true" size={13} strokeWidth={2} style={{ color: t.faint }} />{label}
            </span>
            <span style={{
                fontSize: 20, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.1,
                fontVariantNumeric: 'tabular-nums', color: tone === 'down' ? t.down : t.text,
            }}>{value}</span>
            <span style={{ fontSize: 11.5, color: footTone === 'down' ? t.down : t.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{foot}</span>
        </button>
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
    const dateLine = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const dueToday = model.agenda[0]?.day === model.today ? model.agenda[0].items.length : 0;

    const summary = [
        model.needsYou ? `${model.needsYou} ${model.needsYou === 1 ? 'thing needs' : 'things need'} you` : 'Nothing is late and nothing is waiting on you',
        s.overdueValue > 0 ? `${headline(s.overdueValue)} overdue from clients` : null,
        dueToday ? `${dueToday} due today` : null,
    ].filter(Boolean).join(' · ');

    // The question goes to EdgeAI as a new chat, and the AI page shows it.
    const ask = (text) => {
        const v = String(text || '').trim();
        if (!v) return;
        if (assistant.askNew(v) !== false) navigate('/ai');
    };
    const go = (to) => () => navigate(to);

    const attention = model.attention.slice(0, ATTN_MAX);
    const moreAttention = model.attention.length - attention.length;
    const waiting = model.decisions.reduce((a, d) => a + d.count, 0);
    const weekCount = model.agenda.reduce((a, g) => a + g.items.length, 0);
    const activity = model.activity.slice(0, ACTIVITY_MAX);

    return (
        <div className="td-page" style={{ fontFamily: MONO, color: t.text, maxWidth: 1320, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* ── header: the day, and the everyday actions ─────────────── */}
            <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: '1 1 360px' }}>
                    <div style={{ fontSize: 12, color: t.faint, marginBottom: 4 }}>{dateLine}</div>
                    <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.25 }}>{greeting(now)}, {name}</h2>
                    <p style={{ margin: '4px 0 0', fontSize: 12.5, color: t.dim, lineHeight: 1.5 }}>{summary}</p>
                </div>
                <div role="group" aria-label="Quick actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Btn onClick={go('/financials/general-ledger?new=in')}><ArrowDownLeft aria-hidden="true" size={14} />Record Credit</Btn>
                    <Btn onClick={go('/financials/general-ledger?new=out')}><ArrowUpRight aria-hidden="true" size={14} />Record Debit</Btn>
                    <Btn onClick={go('/clients/billing/quotations/new')}><FileText aria-hidden="true" size={14} />New Quotation</Btn>
                    <Btn primary onClick={go('/clients/billing/invoices/new')}><Plus aria-hidden="true" size={14} />Create Invoice</Btn>
                </div>
            </header>

            {loadError && (
                <div role="alert" style={{ fontSize: 12.5, color: t.down, padding: '8px 12px', borderRadius: 8, border: `1px solid color-mix(in srgb, ${t.down} 30%, transparent)`, background: `color-mix(in srgb, ${t.down} 6%, transparent)` }}>
                    Some records could not be loaded: {loadError}. What is shown is the last copy saved in this browser.
                </div>
            )}

            {/* ── the figures ──────────────────────────────────────────── */}
            <div className="td-figs" style={{
                display: 'grid', gap: 1, background: t.line, border: '1px solid ' + t.line, borderRadius: 12, overflow: 'hidden',
            }}>
                <Figure icon={Wallet} label="Net Cash" value={headline(s.netCash)} tone={s.netCash < 0 ? 'down' : undefined} footTone="neutral"
                    foot={`${headline(s.cashIn)} in · ${headline(s.cashOut)} out, all time`} onClick={go('/financials/general-ledger')} />
                <Figure icon={HandCoins} label="Owed to You" value={headline(s.receivable)}
                    foot={s.overdueCount ? `${s.overdueCount} overdue · ${headline(s.overdueValue)}` : 'Nothing overdue'}
                    tone={s.overdueCount ? 'down' : undefined} onClick={go('/clients/billing/invoices')} />
                <Figure icon={Truck} label="You Owe Vendors" value={headline(s.payable)}
                    foot={s.billsThisWeek ? `${s.billsThisWeek} due this week · ${headline(s.billsThisWeekValue)}` : 'No bills due this week'}
                    onClick={go('/vendors/general-ledger')} />
                <Figure icon={ListChecks} label="Open Tasks" value={String(s.openTasks)} tone={s.lateTasks ? 'down' : undefined}
                    foot={`${s.lateTasks} overdue · ${s.todayTasks} due today`} onClick={go('/projects/tasks')} />
            </div>

            {/* ── the work ─────────────────────────────────────────────── */}
            <div className="td-cols">
                <div className="td-col">
                    <Section title="Needs Attention" count={model.attention.length}
                        right={<span style={{ fontSize: 11.5, color: t.faint }}>Late or off track</span>}>
                        {attention.length === 0 && <Quiet>Nothing is late or off track.</Quiet>}
                        {attention.map((a, i) => (
                            <Row key={a.id} first={i === 0} icon={KIND_ICON[a.kind]} tone={a.tone} title={a.title} sub={a.sub}
                                value={a.value} valueTone={a.kind === 'invoice' ? 'down' : undefined} onClick={go(a.to)} />
                        ))}
                        {moreAttention > 0 && (
                            <div style={{ padding: `9px ${PAD_X}px`, borderTop: '1px solid ' + t.lineSoft, fontSize: 11.5, color: t.faint, background: t.panelAlt }}>
                                {moreAttention} more. The oldest and largest are shown first.
                            </div>
                        )}
                    </Section>

                    <Section title="This Week" count={weekCount}
                        right={<span style={{ fontSize: 11.5, color: t.faint }}>Next seven days</span>}>
                        {model.agenda.length === 0 && <Quiet>Nothing falls due in the next seven days.</Quiet>}
                        {model.agenda.map((g, gi) => (
                            <div key={g.day}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 8, height: 28, padding: `0 ${PAD_X}px`,
                                    background: t.panelAlt, fontSize: 11.5, fontWeight: 600,
                                    borderTop: gi === 0 ? 'none' : '1px solid ' + t.lineSoft, borderBottom: '1px solid ' + t.lineSoft,
                                    color: g.label === 'Today' ? t.accent : t.dim,
                                }}>
                                    {g.label}
                                    <span style={{ fontWeight: 400, color: t.faint }}>{g.date}</span>
                                    <span style={{ marginLeft: 'auto', fontWeight: 500, color: t.faint, fontVariantNumeric: 'tabular-nums' }}>{g.items.length}</span>
                                </div>
                                {g.items.map((x, i) => (
                                    <Row key={x.id} first={i === 0} icon={KIND_ICON[x.kind]}
                                        tone={x.kind === 'leave' ? 'accent' : x.kind === 'invoice' ? 'up' : x.kind === 'bill' ? 'warn' : undefined}
                                        title={x.title} sub={x.sub} value={x.value} onClick={go(x.to)} />
                                ))}
                            </div>
                        ))}
                    </Section>

                    <Section title="Recent Activity">
                        {activity.length === 0 && <Quiet>No activity yet.</Quiet>}
                        {activity.map((n, i) => (
                            <Row key={n.id} first={i === 0} title={n.title} sub={n.message || null}
                                lead={<span aria-hidden="true" style={{ width: 26, display: 'grid', placeItems: 'center', flexShrink: 0 }}><span style={{ width: 7, height: 7, borderRadius: 99, background: n.read ? t.lineStrong : t.accent }} /></span>}
                                trail={<span style={{ fontSize: 11, color: t.faint, whiteSpace: 'nowrap' }}>{n.when}</span>} />
                        ))}
                    </Section>
                </div>

                <div className="td-col">
                    <Section title="Waiting on You" count={waiting}>
                        {model.decisions.length === 0 && <Quiet>Nothing is waiting on you{leaveKnown ? '' : ' (leave requests could not be checked)'}.</Quiet>}
                        {model.decisions.map((d, i) => (
                            <Row key={d.id} first={i === 0} icon={KIND_ICON[d.kind]} tone="accent" title={d.title} sub={d.sub}
                                trail={<Btn size="sm" onClick={go(d.to)} aria-label={`${d.action}: ${d.title}`}>{d.action}</Btn>} />
                        ))}
                    </Section>

                    <Section title="Ask EdgeAI" label="Ask EdgeAI about your company">
                        <form onSubmit={(e) => { e.preventDefault(); ask(q); }} style={{ padding: `12px ${PAD_X}px 6px` }}>
                            <div className="td-ask" style={{
                                display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 4px 0 10px', borderRadius: 8,
                                background: t.card, border: '1px solid ' + t.lineStrong,
                            }}>
                                <Sparkles aria-hidden="true" size={14} style={{ color: t.accent, flexShrink: 0 }} />
                                <label htmlFor="td-ask" style={SR_ONLY}>Ask EdgeAI about your company</label>
                                <input id="td-ask" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
                                    placeholder="Ask about your company…"
                                    style={{ flex: 1, minWidth: 0, height: '100%', background: 'none', border: 'none', outline: 'none', fontFamily: MONO, fontSize: 12.5, color: t.text }} />
                                <button type="submit" disabled={!q.trim() || assistant.streaming} aria-label="Ask" title="Ask" style={{
                                    width: 28, height: 28, borderRadius: 6, border: 'none', display: 'grid', placeItems: 'center', flexShrink: 0,
                                    background: q.trim() ? t.accent : t.panelAlt, color: q.trim() ? t.onAccent : t.ghost,
                                    cursor: q.trim() ? 'pointer' : 'default',
                                }}><ArrowUp aria-hidden="true" size={14} strokeWidth={2.2} /></button>
                            </div>
                        </form>
                        <ul aria-label="Suggested questions" style={{ listStyle: 'none', margin: 0, padding: '0 0 6px' }}>
                            {suggestedQuestions(model).slice(0, 3).map((x) => (
                                <li key={x}>
                                    <button type="button" className="td-sugg" onClick={() => ask(x)} disabled={assistant.streaming} style={{
                                        display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 30, padding: `5px ${PAD_X}px`,
                                        border: 'none', background: 'transparent', textAlign: 'left', fontFamily: MONO, fontSize: 12, color: t.dim, cursor: 'pointer',
                                    }}>
                                        <span style={{ flex: 1, minWidth: 0 }}>{x}</span>
                                        <ArrowUpRight aria-hidden="true" size={12} style={{ color: t.ghost, flexShrink: 0 }} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </Section>

                    <Section title="Who's Out" count={model.outToday.length}>
                        {!leaveKnown && <Quiet>Leave could not be checked for your account.</Quiet>}
                        {leaveKnown && model.outToday.length === 0 && <Quiet>Everyone is in today.</Quiet>}
                        {model.outToday.map((p, i) => (
                            <Row key={p.id} first={i === 0} lead={<Avatar name={p.name} size={26} />} title={p.name}
                                sub={p.until === model.today ? 'Back tomorrow' : 'Until ' + new Date(`${p.until}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                onClick={go('/company/attendance/leave')} />
                        ))}
                    </Section>

                    {model.wins.length > 0 && (
                        <Section title="Going Well">
                            {model.wins.map((w, i) => (
                                <Row key={w.id} first={i === 0} title={w.title} sub={w.sub}
                                    lead={<span aria-hidden="true" style={{ width: 26, display: 'grid', placeItems: 'center', flexShrink: 0 }}><span style={{ width: 7, height: 7, borderRadius: 99, background: t.up }} /></span>} />
                            ))}
                        </Section>
                    )}

                </div>
            </div>

            <style>{`
                .td-page .td-figs { grid-template-columns: repeat(4, minmax(0, 1fr)); }
                .td-page .td-cols { display: grid; gap: 16px; align-items: start; grid-template-columns: minmax(0, 1fr) minmax(300px, 360px); }
                .td-page .td-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
                @media (max-width: 1080px) { .td-page .td-cols { grid-template-columns: minmax(0, 1fr); } }
                @media (max-width: 760px) { .td-page .td-figs { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
                .td-page .td-fig, .td-page .td-row-on, .td-page .td-sugg { transition: background .12s; }
                .td-page .td-fig:hover, .td-page .td-row-on:hover, .td-page .td-sugg:hover:not(:disabled) { background: ${t.panelAlt} !important; }
                .td-page .td-row-on .td-chev { transition: transform .15s, color .15s; }
                .td-page .td-row-on:hover .td-chev { transform: translateX(2px); color: ${t.dim} !important; }
                .td-page .td-sugg:hover:not(:disabled) { color: ${t.text} !important; }
                .td-page .td-sugg:disabled { opacity: .5; cursor: default; }
                .td-page .td-ask:focus-within { border-color: ${t.ghost} !important; }
                .td-page .td-ask input:focus, .td-page .td-ask input:focus-visible { outline: none !important; box-shadow: none !important; border-color: transparent !important; }
                .td-page .td-ask input::placeholder { color: ${t.faint}; }
            `}</style>
        </div>
    );
}

const SR_ONLY = {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
    overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};
