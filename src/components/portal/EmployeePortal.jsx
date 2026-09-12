// EmployeePortal.jsx — what an employee sees when they sign in.
//
// Deliberately not the admin shell: no sidebar, no org switcher, four tabs.
// Every read and write here is one an `employee` role is allowed to make on
// their OWN rows (0029 §6 `*_self_*` policies); this component holds no
// authority of its own, so a person who reaches it with a different role sees
// exactly what the database gives them and nothing more.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, CalendarDays, Plane, Megaphone, LogIn, LogOut, Clock,
  Loader2, Check, X, Pin, ChevronLeft, ChevronRight, UserCircle, KeyRound,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useOrg } from '../../context/OrgContext';
import { useToast } from '../shared/Toast';
import { meService } from '../../services/meService';
import { announcementService } from '../../services/announcementService';
import { leaveService, LEAVE_STATUSES, countLeaveDays } from '../../services/leaveService';
import {
  attendanceService, ATTENDANCE_STATUSES, statusLabel, todayKey,
  currentMonthKey, monthBounds, workedMinutes, formatDuration, summariseMonth,
} from '../../services/attendanceService';

const STATUS_COLOR = Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s.key, s.color]));
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const TABS = [
  { id: 'dashboard',     label: 'Dashboard',     icon: LayoutDashboard },
  { id: 'attendance',    label: 'My attendance', icon: CalendarDays },
  { id: 'leave',         label: 'My leave',      icon: Plane },
  { id: 'announcements', label: 'Announcements', icon: Megaphone },
];

const fmtDay = (d) => (d
  ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—');

const clockTime = (iso) => (iso
  ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  : null);

const shiftMonth = (monthKey, delta) => {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function EmployeePortal() {
  const { user, logout } = useAuth();
  const { activeOrg } = useOrg();
  const toast = useToast();
  const orgId = activeOrg?.id;

  const [tab, setTab] = useState('dashboard');
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState(null);
  const [balances, setBalances] = useState([]);
  const [types, setTypes] = useState([]);
  const [requests, setRequests] = useState([]);
  const [notices, setNotices] = useState([]);
  const [readIds, setReadIds] = useState(new Set());
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [monthRows, setMonthRows] = useState({});
  const [clocking, setClocking] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  // ── Load ───────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const employee = await meService.getMyEmployee(orgId);
      setMe(employee);
      if (!employee) return;

      const [t, r, b, day, live, read] = await Promise.all([
        leaveService.listTypes(orgId),
        leaveService.listRequests(orgId, { employeeId: employee.id }),
        leaveService.balances(orgId, employee.id),
        attendanceService.getDay(orgId, employee.id, todayKey()),
        announcementService.list(orgId),
        announcementService.readIds(),
      ]);
      setTypes(t); setRequests(r); setBalances(b);
      setToday(day); setNotices(live); setReadIds(read);
    } catch (err) {
      toast(err.message || 'Could not load your portal.', 'error');
    } finally {
      setLoading(false);
    }
  }, [orgId, toast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (!orgId || !me?.id) return;
    attendanceService.listMonth(orgId, me.id, monthKey).then(setMonthRows).catch(() => setMonthRows({}));
  }, [orgId, me?.id, monthKey]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const clock = async (direction) => {
    setClocking(true);
    try {
      const row = direction === 'in'
        ? await attendanceService.checkIn(orgId, me.id)
        : await attendanceService.checkOut(orgId, me.id);
      setToday(row);
      setMonthRows((prev) => ({ ...prev, [row.work_date]: row }));
      toast(direction === 'in' ? `Checked in at ${clockTime(row.check_in)}` : `Checked out at ${clockTime(row.check_out)}`, 'success');
    } catch (err) {
      toast(err.message || 'Could not record that.', 'error');
    } finally {
      setClocking(false);
    }
  };

  const unread = useMemo(() => notices.filter((a) => !readIds.has(a.id)), [notices, readIds]);

  const markRead = async (id) => {
    if (readIds.has(id)) return;
    try {
      await announcementService.markRead(id);
      setReadIds((prev) => new Set(prev).add(id));
    } catch { /* a failed read receipt is not worth interrupting anyone over */ }
  };

  if (loading) {
    return <div className="me-shell"><div className="prod-empty"><Loader2 className="spin" size={20} /> Loading your portal…</div></div>;
  }

  if (!me) {
    return (
      <div className="me-shell">
        <div className="prod-empty" style={{ maxWidth: '32rem', margin: '4rem auto' }}>
          <UserCircle size={28} />
          <h3>Your employee record isn&rsquo;t linked yet</h3>
          <p>
            Your sign-in works, but no employee record in {activeOrg?.name || 'this organization'} is
            connected to it — so there is no attendance or leave to show. Ask an admin to link
            your record from the Employees page.
          </p>
          <button type="button" className="prod-btn-ghost" onClick={logout}>Sign out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="me-shell">
      <header className="me-head">
        <div>
          <h1>{me.full_name}</h1>
          <p>
            {[me.role, me.department_name].filter(Boolean).join(' · ') || 'Team member'}
            {me.manager && <> · reports to {me.manager.full_name}</>}
          </p>
        </div>
        <div className="me-head-right">
          <span className="prod-perf-meta">{user?.email}</span>
          <button type="button" className="prod-btn-ghost" onClick={() => setPwOpen((v) => !v)}>
            <KeyRound size={14} /> Change password
          </button>
          <button type="button" className="prod-btn-ghost" onClick={logout}><LogOut size={14} /> Sign out</button>
        </div>
      </header>

      <nav className="prod-tabs me-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`pro-chip ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <t.icon size={14} /> {t.label}
            {t.id === 'announcements' && unread.length > 0 && <span className="me-badge">{unread.length}</span>}
          </button>
        ))}
      </nav>

      <main className="me-body">
        {/* Above the tabs' content, not inside one of them: a person still on a
            password their admin generated should meet this first. */}
        {(pwOpen || me.portal_must_change_password) && (
          <ChangePassword
            mustChange={!!me.portal_must_change_password}
            onClose={() => setPwOpen(false)}
            onDone={() => { setPwOpen(false); setMe((m) => ({ ...m, portal_must_change_password: false })); }}
          />
        )}
        {tab === 'dashboard' && (
          <DashboardTab
            me={me} today={today} clocking={clocking} onClock={clock}
            balances={balances} monthRows={monthRows}
            notices={notices.slice(0, 3)} onOpen={markRead} readIds={readIds}
            requests={requests}
          />
        )}
        {tab === 'attendance' && (
          <AttendanceTab monthKey={monthKey} setMonthKey={setMonthKey} rows={monthRows} />
        )}
        {tab === 'leave' && (
          <LeaveTab
            orgId={orgId} me={me} types={types} balances={balances}
            requests={requests} setRequests={setRequests} toast={toast}
            onChanged={loadAll}
          />
        )}
        {tab === 'announcements' && (
          <AnnouncementsTab notices={notices} readIds={readIds} onOpen={markRead} />
        )}
      </main>
    </div>
  );
}

// The password an admin generated is a password an admin saw. This is the one
// place an employee can replace it, and the banner above it is why they will.
function ChangePassword({ mustChange, onClose, onDone }) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (pw !== confirm) { setError('The two passwords do not match.'); return; }
    if (pw.length < 8) { setError('Use at least 8 characters.'); return; }
    setBusy(true);
    setError('');
    try {
      await meService.changeMyPassword(pw);
      setPw(''); setConfirm('');
      toast('Password changed', 'success');
      onDone?.();
    } catch (err) {
      setError(err.message || 'Could not change your password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="me-card me-pw">
      <h2><KeyRound size={15} /> {mustChange ? 'Choose your own password' : 'Change password'}</h2>
      {mustChange && (
        <p className="me-pw-note">
          You are signed in with the password your workplace generated for you, which means
          someone else has seen it. Pick one only you know.
        </p>
      )}
      <form className="me-pw-form" onSubmit={submit}>
        <label>
          <span>New password</span>
          <input
            id="me-pw" type="password" required minLength={8} autoComplete="new-password"
            value={pw} placeholder="At least 8 characters"
            onChange={(e) => setPw(e.target.value)}
          />
        </label>
        <label>
          <span>Confirm it</span>
          <input
            id="me-pw2" type="password" required minLength={8} autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <div className="me-pw-actions">
          <button type="submit" className="prod-btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save password'}
          </button>
          {!mustChange && (
            <button type="button" className="prod-btn-ghost" onClick={onClose}>
              Cancel
            </button>
          )}
        </div>
        {error && <p className="prod-form-error">{error}</p>}
      </form>
    </section>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

function DashboardTab({ today, clocking, onClock, balances, monthRows, notices, onOpen, readIds, requests }) {
  const summary = summariseMonth(monthRows);
  const pending = requests.filter((r) => r.status === 'pending');
  const inAt = clockTime(today?.check_in);
  const outAt = clockTime(today?.check_out);

  return (
    <>
      <section className="me-clock">
        <div>
          <span className="me-clock-label">Today</span>
          <strong>{fmtDay(todayKey())}</strong>
          <p>
            {!inAt && 'You have not checked in yet.'}
            {inAt && !outAt && `Checked in at ${inAt}. Still working.`}
            {inAt && outAt && `${inAt} — ${outAt} · ${formatDuration(workedMinutes(today))}`}
          </p>
        </div>
        {/* The button disappears once the day is closed rather than re-opening
            it: correcting a finished day is a manager's job, not a second tap. */}
        {!inAt ? (
          <button type="button" className="prod-btn-primary me-clock-btn" onClick={() => onClock('in')} disabled={clocking}>
            <LogIn size={16} /> {clocking ? 'Checking in…' : 'Check in'}
          </button>
        ) : !outAt ? (
          <button type="button" className="prod-btn-primary me-clock-btn" onClick={() => onClock('out')} disabled={clocking}>
            <LogOut size={16} /> {clocking ? 'Checking out…' : 'Check out'}
          </button>
        ) : (
          <div className="me-clock-done"><Check size={16} /> Day complete</div>
        )}
      </section>

      <h3 className="me-section-title">Leave balance</h3>
      <div className="me-balances">
        {balances.length ? balances.map((b) => (
          <div key={b.leave_type_id} className="me-balance">
            <span className="me-balance-value">{Number(b.remaining)}</span>
            <span className="me-balance-label">{b.leave_type_name}</span>
            <span className="prod-perf-meta">{Number(b.taken)} of {Number(b.quota) + Number(b.adjusted)} used</span>
          </div>
        )) : <div className="prod-empty">No leave types configured yet.</div>}
      </div>

      <div className="me-two-col">
        <div>
          <h3 className="me-section-title">This month</h3>
          <ul className="me-facts">
            <li><span>Days present</span><strong>{summary.present}</strong></li>
            <li><span>Half days</span><strong>{summary.halfDays}</strong></li>
            <li><span>Leave taken</span><strong>{summary.leave}</strong></li>
            <li><span>Hours logged</span><strong>{formatDuration(summary.workedMinutes)}</strong></li>
          </ul>
          {pending.length > 0 && (
            <p className="prod-perf-meta">
              <Clock size={12} /> {pending.length} leave request{pending.length === 1 ? '' : 's'} awaiting a decision.
            </p>
          )}
        </div>

        <div>
          <h3 className="me-section-title">Latest announcements</h3>
          {notices.length ? (
            <div className="ann-list">
              {notices.map((a) => (
                <article
                  key={a.id}
                  className={`ann-card${readIds.has(a.id) ? '' : ' is-unread'}`}
                  onMouseEnter={() => onOpen(a.id)}
                >
                  <header><h4>{a.is_pinned && <Pin size={12} />} {a.title}</h4></header>
                  <p>{a.body}</p>
                  <footer className="prod-perf-meta">{fmtDay(a.published_at)}</footer>
                </article>
              ))}
            </div>
          ) : <div className="prod-empty">Nothing announced yet.</div>}
        </div>
      </div>
    </>
  );
}

// ── My attendance ────────────────────────────────────────────────────────────

function AttendanceTab({ monthKey, setMonthKey, rows }) {
  const { days } = monthBounds(monthKey);
  const firstDow = (new Date(`${monthKey}-01T00:00:00`).getDay() + 6) % 7;
  const summary = summariseMonth(rows);
  const label = new Date(`${monthKey}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const cells = [];
  for (let i = 0; i < firstDow; i += 1) cells.push(null);
  for (let d = 1; d <= days; d += 1) cells.push(`${monthKey}-${String(d).padStart(2, '0')}`);

  return (
    <>
      <div className="prod-toolbar">
        <div className="att-datenav">
          <button type="button" className="prod-btn-ghost" onClick={() => setMonthKey(shiftMonth(monthKey, -1))}>
            <ChevronLeft size={14} />
          </button>
          <strong style={{ minWidth: '9rem', textAlign: 'center' }}>{label}</strong>
          <button
            type="button" className="prod-btn-ghost"
            onClick={() => setMonthKey(shiftMonth(monthKey, 1))}
            disabled={monthKey >= currentMonthKey()}
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <div style={{ flex: 1 }} />
        <span className="prod-perf-meta">
          {summary.present} present · {summary.leave} leave · {formatDuration(summary.workedMinutes)}
        </span>
      </div>

      <div className="att-cal">
        {WEEKDAYS.map((w) => <div key={w} className="att-cal-head">{w}</div>)}
        {cells.map((dateKey, i) => {
          if (!dateKey) return <div key={`pad-${i}`} className="att-cal-cell att-cal-pad" />;
          const row = rows[dateKey];
          return (
            <div
              key={dateKey}
              className={`att-cal-cell${dateKey === todayKey() ? ' is-today' : ''}`}
              style={row ? { borderLeft: `3px solid ${STATUS_COLOR[row.status]}` } : undefined}
            >
              <span className="att-cal-day">{Number(dateKey.slice(-2))}</span>
              {row && (
                <>
                  <span className="att-cal-status" style={{ color: STATUS_COLOR[row.status] }}>{statusLabel(row.status)}</span>
                  <span className="att-cal-hours">{formatDuration(workedMinutes(row))}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="att-legend">
        {ATTENDANCE_STATUSES.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
      </div>
    </>
  );
}

// ── My leave ─────────────────────────────────────────────────────────────────

function LeaveTab({ orgId, me, types, balances, requests, setRequests, toast, onChanged }) {
  const [form, setForm] = useState({
    leaveTypeId: '', startDate: todayKey(), endDate: todayKey(), halfDay: false, reason: '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!form.leaveTypeId && types.length) setForm((f) => ({ ...f, leaveTypeId: types[0].id }));
  }, [types, form.leaveTypeId]);

  const days = countLeaveDays(form.startDate, form.endDate, { halfDay: form.halfDay });
  const balance = balances.find((b) => b.leave_type_id === form.leaveTypeId);
  const wouldOverdraw = balance && days > Number(balance.remaining);

  const apply = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await leaveService.applyForLeave(orgId, { employeeId: me.id, ...form });
      setRequests((prev) => [created, ...prev]);
      setForm((f) => ({ ...f, reason: '', halfDay: false }));
      toast('Leave requested — your manager has been notified.', 'success');
      onChanged();
    } catch (err) {
      toast(err.message || 'Could not submit your request.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (r) => {
    if (!window.confirm('Withdraw this leave request?')) return;
    try {
      const updated = await leaveService.cancel(r.id);
      setRequests((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      toast('Request withdrawn', 'success');
    } catch (err) {
      toast(err.message || 'Could not withdraw the request.', 'error');
    }
  };

  const typeName = (id) => types.find((t) => t.id === id)?.name || 'Leave';

  return (
    <div className="me-two-col">
      <form className="me-leave-form" onSubmit={apply}>
        <h3 className="me-section-title">Apply for leave</h3>
        <label className="prod-field">
          <span>Type</span>
          <select
            className="prod-select" value={form.leaveTypeId} required
            onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}
          >
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_paid ? '' : ' (unpaid)'}</option>)}
          </select>
        </label>
        <div className="prod-form-grid">
          <label className="prod-field">
            <span>From</span>
            <input
              type="date" className="prod-select" value={form.startDate} required
              onChange={(e) => setForm({
                ...form,
                startDate: e.target.value,
                // Keep the range coherent as the start moves past the end.
                endDate: form.endDate < e.target.value ? e.target.value : form.endDate,
              })}
            />
          </label>
          <label className="prod-field">
            <span>To</span>
            <input
              type="date" className="prod-select" value={form.endDate} min={form.startDate} required
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            />
          </label>
        </div>
        {form.startDate === form.endDate && (
          <label className="prod-field prod-toggle">
            <input
              type="checkbox" checked={form.halfDay}
              onChange={(e) => setForm({ ...form, halfDay: e.target.checked })}
            />
            <span>Half day</span>
          </label>
        )}
        <label className="prod-field">
          <span>Reason</span>
          <textarea
            className="prod-select" rows={3} value={form.reason} maxLength={500}
            placeholder="Optional, but it helps your manager decide"
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
        </label>

        <div className="prod-field-note">
          {days > 0 ? `${days} day${days === 1 ? '' : 's'}` : 'Pick your dates'}
          {balance && <> · {Number(balance.remaining)} {typeName(form.leaveTypeId).toLowerCase()} day(s) left</>}
        </div>
        {/* A warning, not a block: unpaid and carried-over leave are real, and
            the approver is the one who should decide, not this form. */}
        {wouldOverdraw && (
          <div className="prod-form-error">
            This is more than your remaining balance. You can still apply — your manager will see it.
          </div>
        )}

        <button type="submit" className="prod-btn-primary" disabled={busy || !days || !form.leaveTypeId}>
          {busy ? 'Submitting…' : 'Request leave'}
        </button>
      </form>

      <div>
        <h3 className="me-section-title">My requests</h3>
        {requests.length ? (
          <div className="me-requests">
            {requests.map((r) => {
              const s = LEAVE_STATUSES[r.status] || {};
              return (
                <div key={r.id} className="me-request">
                  <div>
                    <strong>{typeName(r.leave_type_id)}</strong>
                    <span className="prod-tag" style={{ color: s.color, borderColor: s.color }}>{s.label || r.status}</span>
                  </div>
                  <div className="prod-perf-meta">
                    {fmtDay(r.start_date)}{r.end_date !== r.start_date && <> &rarr; {fmtDay(r.end_date)}</>}
                    {' '}· {r.days} day{Number(r.days) === 1 ? '' : 's'}
                  </div>
                  {r.reason && <p className="prod-perf-note">{r.reason}</p>}
                  {r.decision_comment && (
                    <p className="prod-perf-note">
                      {r.status === 'approved' ? <Check size={12} /> : <X size={12} />} {r.decision_comment}
                    </p>
                  )}
                  {r.status === 'pending' && (
                    <button type="button" className="prod-btn-ghost" onClick={() => cancel(r)}>Withdraw</button>
                  )}
                </div>
              );
            })}
          </div>
        ) : <div className="prod-empty">You have not requested any leave yet.</div>}
      </div>
    </div>
  );
}

// ── Announcements ────────────────────────────────────────────────────────────

function AnnouncementsTab({ notices, readIds, onOpen }) {
  if (!notices.length) return <div className="prod-empty">Nothing announced yet.</div>;
  return (
    <div className="ann-list">
      {notices.map((a) => (
        <article
          key={a.id}
          className={`ann-card${a.is_pinned ? ' is-pinned' : ''}${readIds.has(a.id) ? '' : ' is-unread'}`}
          onMouseEnter={() => onOpen(a.id)}
        >
          <header><h4>{a.is_pinned && <Pin size={13} />} {a.title}</h4></header>
          <p>{a.body}</p>
          <footer className="prod-perf-meta">{fmtDay(a.published_at)}</footer>
        </article>
      ))}
    </div>
  );
}
