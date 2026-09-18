// WorkCharts.jsx — the attendance charts, drawn once and used twice: in the
// employee's own portal and in the admin's sheet for that employee, so both
// sides of the same record read the same picture.
//
// Single series, monochrome: the bar for today (or the current month) is the
// full text colour and the rest a mid grey. Every chart has a hover tooltip and
// an empty state instead of a bare axis.
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid, Cell,
  LineChart, Line,
} from 'recharts';
import { Empty } from '../../ui/edge';
import { useT, MONO } from '../../ui/edgeUtils';
import { formatDuration, workedMinutes, statusLabel, todayKey } from '../../../services/attendanceService';
import { ChartTip } from './portalKit';
import { monthLabel, minutesToClock, hoursLabel, fmtWeekday, clockTime } from './portalUtils';

const useAxis = () => {
  const t = useT();
  return { fontSize: 9.5, fill: t.faint, fontFamily: MONO };
};

/** Hours worked per day, from `dailySeries()`. */
export function HoursPerDayChart({ series, height = 210, empty = 'No completed days yet.' }) {
  const t = useT();
  const axis = useAxis();
  const today = todayKey();
  return (
    <div style={{ height, padding: '14px 8px 4px 0' }}>
      {series.some((d) => d.hours > 0) ? (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series} barCategoryGap={2} margin={{ left: 0, right: 8 }}>
            <CartesianGrid vertical={false} stroke={t.lineSoft} />
            <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={{ stroke: t.line }} interval="preserveStartEnd" minTickGap={10} />
            <YAxis tick={axis} tickLine={false} axisLine={false} width={32} tickFormatter={(v) => `${v}h`} allowDecimals={false} />
            <ReferenceLine y={8} stroke={t.ghost} strokeDasharray="4 4" />
            <Tooltip
              cursor={{ fill: t.panelAlt }}
              content={<ChartTip render={(d) => [
                [fmtWeekday(d.key), null],
                ['Status', d.row ? statusLabel(d.row.status) : (d.weekend ? 'Weekend' : 'No record')],
                ...(d.row?.check_in ? [['In – out', `${clockTime(d.row.check_in)} – ${clockTime(d.row.check_out) || 'open'}`]] : []),
                ['Worked', formatDuration(workedMinutes(d.row))],
              ]} />}
            />
            <Bar dataKey="hours" radius={[4, 4, 0, 0]} maxBarSize={18}>
              {series.map((d) => <Cell key={d.key} fill={d.key === today ? t.text : t.scale[3]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : <Empty>{empty}</Empty>}
    </div>
  );
}

/** Days worked per month; `months` is [{ key, label, days, minutes, rate }]. */
export function MonthsWorkedChart({ months, currentKey, height = 210, empty = 'No history yet.' }) {
  const t = useT();
  const axis = useAxis();
  return (
    <div style={{ height, padding: '14px 8px 4px 0' }}>
      {months.some((m) => m.days > 0) ? (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={months} margin={{ left: 0, right: 8 }}>
            <CartesianGrid vertical={false} stroke={t.lineSoft} />
            <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: t.line }} />
            <YAxis tick={axis} tickLine={false} axisLine={false} width={26} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: t.panelAlt }}
              content={<ChartTip render={(m) => [
                [monthLabel(m.key), null],
                ['Days worked', m.days],
                ['Hours', hoursLabel(m.minutes)],
                ['Attendance', m.rate == null ? '—' : `${Math.round(m.rate * 100)}%`],
              ]} />}
            />
            <Bar dataKey="days" radius={[4, 4, 0, 0]} maxBarSize={26}>
              {months.map((m) => <Cell key={m.key} fill={m.key === currentKey ? t.text : t.scale[3]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : <Empty>{empty}</Empty>}
    </div>
  );
}

/** Check-in time of day across the days that have one. Earlier sits higher. */
export function CheckInChart({ points, height = 180, empty = 'Needs a couple of check-ins to draw a trend.' }) {
  const t = useT();
  const axis = useAxis();
  return (
    <div style={{ height, padding: '12px 8px 4px 0' }}>
      {points.length > 1 ? (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ left: 0, right: 10, top: 4 }}>
            <CartesianGrid vertical={false} stroke={t.lineSoft} />
            <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={{ stroke: t.line }} />
            <YAxis
              tick={axis} tickLine={false} axisLine={false} width={40} reversed
              domain={[(min) => Math.max(0, Math.floor((min - 15) / 30) * 30), (max) => Math.min(1440, Math.ceil((max + 15) / 30) * 30)]}
              tickFormatter={minutesToClock} interval="preserveStartEnd"
            />
            <Tooltip
              cursor={{ stroke: t.lineStrong }}
              content={<ChartTip render={(d) => [[fmtWeekday(d.key), null], ['Checked in', minutesToClock(d.checkIn)]]} />}
            />
            <Line
              type="monotone" dataKey="checkIn" stroke={t.chart} strokeWidth={2}
              dot={{ r: 3, fill: t.panel, stroke: t.chart, strokeWidth: 2 }} activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : <Empty>{empty}</Empty>}
    </div>
  );
}
