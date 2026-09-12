import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { TrendingUp, TrendingDown, Wallet, Percent, Download } from 'lucide-react';
import { profitAndLoss, sixMonthSeries, periodBounds, downloadCsv } from '../../services/financeAnalytics';
import { Stat } from './financeUi';
import { useSection, money, fmtDate } from './financeHooks';

const PRESETS = [
  { id: 'month', label: 'This month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'fy', label: 'This FY' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
];

/**
 * Income, expenses and net profit for any period, from the same documents the
 * rest of Finance uses — issued invoices, purchase invoices and expenses —
 * never entered a second time. Figures are before GST on both sides.
 */
export default function ProfitLoss() {
  const docs = useSection('fin_docs');
  const purchases = useSection('purchase_invoices');
  const expenses = useSection('expenses');
  const data = useMemo(() => ({ docs, purchases, expenses }), [docs, purchases, expenses]);

  const [preset, setPreset] = useState('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const range = preset === 'custom'
    ? { from: from || null, to: to || null }
    : periodBounds(preset);

  const pl = useMemo(() => profitAndLoss(data, range.from, range.to), [data, range.from, range.to]);
  const series = useMemo(() => sixMonthSeries(data), [data]);

  const exportCsv = () => {
    const rows = [
      ['Income (invoiced, before GST)', pl.income.toFixed(2)],
      ...pl.byCategory.map((c) => [`Expense: ${c.name}`, (-c.value).toFixed(2)]),
      ['Total expenses', (-pl.expenses).toFixed(2)],
      ['Net profit', pl.net.toFixed(2)],
    ];
    downloadCsv(`profit-loss-${range.from || 'start'}-to-${range.to || 'today'}.csv`, ['Line', 'Amount (INR)'], rows);
  };

  return (
    <div style={{ maxWidth: '100%' }}>
      <div className="prod-toolbar">
        {PRESETS.map((p) => (
          <button key={p.id} className={`pro-chip ${preset === p.id ? 'active' : ''}`} onClick={() => setPreset(p.id)}>{p.label}</button>
        ))}
        {preset === 'custom' && (
          <div className="prod-range">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span>to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
        <button className="prod-add-btn" onClick={exportCsv}><Download size={15} /> Export CSV</button>
      </div>

      <div className="prod-stats">
        <Stat icon={<TrendingUp size={15} />} label="Income" value={money(pl.income)} accent="var(--success)" />
        <Stat icon={<TrendingDown size={15} />} label="Expenses" value={money(pl.expenses)} accent="#ef4444" />
        <Stat icon={<Wallet size={15} />} label={pl.net >= 0 ? 'Net profit' : 'Net loss'} value={money(Math.abs(pl.net))}
          accent={pl.net >= 0 ? 'var(--success)' : '#ef4444'} />
        <Stat icon={<Percent size={15} />} label="Net margin" value={pl.margin == null ? '—' : `${pl.margin.toFixed(1)}%`} />
      </div>

      <p className="prod-perf-note">
        {range.from ? `${fmtDate(range.from)} – ${fmtDate(range.to)}` : 'All time'}. Income is issued invoices at
        taxable value (GST collected is not income). Expenses are expense entries and purchase invoices, net of input GST.
        Drafts, cancelled invoices and voided bills are excluded.
      </p>

      <div className="pro-card" style={{ marginBottom: '1rem' }}>
        <div className="pro-card-header">
          <div className="pro-card-title-group"><h3>Last six months</h3></div>
        </div>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-default)" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} width={70}
                tickFormatter={(v) => (Math.abs(v) >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : `₹${(v / 1000).toFixed(0)}k`)} />
              <Tooltip formatter={(v, name) => [money(v), name]} cursor={{ fill: 'var(--surface-hover)' }} />
              <Legend />
              <Bar dataKey="income" name="Income" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="expenses" name="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={28} opacity={0.75} />
              <Bar dataKey="net" name="Net" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="prod-perf-table-wrap">
        <table className="prod-perf-table">
          <thead><tr><th>Statement</th><th className="num">Amount</th></tr></thead>
          <tbody>
            <tr><td className="prod-perf-name">Income</td><td className="num strong">{money(pl.income, 2)}</td></tr>
            {pl.byCategory.map((c) => (
              <tr key={c.name}><td style={{ paddingLeft: '1.5rem' }}>{c.name}</td><td className="num">−{money(c.value, 2)}</td></tr>
            ))}
            <tr><td className="prod-perf-name">Total expenses</td><td className="num strong">−{money(pl.expenses, 2)}</td></tr>
          </tbody>
          <tfoot>
            <tr>
              <td>{pl.net >= 0 ? 'Net profit' : 'Net loss'}</td>
              <td className="num strong" style={{ color: pl.net >= 0 ? 'var(--success)' : '#ef4444' }}>{money(pl.net, 2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
