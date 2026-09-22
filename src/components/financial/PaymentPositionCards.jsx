import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, CheckCircle2, Hourglass, AlertTriangle, ChevronRight } from 'lucide-react';
import { paymentPosition } from '../../services/financeAnalytics';
import { useSection, money } from './financeHooks';

/**
 * Where the money stands right now: invoiced, collected, outstanding, overdue.
 * Kept apart from the document/trend summary on purpose — these are balances,
 * not activity — and each card opens the invoice list filtered to match.
 *
 * Styled with the `pro-stat-card` kit rather than a local one so that Finance
 * Status reads as the same dashboard as Billing & Revenue; the cards stay
 * buttons, because the drilldown is the point of them.
 */
export default function PaymentPositionCards() {
  const navigate = useNavigate();
  const docs = useSection('fin_docs');
  const p = useMemo(() => paymentPosition(docs), [docs]);

  const pct = (v) => (p.invoiced > 0 ? `${Math.round((v / p.invoiced) * 100)}% of invoiced` : 'Nothing invoiced yet');

  const cards = [
    { key: 'all', label: 'Total invoiced', value: p.invoiced, icon: FileText, color: '#3b82f6',
      sub: `${p.invoicedCount} invoice${p.invoicedCount === 1 ? '' : 's'} issued` },
    { key: 'collected', label: 'Collected', value: p.collected, icon: CheckCircle2, color: '#10b981',
      sub: pct(p.collected) },
    { key: 'outstanding', label: 'Outstanding', value: p.outstanding, icon: Hourglass, color: '#f59e0b',
      sub: `${p.outstandingCount} awaiting payment` },
    { key: 'overdue', label: 'Overdue', value: p.overdue, icon: AlertTriangle, color: '#ef4444',
      sub: p.overdueCount ? `${p.overdueCount} past due date` : 'Nothing past due' },
  ];

  return (
    <section aria-label="Payment position" className="pro-stats-grid">
      {cards.map(({ key, label, value, icon: Icon, color, sub }) => (
        <button
          key={key}
          type="button"
          onClick={() => navigate(`/invoices?filter=${key}`)}
          className="pro-stat-card"
          style={{ width: '100%', textAlign: 'left', font: 'inherit', fontFamily: 'inherit' }}
          title={`Open ${label.toLowerCase()} invoices`}
        >
          <div className="pro-stat-top">
            <div className="pro-stat-icon" style={{ background: color + '14', color }}>
              <Icon size={20} />
            </div>
            <ChevronRight size={16} className="pro-stat-arrow" aria-hidden="true" />
          </div>
          <div className="pro-stat-value" style={key === 'overdue' && value > 0 ? { color } : undefined}>
            {money(value)}
          </div>
          <div className="pro-stat-label">{label} · {sub}</div>
        </button>
      ))}
    </section>
  );
}
