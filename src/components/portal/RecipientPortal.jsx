import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download, Check, X, ShieldCheck, Building2, FileText, CheckCircle2,
  AlertCircle, Calendar, Clock, Lock, User, ZoomIn, ZoomOut,
  Copy, CreditCard, Banknote, MessageSquare, ExternalLink, Shield,
  Sparkles, ArrowRight, Eye, Hash, Mail
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { documentStore } from '../../services/documentStore';
import SignatureCapture from '../shared/SignatureCapture';
import UPIQRGenerator from '../shared/UPIQRGenerator';
import PaymentConfirmationForm from '../shared/PaymentConfirmationForm';
import DocumentStatusBadge from '../shared/DocumentStatusBadge';

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
};

const stagger = {
  animate: { transition: { staggerChildren: 0.08 } },
};

function formatDocType(type) {
  const map = {
    offer_letter: 'Offer Letter',
    mou: 'Memorandum of Understanding',
    nda: 'Non-Disclosure Agreement',
    invoice: 'Tax Invoice',
    quotation: 'Quotation',
    proforma: 'Proforma Invoice',
  };
  return map[type] || type?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Document';
}

export default function RecipientPortal({ documentId }) {
  const [loading, setLoading] = useState(true);
  const [docData, setDocData] = useState(null);
  const [status, setStatus] = useState('pending');
  const [zoom, setZoom] = useState(100);
  const [signature, setSignature] = useState(null);
  const [signatureMethod, setSignatureMethod] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [showBankDetails, setShowBankDetails] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentSubmitted, setPaymentSubmitted] = useState(false);
  const [revisionText, setRevisionText] = useState('');
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [orderConfirmed, setOrderConfirmed] = useState(false);
  const [candidateName, setCandidateName] = useState('');
  const [candidateDesignation, setCandidateDesignation] = useState('');
  const [candidateDate, setCandidateDate] = useState(new Date().toISOString().split('T')[0]);
  const [partyBSignature, setPartyBSignature] = useState(null);
  const [partyBAgreed, setPartyBAgreed] = useState(false);
  const [copied, setCopied] = useState('');
  const [downloading, setDownloading] = useState(false);
  const a4Ref = useRef(null);

  useEffect(() => {
    const loadDocument = async () => {
      // Extract orgId from URL query params for Firebase sync
      const params = new URLSearchParams(window.location.search);
      const orgId = params.get('org');
      if (orgId) {
        documentStore.setContext(orgId);
        await documentStore.init();
      }

      const doc = documentStore.getById(documentId);
      if (doc) {
        setDocData(doc);
        setStatus(doc.status);
        if (doc.issued_to) setCandidateName(doc.issued_to);
        // Auto-mark as viewed when client opens the portal link
        if (doc.status === 'sent') {
          documentStore.updateStatus(doc.id, 'viewed', {
            first_viewed_at: doc.first_viewed_at || new Date().toISOString(),
            last_viewed_at: new Date().toISOString(),
          });
          setStatus('viewed');
        }
      } else {
        setDocData(null);
      }
      setLoading(false);
    };

    // Small delay for loading animation
    const timer = setTimeout(loadDocument, 1200);
    return () => clearTimeout(timer);
  }, [documentId]);

  // ── Handlers ──
  const handleAcceptOffer = () => {
    if (!signature || !agreed) return;
    documentStore.updateStatus(docData.id, 'signed', {
      candidate_signature: signature,
      signature_method: signatureMethod,
      candidate_name: candidateName,
      signed_at: new Date().toISOString(),
    });
    documentStore.addNotification({
      type: 'offer_signed',
      title: `Offer accepted by ${candidateName}`,
      message: `${candidateName} has signed the offer letter ${docData.id}`,
      document_id: docData.id,
    });
    setStatus('signed');
  };

  const handleDecline = () => {
    documentStore.updateStatus(docData.id, 'declined', { decline_reason: declineReason });
    documentStore.addNotification({
      type: 'document_declined',
      title: `Document declined`,
      message: `${docData.issued_to} has declined ${docData.id}. Reason: ${declineReason || 'Not specified'}`,
      document_id: docData.id,
    });
    setShowDeclineModal(false);
    setStatus('declined');
  };

  const handleMoUSign = () => {
    if (!partyBSignature || !partyBAgreed) return;
    documentStore.updateStatus(docData.id, 'fully_signed', {
      party_b: {
        ...docData.party_b,
        signature: partyBSignature,
        representative: candidateName || docData.party_b?.representative,
        designation: candidateDesignation || docData.party_b?.designation,
        signed_at: new Date().toISOString(),
      },
    });
    documentStore.addNotification({
      type: 'mou_fully_signed',
      title: `MoU fully signed`,
      message: `Both parties have signed ${docData.id}`,
      document_id: docData.id,
    });
    setStatus('fully_signed');
  };

  const handlePaymentConfirmation = (data) => {
    documentStore.updateStatus(docData.id, 'payment_submitted', { payment_confirmation: data });
    documentStore.addNotification({
      type: 'payment_submitted',
      title: `Payment submitted for ${docData.id}`,
      message: `₹${data.amountPaid?.toLocaleString('en-IN')} — UTR: ${data.transactionId}`,
      document_id: docData.id,
    });
    setPaymentSubmitted(true);
    setStatus('payment_submitted');
  };

  const handleAcceptQuotation = () => {
    if (!signature || !agreed) return;
    documentStore.updateStatus(docData.id, 'accepted', {
      accepted_by: candidateName,
      accepted_signature: signature,
      accepted_at: new Date().toISOString(),
    });
    documentStore.addNotification({
      type: 'quotation_accepted',
      title: `Quotation accepted`,
      message: `${candidateName} accepted ${docData.id}`,
      document_id: docData.id,
    });
    setStatus('accepted');
  };

  const handleRevisionRequest = () => {
    documentStore.updateStatus(docData.id, 'revision_requested', { revision_notes: revisionText });
    documentStore.addNotification({
      type: 'revision_requested',
      title: `Revision requested for ${docData.id}`,
      message: revisionText,
      document_id: docData.id,
    });
    setShowRevisionModal(false);
    setStatus('revision_requested');
  };

  const handleConfirmOrder = () => {
    documentStore.updateStatus(docData.id, 'order_confirmed');
    setOrderConfirmed(true);
  };

  const handleProformaPayment = (data) => {
    documentStore.updateStatus(docData.id, 'advance_paid', { payment_confirmation: data });
    documentStore.addNotification({
      type: 'advance_paid',
      title: `Advance payment received for ${docData.id}`,
      message: `₹${data.amountPaid?.toLocaleString('en-IN')} advance paid`,
      document_id: docData.id,
    });
    setPaymentSubmitted(true);
    setStatus('advance_paid');
  };

  const handleCopy = async (text, label) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const handleDownloadPDF = async () => {
    if (!a4Ref.current || downloading) return;
    setDownloading(true);
    const element = a4Ref.current;

    // Save original styles
    const origTransform = element.style.transform;
    const origWidth = element.style.width;
    const origMinWidth = element.style.minWidth;
    const origMaxWidth = element.style.maxWidth;
    const origPosition = element.style.position;
    const origLeft = element.style.left;

    // Force a fixed A4-like width and reset zoom so the capture matches the preview exactly
    const captureWidth = 794; // 210mm at 96dpi
    element.style.transform = 'none';
    element.style.width = captureWidth + 'px';
    element.style.minWidth = captureWidth + 'px';
    element.style.maxWidth = captureWidth + 'px';
    element.style.position = 'absolute';
    element.style.left = '-9999px';

    // Let browser reflow
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#fff',
        width: captureWidth,
        windowWidth: captureWidth,
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
        // Multi-page: slice the canvas into page-sized chunks
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
      const clientName = (docData.issued_to || docData.client?.name || 'Client').replace(/\s+/g, '_');
      pdf.save(`${formatDocType(docData.type).replace(/\s+/g, '_')}_${docData.id}_${clientName}.pdf`);
    } catch (err) {
      console.error('PDF generation failed:', err);
    } finally {
      // Restore all original styles
      element.style.transform = origTransform;
      element.style.width = origWidth;
      element.style.minWidth = origMinWidth;
      element.style.maxWidth = origMaxWidth;
      element.style.position = origPosition;
      element.style.left = origLeft;
      setDownloading(false);
    }
  };

  // ── Loading ──
  if (loading) {
    return (
      <div className="rp-loading">
        <div className="rp-loading-inner">
          <div className="rp-loading-spinner" />
          <div className="rp-loading-text">
            <Shield size={14} />
            <span>Establishing secure connection...</span>
          </div>
        </div>
        <footer className="rp-footer">
          <div className="rp-footer-inner">
            <div className="rp-footer-brand"><Shield size={13} /><span>Powered by <strong>OfferPro Suite</strong></span></div>
            <p className="rp-footer-tagline">Secure document management for businesses</p>
          </div>
        </footer>
      </div>
    );
  }

  // ── Not Found ──
  if (!docData) {
    return (
      <div className="rp-loading">
        <div className="rp-loading-inner">
          <div className="rp-notfound-icon"><AlertCircle size={32} /></div>
          <h2>Document Not Found</h2>
          <p>This link may have expired or the document ID is invalid.</p>
        </div>
        <footer className="rp-footer">
          <div className="rp-footer-inner">
            <div className="rp-footer-brand"><Shield size={13} /><span>Powered by <strong>OfferPro Suite</strong></span></div>
            <p className="rp-footer-tagline">Secure document management for businesses</p>
          </div>
        </footer>
      </div>
    );
  }

  const isActionTaken = ['signed', 'declined', 'paid', 'payment_submitted', 'accepted', 'fully_signed', 'advance_paid', 'revision_requested'].includes(status);
  const company = documentStore.getCompanyProfile();

  // ── Render ──
  return (
    <div className="rp-page">
      {/* ── Top Navigation ── */}
      <header className="rp-header">
        <div className="rp-header-inner">
          <div className="rp-header-left">
            {company.logo_url ? (
              <img src={company.logo_url} alt="" className="rp-header-logo" />
            ) : (
              <div className="rp-header-logo-placeholder">
                <Building2 size={18} />
              </div>
            )}
            <div className="rp-header-brand">
              <h1>{docData.issued_by || company.company_name || 'Company'}</h1>
              <span>Secure Document Portal</span>
            </div>
          </div>
          <div className="rp-header-right">
            <div className="rp-header-doctype">{formatDocType(docData.type)}</div>
            <DocumentStatusBadge status={status} />
          </div>
        </div>
      </header>

      {/* ── Security Bar ── */}
      <div className="rp-security-bar">
        <div className="rp-security-inner">
          <Lock size={11} />
          <span>End-to-end encrypted</span>
          <span className="rp-security-sep">|</span>
          <span>Document ID: {docData.id}</span>
          <span className="rp-security-sep">|</span>
          <span>Powered by OfferPro</span>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="rp-main">
        <motion.div className="rp-layout" initial="initial" animate="animate" variants={stagger}>

          {/* Left: Document Viewer */}
          <motion.div className="rp-viewer" variants={fadeUp}>
            {/* Document Info Card */}
            <div className="rp-doc-info-card">
              <div className="rp-doc-info-grid">
                <div className="rp-doc-info-item">
                  <FileText size={14} />
                  <div>
                    <span className="rp-doc-info-label">Document</span>
                    <span className="rp-doc-info-value">{docData.title || formatDocType(docData.type)}</span>
                  </div>
                </div>
                <div className="rp-doc-info-item">
                  <User size={14} />
                  <div>
                    <span className="rp-doc-info-label">Recipient</span>
                    <span className="rp-doc-info-value">{docData.issued_to || docData.party_b?.company || 'Recipient'}</span>
                  </div>
                </div>
                <div className="rp-doc-info-item">
                  <Calendar size={14} />
                  <div>
                    <span className="rp-doc-info-label">Issued</span>
                    <span className="rp-doc-info-value">{docData.issue_date || '-'}</span>
                  </div>
                </div>
                <div className="rp-doc-info-item">
                  <Clock size={14} />
                  <div>
                    <span className="rp-doc-info-label">{docData.type === 'quotation' ? 'Valid Until' : docData.type === 'offer_letter' ? 'Respond By' : 'Due Date'}</span>
                    <span className="rp-doc-info-value">{docData.valid_until || docData.due_date || '-'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Zoom Controls */}
            <div className="rp-zoom-bar">
              <button onClick={() => setZoom(Math.max(50, zoom - 10))}><ZoomOut size={14} /></button>
              <span>{zoom}%</span>
              <button onClick={() => setZoom(Math.min(150, zoom + 10))}><ZoomIn size={14} /></button>
              <button onClick={() => setZoom(100)} className="rp-zoom-reset">Reset</button>
              {['quotation', 'proforma', 'invoice'].includes(docData.type) && (
                <button className="rp-download-pdf-btn" onClick={handleDownloadPDF} disabled={downloading}>
                  <Download size={13} /> {downloading ? 'Generating...' : 'Download PDF'}
                </button>
              )}
            </div>

            {/* A4 Document Preview */}
            <div className="rp-a4-wrapper">
              <div ref={a4Ref} className="rp-a4" style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}>
                {!isActionTaken && <div className="rp-watermark">PREVIEW</div>}

                <div className="rp-doc-content">
                  {/* Letterhead */}
                  <div className="rp-letterhead">
                    {company.logo_url && <img src={company.logo_url} alt="" className="rp-letterhead-logo" />}
                    <div className="rp-letterhead-text">
                      <h2>{docData.issued_by || company.company_name}</h2>
                      {company.company_address && <p>{company.company_address}</p>}
                      <p>
                        {[company.company_email, company.company_phone].filter(Boolean).join(' | ')}
                      </p>
                      {company.gstin && <p className="rp-letterhead-gstin">GSTIN: {company.gstin}</p>}
                    </div>
                  </div>

                  <div className="rp-doc-rule" />

                  {/* ── Offer Letter ── */}
                  {docData.type === 'offer_letter' && (
                    <div className="rp-doc-body">
                      <h3 className="rp-doc-title">OFFER OF EMPLOYMENT</h3>
                      <p className="rp-doc-date">Date: {docData.issue_date}</p>
                      <p><strong>To,</strong></p>
                      <p><strong>{docData.issued_to}</strong></p>
                      <p className="rp-doc-para">Dear {docData.issued_to},</p>
                      <p className="rp-doc-para">
                        We are pleased to offer you the position of <strong>{docData.role}</strong> in the <strong>{docData.department}</strong> department
                        at {docData.issued_by}. Your start date is <strong>{docData.start_date}</strong>.
                      </p>
                      <p className="rp-doc-para">
                        Your compensation will be <strong>₹{docData.salary}</strong> per month, payable as per company policy.
                      </p>
                      <p className="rp-doc-para">Please confirm your acceptance by <strong>{docData.valid_until}</strong>.</p>
                      <p className="rp-doc-sign-line">Sincerely,</p>
                      <p><strong>{docData.issued_by}</strong></p>

                      <div className="rp-doc-sig-section">
                        <h4>ACCEPTANCE & SIGNATURE</h4>
                        <div className="rp-doc-sig-rule" />
                        <p>I, _________________________, hereby accept the terms and conditions of this offer letter.</p>
                        <div className="rp-doc-sig-grid">
                          <div className="rp-doc-sig-col">
                            <p className="rp-doc-sig-heading">Authorized Signatory</p>
                            <p>{docData.issued_by}</p>
                            <p>Date: {docData.issue_date}</p>
                            {company.signature_url && <img src={company.signature_url} alt="Signature" className="rp-doc-sig-img" />}
                            <div className="rp-doc-sig-line" />
                            <p className="rp-doc-sig-caption">Signature</p>
                          </div>
                          <div className="rp-doc-sig-col">
                            <p className="rp-doc-sig-heading">Candidate Signature</p>
                            {status === 'signed' && signature ? (
                              <>
                                <img src={signature} alt="Candidate Signature" className="rp-doc-sig-img" />
                                <p>Name: {candidateName}</p>
                                <p>Date: {new Date().toLocaleDateString()}</p>
                              </>
                            ) : (
                              <>
                                <p>Name: _______________________</p>
                                <p>Date: _______________________</p>
                                <p>Place: _______________________</p>
                                <div className="rp-doc-sig-line" />
                                <p className="rp-doc-sig-caption">Signature</p>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── MoU ── */}
                  {docData.type === 'mou' && (
                    <div className="rp-doc-body">
                      <h3 className="rp-doc-title">MEMORANDUM OF UNDERSTANDING</h3>
                      <p className="rp-doc-para">
                        This MoU is entered into between <strong>{docData.party_a?.company}</strong> (First Party)
                        and <strong>{docData.party_b?.company}</strong> (Second Party).
                      </p>
                      <p className="rp-doc-date">Date: {docData.issue_date}</p>
                      <p className="rp-doc-para">The parties agree to collaborate in good faith under the terms outlined in this agreement.</p>
                      <div className="rp-doc-sig-grid" style={{ marginTop: '2.5em' }}>
                        <div className="rp-doc-sig-col">
                          <p className="rp-doc-sig-heading">{docData.party_a?.company}</p>
                          <p>{docData.party_a?.representative} — {docData.party_a?.designation}</p>
                          {docData.party_a?.signed_at && <p className="rp-doc-signed-badge">Signed: {docData.party_a.signed_at}</p>}
                          {docData.party_a?.signature ? (
                            <img src={docData.party_a.signature} alt="" className="rp-doc-sig-img" style={{ opacity: 0.6 }} />
                          ) : (
                            <div className="rp-doc-sig-line" />
                          )}
                        </div>
                        <div className="rp-doc-sig-col">
                          <p className="rp-doc-sig-heading">{docData.party_b?.company}</p>
                          <p>{docData.party_b?.representative} — {docData.party_b?.designation}</p>
                          {status === 'fully_signed' && partyBSignature ? (
                            <>
                              <p className="rp-doc-signed-badge">Signed: {new Date().toLocaleString()}</p>
                              <img src={partyBSignature} alt="" className="rp-doc-sig-img" />
                            </>
                          ) : (
                            <div className="rp-doc-sig-line" />
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Invoice / Proforma ── */}
                  {(docData.type === 'invoice' || docData.type === 'proforma') && (
                    <div className="rp-doc-body">
                      <h3 className="rp-doc-title">{docData.type === 'proforma' ? 'PROFORMA INVOICE' : 'TAX INVOICE'}</h3>
                      <div className="rp-doc-invoice-meta">
                        <div>
                          <p className="rp-doc-meta-label">Bill To</p>
                          <p className="rp-doc-meta-value">{docData.issued_to || docData.client?.name}</p>
                          {docData.client?.address && <p>{docData.client.address}</p>}
                          {docData.client?.gstin && <p className="rp-letterhead-gstin">GSTIN: {docData.client.gstin}</p>}
                        </div>
                        <div className="rp-doc-invoice-ids">
                          <p><strong>{docData.id}</strong></p>
                          <p>Date: {docData.issue_date}</p>
                          <p>Due: {docData.due_date}</p>
                        </div>
                      </div>
                      <table className="rp-doc-table">
                        <thead>
                          <tr>
                            <th>Description</th>
                            <th>Qty</th>
                            <th>Rate</th>
                            <th>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(docData.items || []).map((item, i) => (
                            <tr key={i}>
                              <td>{item.description}</td>
                              <td className="rp-doc-table-center">{item.quantity} {item.unit || ''}</td>
                              <td className="rp-doc-table-right">₹{item.rate?.toLocaleString('en-IN')}</td>
                              <td className="rp-doc-table-right">₹{((item.quantity || 0) * (item.rate || 0)).toLocaleString('en-IN')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="rp-doc-totals">
                        <div className="rp-doc-total-row"><span>Subtotal</span><span>₹{(docData.subtotal || 0).toLocaleString('en-IN')}</span></div>
                        {docData.gst > 0 && <div className="rp-doc-total-row"><span>GST</span><span>₹{docData.gst.toLocaleString('en-IN')}</span></div>}
                        <div className="rp-doc-total-row rp-doc-grand-total">
                          <span>Total Due</span>
                          <span>₹{(docData.grand_total || docData.amount || 0).toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                      {docData.accepted_signature && (
                        <div className="rp-doc-sig-section">
                          <h4>SIGNATURES</h4>
                          <div className="rp-doc-sig-rule" />
                          <div className="rp-doc-sig-grid">
                            <div className="rp-doc-sig-col">
                              <p className="rp-doc-sig-heading">Authorized Signatory</p>
                              <p>{docData.issued_by || company.company_name}</p>
                              <p>Date: {docData.issue_date}</p>
                              {company.signature_url && <img src={company.signature_url} alt="Company Signature" className="rp-doc-sig-img" />}
                              <div className="rp-doc-sig-line" />
                            </div>
                            <div className="rp-doc-sig-col">
                              <p className="rp-doc-sig-heading">Accepted By</p>
                              <img src={docData.accepted_signature} alt="Accepted Signature" className="rp-doc-sig-img" />
                              <p>{docData.accepted_by || docData.issued_to}</p>
                              <p>Date: {docData.accepted_at ? new Date(docData.accepted_at).toLocaleDateString() : ''}</p>
                              {docData.converted_from && <p style={{ fontSize: '7pt', color: '#999', marginTop: '0.5em' }}>Ref: {docData.converted_from}</p>}
                            </div>
                          </div>
                        </div>
                      )}
                      {docData.type === 'proforma' && (
                        <p className="rp-doc-disclaimer">This is a proforma invoice and is not valid for GST input tax credit.</p>
                      )}
                    </div>
                  )}

                  {/* ── Quotation ── */}
                  {docData.type === 'quotation' && (
                    <div className="rp-doc-body">
                      <h3 className="rp-doc-title">QUOTATION</h3>
                      <div className="rp-doc-invoice-meta">
                        <div>
                          <p className="rp-doc-meta-label">Prepared For</p>
                          <p className="rp-doc-meta-value">{docData.issued_to || docData.client?.name}</p>
                        </div>
                        <div className="rp-doc-invoice-ids">
                          <p><strong>{docData.id}</strong></p>
                          <p>Date: {docData.issue_date}</p>
                          <p>Valid Until: {docData.valid_until}</p>
                        </div>
                      </div>
                      <table className="rp-doc-table">
                        <thead>
                          <tr>
                            <th>Description</th>
                            <th>Qty</th>
                            <th>Rate</th>
                            <th>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(docData.items || []).map((item, i) => (
                            <tr key={i}>
                              <td>{item.description}</td>
                              <td className="rp-doc-table-center">{item.quantity}</td>
                              <td className="rp-doc-table-right">₹{item.rate?.toLocaleString('en-IN')}</td>
                              <td className="rp-doc-table-right">₹{((item.quantity || 0) * (item.rate || 0)).toLocaleString('en-IN')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="rp-doc-totals">
                        <div className="rp-doc-total-row rp-doc-grand-total">
                          <span>Total</span>
                          <span>₹{(docData.subtotal || docData.amount || 0).toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                      {(docData.accepted_signature || (status === 'accepted' && signature)) && (
                        <div className="rp-doc-sig-section">
                          <h4>SIGNATURES</h4>
                          <div className="rp-doc-sig-rule" />
                          <div className="rp-doc-sig-grid">
                            <div className="rp-doc-sig-col">
                              <p className="rp-doc-sig-heading">Authorized Signatory</p>
                              <p>{docData.issued_by || company.company_name}</p>
                              <p>Date: {docData.issue_date}</p>
                              {company.signature_url && <img src={company.signature_url} alt="Company Signature" className="rp-doc-sig-img" />}
                              <div className="rp-doc-sig-line" />
                            </div>
                            <div className="rp-doc-sig-col">
                              <p className="rp-doc-sig-heading">Accepted By</p>
                              <img src={docData.accepted_signature || signature} alt="Accepted Signature" className="rp-doc-sig-img" />
                              <p>{docData.accepted_by || candidateName || docData.issued_to}</p>
                              <p>Date: {docData.accepted_at ? new Date(docData.accepted_at).toLocaleDateString() : new Date().toLocaleDateString()}</p>
                            </div>
                          </div>
                        </div>
                      )}
                      <p className="rp-doc-disclaimer">This is not a tax invoice.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right: Action Panel */}
          <motion.div className="rp-actions" variants={fadeUp}>

            {/* ════════ OFFER LETTER ════════ */}
            {docData.type === 'offer_letter' && status === 'pending' && (
              <div className="rp-card">
                <div className="rp-card-header">
                  <Sparkles size={18} />
                  <h3>Your Response</h3>
                </div>
                <p className="rp-card-desc">Review the offer letter on the left, then provide your signature below to accept.</p>

                <SignatureCapture onSignatureChange={(sig, method) => { setSignature(sig); setSignatureMethod(method); }} />

                <label className="rp-agree">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <span>I, <strong>{candidateName || docData.issued_to}</strong>, confirm I have read and accept all terms of this offer letter.</span>
                </label>

                <div className="rp-card-actions">
                  <button className="rp-btn rp-btn-primary" disabled={!signature || !agreed} onClick={handleAcceptOffer}>
                    <Check size={16} /> Accept & Sign
                  </button>
                  <button className="rp-btn rp-btn-danger-outline" onClick={() => setShowDeclineModal(true)}>
                    <X size={16} /> Decline
                  </button>
                </div>
              </div>
            )}

            {docData.type === 'offer_letter' && status === 'signed' && (
              <SuccessCard
                title="Offer Accepted"
                subtitle={`Thank you, ${candidateName || docData.issued_to}`}
                details={[
                  { label: 'Signed on', value: new Date().toLocaleString() },
                  { label: 'Method', value: signatureMethod === 'draw' ? 'Drawn' : signatureMethod === 'upload' ? 'Uploaded' : 'Typed' },
                  { label: 'Document', value: docData.id },
                ]}
              />
            )}

            {/* ════════ MoU / NDA ════════ */}
            {docData.type === 'mou' && status === 'party_a_signed' && (
              <div className="rp-card">
                <div className="rp-card-header">
                  <ShieldCheck size={18} />
                  <h3>Counter-Sign Agreement</h3>
                </div>

                <div className="rp-party-status">
                  <div className="rp-party-row rp-party-done">
                    <Check size={14} />
                    <div>
                      <strong>{docData.party_a?.company}</strong>
                      <span>Signed by {docData.party_a?.representative} — {docData.party_a?.signed_at}</span>
                    </div>
                  </div>
                  <div className="rp-party-row rp-party-pending">
                    <Clock size={14} />
                    <div>
                      <strong>{docData.party_b?.company}</strong>
                      <span>Awaiting your signature</span>
                    </div>
                  </div>
                </div>

                <div className="rp-field-group">
                  <label className="rp-label">Your Signature</label>
                  <SignatureCapture onSignatureChange={(sig) => setPartyBSignature(sig)} />
                </div>

                <div className="rp-fields-row">
                  <div className="rp-field">
                    <label>Full Name</label>
                    <input type="text" value={candidateName} onChange={(e) => setCandidateName(e.target.value)} placeholder="Enter your name" />
                  </div>
                  <div className="rp-field">
                    <label>Designation</label>
                    <input type="text" value={candidateDesignation} onChange={(e) => setCandidateDesignation(e.target.value)} placeholder="e.g. CEO" />
                  </div>
                  <div className="rp-field">
                    <label>Date</label>
                    <input type="date" value={candidateDate} onChange={(e) => setCandidateDate(e.target.value)} />
                  </div>
                </div>

                <label className="rp-agree">
                  <input type="checkbox" checked={partyBAgreed} onChange={(e) => setPartyBAgreed(e.target.checked)} />
                  <span>I am authorized to sign on behalf of <strong>{docData.party_b?.company}</strong>.</span>
                </label>

                <button className="rp-btn rp-btn-primary" disabled={!partyBSignature || !partyBAgreed} onClick={handleMoUSign}>
                  <Check size={16} /> Sign Agreement
                </button>
              </div>
            )}

            {docData.type === 'mou' && status === 'fully_signed' && (
              <SuccessCard title="Agreement Fully Signed" subtitle="Both parties have signed the document." />
            )}

            {/* ════════ INVOICE ════════ */}
            {docData.type === 'invoice' && !paymentSubmitted && status !== 'paid' && status !== 'payment_submitted' && (
              <div className="rp-card">
                <div className="rp-card-header">
                  <CreditCard size={18} />
                  <h3>Pay Invoice</h3>
                </div>

                <div className="rp-amount-hero">
                  <span className="rp-amount-label">Amount Due</span>
                  <span className="rp-amount-value">₹{(docData.grand_total || docData.amount || 0).toLocaleString('en-IN')}</span>
                  <div className="rp-amount-meta-row">
                    <span><Calendar size={12} /> Due: {docData.due_date}</span>
                    <span><Hash size={12} /> {docData.id}</span>
                  </div>
                </div>

                <div className="rp-payment-method">
                  <h4>UPI Payment</h4>
                  <UPIQRGenerator
                    upiId={docData.upi_id || company.upi_id}
                    payeeName={docData.issued_by || company.company_name}
                    amount={docData.grand_total || docData.amount}
                    transactionNote={docData.id}
                  />
                </div>

                <div className="rp-payment-method">
                  <button className="rp-bank-toggle" onClick={() => setShowBankDetails(!showBankDetails)}>
                    <Banknote size={15} />
                    <span>Bank Transfer Details</span>
                    <span className="rp-bank-arrow">{showBankDetails ? '−' : '+'}</span>
                  </button>
                  <AnimatePresence>
                    {showBankDetails && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="rp-bank-details"
                      >
                        <BankRow label="Bank Name" value={docData.bank?.name || company.bank_name} />
                        <BankRow label="Account No." value={docData.bank?.account || company.bank_account_number} copyable onCopy={(v) => handleCopy(v, 'account')} copied={copied === 'account'} />
                        <BankRow label="IFSC Code" value={docData.bank?.ifsc || company.bank_ifsc} copyable onCopy={(v) => handleCopy(v, 'ifsc')} copied={copied === 'ifsc'} />
                        <BankRow label="Account Type" value={docData.bank?.type || company.bank_account_type} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {!showPaymentForm ? (
                  <button className="rp-btn rp-btn-primary" onClick={() => setShowPaymentForm(true)}>
                    <Check size={16} /> I Have Made the Payment
                  </button>
                ) : (
                  <PaymentConfirmationForm
                    amount={docData.grand_total || docData.amount}
                    invoiceId={docData.id}
                    onSubmit={handlePaymentConfirmation}
                  />
                )}
              </div>
            )}

            {docData.type === 'invoice' && (paymentSubmitted || status === 'payment_submitted') && (
              <SuccessCard title="Payment Submitted" subtitle="Your payment confirmation is under review. You'll receive a receipt once verified." />
            )}

            {docData.type === 'invoice' && status === 'paid' && (
              <SuccessCard title="Invoice Paid" subtitle="Payment verified successfully. Thank you!" />
            )}

            {/* ════════ QUOTATION ════════ */}
            {docData.type === 'quotation' && status !== 'accepted' && status !== 'declined' && status !== 'revision_requested' && status !== 'converted' && (
              <div className="rp-card">
                <div className="rp-card-header">
                  <FileText size={18} />
                  <h3>Review Quotation</h3>
                </div>

                <div className="rp-amount-hero">
                  <span className="rp-amount-label">Quoted Amount</span>
                  <span className="rp-amount-value">₹{(docData.subtotal || docData.amount || 0).toLocaleString('en-IN')}</span>
                  <div className="rp-amount-meta-row">
                    <span><Calendar size={12} /> Valid until: {docData.valid_until}</span>
                    <span><Hash size={12} /> {docData.id}</span>
                  </div>
                </div>

                <div className="rp-field-group">
                  <label className="rp-label">Your Signature</label>
                  <SignatureCapture onSignatureChange={(sig, method) => { setSignature(sig); setSignatureMethod(method); }} />
                </div>

                <div className="rp-fields-row">
                  <div className="rp-field">
                    <label>Full Name</label>
                    <input type="text" value={candidateName} onChange={(e) => setCandidateName(e.target.value)} placeholder="Enter your name" />
                  </div>
                  <div className="rp-field">
                    <label>Designation</label>
                    <input type="text" value={candidateDesignation} onChange={(e) => setCandidateDesignation(e.target.value)} placeholder="e.g. Procurement Head" />
                  </div>
                  <div className="rp-field">
                    <label>Date</label>
                    <input type="date" value={candidateDate} onChange={(e) => setCandidateDate(e.target.value)} />
                  </div>
                </div>

                <label className="rp-agree">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <span>I accept this quotation and authorize <strong>{docData.issued_by || company.company_name}</strong> to proceed.</span>
                </label>

                <div className="rp-card-actions">
                  <button className="rp-btn rp-btn-primary" disabled={!signature || !agreed} onClick={handleAcceptQuotation}>
                    <Check size={16} /> Accept Quotation
                  </button>
                  <button className="rp-btn rp-btn-outline" onClick={() => setShowRevisionModal(true)}>
                    <MessageSquare size={14} /> Request Revision
                  </button>
                  <button className="rp-btn rp-btn-danger-outline" onClick={() => setShowDeclineModal(true)}>
                    <X size={14} /> Decline
                  </button>
                </div>
              </div>
            )}

            {docData.type === 'quotation' && status === 'accepted' && (
              <SuccessCard title="Quotation Accepted" subtitle={`Thank you, ${candidateName}`} />
            )}

            {docData.type === 'quotation' && status === 'revision_requested' && (
              <StatusCard icon={<MessageSquare size={28} />} color="#6366f1" title="Revision Requested" subtitle="The issuer has been notified. You'll receive an updated quotation." />
            )}

            {docData.type === 'quotation' && status === 'converted' && (
              <SuccessCard title="Quotation Converted" subtitle="This quotation has been converted to a proforma invoice. No further action is needed." />
            )}

            {/* ════════ PROFORMA ════════ */}
            {docData.type === 'proforma' && !paymentSubmitted && status !== 'advance_paid' && (
              <div className="rp-card">
                <div className="rp-card-header">
                  <CreditCard size={18} />
                  <h3>Confirm & Pay Advance</h3>
                </div>

                <div className="rp-amount-breakdown">
                  <div className="rp-amount-break-row">
                    <span>Total Value</span>
                    <strong>₹{(docData.grand_total || docData.amount || 0).toLocaleString('en-IN')}</strong>
                  </div>
                  <div className="rp-amount-break-row rp-amount-highlight">
                    <span>Advance ({docData.advance_percent || 50}%)</span>
                    <strong>₹{(docData.advance_amount || 0).toLocaleString('en-IN')}</strong>
                    <span className="rp-amount-badge">Pay now</span>
                  </div>
                  <div className="rp-amount-break-row">
                    <span>Balance Due</span>
                    <strong>₹{(docData.balance_due || 0).toLocaleString('en-IN')}</strong>
                    <span className="rp-amount-badge rp-amount-badge-muted">On delivery</span>
                  </div>
                </div>

                {!orderConfirmed ? (
                  <div className="rp-step">
                    <div className="rp-step-num">1</div>
                    <div className="rp-step-body">
                      <label className="rp-agree">
                        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                        <span>I confirm the order details in this proforma invoice.</span>
                      </label>
                      <button className="rp-btn rp-btn-primary" disabled={!agreed} onClick={handleConfirmOrder}>
                        Confirm Order
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="rp-step rp-step-done">
                      <div className="rp-step-num rp-step-check"><Check size={12} /></div>
                      <span>Order Confirmed</span>
                    </div>

                    <div className="rp-step">
                      <div className="rp-step-num">2</div>
                      <div className="rp-step-body">
                        <h4 className="rp-step-title">Pay Advance — ₹{(docData.advance_amount || 0).toLocaleString('en-IN')}</h4>
                        <UPIQRGenerator
                          upiId={docData.upi_id || company.upi_id}
                          payeeName={docData.issued_by || company.company_name}
                          amount={docData.advance_amount}
                          transactionNote={`${docData.id} Advance`}
                        />
                        <button className="rp-bank-toggle" onClick={() => setShowBankDetails(!showBankDetails)}>
                          <Banknote size={15} />
                          <span>Bank Transfer</span>
                          <span className="rp-bank-arrow">{showBankDetails ? '−' : '+'}</span>
                        </button>
                        {showBankDetails && (
                          <div className="rp-bank-details" style={{ marginTop: '0.5rem' }}>
                            <BankRow label="Bank" value={company.bank_name} />
                            <BankRow label="A/C" value={company.bank_account_number} />
                            <BankRow label="IFSC" value={company.bank_ifsc} />
                          </div>
                        )}
                        {!showPaymentForm ? (
                          <button className="rp-btn rp-btn-primary" onClick={() => setShowPaymentForm(true)}>
                            <Check size={16} /> I Have Paid the Advance
                          </button>
                        ) : (
                          <PaymentConfirmationForm
                            amount={docData.advance_amount}
                            invoiceId={docData.id}
                            onSubmit={handleProformaPayment}
                          />
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {docData.type === 'proforma' && (paymentSubmitted || status === 'advance_paid') && (
              <SuccessCard title="Advance Payment Submitted" subtitle="Order confirmed. A tax invoice will be issued upon delivery." />
            )}

            {/* ════════ DECLINED (shared) ════════ */}
            {status === 'declined' && (
              <StatusCard icon={<AlertCircle size={28} />} color="#ef4444" title="Document Declined" subtitle="The issuer has been notified of your decision." />
            )}
          </motion.div>
        </motion.div>
      </div>

      {/* ── Decline Modal ── */}
      <AnimatePresence>
        {showDeclineModal && (
          <ModalOverlay onClose={() => setShowDeclineModal(false)}>
            <div className="rp-modal-icon rp-modal-icon-danger"><AlertCircle size={22} /></div>
            <h3>Decline this document?</h3>
            <p>This action cannot be undone. The issuer will be notified.</p>
            <textarea
              className="rp-modal-textarea"
              placeholder="Reason for declining (optional)..."
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
            />
            <div className="rp-modal-actions">
              <button className="rp-btn rp-btn-ghost" onClick={() => setShowDeclineModal(false)}>Cancel</button>
              <button className="rp-btn rp-btn-danger" onClick={handleDecline}>Confirm Decline</button>
            </div>
          </ModalOverlay>
        )}
      </AnimatePresence>

      {/* ── Revision Modal ── */}
      <AnimatePresence>
        {showRevisionModal && (
          <ModalOverlay onClose={() => setShowRevisionModal(false)}>
            <h3>Request Revision</h3>
            <p>Describe the changes you'd like made to this quotation.</p>
            <textarea
              className="rp-modal-textarea"
              placeholder="Describe the changes needed..."
              value={revisionText}
              onChange={(e) => setRevisionText(e.target.value)}
            />
            <div className="rp-modal-actions">
              <button className="rp-btn rp-btn-ghost" onClick={() => setShowRevisionModal(false)}>Cancel</button>
              <button className="rp-btn rp-btn-primary" onClick={handleRevisionRequest} disabled={!revisionText.trim()}>
                Submit Request
              </button>
            </div>
          </ModalOverlay>
        )}
      </AnimatePresence>

      {/* ── Footer — always visible ── */}
      <footer className="rp-footer">
        <div className="rp-footer-inner">
          <div className="rp-footer-brand">
            <Shield size={13} />
            <span>Powered by <strong>OfferPro Suite</strong></span>
          </div>
          <p className="rp-footer-tagline">Secure document management for businesses</p>
        </div>
      </footer>
    </div>
  );
}

// ── Sub-components ──

function ModalOverlay({ children, onClose }) {
  return (
    <div className="rp-overlay" onClick={onClose}>
      <motion.div
        className="rp-modal"
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 10 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </div>
  );
}

function SuccessCard({ title, subtitle, details }) {
  return (
    <motion.div
      className="rp-success"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', duration: 0.6 }}
    >
      <motion.div
        className="rp-success-icon"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.15, type: 'spring', stiffness: 200 }}
      >
        <CheckCircle2 size={36} />
      </motion.div>
      <h3>{title}</h3>
      {subtitle && <p>{subtitle}</p>}
      {details && (
        <div className="rp-success-details">
          {details.map((d, i) => (
            <div key={i}><span>{d.label}</span><strong>{d.value}</strong></div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function StatusCard({ icon, color, title, subtitle }) {
  return (
    <motion.div
      className="rp-status-card"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{ '--status-color': color }}
    >
      <div className="rp-status-card-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{subtitle}</p>
    </motion.div>
  );
}

function BankRow({ label, value, copyable, onCopy, copied }) {
  return (
    <div className="rp-bank-row">
      <span>{label}</span>
      <div className="rp-bank-val">
        <strong>{value || '—'}</strong>
        {copyable && value && (
          <button onClick={() => onCopy(value)} className="rp-copy-btn" title="Copy">
            {copied ? <Check size={11} /> : <Copy size={11} />}
          </button>
        )}
      </div>
    </div>
  );
}
