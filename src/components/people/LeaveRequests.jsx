// LeaveRequests.jsx — the approval queue, the history, and the leave catalogue.
//
// Approve / reject is a plain UPDATE: app.guard_leave_decision (0029 §7) refuses
// a self-approval and stamps who decided, and app.notify_leave_request (0029 §8)
// writes the notification. So this file never has to ask "may I?" — it shows the
// database's answer when the write comes back refused.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plane, Check, X, Clock, Plus, Settings2, Loader2, MessageSquare, Scale,
} from 'lucide-react';
import { useSection, fmtDate } from '../financial/financeHooks';
import { useToast } from '../shared/Toast';
import { Stat, Modal } from '../financial/financeUi';
import { orgStore } from '../../services/orgStore';
import { leaveService, LEAVE_STATUSES } from '../../services/leaveService';

const BLANK_TYPE = { name: '', code: '', annual_quota: 12, is_paid: true, color: '#3b82f6', is_active: true, sort_order: 0 };

function StatusPill({ status }) {
  const s = LEAVE_STATUSES[status] || { label: status, color: '#94a3b8' };
  return <span className="prod-tag" style={{ color: s.color, borderColor: s.color }}>{s.label}</span>;
}

export default function LeaveRequests() {
  const toast = useToast();
  const employees = useSection('employees');
  const orgId = orgStore.getOrgId();

  const [tab, setTab] = useState('pending');
  const [types, setTypes] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(null);   // { request, action }
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingType, setEditingType] = useState(null);
  const [filterEmployee, setFilterEmployee] = useState('');

  const byId = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);
  const typeById = useMemo(() => Object.fromEntries(types.map((t) => [t.id, t])), [types]);
  const nameOf = (id) => byId[id]?.name || byId[id]?.full_name || 'Former employee';

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [t, r] = await Promise.all([
        leaveService.listTypes(orgId, { includeInactive: true }),
        leaveService.listRequests(orgId),
      ]);
      setTypes(t);
      setRequests(r);
    } catch (err) {
      toast(err.message || 'Could not load leave.', 'error');
    } finally {
      setLoading(false);
    }
  }, [orgId, toast]);

  useEffect(() => { load(); }, [load]);

  const pending = useMemo(() => requests.filter((r) => r.status === 'pending'), [requests]);
  const history = useMemo(() => requests
    .filter((r) => r.status !== 'pending')
    .filter((r) => !filterEmployee || r.employee_id === filterEmployee),
  [requests, filterEmployee]);

  const totals = useMemo(() => {
    const year = new Date().getFullYear();
    const thisYear = requests.filter((r) => Number(r.start_date.slice(0, 4)) === year);
    return {
      pending: pending.length,
      approvedDays: thisYear.filter((r) => r.status === 'approved').reduce((s, r) => s + Number(r.days), 0),
      rejected: thisYear.filter((r) => r.status === 'rejected').length,
    };
  }, [requests, pending]);

  const decide = async () => {
    const { request, action } = deciding;
    setBusy(true);
    try {
      const updated = await leaveService.decide(request.id, action, comment);
      setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setDeciding(null);
      setComment('');
      toast(`Leave ${action}`, 'success');
    } catch (err) {
      toast(err.message || 'Could not record the decision.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveType = async (e) => {
    e.preventDefault();
    if (!editingType.name?.trim()) { toast('Give the leave type a name.', 'error'); return; }
    setBusy(true);
    try {
      await leaveService.saveType(orgId, editingType);
      setEditingType(null);
      await load();
      toast('Leave type saved', 'success');
    } catch (err) {
      toast(err.message || 'Could not save the leave type.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const renderRow = (r, withActions) => (
    <tr key={r.id}>
      <td>
        <div className="prod-perf-name">{nameOf(r.employee_id)}</div>
        <div className="prod-perf-meta">{byId[r.employee_id]?.role || '—'}</div>
      </td>
      <td>
        <span className="prod-tag" style={{ color: typeById[r.leave_type_id]?.color || undefined }}>
          {typeById[r.leave_type_id]?.name || 'Leave'}
        </span>
      </td>
      <td>
        {fmtDate(r.start_date)}
        {r.end_date !== r.start_date && <> &rarr; {fmtDate(r.end_date)}</>}
      </td>
      <td>{r.days}{r.half_day && r.days === 0.5 ? ' (half)' : ''}</td>
      <td className="prod-perf-note">{r.reason || '—'}</td>
      {withActions ? (
        <td>
          <button
            type="button" className="prod-btn-primary"
            onClick={() => { setDeciding({ request: r, action: 'approved' }); setComment(''); }}
          >
            <Check size={13} /> Approve
          </button>
          <button
            type="button" className="prod-btn-ghost"
            onClick={() => { setDeciding({ request: r, action: 'rejected' }); setComment(''); }}
          >
            <X size={13} /> Reject
          </button>
        </td>
      ) : (
        <td>
          <StatusPill status={r.status} />
          {r.decision_comment && (
            <div className="prod-perf-note" style={{ marginTop: '0.25rem' }}>
              <MessageSquare size={11} /> {r.decision_comment}
            </div>
          )}
        </td>
      )}
    </tr>
  );

  return (
    <div className="prod-inventory">
      <div className="prod-stats">
        <Stat icon={<Clock size={18} />} label="Awaiting decision" value={totals.pending} accent="#f59e0b" />
        <Stat icon={<Plane size={18} />} label="Days approved this year" value={totals.approvedDays} accent="#10b981" />
        <Stat icon={<X size={18} />} label="Rejected this year" value={totals.rejected} accent="#ef4444" />
        <Stat icon={<Scale size={18} />} label="Leave types" value={types.filter((t) => t.is_active).length} />
      </div>

      <div className="prod-tabs">
        <button type="button" className={`pro-chip ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>
          <Clock size={14} /> Pending{totals.pending ? ` (${totals.pending})` : ''}
        </button>
        <button type="button" className={`pro-chip ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          <Plane size={14} /> History
        </button>
        <button type="button" className={`pro-chip ${tab === 'types' ? 'active' : ''}`} onClick={() => setTab('types')}>
          <Settings2 size={14} /> Leave types
        </button>
      </div>

      {loading ? (
        <div className="prod-empty"><Loader2 className="spin" size={18} /> Loading…</div>
      ) : tab === 'pending' ? (
        pending.length ? (
          <div className="prod-perf-table-wrap">
            <table className="prod-perf-table">
              <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th>Decision</th></tr></thead>
              <tbody>{pending.map((r) => renderRow(r, true))}</tbody>
            </table>
          </div>
        ) : <div className="prod-empty">Nothing waiting on you.</div>
      ) : tab === 'history' ? (
        <>
          <div className="prod-toolbar">
            <select className="prod-select" value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)}>
              <option value="">Everyone</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name || e.full_name}</option>)}
            </select>
          </div>
          {history.length ? (
            <div className="prod-perf-table-wrap">
              <table className="prod-perf-table">
                <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th>Outcome</th></tr></thead>
                <tbody>{history.map((r) => renderRow(r, false))}</tbody>
              </table>
            </div>
          ) : <div className="prod-empty">No decided requests yet.</div>}
        </>
      ) : (
        <>
          <div className="prod-toolbar">
            <div style={{ flex: 1 }} />
            <button type="button" className="prod-btn-primary" onClick={() => setEditingType({ ...BLANK_TYPE })}>
              <Plus size={14} /> New leave type
            </button>
          </div>
          <div className="prod-perf-table-wrap">
            <table className="prod-perf-table">
              <thead><tr><th>Name</th><th>Code</th><th>Annual quota</th><th>Paid</th><th>Status</th><th /></tr></thead>
              <tbody>
                {types.map((t) => (
                  <tr key={t.id} style={t.is_active ? undefined : { opacity: 0.55 }}>
                    <td>
                      <span className="prod-tag" style={{ color: t.color || undefined }}>{t.name}</span>
                    </td>
                    <td>{t.code || '—'}</td>
                    <td>{t.annual_quota} days</td>
                    <td>{t.is_paid ? 'Paid' : 'Unpaid'}</td>
                    <td>{t.is_active ? 'Active' : 'Retired'}</td>
                    <td>
                      <button type="button" className="prod-btn-ghost" onClick={() => setEditingType({ ...t })}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="prod-field-note">
            {/* on delete restrict on leave_requests.leave_type_id — a type that has
                been used cannot be deleted without erasing the leave taken under it. */}
            Retiring a type hides it from new applications and keeps the history intact.
          </div>
        </>
      )}

      {deciding && (
        <Modal
          title={`${deciding.action === 'approved' ? 'Approve' : 'Reject'} leave — ${nameOf(deciding.request.employee_id)}`}
          onClose={() => setDeciding(null)}
          width="440px"
        >
          <div className="prod-modal-body">
            <p>
              {typeById[deciding.request.leave_type_id]?.name || 'Leave'},{' '}
              {fmtDate(deciding.request.start_date)}
              {deciding.request.end_date !== deciding.request.start_date && <> to {fmtDate(deciding.request.end_date)}</>}
              {' '}({deciding.request.days} day{deciding.request.days === 1 ? '' : 's'}).
            </p>
            {deciding.request.reason && <p className="prod-perf-note">&ldquo;{deciding.request.reason}&rdquo;</p>}
            <label className="prod-field">
              <span>Comment {deciding.action === 'rejected' ? '(the applicant will see this)' : '(optional)'}</span>
              <textarea
                className="prod-select" rows={3} value={comment} maxLength={500}
                placeholder={deciding.action === 'rejected' ? 'Why this cannot be approved…' : 'Anything they should know'}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
          </div>
          <div className="prod-modal-foot">
            <button type="button" className="prod-btn-ghost" onClick={() => setDeciding(null)}>Cancel</button>
            <button type="button" className="prod-btn-primary" onClick={decide} disabled={busy}>
              {busy ? 'Saving…' : deciding.action === 'approved' ? 'Approve' : 'Reject'}
            </button>
          </div>
        </Modal>
      )}

      {editingType && (
        <Modal title={editingType.id ? 'Edit leave type' : 'New leave type'} onClose={() => setEditingType(null)} width="460px">
          <form onSubmit={saveType}>
            <div className="prod-modal-body">
              <div className="prod-form-grid">
                <label className="prod-field">
                  <span>Name</span>
                  <input
                    className="prod-select" value={editingType.name} maxLength={60} required
                    onChange={(e) => setEditingType({ ...editingType, name: e.target.value })}
                  />
                </label>
                <label className="prod-field">
                  <span>Code</span>
                  <input
                    className="prod-select" value={editingType.code || ''} maxLength={6}
                    placeholder="CL" pattern="[A-Za-z]{0,6}"
                    onChange={(e) => setEditingType({ ...editingType, code: e.target.value.toUpperCase() })}
                  />
                </label>
                <label className="prod-field">
                  <span>Annual quota (days)</span>
                  <input
                    type="number" className="prod-select" min="0" step="0.5" value={editingType.annual_quota}
                    onChange={(e) => setEditingType({ ...editingType, annual_quota: e.target.value })}
                  />
                </label>
                <label className="prod-field">
                  <span>Colour</span>
                  <input
                    type="color" className="prod-select" value={editingType.color || '#3b82f6'}
                    onChange={(e) => setEditingType({ ...editingType, color: e.target.value })}
                  />
                </label>
                <label className="prod-field prod-toggle">
                  <input
                    type="checkbox" checked={editingType.is_paid !== false}
                    onChange={(e) => setEditingType({ ...editingType, is_paid: e.target.checked })}
                  />
                  <span>Paid leave</span>
                </label>
                <label className="prod-field prod-toggle">
                  <input
                    type="checkbox" checked={editingType.is_active !== false}
                    onChange={(e) => setEditingType({ ...editingType, is_active: e.target.checked })}
                  />
                  <span>Available for new applications</span>
                </label>
              </div>
            </div>
            <div className="prod-modal-foot">
              <button type="button" className="prod-btn-ghost" onClick={() => setEditingType(null)}>Cancel</button>
              <button type="submit" className="prod-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
