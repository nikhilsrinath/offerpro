import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Filter, ChevronDown, ChevronUp, ArrowRight,
  FileText, FilePlus, FileCheck, Receipt, Clock, CheckCircle,
  AlertTriangle, Eye, Copy, RefreshCw, Building, DollarSign,
  ArrowUpRight, XCircle
} from 'lucide-react';
import { documentStore } from '../../services/documentStore';
import { useOrg } from '../../context/OrgContext';
import DocumentStatusBadge from '../shared/DocumentStatusBadge';
import PortalLinkGenerator from '../shared/PortalLinkGenerator';
import { useToast } from '../shared/Toast';

const TYPE_CONFIG = {
  quotation: { label: 'Quotation', icon: FilePlus, color: '#3b82f6', prefix: 'QUO' },
  proforma: { label: 'Proforma', icon: FileCheck, color: '#8b5cf6', prefix: 'PI' },
  invoice: { label: 'Invoice', icon: Receipt, color: '#10b981', prefix: 'INV' },
};

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
  const toast = useToast();
  const { activeOrg } = useOrg();
  const [documents, setDocuments] = useState([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('date_desc');
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedClient, setExpandedClient] = useState(null);
  const [showPortalLink, setShowPortalLink] = useState(null);
  const [viewMode, setViewMode] = useState('pipeline'); // 'pipeline' | 'list'

  useEffect(() => {
    loadDocuments();
  }, [activeOrg]);

  const loadDocuments = async () => {
    if (activeOrg?.id) {
      documentStore.setContext(activeOrg.id);
      await documentStore.init();
    }
    const all = documentStore.getAll();
    const financial = all.filter((d) => ['invoice', 'quotation', 'proforma'].includes(d.type));
    setDocuments(financial);
  };

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

  const stats = useMemo(() => {
    const total = documents.length;
    const quotations = documents.filter((d) => d.type === 'quotation').length;
    const proformas = documents.filter((d) => d.type === 'proforma').length;
    const invoices = documents.filter((d) => d.type === 'invoice').length;
    const paid = documents.filter((d) => d.status === 'paid').length;
    const totalValue = documents.filter((d) => d.status !== 'converted').reduce((sum, d) => sum + (d.grand_total || d.amount || d.subtotal || 0), 0);
    const paidValue = documents.filter((d) => d.status === 'paid').reduce((sum, d) => sum + (d.grand_total || d.amount || d.subtotal || 0), 0);
    return { total, quotations, proformas, invoices, paid, totalValue, paidValue };
  }, [documents]);

  const toggleClient = (client) => {
    setExpandedClient(expandedClient === client ? null : client);
  };

  return (
    <div className="fin-status animate-in">
      {/* Summary Cards */}
      <div className="fin-status-stats">
        <div className="fin-status-stat-card">
          <div className="fin-status-stat-icon" style={{ background: 'var(--blue-muted)', color: 'var(--blue)' }}>
            <FileText size={18} />
          </div>
          <div>
            <span className="fin-status-stat-value">{stats.total}</span>
            <span className="fin-status-stat-label">Total Documents</span>
          </div>
        </div>
        <div className="fin-status-stat-card">
          <div className="fin-status-stat-icon" style={{ background: 'var(--success-muted)', color: 'var(--success)' }}>
            <DollarSign size={18} />
          </div>
          <div>
            <span className="fin-status-stat-value">₹{stats.totalValue.toLocaleString('en-IN')}</span>
            <span className="fin-status-stat-label">Total Value</span>
          </div>
        </div>
        <div className="fin-status-stat-card">
          <div className="fin-status-stat-icon" style={{ background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6' }}>
            <CheckCircle size={18} />
          </div>
          <div>
            <span className="fin-status-stat-value">₹{stats.paidValue.toLocaleString('en-IN')}</span>
            <span className="fin-status-stat-label">Collected</span>
          </div>
        </div>
        <div className="fin-status-stat-card">
          <div className="fin-status-stat-icon" style={{ background: 'var(--gold-muted)', color: 'var(--gold)' }}>
            <Clock size={18} />
          </div>
          <div>
            <span className="fin-status-stat-value">{stats.quotations}/{stats.proformas}/{stats.invoices}</span>
            <span className="fin-status-stat-label">Quo / Pro / Inv</span>
          </div>
        </div>
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
          />
        </div>
        <select
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
                  onClick={() => toggleClient(group.client)}
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
                                    <span className="fin-status-timeline-id">{doc.id}</span>
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
                      <td className="fin-list-id">{doc.id}</td>
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
                        >
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

      {/* Portal Link Modal */}
      <AnimatePresence>
        {showPortalLink && (
          <div className="fin-modal-overlay" onClick={() => setShowPortalLink(null)}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="fin-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <PortalLinkGenerator documentId={showPortalLink} documentType="Document" />
              <button className="fin-modal-close" onClick={() => setShowPortalLink(null)}>
                <XCircle size={18} />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
