import React, { useEffect, useMemo, useState } from 'react';
import { Users, UserPlus, UserMinus, CalendarCheck, Plane, Inbox } from 'lucide-react';
import { attendanceService, ATTENDANCE_STATUSES } from '../../services/attendanceService';
import { leaveService } from '../../services/leaveService';
import { fmtDay, employedOn } from './overviewModel';
import { Columns, RankBars, SplitBar, EmptyNote, Delta } from './vizKit';
import { Dashboard, Card, Tile, BigCount, More, TileRow, CardGrid, ListRow } from './dashKit';

/* ══════════════════════════════════════════════════════════════════════════
   Dashboard · Team — who is here, who is coming and going, who is out today,
   and who is carrying the work.

   Headcount, joiners and leavers follow the period. Attendance, leave and the
   task board are today's state. Attendance and leave are read under the
   caller's own permissions: a role that cannot see them gets a plain "not
   available" rather than a zero that reads as "nobody came in".
   ══════════════════════════════════════════════════════════════════════════ */

export default function TeamDash() {
    return <Dashboard>{(ctx) => <TeamBody {...ctx} />}</Dashboard>;
}

const PRESENT = new Set(['present', 'remote', 'half_day']);

function TeamBody({ model, open, navigate, t, cat, status, cols, grid, tileCols, orgId, today }) {
    const k = model.kpis;
    const staff = useMemo(() => model.raw.employees.filter((e) => employedOn(e, today)), [model.raw.employees, today]);
    const nameOf = useMemo(() => Object.fromEntries([...model.raw.employees, ...model.raw.exEmployees].map((e) => [e.id, e.name || 'Unnamed'])), [model.raw.employees, model.raw.exEmployees]);

    const [att, setAtt] = useState(undefined); // undefined loading · null unavailable
    const [leave, setLeave] = useState(undefined);
    useEffect(() => {
        let alive = true;
        attendanceService.listDay(orgId, today)
            .then((rows) => { if (alive) setAtt(rows); })
            .catch(() => { if (alive) setAtt(null); });
        leaveService.listRequests(orgId)
            .then((rows) => { if (alive) setLeave(rows); })
            .catch(() => { if (alive) setLeave(null); });
        return () => { alive = false; };
    }, [orgId, today]);

    const attendance = useMemo(() => {
        if (!att) return null;
        const byStatus = Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s.key, 0]));
        let marked = 0;
        staff.forEach((e) => {
            const row = att[e.id];
            if (row?.status && row.status in byStatus) { byStatus[row.status] += 1; marked += 1; }
        });
        const present = staff.filter((e) => PRESENT.has(att[e.id]?.status)).length;
        return { byStatus, marked, present, unmarked: staff.length - marked };
    }, [att, staff]);

    const leaves = useMemo(() => {
        if (!leave) return null;
        const pending = leave.filter((r) => r.status === 'pending');
        const outToday = leave.filter((r) => r.status === 'approved' && r.start_date <= today && r.end_date >= today);
        const upcoming = leave.filter((r) => r.status === 'approved' && r.start_date > today)
            .sort((a, b) => a.start_date.localeCompare(b.start_date));
        return { pending, outToday, upcoming };
    }, [leave, today]);

    const attrition = k.headcount.prev ? (k.headcount.exits / Math.max(1, (k.headcount.prev + k.headcount.value) / 2)) * 100 : null;
    const taskColor = { pending: t.faint, progress: cat[0], overdue: status.critical, done: status.good };
    const movers = [
        ...model.hires.map((e) => ({ e, kind: 'joined', day: String(e.startDate || e.created_at).slice(0, 10) })),
        ...model.exits.map((e) => ({ e, kind: 'left', day: String(e.exited_at).slice(0, 10) })),
    ].sort((a, b) => b.day.localeCompare(a.day));

    const attColor = { present: status.good, remote: cat[0], half_day: status.warning, leave: cat[4], absent: status.critical, holiday: t.ghost };

    return (<>
        <TileRow cols={tileCols(6)}>
            <Tile icon={Users} label="Headcount" value={String(k.headcount.value)} exact={`${k.headcount.value} people`}
                delta={<Delta abs value={k.headcount.deltaAbs} />}
                foot={k.headcount.upcoming ? `${k.headcount.upcoming} starting soon` : 'on the books today'}
                spark={k.headcount.spark} onClick={() => open({ kind: 'metric', id: 'headcount' })} />
            <Tile icon={UserPlus} label="Joined" value={String(k.headcount.hires)} exact={`${k.headcount.hires} joined in period`}
                foot="started in this period" tone={k.headcount.hires ? 'up' : null}
                onClick={() => open({ kind: 'metric', id: 'headcount' })} />
            <Tile icon={UserMinus} label="Left" value={String(k.headcount.exits)} exact={`${k.headcount.exits} left in period`}
                foot={attrition === null ? 'left in this period' : `${attrition.toFixed(1)}% attrition`} tone={k.headcount.exits ? 'down' : null}
                onClick={() => navigate('/ex-employees')} />
            <Tile icon={CalendarCheck} label="In today" value={attendance ? String(attendance.present) : '—'}
                exact={attendance ? `${attendance.present} of ${staff.length}` : 'not available'}
                foot={att === undefined ? 'loading…' : attendance ? `${attendance.unmarked} not marked yet` : 'not available to your role'}
                onClick={() => navigate('/attendance')} />
            <Tile icon={Plane} label="On leave today" value={leaves ? String(leaves.outToday.length) : '—'}
                exact={leaves ? `${leaves.outToday.length} people` : 'not available'}
                foot={leave === undefined ? 'loading…' : leaves ? `${leaves.upcoming.length} upcoming` : 'not available to your role'}
                onClick={() => navigate('/leave')} />
            <Tile icon={Inbox} label="Leave to decide" value={leaves ? String(leaves.pending.length) : '—'}
                exact={leaves ? `${leaves.pending.length} pending` : 'not available'} tone={leaves?.pending.length ? 'down' : null}
                foot={leaves?.pending.length ? 'waiting for a decision' : 'nothing waiting'}
                onClick={() => navigate('/leave')} />
        </TileRow>

        <CardGrid cols={cols}>
            <Card style={grid(2)} title="Headcount" note="people on the books at the end of each bucket" right={<More onClick={() => open({ kind: 'metric', id: 'headcount' })} />}>
                <Columns data={model.series} series={[{ key: 'headcount', label: 'People', color: t.chart }]} height={220}
                    format={(v) => String(Math.round(v))} tipFormat={(v) => String(v)} onSelect={() => open({ kind: 'metric', id: 'headcount' })} />
            </Card>

            <Card title="Departments" note="today" right={<More label="Hierarchy" to="/team-hierarchy" />}>
                <RankBars rows={model.departments} format={(v) => String(v)} total={k.headcount.value} max={6}
                    onSelect={(r) => open({ kind: 'department', name: r.name })} empty="No employees yet" />
                {model.employmentTypes.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                        <div style={{ fontSize: 9, letterSpacing: '0.1em', color: t.faint, marginBottom: 6 }}>EMPLOYMENT TYPE</div>
                        <SplitBar format={(v) => String(v)} unit="People" parts={model.employmentTypes.map((e, i) => ({ id: e.name, label: e.name, value: e.value, color: cat[i] }))} />
                    </div>
                )}
            </Card>

            <Card title="Attendance today" note={fmtDay(today)} right={<More label="Sheet" to="/attendance" />}>
                {att === undefined ? <EmptyNote>Loading…</EmptyNote> : !attendance ? <EmptyNote>Attendance is not available to your role</EmptyNote> : (<>
                    <BigCount value={staff.length ? `${Math.round((attendance.present / staff.length) * 100)}%` : '—'} label="of the team in today" />
                    <SplitBar format={(v) => String(v)} unit="People" parts={[
                        ...ATTENDANCE_STATUSES.map((s) => ({ id: s.key, label: s.label, value: attendance.byStatus[s.key], color: attColor[s.key] })),
                        { id: 'unmarked', label: 'Not marked', value: attendance.unmarked, color: t.lineStrong },
                    ].filter((p) => p.value > 0)} onSelect={() => navigate('/attendance')} />
                </>)}
            </Card>

            <Card title="Leave" note="waiting for a decision, and who is out" right={<More label="Leave" to="/leave" />}>
                {leave === undefined ? <EmptyNote>Loading…</EmptyNote> : !leaves ? <EmptyNote>Leave is not available to your role</EmptyNote>
                    : leaves.pending.length + leaves.outToday.length + leaves.upcoming.length === 0 ? <EmptyNote>No pending, current or upcoming leave</EmptyNote> : (<>
                        {[...leaves.pending.map((r) => ({ r, tag: 'pending' })), ...leaves.outToday.map((r) => ({ r, tag: 'out today' })), ...leaves.upcoming.map((r) => ({ r, tag: 'upcoming' }))]
                            .slice(0, 7).map(({ r, tag }) => (
                                <ListRow key={r.id + tag} label={nameOf[r.employee_id] || 'Employee'}
                                    sub={`${fmtDay(r.start_date)}${r.end_date !== r.start_date ? ' – ' + fmtDay(r.end_date) : ''} · ${r.days ?? ''} day${Number(r.days) === 1 ? '' : 's'}`}
                                    value={tag} tone={tag === 'pending' ? 'down' : null} onClick={() => navigate('/leave')} />
                            ))}
                    </>)}
            </Card>

            <Card title="Joiners & leavers" note="in this period">
                {movers.length === 0 ? <EmptyNote>Nobody joined or left in this period</EmptyNote> : movers.slice(0, 7).map(({ e, kind, day }) => (
                    <ListRow key={e.id + kind} label={e.name || 'Unnamed'} sub={[e.role, e.department].filter(Boolean).join(' · ') || '—'}
                        value={`${kind} ${fmtDay(day).slice(0, 6)}`} tone={kind === 'joined' ? 'up' : 'down'}
                        onClick={() => navigate(kind === 'joined' ? '/employees' : '/ex-employees')} />
                ))}
            </Card>

            <Card title="Who is carrying the work" note="open tasks per person · today" right={<More label="Tasks" to="/tasks" />}>
                <SplitBar format={(v) => String(v)} unit="Tasks" parts={model.taskStates.map((s) => ({ id: s.id, label: s.label, value: s.count, color: taskColor[s.id] }))}
                    onSelect={(p) => open({ kind: 'tasks', id: p.id })} />
                <div style={{ height: 12 }} />
                <RankBars rows={model.workload.map((w) => ({ ...w, value: w.open }))} format={(v) => String(v)} max={5} color={cat[0]}
                    sub={(r) => (r.overdue ? <span style={{ color: t.down }}>{r.overdue} late</span> : '')}
                    onSelect={() => open({ kind: 'tasks', id: 'overdue' })} empty="No open tasks" />
            </Card>
        </CardGrid>
    </>);
}
