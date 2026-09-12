import { useMemo, useState } from 'react';
import { Download, Info, ArrowUpRight, ArrowDownLeft, Scale } from 'lucide-react';
import { taxSummary, periodOptions, downloadCsv } from '../../services/financeAnalytics';
import { Stat } from './financeUi';
import { useSection, money, fmtDate } from './financeHooks';

/**
 * Output GST collected against input GST paid, by month or FY quarter.
 * Deliberately labelled as a preparation aid: it is computed from what is in
 * EdgeOS and does not handle reverse charge, blocked credits, credit notes or
 * amendments, so it must never be mistaken for a return.
 */
export default function TaxSummary() {
  const docs = useSection('fin_docs');
  const purchases = useSection('purchase_invoices');
  const expenses = useSection('expenses');
  const vendors = useSection('vendors');

  const [kind, setKind] = useState('month');
  const options = useMemo(() => periodOptions(kind, kind === 'month' ? 12 : 8), [kind]);
  const [periodId, setPeriodId] = useState(null);
  const period = options.find((o) => o.id === periodId) || options[0];

  const summary = useMemo(
    () => taxSummary({ docs, purchases, expenses, vendors }, period.from, period.to),
    [docs, purchases, expenses, vendors, period.from, period.to],
  );
  const net = summary.netPayable;

  const exportCsv = () => {
    const rows = summary.rows.map((r) => [r.date, r.kind, r.ref, r.party, r.taxable.toFixed(2), r.gst.toFixed(2)]);
    rows.push([]);
    rows.push(['', 'Output GST', '', '', summary.output.taxable.toFixed(2), summary.output.gst.toFixed(2)]);
    rows.push(['', 'Input GST', '', '', summary.input.taxable.toFixed(2), summary.input.gst.toFixed(2)]);
    rows.push(['', net >= 0 ? 'Net payable' : 'Net credit', '', '', '', Math.abs(net).toFixed(2)]);
    rows.push([]);
    rows.push(['Preparation aid only. Not a GST return. Verify with your accountant before filing.']);
    downloadCsv(`tax-summary-${period.from}-to-${period.to}.csv`,
      ['Date', 'Type', 'Reference', 'Party', 'Taxable value', 'GST'], rows);
  };

  return (
    <div style={{ maxWidth: '100%' }}>
      <div
        role="note"
        style={{
          display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.75rem 1rem', marginBottom: '1rem',
          borderRadius: '0.6rem', border: '1px solid var(--border-default)', background: 'var(--surface-hover)',
          fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5,
        }}
      >
        <Info size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          <strong>A preparation aid, not a filing tool.</strong> These figures come from invoices, bills and
          expenses recorded in EdgeOS. They do not account for reverse charge, ineligible input credit,
          credit/debit notes or amendments. Reconcile with GSTR-2B and your accountant before filing.
        </span>
      </div>

      <div className="prod-toolbar">
        <button className={`pro-chip ${kind === 'month' ? 'active' : ''}`} onClick={() => { setKind('month'); setPeriodId(null); }}>Monthly</button>
        <button className={`pro-chip ${kind === 'quarter' ? 'active' : ''}`} onClick={() => { setKind('quarter'); setPeriodId(null); }}>Quarterly</button>
        <select className="prod-select" value={period.id} onChange={(e) => setPeriodId(e.target.value)}>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <button className="prod-add-btn" onClick={exportCsv}>
          <Download size={15} /> Export CSV
        </button>
      </div>

      <div className="prod-stats">
        <Stat icon={<ArrowUpRight size={15} />} label={`Output GST · ${summary.output.count} invoices`} value={money(summary.output.gst, 2)}
          sub={summary.output.igst > 0 ? `IGST ${money(summary.output.igst)} · CGST ${money(summary.output.cgst)} · SGST ${money(summary.output.sgst)}`
            : `CGST ${money(summary.output.cgst)} · SGST ${money(summary.output.sgst)}`} />
        <Stat icon={<ArrowDownLeft size={15} />} label={`Input GST · ${summary.input.count} bills & expenses`} value={money(summary.input.gst, 2)}
          sub={`Bills ${money(summary.input.purchases)} · Expenses ${money(summary.input.expenses)}`} accent="var(--success)" />
        <Stat icon={<Scale size={15} />} label={net >= 0 ? 'Net liability (estimated)' : 'Net credit carried forward'}
          value={money(Math.abs(net), 2)} accent={net > 0 ? '#ef4444' : 'var(--success)'} />
      </div>

      <p className="prod-perf-note">
        {period.label}: {fmtDate(period.from)} – {fmtDate(period.to)}. Output GST is taken from issued invoices
        by issue date; drafts and cancelled invoices are excluded. Input GST is from purchase invoices and from
        the GST amount entered on expenses.
      </p>

      {summary.rows.length === 0 ? (
        <div className="prod-empty">
          <Scale size={40} strokeWidth={1} />
          <p>No taxable activity in this period</p>
        </div>
      ) : (
        <div className="prod-perf-table-wrap">
          <table className="prod-perf-table">
            <thead>
              <tr><th>Date</th><th>Type</th><th>Reference</th><th>Party</th><th className="num">Taxable value</th><th className="num">GST</th></tr>
            </thead>
            <tbody>
              {summary.rows.map((r, i) => (
                <tr key={`${r.ref}-${i}`}>
                  <td className="prod-perf-date">{fmtDate(r.date)}</td>
                  <td style={{ color: r.kind === 'Output' ? '#ef4444' : 'var(--success)', fontWeight: 600, fontSize: '0.75rem' }}>{r.kind}</td>
                  <td>{r.ref}</td>
                  <td>{r.party}</td>
                  <td className="num">{money(r.taxable, 2)}</td>
                  <td className="num strong">{money(r.gst, 2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>{net >= 0 ? 'Net payable (output − input)' : 'Net credit (input − output)'}</td>
                <td className="num strong">{money(Math.abs(net), 2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
