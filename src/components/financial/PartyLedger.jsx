import { useCallback, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Scale, FilePlus, Receipt, HandCoins } from 'lucide-react';
import { Stat } from './financeUi';
import { useSection, money } from './financeHooks';
import CashEntryModal from './CashEntryModal';
import ClientInvoicePanel from './ClientInvoicePanel';
import { RecordMoneyCard } from './CashBook';
import { blank } from './cashEntry';
import { useT } from '../ui/edgeUtils';
import { pickerFor } from '../../services/projectService';
import { ProjectLedger } from '../projects/ProjectFinance';
import { initialQuery } from '../../services/urlQuery';
import { LedgerBar } from './ledgerBar';
import { projectChoices, useLedgerPeriod } from './ledgerPeriod';

// The Client General Ledger's two buttons, named for what they do there.
const CLIENT_LABELS = {
  in: {
    label: 'Create/Upload Client Invoice', icon: FilePlus,
    note: 'Create a sales invoice or upload an externally generated invoice. Capture client, invoice number, dates, line items, revenue account, tax, currency, and payment terms.',
  },
  out: {
    label: 'Record Receipt', icon: HandCoins,
    note: 'Match money received against one or more invoices. Support partial receipts, multiple-invoice allocations, bank references, and unapplied customer advances.',
  },
};

/**
 * The Client General Ledger: Clients' (company-wide) and a project's Client
 * group's (with `projectId`). The Company Ledger was folded into it
 * (2026-10-25): an invoice is the debit, what the client owes; a receipt (a
 * General Ledger entry, or a payment recorded on the invoice in Billing) is
 * the credit; the balance is what is still outstanding.
 *
 * Nothing here is its own data: it is the same ledger as Financials', kept to
 * a client's rows (ProjectLedger `party`), so an entry edited or deleted here
 * changes everywhere.
 */
export default function PartyLedger({ party = 'client', projectId = null, onOpen }) {
  const t = useT();
  const clients = useSection('customers');
  const projects = useSection('projects');
  const clientLinks = useSection('project_clients');
  const income = useSection('income_entries');
  const expenses = useSection('expenses');

  const project = projectId ? projects.find((p) => p.id === projectId) || null : null;

  const [search, setSearch] = useState(initialQuery);
  const [view, setView] = useState('all');
  const period = useLedgerPeriod();
  const [partyId, setPartyId] = useState('all');
  // Company-wide: 'all', 'general' (on no project) or one project's id.
  const [projectFilter, setProjectFilter] = useState('all');
  const filterProject = !projectId && projectFilter !== 'all' && projectFilter !== 'general'
    ? projects.find((p) => p.id === projectFilter) || null : null;
  const startOn = projectId || filterProject?.id || null;
  const [totals, setTotals] = useState(null);
  const [entry, setEntry] = useState(null);
  const [invoicing, setInvoicing] = useState(false);

  // Inside a project the filter lists only its clients.
  const choices = useMemo(() => {
    if (!projectId) return clients;
    const ids = new Set(clientLinks.filter((l) => l.project_id === projectId).map((l) => l.client_id));
    if (project?.client_id) ids.add(project.client_id);
    return clients.filter((c) => ids.has(c.id));
  }, [projectId, project, clients, clientLinks]);
  const chosen = partyId === 'all' ? '' : partyId;
  // A new receipt is from the client filtered to; in a project, its client.
  const forClient = chosen || (project || filterProject)?.client_id || '';

  const freshEntry = useCallback((direction) => ({
    ...blank(direction),
    ...(startOn ? { _picker: pickerFor(startOn) } : {}),
    client_id: forClient,
  }), [startOn, forClient]);

  // Create/Upload Client Invoice asks which (ClientInvoicePanel); Record
  // Receipt is money in from the client.
  const record = (side) => {
    if (side === 'in') setInvoicing(true);
    else setEntry(freshEntry('in'));
  };
  const editEntry = (direction, id) => {
    const r = (direction === 'in' ? income : expenses).find((x) => x.id === id);
    if (r) setEntry({ ...r, direction, date: r.date || r.received_on || r.incurred_on });
  };

  // What was recorded last with a client, the newest first.
  const recent = useMemo(() => {
    const ids = projectId ? new Set(choices.map((c) => c.id)) : null;
    const mine = (e) => !!e.client_id && !e.vendor_id && (!ids || ids.has(e.client_id));
    return [
      ...income.filter(mine).map((e) => ({ ...e, direction: 'in', day: e.date || e.received_on })),
      ...expenses.filter((e) => mine(e) && !e.employee_id).map((e) => ({ ...e, direction: 'out', day: e.date || e.incurred_on })),
    ].sort((a, b) => String(b.day).localeCompare(String(a.day))).slice(0, 3);
  }, [income, expenses, projectId, choices]);

  const toolbar = (
    <LedgerBar search={search} onSearch={setSearch} view={view} onView={setView} period={period}
      placeholder="Search client, invoice no., receipt no..."
      selects={[
        !projectId && { label: 'Filter by project', value: projectFilter, onChange: setProjectFilter, options: projectChoices(projects, projectFilter) },
        {
          label: 'Filter by client', value: partyId, onChange: setPartyId,
          options: [['all', 'All clients'], ...choices.filter((p) => !p.archived_at || p.id === partyId).map((p) => [p.id, p.name])],
        },
      ].filter(Boolean)} />
  );
  const ledgerProps = {
    party, partyId: chosen || null, onEdit: editEntry, onTotals: setTotals, onOpen, toolbar,
    only: 'sales', here: 'client-general',
    narrow: { view, search, from: period.range.from, to: period.range.to },
    emptyText: search.trim() || view !== 'all' || chosen || period.preset !== 'all' ? 'Nothing matches these filters.' : undefined,
  };
  // Until the project is loaded; without it the ledger would be the company's.
  if (projectId && !project) return null;

  // An invoice is the debit side here, a receipt the credit.
  const flip = (side) => setView(view === side ? 'all' : side);
  const outstanding = totals?.balance || 0;
  return (
    <div style={{ maxWidth: '100%' }}>
      <RecordMoneyCard t={t} scoped recent={recent} onRecord={record} style={{ marginBottom: 12 }} labels={CLIENT_LABELS}
        emptyText="Nothing yet. Create an invoice or record a receipt to start the ledger."
        onOpen={(r) => editEntry(r.direction, r.id)} />

      <div className="prod-stats">
        <Stat icon={<ArrowUpRight size={15} />} label="Invoiced" value={money(totals?.debit || 0, 2)}
          sub={view === 'out' ? 'Showing debit only' : undefined} onClick={() => flip('out')} />
        <Stat icon={<ArrowDownLeft size={15} />} label="Received" value={money(totals?.credit || 0, 2)}
          sub={view === 'in' ? 'Showing credit only' : undefined} onClick={() => flip('in')} />
        <Stat icon={<Scale size={15} />} label={outstanding < 0 ? 'Received in Advance' : 'Outstanding'}
          value={money(Math.abs(outstanding), 2)} accent="var(--text-primary)" />
        <Stat icon={<Receipt size={15} />} label="GST on Invoices" value={money(totals?.tax || 0, 2)} />
      </div>

      {projectId
        ? <ProjectLedger key={projectId} project={project} {...ledgerProps} />
        : filterProject ? <ProjectLedger key={filterProject.id} project={filterProject} {...ledgerProps} />
          : <ProjectLedger general={projectFilter === 'general'} {...ledgerProps} />}

      {entry && <CashEntryModal key={entry.id || `new-${entry.direction}`} entry={entry} fresh={freshEntry} projectId={projectId} party={party}
        onClose={() => setEntry(null)} />}
      {invoicing && <ClientInvoicePanel clients={choices} clientId={forClient} projectId={projectId} startOn={startOn}
        onClose={() => setInvoicing(false)} />}
    </div>
  );
}
