// EmployeeWorkInsights: the right half of an employee's sheet: how they are
// working. Same numbers and charts as that person's own portal (portal/me), so
// the admin and the employee are never looking at two versions of one month.
//
// One hook (useEmployeeWork.js) loads everything once; the sheet's tabs render
// pieces of it (TodayStrip, AttendanceSection, LeaveSection, LeaveSummary), so
// switching tabs never refetches.
//
// Everything is read through the admin's own permissions: without `attendance`
// or `leave` view the queries come back empty and the panels say so, rather
// than the sheet failing to open.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Panel, Btn, Bar, Breakdown, Empty } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { currentMonthKey, formatDuration } from '../../services/attendanceService';
import { LEAVE_STATUSES } from '../../services/leaveService';
import { Kpi, SectionLabel } from '../portal/me/portalKit';
import { HoursPerDayChart, MonthsWorkedChart, CheckInChart } from '../portal/me/WorkCharts';
import { shiftMonth, monthLabel, minutesToClock, hoursLabel, fmtLongDay } from '../portal/me/portalUtils';

/* ── today ─────────────────────────────────────────────────────────────────── */

export function TodayStrip({ work }) {
  const t = useT();
  const { now } = work;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      border: '1px solid ' + t.line, borderRadius: 10, padding: '11px 14px', background: t.panelAlt,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', background: now.tone, flexShrink: 0,
        boxShadow: now.label === 'Working now' ? `0 0 0 4px ${t.up}2e` : 'none',
      }} />
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontSize: 11, color: t.faint, marginBottom: 2 }}>Today</div>
        <div style={{ fontSize: 14, color: t.text }}>{now.label}</div>
        {now.detail && <div style={{ fontSize: 11.5, color: t.faint, marginTop: 2 }}>{now.detail}</div>}
      </div>
      <Mini label="Streak" value={`${work.streak}d`} />
      <Mini label="6-Month Hours" value={hoursLabel(work.sixMonthMinutes)} />
    </div>
  );
}

/* ── attendance tab ────────────────────────────────────────────────────────── */

export function AttendanceSection({ work, narrow }) {
  const { monthKey, setMonthKey, ins, rows, series, checkIns, months, statusRows } = work;
  return (
    <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
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
            value={ins.rate == null ? '-' : `${Math.round(ins.rate * 100)}%`}
            note={`${ins.daysWorked} of ${ins.expected} working days`}
          />
          <Kpi label="Hours Logged" value={hoursLabel(ins.minutes)} note={`${Object.keys(rows).length} days on record`} />
          <Kpi label="Avg Day" value={ins.avgMinutes ? formatDuration(Math.round(ins.avgMinutes)) : '-'} note="Check-in to check-out" />
          <Kpi label="Avg Check-In" value={minutesToClock(ins.avgCheckIn)} note={checkIns.length ? `${checkIns.length} check-ins` : 'None this month'} />
        </div>
      </div>

      <Panel title="Hours per day" note="dashed line = 8h">
        <HoursPerDayChart series={series} height={190} empty={`No completed days in ${monthLabel(monthKey)}.`} />
      </Panel>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: narrow ? '1fr' : 'repeat(2, minmax(0, 1fr))' }}>
        <Panel title="Days worked" note="last 6 months">
          <MonthsWorkedChart months={months} currentKey={monthKey} height={170} empty="No attendance on record yet." />
        </Panel>
        <Panel title="Check-in time" note={monthLabel(monthKey)}>
          <CheckInChart points={checkIns} height={170} />
        </Panel>
      </div>

      <Panel title="Month breakdown" pad={14}>
        {statusRows.length
          ? <Breakdown rows={statusRows} />
          : <Empty>Nothing marked in {monthLabel(monthKey)}.</Empty>}
      </Panel>
    </div>
  );
}

/* ── leave ─────────────────────────────────────────────────────────────────── */

function Balances({ balances }) {
  const t = useT();
  if (!balances.length) return <Empty>No leave types configured.</Empty>;
  return (
    <div style={{ padding: 14, display: 'grid', gap: 11 }}>
      {balances.map((b) => {
        const total = Number(b.quota) + Number(b.adjusted);
        return (
          <div key={b.leave_type_id}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
              <span style={{ flex: 1, fontSize: 12.5, color: t.text }}>{b.leave_type_name}</span>
              <span style={{ fontSize: 13.5, color: t.text }}>{Number(b.remaining)}</span>
              <span style={{ fontSize: 11, color: t.faint }}>of {total} left</span>
            </div>
            <Bar value={Number(b.taken)} max={total || 1} />
          </div>
        );
      })}
    </div>
  );
}

function Requests({ requests, typeName, limit }) {
  const t = useT();
  if (!requests.length) return <Empty>No leave requested.</Empty>;
  return (limit ? requests.slice(0, limit) : requests).map((r, i) => {
    const s = LEAVE_STATUSES[r.status] || {};
    return (
      <div key={r.id} style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
        borderTop: i ? '1px solid ' + t.lineSoft : 'none',
      }}>
        <span style={{ width: 3, height: 26, borderRadius: 3, background: s.color || t.ghost, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: t.text }}>{typeName(r.leave_type_id)} · {Number(r.days)} day{Number(r.days) === 1 ? '' : 's'}</div>
          <div style={{ fontSize: 11.5, color: t.faint, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {fmtLongDay(r.start_date)}{r.end_date !== r.start_date && ` → ${fmtLongDay(r.end_date)}`}
            {r.reason && ` · ${r.reason}`}
          </div>
        </div>
        <span style={{ fontSize: 12, color: t.dim, flexShrink: 0 }}>{s.label || r.status}</span>
      </div>
    );
  });
}

export function LeaveSection({ work, narrow }) {
  const { balances, requests, pending, typeName } = work;
  return (
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: narrow ? '1fr' : 'minmax(0, 2fr) minmax(0, 3fr)', alignItems: 'start' }}>
      <Panel title="Leave balance" note={pending.length ? `${pending.length} pending` : undefined}>
        <Balances balances={balances} />
      </Panel>
      <Panel title="Leave requests" note={requests.length ? `${requests.length} in total` : undefined}>
        <Requests requests={requests} typeName={typeName} />
      </Panel>
    </div>
  );
}

/** Overview: the most recent three requests, with balances beside them. */
export function LeaveSummary({ work, narrow }) {
  const { balances, requests, pending, typeName } = work;
  return (
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: narrow ? '1fr' : 'repeat(2, minmax(0, 1fr))', alignItems: 'start' }}>
      <Panel title="Leave balance" note={pending.length ? `${pending.length} pending` : undefined}>
        <Balances balances={balances} />
      </Panel>
      <Panel title="Recent leave" note={requests.length > 3 ? `latest 3 of ${requests.length}` : undefined}>
        <Requests requests={requests} typeName={typeName} limit={3} />
      </Panel>
    </div>
  );
}

function Mini({ label, value }) {
  const t = useT();
  return (
    <div style={{ textAlign: 'right', paddingLeft: 12, borderLeft: '1px solid ' + t.line }}>
      <div style={{ fontSize: 14.5, color: t.text }}>{value}</div>
      <div style={{ fontSize: 11, color: t.faint, marginTop: 2 }}>{label}</div>
    </div>
  );
}
