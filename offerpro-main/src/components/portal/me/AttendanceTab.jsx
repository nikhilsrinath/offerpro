// AttendanceTab — one month of your own attendance: the calendar to see the
// shape of it, the numbers to summarise it, and the day list for the detail.
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { HoursPerDayChart } from './WorkCharts';
import { Panel, Btn, Seg, Table, Tr, Td, Status, Empty, Loading } from '../../ui/edge';
import { useT, MONO } from '../../ui/edgeUtils';
import {
  ATTENDANCE_STATUSES, statusLabel, todayKey, currentMonthKey, monthBounds, workedMinutes, formatDuration,
} from '../../../services/attendanceService';
import { Kpi } from './portalKit';
import {
  shiftMonth, monthLabel, monthInsights, dailySeries, minutesToClock, hoursLabel, fmtWeekday, clockTime,
} from './portalUtils';

const STATUS_COLOR = Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s.key, s.color]));
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function AttendanceTab({ monthKey, setMonthKey, rows, loading, narrow }) {
  const t = useT();
  const [view, setView] = useState('calendar');
  const { days } = monthBounds(monthKey);
  const firstDow = (new Date(`${monthKey}-01T00:00:00`).getDay() + 6) % 7;
  const ins = monthInsights(monthKey, rows || {});
  const series = dailySeries(monthKey, rows || {});
  const today = todayKey();

  const cells = [];
  for (let i = 0; i < firstDow; i += 1) cells.push(null);
  for (let d = 1; d <= days; d += 1) cells.push(`${monthKey}-${String(d).padStart(2, '0')}`);

  const listed = Object.values(rows || {}).sort((a, b) => b.work_date.localeCompare(a.work_date));

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Btn size="sm" onClick={() => setMonthKey(shiftMonth(monthKey, -1))} title="Previous month"><ChevronLeft size={13} /></Btn>
          <span style={{ minWidth: 150, textAlign: 'center', fontSize: 13, color: t.text }}>{monthLabel(monthKey)}</span>
          <Btn size="sm" onClick={() => setMonthKey(shiftMonth(monthKey, 1))} disabled={monthKey >= currentMonthKey()} title="Next month">
            <ChevronRight size={13} />
          </Btn>
        </div>
        {monthKey !== currentMonthKey() && <Btn size="sm" onClick={() => setMonthKey(currentMonthKey())}>This month</Btn>}
        <div style={{ flex: 1 }} />
        <Seg size="sm" value={view} onChange={setView} options={[{ id: 'calendar', label: 'Calendar' }, { id: 'list', label: 'Day list' }]} />
      </div>

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <Kpi label="Attendance" value={ins.rate == null ? '—' : `${Math.round(ins.rate * 100)}%`} share={ins.rate} note={`${ins.daysWorked} of ${ins.expected} working days`} />
        <Kpi label="Hours" value={hoursLabel(ins.minutes)} note={ins.avgMinutes ? `${formatDuration(Math.round(ins.avgMinutes))} per day` : '—'} />
        <Kpi label="Avg check-in" value={minutesToClock(ins.avgCheckIn)} />
        <Kpi label="Remote · half · leave" value={`${ins.remote} · ${ins.halfDays} · ${ins.leave}`} note={ins.absent ? `${ins.absent} absent` : 'No absences'} tone={ins.absent ? 'down' : undefined} />
      </div>

      {loading ? <Loading>Loading {monthLabel(monthKey)}…</Loading> : view === 'calendar' ? (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: narrow ? '1fr' : 'minmax(0, 1.25fr) minmax(0, 1fr)' }}>
          <Panel title="Calendar">
            <div style={{ padding: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
                {WEEKDAYS.map((w) => (
                  <div key={w} style={{ fontSize: 9, letterSpacing: '0.08em', color: t.faint, textAlign: 'center', padding: '2px 0 6px' }}>{w.toUpperCase()}</div>
                ))}
                {cells.map((key, i) => {
                  if (!key) return <div key={`pad-${i}`} />;
                  const row = rows?.[key];
                  const color = row ? STATUS_COLOR[row.status] : null;
                  const future = key > today;
                  return (
                    <div key={key} title={row ? `${fmtWeekday(key)} · ${statusLabel(row.status)} · ${formatDuration(workedMinutes(row))}` : fmtWeekday(key)} style={{
                      aspectRatio: '1 / 0.86', minHeight: 38, borderRadius: 7, padding: '5px 6px',
                      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                      border: '1px solid ' + (key === today ? t.text : t.lineSoft),
                      background: color ? `${color}1f` : future ? 'transparent' : t.panelAlt,
                      opacity: future ? 0.45 : 1, minWidth: 0,
                    }}>
                      <span style={{ fontSize: 10.5, color: t.text }}>{Number(key.slice(-2))}</span>
                      {row && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
                          {!narrow && <span style={{ fontSize: 9, color: t.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {workedMinutes(row) != null ? hoursLabel(workedMinutes(row)) : statusLabel(row.status)}
                          </span>}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 12 }}>
                {ATTENDANCE_STATUSES.map((s) => (
                  <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, color: t.dim }}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: s.color }} />{s.label}
                  </span>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="Hours per day" note="dashed line = 8h">
            <HoursPerDayChart series={series} height={300} empty={`No completed days in ${monthLabel(monthKey)}.`} />
          </Panel>
        </div>
      ) : (
        <Table
          cols={[
            { key: 'd', label: 'Date' }, { key: 's', label: 'Status' },
            { key: 'i', label: 'In' }, { key: 'o', label: 'Out' }, { key: 'h', label: 'Worked', align: 'right' },
          ]}
          empty={!listed.length && <Empty>Nothing recorded in {monthLabel(monthKey)}.</Empty>}
        >
          {listed.map((r) => (
            <Tr key={r.id}>
              <Td nowrap>{fmtWeekday(r.work_date)}</Td>
              <Td><Status tone={['present', 'remote'].includes(r.status) ? 'up' : r.status === 'absent' ? 'down' : 'neutral'}>{statusLabel(r.status)}</Status></Td>
              <Td muted nowrap>{clockTime(r.check_in) || '—'}</Td>
              <Td muted nowrap>{clockTime(r.check_out) || '—'}</Td>
              <Td align="right" nowrap>{formatDuration(workedMinutes(r))}</Td>
            </Tr>
          ))}
        </Table>
      )}
    </div>
  );
}
