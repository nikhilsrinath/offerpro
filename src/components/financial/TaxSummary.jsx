import { useMemo, useState } from 'react';
import { Download, Info, ArrowUpRight, ArrowDownLeft, Scale } from 'lucide-react';
import { taxSummary, periodOptions, downloadCsv } from '../../services/financeAnalytics';
import { Stat } from './financeUi';
import { useSection, money, fmtDate } from './financeHooks';
import { useProjectScope } from '../projects/projectScope';

const KINDS = [
  { id: 'month', label: 'Monthly' },
  { id: 'quarter', label: 'Quarterly' },
  { id: 'fy', label: 'Yearly' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
];

/**
 * Output GST collected against input GST paid, by month or FY quarter.
 * Deliberately labelled as a preparation aid: it is computed from what is in
 * EdgeOS and does not handle reverse charge, blocked credits, credit notes or
 * amendments, so it must never be mistaken for a return.
 */
export default function TaxSummary({ projectId = null }) {
  const allDocs = useSection('fin_docs');
  const allPurchases = useSection('purchase_invoices');
  const allExpenses = useSection('expenses');
  const allIncome = useSection('income_entries');
  const vendors = useSection('vendors');
  // With `projectId` (a project's Tax Summary): the GST on what is linked to
  // the project, at its share of anything split across projects.
  const scope = useProjectScope(projectId);
  const docs = scope ? scope.data.docs : allDocs;
  const purchases = scope ? scope.data.purchases : allPurchases;
  const expenses = scope ? scope.data.expenses : allExpenses;
  const income = scope ? scope.data.income : allIncome;

  const [kind, setKind] = useState('month');
  const options = useMemo(
    () => (kind === 'all' || kind === 'custom' ? [] : periodOptions(kind, kind === 'month' ? 12 : kind === 'quarter' ? 8 : 5)),
    [kind],
  );
  const [periodId, setPeriodId] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const period = kind === 'all'
    ? { id: 'all', label: 'All time', from: null, to: null }
    : kind === 'custom'
      ? { id: 'custom', label: 'Custom', from: from || null, to: to || null }
      : options.find((o) => o.id === periodId) || options[0];

  const summary = useMemo(
    () => taxSummary({ docs, purchases, expenses, income, vendors }, period.from, period.to),
    [docs, purchases, expenses, income, vendors, period.from, period.to],
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
    downloadCsv(`tax-summary-${scope?.project?.code ? `${scope.project.code}-` : ''}${period.from || 'start'}-to-${period.to || 'today'}.csv`,
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
          {scope && <>Only this project’s invoices, bills and cash-book entries, and only its share of any split
            across projects. GST is filed for the whole company, so use the company Tax Summary to file. </>}
          <strong>A preparation aid, not a filing tool.</strong> These figures come from invoices, bills and
          expenses recorded in EdgeOS. They do not account for reverse charge, ineligible input credit,
          credit/debit notes or amendments. Reconcile with GSTR-2B and your accountant before filing.
        </span>
      </div>

      <div className="prod-toolbar">
        {KINDS.map((k) => (
          <button key={k.id} aria-pressed={kind === k.id} className={`pro-chip ${kind === k.id ? 'active' : ''}`}
            onClick={() => { setKind(k.id); setPeriodId(null); }}>{k.label}</button>
        ))}
        <button className="prod-add-btn" onClick={exportCsv}>
          <Download size={15} /> Export CSV
        </button>
        {options.length > 0 && (
          <select aria-label="Tax period" className="prod-select" value={period.id} onChange={(e) => setPeriodId(e.target.value)}>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
        {kind === 'custom' && (
          <div className="prod-range">
            <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span>to</span>
            <input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
      </div>

      <div className="prod-stats">
        <Stat icon={<ArrowUpRight size={15} />} label={`Output GST · ${summary.output.count} sales`} value={money(summary.output.gst, 2)}
          sub={summary.output.igst > 0 ? `IGST ${money(summary.output.igst)} · CGST ${money(summary.output.cgst)} · SGST ${money(summary.output.sgst)}`
            : `CGST ${money(summary.output.cgst)} · SGST ${money(summary.output.sgst)}`} />
        <Stat icon={<ArrowDownLeft size={15} />} label={`Input GST · ${summary.input.count} bills & expenses`} value={money(summary.input.gst, 2)}
          sub={`Bills ${money(summary.input.purchases)} · Expenses ${money(summary.input.expenses)}`} accent="var(--success)" />
        <Stat icon={<Scale size={15} />} label={net >= 0 ? 'Net liability (estimated)' : 'Net credit carried forward'}
          value={money(Math.abs(net), 2)} accent={net > 0 ? 'var(--error)' : 'var(--success)'} />
      </div>

      <p className="prod-perf-note">
        {period.from || period.to
          ? `${period.label}: ${period.from ? fmtDate(period.from) : 'start'} – ${period.to ? fmtDate(period.to) : 'today'}`
          : 'All time'}. Output GST is taken from issued invoices
        by issue date, plus the GST on cash-book receipts that are not against an invoice; drafts and cancelled
        invoices are excluded. A cash-book receipt has no place of supply, so its GST is split as CGST and SGST.
        Input GST is from purchase invoices and from the GST entered on expenses. The rate-wise table
        is the shape a return asks for: a single total cannot be entered into GSTR-1, which wants the
        taxable value and the tax at each slab.
      </p>

      {summary.byRate.length > 0 && (
        <div className="prod-perf-table-wrap" style={{ marginBottom: '1rem' }}>
          <table className="prod-perf-table">
            <caption className="sr-only">GST by rate, for the selected period</caption>
            <thead>
              <tr>
                <th scope="col">Rate-wise</th>
                <th scope="col" className="num">Rate</th>
                <th scope="col" className="num">Entries</th>
                <th scope="col" className="num">Taxable Value</th>
                <th scope="col" className="num">GST</th>
              </tr>
            </thead>
            <tbody>
              {summary.byRate.map((b) => (
                <tr key={b.key}>
                  <td style={{ color: b.kind === 'Output' ? 'var(--error)' : 'var(--success)', fontWeight: 600, fontSize: '0.75rem' }}>{b.kind}</td>
                  <td className="num">{b.rate ? `${Number(b.rate)}%` : 'Nil / exempt'}</td>
                  <td className="num">{b.count}</td>
                  <td className="num">{money(b.taxable, 2)}</td>
                  <td className="num strong">{money(b.gst, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary.rows.length === 0 ? (
        <div className="prod-empty">
          <Scale size={40} strokeWidth={1} />
          <p>No taxable activity in this period</p>
        </div>
      ) : (
        <div className="prod-perf-table-wrap">
          <table className="prod-perf-table">
            <thead>
              <tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Reference</th><th scope="col">Party</th><th scope="col" className="num">Rate</th><th scope="col">Kind</th><th scope="col" className="num">Taxable Value</th><th scope="col" className="num">GST</th></tr>
            </thead>
            <tbody>
              {summary.rows.map((r, i) => (
                <tr key={`${r.ref}-${i}`}>
                  <td className="prod-perf-date">{fmtDate(r.date)}</td>
                  <td style={{ color: r.kind === 'Output' ? 'var(--error)' : 'var(--success)', fontWeight: 600, fontSize: '0.75rem' }}>{r.kind}</td>
                  <td>{r.ref}</td>
                  <td>{r.party}</td>
                  <td className="num">{r.rate ? `${Number(r.rate)}%` : '-'}</td>
                  <td style={{ fontSize: '0.75rem' }}>{r.gst > 0 ? (r.interState ? 'IGST' : 'CGST+SGST') : '-'}</td>
                  <td className="num">{money(r.taxable, 2)}</td>
                  <td className="num strong">{money(r.gst, 2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7}>{net >= 0 ? 'Net payable (output − input)' : 'Net credit (input − output)'}</td>
                <td className="num strong">{money(Math.abs(net), 2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
