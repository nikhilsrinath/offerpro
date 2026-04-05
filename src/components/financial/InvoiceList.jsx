import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, Edit3, Copy, CheckCircle, Bell, Search, Filter, Plus, ChevronDown, ChevronUp, X, Download, MessageSquare, RotateCcw, XCircle } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { documentStore } from '../../services/documentStore';
import { useOrg } from '../../context/OrgContext';
import DocumentStatusBadge from '../shared/DocumentStatusBadge';
import PortalLinkGenerator from '../shared/PortalLinkGenerator';
import { useToast } from '../shared/Toast';

export default function InvoiceList({ onNavigateToNew, onEdit, type = 'invoice' }) {
  const toast = useToast();
  const { activeOrg } = useOrg();
  const [documents, setDocuments] = useState([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('date_desc');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showPortalLink, setShowPortalLink] = useState(null);
  const [expandedPayment, setExpandedPayment] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [expandedRevision, setExpandedRevision] = useState(null);
  const [expandedDecline, setExpandedDecline] = useState(null);
  const pdfRef = useRef(null);

  const typeLabel = {
    invoice: 'Invoice',
    quotation: 'Quotation',
    proforma: 'Proforma Invoice',
  }[type] || 'Document';

  useEffect(() => {
    loadDocuments();
  }, [type, activeOrg]);

  const loadDocuments = async () => {
    if (activeOrg?.id) {
      documentStore.setContext(activeOrg.id);
      await documentStore.init();
    }
    setDocuments(documentStore.getByType(type));
  };

  const filteredDocs = useMemo(() => {
    const filtered = documents.filter((d) => {
      const matchesSearch = !search ||
        d.id.toLowerCase().includes(search.toLowerCase()) ||
        (d.issued_to || '').toLowerCase().includes(search.toLowerCase()) ||
        (d.client?.name || '').toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || d.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
    return [...filtered].sort((a, b) => {
      const dateA = new Date(a.issue_date || a.created_at || 0);
      const dateB = new Date(b.issue_date || b.created_at || 0);
      const amtA = a.grand_total || a.amount || 0;
      const amtB = b.grand_total || b.amount || 0;
      if (sortBy === 'date_desc')   return dateB - dateA;
      if (sortBy === 'date_asc')    return dateA - dateB;
      if (sortBy === 'amount_desc') return amtB - amtA;
      if (sortBy === 'amount_asc')  return amtA - amtB;
      if (sortBy === 'client')      return (a.issued_to || a.client?.name || '').localeCompare(b.issued_to || b.client?.name || '');
      return 0;
    });
  }, [documents, search, statusFilter, sortBy]);

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

  const handleDownloadPDF = async (doc) => {
    if (downloadingId) return;
    setDownloadingId(doc.id);
    // Build company from activeOrg (dynamic)
    const company = {
      company_name: activeOrg?.company_name || '',
      company_address: activeOrg?.company_address || activeOrg?.address || '',
      company_email: activeOrg?.company_email || activeOrg?.email || '',
      company_phone: activeOrg?.company_phone || activeOrg?.phone || '',
      company_website: activeOrg?.company_website || '',
      gstin: activeOrg?.gstin || '',
      cin: activeOrg?.cin || '',
      logo_url: activeOrg?.logo_url || '',
      stamp_url: activeOrg?.stamp_url || '',
      company_tagline: activeOrg?.company_tagline || '',
    };
    const docTypeLabel = doc.type === 'proforma' ? 'Proforma_Invoice' : doc.type === 'quotation' ? 'Quotation' : 'Tax_Invoice';
    const titleText = doc.type === 'proforma' ? 'PROFORMA INVOICE' : doc.type === 'quotation' ? 'QUOTATION' : (doc.gstRate > 0 || doc.gst > 0) ? 'TAX INVOICE' : 'INVOICE';

    // Compute totals from stored data
    const subtotal = doc.subtotal || 0;
    const gstRate = doc.gstRate || 0;
    const gstAmount = doc.gst || 0;
    const halfRate = gstRate / 2;
    const cgst = gstAmount / 2;
    const sgst = gstAmount / 2;
    const grandTotal = doc.grand_total || doc.amount || subtotal;
    const discountAmt = doc.discount?.amount || 0;
    const taxableAmount = subtotal - discountAmt;
    const isPaid = doc.status === 'paid';

    // Build offscreen A4 using the InvoicePreview template (doc-header + inv-* classes)
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;top:0;width:794px;min-width:794px;max-width:794px;';
    container.innerHTML = `
      <div class="a4-sheet inv-preview" style="box-shadow:none;border:none;">
        <!-- Document Header -->
        <div class="doc-header">
          <div class="doc-header-left">
            ${company.logo_url ? `<img src="${company.logo_url}" alt="Logo" class="doc-header-logo" />` : ''}
            ${company.company_tagline ? `<div class="doc-header-tagline">${company.company_tagline}</div>` : ''}
          </div>
          <div class="doc-header-right">
            <div class="doc-header-name">${(company.company_name || doc.issued_by || '').toUpperCase()}</div>
            ${company.cin ? `<div class="doc-header-detail">CIN: ${company.cin}</div>` : ''}
            ${company.company_address ? `<div class="doc-header-detail">${company.company_address}</div>` : ''}
            ${company.company_email ? `<div class="doc-header-detail">${company.company_email}</div>` : ''}
            ${company.company_phone ? `<div class="doc-header-detail">${company.company_phone}</div>` : ''}
            ${company.company_website ? `<div class="doc-header-detail">${company.company_website}</div>` : ''}
          </div>
        </div>

        <div class="inv-header-divider"></div>

        <!-- Title -->
        <div class="inv-header">
          <div class="inv-header-title">${titleText}</div>
          <div class="inv-header-number">${doc.id || ''}</div>
        </div>

        <!-- FROM / BILL TO -->
        <div class="inv-parties">
          <div class="inv-party-col">
            <div class="inv-party-label">FROM</div>
            <div class="inv-party-name">${company.company_name || doc.issued_by || ''}</div>
            ${company.gstin ? `<div class="inv-party-detail">GSTIN: ${company.gstin}</div>` : ''}
          </div>
          <div class="inv-party-col inv-party-right">
            <div class="inv-party-label">BILL TO</div>
            <div class="inv-party-name">${doc.issued_to || doc.client?.name || ''}</div>
            ${doc.client?.email ? `<div class="inv-party-detail">${doc.client.email}</div>` : ''}
            ${doc.client?.address ? `<div class="inv-party-detail">${doc.client.address}</div>` : ''}
            ${doc.client?.gstin ? `<div class="inv-party-detail">GSTIN: ${doc.client.gstin}</div>` : ''}
          </div>
        </div>

        <!-- Dates -->
        <div class="inv-dates-bar">
          <span>${doc.type === 'quotation' ? 'Date' : 'Invoice Date'}: ${doc.issue_date || '-'}</span>
          ${isPaid
        ? '<span class="inv-paid-badge">PAID</span>'
        : `<span>${doc.type === 'quotation' ? 'Valid Until' : 'Due Date'}: ${doc.valid_until || doc.due_date || '-'}</span>`
      }
        </div>

        <!-- Items Table -->
        <table class="inv-table">
          <thead>
            <tr>
              <th class="inv-th-left">Description</th>
              ${gstRate > 0 ? '<th>HSN/SAC</th>' : ''}
              <th>Qty</th>
              <th>Rate</th>
              <th class="inv-th-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${(doc.items || []).map(item => {
        const lineTotal = (Number(item.quantity) || 0) * (Number(item.rate) || Number(item.price) || 0);
        return `
                <tr>
                  <td>${item.description || '-'}</td>
                  ${gstRate > 0 ? `<td class="inv-td-muted">${item.hsnSac || item.hsnCode || '-'}</td>` : ''}
                  <td>${item.quantity || 0}</td>
                  <td>\u20B9${(Number(item.rate) || Number(item.price) || 0).toLocaleString('en-IN')}</td>
                  <td class="inv-td-amount">\u20B9${lineTotal.toLocaleString('en-IN')}</td>
                </tr>`;
      }).join('')}
          </tbody>
        </table>

        <!-- Totals -->
        <div class="inv-totals">
          <div class="inv-total-row"><span>Subtotal:</span><span>\u20B9${subtotal.toLocaleString('en-IN')}</span></div>
          ${discountAmt > 0 ? `<div class="inv-total-row" style="color:#ef4444"><span>Discount (${doc.discount?.type === 'percentage' ? doc.discount.value + '%' : 'flat'}):</span><span>-\u20B9${discountAmt.toLocaleString('en-IN')}</span></div>` : ''}
          <div class="inv-total-row"><span>Taxable Amount:</span><span>\u20B9${taxableAmount.toLocaleString('en-IN')}</span></div>
          ${gstRate > 0 ? `
            <div class="inv-total-divider"></div>
            <div class="inv-total-row inv-total-gst"><span>CGST @ ${halfRate}%:</span><span>\u20B9${cgst.toLocaleString('en-IN')}</span></div>
            <div class="inv-total-row inv-total-gst"><span>SGST @ ${halfRate}%:</span><span>\u20B9${sgst.toLocaleString('en-IN')}</span></div>
          ` : ''}
          <div class="inv-total-divider inv-total-divider-bold"></div>
          <div class="inv-total-row inv-total-grand"><span>TOTAL AMOUNT:</span><span>\u20B9${grandTotal.toLocaleString('en-IN')}</span></div>
        </div>

        ${doc.terms || doc.payment_instructions ? `
          <div class="inv-notes">
            <div class="inv-notes-label">NOTES / TERMS:</div>
            <div class="inv-notes-text">${doc.terms || doc.payment_instructions || ''}</div>
          </div>
        ` : ''}

        ${company.stamp_url ? `
          <div class="inv-stamp-float">
            <img src="${company.stamp_url}" alt="Company Stamp" class="doc-stamp-img" />
          </div>
        ` : ''}

        <div class="inv-footer">
          This is a computer-generated ${doc.type === 'quotation' ? 'quotation' : doc.type === 'proforma' ? 'proforma invoice' : 'invoice'}. Generated via EdgeOS.
        </div>
      </div>
    `;
    document.body.appendChild(container);

    // Wait for images and reflow
    await new Promise(r => setTimeout(r, 300));

    try {
      const canvas = await html2canvas(container.firstElementChild, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#fff',
        width: 794,
        windowWidth: 794,
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();
      const imgAspect = canvas.height / canvas.width;
      const totalH = pdfW * imgAspect;

      if (totalH <= pdfH) {
        pdf.addImage(imgData, 'PNG', 0, 0, pdfW, totalH);
      } else {
        const pageCanvasH = Math.floor(canvas.width * (pdfH / pdfW));
        let yOffset = 0;
        let page = 0;
        while (yOffset < canvas.height) {
          const sliceH = Math.min(pageCanvasH, canvas.height - yOffset);
          const pageCanvas = document.createElement('canvas');
          pageCanvas.width = canvas.width;
          pageCanvas.height = sliceH;
          const ctx = pageCanvas.getContext('2d');
          ctx.drawImage(canvas, 0, -yOffset);
          const pageImg = pageCanvas.toDataURL('image/png');
          if (page > 0) pdf.addPage();
          pdf.addImage(pageImg, 'PNG', 0, 0, pdfW, (sliceH / canvas.width) * pdfW);
          yOffset += pageCanvasH;
          page++;
        }
      }
      const clientName = (doc.issued_to || doc.client?.name || 'Client').replace(/\s+/g, '_');
      pdf.save(`${docTypeLabel}_${doc.id}_${clientName}.pdf`);
    } catch (err) {
      console.error('PDF generation failed:', err);
      toast('Failed to generate PDF', 'error');
    } finally {
      document.body.removeChild(container);
      setDownloadingId(null);
    }
  };

  const handleReviseQuotation = (id) => {
    documentStore.updateStatus(id, 'draft', { revision_notes: null });
    toast('Quotation moved to draft for revision', 'success');
    setExpandedRevision(null);
    if (onEdit) {
      onEdit(id);
    } else {
      loadDocuments();
    }
  };

  const handleRedraftDeclined = (id) => {
    documentStore.updateStatus(id, 'draft', { decline_reason: null });
    toast('Declined quotation moved to draft', 'success');
    setExpandedDecline(null);
    if (onEdit) {
      onEdit(id);
    } else {
      loadDocuments();
    }
  };

  const handleConvertToProforma = (doc) => {
    const newId = documentStore.nextId('PF');
    const newProforma = {
      ...doc,
      id: newId,
      type: 'proforma',
      status: 'draft',
      title: 'Proforma Invoice',
      converted_from: doc.id,
      created_at: new Date().toISOString(),
    };
    documentStore.save(newProforma);
    documentStore.updateStatus(doc.id, 'converted');
    toast(`Converted to proforma ${newId}`, 'success');
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

  let statuses = ['all', 'draft', 'sent', 'viewed', 'payment_submitted', 'paid', 'overdue', 'partially_paid'];
  if (type === 'quotation') {
    statuses = ['all', 'draft', 'sent', 'viewed', 'accepted', 'revision_requested', 'declined', 'converted'];
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
        </select>
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
                      <button
                        className="fin-list-action-btn"
                        title="Download PDF"
                        onClick={() => handleDownloadPDF(doc)}
                        disabled={downloadingId === doc.id}
                      >
                        {downloadingId === doc.id ? <span className="fin-list-spin" /> : <Download size={14} />}
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
                      {type === 'quotation' && (doc.status === 'draft' || doc.status === 'sent' || doc.status === 'viewed') && onEdit && (
                        <button
                          className="fin-list-action-btn"
                          title={doc.status === 'draft' ? 'Edit Quotation' : 'Pull Back & Edit'}
                          onClick={() => {
                            if (doc.status !== 'draft') {
                              documentStore.updateStatus(doc.id, 'draft');
                              toast('Quotation pulled back to draft', 'success');
                            }
                            onEdit(doc.id);
                          }}
                        >
                          <Edit3 size={14} />
                        </button>
                      )}
                      {type === 'quotation' && doc.status === 'accepted' && (
                        <button className="fin-list-action-btn primary" title="Convert to Proforma" onClick={() => handleConvertToProforma(doc)}>
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

      {/* Revision request panels */}
      {filteredDocs.filter((d) => d.status === 'revision_requested').map((doc) => (
        <motion.div
          key={`rev-${doc.id}`}
          className="fin-list-payment-card"
          style={{ borderLeft: '3px solid #6366f1' }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="fin-list-payment-header" onClick={() => setExpandedRevision(expandedRevision === doc.id ? null : doc.id)}>
            <div className="fin-list-payment-icon"><MessageSquare size={18} style={{ color: '#6366f1' }} /></div>
            <div>
              <strong>Revision requested — {doc.id}</strong>
              <p>{doc.issued_to || doc.client?.name} wants changes to this quotation</p>
            </div>
            {expandedRevision === doc.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
          <AnimatePresence>
            {expandedRevision === doc.id && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="fin-list-payment-details"
              >
                <div style={{ padding: '0.25rem 0 0.75rem' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>Revision Notes</span>
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                    {doc.revision_notes || 'No details provided.'}
                  </p>
                </div>
                <div className="fin-list-payment-actions">
                  <button className="fin-list-verify-btn" onClick={() => handleReviseQuotation(doc.id)}>
                    <RotateCcw size={14} /> Move to Draft & Revise
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      ))}

      {/* Declined quotation panels */}
      {filteredDocs.filter((d) => d.status === 'declined' && type === 'quotation').map((doc) => (
        <motion.div
          key={`dec-${doc.id}`}
          className="fin-list-payment-card"
          style={{ borderLeft: '3px solid #ef4444' }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="fin-list-payment-header" onClick={() => setExpandedDecline(expandedDecline === doc.id ? null : doc.id)}>
            <div className="fin-list-payment-icon"><XCircle size={18} style={{ color: '#ef4444' }} /></div>
            <div>
              <strong>Quotation declined — {doc.id}</strong>
              <p>{doc.issued_to || doc.client?.name} has declined this quotation</p>
            </div>
            {expandedDecline === doc.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
          <AnimatePresence>
            {expandedDecline === doc.id && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="fin-list-payment-details"
              >
                <div style={{ padding: '0.25rem 0 0.75rem' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>Decline Reason</span>
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                    {doc.decline_reason || 'No reason provided.'}
                  </p>
                </div>
                <div className="fin-list-payment-actions">
                  <button className="fin-list-verify-btn" onClick={() => handleRedraftDeclined(doc.id)}>
                    <RotateCcw size={14} /> Re-draft & Revise
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
