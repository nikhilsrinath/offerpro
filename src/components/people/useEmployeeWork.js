// useEmployeeWork: loads one employee's attendance (six months, plus any month
// browsed back to) and leave once, and derives what the sheet's tabs show.
import { useEffect, useMemo, useState } from 'react';
import { useT } from '../ui/edgeUtils';
import {
  attendanceService, ATTENDANCE_STATUSES, currentMonthKey, formatDuration, todayKey, workedMinutes,
} from '../../services/attendanceService';
import { leaveService, LEAVE_STATUSES } from '../../services/leaveService';
import {
  recentMonths, monthLabel, monthInsights, dailySeries, attendanceStreak,
  hoursLabel, clockTime, fmtLongDay, useNow,
} from '../portal/me/portalUtils';

export function useEmployeeWork(emp, orgId) {
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
  const pending = requests.filter((r) => r.status === 'pending');
  const leaveLeft = balances.reduce((s, b) => s + (Number(b.remaining) || 0), 0);

  // The current month, whatever month is being browsed: the overview's numbers.
  const thisMonth = monthInsights(currentMonthKey(), history[currentMonthKey()] || {});

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

  const statusRows = ATTENDANCE_STATUSES
    .map((s) => ({ label: s.label, color: s.color, value: Object.values(rows).filter((r) => r.status === s.key).length }))
    .filter((r) => r.value > 0);

  return {
    loading, monthKey, setMonthKey, rows, ins, series, checkIns, streak, months, sixMonthMinutes,
    balances, requests, pending, leaveLeft, typeName, thisMonth, statusRows,
    now: { label: nowLabel, tone: nowTone, detail: nowDetail },
  };
}
