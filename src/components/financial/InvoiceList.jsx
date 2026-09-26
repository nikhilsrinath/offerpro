import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, Edit3, Copy, CheckCircle, Bell, Search, Filter, Plus, X, Download, Trash2, Ban } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { documentStore, docNumber as docNo } from '../../services/documentStore';
import { useOrg } from '../../context/OrgContext';
import DocumentStatusBadge from '../shared/DocumentStatusBadge';
import { DialogSheet, Btn, Status, Modal, Field, Textarea } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { ShareLinkModal } from '../shared/PortalLinkGenerator';
import { useToast } from '../shared/Toast';
import { esc, safeImageUrl } from '../../utils/htmlEscape';
import { isOverdue, balanceOf, daysOverdue } from '../../services/financeAnalytics';
import { invoiceReminderService } from '../../services/invoiceReminderService';
import { useSection } from './financeHooks';
import ProjectBadge from '../projects/ProjectBadge';
import { canCreateProjects } from '../../services/projectService';
import { advanceOf } from '../../services/proformaAdvance';
import { conversionTargets, buildConversion, carriedAdvance, existingConversion } from '../../services/documentConversion';
import ConvertDialog from './ConvertDialog';
import { lifecycleOf, revertedStatusOf, isCarriedAdvance } from '../../services/documentLifecycle';
import { orgStore } from '../../services/orgStore';
import { confirmDialog } from '../../services/confirm';

export default function InvoiceList({ type = 'invoice' }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { activeOrg } = useOrg();
  const [documents, setDocuments] = useState([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('date_desc');
  // Payment position cards on Finance Status link here with ?filter=, so the
  // initial filter comes from the URL when there is one.
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(searchParams.get('filter') || 'all');
  const [projectFilter, setProjectFilter] = useState(searchParams.get('project') || 'all');
  const projects = useSection('projects');
  const allocations = useSection('project_allocations');
  const projectLinks = useSection('project_documents');
  // Which project(s) a document belongs to. An invoice through its money
  // links (visible only with Project financials); a quotation or proforma
  // through the project started from it or linked to it.
  const projectsOf = useMemo(() => {
    const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
    const map = {};
    const add = (docId, pid) => { if (byId[pid]) (map[docId] = map[docId] || new Set()).add(pid); };
    allocations.filter((a) => a.source_type === 'invoice').forEach((a) => add(a.source_id, a.project_id));
    projects.filter((p) => p.source_quotation_id).forEach((p) => add(p.source_quotation_id, p.id));
    projectLinks.filter((l) => l.financial_document_id).forEach((l) => add(l.financial_document_id, l.project_id));
    return (docId) => [...(map[docId] || [])].map((id) => byId[id]);
  }, [projects, allocations, projectLinks]);
  const showProjects = projects.length > 0 && (type !== 'invoice' || allocations.length > 0);
  const [showPortalLink, setShowPortalLink] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [convertSource, setConvertSource] = useState(null);
  const [convertingId, setConvertingId] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [lifecycleBusy, setLifecycleBusy] = useState(null);

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
        (d.doc_number || '').toLowerCase().includes(search.toLowerCase()) ||
        (d.id || '').toLowerCase().includes(search.toLowerCase()) ||
        (d.issued_to || '').toLowerCase().includes(search.toLowerCase()) ||
        (d.client?.name || '').toLowerCase().includes(search.toLowerCase());
      // outstanding/collected are derived views rather than statuses, and
      // overdue is computed from the due date so a partially paid invoice past
      // due is included even though its status column says partially_paid.
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'overdue' && (isOverdue(d) || d.status === 'overdue'))
        || (statusFilter === 'outstanding' && d.type === 'invoice'
          && !['draft', 'cancelled', 'paid'].includes(d.status) && balanceOf(d) > 0.009)
        || (statusFilter === 'collected' && Number(d.amount_paid) > 0)
        || d.status === statusFilter;
      const matchesProject = projectFilter === 'all'
        || (projectFilter === 'none' ? projectsOf(d.id).length === 0 : projectsOf(d.id).some((p) => p.id === projectFilter));
      return matchesSearch && matchesStatus && matchesProject;
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
  }, [documents, search, statusFilter, sortBy, projectFilter, projectsOf]);

  // Auto-detect overdue invoices
  useEffect(() => {
    const overdue = documents.filter((d) =>
      d.type === 'invoice' && d.status === 'sent' && d.due_date
      && new Date(d.due_date) < new Date());
    if (overdue.length === 0) return;

    // Sequential, and awaited: fired off in a forEach these raced each other
    // through the same document cache, and a rejected write went nowhere but an
    // unhandled promise.
    (async () => {
      for (const d of overdue) {
        try {
          await documentStore.updateStatus(d.id, 'overdue');
        } catch (err) {
          console.warn('[InvoiceList] could not mark invoice overdue:', err.message);
        }
      }
    })();
  }, [documents]);

  // Marking an invoice paid means recording the money, not setting a flag: the
  // paid / partially_paid status and amount_paid are derived by the database
  // from confirmed payment rows. Writing the status directly (which is what
  // this did) left amount_paid at 0 on every "paid" invoice.
  const handleMarkPaid = async (id) => {
    const doc = documents.find((d) => d.id === id);
    const outstanding = documentStore.outstandingOf(doc);
    if (outstanding <= 0) {
      toast('This invoice is already fully paid', 'info');
      return;
    }
    try {
      await documentStore.recordPayment(id, {
        amount: outstanding,
        method: 'Manual entry',
        note: 'Marked paid from the invoice list',
      });
      toast('Payment recorded and invoice marked as paid', 'success');
    } catch (err) {
      toast(`Could not record the payment: ${err.message}`, 'error');
    }
    loadDocuments();
  };

  const handleCopyLink = (doc) => {
    setShowPortalLink(doc.id);
  };

  // The recipient submitted a claim through the portal; this is an admin
  // confirming it. Confirming the pending row is what moves the money onto the
  // books — and the trigger, not this handler, decides whether the result is
  // `paid` or `partially_paid`.
  const handleVerifyPayment = async (id) => {
    const doc = documents.find((d) => d.id === id);
    const pending = documentStore.getPendingPayment(id);
    try {
      // Written first, while the status is still whatever the portal set: an
      // update after the payment lands would push the stale cached status back
      // over the one the trigger just computed.
      await documentStore.updateMeta(id, {
        verified_at: new Date().toISOString(),
      });

      if (pending) {
        await documentStore.confirmPayment(pending.id, id);
      } else {
        // Documents from before payments were recorded, and any claim that
        // never became a row, keep the amount in the portal's payload.
        const claimed = Number(doc?.payment_confirmation?.amountPaid) || 0;
        await documentStore.recordPayment(id, {
          amount: claimed > 0 ? claimed : documentStore.outstandingOf(doc),
          method: doc?.payment_confirmation?.paymentMethod || 'Portal confirmation',
          reference: doc?.payment_confirmation?.transactionId || null,
          paidOn: doc?.payment_confirmation?.paymentDate || null,
          bySubmitter: true,
        });
      }
      // The payments trigger speaks invoice: money short of the total reads
      // `partially_paid`. On a proforma that money is the advance, and
      // `advance_paid` is what unlocks the tax invoice.
      if (doc?.type === 'proforma') {
        const after = documentStore.getById(id);
        if (after && after.status !== 'paid' && after.status !== 'advance_paid') {
          await documentStore.updateStatus(id, 'advance_paid');
        }
      }
      toast(doc?.type === 'proforma' ? 'Advance verified and recorded' : 'Payment verified and recorded', 'success');
    } catch (err) {
      toast(`Could not verify the payment: ${err.message}`, 'error');
    }
    loadDocuments();
  };

  const handleRejectPayment = async (id) => {
    try {
      // Drop the unconfirmed claim before restoring the status, so the ledger
      // does not keep a row the admin has just rejected.
      const pending = documentStore.getPendingPayment(id);
      if (pending) await documentStore.deletePayment(pending.id, id);

      const doc = documents.find((d) => d.id === id);
      await documentStore.updateStatus(id, doc?.type === 'proforma' ? 'order_confirmed' : 'sent', {
        payment_rejected: true,
        rejection_reason: rejectReason,
      });
      toast('Payment confirmation rejected', 'warning');
    } catch (err) {
      toast(`Could not reject the payment: ${err.message}`, 'error');
    }
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
    const gstRate = Number(doc.gst_rate ?? doc.gstRate) || 0;
    const gstAmount = Number(doc.gst_amount ?? doc.gst) || 0;
    const halfRate = gstRate / 2;
    const cgst = gstAmount / 2;
    const sgst = gstAmount / 2;
    const grandTotal = doc.grand_total || doc.amount || subtotal;
    const discountAmt = doc.discount?.amount || 0;
    const taxableAmount = subtotal - discountAmt;
    const isPaid = doc.status === 'paid';
    const advance = doc.type === 'proforma' ? advanceOf(doc) : null;

    // Build offscreen A4 using the InvoicePreview template (doc-header + inv-* classes)
    //
    // Every interpolation below goes through esc() and every image URL through
    // safeImageUrl(). This is string-built markup assigned to innerHTML, so a
    // company name, buyer address or item description containing markup would
    // otherwise be parsed as markup and run in the issuer's own session. React
    // escapes for free; here it has to be explicit, so treat a bare ${…} inside
    // this template as a bug.
    const logoUrl = safeImageUrl(company.logo_url);
    const stampUrl = safeImageUrl(company.stamp_url);
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;top:0;width:794px;min-width:794px;max-width:794px;';
    container.innerHTML = `
      <div class="a4-sheet inv-preview" style="box-shadow:none;border:none;">
        <!-- Document Header -->
        <div class="doc-header">
          <div class="doc-header-left">
            ${logoUrl ? `<img src="${logoUrl}" alt="Logo" class="doc-header-logo" />` : ''}
            ${company.company_tagline ? `<div class="doc-header-tagline">${esc(company.company_tagline)}</div>` : ''}
          </div>
          <div class="doc-header-right">
            <div class="doc-header-name">${esc((company.company_name || doc.issued_by || '').toUpperCase())}</div>
            ${company.cin ? `<div class="doc-header-detail">CIN: ${esc(company.cin)}</div>` : ''}
            ${company.company_address ? `<div class="doc-header-detail">${esc(company.company_address)}</div>` : ''}
            ${company.company_email ? `<div class="doc-header-detail">${esc(company.company_email)}</div>` : ''}
            ${company.company_phone ? `<div class="doc-header-detail">${esc(company.company_phone)}</div>` : ''}
            ${company.company_website ? `<div class="doc-header-detail">${esc(company.company_website)}</div>` : ''}
          </div>
        </div>

        <div class="inv-header-divider"></div>

        <!-- Title -->
        <div class="inv-header">
          <div class="inv-header-title">${esc(titleText)}${doc.status === 'cancelled' ? ' <span style="color:#dc2626">— CANCELLED</span>' : ''}</div>
          <div class="inv-header-number">${esc(docNo(doc))}</div>
        </div>

        <!-- FROM / BILL TO -->
        <div class="inv-parties">
          <div class="inv-party-col">
            <div class="inv-party-label">FROM</div>
            <div class="inv-party-name">${esc(company.company_name || doc.issued_by || '')}</div>
            ${company.gstin ? `<div class="inv-party-detail">GSTIN: ${esc(company.gstin)}</div>` : ''}
          </div>
          <div class="inv-party-col inv-party-right">
            <div class="inv-party-label">BILL TO</div>
            <div class="inv-party-name">${esc(doc.issued_to || doc.client?.name || '')}</div>
            ${doc.client?.email ? `<div class="inv-party-detail">${esc(doc.client.email)}</div>` : ''}
            ${doc.client?.address ? `<div class="inv-party-detail">${esc(doc.client.address)}</div>` : ''}
            ${doc.client?.gstin ? `<div class="inv-party-detail">GSTIN: ${esc(doc.client.gstin)}</div>` : ''}
          </div>
        </div>

        <!-- Dates -->
        <div class="inv-dates-bar">
          <span>${doc.type === 'quotation' ? 'Date' : 'Invoice Date'}: ${esc(doc.issue_date || '-')}</span>
          ${isPaid
        ? '<span class="inv-paid-badge">PAID</span>'
        : `<span>${doc.type === 'quotation' ? 'Valid Until' : 'Due Date'}: ${esc(doc.valid_until || doc.due_date || '-')}</span>`
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
                  <td>${esc(item.description || '-')}</td>
                  ${gstRate > 0 ? `<td class="inv-td-muted">${esc(item.hsnSac || item.hsnCode || '-')}</td>` : ''}
                  <td>${esc(item.quantity || 0)}</td>
                  <td>\u20B9${(Number(item.rate) || Number(item.price) || 0).toLocaleString('en-IN')}</td>
                  <td class="inv-td-amount">\u20B9${lineTotal.toLocaleString('en-IN')}</td>
                </tr>`;
      }).join('')}
          </tbody>
        </table>

        <!-- Totals -->
        <div class="inv-totals">
          <div class="inv-total-row"><span>Subtotal:</span><span>\u20B9${subtotal.toLocaleString('en-IN')}</span></div>
          ${discountAmt > 0 ? `<div class="inv-total-row" style="color:#ef4444"><span>Discount (${doc.discount?.type === 'percentage' ? esc(doc.discount.value) + '%' : 'flat'}):</span><span>-\u20B9${discountAmt.toLocaleString('en-IN')}</span></div>` : ''}
          <div class="inv-total-row"><span>Taxable Amount:</span><span>\u20B9${taxableAmount.toLocaleString('en-IN')}</span></div>
          ${gstRate > 0 ? `
            <div class="inv-total-divider"></div>
            <div class="inv-total-row inv-total-gst"><span>CGST @ ${halfRate}%:</span><span>\u20B9${cgst.toLocaleString('en-IN')}</span></div>
            <div class="inv-total-row inv-total-gst"><span>SGST @ ${halfRate}%:</span><span>\u20B9${sgst.toLocaleString('en-IN')}</span></div>
          ` : ''}
          <div class="inv-total-divider inv-total-divider-bold"></div>
          <div class="inv-total-row inv-total-grand"><span>${doc.type === 'proforma' ? 'ORDER VALUE' : 'TOTAL AMOUNT'}:</span><span>\u20B9${grandTotal.toLocaleString('en-IN')}</span></div>
          ${advance && advance.percent > 0 ? `
            <div class="inv-total-row"><span>Advance payable now (${advance.percent}%):</span><span>\u20B9${advance.advance.toLocaleString('en-IN')}</span></div>
            <div class="inv-total-row"><span>Balance on delivery:</span><span>\u20B9${advance.balance.toLocaleString('en-IN')}</span></div>
          ` : ''}
        </div>
        ${doc.type === 'proforma' ? '<div class="inv-notes"><div class="inv-notes-text">This is a proforma invoice issued to confirm the order. It is not a tax invoice and cannot be used to claim input tax credit.</div></div>' : ''}

        ${doc.terms || doc.payment_instructions ? `
          <div class="inv-notes">
            <div class="inv-notes-label">NOTES / TERMS:</div>
            <div class="inv-notes-text">${esc(doc.terms || doc.payment_instructions || '')}</div>
          </div>
        ` : ''}

        ${stampUrl ? `
          <div class="inv-stamp-float">
            <img src="${stampUrl}" alt="Company Stamp" class="doc-stamp-img" />
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
      pdf.save(`${docTypeLabel}_${docNo(doc)}_${clientName}.pdf`);
    } catch (err) {
      console.error('PDF generation failed:', err);
      toast('Failed to generate PDF', 'error');
    } finally {
      document.body.removeChild(container);
      setDownloadingId(null);
    }
  };

  // A sent quotation is not pulled back to draft to be revised: the database
  // only lets its content change as a new version (0064). The editor opens on
  // the same document with the client's note in view, and sending publishes v2
  // of THIS quotation — it used to save a brand-new quotation instead.
  const handleReviseQuotation = (id) => navigate(`/new-quotation/${id}`);
  const handleRedraftDeclined = (id) => navigate(`/new-quotation/${id}`);

  // Quotation → proforma, quotation → tax invoice, proforma → tax invoice.
  // What the new document carries is decided in documentConversion.js; this
  // does the writes, in an order that survives a failure halfway:
  //   1. a document already built from this source is reused, never duplicated
  //      (a retry after step 3 failed would otherwise issue a second one);
  //   2. a proforma's advance becomes a payment on its invoice, so the client
  //      is not billed twice and the money is counted as collected;
  //   3. only then is the source marked converted, pointing at the new one.
  const runConversion = async (source, target, opts = {}) => {
    if (convertingId) return;
    setConvertingId(source.id);
    try {
      let built = existingConversion(source, documentStore.getAll());
      const resumed = !!built;
      if (!built) built = await documentStore.save(buildConversion(source, target, opts));

      const advance = source.type === 'proforma' ? carriedAdvance(source) : null;
      if (advance && !(built.payments || []).some((p) => p.method === advance.method && p.reference === advance.reference)) {
        await documentStore.recordPayment(built.id, advance);
      }

      await documentStore.updateStatus(source.id, 'converted', { converted_to: built.id });
      const label = built.type === 'proforma' ? 'proforma' : 'invoice';
      toast(resumed
        ? `${docNo(source)} was already converted to ${label} ${docNo(built)} — marked converted`
        : `Converted to ${label} ${docNo(built)}${advance ? ` with ₹${advance.amount.toLocaleString('en-IN')} advance applied` : ''}`,
      'success');
      setConvertSource(null);
      loadDocuments();
      navigate(built.type === 'proforma' ? '/proforma' : '/invoices');
    } catch (err) {
      const msg = /SOURCE_NOT_LOCKED/.test(err.message || '')
        ? 'The client has not accepted this version yet, so it cannot be converted.'
        : err.message;
      toast(`Could not convert: ${msg}`, 'error');
      loadDocuments();
    } finally {
      setConvertingId(null);
    }
  };

  // ── Delete a draft / cancel an issued document ──────────────────────────────
  // Which of the two applies, and why not, is documentLifecycle.js. These do
  // the writes and put back anything the document had changed elsewhere.
  const canDeleteDocs = orgStore.can('financial_documents', 'delete');
  const canEditDocs = orgStore.can('financial_documents', 'edit');

  // The document this one was converted from goes back to where it was, so it
  // can be converted again: deleting a wrong proforma draft, or cancelling a
  // wrong invoice, must not strand the accepted quotation behind it.
  const releaseParent = async (doc) => {
    if (!doc.converted_from) return null;
    const parent = documentStore.getById(doc.converted_from);
    const status = revertedStatusOf(parent);
    if (!status) return null;
    await documentStore.updateStatus(parent.id, status, { converted_to: null });
    return parent;
  };

  const handleDelete = async (doc) => {
    const rule = lifecycleOf(doc, documentStore.getAll()).delete;
    if (!rule.allowed) { toast(rule.reason, 'info'); return; }
    const ok = await confirmDialog({
      title: `Delete ${docNo(doc) || typeLabel.toLowerCase()}`,
      message: 'This draft was never sent, so it is removed completely. This cannot be undone.',
    });
    if (!ok) return;
    setLifecycleBusy(doc.id);
    try {
      await documentStore.delete(doc.id);
      const parent = await releaseParent(doc);
      toast(parent ? `Deleted — ${docNo(parent)} can be converted again` : `${docNo(doc)} deleted`, 'success');
    } catch (err) {
      toast(`Could not delete: ${err.message}`, 'error');
    } finally {
      setLifecycleBusy(null);
      loadDocuments();
    }
  };

  const openCancel = (doc) => {
    const rule = lifecycleOf(doc, documentStore.getAll()).cancel;
    if (!rule.allowed) { toast(rule.reason, 'info'); return; }
    setCancelReason('');
    setCancelTarget(doc);
  };

  const handleCancel = async () => {
    const doc = cancelTarget;
    if (!doc || lifecycleBusy) return;
    setLifecycleBusy(doc.id);
    try {
      // A proforma's advance copied onto its invoice goes with the invoice;
      // the money itself stays recorded on the proforma.
      const parent = doc.converted_from ? documentStore.getById(doc.converted_from) : null;
      for (const p of (doc.payments || []).filter((row) => isCarriedAdvance(row, parent))) {
        await documentStore.deletePayment(p.id, doc.id);
      }
      await documentStore.updateStatus(doc.id, 'cancelled');
      const released = await releaseParent(doc);
      // The reason is kept as a notification, not on the document: a sent
      // quotation's content is frozen, and the reason is not part of it.
      const reason = cancelReason.trim();
      Promise.resolve(documentStore.addNotification({
        type: 'document_cancelled',
        title: `${typeLabel} Cancelled`,
        message: `${docNo(doc)} for ${doc.issued_to || doc.clientName || 'client'} cancelled${reason ? ` — ${reason}` : ''}`,
        documentId: doc.id,
      })).catch(() => {});
      toast(released ? `${docNo(doc)} cancelled — ${docNo(released)} can be converted again` : `${docNo(doc)} cancelled`, 'success');
      setCancelTarget(null);
    } catch (err) {
      toast(`Could not cancel: ${err.message}`, 'error');
    } finally {
      setLifecycleBusy(null);
      loadDocuments();
    }
  };

  let statuses = ['all', 'draft', 'sent', 'viewed', 'payment_submitted', 'paid', 'overdue', 'partially_paid', 'outstanding', 'collected'];
  if (type === 'quotation') {
    statuses = ['all', 'draft', 'sent', 'viewed', 'accepted', 'revision_requested', 'declined', 'converted'];
  }
  if (type === 'proforma') {
    statuses.push('order_confirmed', 'advance_paid', 'converted');
  }
  statuses.push('cancelled');

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
            aria-label="Search documents"
          />
        </div>
        {showProjects && (
          <select aria-label="Project" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}
            style={{ height: '36px', padding: '0 0.625rem', borderRadius: '0.5rem', border: '1px solid var(--border-default)',
              background: 'var(--background)', color: 'var(--text-secondary)', fontSize: '0.8rem', flexShrink: 0 }}>
            <option value="all">Every project</option>
            <option value="none">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select>
        )}
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
        <button className="fin-list-new-btn" onClick={() => navigate(`/new-${type}`)}>
          <Plus size={16} /> New {typeLabel}
        </button>
      </div>

      <AttentionPanel
        docs={filteredDocs}
        type={type}
        onVerify={handleVerifyPayment}
        onReject={(id) => setShowRejectModal(id)}
        onRevise={handleReviseQuotation}
        onRedraft={handleRedraftDeclined}
        onConvert={setConvertSource}
      />

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
              {showProjects && <th>Project</th>}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredDocs.length === 0 ? (
              <tr>
                <td colSpan={(type === 'invoice' ? 8 : 7) + (showProjects ? 1 : 0)} className="fin-list-empty">
                  No {typeLabel.toLowerCase()}s found
                </td>
              </tr>
            ) : (
              filteredDocs.map((doc) => (
                <tr key={doc.id}>
                  <td className="fin-list-id">{docNo(doc)}</td>
                  <td>{doc.issued_to || doc.client?.name || '-'}</td>
                  <td className="fin-list-amount">₹{(doc.grand_total || doc.amount || 0).toLocaleString('en-IN')}</td>
                  {type === 'invoice' && <td>₹{(doc.gst || 0).toLocaleString('en-IN')}</td>}
                  <td>{doc.issue_date || '-'}</td>
                  <td>
                    {doc.valid_until || doc.due_date || '-'}
                    {isOverdue(doc) && (
                      <div style={{ fontSize: '0.7rem', color: '#ef4444', fontWeight: 600 }}>
                        {daysOverdue(doc)}d overdue
                        {doc.reminder_count ? ` · ${doc.reminder_count} reminder${doc.reminder_count > 1 ? 's' : ''}` : ''}
                      </div>
                    )}
                  </td>
                  <td><DocumentStatusBadge status={doc.status} size="small" /></td>
                  {showProjects && (
                    <td style={{ fontSize: '0.75rem' }}>
                      {projectsOf(doc.id).length === 0 ? '—' : projectsOf(doc.id).map((p) => (
                        <div key={p.id}><ProjectBadge project={p} /></div>
                      ))}
                    </td>
                  )}
                  <td>
                    <div className="fin-list-actions">
                      <button className="fin-list-action-btn" title="Copy Portal Link" onClick={() => handleCopyLink(doc)} aria-label="Copy Portal Link">
                        <Copy size={14} />
                      </button>
                      <button
                        className="fin-list-action-btn"
                        title="Download PDF"
                        aria-label="Download PDF"
                        onClick={() => handleDownloadPDF(doc)}
                        disabled={downloadingId === doc.id}
                      >
                        {downloadingId === doc.id ? <span className="fin-list-spin" /> : <Download size={14} />}
                      </button>
                      {type === 'invoice' && isOverdue(doc) && doc.clientEmail && (
                        <button
                          className="fin-list-action-btn"
                          title="Send payment reminder now"
                          onClick={async () => {
                            const res = await invoiceReminderService.send(doc);
                            toast(res.message || (res.success ? 'Reminder sent' : 'Reminder failed'), res.success ? 'success' : 'error');
                            loadDocuments();
                          }}
                         aria-label="Send payment reminder now">
                          <Bell size={14} />
                        </button>
                      )}
                      {type === 'invoice' && !['paid', 'cancelled'].includes(doc.status) && (
                        <button className="fin-list-action-btn success" title="Mark Paid" onClick={() => handleMarkPaid(doc.id)} aria-label="Mark Paid">
                          <CheckCircle size={14} />
                        </button>
                      )}
                      {doc.status === 'payment_submitted' && (
                        <>
                          <button className="fin-list-action-btn success" title="Verify Payment" onClick={() => handleVerifyPayment(doc.id)} aria-label="Verify Payment">
                            <CheckCircle size={14} />
                          </button>
                          <button className="fin-list-action-btn danger" title="Reject" onClick={() => setShowRejectModal(doc.id)} aria-label="Reject">
                            <X size={14} />
                          </button>
                        </>
                      )}
                      {type === 'quotation' && ['draft', 'sent', 'viewed'].includes(doc.status) && (
                        <button
                          className="fin-list-action-btn"
                          title={doc.status === 'draft' ? 'Edit quotation' : 'Revise — sends the client a new version'}
                          aria-label={doc.status === 'draft' ? 'Edit quotation' : 'Revise quotation'}
                          onClick={() => navigate(`/new-quotation/${doc.id}`)}
                        >
                          <Edit3 size={14} />
                        </button>
                      )}
                      {type === 'quotation' && conversionTargets(doc).length > 0 && (
                        <button className="fin-list-action-btn primary" title="Convert to a proforma or a tax invoice"
                          disabled={convertingId === doc.id} onClick={() => setConvertSource(doc)}>
                          Convert
                        </button>
                      )}
                      {type === 'quotation' && doc.status === 'accepted' && canCreateProjects() && projectsOf(doc.id).length === 0 && (
                        <button className="fin-list-action-btn primary" title="Start a project from this quotation"
                          onClick={() => navigate(`/projects/new?fromQuotation=${doc.id}`)}>
                          Start project
                        </button>
                      )}
                      {type === 'proforma' && conversionTargets(doc).includes('invoice') && (
                        <button className="fin-list-action-btn primary"
                          title={Number(doc.amount_paid) > 0
                            ? `Convert to Tax Invoice — the ₹${Number(doc.amount_paid).toLocaleString('en-IN')} advance is applied`
                            : 'Convert to Tax Invoice'}
                          disabled={convertingId === doc.id} onClick={() => runConversion(doc, 'invoice')}>
                          {convertingId === doc.id ? 'Converting…' : 'Convert'}
                        </button>
                      )}
                      {doc.status !== 'cancelled' && (() => {
                        const rule = lifecycleOf(doc, documents);
                        if (rule.delete.allowed) {
                          return canDeleteDocs && (
                            <button className="fin-list-action-btn danger" title="Delete draft" aria-label={`Delete ${docNo(doc)}`}
                              disabled={lifecycleBusy === doc.id} onClick={() => handleDelete(doc)}>
                              <Trash2 size={14} />
                            </button>
                          );
                        }
                        // Shown even when it cannot be used yet: clicking says why.
                        return canEditDocs && (
                          <button className="fin-list-action-btn danger"
                            title={rule.cancel.allowed ? `Cancel ${typeLabel.toLowerCase()}` : rule.cancel.reason}
                            aria-label={`Cancel ${docNo(doc)}`} aria-disabled={!rule.cancel.allowed}
                            style={rule.cancel.allowed ? undefined : { opacity: 0.4 }}
                            disabled={lifecycleBusy === doc.id} onClick={() => openCancel(doc)}>
                            <Ban size={14} />
                          </button>
                        );
                      })()}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConvertDialog
        source={convertSource}
        docs={documentStore.getAll()}
        busy={!!convertSource && convertingId === convertSource.id}
        onClose={() => setConvertSource(null)}
        onConvert={(target, opts) => runConversion(convertSource, target, opts)}
      />

      <Modal
        open={!!cancelTarget}
        onClose={lifecycleBusy ? undefined : () => setCancelTarget(null)}
        title={`Cancel ${docNo(cancelTarget) || typeLabel.toLowerCase()}`}
        note={cancelTarget ? `${cancelTarget.issued_to || cancelTarget.clientName || 'Client'} · ₹${(cancelTarget.grand_total || cancelTarget.amount || 0).toLocaleString('en-IN')}` : ''}
        footer={(
          <>
            <Btn onClick={() => setCancelTarget(null)} disabled={!!lifecycleBusy}>Keep it</Btn>
            <Btn danger onClick={handleCancel} disabled={!!lifecycleBusy}>
              {lifecycleBusy ? 'Cancelling…' : `Cancel ${typeLabel.toLowerCase()}`}
            </Btn>
          </>
        )}
      >
        <p style={{ margin: '0 0 12px', fontSize: 12, lineHeight: 1.6 }}>
          {cancelTarget?.type === 'invoice'
            ? 'The invoice keeps its number and is marked cancelled. It stops counting towards revenue, receivables and GST from now on.'
            : `The ${typeLabel.toLowerCase()} is marked cancelled and the client can no longer act on it from their link.`}
          {cancelTarget?.converted_from ? ' The document it was converted from can be converted again.' : ''}
        </p>
        <Field label="Reason (optional)">
          <Textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
            placeholder="e.g. Client dropped the order, wrong amount, duplicate" />
        </Field>
      </Modal>

      {/* Portal Link Modal */}
      <ShareLinkModal
        open={!!showPortalLink}
        onClose={() => setShowPortalLink(null)}
        documentId={showPortalLink}
        title={`Share ${docNo(documents.find((d) => d.id === showPortalLink)) || typeLabel}`}
      />

      {/* Reject Modal */}
      <AnimatePresence>
        {showRejectModal && (
          <div className="fin-modal-overlay" onClick={() => setShowRejectModal(null)}>
            <DialogSheet
              as={motion.div}
              labelledBy="reject-payment-title"
              onClose={() => setShowRejectModal(null)}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="fin-modal"
            >
              <h3 id="reject-payment-title" style={{ margin: '0 0 1rem' }}>Reject Payment Confirmation</h3>
              <textarea
                aria-label="Reason for rejection"
                placeholder="Reason for rejection..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="easy-inp"
                rows={4}
                style={{ width: '100%', resize: 'none' }}
              />
              <div className="form-actions" style={{ marginTop: '1rem' }}>
                <button className="easy-submit-outline" onClick={() => setShowRejectModal(null)} style={{ flex: 1 }}>Cancel</button>
                <button className="easy-submit" onClick={() => handleRejectPayment(showRejectModal)} style={{ flex: 1, background: 'var(--error)', borderColor: 'var(--error)' }}>Reject</button>
              </div>
            </DialogSheet>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* Documents waiting on the issuer — a client submitted a payment, asked for a
   revision, or declined. One quiet panel above the table instead of a card per
   document: the row says what happened and carries the action that answers it. */
function AttentionPanel({ docs, type, onVerify, onReject, onRevise, onRedraft, onConvert }) {
  const t = useT();
  const money = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN');
  const client = (doc) => doc.issued_to || doc.client?.name || 'Client';

  const items = docs.flatMap((doc) => {
    if (doc.status === 'payment_submitted') {
      const pc = doc.payment_confirmation || {};
      const mode = pc.paymentMode || pc.paymentMethod;
      const facts = [mode, pc.transactionId && `UTR ${pc.transactionId}`, pc.paymentDate].filter(Boolean);
      const isAdvance = doc.type === 'proforma';
      if (isAdvance) {
        const a = advanceOf(doc);
        facts.push(`advance asked ${money(a.advance)} (${a.percent}%)`);
      }
      return [{
        doc, tone: 'up', label: isAdvance ? 'Advance submitted' : 'Payment submitted',
        headline: `${client(doc)} paid ${money(pc.amountPaid ?? (isAdvance ? advanceOf(doc).advanceDue : doc.grand_total ?? doc.amount))}${isAdvance ? ' as advance' : ''}`,
        detail: facts.join(' · '),
        actions: (
          <>
            <Btn size="sm" onClick={() => onReject(doc.id)} danger>Reject</Btn>
            <Btn size="sm" primary onClick={() => onVerify(doc.id)}>{isAdvance ? 'Verify advance' : 'Verify & mark paid'}</Btn>
          </>
        ),
      }];
    }
    if (doc.status === 'revision_requested') {
      return [{
        doc, tone: 'neutral', label: 'Revision requested',
        headline: `${client(doc)} asked for changes`,
        note: doc.revision_notes,
        actions: <Btn size="sm" primary onClick={() => onRevise(doc.id)}>Revise quotation</Btn>,
      }];
    }
    if (doc.type === 'quotation' && conversionTargets(doc).length > 0) {
      return [{
        doc, tone: 'up', label: 'Accepted',
        headline: `${client(doc)} accepted ${money(doc.grand_total ?? doc.amount)} — ready to bill`,
        detail: 'Convert to a proforma to collect an advance first, or straight to a tax invoice.',
        actions: <Btn size="sm" primary onClick={() => onConvert(doc)}>Convert</Btn>,
      }];
    }
    if (doc.status === 'declined' && type === 'quotation') {
      return [{
        doc, tone: 'down', label: 'Declined',
        headline: `${client(doc)} declined`,
        note: doc.decline_reason,
        actions: <Btn size="sm" onClick={() => onRedraft(doc.id)}>Re-draft</Btn>,
      }];
    }
    return [];
  });

  if (items.length === 0) return null;

  return (
    <section
      aria-label="Needs your attention"
      style={{ border: '1px solid ' + t.line, borderRadius: 10, background: t.panel, marginBottom: 14, overflow: 'hidden' }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '9px 14px', borderBottom: '1px solid ' + t.lineSoft }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: t.text }}>Needs your attention</span>
        <span style={{ fontSize: 10.5, color: t.faint }}>{items.length}</span>
      </header>
      {items.map(({ doc, tone, label, headline, detail, note, actions }, i) => (
        <div
          key={doc.id}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap',
            padding: '12px 14px', borderTop: i ? '1px solid ' + t.lineSoft : 'none',
          }}
        >
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Status tone={tone}>{label}</Status>
              <span style={{ fontSize: 10.5, color: t.faint }}>{docNo(doc)}</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.text, marginTop: 5 }}>{headline}</div>
            {detail && <div style={{ fontSize: 11, color: t.dim, marginTop: 3 }}>{detail}</div>}
            {note !== undefined && (
              <p style={{
                margin: '8px 0 0', padding: '8px 11px', borderRadius: 7,
                background: t.panelAlt, border: '1px solid ' + t.lineSoft,
                fontSize: 11.5, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                color: note ? t.text : t.faint,
              }}>
                {note || 'No details given.'}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>{actions}</div>
        </div>
      ))}
    </section>
  );
}
