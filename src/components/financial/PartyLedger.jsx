import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, ArrowDownLeft, ArrowUpRight, Scale, FilePlus } from 'lucide-react';
import { Stat } from './financeUi';
import { useSection, money } from './financeHooks';
import CashEntryModal from './CashEntryModal';
import VendorPaymentModal from './VendorPaymentModal';
import { blank } from './cashEntry';
import { useSettledVendorBills } from './vendorAdvance';
import { Btn, Row } from '../ui/edge';
import { pickerFor } from '../../services/projectService';
import { projectSectionPath } from '../projects/projectPaths';
import { ProjectLedger } from '../projects/ProjectFinance';
import { initialQuery } from '../../services/urlQuery';

const FILTERS = [['all', 'All'], ['in', 'Credit'], ['out', 'Debit']];

// What each ledger's three tiles say. On the Client Company Ledger an invoice
// is the debit (owed to us) and the balance what is still to come in; on the
// Vendor Company Ledger a bill is the credit and the balance what is payable.
const TILES = {
  'client-company': { debit: 'Invoiced', credit: 'Received', balance: 'Outstanding' },
  'client-general': { credit: 'Received', debit: 'Paid Out', balance: 'Net' },
  'vendor-company': { credit: 'Billed', debit: 'Paid', balance: 'Payable' },
  'vendor-general': { credit: 'Received Back', debit: 'Paid', balance: 'Net' },
};

/**
 * The Client and Vendor ledgers: one side of the company's money at a time,
 * a page of Business (company-wide) and of a project's Client and Vendor
 * groups (with `projectId`). `party` is 'client' or 'vendor'; `book` is
 * 'company' (with the invoices or bills) or 'general' (money that moved only).
 *
 * Nothing here is its own data: it is the same ledger as Finance's, kept to
 * the rows of one side (ProjectLedger `party`), so an entry edited or deleted
 * here changes everywhere. Both sides have both columns: a client pays in and
 * can be paid back; a vendor is paid and can pay back (0098).
 */
export default function PartyLedger({ party, book, projectId = null, onOpen }) {
  const navigate = useNavigate();
  const clients = useSection('customers');
  const vendors = useSection('vendors');
  const projects = useSection('projects');
  const clientLinks = useSection('project_clients');
  const vendorLinks = useSection('project_vendors');
  const income = useSection('income_entries');
  const expenses = useSection('expenses');
  // Each bill's amount paid is worked out from its vendor's totals.
  useSettledVendorBills();

  const isClient = party === 'client';
  const project = projectId ? projects.find((p) => p.id === projectId) || null : null;

  const [search, setSearch] = useState(initialQuery);
  const [view, setView] = useState('all');
  const [partyId, setPartyId] = useState('all');
  // Company-wide: 'all', 'general' (on no project) or one project's id.
  const [projectFilter, setProjectFilter] = useState('all');
  const filterProject = !projectId && projectFilter !== 'all' && projectFilter !== 'general'
    ? projects.find((p) => p.id === projectFilter) || null : null;
  const startOn = projectId || filterProject?.id || null;
  const [totals, setTotals] = useState(null);
  const [entry, setEntry] = useState(null);
  const [payingVendor, setPayingVendor] = useState(null);

  // Inside a project the filter lists only its clients or vendors.
  const choices = useMemo(() => {
    if (isClient) {
      if (!projectId) return clients;
      const ids = new Set(clientLinks.filter((l) => l.project_id === projectId).map((l) => l.client_id));
      if (project?.client_id) ids.add(project.client_id);
      return clients.filter((c) => ids.has(c.id));
    }
    if (!projectId) return vendors;
    const ids = new Set(vendorLinks.filter((l) => l.project_id === projectId).map((l) => l.vendor_id));
    return vendors.filter((v) => ids.has(v.id));
  }, [isClient, projectId, project, clients, vendors, clientLinks, vendorLinks]);
  const chosen = partyId === 'all' ? '' : partyId;
  // A new entry is the client's or vendor's filtered to; in a project, its client.
  const forClient = chosen || (isClient ? (project || filterProject)?.client_id || '' : '');

  const freshEntry = useCallback((direction) => ({
    ...blank(direction),
    ...(startOn ? { _picker: pickerFor(startOn) } : {}),
    ...(isClient ? { client_id: forClient }
      // Money back from a vendor is a refund unless they say otherwise.
      : direction === 'in' ? { vendor_id: chosen, category: 'vendor_refund' } : {}),
  }), [startOn, isClient, forClient, chosen]);

  // Paying a vendor is the Debit form for vendors; everything else is a plain entry.
  const record = (direction) => {
    if (!isClient && direction === 'out') setPayingVendor({ vendorId: chosen });
    else setEntry(freshEntry(direction));
  };
  // The Company Ledgers also raise what they are made of: an invoice, a bill.
  const raise = () => {
    if (isClient) {
      navigate('/clients/billing/invoices/new', { state: { projectId: startOn, clientId: forClient || undefined } });
      return;
    }
    const q = new URLSearchParams({ new: '1', ...(chosen ? { vendor: chosen } : {}) });
    navigate(projectId
      ? `${projectSectionPath(projectId, 'bills')}?${q}`
      : `/financials/company-ledger?${q}${filterProject ? `&project=${filterProject.id}` : ''}`);
  };
  const editEntry = (direction, id) => {
    const r = (direction === 'in' ? income : expenses).find((x) => x.id === id);
    if (r) setEntry({ ...r, direction, date: r.date || r.received_on || r.incurred_on });
  };

  const tiles = TILES[`${party}-${book}`];
  const ledgerProps = {
    party, partyId: chosen || null, onEdit: editEntry, onTotals: setTotals, onOpen,
    only: book === 'company' ? (isClient ? 'sales' : 'purchases') : undefined,
    here: `${party}-${book}`,
    narrow: { view, search },
    emptyText: search.trim() || view !== 'all' || chosen ? 'Nothing matches these filters.' : undefined,
  };
  const who = isClient ? 'client' : 'vendor';
  // Until the project is loaded; without it the ledger would be the company's.
  if (projectId && !project) return null;

  return (
    <div style={{ maxWidth: '100%' }}>
      <Row gap={8} wrap style={{ marginBottom: 12 }}>
        <Btn onClick={() => record('in')}><ArrowDownLeft size={15} aria-hidden="true" /> Record Credit</Btn>
        <Btn onClick={() => record('out')}><ArrowUpRight size={15} aria-hidden="true" /> {isClient ? 'Record Debit' : 'Pay Vendor'}</Btn>
        {book === 'company' && (
          <Btn primary onClick={raise}><FilePlus size={15} aria-hidden="true" /> {isClient ? 'New Invoice' : 'Record Bill'}</Btn>
        )}
      </Row>

      <div className="prod-stats">
        {/* A tile keeps its side of the ledger; clicked again, both. */}
        {(isClient && book === 'company' ? ['debit', 'credit'] : ['credit', 'debit']).map((k) => {
          const side = k === 'credit' ? 'in' : 'out';
          return (
            <Stat key={k} icon={k === 'credit' ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
              label={tiles[k]} value={money(totals?.[k] || 0)} onClick={() => setView(view === side ? 'all' : side)} />
          );
        })}
        <Stat icon={<Scale size={15} />} label={tiles.balance} value={money(totals?.balance || 0)} accent="var(--text-primary)" />
      </div>

      <div className="prod-toolbar">
        <div className="prod-search">
          <Search size={14} />
          <input aria-label="Search the ledger" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${who}, invoice no., receipt no., type...`} />
          {search && <button type="button" onClick={() => setSearch('')} className="prod-search-clear" aria-label="Clear search" title="Clear search"><X size={13} /></button>}
        </div>
        {!projectId && (
          <select aria-label="Filter by project" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="prod-select">
            <option value="all">All projects</option>
            <option value="general">General (no project)</option>
            {projects.filter((p) => !p.archived_at || p.id === projectFilter).map((p) => (
              <option key={p.id} value={p.id}>{[p.code, p.name].filter(Boolean).join(' · ')}</option>
            ))}
          </select>
        )}
        <select aria-label={`Filter by ${who}`} value={partyId} onChange={(e) => setPartyId(e.target.value)} className="prod-select">
          <option value="all">{isClient ? 'All clients' : 'All vendors'}</option>
          {choices.filter((p) => !p.archived_at || p.id === partyId).map((p) => (
            <option key={p.id} value={p.id}>{isClient ? p.name : p.company_name}</option>
          ))}
        </select>
        <div className="prod-seg" role="group" aria-label="Ledger side">
          {FILTERS.map(([f, label]) => (
            <button key={f} aria-pressed={view === f} className={`pro-chip ${view === f ? 'active' : ''}`} onClick={() => setView(f)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {projectId
        ? <ProjectLedger key={projectId} project={project} {...ledgerProps} />
        : filterProject ? <ProjectLedger key={filterProject.id} project={filterProject} {...ledgerProps} />
          : <ProjectLedger general={projectFilter === 'general'} {...ledgerProps} />}

      {entry && <CashEntryModal key={entry.id || `new-${entry.direction}`} entry={entry} fresh={freshEntry} projectId={projectId} party={party}
        onClose={() => setEntry(null)} />}
      {payingVendor && (
        <VendorPaymentModal vendorId={payingVendor.vendorId} startOn={startOn} projectId={projectId}
          onClose={() => setPayingVendor(null)} />
      )}
    </div>
  );
}
