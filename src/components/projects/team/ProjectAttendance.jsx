import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Panel, Row, Btn, Seg, Select, Field, Input, Textarea, Table, Tr, Td, Avatar, Status,
    Empty, Loading, Modal,
} from '../../ui/edge';
import { useT, MONO, fmtDate } from '../../ui/edgeUtils';
import { useToast } from '../../shared/Toast';
import { orgStore } from '../../../services/orgStore';
import { attendanceService, ATTENDANCE_STATUSES } from '../../../services/attendanceService';
import { leaveService, LEAVE_STATUSES, countLeaveDays, rangesOverlap } from '../../../services/leaveService';
import {
    DAY_STATUSES, DAY_BY_KEY, daysBetween, dayCell, summarisePerson, isoDay,
} from '../../../services/projectTeam';
import { useProjectPeople, canAttendance, teamError } from './teamData';
import AttendanceSheet from '../../people/AttendanceSheet';
import HubLeave from '../../people/LeaveRequests';

/* ══════════════════════════════════════════════════════════════════════════
   Team Management › Attendance: three plain views of the project's people:

     Day     who is in today: one row per person, one click per status.
     Month   the month at a glance, with each person's totals at the end of
             their row. Selecting a day opens it in Day.
     Leave   requests, approvals, and applying for leave.

   The sheet is the company's (attendance_days, leave_requests), narrowed to
   the people on the project. A marked day wins; approved leave fills an
   unmarked working day; Saturday and Sunday are weekends unless marked.
   ══════════════════════════════════════════════════════════════════════════ */

const TONE = { approved: 'up', rejected: 'down', pending: 'neutral', cancelled: 'mute' };
const tint = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');

const monthOf = (day) => day.slice(0, 7);
const monthDays = (month) => {
    const [y, m] = month.split('-').map(Number);
    return daysBetween(`${month}-01`, isoDay(new Date(y, m, 0)));
};
const shiftMonth = (month, delta) => {
    const [y, m] = month.split('-').map(Number);
    return isoDay(new Date(y, m - 1 + delta, 1)).slice(0, 7);
};
const shiftDay = (day, delta) => {
    const d = new Date(`${day}T00:00:00`);
    d.setDate(d.getDate() + delta);
    return isoDay(d);
};
const monthLabel = (month) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const longDay = (day) => new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const dayLabel = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const onProject = (m, day) => (!m.start_date || String(m.start_date).slice(0, 10) <= day) && (!m.end_date || String(m.end_date).slice(0, 10) >= day);
const fmtN = (n) => {
    const v = Number(n) || 0;
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

/**
 * Team Management › Attendance: the hub's Attendance and Leave pages, the
 * same sheets narrowed to the people on this project and the days each one
 * is on it.
 */
export default function ProjectAttendance({ project, onOpen }) {
    const team = useProjectPeople(project);
    const orgId = orgStore.getOrgId();
    const [view, setView] = useState('sheet');
    const [applying, setApplying] = useState(null);   // { types, requests, reload }

    const people = useMemo(
        () => team.people.map((p) => p.employee || { id: p.id, name: p.name }),
        [team.people],
    );
    const byId = useMemo(() => new Map(team.people.map((p) => [p.id, p])), [team.people]);
    const isOn = useCallback((id, day) => {
        const p = byId.get(id);
        return !!p && onProject(p.membership, day);
    }, [byId]);
    const ids = useMemo(() => team.people.map((p) => p.id), [team.people]);

    const meOnTeam = team.me && byId.has(team.me);
    const canApplyForOthers = orgStore.can('leave_requests', 'create');

    if (!team.people.length) {
        return (
            <Panel>
                <Empty action={onOpen && <Btn primary onClick={() => onOpen('team')}>Add team members</Btn>}>
                    No one is on this project yet. Attendance and leave show here for each person on the team.
                </Empty>
            </Panel>
        );
    }

    return (
        <div style={{ display: 'grid', gap: 12 }}>
            <Seg value={view} onChange={setView} label="Attendance" options={[
                { id: 'sheet', label: 'Attendance' },
                { id: 'leave', label: 'Leave' },
            ]} />
            {view === 'sheet'
                ? <AttendanceSheet people={people} isOn={isOn} scope="project" />
                : (
                    <HubLeave employeeIds={ids} renderActions={(ctx) => (meOnTeam || canApplyForOthers) && (
                        <Btn primary onClick={() => setApplying(ctx)}>Apply for leave</Btn>
                    )} />
                )}
            {applying && (
                <ApplyLeave orgId={orgId} people={team.people} team={team} types={applying.types}
                    requests={applying.requests} forOthers={canApplyForOthers}
                    onClose={() => setApplying(null)}
                    onDone={() => { const { reload } = applying; setApplying(null); reload(); }} />
            )}
        </div>
    );
}

// The project's own Day / Month / Leave views, before it used the hub's pages.
function LegacyProjectAttendance({ project, onOpen }) {
    const team = useProjectPeople(project);
    const orgId = orgStore.getOrgId();
    const [view, setView] = useState('day');
    const [day, setDay] = useState(isoDay());
    const [month, setMonth] = useState(monthOf(isoDay()));
    const [leave, setLeave] = useState({ requests: [], types: [], loaded: false, error: '' });
    const [stamp, setStamp] = useState(0);      // bumps after any write, so every view re-reads

    const canMark = canAttendance('edit') || canAttendance('create');
    const canDecide = orgStore.can('leave_requests', 'edit');
    const ids = useMemo(() => team.people.map((p) => p.id), [team.people]);
    const idKey = ids.join(',');

    // Leave is read once for every view: approved leave colours the grid,
    // pending requests count on the Leave tab.
    const leaveFrom = [`${new Date().getFullYear()}-01-01`, `${month}-01`].sort()[0];
    useEffect(() => {
        let cancelled = false;
        if (!orgId || !ids.length) return undefined;
        Promise.all([
            leaveService.listRequests(orgId, { employeeIds: ids, overlapsFrom: leaveFrom }),
            leaveService.listRequests(orgId, { employeeIds: ids, status: 'pending' }),
            leaveService.listTypes(orgId, { includeInactive: true }),
        ]).then(([range, pending, types]) => {
            if (cancelled) return;
            const byId = new Map([...range, ...pending].map((r) => [r.id, r]));
            setLeave({
                requests: [...byId.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
                types, loaded: true, error: '',
            });
        }).catch((e) => { if (!cancelled) setLeave((l) => ({ ...l, loaded: true, error: teamError(e, 'Leave could not be read.') })); });
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orgId, idKey, leaveFrom, stamp]);

    const typeById = useMemo(() => new Map(leave.types.map((x) => [x.id, x])), [leave.types]);
    const pending = leave.requests.filter((r) => r.status === 'pending').length;
    const changed = () => setStamp((n) => n + 1);

    if (!team.people.length) {
        return (
            <Panel>
                <Empty action={onOpen && <Btn primary onClick={() => onOpen('team')}>Add team members</Btn>}>
                    No one is on this project yet. Attendance and leave show here for each person on the team.
                </Empty>
            </Panel>
        );
    }

    return (
        <div style={{ display: 'grid', gap: 14 }}>
            <Seg value={view} onChange={setView} label="Attendance view" options={[
                { id: 'day', label: 'Day' },
                { id: 'month', label: 'Month' },
                { id: 'leave', label: 'Leave', count: pending || undefined },
            ]} />

            {view === 'day' && (
                <DayView people={team.people} orgId={orgId} day={day} setDay={setDay} canMark={canMark}
                    requests={leave.requests} typeById={typeById} stamp={stamp} onChanged={changed} />
            )}
            {view === 'month' && (
                <MonthView people={team.people} orgId={orgId} month={month} setMonth={setMonth} stamp={stamp}
                    requests={leave.requests} typeById={typeById} canMark={canMark}
                    onOpenDay={(d) => { setDay(d); setView('day'); }} />
            )}
            {view === 'leave' && (
                leave.loaded ? (
                    leave.error ? <Panel><Empty action={<Btn onClick={changed}>Try again</Btn>}>{leave.error}</Empty></Panel> : (
                        <LeaveRequests people={team.people} team={team} requests={leave.requests} types={leave.types}
                            typeById={typeById} canDecide={canDecide} orgId={orgId} onChanged={changed} />
                    )
                ) : <Panel><Loading>Loading leave…</Loading></Panel>
            )}
        </div>
    );
}

/* ── Day ──────────────────────────────────────────────────────────────────── */

function DayView({ people, orgId, day, setDay, canMark, requests, typeById, stamp, onChanged }) {
    const t = useT();
    const toast = useToast();
    const [rows, setRows] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');     // employee id, or 'all'
    const canClear = canAttendance('delete');

    const onDay = useMemo(() => people.filter((p) => onProject(p.membership, day)), [people, day]);

    const load = useCallback(async () => {
        setLoading(true); setError('');
        try { setRows(await attendanceService.listDay(orgId, day)); }
        catch (e) { setError(teamError(e, 'That day could not be loaded.')); }
        finally { setLoading(false); }
    }, [orgId, day]);
     
    useEffect(() => { load(); }, [load, stamp]);

    const write = async (id, fn) => {
        setBusy(id);
        try { await fn(); onChanged(); } catch (e) { toast(teamError(e), 'error'); } finally { setBusy(''); }
    };
    const mark = (p, status) => write(p.id, async () => {
        const row = await attendanceService.markDay(orgId, p.id, day, { status });
        setRows((r) => ({ ...r, [p.id]: row }));
    });
    const clear = (p) => write(p.id, async () => {
        await attendanceService.removeDay(rows[p.id].id);
        setRows((r) => { const next = { ...r }; delete next[p.id]; return next; });
    });
    const unmarked = onDay.filter((p) => !rows[p.id]);
    const markRest = () => write('all', async () => {
        const saved = await attendanceService.markMany(orgId, unmarked.map((p) => p.id), day, { status: 'present' });
        setRows((r) => ({ ...r, ...Object.fromEntries(saved.map((x) => [x.employee_id, x])) }));
        toast(`${saved.length} marked present`, 'success');
    });

    const approvedLeave = (id) => requests.find((r) => r.employee_id === id && r.status === 'approved'
        && r.start_date <= day && r.end_date >= day);
    const today = isoDay();

    return (
        <Panel>
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: '10px 13px', borderBottom: '1px solid ' + t.lineSoft,
            }}>
                <Btn size="sm" aria-label="Previous day" onClick={() => setDay(shiftDay(day, -1))}>‹</Btn>
                <label style={{ position: 'relative', display: 'inline-flex' }}>
                    <span style={{ fontSize: 14, color: t.text, fontWeight: 500, minWidth: 150, textAlign: 'center' }}>{longDay(day)}</span>
                    <input type="date" aria-label="Choose a day" value={day} onChange={(e) => e.target.value && setDay(e.target.value)}
                        onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* not supported */ } }}
                        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }} />
                </label>
                <Btn size="sm" aria-label="Next day" onClick={() => setDay(shiftDay(day, 1))}>›</Btn>
                {day !== today && <Btn size="sm" onClick={() => setDay(today)}>Today</Btn>}
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: t.faint }}>{onDay.length - unmarked.length} of {onDay.length} marked</span>
                {canMark && unmarked.length > 0 && (
                    <Btn size="sm" primary disabled={busy === 'all'} onClick={markRest}>
                        {busy === 'all' ? 'Marking…' : unmarked.length === onDay.length ? 'Mark everyone present' : `Mark ${unmarked.length} left present`}
                    </Btn>
                )}
            </div>

            {!canMark && (
                <div role="status" style={{ padding: '8px 13px', fontSize: 12, color: t.faint, borderBottom: '1px solid ' + t.lineSoft }}>
                    You can see attendance here; marking it needs the Attendance permission.
                </div>
            )}

            {loading && !Object.keys(rows).length ? <Loading>Loading…</Loading> : error ? (
                <Empty action={<Btn onClick={load}>Try again</Btn>}>{error}</Empty>
            ) : onDay.length === 0 ? (
                <Empty>No one is on the project on this day.</Empty>
            ) : onDay.map((p) => {
                const row = rows[p.id];
                const lv = !row && approvedLeave(p.id);
                return (
                    <div key={p.id} style={{
                        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                        padding: '10px 13px', borderBottom: '1px solid ' + t.lineSoft,
                    }}>
                        <Row gap={10} style={{ flex: '1 1 200px', minWidth: 0 }}>
                            <Avatar name={p.name} size={28} />
                            <span style={{ minWidth: 0 }}>
                                <span style={{ display: 'block', fontSize: 13.5, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                                {lv && <span style={{ display: 'block', fontSize: 11.5, color: t.faint }}>On approved {typeById.get(lv.leave_type_id)?.name || 'leave'}</span>}
                                {row?.source === 'self' && <span style={{ display: 'block', fontSize: 11.5, color: t.faint }}>Checked in themselves</span>}
                            </span>
                        </Row>
                        <div role="group" aria-label={`Attendance for ${p.name}`} style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                            {ATTENDANCE_STATUSES.map((s) => {
                                const on = row?.status === s.key;
                                return (
                                    <button key={s.key} type="button" aria-pressed={on}
                                        disabled={!canMark || busy === p.id || busy === 'all'}
                                        onClick={() => !on && mark(p, s.key)}
                                        className="edge-btn"
                                        style={{
                                            height: 30, padding: '0 11px', borderRadius: 7, fontFamily: MONO, fontSize: 12.5,
                                            cursor: canMark ? 'pointer' : 'default',
                                            border: '1px solid ' + (on ? s.color : t.line),
                                            background: on ? tint(s.color, t.isDark ? 0.3 : 0.14) : 'transparent',
                                            color: on ? t.text : t.dim, fontWeight: on ? 600 : 400,
                                            opacity: !canMark && !on ? 0.5 : 1,
                                        }}>{s.label}</button>
                                );
                            })}
                            {canClear && row && (
                                <button type="button" onClick={() => clear(p)} disabled={busy === p.id}
                                    aria-label={`Clear ${p.name}'s mark`} className="edge-btn"
                                    style={{
                                        height: 30, padding: '0 8px', border: 'none', background: 'transparent', borderRadius: 7,
                                        fontFamily: MONO, fontSize: 12, color: t.faint, cursor: 'pointer',
                                    }}>Clear</button>
                            )}
                        </div>
                    </div>
                );
            })}
        </Panel>
    );
}

/* ── Month ────────────────────────────────────────────────────────────────── */

function MonthView({ people, orgId, month, setMonth, stamp, requests, typeById, canMark, onOpenDay }) {
    const t = useT();
    const [rows, setRows] = useState(null);
    const [balances, setBalances] = useState([]);
    const [error, setError] = useState('');
    const days = useMemo(() => monthDays(month), [month]);
    const from = days[0];
    const to = days[days.length - 1];

    // Everyone whose time on the project touches this month.
    const shown = useMemo(() => people.filter((p) => {
        const m = p.membership;
        return (!m.start_date || String(m.start_date).slice(0, 10) <= to) && (!m.end_date || String(m.end_date).slice(0, 10) >= from);
    }), [people, from, to]);
    const idKey = shown.map((p) => p.id).join(',');

    const load = useCallback(async () => {
        const ids = idKey ? idKey.split(',') : [];
        try {
            const [r, b] = await Promise.all([
                attendanceService.listRange(orgId, ids, from, to),
                leaveService.balancesFor(orgId, ids).catch(() => []),
            ]);
            setRows(r); setBalances(b); setError('');
        } catch (e) {
            setError(teamError(e, 'Attendance could not be loaded.'));
        }
    }, [orgId, idKey, from, to]);
     
    useEffect(() => { load(); }, [load, stamp]);

    const grid = useMemo(() => {
        const out = new Map();
        if (!rows) return out;
        for (const p of shown) {
            const mine = new Map(rows.filter((r) => r.employee_id === p.id).map((r) => [r.work_date, r]));
            const leaves = requests.filter((l) => l.employee_id === p.id && l.status === 'approved');
            const cells = days.map((day) => {
                const on = onProject(p.membership, day);
                return { day, on, cell: on ? dayCell(day, mine.get(day), leaves) : null };
            });
            const bal = balances.filter((b) => b.employee_id === p.id);
            out.set(p.id, {
                cells,
                sum: summarisePerson(cells.filter((c) => c.on)),
                balance: bal.length ? bal.reduce((s, b) => s + Number(b.remaining || 0), 0) : null,
                balanceNote: bal.map((b) => `${b.leave_type_name}: ${Number(b.remaining)}`).join(' · '),
            });
        }
        return out;
    }, [rows, balances, shown, days, requests]);

    const today = isoDay();
    const th = {
        position: 'sticky', top: 0, zIndex: 2, background: t.panel, fontWeight: 400,
        borderBottom: '1px solid ' + t.line, padding: '6px 0', fontSize: 10.5, color: t.faint, textAlign: 'center',
    };
    const total = { ...th, padding: '6px 8px', minWidth: 44, fontSize: 10.5, letterSpacing: '0.06em' };

    return (
        <Panel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 13px', borderBottom: '1px solid ' + t.lineSoft }}>
                <Btn size="sm" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>‹</Btn>
                <span style={{ fontSize: 14, color: t.text, fontWeight: 500, minWidth: 140, textAlign: 'center' }}>{monthLabel(month)}</span>
                <Btn size="sm" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>›</Btn>
                {month !== monthOf(today) && <Btn size="sm" onClick={() => setMonth(monthOf(today))}>This month</Btn>}
                <div style={{ flex: 1 }} />
                {canMark && <span style={{ fontSize: 12, color: t.faint }}>Select a day to mark it</span>}
            </div>

            {error ? <Empty action={<Btn onClick={load}>Try again</Btn>}>{error}</Empty>
                : !rows ? <Loading>Loading {monthLabel(month)}…</Loading>
                    : shown.length === 0 ? <Empty>No one was on the project in {monthLabel(month)}.</Empty> : (
                        <div className="edge-scroll" tabIndex={0} aria-label={`Attendance for ${monthLabel(month)}, scrollable`}
                            style={{ overflow: 'auto', maxHeight: 'min(70vh, 640px)' }}>
                            <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontFamily: MONO, minWidth: '100%' }}>
                                <thead>
                                    <tr>
                                        <th scope="col" style={{ ...th, left: 0, zIndex: 3, textAlign: 'left', padding: '6px 13px', minWidth: 160, letterSpacing: '0.09em' }}>MEMBER</th>
                                        {days.map((d) => {
                                            const date = new Date(`${d}T00:00:00Z`);
                                            const we = [0, 6].includes(date.getUTCDay());
                                            return (
                                                <th key={d} scope="col" aria-label={dayLabel(d)} style={{
                                                    ...th, minWidth: 26, background: we ? t.panelAlt : t.panel,
                                                    color: d === today ? t.text : t.faint, fontWeight: d === today ? 700 : 400,
                                                }}>
                                                    <span style={{ display: 'block', fontSize: 9 }}>{date.toLocaleDateString('en-IN', { weekday: 'narrow', timeZone: 'UTC' })}</span>
                                                    {date.getUTCDate()}
                                                </th>
                                            );
                                        })}
                                        <th scope="col" title="Days present" style={{ ...total, borderLeft: '1px solid ' + t.line }}>PRES.</th>
                                        <th scope="col" title="Days absent" style={total}>ABS.</th>
                                        <th scope="col" title="Leave taken" style={total}>LEAVE</th>
                                        <th scope="col" title="Leave balance this year" style={{ ...total, paddingRight: 13 }}>LEFT</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {shown.map((p) => {
                                        const g = grid.get(p.id);
                                        return (
                                            <tr key={p.id}>
                                                <th scope="row" style={{
                                                    position: 'sticky', left: 0, zIndex: 1, background: t.panel, textAlign: 'left', fontWeight: 400,
                                                    padding: '6px 13px', borderBottom: '1px solid ' + t.lineSoft, whiteSpace: 'nowrap', fontSize: 13, color: t.text,
                                                }}>
                                                    <Row gap={8}><Avatar name={p.name} size={22} /><span>{p.name}</span></Row>
                                                </th>
                                                {g.cells.map(({ day, on, cell }) => (
                                                    <DayCell key={day} person={p} day={day} on={on} cell={cell} typeById={typeById}
                                                        canMark={canMark} onOpen={onOpenDay} />
                                                ))}
                                                <td style={{ textAlign: 'center', fontSize: 12.5, color: t.text, borderLeft: '1px solid ' + t.line, borderBottom: '1px solid ' + t.lineSoft }}>{fmtN(g.sum.present)}</td>
                                                <td style={{ textAlign: 'center', fontSize: 12.5, color: g.sum.absent ? t.down : t.faint, borderBottom: '1px solid ' + t.lineSoft }}>{fmtN(g.sum.absent)}</td>
                                                <td style={{ textAlign: 'center', fontSize: 12.5, color: g.sum.leave ? t.text : t.faint, borderBottom: '1px solid ' + t.lineSoft }}>{fmtN(g.sum.leave)}</td>
                                                <td title={g.balanceNote} style={{ textAlign: 'center', fontSize: 12.5, color: t.dim, paddingRight: 13, borderBottom: '1px solid ' + t.lineSoft }}>
                                                    {g.balance == null ? '-' : fmtN(g.balance)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

            <div role="list" aria-label="Legend" style={{
                display: 'flex', flexWrap: 'wrap', gap: '6px 14px', padding: '10px 13px', borderTop: '1px solid ' + t.lineSoft,
            }}>
                {DAY_STATUSES.filter((s) => s.key !== 'weekend').map((s) => (
                    <span key={s.key} role="listitem" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: t.faint }}>
                        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                        {s.short} {s.label}
                    </span>
                ))}
                <span role="listitem" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: t.faint }}>
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: t.panelAlt, border: '1px solid ' + t.line }} />
                    Weekend
                </span>
            </div>
        </Panel>
    );
}

function DayCell({ person, day, on, cell, typeById, canMark, onOpen }) {
    const t = useT();
    const s = cell && cell.key !== 'weekend' ? DAY_BY_KEY[cell.key] : null;
    const weekend = [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay());
    const type = cell?.leaveType ? typeById.get(cell.leaveType) : null;
    const label = `${person.name}, ${dayLabel(day)}: ${!on ? 'not on the project' : s ? s.label + (type ? ` (${type.name})` : '') : weekend ? 'weekend' : 'not marked'}`;
    const face = s ? (
        <span aria-hidden="true" style={{
            width: 20, height: 20, borderRadius: 5, display: 'inline-grid', placeItems: 'center',
            background: tint(s.color, t.isDark ? 0.45 : 0.28), border: '1px solid ' + s.color, color: t.text, fontSize: 10, fontWeight: 700, boxSizing: 'border-box',
        }}>{cell.key === 'leave' && type?.code ? type.code.slice(0, 2) : s.short}</span>
    ) : <span aria-hidden="true" style={{ width: 20, height: 20, display: 'inline-block' }} />;
    const td = {
        padding: '3px 3px', textAlign: 'center', borderBottom: '1px solid ' + t.lineSoft,
        background: weekend ? t.panelAlt : undefined,
    };
    if (!on || !canMark) return <td style={td}><span role="img" aria-label={label} title={label} style={{ display: 'inline-grid' }}>{face}</span></td>;
    return (
        <td style={td}>
            <button type="button" aria-label={`${label}. Open this day`} title={label} onClick={() => onOpen(day)}
                className="edge-btn" style={{
                    padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 5, display: 'inline-grid',
                }}>{face}</button>
        </td>
    );
}

/* ── leave requests ───────────────────────────────────────────────────────── */

function LeaveRequests({ people, team, requests, types, typeById, canDecide, orgId, onChanged }) {
    const t = useT();
    const toast = useToast();
    const [tab, setTab] = useState('pending');
    const [applying, setApplying] = useState(false);
    const [rejecting, setRejecting] = useState(null);
    const [comment, setComment] = useState('');
    const [busyId, setBusyId] = useState('');
    const nameOf = (id) => people.find((p) => p.id === id)?.name || team.empById.get(id)?.name || 'Former employee';

    const counts = { pending: 0, approved: 0, rejected: 0 };
    requests.forEach((r) => { if (counts[r.status] != null) counts[r.status] += 1; });
    const shown = requests.filter((r) => r.status === tab);
    const meOnTeam = team.me && people.some((p) => p.id === team.me);
    const canApplyForOthers = orgStore.can('leave_requests', 'create');
    const canApply = meOnTeam || canApplyForOthers;

    const act = async (id, fn, ok) => {
        setBusyId(id);
        try { await fn(); toast(ok, 'success'); onChanged(); } catch (e) { toast(teamError(e), 'error'); } finally { setBusyId(''); }
    };

    return (
        <Panel title="Leave requests" note="for the people on this project"
            actions={canApply && <Btn size="sm" primary onClick={() => setApplying(true)}>Apply for leave</Btn>}>
            <div style={{ padding: '10px 13px', borderBottom: '1px solid ' + t.lineSoft }}>
                <Seg size="sm" value={tab} onChange={setTab} label="Requests" options={[
                    { id: 'pending', label: 'Pending', count: counts.pending },
                    { id: 'approved', label: 'Approved', count: counts.approved },
                    { id: 'rejected', label: 'Rejected', count: counts.rejected },
                ]} />
            </div>
            {shown.length === 0 ? (
                <Empty action={tab === 'pending' && canApply && <Btn onClick={() => setApplying(true)}>Apply for leave</Btn>}>
                    {tab === 'pending' ? 'Nothing is waiting for a decision.' : `No ${tab} requests over these dates.`}
                </Empty>
            ) : (
                <div style={{ padding: 12 }}>
                    <Table cols={[
                        { key: 'p', label: 'Member' }, { key: 'ty', label: 'Type' }, { key: 'd', label: 'Dates' },
                        { key: 'n', label: 'Days', align: 'right' }, { key: 'r', label: 'Reason' }, { key: 's', label: 'Status' },
                        { key: 'x', label: '', align: 'right' },
                    ]}>
                        {shown.map((r) => {
                            const type = typeById.get(r.leave_type_id);
                            const own = r.employee_id === team.me;
                            return (
                                <Tr key={r.id}>
                                    <Td><Row gap={8}><Avatar name={nameOf(r.employee_id)} size={22} /><span style={{ whiteSpace: 'nowrap' }}>{nameOf(r.employee_id)}</span></Row></Td>
                                    <Td nowrap>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: type?.color || t.dim }} />
                                            {type?.name || 'Leave'}
                                        </span>
                                    </Td>
                                    <Td muted nowrap>{fmtDate(r.start_date)}{r.end_date !== r.start_date ? ` → ${fmtDate(r.end_date)}` : ''}</Td>
                                    <Td align="right">{fmtN(r.days)}{r.half_day ? ' (½)' : ''}</Td>
                                    <Td muted>
                                        <span style={{ display: 'block', maxWidth: 260 }}>{r.reason || '-'}</span>
                                        {r.decision_comment && <span style={{ display: 'block', fontSize: 11.5, color: t.faint, marginTop: 2 }}>“{r.decision_comment}”</span>}
                                    </Td>
                                    <Td nowrap><Status tone={TONE[r.status]}>{LEAVE_STATUSES[r.status]?.label || r.status}</Status></Td>
                                    <Td align="right">
                                        <Row gap={6} style={{ justifyContent: 'flex-end' }}>
                                            {r.status === 'pending' && canDecide && !own && (
                                                <>
                                                    <Btn size="sm" primary disabled={busyId === r.id}
                                                        onClick={() => act(r.id, () => leaveService.decide(r.id, 'approved'), 'Leave approved')}>Approve</Btn>
                                                    <Btn size="sm" disabled={busyId === r.id} onClick={() => { setComment(''); setRejecting(r); }}>Reject</Btn>
                                                </>
                                            )}
                                            {r.status === 'pending' && own && (
                                                <Btn size="sm" disabled={busyId === r.id}
                                                    onClick={() => act(r.id, () => leaveService.cancel(r.id), 'Request withdrawn')}>Withdraw</Btn>
                                            )}
                                        </Row>
                                    </Td>
                                </Tr>
                            );
                        })}
                    </Table>
                </div>
            )}

            {rejecting && (
                <Modal open onClose={() => setRejecting(null)} title={`Reject ${nameOf(rejecting.employee_id)}’s leave?`} width={440}
                    note={`${fmtDate(rejecting.start_date)} → ${fmtDate(rejecting.end_date)} · ${fmtN(rejecting.days)} day${Number(rejecting.days) === 1 ? '' : 's'}`}
                    footer={<>
                        <Btn onClick={() => setRejecting(null)}>Cancel</Btn>
                        <Btn primary disabled={busyId === rejecting.id} onClick={async () => {
                            const r = rejecting;
                            setRejecting(null);
                            await act(r.id, () => leaveService.decide(r.id, 'rejected', comment), 'Leave rejected');
                        }}>Reject</Btn>
                    </>}>
                    <Field label="Reason" hint="Optional, the person sees it with the decision">
                        <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
                    </Field>
                </Modal>
            )}
            {applying && (
                <ApplyLeave orgId={orgId} people={people} team={team} types={types} requests={requests}
                    forOthers={canApplyForOthers} onClose={() => setApplying(false)} onDone={() => { setApplying(false); setTab('pending'); onChanged(); }} />
            )}
        </Panel>
    );
}

function ApplyLeave({ orgId, people, team, types, requests, forOthers, onClose, onDone }) {
    const t = useT();
    const toast = useToast();
    const choices = forOthers ? people.filter((p) => p.status !== 'inactive') : people.filter((p) => p.id === team.me);
    const active = types.filter((x) => x.is_active);
    const [form, setForm] = useState({
        employeeId: choices.some((p) => p.id === team.me) ? team.me : choices[0]?.id || '',
        leaveTypeId: active[0]?.id || '', startDate: isoDay(), endDate: isoDay(), halfDay: false, skipWeekends: true, reason: '',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));

    const days = countLeaveDays(form.startDate, form.endDate, { halfDay: form.halfDay, skipWeekends: form.skipWeekends });
    const clash = requests.find((r) => r.employee_id === form.employeeId && ['pending', 'approved'].includes(r.status)
        && rangesOverlap(r.start_date, r.end_date, form.startDate, form.endDate));

    const save = async () => {
        setSaving(true); setError('');
        try {
            await leaveService.applyForLeave(orgId, form);
            toast('Leave requested', 'success');
            onDone();
        } catch (e) {
            setError(teamError(e));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open onClose={onClose} title="Apply for leave" width={520}
            note="It goes to whoever approves leave in the company"
            footer={<>
                <Btn onClick={onClose}>Cancel</Btn>
                <Btn primary disabled={saving || !days || !form.employeeId || !form.leaveTypeId} onClick={save}>
                    {saving ? 'Sending…' : `Request ${fmtN(days)} day${days === 1 ? '' : 's'}`}
                </Btn>
            </>}>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                <Field required label="Member">
                    <Select value={form.employeeId} onChange={set('employeeId')} disabled={choices.length < 2}>
                        {choices.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === team.me ? ' (you)' : ''}</option>)}
                    </Select>
                </Field>
                <Field required label="Leave type">
                    <Select value={form.leaveTypeId} onChange={set('leaveTypeId')}>
                        {active.length === 0 && <option value="">No leave types set up</option>}
                        {active.map((x) => <option key={x.id} value={x.id}>{x.name}{x.annual_quota ? ` · ${x.annual_quota}/yr` : ''}</option>)}
                    </Select>
                </Field>
                <Field required label="From"><Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate }))} /></Field>
                <Field required label="To"><Input type="date" value={form.endDate} min={form.startDate} onChange={set('endDate')} /></Field>
            </div>
            <Row gap={16} wrap style={{ marginTop: 12 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: t.dim, cursor: 'pointer', minHeight: 24 }}>
                    <input type="checkbox" checked={form.halfDay} disabled={form.startDate !== form.endDate} onChange={set('halfDay')} />
                    Half day
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: t.dim, cursor: 'pointer', minHeight: 24 }}>
                    <input type="checkbox" checked={form.skipWeekends} onChange={set('skipWeekends')} />
                    Don’t count weekends
                </label>
            </Row>
            <div style={{ height: 12 }} />
            <Field label="Reason" hint="Optional">
                <Textarea rows={2} value={form.reason} onChange={set('reason')} style={{ minHeight: 56 }} />
            </Field>
            {clash && (
                <div role="status" style={{ marginTop: 10, fontSize: 12.5, color: t.down }}>
                    Overlaps a {clash.status} request ({fmtDate(clash.start_date)} → {fmtDate(clash.end_date)}).
                </div>
            )}
            {error && <div role="alert" style={{ marginTop: 10, fontSize: 12.5, color: t.down }}>{error}</div>}
        </Modal>
    );
}
