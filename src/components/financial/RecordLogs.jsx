import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Modal } from './financeUi';
import { fmtDate, money, useSection } from './financeHooks';
import CashEntryModal from './CashEntryModal';
import { categoryLabel } from '../../services/financeCategories';

const VIEWS = [['all', 'All'], ['in', 'Credit'], ['out', 'Debit']];

/**
 * The Logs button's panel on a module page's top bar: every credit and debit
 * in the company, newest first. An entry opens its own form over it. The
 * data is only read while the panel is open.
 */
export function CompanyLogs({ t, onClose }) {
  const income = useSection('income_entries');
  const expenses = useSection('expenses');
  const [entry, setEntry] = useState(null);
  const logs = useMemo(() => [
    ...income.map((e) => ({ ...e, direction: 'in', day: e.date || e.received_on })),
    ...expenses.map((e) => ({ ...e, direction: 'out', day: e.date || e.incurred_on })),
  ].sort((a, b) => String(b.day).localeCompare(String(a.day))), [income, expenses]);

  if (entry) return <CashEntryModal key={entry.id} entry={entry} onClose={onClose} />;
  return <RecordLogs t={t} logs={logs} onClose={onClose} keepOpen
    onOpen={(r) => setEntry({ ...r, date: r.day })} />;
}
const STEP = 50;

/**
 * Logs: everything recorded on a General Ledger, newest first, in a side
 * panel. `logs` are entries with `direction` ('in' | 'out') and `day`; a row
 * closes the panel (unless `keepOpen`) and opens the entry (`onOpen`).
 */
export default function RecordLogs({ t, logs, onOpen, onClose, keepOpen = false }) {
  const [view, setView] = useState('all');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(STEP);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return logs.filter((r) => (view === 'all' || r.direction === view)
      && (!needle || [r.description, r.reference, r.receipt_number, categoryLabel(r.category)]
        .some((s) => String(s || '').toLowerCase().includes(needle))));
  }, [logs, view, q]);

  // Grouped by day, each group under its date.
  const groups = useMemo(() => {
    const out = [];
    list.slice(0, shown).forEach((r) => {
      const last = out[out.length - 1];
      if (last && last.day === r.day) last.rows.push(r);
      else out.push({ day: r.day, rows: [r] });
    });
    return out;
  }, [list, shown]);

  return (
    <Modal title="Logs" onClose={onClose} width={560}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '12px var(--dr-pad, 20px)', borderBottom: '1px solid var(--dr-line)',
      }}>
        <div role="group" aria-label="Show" style={{ display: 'flex', gap: 4 }}>
          {VIEWS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => { setView(id); setShown(STEP); }}
              style={{
                padding: '5px 11px', borderRadius: 99, fontSize: 12.5, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer',
                border: '1px solid ' + (view === id ? 'var(--dr-line-strong)' : 'var(--dr-line)'),
                background: view === id ? 'var(--dr-field)' : 'transparent',
                color: view === id ? 'var(--dr-text)' : 'var(--dr-dim)',
              }}>{label}</button>
          ))}
        </div>
        <label style={{
          flex: 1, minWidth: 160, display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px',
          borderRadius: 9, border: '1px solid var(--dr-line)', background: 'var(--dr-field)', color: 'var(--dr-faint)',
        }}>
          <Search size={13} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setShown(STEP); }}
            placeholder="Search description, reference, category..." aria-label="Search logs"
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, fontFamily: 'inherit', color: 'var(--dr-text)' }} />
        </label>
      </div>

      <div className="prod-modal-body" style={{ padding: '4px var(--dr-pad, 20px) 16px' }}>
        <div style={{ fontSize: 12, color: 'var(--dr-faint)', padding: '8px 0 2px' }}>
          {list.length} {list.length === 1 ? 'entry' : 'entries'}
        </div>
        {!groups.length && (
          <div style={{ fontSize: 13, color: 'var(--dr-faint)', padding: '24px 0', textAlign: 'center' }}>
            {logs.length ? 'Nothing matches.' : 'Nothing recorded yet.'}
          </div>
        )}
        {groups.map((g) => (
          <section key={g.day || 'none'} aria-label={g.day ? fmtDate(g.day) : 'No date'}>
            <div style={{
              position: 'sticky', top: 0, zIndex: 1, padding: '12px 0 6px', fontSize: 12, fontWeight: 600,
              color: 'var(--dr-dim)', background: 'var(--dr-bg)', borderBottom: '1px solid var(--dr-line)',
            }}>{g.day ? fmtDate(g.day) : 'No date'}</div>
            {g.rows.map((r) => {
              const isIn = r.direction === 'in';
              const meta = [categoryLabel(r.category), r.reference || r.receipt_number].filter(Boolean).join(' · ');
              return (
                <button key={`${r.direction}-${r.id}`} type="button" className="edge-tr"
                  onClick={() => { if (!keepOpen) onClose(); onOpen(r); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 8px', margin: '0 -8px',
                    boxSizing: 'content-box', border: 'none', borderBottom: '1px solid var(--dr-line)', background: 'transparent',
                    cursor: 'pointer', fontFamily: 'inherit', color: 'var(--dr-text)', textAlign: 'left',
                  }}>
                  <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 99, flexShrink: 0, background: isIn ? t.up : t.down }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.description || (isIn ? 'Credit' : 'Debit')}
                    </span>
                    {meta && (
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--dr-faint)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta}</span>
                    )}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: isIn ? t.up : t.down }}>
                    {isIn ? '+' : '−'}{money(r.amount, 2)}
                  </span>
                </button>
              );
            })}
          </section>
        ))}
        {list.length > shown && (
          <button type="button" className="prod-btn-ghost" onClick={() => setShown(shown + STEP)} style={{ alignSelf: 'center', marginTop: 14 }}>
            Show more ({list.length - shown} left)
          </button>
        )}
      </div>
    </Modal>
  );
}
