import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, Edit3, Copy, CheckCircle, Bell, Search, Filter, Plus, ChevronDown, ChevronUp, X } from 'lucide-react';
import { documentStore } from '../../services/documentStore';
import DocumentStatusBadge from '../shared/DocumentStatusBadge';
import PortalLinkGenerator from '../shared/PortalLinkGenerator';
import { useToast } from '../shared/Toast';

export default function InvoiceList({ onNavigateToNew, type = 'invoice' }) {
  const toast = useToast();
  const [documents, setDocuments] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showPortalLink, setShowPortalLink] = useState(null);
  const [expandedPayment, setExpandedPayment] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(null);

  const typeLabel = {
    invoice: 'Invoice',
    quotation: 'Quotation',
    proforma: 'Proforma Invoice',
  }[type] || 'Document';

  useEffect(() => {
    loadDocuments();
  }, [type]);

  const loadDocuments = () => {
    documentStore.init();
    setDocuments(documentStore.getByType(type));
  };

  const filteredDocs = documents.filter((d) => {
    const matchesSearch = !search ||
      d.id.toLowerCase().includes(search.toLowerCase()) ||
      (d.issued_to || '').toLowerCase().includes(search.toLowerCase()) ||
      (d.client?.name || '').toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || d.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Auto-detect overdue invoices
  useEffect(() => {
    documents.forEach((d) => {
      if (d.type === 'invoice' && d.status === 'sent' && d.due_date) {
        const dueDate = new Date(d.due_date);
        if (dueDate < new Date()) {
          documentStore.updateStatus(d.id, 'overdue');
        }
      }
    });
  }, [documents]);

  const handleMarkPaid = (id) => {
    documentStore.updateStatus(id, 'paid');
    toast('Invoice marked as paid', 'success');
    loadDocuments();
  };

  const handleCopyLink = (doc) => {
    setShowPortalLink(doc.id);
  };

  const handleVerifyPayment = (id) => {
    documentStore.updateStatus(id, 'paid', { verified_at: new Date().toISOString() });
    toast('Payment verified and marked as paid', 'success');
    loadDocuments();
  };

  const handleRejectPayment = (id) => {
    documentStore.updateStatus(id, 'sent', {
      payment_rejected: true,
      rejection_reason: rejectReason,
    });
    toast('Payment confirmation rejected', 'warning');
    setShowRejectModal(null);
    setRejectReason('');
    loadDocuments();
  };

  const handleConvertToInvoice = (doc) => {
    const newId = documentStore.nextId('INV');
    const newInvoice = {
      ...doc,
      id: newId,
      type: 'invoice',
      status: 'draft',
      title: 'Tax Invoice',
      converted_from: doc.id,
      created_at: new Date().toISOString(),
    };
    documentStore.save(newInvoice);
    documentStore.updateStatus(doc.id, 'converted');
    toast(`Converted to invoice ${newId}`, 'success');
    loadDocuments();
  };

  const statuses = ['all', 'draft', 'sent', 'viewed', 'payment_submitted', 'paid', 'overdue', 'partially_paid'];
  if (type === 'quotation') {
    statuses.push('accepted', 'revision_requested', 'declined', 'converted');
  }
  if (type === 'proforma') {
    statuses.push('order_confirmed', 'advance_paid', 'converted');
  }

  return (
    <div className="fin-list animate-in">
      {/* Header */}
      <div className="fin-list-header">
        <div className="fin-list-search-wrap">
          <Search size={16} />
          <input
            type="text"
            placeholder={`Search ${typeLabel.toLowerCase()}s...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="fin-list-search"
          />
        </div>
        <div className="fin-list-filters">
          {statuses.map((s) => (
            <button
              key={s}
              className={`fin-list-filter-btn ${statusFilter === s ? 'active' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? 'All' : s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </button>
          ))}
        </div>
        {onNavigateToNew && (
          <button className="fin-list-new-btn" onClick={onNavigateToNew}>
            <Plus size={16} /> New {typeLabel}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="fin-list-table-wrap">
        <table className="fin-list-table">
          <thead>
            <tr>
              <th>{typeLabel} No</th>
              <th>Client</th>
              <th>Amount</th>
              {type === 'invoice' && <th>GST</th>}
              <th>Issue Date</th>
              <th>{type === 'quotation' ? 'Valid Until' : 'Due Date'}</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredDocs.length === 0 ? (
              <tr>
                <td colSpan={type === 'invoice' ? 8 : 7} className="fin-list-empty">
                  No {typeLabel.toLowerCase()}s found
                </td>
              </tr>
            ) : (
              filteredDocs.map((doc) => (
                <tr key={doc.id}>
                  <td className="fin-list-id">{doc.id}</td>
                  <td>{doc.issued_to || doc.client?.name || '-'}</td>
                  <td className="fin-list-amount">₹{(doc.grand_total || doc.amount || 0).toLocaleString('en-IN')}</td>
                  {type === 'invoice' && <td>₹{(doc.gst || 0).toLocaleString('en-IN')}</td>}
                  <td>{doc.issue_date || '-'}</td>
                  <td>{doc.valid_until || doc.due_date || '-'}</td>
                  <td><DocumentStatusBadge status={doc.status} size="small" /></td>
                  <td>
                    <div className="fin-list-actions">
                      <button className="fin-list-action-btn" title="Copy Portal Link" onClick={() => handleCopyLink(doc)}>
                        <Copy size={14} />
                      </button>
                      {type === 'invoice' && doc.status !== 'paid' && (
                        <button className="fin-list-action-btn success" title="Mark Paid" onClick={() => handleMarkPaid(doc.id)}>
                          <CheckCircle size={14} />
                        </button>
                      )}
                      {doc.status === 'payment_submitted' && (
                        <>
                          <button className="fin-list-action-btn success" title="Verify Payment" onClick={() => handleVerifyPayment(doc.id)}>
                            <CheckCircle size={14} />
                          </button>
                          <button className="fin-list-action-btn danger" title="Reject" onClick={() => setShowRejectModal(doc.id)}>
                            <X size={14} />
                          </button>
                        </>
                      )}
                      {type === 'quotation' && doc.status === 'accepted' && (
                        <button className="fin-list-action-btn primary" title="Convert to Invoice" onClick={() => handleConvertToInvoice(doc)}>
                          Convert
                        </button>
                      )}
                      {type === 'proforma' && doc.status === 'advance_paid' && (
                        <button className="fin-list-action-btn primary" title="Convert to Tax Invoice" onClick={() => handleConvertToInvoice(doc)}>
                          Convert
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Payment detail panel */}
      {filteredDocs.filter((d) => d.status === 'payment_submitted').map((doc) => (
        <motion.div
          key={`pay-${doc.id}`}
          className="fin-list-payment-card"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="fin-list-payment-header" onClick={() => setExpandedPayment(expandedPayment === doc.id ? null : doc.id)}>
            <div className="fin-list-payment-icon">💰</div>
            <div>
              <strong>Payment confirmation received — {doc.id}</strong>
              <p>{doc.issued_to || doc.client?.name}: ₹{(doc.payment_confirmation?.amountPaid || doc.amount || 0).toLocaleString('en-IN')}</p>
            </div>
            {expandedPayment === doc.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
          <AnimatePresence>
            {expandedPayment === doc.id && doc.payment_confirmation && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="fin-list-payment-details"
              >
                <div className="fin-list-payment-grid">
                  <div><span>Transaction ID / UTR</span><strong>{doc.payment_confirmation.transactionId}</strong></div>
                  <div><span>Payment Date</span><strong>{doc.payment_confirmation.paymentDate}</strong></div>
                  <div><span>Amount</span><strong>₹{doc.payment_confirmation.amountPaid?.toLocaleString('en-IN')}</strong></div>
                  <div><span>Mode</span><strong>{doc.payment_confirmation.paymentMode}</strong></div>
                </div>
                <div className="fin-list-payment-actions">
                  <button className="fin-list-verify-btn" onClick={() => handleVerifyPayment(doc.id)}>
                    <CheckCircle size={14} /> Verify & Mark as Paid
                  </button>
                  <button className="fin-list-reject-btn" onClick={() => setShowRejectModal(doc.id)}>
                    <X size={14} /> Reject Confirmation
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      ))}

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
              <PortalLinkGenerator documentId={showPortalLink} documentType={typeLabel} />
              <button className="fin-modal-close" onClick={() => setShowPortalLink(null)}>
                <X size={18} />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reject Modal */}
      <AnimatePresence>
        {showRejectModal && (
          <div className="fin-modal-overlay" onClick={() => setShowRejectModal(null)}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="fin-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ margin: '0 0 1rem' }}>Reject Payment Confirmation</h3>
              <textarea
                placeholder="Reason for rejection..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="easy-inp"
                rows={4}
                style={{ width: '100%', resize: 'none' }}
              />
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                <button className="easy-submit-outline" onClick={() => setShowRejectModal(null)} style={{ flex: 1 }}>Cancel</button>
                <button className="easy-submit" onClick={() => handleRejectPayment(showRejectModal)} style={{ flex: 1, background: '#ef4444' }}>Reject</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
