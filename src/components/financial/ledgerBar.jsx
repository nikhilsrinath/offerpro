import { Search, X } from 'lucide-react';

/* The General Ledger's filter bar, the same on Financials', the Clients' and
   the Vendors' (and each project's). Which side and which period are two
   dropdowns rather than rows of chips, so the bar keeps room for the ledger's
   own Export and Columns beside them (ProjectLedger `toolbar`). */

const SIDES = [['all', 'All entries'], ['in', 'Credit only'], ['out', 'Debit only']];
const PERIODS = [
  ['all', 'All time'], ['month', 'This month'], ['quarter', 'This quarter'], ['fy', 'This FY'], ['custom', 'Custom range'],
];

/**
 * `selects` are the page's own pickers (project, vendor, client):
 * [{ label, value, onChange, options: [[id, text]] }]. `view` is 'all',
 * 'in' (credit) or 'out' (debit).
 */
export function LedgerBar({ search, onSearch, placeholder, selects = [], view, onView, period }) {
  return (
    <>
      <div className="prod-search">
        <Search size={14} aria-hidden="true" />
        <input aria-label="Search the ledger" value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} />
        {search && <button type="button" onClick={() => onSearch('')} className="prod-search-clear" aria-label="Clear search" title="Clear search"><X size={13} /></button>}
      </div>
      {selects.map((s) => (
        <select key={s.label} aria-label={s.label} title={s.label} value={s.value} onChange={(e) => s.onChange(e.target.value)} className="prod-select">
          {s.options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
        </select>
      ))}
      <select aria-label="Credit or debit" title="Credit or debit" value={view} onChange={(e) => onView(e.target.value)} className="prod-select">
        {SIDES.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
      </select>
      <select aria-label="Period" title="Period" value={period.preset} onChange={(e) => period.setPreset(e.target.value)} className="prod-select">
        {PERIODS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
      </select>
      {period.preset === 'custom' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="date" aria-label="From date" value={period.from} onChange={(e) => period.setFrom(e.target.value)} className="prod-select" style={{ width: 140 }} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
          <input type="date" aria-label="To date" value={period.to} onChange={(e) => period.setTo(e.target.value)} className="prod-select" style={{ width: 140 }} />
        </span>
      )}
    </>
  );
}
