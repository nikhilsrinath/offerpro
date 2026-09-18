// attendanceService.js — the daily sheet, the monthly calendar, and check-in.
//
// One row per employee per calendar day (0029 attendance_days), so check-in and
// check-out are both upserts against the same (org, employee, date) key rather
// than a stream of punches to reconcile later.
//
// Two writers, distinguished by `source`:
//   'self'   the employee's own portal. RLS lets them touch today only, and
//            only a row nobody has corrected.
//   'admin'  the daily sheet. Once it writes a day, the employee can no longer
//            overwrite the correction.
// Neither trust is enforced here — the policies in 0029 §6 are the boundary.

import { supabase } from '../lib/supabase';
import { downloadCsv } from './financeAnalytics';

export const ATTENDANCE_STATUSES = [
  { key: 'present',  label: 'Present',   color: '#10b981' },
  { key: 'remote',   label: 'Remote',    color: '#3b82f6' },
  { key: 'half_day', label: 'Half day',  color: '#f59e0b' },
  { key: 'leave',    label: 'On leave',  color: '#8b5cf6' },
  { key: 'absent',   label: 'Absent',    color: '#ef4444' },
  { key: 'holiday',  label: 'Holiday',   color: '#94a3b8' },
];

const STATUS_LABEL = Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s.key, s.label]));
export const statusLabel = (key) => STATUS_LABEL[key] || key || '—';

const SELECT = 'id, org_id, employee_id, work_date, check_in, check_out, status, note, source, marked_by, updated_at';

/** Local `YYYY-MM-DD`. `new Date().toISOString()` would roll the date over in
 *  any timezone ahead of UTC, checking people in on tomorrow's sheet. */
export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Inclusive first and last day of the month containing `monthKey` (YYYY-MM). */
export function monthBounds(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${monthKey}-01`, to: `${monthKey}-${String(last).padStart(2, '0')}`, days: last };
}

export function currentMonthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Worked minutes for a row, or null when the day is still open. */
export function workedMinutes(row) {
  if (!row?.check_in || !row?.check_out) return null;
  return Math.max(0, Math.round((new Date(row.check_out) - new Date(row.check_in)) / 60000));
}

export function formatDuration(minutes) {
  if (minutes == null) return '—';
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export const attendanceService = {
  /** Every row for one date, keyed by employee id. */
  async listDay(orgId, date) {
    if (!orgId) return {};
    const { data, error } = await supabase
      .from('attendance_days').select(SELECT)
      .eq('org_id', orgId).eq('work_date', date);
    if (error) throw error;
    return Object.fromEntries((data || []).map((r) => [r.employee_id, r]));
  },

  /** One employee's month, keyed by date. */
  async listMonth(orgId, employeeId, monthKey) {
    if (!orgId || !employeeId) return {};
    const { from, to } = monthBounds(monthKey);
    const { data, error } = await supabase
      .from('attendance_days').select(SELECT)
      .eq('org_id', orgId).eq('employee_id', employeeId)
      .gte('work_date', from).lte('work_date', to)
      .order('work_date');
    if (error) throw error;
    return Object.fromEntries((data || []).map((r) => [r.work_date, r]));
  },

  /** The whole team's month — what the export reads. */
  async listMonthForOrg(orgId, monthKey) {
    if (!orgId) return [];
    const { from, to } = monthBounds(monthKey);
    const { data, error } = await supabase
      .from('attendance_days').select(SELECT)
      .eq('org_id', orgId).gte('work_date', from).lte('work_date', to)
      .order('work_date');
    if (error) throw error;
    return data || [];
  },

  /** One employee's row for one date, or null. */
  async getDay(orgId, employeeId, date) {
    if (!orgId || !employeeId) return null;
    const { data, error } = await supabase
      .from('attendance_days').select(SELECT)
      .eq('org_id', orgId).eq('employee_id', employeeId).eq('work_date', date)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /**
   * Check in for today. Idempotent: an existing check-in is left alone rather
   * than overwritten, so a second tap cannot quietly move someone's start time.
   */
  async checkIn(orgId, employeeId, { status = 'present' } = {}) {
    const date = todayKey();
    const existing = await attendanceService.getDay(orgId, employeeId, date);
    if (existing?.check_in) return existing;

    const { data, error } = await supabase.from('attendance_days').upsert({
      org_id: orgId, employee_id: employeeId, work_date: date,
      check_in: new Date().toISOString(), status, source: 'self',
    }, { onConflict: 'org_id,employee_id,work_date' }).select(SELECT).single();
    if (error) throw error;
    return data;
  },

  /** Check out of today's row. Refuses when there is nothing to close. */
  async checkOut(orgId, employeeId) {
    const date = todayKey();
    const existing = await attendanceService.getDay(orgId, employeeId, date);
    if (!existing?.check_in) throw new Error('You have not checked in today.');
    if (existing.check_out) return existing;

    const { data, error } = await supabase.from('attendance_days')
      .update({ check_out: new Date().toISOString() })
      .eq('id', existing.id).select(SELECT).single();
    if (error) throw error;
    return data;
  },

  /**
   * The manager's correction. Always lands as `source: 'admin'`, which is what
   * stops the employee's own policy overwriting it afterwards.
   */
  async markDay(orgId, employeeId, date, patch) {
    const { data, error } = await supabase.from('attendance_days').upsert({
      org_id: orgId, employee_id: employeeId, work_date: date,
      source: 'admin', ...patch,
    }, { onConflict: 'org_id,employee_id,work_date' }).select(SELECT).single();
    if (error) throw error;
    return data;
  },

  /** Same status for many employees on one date — "mark the office a holiday". */
  async markMany(orgId, employeeIds, date, patch) {
    if (!employeeIds?.length) return [];
    const rows = employeeIds.map((employee_id) => ({
      org_id: orgId, employee_id, work_date: date, source: 'admin', ...patch,
    }));
    const { data, error } = await supabase.from('attendance_days')
      .upsert(rows, { onConflict: 'org_id,employee_id,work_date' }).select(SELECT);
    if (error) throw error;
    return data || [];
  },

  async removeDay(id) {
    const { error } = await supabase.from('attendance_days').delete().eq('id', id);
    if (error) throw error;
  },

  /**
   * A month as a spreadsheet: one row per employee per day that has a record.
   * Uses the shared downloadCsv (financeAnalytics.js) so the BOM and quoting
   * match every other export in the app — Excel opens it without a prompt.
   */
  async exportMonth(orgId, monthKey, employeesById) {
    const rows = await attendanceService.listMonthForOrg(orgId, monthKey);
    const time = (v) => (v ? new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
    downloadCsv(
      `attendance-${monthKey}.csv`,
      ['Date', 'Employee', 'Status', 'Check in', 'Check out', 'Hours', 'Source', 'Note'],
      rows.map((r) => [
        r.work_date,
        employeesById?.[r.employee_id]?.name || employeesById?.[r.employee_id]?.full_name || r.employee_id,
        statusLabel(r.status),
        time(r.check_in),
        time(r.check_out),
        formatDuration(workedMinutes(r)),
        r.source,
        r.note || '',
      ]),
    );
    return rows.length;
  },
};

/** Present/remote/half-day counted as worked, for the portal's month summary. */
export function summariseMonth(rowsByDate) {
  const rows = Object.values(rowsByDate || {});
  const count = (...statuses) => rows.filter((r) => statuses.includes(r.status)).length;
  const minutes = rows.reduce((sum, r) => sum + (workedMinutes(r) || 0), 0);
  return {
    present: count('present', 'remote'),
    halfDays: count('half_day'),
    leave: count('leave'),
    absent: count('absent'),
    recorded: rows.length,
    workedMinutes: minutes,
  };
}
