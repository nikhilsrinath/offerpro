import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, CheckCircle2, Hourglass, AlertTriangle, ChevronRight } from 'lucide-react';
import { paymentPosition } from '../../services/financeAnalytics';
import { useSection, money } from './financeHooks';

/**
 * Where the money stands right now: invoiced, collected, outstanding, overdue.
 * Kept apart from the document/trend summary on purpose — these are balances,
 * not activity — and each card opens the invoice list filtered to match.
 */
export default function PaymentPositionCards() {
  const navigate = useNavigate();
  const docs = useSection('fin_docs');
  const p = useMemo(() => paymentPosition(docs), [docs]);

  const cards = [
    { key: 'all', label: 'Total invoiced', value: p.invoiced, count: p.invoicedCount, icon: FileText, color: 'var(--blue, #3b82f6)' },
    { key: 'collected', label: 'Collected', value: p.collected, count: p.collectedCount, icon: CheckCircle2, color: 'var(--success, #10b981)' },
    { key: 'outstanding', label: 'Outstanding', value: p.outstanding, count: p.outstandingCount, icon: Hourglass, color: 'var(--gold, #f59e0b)' },
    { key: 'overdue', label: 'Overdue', value: p.overdue, count: p.overdueCount, icon: AlertTriangle, color: '#ef4444' },
  ];

  return (
    <section aria-label="Payment position" style={{ marginBottom: '1.25rem' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
        Payment position
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.75rem' }}>
        {cards.map(({ key, label, value, count, icon: Icon, color }) => (
          <button
            key={key}
            type="button"
            onClick={() => navigate(`/invoices?filter=${key}`)}
            className="prod-stat"
            style={{ cursor: 'pointer', textAlign: 'left', border: '1px solid var(--border-default)', width: '100%' }}
            title={`Open ${label.toLowerCase()} invoices`}
          >
            <div className="prod-stat-icon" style={{ color }}><Icon size={15} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="prod-stat-value" style={key === 'overdue' && value > 0 ? { color } : undefined}>{money(value)}</div>
              <div className="prod-stat-label">{label} · {count} invoice{count === 1 ? '' : 's'}</div>
            </div>
            <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
          </button>
        ))}
      </div>
    </section>
  );
}
