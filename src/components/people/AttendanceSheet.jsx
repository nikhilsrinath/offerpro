// AttendanceSheet.jsx — the manager's two views of attendance.
//
//   Daily    the whole team on one date: status, times, a note, bulk marking.
//   Monthly  one employee's calendar for a month.
//
// Both write through attendanceService.markDay(), which always stamps
// `source: 'admin'` — that is what stops the employee's portal overwriting a
// correction afterwards (0029 §6).
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, Download, ChevronLeft, ChevronRight, Users, Clock,
  CheckCircle2, XCircle, Plane, Loader2,
} from 'lucide-react';
import { useSection, fmtDate } from '../financial/financeHooks';
import { useToast } from '../shared/Toast';
import { Stat, Modal } from '../financial/financeUi';
import { orgStore } from '../../services/orgStore';
import {
  attendanceService, ATTENDANCE_STATUSES, statusLabel, todayKey,
  currentMonthKey, monthBounds, workedMinutes, formatDuration, summariseMonth,
} from '../../services/attendanceService';

const STATUS_COLOR = Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s.key, s.color]));
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** `HH:mm` in the browser's timezone, for a time input. */
const toTimeInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** `HH:mm` on `dateKey`, back to an ISO instant. Empty clears the field. */
const fromTimeInput = (value, dateKey) => {
  if (!value) return null;
  const [h, m] = value.split(':').map(Number);
  const d = new Date(`${dateKey}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const shiftMonth = (monthKey, delta) => {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const shiftDate = (dateKey, delta) => {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return todayKey(d);
};

const monthLabel = (monthKey) => new Date(`${monthKey}-01T00:00:00`)
  .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

export default function AttendanceSheet() {
  const toast = useToast();
  const employees = useSection('employees');
  const departments = useSection('departments');
  const orgId = orgStore.getOrgId();

  const [tab, setTab] = useState('daily');
  const [date, setDate] = useState(todayKey());
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [personId, setPersonId] = useState('');
  const [dept, setDept] = useState('');
  const [dayRows, setDayRows] = useState({});
  const [monthRows, setMonthRows] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [editing, setEditing] = useState(null);
  const [exporting, setExporting] = useState(false);

  const roster = useMemo(() => employees
    .filter((e) => !dept || e.department_id === dept)
    .sort((a, b) => String(a.name || a.full_name || '').localeCompare(String(b.name || b.full_name || ''))),
  [employees, dept]);

  const employeesById = useMemo(
    () => Object.fromEntries(employees.map((e) => [e.id, e])), [employees],
  );

  // Default the monthly view to whoever is first on the roster, once loaded.
  useEffect(() => {
    if (!personId && roster.length) setPersonId(roster[0].id);
  }, [roster, personId]);

  const loadDay = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      setDayRows(await attendanceService.listDay(orgId, date));
    } catch (err) {
      toast(err.message || 'Could not load the day.', 'error');
    } finally {
      setLoading(false);
    }
  }, [orgId, date, toast]);

  const loadMonth = useCallback(async () => {
    if (!orgId || !personId) { setMonthRows({}); return; }
    setLoading(true);
    try {
      setMonthRows(await attendanceService.listMonth(orgId, personId, monthKey));
    } catch (err) {
      toast(err.message || 'Could not load the month.', 'error');
    } finally {
      setLoading(false);
    }
  }, [orgId, personId, monthKey, toast]);

  useEffect(() => { if (tab === 'daily') loadDay(); }, [tab, loadDay]);
  useEffect(() => { if (tab === 'monthly') loadMonth(); }, [tab, loadMonth]);

  const setStatus = async (employeeId, status) => {
    setBusyId(employeeId);
    try {
      const row = await attendanceService.markDay(orgId, employeeId, date, { status });
      setDayRows((prev) => ({ ...prev, [employeeId]: row }));
    } catch (err) {
      toast(err.message || 'Could not save.', 'error');
    } finally {
      setBusyId('');
    }
  };

  const markEveryone = async (status) => {
    const ids = roster.map((e) => e.id);
    if (!ids.length) return;
    if (!window.confirm(`Mark all ${ids.length} people as ${statusLabel(status).toLowerCase()} on ${fmtDate(date)}?`)) return;
    try {
      await attendanceService.markMany(orgId, ids, date, { status });
      await loadDay();
      toast(`${ids.length} marked ${statusLabel(status).toLowerCase()}`, 'success');
    } catch (err) {
      toast(err.message || 'Could not mark the team.', 'error');
    }
  };

  const saveTimes = async (e) => {
    e.preventDefault();
    const { employeeId, dateKey, checkIn, checkOut, status, note } = editing;
    if (checkIn && checkOut && checkOut < checkIn) {
      toast('Check-out cannot be before check-in.', 'error');
      return;
    }
    try {
      const row = await attendanceService.markDay(orgId, employeeId, dateKey, {
        check_in: fromTimeInput(checkIn, dateKey),
        check_out: fromTimeInput(checkOut, dateKey),
        status,
        note: note?.trim() || null,
      });
      if (dateKey === date) setDayRows((prev) => ({ ...prev, [employeeId]: row }));
      if (employeeId === personId) setMonthRows((prev) => ({ ...prev, [dateKey]: row }));
      setEditing(null);
      toast('Attendance updated', 'success');
    } catch (err) {
      toast(err.message || 'Could not save.', 'error');
    }
  };

  const openEditor = (employeeId, dateKey, row) => setEditing({
    employeeId, dateKey,
    name: employeesById[employeeId]?.name || employeesById[employeeId]?.full_name || 'Employee',
    checkIn: toTimeInput(row?.check_in),
    checkOut: toTimeInput(row?.check_out),
    status: row?.status || 'present',
    note: row?.note || '',
  });

  const exportMonth = async () => {
    setExporting(true);
    try {
      const n = await attendanceService.exportMonth(orgId, monthKey, employeesById);
      toast(n ? `Exported ${n} rows` : 'Nothing recorded in that month', n ? 'success' : 'info');
    } catch (err) {
      toast(err.message || 'Could not export.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const dayTotals = useMemo(() => {
    const rows = roster.map((e) => dayRows[e.id]).filter(Boolean);
    const n = (...s) => rows.filter((r) => s.includes(r.status)).length;
    return {
      present: n('present', 'remote'),
      absent: n('absent'),
      leave: n('leave', 'half_day'),
      unmarked: roster.length - rows.length,
    };
  }, [roster, dayRows]);

  return (
    <div className="prod-inventory">
      <div className="prod-tabs">
        <button type="button" className={`pro-chip ${tab === 'daily' ? 'active' : ''}`} onClick={() => setTab('daily')}>
          <Users size={14} /> Daily sheet
        </button>
        <button type="button" className={`pro-chip ${tab === 'monthly' ? 'active' : ''}`} onClick={() => setTab('monthly')}>
          <CalendarDays size={14} /> Monthly calendar
        </button>
      </div>

      {tab === 'daily' ? (
        <>
          <div className="prod-stats">
            <Stat icon={<CheckCircle2 size={18} />} label="Present" value={dayTotals.present} accent="#10b981" />
            <Stat icon={<Plane size={18} />} label="On leave" value={dayTotals.leave} accent="#8b5cf6" />
            <Stat icon={<XCircle size={18} />} label="Absent" value={dayTotals.absent} accent="#ef4444" />
            <Stat icon={<Clock size={18} />} label="Not marked" value={dayTotals.unmarked} />
          </div>

          <div className="prod-toolbar">
            <div className="att-datenav">
              <button type="button" className="prod-btn-ghost" onClick={() => setDate(shiftDate(date, -1))}>
                <ChevronLeft size={14} />
              </button>
              <input type="date" className="prod-select" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} />
              <button
                type="button" className="prod-btn-ghost"
                onClick={() => setDate(shiftDate(date, 1))}
                disabled={date >= todayKey()}
              >
                <ChevronRight size={14} />
              </button>
              {date !== todayKey() && (
                <button type="button" className="prod-btn-ghost" onClick={() => setDate(todayKey())}>Today</button>
              )}
            </div>
            <select className="prod-select" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <div style={{ flex: 1 }} />
            <button type="button" className="prod-btn-ghost" onClick={() => markEveryone('present')}>Mark all present</button>
            <button type="button" className="prod-btn-ghost" onClick={() => markEveryone('holiday')}>Mark holiday</button>
          </div>

          {loading ? (
            <div className="prod-empty"><Loader2 className="spin" size={18} /> Loading…</div>
          ) : !roster.length ? (
            <div className="prod-empty">No employees{dept ? ' in this department' : ''} yet.</div>
          ) : (
            <div className="prod-perf-table-wrap">
              <table className="prod-perf-table att-sheet">
                <thead>
                  <tr>
                    <th>Employee</th><th>Status</th><th>In</th><th>Out</th><th>Hours</th><th>Note</th><th />
                  </tr>
                </thead>
                <tbody>
                  {roster.map((e) => {
                    const row = dayRows[e.id];
                    const name = e.name || e.full_name || 'Unnamed';
                    return (
                      <tr key={e.id}>
                        <td>
                          <div className="prod-perf-name">{name}</div>
                          <div className="prod-perf-meta">{e.role || '—'}</div>
                        </td>
                        <td>
                          <select
                            className="prod-select att-status"
                            value={row?.status || ''}
                            disabled={busyId === e.id}
                            onChange={(ev) => setStatus(e.id, ev.target.value)}
                            style={row ? { color: STATUS_COLOR[row.status] } : undefined}
                          >
                            <option value="" disabled>Not marked</option>
                            {ATTENDANCE_STATUSES.map((s) => (
                              <option key={s.key} value={s.key}>{s.label}</option>
                            ))}
                          </select>
                        </td>
                        <td>{toTimeInput(row?.check_in) || '—'}</td>
                        <td>{toTimeInput(row?.check_out) || '—'}</td>
                        <td>{formatDuration(workedMinutes(row))}</td>
                        <td className="prod-perf-note">{row?.note || '—'}</td>
                        <td>
                          <button type="button" className="prod-btn-ghost" onClick={() => openEditor(e.id, date, row)}>
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <MonthlyView
          monthKey={monthKey}
          setMonthKey={setMonthKey}
          roster={roster}
          personId={personId}
          setPersonId={setPersonId}
          rows={monthRows}
          loading={loading}
          onExport={exportMonth}
          exporting={exporting}
          onPick={(dateKey, row) => personId && openEditor(personId, dateKey, row)}
        />
      )}

      {editing && (
        <Modal title={`${editing.name} — ${fmtDate(editing.dateKey)}`} onClose={() => setEditing(null)} width="420px">
          <form onSubmit={saveTimes}>
            <div className="prod-modal-body">
              <div className="prod-form-grid">
                <label className="prod-field">
                  <span>Status</span>
                  <select
                    className="prod-select" value={editing.status}
                    onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                  >
                    {ATTENDANCE_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </label>
                <label className="prod-field">
                  <span>Check in</span>
                  <input
                    type="time" className="prod-select" value={editing.checkIn}
                    onChange={(e) => setEditing({ ...editing, checkIn: e.target.value })}
                  />
                </label>
                <label className="prod-field">
                  <span>Check out</span>
                  <input
                    type="time" className="prod-select" value={editing.checkOut}
                    onChange={(e) => setEditing({ ...editing, checkOut: e.target.value })}
                  />
                </label>
                <label className="prod-field" style={{ gridColumn: '1 / -1' }}>
                  <span>Note</span>
                  <input
                    className="prod-select" value={editing.note} maxLength={200}
                    placeholder="Late — client visit"
                    onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                  />
                </label>
              </div>
              <div className="prod-field-note">
                Saving here marks the day as a manager correction, which the employee&rsquo;s
                own check-in can no longer overwrite.
              </div>
            </div>
            <div className="prod-modal-foot">
              <button type="button" className="prod-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="prod-btn-primary">Save</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/** One employee's month as a calendar grid, Monday-first. */
function MonthlyView({ monthKey, setMonthKey, roster, personId, setPersonId, rows, loading, onExport, exporting, onPick }) {
  const { days } = monthBounds(monthKey);
  // getDay() is Sunday-0; the grid starts on Monday, so rotate it.
  const firstDow = (new Date(`${monthKey}-01T00:00:00`).getDay() + 6) % 7;
  const summary = summariseMonth(rows);

  const cells = [];
  for (let i = 0; i < firstDow; i += 1) cells.push(null);
  for (let d = 1; d <= days; d += 1) cells.push(`${monthKey}-${String(d).padStart(2, '0')}`);

  return (
    <>
      <div className="prod-stats">
        <Stat icon={<CheckCircle2 size={18} />} label="Days present" value={summary.present} accent="#10b981" />
        <Stat icon={<Plane size={18} />} label="Leave days" value={summary.leave} accent="#8b5cf6" />
        <Stat icon={<XCircle size={18} />} label="Absent" value={summary.absent} accent="#ef4444" />
        <Stat icon={<Clock size={18} />} label="Hours logged" value={formatDuration(summary.workedMinutes)} />
      </div>

      <div className="prod-toolbar">
        <div className="att-datenav">
          <button type="button" className="prod-btn-ghost" onClick={() => setMonthKey(shiftMonth(monthKey, -1))}>
            <ChevronLeft size={14} />
          </button>
          <strong style={{ minWidth: '9rem', textAlign: 'center' }}>{monthLabel(monthKey)}</strong>
          <button
            type="button" className="prod-btn-ghost"
            onClick={() => setMonthKey(shiftMonth(monthKey, 1))}
            disabled={monthKey >= currentMonthKey()}
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <select className="prod-select" value={personId} onChange={(e) => setPersonId(e.target.value)}>
          {roster.map((e) => (
            <option key={e.id} value={e.id}>{e.name || e.full_name}</option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        {/* Exports the whole team, not just the person on screen — a month of
            attendance for payroll is never one row of people. */}
        <button type="button" className="prod-btn-primary" onClick={onExport} disabled={exporting}>
          <Download size={14} /> {exporting ? 'Exporting…' : 'Export month (all staff)'}
        </button>
      </div>

      {loading ? (
        <div className="prod-empty"><Loader2 className="spin" size={18} /> Loading…</div>
      ) : !personId ? (
        <div className="prod-empty">Add an employee to see a calendar.</div>
      ) : (
        <>
          <div className="att-cal">
            {WEEKDAYS.map((w) => <div key={w} className="att-cal-head">{w}</div>)}
            {cells.map((dateKey, i) => {
              if (!dateKey) return <div key={`pad-${i}`} className="att-cal-cell att-cal-pad" />;
              const row = rows[dateKey];
              const dayNum = Number(dateKey.slice(-2));
              const isToday = dateKey === todayKey();
              return (
                <button
                  type="button"
                  key={dateKey}
                  className={`att-cal-cell${isToday ? ' is-today' : ''}`}
                  style={row ? { borderLeft: `3px solid ${STATUS_COLOR[row.status]}` } : undefined}
                  onClick={() => onPick(dateKey, row)}
                  title={row ? `${statusLabel(row.status)}${row.note ? ` — ${row.note}` : ''}` : 'Not marked'}
                >
                  <span className="att-cal-day">{dayNum}</span>
                  {row && (
                    <>
                      <span className="att-cal-status" style={{ color: STATUS_COLOR[row.status] }}>
                        {statusLabel(row.status)}
                      </span>
                      <span className="att-cal-hours">{formatDuration(workedMinutes(row))}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <div className="att-legend">
            {ATTENDANCE_STATUSES.map((s) => (
              <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
            ))}
          </div>
        </>
      )}
    </>
  );
}
