import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Search, UserPlus } from 'lucide-react';
import { Modal } from './financeUi';
import { fmtDate, money, useSection } from './financeHooks';
import { categoryLabel } from '../../services/financeCategories';
import { canSeeFinancials } from '../../services/projectService';
import { focusKey, focusPath } from '../shell/focusTarget';

const MONEY_VIEWS = [['all', 'All'], ['in', 'Credit'], ['out', 'Debit']];

// Where each kind of thing lives. A log row goes there and finds its own row
// (`?focus=`, shell/focusTarget.js); it never opens a form to edit.
const GENERAL_LEDGER = '/financials/general-ledger';
const BILLING_PATH = { invoice: '/clients/billing/invoices', quotation: '/clients/billing/quotations', proforma: '/clients/billing/proforma' };
const DOC_LABEL = { invoice: 'Invoice', quotation: 'Quotation', proforma: 'Proforma Invoice' };
const RECORD_LABEL = {
  offer: 'Offer Letter', certificate: 'Certificate', nda: 'NDA', mou: 'MoU', agreement: 'Agreement',
  role_change: 'Role Change Notice', termination: 'Termination Notice', invoice: 'Invoice',
};

const day = (v) => (v ? String(v).slice(0, 10) : '');
const personName = (e) => e.studentName || `${(e.first_name || '').trim()} ${(e.last_name || '').trim()}`.trim() || e.name || 'Someone';

/**
 * The Logs button's panel on a module page's top bar: what happened in the
 * company, newest first. Credits and debits (for those who may see the
 * money), documents created (invoices, quotations, proformas, vendor
 * invoices, letters and agreements) and people joining. A row goes to the
 * page the thing is on and points it out there.
 */
export function CompanyLogs({ t, onClose }) {
  const navigate = useNavigate();
  const money$ = canSeeFinancials();
  const income = useSection('income_entries');
  const expenses = useSection('expenses');
  const finDocs = useSection('fin_docs');
  const bills = useSection('purchase_invoices');
  const vendors = useSection('vendors');
  const records = useSection('records');
  const employees = useSection('employees');

  const logs = useMemo(() => {
    const vendorName = Object.fromEntries(vendors.map((v) => [v.id, v.company_name]));
    const out = [];
    if (money$) {
      income.forEach((e) => out.push({
        ...e, kind: 'in', day: day(e.date || e.received_on), at: e.created_at,
        to: GENERAL_LEDGER, focus: focusKey('income_entry', e.id),
      }));
      expenses.forEach((e) => out.push({
        ...e, kind: 'out', day: day(e.date || e.incurred_on), at: e.created_at,
        to: GENERAL_LEDGER, focus: focusKey('expense', e.id),
      }));
      finDocs.filter((d) => BILLING_PATH[d.type]).forEach((d) => out.push({
        id: d.id, kind: 'doc', day: day(d.created_at || d.issue_date), at: d.created_at,
        title: `${DOC_LABEL[d.type]} ${d.invoiceNumber || d.doc_number || ''}`.trim(),
        meta: [d.clientName || d.issued_to, d.status === 'void' ? 'Cancelled' : null].filter(Boolean).join(' · '),
        amount: d.grand_total,
        to: BILLING_PATH[d.type], focus: focusKey('doc', d.id),
      }));
      bills.forEach((b) => out.push({
        id: b.id, kind: 'doc', day: day(b.created_at || b.bill_date), at: b.created_at,
        title: `Vendor Invoice ${b.bill_number || ''}`.trim(),
        meta: vendorName[b.vendor_id] || '',
        amount: b.total,
        to: GENERAL_LEDGER, focus: focusKey('purchase_invoice', b.id),
      }));
    }
    records.forEach((r) => out.push({
      id: r.id, kind: 'doc', day: day(r.created_at || r.issue_date), at: r.created_at,
      title: r.title || RECORD_LABEL[r.type] || 'Document',
      meta: [RECORD_LABEL[r.type], r.issued_to].filter(Boolean).join(' · '),
      to: '/documents/records', focus: focusKey('record', r.id),
    }));
    const today = day(new Date().toISOString());
    employees.forEach((e) => {
      const joined = day(e.startDate || e.created_at);
      out.push({
        id: e.id, kind: 'person', day: joined, at: e.created_at,
        title: `${personName(e)} ${joined > today ? 'joins' : 'joined'}`,
        meta: [e.role, e.department].filter((x) => typeof x === 'string' && x).join(' · '),
        to: '/company/employees', focus: focusKey('employee', e.id),
      });
    });
    return out.sort((a, b) => String(b.day).localeCompare(String(a.day)) || String(b.at || '').localeCompare(String(a.at || '')));
  }, [money$, income, expenses, finDocs, bills, vendors, records, employees]);

  const views = money$
    ? [...MONEY_VIEWS, ['doc', 'Documents'], ['person', 'People']]
    : [['all', 'All'], ['doc', 'Documents'], ['person', 'People']];

  return <RecordLogs t={t} logs={logs} views={views} onClose={onClose}
    placeholder="Search name, number, description..."
    onOpen={(r) => navigate(focusPath(r.to, r.focus))} />;
}
const STEP = 50;

/**
 * Logs: what happened, newest first, grouped by date, in a side panel.
 * `logs` are rows with `kind` (or `direction`): 'in' | 'out' (a credit or
 * debit), 'doc' or 'person' (with `title`, `meta`, optional `amount`), and
 * `day`. A row closes the panel and goes to the thing (`onOpen`).
 */
export default function RecordLogs({ t, logs, onOpen, onClose, views = MONEY_VIEWS, placeholder }) {
  const [view, setView] = useState('all');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(STEP);
  const kindOf = (r) => r.kind || r.direction;

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return logs.filter((r) => (view === 'all' || (r.kind || r.direction) === view)
      && (!needle || [r.title, r.meta, r.description, r.reference, r.receipt_number, categoryLabel(r.category)]
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

  const noun = (n) => (n === 1 ? 'entry' : 'entries');

  return (
    <Modal title="Logs" onClose={onClose} width={560}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '12px var(--dr-pad, 20px)', borderBottom: '1px solid var(--dr-line)',
      }}>
        <div role="group" aria-label="Show" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {views.map(([id, label]) => (
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
            placeholder={placeholder || 'Search description, reference, category...'} aria-label="Search logs"
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, fontFamily: 'inherit', color: 'var(--dr-text)' }} />
        </label>
      </div>

      <div className="prod-modal-body" style={{ padding: '4px var(--dr-pad, 20px) 16px' }}>
        <div style={{ fontSize: 12, color: 'var(--dr-faint)', padding: '8px 0 2px' }}>
          {list.length} {noun(list.length)}
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
              const kind = kindOf(r);
              const isMoney = kind === 'in' || kind === 'out';
              const isIn = kind === 'in';
              const title = isMoney ? r.description || (isIn ? 'Credit' : 'Debit') : r.title;
              const meta = isMoney ? [categoryLabel(r.category), r.reference || r.receipt_number].filter(Boolean).join(' · ') : r.meta;
              const Icon = kind === 'person' ? UserPlus : FileText;
              return (
                <button key={`${kind}-${r.id}`} type="button" className="edge-tr"
                  onClick={() => { onClose(); onOpen?.(r); }}
                  title="Show where it is"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 8px', margin: '0 -8px',
                    boxSizing: 'content-box', border: 'none', borderBottom: '1px solid var(--dr-line)', background: 'transparent',
                    cursor: 'pointer', fontFamily: 'inherit', color: 'var(--dr-text)', textAlign: 'left',
                  }}>
                  {isMoney
                    ? <span aria-hidden="true" style={{ width: 7, height: 7, margin: '0 3px', borderRadius: 99, flexShrink: 0, background: isIn ? t.up : t.down }} />
                    : <Icon size={13} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--dr-dim)' }} />}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {title}
                    </span>
                    {meta && (
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--dr-faint)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta}</span>
                    )}
                  </span>
                  {isMoney ? (
                    <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: isIn ? t.up : t.down }}>
                      {isIn ? '+' : '−'}{money(r.amount, 2)}
                    </span>
                  ) : r.amount != null && (
                    <span style={{ fontSize: 13, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: 'var(--dr-dim)' }}>
                      {money(r.amount, 2)}
                    </span>
                  )}
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
