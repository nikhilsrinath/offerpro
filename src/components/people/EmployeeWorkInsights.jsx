// EmployeeWorkInsights — the right half of an employee's sheet: how they are
// working. Same numbers and charts as that person's own portal (portal/me), so
// the admin and the employee are never looking at two versions of one month.
//
// Everything is read through the admin's own permissions: without `attendance`
// or `leave` view the queries come back empty and the panels say so, rather
// than the sheet failing to open.
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Panel, Btn, Bar, Breakdown, Empty, Loading } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import {
  attendanceService, ATTENDANCE_STATUSES, currentMonthKey, formatDuration, todayKey, workedMinutes,
} from '../../services/attendanceService';
import { leaveService, LEAVE_STATUSES } from '../../services/leaveService';
import { Kpi, SectionLabel } from '../portal/me/portalKit';
import { HoursPerDayChart, MonthsWorkedChart, CheckInChart } from '../portal/me/WorkCharts';
import {
  recentMonths, shiftMonth, monthLabel, monthInsights, dailySeries, attendanceStreak,
  minutesToClock, hoursLabel, clockTime, fmtLongDay, useNow,
} from '../portal/me/portalUtils';

export default function EmployeeWorkInsights({ emp, orgId, narrow }) {
  const t = useT();
  const now = useNow(30000);
  const [history, setHistory] = useState({});
  const [balances, setBalances] = useState([]);
  const [requests, setRequests] = useState([]);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [monthKey, setMonthKey] = useState(currentMonthKey());

  useEffect(() => {
    if (!orgId || !emp?.id) return undefined;
    let cancelled = false;
    const months = recentMonths(6);
    Promise.all([
      Promise.all(months.map((k) => attendanceService.listMonth(orgId, emp.id, k).catch(() => ({})))),
      leaveService.balances(orgId, emp.id).catch(() => []),
      leaveService.listRequests(orgId, { employeeId: emp.id }).catch(() => []),
      leaveService.listTypes(orgId).catch(() => []),
    ]).then(([monthRows, b, r, ty]) => {
      if (cancelled) return;
      setHistory(Object.fromEntries(months.map((k, i) => [k, monthRows[i]])));
      setBalances(b); setRequests(r); setTypes(ty);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orgId, emp?.id]);

  // Browsing back past the six months already held.
  useEffect(() => {
    if (loading || !orgId || !emp?.id || history[monthKey]) return undefined;
    let cancelled = false;
    attendanceService.listMonth(orgId, emp.id, monthKey)
      .catch(() => ({}))
      .then((rows) => { if (!cancelled) setHistory((h) => ({ ...h, [monthKey]: rows })); });
    return () => { cancelled = true; };
  }, [loading, orgId, emp?.id, monthKey, history]);

  const allRows = useMemo(() => Object.assign({}, ...Object.values(history)), [history]);
  const rows = history[monthKey] || {};
  const ins = monthInsights(monthKey, rows);
  const series = dailySeries(monthKey, rows);
  const checkIns = series.filter((d) => d.checkIn != null);
  const streak = attendanceStreak(allRows);
  const months = recentMonths(6).map((k) => {
    const m = monthInsights(k, history[k] || {});
    return { key: k, label: monthLabel(k, 'short'), days: m.daysWorked, minutes: m.minutes, rate: m.rate };
  });
  const sixMonthMinutes = months.reduce((s, m) => s + m.minutes, 0);
  const typeName = (id) => types.find((x) => x.id === id)?.name || 'Leave';

  if (loading) return <Loading>Loading work history…</Loading>;

  // ── Right now ─────────────────────────────────────────────────────────────
  const today = allRows[todayKey()];
  const onLeave = requests.find((r) => r.status === 'approved' && r.start_date <= todayKey() && r.end_date >= todayKey());
  let nowLabel = 'Not checked in today';
  let nowTone = t.ghost;
  let nowDetail = null;
  if (onLeave) {
    nowLabel = `On ${typeName(onLeave.leave_type_id).toLowerCase()} leave`;
    nowTone = LEAVE_STATUSES.approved.color;
    nowDetail = `until ${fmtLongDay(onLeave.end_date)}`;
  } else if (today?.check_in && !today.check_out) {
    nowLabel = 'Working now';
    nowTone = t.up;
    nowDetail = `in since ${clockTime(today.check_in)} · ${hoursLabel(Math.max(0, Math.round((now - new Date(today.check_in)) / 60000)))}`;
  } else if (today?.check_out) {
    nowLabel = 'Done for the day';
    nowTone = t.dim;
    nowDetail = `${clockTime(today.check_in)} – ${clockTime(today.check_out)} · ${formatDuration(workedMinutes(today))}`;
  } else if (today) {
    nowLabel = ATTENDANCE_STATUSES.find((s) => s.key === today.status)?.label || today.status;
  }

  const pending = requests.filter((r) => r.status === 'pending');
  const statusRows = ATTENDANCE_STATUSES
    .map((s) => ({ label: s.label, color: s.color, value: Object.values(rows).filter((r) => r.status === s.key).length }))
    .filter((r) => r.value > 0);

  return (
    <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
      {/* ── status strip ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        border: '1px solid ' + t.line, borderRadius: 10, padding: '11px 14px', background: t.panelAlt,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', background: nowTone, flexShrink: 0,
          boxShadow: nowLabel === 'Working now' ? `0 0 0 4px ${t.up}2e` : 'none',
        }} />
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ fontSize: 12.5, color: t.text }}>{nowLabel}</div>
          {nowDetail && <div style={{ fontSize: 10, color: t.faint, marginTop: 2 }}>{nowDetail}</div>}
        </div>
        <Mini label="Streak" value={`${streak}d`} />
        <Mini label="6-month hours" value={hoursLabel(sixMonthMinutes)} />
        <Mini label="Pending leave" value={pending.length} />
      </div>

      {/* ── the month ────────────────────────────────────────────────────── */}
      <div>
        <SectionLabel right={
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Btn size="sm" onClick={() => setMonthKey(shiftMonth(monthKey, -1))} title="Previous month"><ChevronLeft size={12} /></Btn>
            {monthKey !== currentMonthKey() && <Btn size="sm" onClick={() => setMonthKey(currentMonthKey())}>Now</Btn>}
            <Btn size="sm" onClick={() => setMonthKey(shiftMonth(monthKey, 1))} disabled={monthKey >= currentMonthKey()} title="Next month">
              <ChevronRight size={12} />
            </Btn>
          </div>
        }>{monthLabel(monthKey)}</SectionLabel>

        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: narrow ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))' }}>
          <Kpi
            label="Attendance" share={ins.rate}
            value={ins.rate == null ? '—' : `${Math.round(ins.rate * 100)}%`}
            note={`${ins.daysWorked} of ${ins.expected} working days`}
          />
          <Kpi label="Hours logged" value={hoursLabel(ins.minutes)} note={`${Object.keys(rows).length} days on record`} />
          <Kpi label="Avg day" value={ins.avgMinutes ? formatDuration(Math.round(ins.avgMinutes)) : '—'} note="Check-in to check-out" />
          <Kpi label="Avg check-in" value={minutesToClock(ins.avgCheckIn)} note={checkIns.length ? `${checkIns.length} check-ins` : 'None this month'} />
        </div>
      </div>

      <Panel title="Hours per day" note="dashed line = 8h">
        <HoursPerDayChart series={series} height={200} empty={`No completed days in ${monthLabel(monthKey)}.`} />
      </Panel>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: narrow ? '1fr' : 'repeat(2, minmax(0, 1fr))' }}>
        <Panel title="Days worked" note="last 6 months">
          <MonthsWorkedChart months={months} currentKey={monthKey} height={180} empty="No attendance on record yet." />
        </Panel>
        <Panel title="Check-in time" note={monthLabel(monthKey)}>
          <CheckInChart points={checkIns} height={180} />
        </Panel>
      </div>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: narrow ? '1fr' : 'repeat(2, minmax(0, 1fr))' }}>
        <Panel title="Month breakdown" pad={14}>
          {statusRows.length
            ? <Breakdown rows={statusRows} />
            : <Empty>Nothing marked in {monthLabel(monthKey)}.</Empty>}
        </Panel>

        <Panel title="Leave balance" note={pending.length ? `${pending.length} pending` : undefined}>
          <div style={{ padding: 14, display: 'grid', gap: 11 }}>
            {balances.length ? balances.map((b) => {
              const total = Number(b.quota) + Number(b.adjusted);
              return (
                <div key={b.leave_type_id}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
                    <span style={{ flex: 1, fontSize: 11, color: t.text }}>{b.leave_type_name}</span>
                    <span style={{ fontSize: 12, color: t.text }}>{Number(b.remaining)}</span>
                    <span style={{ fontSize: 9.5, color: t.faint }}>of {total} left</span>
                  </div>
                  <Bar value={Number(b.taken)} max={total || 1} />
                </div>
              );
            }) : <Empty>No leave types configured.</Empty>}
          </div>
        </Panel>
      </div>

      <Panel title="Recent leave requests" note={requests.length ? `${requests.length} in total` : undefined}>
        {requests.length ? requests.slice(0, 5).map((r, i) => {
          const s = LEAVE_STATUSES[r.status] || {};
          return (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
              borderTop: i ? '1px solid ' + t.lineSoft : 'none',
            }}>
              <span style={{ width: 3, height: 26, borderRadius: 3, background: s.color || t.ghost, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: t.text }}>{typeName(r.leave_type_id)} · {Number(r.days)} day{Number(r.days) === 1 ? '' : 's'}</div>
                <div style={{ fontSize: 10, color: t.faint, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {fmtLongDay(r.start_date)}{r.end_date !== r.start_date && ` → ${fmtLongDay(r.end_date)}`}
                  {r.reason && ` · ${r.reason}`}
                </div>
              </div>
              <span style={{ fontSize: 10.5, color: t.dim, flexShrink: 0 }}>{s.label || r.status}</span>
            </div>
          );
        }) : <Empty>No leave requested.</Empty>}
      </Panel>
    </div>
  );
}

function Mini({ label, value }) {
  const t = useT();
  return (
    <div style={{ textAlign: 'right', paddingLeft: 12, borderLeft: '1px solid ' + t.line }}>
      <div style={{ fontSize: 13, color: t.text }}>{value}</div>
      <div style={{ fontSize: 8.5, letterSpacing: '0.1em', color: t.faint, marginTop: 2 }}>{label.toUpperCase()}</div>
    </div>
  );
}
