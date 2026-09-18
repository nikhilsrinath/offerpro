// portalUtils.js — the numbers the employee portal derives about a person.
//
// Kept out of the component files so fast refresh keeps working and so every
// tab computes "attendance rate" or "average check-in" the same way. Nothing
// here reads the database; each helper takes rows already fetched under the
// employee's own RLS policies.
import { useEffect, useState } from 'react';
import { resolveImageUrl } from '../../../services/imageUploadService';
import {
  todayKey, currentMonthKey, monthBounds, workedMinutes,
} from '../../../services/attendanceService';

export const WORKED = ['present', 'remote', 'half_day'];

export const shiftMonth = (monthKey, delta) => {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** The last `n` month keys, oldest first, ending with the current month. */
export const recentMonths = (n = 6) => Array.from({ length: n }, (_, i) => shiftMonth(currentMonthKey(), i - (n - 1)));

export const monthLabel = (monthKey, style = 'long') => new Date(`${monthKey}-01T00:00:00`)
  .toLocaleDateString('en-IN', style === 'short' ? { month: 'short' } : { month: 'long', year: 'numeric' });

export const fmtLongDay = (d) => (d
  ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—');

export const fmtWeekday = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`)
  .toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

export const clockTime = (iso) => (iso
  ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  : null);

/** Minutes since local midnight → "09:42". */
export const minutesToClock = (mins) => {
  if (mins == null || Number.isNaN(mins)) return '—';
  const m = Math.round(mins);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export const hoursLabel = (minutes) => {
  if (!minutes) return '0h';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
};

const isWeekday = (dateKey) => {
  const dow = new Date(`${dateKey}T00:00:00`).getDay();
  return dow !== 0 && dow !== 6;
};

/** Mon–Fri dates in a month, stopping at today for the current month. */
export function workingDaysSoFar(monthKey) {
  const { days } = monthBounds(monthKey);
  const today = todayKey();
  const out = [];
  for (let d = 1; d <= days; d += 1) {
    const key = `${monthKey}-${String(d).padStart(2, '0')}`;
    if (key > today) break;
    if (isWeekday(key)) out.push(key);
  }
  return out;
}

/**
 * Everything the dashboard says about one month. Half days count as half a day
 * worked; a holiday is taken out of the denominator rather than counted as
 * absence, since nobody was expected in.
 */
export function monthInsights(monthKey, rowsByDate = {}) {
  const rows = Object.values(rowsByDate);
  const working = workingDaysSoFar(monthKey);
  const holidays = rows.filter((r) => r.status === 'holiday' && isWeekday(r.work_date)).length;
  const expected = Math.max(0, working.length - holidays);

  const credit = rows.reduce((sum, r) => sum + (r.status === 'half_day' ? 0.5 : WORKED.includes(r.status) ? 1 : 0), 0);
  const closed = rows.filter((r) => workedMinutes(r) != null);
  const minutes = closed.reduce((s, r) => s + workedMinutes(r), 0);
  const checkIns = rows.filter((r) => r.check_in).map((r) => {
    const d = new Date(r.check_in);
    return d.getHours() * 60 + d.getMinutes();
  });

  return {
    monthKey,
    present: rows.filter((r) => r.status === 'present').length,
    remote: rows.filter((r) => r.status === 'remote').length,
    halfDays: rows.filter((r) => r.status === 'half_day').length,
    leave: rows.filter((r) => r.status === 'leave').length,
    absent: rows.filter((r) => r.status === 'absent').length,
    daysWorked: credit,
    expected,
    rate: expected ? Math.min(1, credit / expected) : null,
    minutes,
    avgMinutes: closed.length ? minutes / closed.length : null,
    avgCheckIn: checkIns.length ? checkIns.reduce((a, b) => a + b, 0) / checkIns.length : null,
  };
}

/**
 * Consecutive working days attended, counting back from today. A weekend
 * or holiday without a record is skipped; one worked adds to the streak. Today only
 * breaks the streak once it is over — not checking in by 9am is not a miss yet.
 */
export function attendanceStreak(allRowsByDate) {
  let streak = 0;
  const d = new Date();
  for (let i = 0; i < 120; i += 1) {
    const key = todayKey(d);
    const row = allRowsByDate[key];
    if (row && WORKED.includes(row.status)) streak += 1;     // weekend work counts too
    else if (!isWeekday(key) || row?.status === 'holiday') { /* neither breaks nor extends */ }
    else if (i > 0) break;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/** Per-day series for the month charts: every day up to today. */
export function dailySeries(monthKey, rowsByDate = {}) {
  const { days } = monthBounds(monthKey);
  const today = todayKey();
  const out = [];
  for (let d = 1; d <= days; d += 1) {
    const key = `${monthKey}-${String(d).padStart(2, '0')}`;
    if (key > today) break;
    const row = rowsByDate[key];
    const mins = workedMinutes(row);
    const inAt = row?.check_in ? new Date(row.check_in) : null;
    out.push({
      key, day: d, weekend: !isWeekday(key), row,
      hours: mins != null ? +(mins / 60).toFixed(2) : 0,
      checkIn: inAt ? inAt.getHours() * 60 + inAt.getMinutes() : null,
    });
  }
  return out;
}

/** A private-bucket photo path, signed for an <img>. Empty while in flight. */
export function useSignedPhoto(path) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(path ? resolveImageUrl(path, 'employee-photos') : '')
      .then((u) => { if (!cancelled) setUrl(u || ''); })
      .catch(() => { if (!cancelled) setUrl(''); });
    return () => { cancelled = true; };
  }, [path]);
  return url;
}

/** Which of the personal fields are filled — drives the "complete your profile" nudge. */
export const PROFILE_FIELDS = [
  ['photo_path', 'Photo'],
  ['phone', 'Phone'],
  ['address', 'Address'],
  ['date_of_birth', 'Birthday'],
  ['bio', 'About you'],
  ['emergency_contact_name', 'Emergency contact'],
];

export function profileCompleteness(me) {
  const missing = PROFILE_FIELDS.filter(([k]) => !me?.[k]).map(([, label]) => label);
  return { done: PROFILE_FIELDS.length - missing.length, total: PROFILE_FIELDS.length, missing };
}

export function useWindowWidth() {
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  useEffect(() => {
    const fn = () => setW(window.innerWidth);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);
  return w;
}

/** Re-renders every `ms` so a running "time worked today" counter moves. */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** "2y 3m", "5m", "12d" since a start date; null before it or without one. */
export function tenureLabel(startDate, now = new Date()) {
  if (!startDate) return null;
  const start = new Date(`${String(startDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime()) || start > now) return null;
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 1) return `${Math.max(0, Math.floor((now - start) / 86400000))}d`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y && `${y}y`, m && `${m}m`].filter(Boolean).join(' ');
}

/** Whole days until the next birthday (0 = today); null without a date. */
export function daysUntilBirthday(dob, now = new Date()) {
  if (!dob) return null;
  const [, mm, dd] = String(dob).slice(0, 10).split('-').map(Number);
  if (!mm || !dd) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), mm - 1, dd);
  if (next < today) next = new Date(now.getFullYear() + 1, mm - 1, dd);
  return Math.round((next - today) / 86400000);
}
