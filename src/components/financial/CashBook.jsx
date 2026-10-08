import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Download, Paperclip, Pencil,
  Trash2, Wallet,
} from 'lucide-react';
import { orgStore } from '../../services/orgStore';
import { receiptService } from '../../services/receiptService';
import { cashFlow, downloadCsv, inRange, periodBounds } from '../../services/financeAnalytics';
import {
  TREATMENTS, categoryLabel, groupOf, loadFinanceCategories, methodLabel, rowTreatment,
} from '../../services/financeCategories';
import { useToast } from '../shared/Toast';
import {
  Page, Toolbar, Row, Panel, Btn, Seg, Search, Input, Dropdown, RowMenu, Table, Tr, Td, Status, Bar, Empty, Muted,
} from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { pickerFor, canSeeFinancials } from '../../services/projectService';
import { projectLabel } from '../../services/projectAnalytics';
import { GENERAL, rowsFor, splitTotals, withParts } from '../../services/ledgerSplit';
import { useProjectScope } from '../projects/projectScope';
import { fmtDate, money, useSection } from './financeHooks';
import { confirmDialog } from '../../services/confirm';
import CashEntryModal from './CashEntryModal';
import { SECTION, billBalance, billPaymentEntry, blank } from './cashEntry';

const PRESETS = [
  { id: 'all',     label: 'All time' },
  { id: 'month',   label: 'This month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'fy',      label: 'This FY' },
  { id: 'custom',  label: 'Custom' },
];

const PAGE_SIZE = 6;

const VIEWS = [
  { id: 'all', label: 'Everything' },
  { id: 'in',  label: 'Money in' },
  { id: 'out', label: 'Money out' },
];

/**
 * The cash book: every rupee in and out that no invoice or vendor bill already
 * records: counter sales, retainers, interest, a founder putting money in, a
 * salary run, a laptop, a loan repayment.
 *
 * The screen is built around one distinction that a single "add expense" box
 * could never make: money moving is not the same as profit changing. A laptop
 * bought, a loan repaid, a drawing taken and GST remitted all leave the bank
 * without costing anything; funding received and a vendor refund both arrive
 * without being earned. Each category carries its treatment (0038), the form
 * says out loud what the chosen one will do, and the two totals at the top are
 * labelled so the difference is visible rather than inferred.
 */
export default function CashBook({ projectId = null }) {
  const t = useT();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  // With `projectId` (a project's Cash Book) only the entries linked to the
  // project are listed and totalled, at the project's share of any entry
  // split across projects: and a new entry starts on the project.
  const scope = useProjectScope(projectId);
  const allIncome = useSection('income_entries');
  const allExpenses = useSection('expenses');
  const income = scope ? scope.data.income : allIncome;
  const expenses = scope ? scope.data.expenses : allExpenses;
  const clients = useSection('customers');
  const vendors = useSection('vendors');
  const employees = useSection('employees');
  const products = useSection('products');
  const catalog = useSection('catalog');
  const departments = useSection('departments');
  const allocations = useSection('project_allocations');
  const projects = useSection('projects');
  const bills = useSection('purchase_invoices');

  // On the company ledger every entry is split between the projects it is on
  // and "General or Others" · office, rent, fuel, a loan. Only for those who
  // can see project money: without the allocations everything would look
  // General.
  const splitting = !scope && canSeeFinancials();

  // The taxonomy is reference data shared by every org, so it is fetched rather
  // than held in orgStore's per-tenant cache. `ready` only gates the labels;
  // the figures are computed from treatments already stamped on each row.
  const [ready, setReady] = useState(false);
  useEffect(() => { loadFinanceCategories().then(() => setReady(true)); }, []);

  const [preset, setPreset] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [view, setView] = useState('all');
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [where, setWhere] = useState('all'); // 'all', GENERAL or a project id
  const [editing, setEditing] = useState(null);

  const range = preset === 'custom' ? { from: from || null, to: to || null } : periodBounds(preset);

  // A blank entry; on a project's page it is already the project's, and money
  // in is already from the project's client.
  const projectClient = scope?.project?.client_id || '';
  const fresh = useCallback((direction) => (projectId
    ? { ...blank(direction), _picker: pickerFor(projectId), ...(direction === 'in' ? { client_id: projectClient } : {}) }
    : blank(direction)), [projectId, projectClient]);

  // The Billing & Revenue page and the empty states link here with ?new=in or
  // ?new=out to open the form already pointed the right way.
  useEffect(() => {
    const wanted = params.get('new');
    if (wanted !== 'in' && wanted !== 'out') return;
    setEditing(fresh(wanted));
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }, [params, setParams, fresh]);

  // Old links to ?pay_bill=<id> still open the bill's payment form here;
  // Purchase Bills now opens the same form in place.
  useEffect(() => {
    const billId = params.get('pay_bill');
    if (!billId) return;
    const bill = bills.find((b) => b.id === billId);
    if (!bill) return; // not loaded yet
    const next = new URLSearchParams(params);
    next.delete('pay_bill');
    setParams(next, { replace: true });
    if (bill.status === 'void' || billBalance(bill) <= 0) {
      toast(`Bill ${bill.bill_number} has nothing left to pay`, 'info');
      return;
    }
    setEditing(billPaymentEntry(bill, { allocations, projects }));
  }, [params, setParams, bills, allocations, projects, toast]);

  const nameOf = (list, id, key = 'name') => list.find((x) => x.id === id)?.[key] || '';

  /** Both tables as one list of ledger rows, newest first. */
  const allRows = useMemo(() => {
    const partyIn = (e) => nameOf(clients, e.client_id, 'name');
    const partyOut = (e) => nameOf(vendors, e.vendor_id, 'company_name')
      || nameOf(employees, e.employee_id, 'name')
      || nameOf(products, e.product_id, 'name');
    const merged = [
      ...income.map((e) => ({
        ...e, direction: 'in', day: e.date || e.received_on,
        party: partyIn(e), treatment: rowTreatment(e, 'in'),
      })),
      ...expenses.map((e) => ({
        ...e, direction: 'out', day: e.date || e.incurred_on,
        party: partyOut(e), treatment: rowTreatment(e, 'out'),
      })),
    ].sort((a, b) => String(b.day).localeCompare(String(a.day)));
    return splitting ? withParts(merged, allocations) : merged;
  }, [income, expenses, clients, vendors, employees, products, splitting, allocations]);

  // The rows of the chosen project or of General, at that part's share.
  const rows = useMemo(() => (splitting ? rowsFor(allRows, where) : allRows), [allRows, splitting, where]);

  const byWhere = useMemo(
    () => (splitting ? splitTotals(allRows.filter((r) => inRange(r.day, range.from, range.to))) : []),
    [allRows, splitting, range.from, range.to],
  );
  const projectName = (id) => projectLabel(projects.find((p) => p.id === id)) || 'Project';
  const whereLabel = where === GENERAL ? 'Others' : projectName(where);
  const partsLabel = (r) => (r._parts || [])
    .map((p) => (p.key === GENERAL ? 'General' : (projects.find((x) => x.id === p.key)?.code || projectName(p.key))))
    .join(' + ') || 'General';

  const groups = useMemo(() => {
    const seen = new Set(rows.map((r) => groupOf(r.category)));
    return [...seen].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => inRange(r.day, range.from, range.to))
      .filter((r) => view === 'all' || r.direction === view)
      .filter((r) => groupFilter === 'all' || groupOf(r.category) === groupFilter)
      .filter((r) => !q || [r.description, r.reference, r.party, categoryLabel(r.category)]
        .some((f) => String(f || '').toLowerCase().includes(q)));
  }, [rows, range.from, range.to, view, groupFilter, search]);

  // Six entries a page. The page belongs to the filters it was picked under,
  // so changing any filter starts again at page one.
  const filterKey = [preset, from, to, view, groupFilter, where, search].join('|');
  const [pager, setPager] = useState({ key: filterKey, page: 1 });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(pager.key === filterKey ? pager.page : 1, pageCount);
  const setPage = (n) => setPager({ key: filterKey, page: n });
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const flow = useMemo(
    () => cashFlow({
      income: rows.filter((r) => r.direction === 'in'),
      expenses: rows.filter((r) => r.direction === 'out'),
    }, range.from, range.to),
    [rows, range.from, range.to],
  );
  const exportCsv = () => {
    const body = filtered.map((r) => [
      r.day,
      r.direction === 'in' ? 'In' : 'Out',
      categoryLabel(r.category),
      TREATMENTS[r.treatment]?.label || r.treatment,
      r.description,
      r.party,
      methodLabel(r.payment_method),
      r.reference || '',
      Number(r.amount || 0).toFixed(2),
      Number(r.tax_amount || 0).toFixed(2),
      Number(r.tax_rate || 0).toFixed(2),
      r.is_inter_state ? 'IGST' : 'CGST+SGST',
      r.place_of_supply || '',
      r.country_code || '',
      r.currency || 'INR',
      Number(r.original_amount ?? r.amount ?? 0).toFixed(2),
      Number(r.fx_rate || 1).toFixed(6),
      r.quantity == null ? '' : String(r.quantity),
      r.unit || '',
      r.direction === 'out' ? nameOf(departments, r.department_id) : '',
      r.direction === 'out' ? (r.billable ? 'Billable' : '') : '',
      r.direction === 'in' ? nameOf(catalog, r.catalog_item_id) : '',
      ...(splitting ? [partsLabel(r)] : []),
    ]);
    downloadCsv(
      `general-ledger-${range.from || 'start'}-to-${range.to || 'today'}.csv`,
      ['Date', 'Direction', 'Category', 'Treatment', 'Description', 'Party', 'Method', 'Reference',
        'Amount (INR)', 'GST (INR)', 'GST rate %', 'GST kind', 'Place of supply', 'Country',
        'Currency', 'Original amount', 'FX rate', 'Quantity', 'Unit', 'Department', 'Billable', 'Product',
        ...(splitting ? ['Project'] : [])],
      body,
    );
  };

  const handleDelete = async (r) => {
    if (!(await confirmDialog({ title: 'Delete entry', message: `Are you sure you want to delete “${r.description}”? This cannot be undone.` }))) return;
    try {
      await orgStore.removeItem(SECTION[r.direction], r.id);
      // Deleting a bill payment reopens that much of the bill (0080).
      if (r.purchase_invoice_id) orgStore.refreshSection('purchase_invoices');
      if (r.receipt_path) receiptService.remove(r.receipt_path);
      toast('Entry deleted', 'success');
    } catch (err) {
      toast(`Could not delete: ${err.message}`, 'error');
    }
  };

  const recent = rows.slice(0, 3);
  const inShare = flow.cashIn + flow.cashOut > 0 ? flow.cashIn / (flow.cashIn + flow.cashOut) : 0;
  const periodText = range.from ? `${fmtDate(range.from)} – ${fmtDate(range.to)}` : preset === 'custom' ? 'Custom range' : 'All time';
  const record = (direction) => setEditing(fresh(direction));

  return (
    <Page>
      <div className="gl-bento">
        {/* ── the one job of this page: put money on the record ── */}
        <section aria-labelledby="gl-record" className="gl-record" style={{
          gridArea: 'rec', position: 'relative', overflow: 'hidden', padding: 20, borderRadius: 20,
          background: t.card, border: '1px solid ' + t.line, boxShadow: t.highlight,
          backgroundImage: `radial-gradient(120% 90% at 100% 0%, ${t.accentSoft}, transparent 62%)`,
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <h2 id="gl-record" style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em', color: t.text }}>Record money</h2>
              <div style={{ fontSize: 12.5, color: t.faint, marginTop: 2 }}>
                {scope ? 'Lands on this project straight away.' : 'Cash in without an invoice, and anything you spent.'}
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            <RecordBtn t={t} tone={t.up} icon={ArrowDownLeft} label="Money in" note="Sales, retainers, funding, interest" onClick={() => record('in')} />
            <RecordBtn t={t} tone={t.down} icon={ArrowUpRight} label="Money out" note="Salaries, rent, purchases, tax" onClick={() => record('out')} />
          </div>
          <div style={{ marginTop: 'auto', minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: t.faint, marginBottom: 4 }}>Recently recorded</div>
            {recent.length ? recent.map((r) => {
              const isIn = r.direction === 'in';
              return (
                <button key={`${r.direction}-${r.id}`} type="button" className="edge-tr"
                  onClick={() => setEditing({ ...r, ...(r._full || {}), _share: undefined, _full: undefined, date: r.day })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 8px', margin: '0 -8px',
                    boxSizing: 'content-box', border: 'none', borderRadius: 9, background: 'transparent', cursor: 'pointer',
                    fontFamily: 'inherit', color: t.text, textAlign: 'left',
                  }}>
                  <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 99, flexShrink: 0, background: isIn ? t.up : t.down }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.description}</span>
                  <span style={{ fontSize: 12, color: t.faint, whiteSpace: 'nowrap' }}>{fmtDate(r.day)}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: isIn ? t.up : t.down }}>
                    {isIn ? '+' : '−'}{money(r.amount, 2)}
                  </span>
                </button>
              );
            }) : (
              <div style={{ fontSize: 12.5, color: t.faint }}>Nothing yet. Both sides land in Profit &amp; Loss and the Tax Summary straight away.</div>
            )}
          </div>
        </section>

        <FlowTile t={t} area="in" icon={ArrowDownLeft} tone={t.up} label="Money in" value={money(flow.cashIn)}
          note={`${flow.inCount} ${flow.inCount === 1 ? 'entry' : 'entries'} · ${periodText}`}
          active={view === 'in'} onClick={() => setView(view === 'in' ? 'all' : 'in')} />
        <FlowTile t={t} area="out" icon={ArrowUpRight} tone={t.down} label="Money out" value={money(flow.cashOut)}
          note={flow.pending > 0 ? `${money(flow.pending)} not paid yet` : `${flow.outCount} ${flow.outCount === 1 ? 'entry' : 'entries'} · ${periodText}`}
          active={view === 'out'} onClick={() => setView(view === 'out' ? 'all' : 'out')} />
        <div style={{
          gridArea: 'net', padding: '16px 18px', borderRadius: 18, background: t.card, border: '1px solid ' + t.line, boxShadow: t.highlight,
          display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center', background: t.accentSoft, color: t.accent }}><Wallet size={14} /></span>
            <span style={{ fontSize: 12.5, fontWeight: 500, color: t.dim, flex: 1 }}>{flow.net >= 0 ? 'Net cash in' : 'Net cash out'}</span>
            {splitting && where !== 'all' && <Status tone="accent">{whereLabel}</Status>}
          </div>
          <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: flow.net >= 0 ? t.up : t.down }}>
            {flow.net < 0 ? '−' : ''}{money(Math.abs(flow.net))}
          </div>
          <div aria-hidden="true" style={{ display: 'flex', gap: 3, height: 8, borderRadius: 99, overflow: 'hidden', background: t.panelAlt }}>
            <span style={{ flex: `${inShare} 1 0`, background: t.up, borderRadius: 99, minWidth: inShare > 0 ? 4 : 0 }} />
            <span style={{ flex: `${1 - inShare} 1 0`, background: t.down, borderRadius: 99, minWidth: inShare < 1 && flow.cashOut > 0 ? 4 : 0 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: t.faint }}>
            <span>{Math.round(inShare * 100)}% in</span>
            <span>{Math.round((1 - inShare) * 100)}% out</span>
          </div>
        </div>
      </div>

      {/* ── narrow the list ── */}
      <Toolbar right={<Btn onClick={exportCsv} disabled={filtered.length === 0}><Download size={15} aria-hidden="true" /> Export CSV</Btn>}>
        <Search value={search} onChange={setSearch} placeholder="Search description, party, reference…" width={280} />
        <Seg value={view} onChange={setView} label="Direction" options={VIEWS} />
        <Seg value={preset} onChange={setPreset} label="Period" options={PRESETS} />
        {preset === 'custom' && (
          <Row gap={6}>
            <Input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
            <Muted>to</Muted>
            <Input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
          </Row>
        )}
        <Dropdown label="Reason" value={groupFilter} onChange={setGroupFilter}
          options={[{ id: 'all', label: 'All' }, ...groups.map((g) => ({ id: g, label: g }))]} />
        {splitting && (
          <Dropdown label="Project" value={where} onChange={setWhere}
            options={[
              { id: 'all', label: 'All' },
              { id: GENERAL, label: 'Others' },
              ...projects.slice().sort((x, y) => projectName(x.id).localeCompare(projectName(y.id)))
                .map((p) => ({ id: p.id, label: projectName(p.id) })),
            ]} />
        )}
      </Toolbar>

      {/* ── the entries ── */}
      {filtered.length === 0 ? (
        <Panel>
          <Empty action={<Row gap={8} style={{ justifyContent: 'center' }}>
            <Btn primary onClick={() => record('in')}><ArrowDownLeft size={15} aria-hidden="true" /> Money in</Btn>
            <Btn onClick={() => record('out')}><ArrowUpRight size={15} aria-hidden="true" /> Money out</Btn>
          </Row>}>
            {rows.length === 0 ? (scope ? 'Nothing recorded against this project yet.' : 'Nothing in the general ledger yet.') : 'Nothing in this period or filter.'}
          </Empty>
        </Panel>
      ) : (
        <Table id="general-ledger" cols={[
          { key: 'd', label: 'Date', width: 110 },
          { key: 'e', label: 'Entry', always: true },
          { key: 'p', label: 'Party' },
          ...(splitting ? [{ key: 'pr', label: 'Project' }] : []),
          { key: 'co', label: 'Country', def: false },
          { key: 'm', label: 'Method' },
          { key: 'ca', label: 'Counts as' },
          { key: 'a', label: 'Amount', align: 'right', always: true },
          { key: 'x', label: '', width: 52, always: true },
        ]}>
          {(show) => pageRows.map((r) => {
            const tr = TREATMENTS[r.treatment];
            const linked = r.direction === 'in' && r.document_id;
            const billPaid = r.direction === 'out' && r.purchase_invoice_id;
            const isIn = r.direction === 'in';
            const meta = [
              ready ? categoryLabel(r.category) : r.category,
              Number(r.tax_amount) > 0 ? `${r.is_inter_state ? 'IGST' : 'GST'} ${money(r.tax_amount)}${Number(r.tax_rate) > 0 ? ` @ ${Number(r.tax_rate)}%` : ''}` : '',
              r.currency && r.currency !== 'INR' ? `${r.currency} ${Number(r.original_amount).toLocaleString('en-IN')} @ ${Number(r.fx_rate)}` : '',
              r.quantity ? `${Number(r.quantity).toLocaleString('en-IN')} ${r.unit || ''}`.trimEnd() : '',
              !isIn && r.department_id ? nameOf(departments, r.department_id) : '',
              !isIn && r.billable ? 're-billable' : '',
              isIn && r.catalog_item_id ? nameOf(catalog, r.catalog_item_id) : '',
              r.place_of_supply || '',
              r.reference || '',
              r._share < 1 ? `${where === GENERAL ? 'the general' : 'this project’s'} share of ${money(r._full.amount, 2)}` : '',
            ].filter(Boolean).join(' · ');
            const edit = () => setEditing({ ...r, ...(r._full || {}), _share: undefined, _full: undefined, date: r.day });
            return (
              <Tr key={`${r.direction}-${r.id}`} onClick={edit} label={`Edit ${r.description}`}>
                {show('d') && <Td muted nowrap>{fmtDate(r.day)}</Td>}
                {show('e') && (
                  <Td>
                    <Row gap={10} align="flex-start">
                      <span aria-hidden="true" style={{
                        width: 30, height: 30, borderRadius: 99, flexShrink: 0, display: 'grid', placeItems: 'center',
                        color: isIn ? t.up : t.down,
                        background: `color-mix(in srgb, ${isIn ? t.up : t.down} 12%, transparent)`,
                      }}>{isIn ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: 500 }}>{r.description}</span>
                        <span style={{ display: 'block', fontSize: 11.5, color: t.faint, marginTop: 2 }}>{meta}</span>
                      </span>
                    </Row>
                  </Td>
                )}
                {show('p') && <Td nowrap>{r.party || <span style={{ color: t.ghost }}>-</span>}</Td>}
                {show('pr') && <Td nowrap muted>{partsLabel(r)}</Td>}
                {show('co') && <Td nowrap muted>{r.country_code || '-'}</Td>}
                {show('m') && <Td nowrap muted>{methodLabel(r.payment_method)}</Td>}
                {show('ca') && (
                  <Td nowrap>
                    <span title={linked ? 'Recorded against an invoice, which already counts it'
                      : billPaid ? 'Pays a purchase bill, which already counts the cost and its GST' : tr?.note}>
                      <Status tone={r.status === 'pending' ? 'warn' : linked || billPaid ? 'accent' : isIn ? 'up' : 'neutral'}>
                        {r.status === 'pending' ? 'Not paid yet' : linked ? 'Invoice receipt' : billPaid ? 'Bill payment' : (tr?.label || r.treatment)}
                      </Status>
                    </span>
                  </Td>
                )}
                {show('a') && (
                  <Td align="right" nowrap>
                    <span style={{ fontSize: 14, fontWeight: 600, color: isIn ? t.up : t.down, opacity: r.status === 'pending' ? 0.6 : 1 }}>
                      {isIn ? '+' : '−'}{money(r.amount, 2)}
                    </span>
                  </Td>
                )}
                {show('x') && (
                  <Td nowrap>
                    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <RowMenu label={`Actions for ${r.description}`} items={[
                        r.receipt_path && { label: 'View receipt', icon: Paperclip, onClick: () => receiptService.open(r.receipt_path) },
                        { label: 'Edit', icon: Pencil, onClick: edit },
                        { label: 'Delete', icon: Trash2, tone: 'danger', onClick: () => handleDelete(r) },
                      ]} />
                    </span>
                  </Td>
                )}
              </Tr>
            );
          })}
        </Table>
      )}

      {filtered.length > PAGE_SIZE && (
        <Pager t={t} page={page} pageCount={pageCount} total={filtered.length} onPage={setPage} />
      )}

      {/* ── where it went, by project: also a filter ── */}
      {splitting && byWhere.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Panel title="Where the money went" note={periodText}>
            <div style={{ display: 'grid' }}>
              {byWhere.map((b) => {
                const general = b.key === GENERAL;
                const active = where === b.key;
                const peak = Math.max(1, ...byWhere.map((x) => Math.max(x.moneyIn, x.moneyOut)));
                return (
                  <button key={b.key} type="button" aria-pressed={active} className="edge-tr"
                    onClick={() => setWhere(active ? 'all' : b.key)}
                    style={{
                      display: 'grid', gridTemplateColumns: 'minmax(140px, 1.4fr) minmax(120px, 2fr) repeat(3, minmax(90px, auto))',
                      alignItems: 'center', gap: 16, width: '100%', textAlign: 'left', padding: '12px 16px',
                      border: 'none', borderBottom: '1px solid ' + t.line, cursor: 'pointer', fontFamily: 'inherit', color: t.text,
                      background: active ? t.accentSoft : 'transparent',
                    }}>
                    <span style={{ fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {general ? 'Others' : projectName(b.key)}
                      <span style={{ display: 'block', fontSize: 11.5, color: t.faint, fontWeight: 400 }}>{b.entries} {b.entries === 1 ? 'entry' : 'entries'}</span>
                    </span>
                    <span style={{ display: 'grid', gap: 4 }}>
                      <Bar value={b.moneyIn} max={peak} height={6} tone={t.up} />
                      <Bar value={b.moneyOut} max={peak} height={6} tone={t.down} />
                    </span>
                    <span style={{ textAlign: 'right', fontSize: 13, color: t.up, fontVariantNumeric: 'tabular-nums' }}>+{money(b.moneyIn, 2)}</span>
                    <span style={{ textAlign: 'right', fontSize: 13, color: t.down, fontVariantNumeric: 'tabular-nums' }}>−{money(b.moneyOut, 2)}</span>
                    <span style={{ textAlign: 'right', fontSize: 13.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: b.net < 0 ? t.down : t.text }}>{money(b.net, 2)}</span>
                  </button>
                );
              })}
            </div>
          </Panel>
        </div>
      )}

      {editing && (
        <CashEntryModal key={editing.id || 'new'} entry={editing} fresh={fresh} onClose={() => setEditing(null)} />
      )}

      <style>{`
        .gl-bento { display: grid; gap: 12px; margin-bottom: 12px;
          grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr);
          grid-template-areas: "rec in out" "rec net net"; }
        @media (max-width: 980px) {
          .gl-bento { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "rec rec" "in out" "net net"; }
        }
        @media (max-width: 560px) {
          .gl-bento { grid-template-columns: minmax(0, 1fr); grid-template-areas: "rec" "in" "out" "net"; }
        }
        .gl-rec-btn { transition: transform .18s cubic-bezier(.16,1,.3,1), box-shadow .18s, border-color .18s; }
        .gl-rec-btn:hover { transform: translateY(-2px); }
        .gl-flow { transition: border-color .15s, transform .18s cubic-bezier(.16,1,.3,1); }
        .gl-flow:hover { transform: translateY(-2px); border-color: ${t.lineStrong} !important; }
        @media (prefers-reduced-motion: reduce) { .gl-rec-btn:hover, .gl-flow:hover { transform: none; } }
      `}</style>
    </Page>
  );
}

/** One side of "Record money": a large target in the side's colour. */
function RecordBtn({ t, tone, icon: Icon, label, note, onClick }) {
  return (
    <button type="button" onClick={onClick} className="gl-rec-btn" style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px', borderRadius: 14, cursor: 'pointer',
      textAlign: 'left', fontFamily: 'inherit', color: t.text,
      background: `color-mix(in srgb, ${tone} ${t.isDark ? 12 : 7}%, ${t.card})`,
      border: `1px solid color-mix(in srgb, ${tone} 30%, transparent)`,
      boxShadow: `${t.highlight}, 0 10px 24px -18px ${tone}`,
    }}>
      <span aria-hidden="true" style={{
        width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'grid', placeItems: 'center',
        background: tone, color: '#fff', boxShadow: `inset 0 1px 0 rgba(255,255,255,.25), 0 6px 14px -6px ${tone}`,
      }}><Icon size={18} /></span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12, color: t.faint, marginTop: 2 }}>{note}</span>
      </span>
    </button>
  );
}

/** A total that doubles as the In / Out filter. */
function FlowTile({ t, area, icon: Icon, tone, label, value, note, active, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className="gl-flow" style={{
      gridArea: area, textAlign: 'left', fontFamily: 'inherit', color: t.text, cursor: 'pointer', minWidth: 0,
      padding: '16px 18px', borderRadius: 18, background: active ? `color-mix(in srgb, ${tone} 7%, ${t.card})` : t.card,
      border: '1px solid ' + (active ? `color-mix(in srgb, ${tone} 45%, transparent)` : t.line), boxShadow: t.highlight,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span aria-hidden="true" style={{
          width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center', color: tone,
          background: `color-mix(in srgb, ${tone} 12%, transparent)`,
        }}><Icon size={14} /></span>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: t.dim, flex: 1 }}>{label}</span>
        {active && <span style={{ fontSize: 11.5, color: tone, fontWeight: 500 }}>Filtering</span>}
      </span>
      <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1, color: tone, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      <span style={{ fontSize: 12, color: t.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{note}</span>
    </button>
  );
}

// 1 … 4 5 6 … 12. The first, last and neighbours of the current page.
function pageList(page, count) {
  const keep = new Set([1, count, page - 1, page, page + 1].filter((n) => n >= 1 && n <= count));
  const out = [];
  [...keep].sort((a, b) => a - b).forEach((n, i, arr) => {
    if (i > 0 && n - arr[i - 1] > 1) out.push(`gap${n}`);
    out.push(n);
  });
  return out;
}

function Pager({ t, page, pageCount, total, onPage }) {
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  return (
    <nav aria-label="General ledger pages"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
      <span style={{ fontSize: 12.5, color: t.faint }} aria-live="polite">
        Showing {first}–{last} of {total} entries
      </span>
      <Row gap={4}>
        <Btn size="sm" onClick={() => onPage(page - 1)} disabled={page === 1}>
          <ChevronLeft size={15} aria-hidden="true" /> Previous
        </Btn>
        {pageList(page, pageCount).map((n) => (typeof n === 'string'
          ? <span key={n} aria-hidden="true" style={{ padding: '0 4px', color: t.faint }}>…</span>
          : <Btn key={n} size="sm" primary={n === page} aria-label={`Page ${n}`} aria-current={n === page ? 'page' : undefined}
              onClick={() => onPage(n)} style={{ minWidth: 30, padding: 0 }}>{n}</Btn>))}
        <Btn size="sm" onClick={() => onPage(page + 1)} disabled={page === pageCount}>
          Next <ChevronRight size={15} aria-hidden="true" />
        </Btn>
      </Row>
    </nav>
  );
}
