import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, SlidersHorizontal, Repeat, MapPin } from 'lucide-react';
import { Page, Btn, Seg, Modal, Loading, Empty, Panel } from '../ui/edge';
import { MONO, useT } from '../ui/edgeUtils';
import { useToast } from '../shared/Toast';
import { workspaceService } from '../../services/workspaceService';
import {
    SOURCES, localDay, addDays, addMonths, dayDate, daysBetween, monthGrid, weekDays, viewRange, step, rangeTitle,
    itemsByDay, layoutTimed, timeText, monthStart,
} from './calendarModel';
import { useCalendarData } from './useCalendarData';
import EventPanel from './EventPanel';
import { IconBtn, WorkspaceStyle } from './workspaceUi';
import { SOURCE_ICON, itemColor } from './workspaceTheme';
import { prefSet } from '../../services/userPrefs';

/* ══════════════════════════════════════════════════════════════════════════
   Calendar. Month, Week, Day and Agenda over one set of items: the person's
   own events and tasks, and every date the company's records carry. The
   side column has a small month to jump with and the list of what to show,
   each with how many it has in view.

   · Click an empty day (month) or slot (week, day) to add an event there.
   · Click an event to edit it; a company date opens the record it is from.
   · Drag your own event to another day or time to move it.
   · Keys: T today, ←/→ previous/next, M W D A views, N new event.

   The view and date are in the address (?view=week&date=2026-11-13), so
   Back and a shared link land on the same place.
   ══════════════════════════════════════════════════════════════════════════ */

const VIEWS = [
    { id: 'month', label: 'Month' }, { id: 'week', label: 'Week' },
    { id: 'day', label: 'Day' }, { id: 'agenda', label: 'Agenda' },
];
const VIEW_KEYS = { m: 'month', w: 'week', d: 'day', a: 'agenda' };
const HOUR = 48;
const MONTH_CHIPS = 3;
const HIDDEN_KEY = 'opstead.calendar.hidden';
const GROUP_LABEL = { mine: 'Mine', work: 'Work', money: 'Money', people: 'People' };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const readHidden = () => {
    try { const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};
const writeHidden = (v) => prefSet(HIDDEN_KEY, JSON.stringify(v));
const validIso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(dayDate(v).getTime());
const isTyping = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);

function useToday() {
    const [today, setToday] = useState(() => localDay());
    useEffect(() => {
        const id = setInterval(() => setToday(localDay()), 60000);
        return () => clearInterval(id);
    }, []);
    return today;
}

/* ── one item, as a chip (month cells, the all-day row, the day list) ─────── */

function Chip({ it, day, onOpen, compact, draggable }) {
    const t = useT();
    const c = itemColor(t, it);
    const timed = it.kind === 'event' && !it.allDay;
    const multi = it.endDay !== it.day;
    const contLeft = multi && day > it.day;
    const contRight = multi && day < it.endDay;
    const label = timed ? `${timeText(it, day)} ${it.title}` : (it.time ? `${it.time} ${it.title}` : it.title);
    return (
        <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(it); }}
            draggable={draggable}
            onDragStart={draggable ? (e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/x-ws-event', JSON.stringify({ id: it.eventId, from: it.day }));
            } : undefined}
            title={[label, it.sub, it.value].filter(Boolean).join(' · ')}
            aria-label={[label, it.sub, it.value, it.late ? 'late' : '', it.done ? 'done' : ''].filter(Boolean).join(', ')}
            className="cal-chip"
            style={{
                display: 'flex', alignItems: 'center', gap: 5, width: '100%', minWidth: 0, height: compact ? 20 : 22,
                padding: timed ? '0 6px' : '0 6px 0 7px', border: 'none', cursor: 'pointer', textAlign: 'left',
                fontFamily: MONO, fontSize: 11.5, lineHeight: 1, color: it.late ? t.down : t.text,
                borderRadius: `${contLeft ? 0 : 5}px ${contRight ? 0 : 5}px ${contRight ? 0 : 5}px ${contLeft ? 0 : 5}px`,
                background: timed ? 'transparent' : `color-mix(in srgb, ${c} ${t.isDark ? 22 : 13}%, transparent)`,
                boxShadow: timed || contLeft ? 'none' : `inset 3px 0 0 ${c}`,
                opacity: it.done ? 0.6 : 1,
            }}>
            {timed && <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: c, flexShrink: 0 }} />}
            {timed && <span style={{ color: t.faint, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{timeText(it, day).split(' ')[0]}</span>}
            {it.time && !timed && <span style={{ color: t.faint, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{it.time}</span>}
            <span style={{
                flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500,
                textDecoration: it.done ? 'line-through' : 'none', visibility: contLeft ? 'hidden' : 'visible',
            }}>{it.title}</span>
        </button>
    );
}

/* ── month ────────────────────────────────────────────────────────────────── */

function MonthView({ cursor, today, byDay, onOpen, onNew, onMore, onMove }) {
    const t = useT();
    const days = monthGrid(cursor);
    const month = cursor.slice(0, 7);
    const [over, setOver] = useState(null);
    return (
        <div role="grid" aria-label={rangeTitle('month', cursor)} className="cal-month" style={{
            border: '1px solid ' + t.line, borderRadius: 12, background: t.card, overflow: 'hidden',
            display: 'grid', gridTemplateRows: '30px repeat(6, minmax(104px, 1fr))',
        }}>
            <div role="row" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: '1px solid ' + t.line, background: t.panelAlt }}>
                {DOW.map((d, i) => (
                    <div key={d} role="columnheader" style={{
                        display: 'grid', placeItems: 'center', fontSize: 11.5, fontWeight: 600, color: i > 4 ? t.faint : t.dim,
                    }}>{d}</div>
                ))}
            </div>
            {Array.from({ length: 6 }, (_, w) => (
                <div key={w} role="row" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: w < 5 ? '1px solid ' + t.lineSoft : 'none', minHeight: 0 }}>
                    {days.slice(w * 7, w * 7 + 7).map((d, i) => {
                        const list = byDay.get(d) || [];
                        const shown = list.slice(0, list.length > MONTH_CHIPS ? MONTH_CHIPS - 1 : MONTH_CHIPS);
                        const more = list.length - shown.length;
                        const inMonth = d.slice(0, 7) === month;
                        const isToday = d === today;
                        const dt = dayDate(d);
                        return (
                            <div key={d} role="gridcell" aria-label={dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + (list.length ? `, ${list.length} items` : '')}
                                onClick={() => onNew({ day: d, allDay: false })}
                                onDragOver={(e) => { if (e.dataTransfer.types.includes('text/x-ws-event')) { e.preventDefault(); setOver(d); } }}
                                onDragLeave={() => setOver((o) => (o === d ? null : o))}
                                onDrop={(e) => {
                                    e.preventDefault(); setOver(null);
                                    try { const p = JSON.parse(e.dataTransfer.getData('text/x-ws-event')); onMove(p.id, daysBetween(p.from, d) * 86400000); } catch { /* not an event */ }
                                }}
                                className="cal-cell"
                                style={{
                                    minWidth: 0, minHeight: 0, padding: '4px 4px 5px', display: 'flex', flexDirection: 'column', gap: 2, cursor: 'pointer',
                                    borderRight: i < 6 ? '1px solid ' + t.lineSoft : 'none', overflow: 'hidden',
                                    background: over === d ? `color-mix(in srgb, ${t.teal} 9%, transparent)` : inMonth ? 'transparent' : `color-mix(in srgb, ${t.panelAlt} 70%, transparent)`,
                                }}>
                                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 1 }}>
                                    <span style={{
                                        minWidth: 24, height: 24, padding: '0 5px', borderRadius: 99, display: 'grid', placeItems: 'center', boxSizing: 'border-box',
                                        fontSize: 12, fontWeight: isToday ? 700 : 500, fontVariantNumeric: 'tabular-nums',
                                        background: isToday ? t.teal : 'transparent', color: isToday ? t.onTeal : inMonth ? t.text : t.ghost,
                                    }}>{dt.getDate() === 1 ? dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : dt.getDate()}</span>
                                </div>
                                {shown.map((it) => <Chip key={it.key} it={it} day={d} onOpen={onOpen} compact draggable={it.kind === 'event'} />)}
                                {more > 0 && (
                                    <button type="button" className="ws-ghost-btn" onClick={(e) => { e.stopPropagation(); onMore(d); }} style={{
                                        height: 20, border: 'none', background: 'transparent', textAlign: 'left', padding: '0 6px', borderRadius: 5,
                                        fontFamily: MONO, fontSize: 11.5, fontWeight: 600, color: t.dim, cursor: 'pointer',
                                    }}>{more} more</button>
                                )}
                            </div>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}

/* ── week and day: an all-day row over a 24-hour grid ───────────────────── */

function TimeGrid({ days, today, byDay, onOpen, onNew, onMove, onMore }) {
    const t = useT();
    const scrollRef = useRef(null);
    const [now, setNow] = useState(() => new Date());
    const [over, setOver] = useState(null);
    useEffect(() => { const id = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(id); }, []);
    // Open on the working day, or just before now when today is in view.
    const firstDay = days[0];
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const h = days.includes(localDay()) ? Math.max(0, new Date().getHours() - 1.5) : 7.5;
        el.scrollTop = h * HOUR;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [firstDay, days.length]);
    // The hour grid scrolls and the heads do not: pad the heads by the
    // scrollbar's width so the columns line up.
    const [sbw, setSbw] = useState(0);
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return undefined;
        const measure = () => setSbw(el.offsetWidth - el.clientWidth);
        measure();
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        ro?.observe(el);
        return () => ro?.disconnect();
    }, []);

    const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;
    // A timed event that runs through a whole day shows in that day's all-day row.
    const throughDay = (it, d) => it.kind === 'event' && !it.allDay && localDay(it.start) < d && it.endDay > d;
    const allDay = days.map((d) => (byDay.get(d) || []).filter((it) => it.allDay || it.kind !== 'event' || throughDay(it, d)));
    const timed = days.map((d) => layoutTimed((byDay.get(d) || []).filter((it) => it.kind === 'event' && !it.allDay && !throughDay(it, d)), d));
    const ALLDAY_MAX = 3;

    const slotAt = (e, d) => {
        const r = e.currentTarget.getBoundingClientRect();
        const min = Math.max(0, Math.min(24 * 60 - 15, Math.floor(((e.clientY - r.top) / HOUR) * 60 / 15) * 15));
        return { day: d, minutes: min };
    };

    return (
        <div style={{ border: '1px solid ' + t.line, borderRadius: 12, background: t.card, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {/* day heads */}
            <div style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: '1px solid ' + t.lineSoft, paddingRight: sbw }}>
                <div />
                {days.map((d) => {
                    const dt = dayDate(d);
                    const isToday = d === today;
                    return (
                        <div key={d} style={{ padding: '7px 4px 6px', textAlign: 'center', borderLeft: '1px solid ' + t.lineSoft }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: isToday ? t.accent : t.faint, letterSpacing: '.02em' }}>
                                {dt.toLocaleDateString('en-GB', { weekday: 'short' })}
                            </div>
                            <div style={{
                                margin: '3px auto 0', width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center',
                                fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                                background: isToday ? t.teal : 'transparent', color: isToday ? t.onTeal : t.text,
                            }}>{dt.getDate()}</div>
                        </div>
                    );
                })}
            </div>
            {/* all-day row */}
            <div style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: '1px solid ' + t.line, background: t.panelAlt, paddingRight: sbw }}>
                <div style={{ fontSize: 10.5, color: t.faint, padding: '6px 6px 0 0', textAlign: 'right' }}>All day</div>
                {days.map((d, i) => {
                    const list = allDay[i];
                    const shown = list.slice(0, list.length > ALLDAY_MAX ? ALLDAY_MAX - 1 : ALLDAY_MAX);
                    return (
                        <div key={d} onClick={() => onNew({ day: d, allDay: true })}
                            onDragOver={(e) => { if (e.dataTransfer.types.includes('text/x-ws-event')) e.preventDefault(); }}
                            onDrop={(e) => { e.preventDefault(); try { const p = JSON.parse(e.dataTransfer.getData('text/x-ws-event')); onMove(p.id, daysBetween(p.from, d) * 86400000); } catch { /* not an event */ } }}
                            style={{ minHeight: 30, padding: 3, display: 'flex', flexDirection: 'column', gap: 2, borderLeft: '1px solid ' + t.lineSoft, cursor: 'pointer', minWidth: 0 }}>
                            {shown.map((it) => <Chip key={it.key} it={it} day={d} onOpen={onOpen} compact draggable={it.kind === 'event'} />)}
                            {list.length > shown.length && (
                                <button type="button" className="ws-ghost-btn" onClick={(e) => { e.stopPropagation(); onMore(d); }} style={{
                                    height: 20, border: 'none', background: 'transparent', textAlign: 'left', padding: '0 6px', borderRadius: 5,
                                    fontFamily: MONO, fontSize: 11.5, fontWeight: 600, color: t.dim, cursor: 'pointer',
                                }}>{list.length - shown.length} more</button>
                            )}
                        </div>
                    );
                })}
            </div>
            {/* hours */}
            <div ref={scrollRef} className="edge-scroll cal-hours" style={{ overflowY: 'auto', height: 'clamp(420px, calc(100vh - 330px), 1200px)', position: 'relative' }}>
                <div style={{ display: 'grid', gridTemplateColumns: cols, height: 24 * HOUR, position: 'relative' }}>
                    <div style={{ position: 'relative' }}>
                        {Array.from({ length: 23 }, (_, h) => (
                            <span key={h} style={{
                                position: 'absolute', top: (h + 1) * HOUR - 7, right: 8, fontSize: 10.5, color: t.faint, fontVariantNumeric: 'tabular-nums',
                            }}>{String(h + 1).padStart(2, '0')}:00</span>
                        ))}
                    </div>
                    {days.map((d, i) => {
                        const isToday = d === today;
                        const nowTop = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR;
                        return (
                            <div key={d} className="cal-col"
                                onClick={(e) => onNew(slotAt(e, d))}
                                onDragOver={(e) => {
                                    if (!e.dataTransfer.types.includes('text/x-ws-event')) return;
                                    e.preventDefault();
                                    const s = slotAt(e, d);
                                    setOver(`${d}|${s.minutes}`);
                                }}
                                onDragLeave={() => setOver(null)}
                                onDrop={(e) => {
                                    e.preventDefault(); setOver(null);
                                    try {
                                        const p = JSON.parse(e.dataTransfer.getData('text/x-ws-event'));
                                        if (p.startMs == null) { onMove(p.id, daysBetween(p.from, d) * 86400000); return; }
                                        const s = slotAt(e, d);
                                        const target = dayDate(d).getTime() + (s.minutes - (p.grabMin || 0)) * 60000;
                                        onMove(p.id, target - p.startMs);
                                    } catch { /* not an event */ }
                                }}
                                style={{
                                    position: 'relative', borderLeft: '1px solid ' + t.lineSoft, cursor: 'pointer',
                                    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR - 1}px, ${t.lineSoft} ${HOUR - 1}px, ${t.lineSoft} ${HOUR}px)`,
                                }}>
                                {over && over.startsWith(d + '|') && (
                                    <div aria-hidden="true" style={{
                                        position: 'absolute', left: 2, right: 2, top: Number(over.split('|')[1]) / 60 * HOUR, height: HOUR / 2,
                                        borderRadius: 6, border: `1.5px dashed ${t.teal}`, background: `color-mix(in srgb, ${t.teal} 8%, transparent)`, pointerEvents: 'none',
                                    }} />
                                )}
                                {timed[i].map((it) => {
                                    const c = itemColor(t, it);
                                    const w = 100 / it.cols;
                                    const short = it.height < 40;
                                    return (
                                        <button key={it.key} type="button" draggable
                                            onDragStart={(e) => {
                                                const r = e.currentTarget.getBoundingClientRect();
                                                const grabMin = Math.floor(((e.clientY - r.top) / HOUR) * 60 / 15) * 15;
                                                e.dataTransfer.effectAllowed = 'move';
                                                e.dataTransfer.setData('text/x-ws-event', JSON.stringify({ id: it.eventId, from: it.day, startMs: it.start.getTime(), grabMin }));
                                            }}
                                            onClick={(e) => { e.stopPropagation(); onOpen(it); }}
                                            title={`${timeText(it, d)} · ${it.title}${it.sub ? ' · ' + it.sub : ''}`}
                                            className="cal-ev"
                                            style={{
                                                position: 'absolute', top: it.top + 1, height: it.height - 2,
                                                left: `calc(${it.col * w}% + 2px)`, width: `calc(${w}% - 4px)`,
                                                padding: short ? '1px 6px' : '4px 7px', boxSizing: 'border-box', overflow: 'hidden', textAlign: 'left',
                                                borderRadius: 6, border: `1px solid color-mix(in srgb, ${c} 40%, transparent)`, cursor: 'pointer',
                                                background: `color-mix(in srgb, ${c} ${t.isDark ? 30 : 16}%, ${t.card})`, boxShadow: `inset 3px 0 0 ${c}`,
                                                fontFamily: MONO, color: t.text, display: 'flex', flexDirection: short ? 'row' : 'column', gap: short ? 6 : 1, alignItems: short ? 'center' : 'stretch',
                                            }}>
                                            <span style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {it.title}{it.repeats && <Repeat aria-label="Repeats" size={10} style={{ marginLeft: 4, verticalAlign: '-1px', color: t.faint }} />}
                                            </span>
                                            <span style={{ fontSize: 10.5, color: t.dim, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{timeText(it, d)}</span>
                                            {!short && it.height >= 64 && it.sub && (
                                                <span style={{ fontSize: 10.5, color: t.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.sub}</span>
                                            )}
                                        </button>
                                    );
                                })}
                                {isToday && (
                                    <div aria-hidden="true" style={{ position: 'absolute', left: -1, right: 0, top: nowTop, height: 0, borderTop: `2px solid ${t.down}`, pointerEvents: 'none', zIndex: 2 }}>
                                        <span style={{ position: 'absolute', left: -5, top: -6, width: 10, height: 10, borderRadius: '50%', background: t.down }} />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

/* ── agenda: thirty days as a list ───────────────────────────────────────── */

function ItemRow({ it, day, onOpen, first }) {
    const t = useT();
    const c = itemColor(t, it);
    const Icon = SOURCE_ICON[it.source];
    return (
        <button type="button" onClick={() => onOpen(it)} className="ws-hover" style={{
            display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 44, padding: '7px 14px', textAlign: 'left',
            border: 'none', borderTop: first ? 'none' : '1px solid ' + t.lineSoft, background: 'transparent', cursor: 'pointer',
            fontFamily: MONO, color: t.text,
        }}>
            <span style={{ width: 92, flexShrink: 0, fontSize: 12, color: t.dim, fontVariantNumeric: 'tabular-nums' }}>{timeText(it, day)}</span>
            <span aria-hidden="true" style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: c, flexShrink: 0 }} />
            {Icon && <Icon aria-hidden="true" size={14} strokeWidth={1.9} style={{ color: c, flexShrink: 0 }} />}
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                    display: 'block', fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    color: it.late ? t.down : t.text, textDecoration: it.done ? 'line-through' : 'none',
                }}>{it.title}{it.repeats && <Repeat aria-label="Repeats" size={11} style={{ marginLeft: 6, verticalAlign: '-1px', color: t.faint }} />}</span>
                {(it.sub || it.endDay !== it.day) && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: t.faint, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {it.kind === 'event' && it.sub && <MapPin aria-hidden="true" size={11} />}
                        {[it.sub, it.endDay !== it.day ? `${dayDate(it.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${dayDate(it.endDay).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : null].filter(Boolean).join(' · ')}
                    </span>
                )}
            </span>
            {it.value && <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: it.late ? t.down : t.text }}>{it.value}</span>}
        </button>
    );
}

function AgendaView({ from, to, today, byDay, onOpen, onNew }) {
    const t = useT();
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) if ((byDay.get(d) || []).length) days.push(d);
    if (!days.length) {
        return <Panel><Empty action={<Btn variant="teal" onClick={() => onNew({ day: from })}>New Event</Btn>}>Nothing in the next thirty days.</Empty></Panel>;
    }
    return (
        <div style={{ border: '1px solid ' + t.line, borderRadius: 12, background: t.card, overflow: 'hidden' }}>
            {days.map((d, gi) => {
                const dt = dayDate(d);
                const rel = d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : d === addDays(today, -1) ? 'Yesterday' : null;
                const list = byDay.get(d);
                return (
                    <section key={d} aria-label={dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}>
                        <header style={{
                            display: 'flex', alignItems: 'baseline', gap: 8, padding: '8px 14px', background: t.panelAlt,
                            borderTop: gi ? '1px solid ' + t.line : 'none', borderBottom: '1px solid ' + t.lineSoft,
                        }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: d === today ? t.accent : t.text }}>
                                {rel || dt.toLocaleDateString('en-GB', { weekday: 'long' })}
                            </span>
                            <span style={{ fontSize: 12, color: t.faint }}>{dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: t.faint, fontVariantNumeric: 'tabular-nums' }}>{list.length}</span>
                        </header>
                        {list.map((it, i) => <ItemRow key={it.key + d} it={it} day={d} onOpen={onOpen} first={i === 0} />)}
                    </section>
                );
            })}
        </div>
    );
}

/* ── the side column: a small month, and what to show ────────────────────── */

function MiniMonth({ cursor, today, onPick, marked }) {
    const t = useT();
    const [shown, setShown] = useState(monthStart(cursor));
    useEffect(() => { setShown(monthStart(cursor)); }, [cursor]);
    const days = monthGrid(shown);
    const month = shown.slice(0, 7);
    return (
        <div aria-label="Pick a date">
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, paddingLeft: 4 }}>
                    {dayDate(shown).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                </span>
                <IconBtn icon={ChevronLeft} label="Previous month" size={24} onClick={() => setShown(addMonths(shown, -1))} />
                <IconBtn icon={ChevronRight} label="Next month" size={24} onClick={() => setShown(addMonths(shown, 1))} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, textAlign: 'center' }}>
                {DOW.map((d) => <span key={d} aria-hidden="true" style={{ fontSize: 10, fontWeight: 600, color: t.faint, height: 20, lineHeight: '20px' }}>{d[0]}</span>)}
                {days.map((d) => {
                    const sel = d === cursor, isToday = d === today, inMonth = d.slice(0, 7) === month;
                    return (
                        <button key={d} type="button" onClick={() => onPick(d)} aria-label={dayDate(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                            aria-current={isToday ? 'date' : undefined} className={sel || isToday ? '' : 'ws-ghost-btn'}
                            style={{
                                position: 'relative', height: 26, border: 'none', borderRadius: 99, cursor: 'pointer', padding: 0,
                                fontFamily: MONO, fontSize: 11.5, fontVariantNumeric: 'tabular-nums', fontWeight: isToday || sel ? 700 : 400,
                                background: isToday ? t.teal : sel ? t.soft : 'transparent',
                                color: isToday ? t.onTeal : sel ? t.softText : inMonth ? t.text : t.ghost,
                            }}>
                            {dayDate(d).getDate()}
                            {marked.has(d) && !isToday && <span aria-hidden="true" style={{ position: 'absolute', bottom: 2, left: '50%', marginLeft: -2, width: 4, height: 4, borderRadius: '50%', background: t.accent }} />}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function SourceList({ hidden, toggle, counts, showAll }) {
    const t = useT();
    const groups = [...new Set(SOURCES.map((s) => s.group))];
    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, paddingLeft: 4 }}>Show</span>
                {hidden.length > 0 && (
                    <button type="button" onClick={showAll} className="ws-ghost-btn" style={{
                        border: 'none', background: 'transparent', fontFamily: MONO, fontSize: 11.5, color: t.accent, cursor: 'pointer', padding: '3px 6px', borderRadius: 6,
                    }}>Show All</button>
                )}
            </div>
            {groups.map((g) => (
                <div key={g} role="group" aria-label={GROUP_LABEL[g]} style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: t.faint, padding: '4px 4px 2px', letterSpacing: '.03em' }}>{GROUP_LABEL[g]}</div>
                    {SOURCES.filter((s) => s.group === g).map((s) => {
                        const on = !hidden.includes(s.id);
                        const c = itemColor(t, { source: s.id, kind: s.id === 'events' ? 'event' : 'date', color: 'teal' });
                        const Icon = SOURCE_ICON[s.id];
                        return (
                            <label key={s.id} className="ws-hover" style={{
                                display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 6px', borderRadius: 7, cursor: 'pointer', fontSize: 12.5,
                                color: on ? t.text : t.faint,
                            }}>
                                <input type="checkbox" checked={on} onChange={() => toggle(s.id)} className="cal-src" style={{ '--c': c }} />
                                <Icon aria-hidden="true" size={13} strokeWidth={1.9} style={{ color: on ? c : t.ghost, flexShrink: 0 }} />
                                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                                <span style={{ fontSize: 11, color: t.faint, fontVariantNumeric: 'tabular-nums' }}>{counts[s.id] || ''}</span>
                            </label>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}

/* ── the page ─────────────────────────────────────────────────────────────── */

export default function CalendarPage() {
    const t = useT();
    const navigate = useNavigate();
    const toast = useToast();
    const today = useToday();
    const [params, setParams] = useSearchParams();
    const narrow = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches;
    const view = VIEWS.some((v) => v.id === params.get('view')) ? params.get('view') : (narrow ? 'agenda' : 'month');
    const cursor = validIso(params.get('date')) ? params.get('date') : today;
    const go = useCallback((next) => {
        const p = new URLSearchParams(params);
        if (next.view) p.set('view', next.view);
        if (next.date) { if (next.date === localDay()) p.delete('date'); else p.set('date', next.date); }
        setParams(p, { replace: true });
    }, [params, setParams]);

    const { from, to } = viewRange(view, cursor);
    const data = useCalendarData(from, to);
    const [hidden, setHidden] = useState(readHidden);
    const [panel, setPanel] = useState(null);   // { event } | { start }
    const [moreDay, setMoreDay] = useState(null);
    const [filtersOpen, setFiltersOpen] = useState(false);

    const toggle = (id) => setHidden((h) => { const next = h.includes(id) ? h.filter((x) => x !== id) : [...h, id]; writeHidden(next); return next; });
    const showAll = () => { setHidden([]); writeHidden([]); };

    const visible = useMemo(() => data.items.filter((it) => !hidden.includes(it.source)), [data.items, hidden]);
    const counts = useMemo(() => data.items.reduce((m, it) => { m[it.source] = (m[it.source] || 0) + 1; return m; }, {}), [data.items]);
    const rangeDays = useMemo(() => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }, [from, to]);
    const byDay = useMemo(() => itemsByDay(visible, rangeDays), [visible, rangeDays]);
    const marked = useMemo(() => new Set(rangeDays.filter((d) => (byDay.get(d) || []).length)), [rangeDays, byDay]);

    const open = useCallback((it) => {
        if (it.kind === 'event') { setMoreDay(null); setPanel({ event: it.row }); return; }
        if (it.kind === 'mytask') { navigate(`/workspace/my-tasks?task=${it.taskId}`); return; }
        if (it.to) navigate(it.to);
    }, [navigate]);
    const missing = data.missing;
    const newAt = useCallback((start) => {
        if (missing) { toast('Your own events need migration 0112 (Workspace) on this database.', 'info', 5000); return; }
        setMoreDay(null); setPanel({ start });
    }, [missing, toast]);

    const move = useCallback(async (eventId, deltaMs) => {
        if (!deltaMs) return;
        const row = data.eventRows.find((e) => e.id === eventId);
        if (!row) return;
        const shift = (iso) => new Date(new Date(iso).getTime() + deltaMs).toISOString();
        try {
            await workspaceService.update('events', eventId, { start_at: shift(row.start_at), end_at: shift(row.end_at) });
            toast(row.repeat && row.repeat !== 'none' ? 'Series moved' : 'Event moved', 'success', 6000, {
                label: 'Undo',
                onClick: () => workspaceService.update('events', eventId, { start_at: row.start_at, end_at: row.end_at }).catch((e) => toast(e.message, 'error')),
            });
        } catch (e) {
            toast(e.message, 'error');
        }
    }, [data.eventRows, toast]);

    // Keys, when nothing is being typed and no panel is open.
    useEffect(() => {
        const onKey = (e) => {
            if (panel || moreDay || e.metaKey || e.ctrlKey || e.altKey || isTyping(document.activeElement)) return;
            if (document.querySelector('.edge-drawer-backdrop')) return;
            const k = e.key.toLowerCase();
            if (k === 't') go({ date: localDay() });
            else if (e.key === 'ArrowLeft') go({ date: step(view, cursor, -1) });
            else if (e.key === 'ArrowRight') go({ date: step(view, cursor, 1) });
            else if (k === 'n') newAt({ day: cursor });
            else if (VIEW_KEYS[k]) go({ view: VIEW_KEYS[k] });
            else return;
            e.preventDefault();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [panel, moreDay, go, view, cursor, today, newAt]);

    if (!data.orgId || !data.ready) return <Loading>Loading your calendar…</Loading>;

    const title = rangeTitle(view, cursor);
    const isNow = from <= today && to >= today;

    return (
        <Page>
            <WorkspaceStyle />
            {/* toolbar */}
            <div className="cal-bar" style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: 10, marginBottom: 12,
                background: t.card, border: '1px solid ' + t.line, borderRadius: 12, position: 'sticky', top: 0, zIndex: 20,
            }}>
                <Btn onClick={() => go({ date: localDay() })} disabled={isNow && cursor === today} title="Go to today (T)">Today</Btn>
                <div style={{ display: 'flex', gap: 2 }}>
                    <IconBtn icon={ChevronLeft} label="Previous (←)" size={32} onClick={() => go({ date: step(view, cursor, -1) })} />
                    <IconBtn icon={ChevronRight} label="Next (→)" size={32} onClick={() => go({ date: step(view, cursor, 1) })} />
                </div>
                <h2 aria-live="polite" style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>{title}</h2>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="cal-filter-btn">
                        <Btn onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen} aria-pressed={filtersOpen}>
                            <SlidersHorizontal size={14} aria-hidden="true" />Show{hidden.length ? ` (${SOURCES.length - hidden.length})` : ''}
                        </Btn>
                    </span>
                    <Seg value={view} onChange={(v) => go({ view: v })} options={VIEWS} label="Calendar view" />
                    <Btn primary onClick={() => newAt({ day: cursor })} title="New event (N)"><Plus size={14} aria-hidden="true" />New Event</Btn>
                </div>
            </div>

            {(
                <div className={'cal-wrap' + (filtersOpen ? ' filters-open' : '')}>
                    <aside className="cal-side" aria-label="Calendar options" style={{
                        background: t.card, border: '1px solid ' + t.line, borderRadius: 12, padding: 12, alignSelf: 'start',
                        display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 66,
                    }}>
                        <MiniMonth cursor={cursor} today={today} marked={marked} onPick={(d) => go({ date: d })} />
                        <div style={{ height: 1, background: t.lineSoft }} />
                        <SourceList hidden={hidden} toggle={toggle} counts={counts} showAll={showAll} />
                        <p style={{ margin: 0, fontSize: 11, color: t.faint, lineHeight: 1.5, padding: '0 4px' }}>
                            Your events and tasks are private. Company dates are read from the records you can open.
                        </p>
                    </aside>
                    <main style={{ minWidth: 0 }}>
                        {data.missing && (
                            <div role="status" style={{
                                marginBottom: 10, padding: '9px 12px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.5,
                                background: t.soft, color: t.softText,
                            }}>
                                Company dates are shown. Your own events and tasks need the Workspace tables: apply migration 0112 in Supabase, then reload.
                            </div>
                        )}
                        {data.error && !data.missing && (
                            <div role="alert" style={{ marginBottom: 10, fontSize: 12.5, color: t.down }}>{data.error}</div>
                        )}
                        {view === 'month' && <MonthView cursor={cursor} today={today} byDay={byDay} onOpen={open} onNew={newAt} onMore={setMoreDay} onMove={move} />}
                        {(view === 'week' || view === 'day') && (
                            <TimeGrid days={view === 'week' ? weekDays(cursor) : [cursor]} today={today} byDay={byDay}
                                onOpen={open} onNew={newAt} onMove={move} onMore={setMoreDay} />
                        )}
                        {view === 'agenda' && <AgendaView from={from} to={to} today={today} byDay={byDay} onOpen={open} onNew={newAt} />}
                    </main>
                </div>
            )}

            {moreDay && (
                <Modal open onClose={() => setMoreDay(null)} width={520}
                    title={dayDate(moreDay).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    note={`${(byDay.get(moreDay) || []).length} on this day`}
                    footer={<><div style={{ flex: 1 }} /><Btn onClick={() => setMoreDay(null)}>Close</Btn><Btn primary onClick={() => newAt({ day: moreDay })}>New Event</Btn></>}>
                    <div style={{ margin: 0 }}>
                        {(byDay.get(moreDay) || []).map((it, i) => <ItemRow key={it.key} it={it} day={moreDay} onOpen={open} first={i === 0} />)}
                    </div>
                </Modal>
            )}

            {panel && (
                <EventPanel orgId={data.orgId} event={panel.event || null} start={panel.start || null}
                    projects={data.projects} onClose={() => setPanel(null)} />
            )}

            <style>{`
                .cal-wrap { display: grid; gap: 12px; grid-template-columns: 236px minmax(0, 1fr); align-items: start; }
                .cal-filter-btn { display: none; }
                @media (max-width: 1100px) {
                    .cal-wrap { grid-template-columns: minmax(0, 1fr); }
                    .cal-side { display: none !important; position: static !important; }
                    .cal-wrap.filters-open .cal-side { display: flex !important; }
                    .cal-filter-btn { display: inline-flex; }
                }
                .cal-cell { transition: background .12s; }
                .cal-cell:hover { background: color-mix(in srgb, ${t.panelAlt} 80%, transparent) !important; }
                .cal-chip { transition: filter .12s, background .12s; }
                .cal-chip:hover { filter: brightness(${t.isDark ? 1.15 : 0.96}); }
                .cal-chip[draggable="true"] { cursor: grab; }
                .cal-ev { transition: box-shadow .12s, filter .12s; }
                .cal-ev:hover { filter: brightness(${t.isDark ? 1.12 : 0.97}); z-index: 3; }
                .cal-src { appearance: none; -webkit-appearance: none; width: 14px; height: 14px; margin: 0; flex-shrink: 0; border-radius: 4px;
                    border: 1.5px solid ${t.lineStrong}; background: transparent; cursor: pointer; display: grid; place-items: center; }
                .cal-src:checked { background: var(--c); border-color: var(--c); }
                .cal-src:checked::after { content: ''; width: 7px; height: 4px; border: 2px solid ${t.card}; border-top: 0; border-right: 0; transform: translateY(-1px) rotate(-45deg); }
                @media (max-width: 760px) { .cal-month { grid-template-rows: 28px repeat(6, minmax(72px, 1fr)) !important; } .cal-month .cal-chip { font-size: 10.5px !important; } }
            `}</style>
        </Page>
    );
}
