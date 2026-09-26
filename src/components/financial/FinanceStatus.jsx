import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, ChevronDown, ChevronUp,
  FileText, FilePlus, FileCheck, Receipt, CheckCircle,
  Copy, Building, Filter, Hourglass, Users, TrendingUp,
} from 'lucide-react';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { documentStore, docNumber as docNo } from '../../services/documentStore';
import { useOrg } from '../../context/OrgContext';
import DocumentStatusBadge from '../shared/DocumentStatusBadge';
import { ShareLinkModal } from '../shared/PortalLinkGenerator';
import PaymentPositionCards from './PaymentPositionCards';
import {
  issuedInvoices, balanceOf, isOverdue, daysOverdue, todayIso,
} from '../../services/financeAnalytics';

const TYPE_CONFIG = {
  quotation: { label: 'Quotation', icon: FilePlus, color: '#3b82f6', prefix: 'QUO' },
  proforma: { label: 'Proforma', icon: FileCheck, color: '#8b5cf6', prefix: 'PI' },
  invoice: { label: 'Invoice', icon: Receipt, color: '#10b981', prefix: 'INV' },
};

// Lifecycle statuses, coloured once so the pie, the badges and the ageing
// chart tell the same story. Anything unmapped falls back to neutral grey.
const STATUS_COLORS = {
  draft: '#94a3b8', sent: '#3b82f6', viewed: '#6366f1',
  payment_submitted: '#0ea5e9', partially_paid: '#f59e0b',
  paid: '#10b981', overdue: '#ef4444', converted: '#8b5cf6',
  cancelled: '#71717a', declined: '#71717a', expired: '#71717a',
};

const AGEING_BUCKETS = [
  { label: 'Not yet due', color: '#10b981' },
  { label: '1–30 days', color: '#f59e0b' },
  { label: '31–60 days', color: '#f97316' },
  { label: '61–90 days', color: '#ef4444' },
  { label: '90+ days', color: '#b91c1c' },
];

const STATUS_LABEL = (s) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const inr = (v) => '₹' + Math.round(Number(v) || 0).toLocaleString('en-IN');

// Recharts reads its colours from the theme tokens so the charts follow
// light/dark like every other surface, rather than baking in one palette.
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const chartStyles = () => ({
  tooltip: { background: css('--chart-tooltip-bg'), border: `1px solid ${css('--chart-tooltip-border')}`, borderRadius: 10, fontSize: 12, color: css('--chart-tooltip-text') },
  label: { color: css('--chart-axis-text') },
  axis: { fill: css('--chart-axis-text'), fontSize: 11 },
  grid: css('--chart-grid'),
});

const PIPELINE_STAGES = [
  { key: 'quotation', label: 'Quotation' },
  { key: 'proforma', label: 'Proforma' },
  { key: 'invoice', label: 'Invoice' },
  { key: 'paid', label: 'Paid' },
];

function getStageIndex(doc) {
  if (doc.type === 'invoice' && doc.status === 'paid') return 3;
  if (doc.type === 'invoice') return 2;
  if (doc.type === 'proforma') return 1;
  return 0;
}

function groupByClient(docs) {
  const groups = {};
  docs.forEach((doc) => {
    const clientKey = doc.client?.company || doc.issued_to || 'Unknown';
    if (!groups[clientKey]) {
      groups[clientKey] = {
        client: clientKey,
        clientName: doc.client?.name || doc.issued_to || 'Unknown',
        documents: [],
        totalValue: 0,
        latestStatus: doc.status,
        latestDate: doc.created_at,
        highestStage: getStageIndex(doc),
      };
    }
    groups[clientKey].documents.push(doc);
    if (doc.status !== 'converted') {
      groups[clientKey].totalValue += (doc.grand_total || doc.amount || doc.subtotal || 0);
    }
    if (new Date(doc.created_at) > new Date(groups[clientKey].latestDate)) {
      groups[clientKey].latestDate = doc.created_at;
      groups[clientKey].latestStatus = doc.status;
    }
    const stage = getStageIndex(doc);
    if (stage > groups[clientKey].highestStage) {
      groups[clientKey].highestStage = stage;
    }
  });
  return Object.values(groups).sort((a, b) => new Date(b.latestDate) - new Date(a.latestDate));
}

export default function FinanceStatus() {
  const { activeOrg } = useOrg();
  const [documents, setDocuments] = useState([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('date_desc');
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedClient, setExpandedClient] = useState(null);
  const [showPortalLink, setShowPortalLink] = useState(null);
  const [viewMode, setViewMode] = useState('pipeline'); // 'pipeline' | 'list'

  const loadDocuments = async () => {
    if (activeOrg?.id) {
      documentStore.setContext(activeOrg.id);
      await documentStore.init();
    }
    const all = documentStore.getAll();
    const financial = all.filter((d) => ['invoice', 'quotation', 'proforma'].includes(d.type));
    setDocuments(financial);
  };

  // Above the effect deliberately: referencing a `const` declared further down
  // is a temporal-dead-zone read that survives only because effects run late.
  useEffect(() => {
    loadDocuments();
  }, [activeOrg]);


  const filteredDocs = useMemo(() => {
    const filtered = documents.filter((d) => {
      const matchesSearch = !search ||
        d.id.toLowerCase().includes(search.toLowerCase()) ||
        (d.issued_to || '').toLowerCase().includes(search.toLowerCase()) ||
        (d.client?.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (d.client?.company || '').toLowerCase().includes(search.toLowerCase());
      const matchesType = typeFilter === 'all' || d.type === typeFilter;
      return matchesSearch && matchesType;
    });
    return [...filtered].sort((a, b) => {
      const dateA = new Date(a.created_at || a.issue_date || 0);
      const dateB = new Date(b.created_at || b.issue_date || 0);
      const amtA = a.grand_total || a.amount || a.subtotal || 0;
      const amtB = b.grand_total || b.amount || b.subtotal || 0;
      if (sortBy === 'date_desc')    return dateB - dateA;
      if (sortBy === 'date_asc')     return dateA - dateB;
      if (sortBy === 'amount_desc')  return amtB - amtA;
      if (sortBy === 'amount_asc')   return amtA - amtB;
      if (sortBy === 'client')       return (a.issued_to || a.client?.name || '').localeCompare(b.issued_to || b.client?.name || '');
      if (sortBy === 'status')       return (a.status || '').localeCompare(b.status || '');
      return 0;
    });
  }, [documents, search, typeFilter, sortBy]);

  const clientGroups = useMemo(() => groupByClient(filteredDocs), [filteredDocs]);

  // ── Dashboard analytics ────────────────────────────────────────────────────
  // All of it reads `documents` (everything, unfiltered) rather than
  // `filteredDocs`: the search box narrows the list underneath, it does not
  // change what the business is owed. Money figures come from the same helpers
  // the Invoices page and the P&L use, so the four pages cannot disagree.

  /** Quotation → Proforma → Invoice → Paid, by count and by value. */
  const funnel = useMemo(() => {
    const live = issuedInvoices(documents);
    const stage = (type) => documents.filter((d) => d.type === type);
    const sum = (list) => list.reduce((t, d) => t + (d.grand_total || d.amount || d.subtotal || 0), 0);
    const quotes = stage('quotation');
    const proformas = stage('proforma');
    const paid = live.filter((d) => d.status === 'paid');
    return [
      { key: 'quotation', label: 'Quotations', color: '#3b82f6', count: quotes.length, value: sum(quotes) },
      { key: 'proforma', label: 'Proforma', color: '#8b5cf6', count: proformas.length, value: sum(proformas) },
      { key: 'invoice', label: 'Invoices', color: '#10b981', count: live.length, value: sum(live) },
      { key: 'paid', label: 'Paid', color: '#059669', count: paid.length, value: live.reduce((t, d) => t + (Number(d.amount_paid) || 0), 0) },
    ];
  }, [documents]);

  const funnelMax = Math.max(...funnel.map((f) => f.value), 1);
  const winRate = funnel[0].count > 0 ? Math.round((funnel[2].count / funnel[0].count) * 100) : null;

  /** How the documents are spread across their lifecycle statuses. */
  const statusMix = useMemo(() => {
    const counts = {};
    documents.forEach((d) => { counts[d.status || 'draft'] = (counts[d.status || 'draft'] || 0) + 1; });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value, color: STATUS_COLORS[name] || '#6b7280' }))
      .sort((a, b) => b.value - a.value);
  }, [documents]);

  /** Six calendar months of invoices issued against what came back on them. */
  const monthly = useMemo(() => {
    const live = issuedInvoices(documents);
    const now = new Date();
    const out = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const inMonth = live.filter((doc) => {
        const dt = new Date(doc.issue_date || doc.created_at || 0);
        return dt.getMonth() === d.getMonth() && dt.getFullYear() === d.getFullYear();
      });
      out.push({
        month: d.toLocaleDateString('en-IN', { month: 'short' }),
        issued: Math.round(inMonth.reduce((t, doc) => t + (Number(doc.grand_total) || 0), 0)),
        collected: Math.round(inMonth.reduce((t, doc) => t + (Number(doc.amount_paid) || 0), 0)),
      });
    }
    return out;
  }, [documents]);

  /** Outstanding balance bucketed by how long it has been late. */
  const ageing = useMemo(() => {
    const today = todayIso();
    const buckets = AGEING_BUCKETS.map((b) => ({ ...b, value: 0, count: 0 }));
    issuedInvoices(documents).forEach((d) => {
      const bal = balanceOf(d);
      if (bal <= 0.009) return;
      const days = isOverdue(d, today) ? daysOverdue(d, today) : 0;
      const idx = days === 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
      buckets[idx].value += bal;
      buckets[idx].count += 1;
    });
    return buckets;
  }, [documents]);

  const ageingTotal = ageing.reduce((t, b) => t + b.value, 0);

  /** Who owes the most right now — the collections call list, in order. */
  const topDebtors = useMemo(() => {
    const byClient = {};
    issuedInvoices(documents).forEach((d) => {
      const bal = balanceOf(d);
      if (bal <= 0.009) return;
      const key = d.client?.company || d.issued_to || 'Unknown';
      if (!byClient[key]) byClient[key] = { client: key, outstanding: 0, count: 0, overdue: 0 };
      byClient[key].outstanding += bal;
      byClient[key].count += 1;
      if (isOverdue(d)) byClient[key].overdue += bal;
    });
    return Object.values(byClient).sort((a, b) => b.outstanding - a.outstanding).slice(0, 5);
  }, [documents]);

  const debtorMax = topDebtors[0]?.outstanding || 0;

  const toggleClient = (client) => {
    setExpandedClient(expandedClient === client ? null : client);
  };

  return (
    <div className="finance-page animate-in">
      {/* Where the money stands — balances, and each card drills into the
          invoices behind it. */}
      <PaymentPositionCards />

      {/* Pipeline funnel + status mix */}
      <div className="pro-two-col">
        <div className="pro-card">
          <div className="pro-card-header">
            <div className="pro-card-title-group">
              <Filter size={18} style={{ color: 'var(--blue)' }} />
              <h3>Document Pipeline</h3>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {winRate === null ? 'No quotations yet' : `${winRate}% reach an invoice`}
            </span>
          </div>
          {documents.length === 0 ? (
            <div className="pro-empty" style={{ padding: '3rem' }}>
              <FileText size={36} strokeWidth={1} />
              <p>Nothing in the pipeline</p>
              <span>Quotations, proforma invoices and invoices appear here as you issue them.</span>
            </div>
          ) : (
            <div className="billing-breakdown">
              {funnel.map((f) => (
                <div key={f.key} className="billing-breakdown-item">
                  <div className="billing-breakdown-info">
                    <span className="billing-breakdown-cat">{f.label} · {f.count}</span>
                    <span className="billing-breakdown-amount">{inr(f.value)}</span>
                  </div>
                  <div className="billing-breakdown-bar">
                    <div
                      className="billing-breakdown-fill"
                      style={{ width: `${Math.max((f.value / funnelMax) * 100, f.value > 0 ? 2 : 0)}%`, background: f.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pro-card">
          <div className="pro-card-header">
            <div className="pro-card-title-group">
              <CheckCircle size={18} style={{ color: 'var(--text-primary)' }} />
              <h3>Status Mix</h3>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {documents.length} document{documents.length === 1 ? '' : 's'}
            </span>
          </div>
          {statusMix.length === 0 ? (
            <div className="pro-empty" style={{ padding: '3rem' }}>
              <Receipt size={36} strokeWidth={1} />
              <p>No documents yet</p>
              <span>Once you issue something, its lifecycle shows up here.</span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ width: '55%', height: 240 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={statusMix} cx="50%" cy="50%" innerRadius={48} outerRadius={78} paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {statusMix.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={chartStyles().tooltip}
                      formatter={(v, name) => [`${v} document${v === 1 ? '' : 's'}`, STATUS_LABEL(name)]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', flex: 1 }}>
                {statusMix.map((d) => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', flex: 1 }}>{STATUS_LABEL(d.name)}</span>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)' }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Issued vs collected. `collected` is what came back on the invoices
          issued in that month, not cash received in it — an invoice paid late
          still counts against the month it was raised, which is the only way
          the bars answer "did that month's billing convert?". */}
      <div className="pro-card">
        <div className="pro-card-header">
          <div className="pro-card-title-group">
            <TrendingUp size={18} style={{ color: 'var(--success)' }} />
            <h3>Invoiced vs Collected</h3>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Last 6 months</span>
        </div>
        <div style={{ width: '100%', height: 260, marginTop: '0.5rem' }}>
          <ResponsiveContainer>
            <BarChart data={monthly} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartStyles().grid} />
              <XAxis dataKey="month" tick={chartStyles().axis} axisLine={false} tickLine={false} />
              <YAxis tick={chartStyles().axis} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
              <Tooltip
                contentStyle={chartStyles().tooltip}
                labelStyle={chartStyles().label}
                formatter={(v, name) => [inr(v), name === 'issued' ? 'Invoiced' : 'Collected']}
              />
              <Legend
                iconType="circle" iconSize={8}
                wrapperStyle={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}
                formatter={(value) => (value === 'issued' ? 'Invoiced' : 'Collected')}
              />
              <Bar dataKey="issued" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={32} />
              <Bar dataKey="collected" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Ageing + who to chase */}
      <div className="pro-two-col">
        <div className="pro-card">
          <div className="pro-card-header">
            <div className="pro-card-title-group">
              <Hourglass size={18} style={{ color: 'var(--gold)' }} />
              <h3>Receivables Ageing</h3>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{inr(ageingTotal)} outstanding</span>
          </div>
          {ageingTotal === 0 ? (
            <div className="pro-empty" style={{ padding: '3rem' }}>
              <CheckCircle size={36} strokeWidth={1} />
              <p>Nothing outstanding</p>
              <span>Every issued invoice has been settled in full.</span>
            </div>
          ) : (
            <div className="billing-breakdown">
              {ageing.map((b) => (
                <div key={b.label} className="billing-breakdown-item">
                  <div className="billing-breakdown-info">
                    <span className="billing-breakdown-cat">
                      {b.label} · {b.count} invoice{b.count === 1 ? '' : 's'}
                    </span>
                    <span className="billing-breakdown-amount">{inr(b.value)}</span>
                  </div>
                  <div className="billing-breakdown-bar">
                    <div
                      className="billing-breakdown-fill"
                      style={{ width: `${Math.max((b.value / ageingTotal) * 100, b.value > 0 ? 2 : 0)}%`, background: b.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pro-card">
          <div className="pro-card-header">
            <div className="pro-card-title-group">
              <Users size={18} style={{ color: 'var(--text-secondary)' }} />
              <h3>Who Owes the Most</h3>
            </div>
          </div>
          {topDebtors.length === 0 ? (
            <div className="pro-empty" style={{ padding: '3rem' }}>
              <Users size={36} strokeWidth={1} />
              <p>No one owes you anything</p>
              <span>Unpaid invoices are grouped by client here, largest first.</span>
            </div>
          ) : (
            <div className="br-top-products">
              {topDebtors.map((d, i) => (
                <div key={d.client} className="br-top-product">
                  <span className="br-top-rank">{i + 1}</span>
                  <div className="br-top-main">
                    <div className="br-top-name">{d.client}</div>
                    <div className="br-top-meta">
                      {d.count} unpaid invoice{d.count === 1 ? '' : 's'}
                      {d.overdue > 0 ? ` · ${inr(d.overdue)} overdue` : ''}
                    </div>
                    <div className="prod-perf-bar" style={{ maxWidth: '100%' }}>
                      <div style={{ width: debtorMax ? `${Math.max((d.outstanding / debtorMax) * 100, 1)}%` : '0%' }} />
                    </div>
                  </div>
                  <div className="br-top-money">
                    <div>{inr(d.outstanding)}</div>
                    <span>{d.overdue > 0 ? 'overdue' : 'outstanding'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* The register itself: the same two views as before, now the last panel
          of the dashboard rather than a separate slab of page. */}
      <div className="pro-card">
        <div className="pro-card-header">
          <div className="pro-card-title-group">
            <FileText size={18} style={{ color: 'var(--text-secondary)' }} />
            <h3>All Documents</h3>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            {filteredDocs.length} of {documents.length} shown
          </span>
        </div>
        {/* Toolbar */}
        <div className="fin-status-toolbar">
          <div className="fin-list-search-wrap">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search by client, company, or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="fin-list-search"
              aria-label="Search documents"
            />
          </div>
          <select
            aria-label="Sort by"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              height: '36px', padding: '0 0.625rem',
              borderRadius: '0.5rem',
              border: '1px solid var(--border-default)',
              background: 'var(--background)',
              color: 'var(--text-secondary)',
              fontSize: '0.8rem', cursor: 'pointer', outline: 'none', flexShrink: 0,
            }}
          >
            <option value="date_desc">Newest first</option>
            <option value="date_asc">Oldest first</option>
            <option value="amount_desc">Amount ↓</option>
            <option value="amount_asc">Amount ↑</option>
            <option value="client">Client A–Z</option>
            <option value="status">By status</option>
          </select>
          <div className="fin-status-filters">
            {['all', 'quotation', 'proforma', 'invoice'].map((t) => (
              <button
                key={t}
                className={`fin-list-filter-btn ${typeFilter === t ? 'active' : ''}`}
                onClick={() => setTypeFilter(t)}
              >
                {t === 'all' ? 'All' : TYPE_CONFIG[t]?.label || t}
              </button>
            ))}
          </div>
          <div className="fin-status-view-toggle">
            <button
              className={`fin-status-view-btn ${viewMode === 'pipeline' ? 'active' : ''}`}
              onClick={() => setViewMode('pipeline')}
            >
              Pipeline
            </button>
            <button
              className={`fin-status-view-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
            >
              List
            </button>
          </div>
        </div>

        {/* Pipeline View */}
        {viewMode === 'pipeline' && (
          <div className="fin-status-pipeline">
            {clientGroups.length === 0 ? (
              <div className="fin-status-empty">
                <FileText size={40} strokeWidth={1} />
                <h3>No financial documents yet</h3>
                <p>Create a quotation, proforma invoice, or invoice to see them tracked here.</p>
              </div>
            ) : (
              clientGroups.map((group) => (
                <motion.div
                  key={group.client}
                  className="fin-status-deal-card"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  layout
                >
                  <div
                    className="fin-status-deal-header"
                    role="button"
                    tabIndex={0}
                    aria-expanded={expandedClient === group.client}
                    onClick={() => toggleClient(group.client)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleClient(group.client); }
                    }}
                  >
                    <div className="fin-status-deal-info">
                      <div className="fin-status-deal-avatar">
                        <Building size={16} />
                      </div>
                      <div>
                        <h4 className="fin-status-deal-company">{group.client}</h4>
                        <span className="fin-status-deal-contact">{group.clientName}</span>
                      </div>
                    </div>
                    <div className="fin-status-deal-meta">
                      <span className="fin-status-deal-value">₹{group.totalValue.toLocaleString('en-IN')}</span>
                      <div className="fin-status-deal-badges">
                        {group.documents.map((doc) => {
                          const cfg = TYPE_CONFIG[doc.type];
                          return (
                            <span
                              key={doc.id}
                              className="fin-status-type-badge"
                              style={{ background: cfg?.color + '18', color: cfg?.color }}
                            >
                              {cfg?.label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <div className="fin-status-deal-progress">
                      {PIPELINE_STAGES.map((stage, i) => (
                        <div key={stage.key} className="fin-status-stage-wrapper">
                          <div
                            className={`fin-status-stage-dot ${i <= group.highestStage ? 'active' : ''}`}
                            title={stage.label}
                          />
                          {i < PIPELINE_STAGES.length - 1 && (
                            <div className={`fin-status-stage-line ${i < group.highestStage ? 'active' : ''}`} />
                          )}
                        </div>
                      ))}
                      <span className="fin-status-stage-label">
                        {PIPELINE_STAGES[group.highestStage]?.label}
                      </span>
                    </div>
                    {expandedClient === group.client ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>

                  <AnimatePresence>
                    {expandedClient === group.client && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="fin-status-deal-details"
                      >
                        <div className="fin-status-timeline">
                          {group.documents
                            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
                            .map((doc, idx) => {
                              const cfg = TYPE_CONFIG[doc.type];
                              const Icon = cfg?.icon || FileText;
                              return (
                                <div key={doc.id} className="fin-status-timeline-item">
                                  <div className="fin-status-timeline-dot" style={{ background: cfg?.color }} />
                                  {idx < group.documents.length - 1 && (
                                    <div className="fin-status-timeline-connector" />
                                  )}
                                  <div className="fin-status-timeline-content">
                                    <div className="fin-status-timeline-header">
                                      <Icon size={14} style={{ color: cfg?.color }} />
                                      <span className="fin-status-timeline-id">{docNo(doc)}</span>
                                      <DocumentStatusBadge status={doc.status} size="small" />
                                    </div>
                                    <div className="fin-status-timeline-body">
                                      <div className="fin-status-timeline-row">
                                        <span>Type</span>
                                        <strong>{cfg?.label}</strong>
                                      </div>
                                      <div className="fin-status-timeline-row">
                                        <span>Amount</span>
                                        <strong>₹{(doc.grand_total || doc.amount || doc.subtotal || 0).toLocaleString('en-IN')}</strong>
                                      </div>
                                      {doc.items && doc.items.length > 0 && (
                                        <div className="fin-status-timeline-row">
                                          <span>Items</span>
                                          <strong>{doc.items.map((it) => it.description).join(', ')}</strong>
                                        </div>
                                      )}
                                      <div className="fin-status-timeline-row">
                                        <span>Date</span>
                                        <strong>{doc.issue_date || new Date(doc.created_at).toLocaleDateString('en-IN')}</strong>
                                      </div>
                                      {doc.due_date && (
                                        <div className="fin-status-timeline-row">
                                          <span>Due</span>
                                          <strong>{doc.due_date}</strong>
                                        </div>
                                      )}
                                      {doc.valid_until && (
                                        <div className="fin-status-timeline-row">
                                          <span>Valid Until</span>
                                          <strong>{doc.valid_until}</strong>
                                        </div>
                                      )}
                                      {doc.converted_from && (
                                        <div className="fin-status-timeline-row">
                                          <span>Converted From</span>
                                          <strong>{doc.converted_from}</strong>
                                        </div>
                                      )}
                                    </div>
                                    <div className="fin-status-timeline-actions">
                                      <button
                                        className="fin-list-action-btn"
                                        title="Copy Portal Link"
                                        onClick={() => setShowPortalLink(doc.id)}
                                      >
                                        <Copy size={13} /> Link
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))
            )}
          </div>
        )}

        {/* List View */}
        {viewMode === 'list' && (
          <div className="fin-list-table-wrap">
            <table className="fin-list-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Type</th>
                  <th>Client / Company</th>
                  <th>Items</th>
                  <th>Amount</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="fin-list-empty">No documents found</td>
                  </tr>
                ) : (
                  filteredDocs.map((doc) => {
                    const cfg = TYPE_CONFIG[doc.type];
                    return (
                      <tr key={doc.id}>
                        <td className="fin-list-id">{docNo(doc)}</td>
                        <td>
                          <span
                            className="fin-status-type-badge"
                            style={{ background: cfg?.color + '18', color: cfg?.color }}
                          >
                            {cfg?.label}
                          </span>
                        </td>
                        <td>{doc.client?.company || doc.issued_to || '-'}</td>
                        <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {doc.items?.map((it) => it.description).join(', ') || '-'}
                        </td>
                        <td className="fin-list-amount">₹{(doc.grand_total || doc.amount || doc.subtotal || 0).toLocaleString('en-IN')}</td>
                        <td>{doc.issue_date || '-'}</td>
                        <td><DocumentStatusBadge status={doc.status} size="small" /></td>
                        <td>
                          <button
                            className="fin-list-action-btn"
                            title="Copy Portal Link"
                            onClick={() => setShowPortalLink(doc.id)}
                           aria-label="Copy Portal Link">
                            <Copy size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Portal Link Modal */}
      <ShareLinkModal
        open={!!showPortalLink}
        onClose={() => setShowPortalLink(null)}
        documentId={showPortalLink}
        title={'Share link'}
      />
    </div>
  );
}
