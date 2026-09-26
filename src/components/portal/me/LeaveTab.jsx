// LeaveTab — what you have left, asking for more, and what happened to what
// you asked for. The balance sits above the form because it is the number
// people check before deciding which dates to pick.
import { useEffect, useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Panel, Btn, Seg, Field, Input, Select, Textarea, Bar, Empty, ConfirmBtn } from '../../ui/edge';
import { useT } from '../../ui/edgeUtils';
import { leaveService, LEAVE_STATUSES, countLeaveDays } from '../../../services/leaveService';
import { todayKey } from '../../../services/attendanceService';
import { fmtLongDay } from './portalUtils';

export default function LeaveTab({ orgId, me, types, balances, requests, setRequests, toast, onChanged, narrow }) {
  const t = useT();
  const [form, setForm] = useState({
    leaveTypeId: '', startDate: todayKey(), endDate: todayKey(), halfDay: false, reason: '',
  });
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!form.leaveTypeId && types.length) setForm((f) => ({ ...f, leaveTypeId: types[0].id }));
  }, [types, form.leaveTypeId]);

  const days = countLeaveDays(form.startDate, form.endDate, { halfDay: form.halfDay });
  const balance = balances.find((b) => b.leave_type_id === form.leaveTypeId);
  const wouldOverdraw = balance && days > Number(balance.remaining);
  const typeName = (id) => types.find((x) => x.id === id)?.name || 'Leave';

  const counts = useMemo(() => {
    const c = { all: requests.length };
    for (const r of requests) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [requests]);
  const shown = filter === 'all' ? requests : requests.filter((r) => r.status === filter);

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
    try {
      const updated = await leaveService.cancel(r.id);
      setRequests((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      toast('Request withdrawn', 'success');
      onChanged();
    } catch (err) {
      toast(err.message || 'Could not withdraw the request.', 'error');
    }
  };

  const filters = (
    <Seg size="sm" value={filter} onChange={setFilter} options={[
      { id: 'all', label: 'All', count: counts.all },
      { id: 'pending', label: 'Pending', count: counts.pending || 0 },
      { id: 'approved', label: 'Approved', count: counts.approved || 0 },
      { id: 'rejected', label: 'Rejected', count: counts.rejected || 0 },
    ]} />
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {balances.length ? balances.map((b) => {
          const total = Number(b.quota) + Number(b.adjusted);
          const active = b.leave_type_id === form.leaveTypeId;
          return (
            <button
              key={b.leave_type_id} type="button" className="edge-btn"
              onClick={() => setForm((f) => ({ ...f, leaveTypeId: b.leave_type_id }))}
              title={`Apply for ${b.leave_type_name} leave`}
              style={{
                textAlign: 'left', cursor: 'pointer', padding: '13px 14px', borderRadius: 10,
                border: '1px solid ' + (active ? t.text : t.line), background: t.panel,
                fontFamily: 'inherit', color: t.text, display: 'grid', gap: 6,
              }}
            >
              <span style={{ fontSize: 9, letterSpacing: '0.1em', color: t.faint }}>{String(b.leave_type_name).toUpperCase()}</span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.03em' }}>{Number(b.remaining)}</span>
                <span style={{ fontSize: 10, color: t.faint }}>of {total} left</span>
              </span>
              <Bar value={Number(b.taken)} max={total || 1} />
              <span style={{ fontSize: 9.5, color: t.faint }}>{Number(b.taken)} used this year</span>
            </button>
          );
        }) : <Empty>No leave types configured yet.</Empty>}
      </div>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: narrow ? '1fr' : 'minmax(280px, 0.9fr) minmax(0, 1.3fr)', alignItems: 'start' }}>
        <Panel title="Request leave">
          <form onSubmit={apply} style={{ padding: 14, display: 'grid', gap: 12 }}>
            <Field label="Type">
              <Select value={form.leaveTypeId} required onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}>
                {types.map((x) => <option key={x.id} value={x.id}>{x.name}{x.is_paid ? '' : ' (unpaid)'}</option>)}
              </Select>
            </Field>
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
              <Field label="From">
                <Input
                  type="date" value={form.startDate} required
                  onChange={(e) => setForm({
                    ...form,
                    startDate: e.target.value,
                    // Keep the range coherent as the start moves past the end.
                    endDate: form.endDate < e.target.value ? e.target.value : form.endDate,
                  })}
                />
              </Field>
              <Field label="To">
                <Input type="date" value={form.endDate} min={form.startDate} required onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </Field>
            </div>
            {form.startDate === form.endDate && (
              <Seg
                size="sm" value={form.halfDay ? 'half' : 'full'}
                onChange={(v) => setForm({ ...form, halfDay: v === 'half' })}
                options={[{ id: 'full', label: 'Full day' }, { id: 'half', label: 'Half day' }]}
              />
            )}
            <Field label="Reason" hint="Optional, but it helps your manager decide">
              <Textarea rows={3} value={form.reason} maxLength={500} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </Field>

            <div style={{
              display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 11px', borderRadius: 8,
              background: t.panelAlt, border: '1px solid ' + t.lineSoft, fontSize: 11,
            }}>
              <span style={{ color: t.dim }}>Requesting</span>
              <span style={{ color: t.text }}>
                {days > 0 ? `${days} day${days === 1 ? '' : 's'}` : 'Pick your dates'}
                {balance && <span style={{ color: t.faint }}> · {Number(balance.remaining)} left</span>}
              </span>
            </div>
            {/* A warning, not a block: unpaid and carried-over leave are real,
                and the approver is the one who should decide. */}
            {wouldOverdraw && (
              <div style={{ fontSize: 10.5, color: t.down, lineHeight: 1.5 }}>
                This is more than your remaining balance. You can still apply — your manager will see it.
              </div>
            )}
            <Btn type="submit" primary full disabled={busy || !days || !form.leaveTypeId}>
              {busy ? 'Submitting…' : 'Submit request'}
            </Btn>
          </form>
        </Panel>

        <Panel
          title="My requests"
          actions={!narrow && filters}
        >
          {narrow && <div style={{ padding: '10px 14px 0', overflowX: 'auto' }}>{filters}</div>}
          {shown.length ? shown.map((r, i) => {
            const s = LEAVE_STATUSES[r.status] || {};
            return (
              <div key={r.id} style={{
                display: 'flex', gap: 12, padding: '12px 14px', alignItems: 'flex-start',
                borderTop: i ? '1px solid ' + t.lineSoft : 'none',
              }}>
                <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 3, background: s.color || t.ghost, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: t.text }}>{typeName(r.leave_type_id)}</span>
                    <span style={{ fontSize: 10, color: t.dim }}>{s.label || r.status}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: t.faint, marginTop: 3 }}>
                    {fmtLongDay(r.start_date)}{r.end_date !== r.start_date && <> → {fmtLongDay(r.end_date)}</>}
                    {' '}· {Number(r.days)} day{Number(r.days) === 1 ? '' : 's'}
                  </div>
                  {r.reason && <div style={{ fontSize: 11, color: t.dim, marginTop: 6, lineHeight: 1.5 }}>{r.reason}</div>}
                  {r.decision_comment && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10.5, color: t.dim, marginTop: 6 }}>
                      {r.status === 'approved' ? <Check size={12} /> : <X size={12} />} {r.decision_comment}
                    </div>
                  )}
                </div>
                {r.status === 'pending' && <ConfirmBtn label="Withdraw" title="Withdraw leave request" message="Withdraw this request? Your manager will no longer see it." onConfirm={() => cancel(r)} />}
              </div>
            );
          }) : <Empty>{filter === 'all' ? 'You have not requested any leave yet.' : `No ${filter} requests.`}</Empty>}
        </Panel>
      </div>
    </div>
  );
}
