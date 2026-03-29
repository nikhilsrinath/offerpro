const STATUS_CONFIG = {
  draft: { label: 'Draft', color: '#71717a', bg: 'rgba(113,113,122,0.12)' },
  sent: { label: 'Sent', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  viewed: { label: 'Viewed', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
  pending: { label: 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  signed: { label: 'Signed', color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  accepted: { label: 'Accepted', color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  declined: { label: 'Declined', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  paid: { label: 'Paid', color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  overdue: { label: 'Overdue', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', pulse: true },
  payment_submitted: { label: 'Payment Submitted', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', pulse: true },
  partially_paid: { label: 'Partially Paid', color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  revision_requested: { label: 'Revision Requested', color: '#6366f1', bg: 'rgba(99,102,241,0.12)' },
  converted: { label: 'Converted', color: '#06b6d4', bg: 'rgba(6,182,212,0.12)' },
  party_a_signed: { label: 'Party A Signed', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  fully_signed: { label: 'Fully Signed', color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  active: { label: 'Active', color: '#10b981', bg: 'rgba(16,185,129,0.12)', pulse: true },
  paused: { label: 'Paused', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  cancelled: { label: 'Cancelled', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  completed: { label: 'Completed', color: '#71717a', bg: 'rgba(113,113,122,0.12)' },
  advance_paid: { label: 'Advance Paid', color: '#06b6d4', bg: 'rgba(6,182,212,0.12)' },
  expired: { label: 'Expired', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  order_confirmed: { label: 'Order Confirmed', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
};

export default function DocumentStatusBadge({ status, size = 'default' }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.draft;

  return (
    <span
      className={`doc-status-badge ${size} ${config.pulse ? 'pulse' : ''}`}
      style={{ color: config.color, background: config.bg }}
      title={`Status: ${config.label}`}
    >
      {config.pulse && <span className="doc-status-pulse-dot" style={{ background: config.color }} />}
      {config.label}
    </span>
  );
}
