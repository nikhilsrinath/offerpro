import { useState } from 'react';
import { Download, Pencil } from 'lucide-react';
import { Modal } from './financeUi';
import { money } from './financeHooks';
import InvoicePreview from '../InvoicePreview';
import A4Stage from '../shared/A4Stage';
import DocumentStatusBadge from '../shared/DocumentStatusBadge';
import { pdfService } from '../../services/pdfService';
import { docNumber } from '../../services/documentStore';
import { useOrg } from '../../context/OrgContext';
import { useToast } from '../shared/Toast';
import { invoiceFormDataOf, invoiceTotalsOf } from './invoiceView';

/**
 * View Invoice: a tax invoice made in EdgeOS, drawn as it was issued, in a
 * side panel over the ledger. Download PDF captures this same drawing; Edit
 * (when it may be edited) opens it in its form.
 */
export default function InvoiceViewPanel({ doc, onEdit, onClose }) {
  const { activeOrg } = useOrg();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const formData = invoiceFormDataOf(doc, activeOrg || {});
  const totals = invoiceTotalsOf(doc);
  const paid = Number(doc.amount_paid) || 0;

  const download = async () => {
    setBusy(true);
    try {
      await pdfService.generateInvoice(formData);
    } catch (err) {
      toast(`Could not make the PDF: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Invoice ${docNumber(doc)}`} onClose={onClose} width={960}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px var(--dr-pad, 20px)',
        borderBottom: '1px solid var(--dr-line, var(--border-subtle))', fontSize: 13, color: 'var(--text-secondary)',
      }}>
        <DocumentStatusBadge status={doc.status} size="small" />
        <span>{formData.clientName || 'Client'}</span>
        <span aria-hidden="true">·</span>
        <span>Total {money(totals.grandTotal, 2)}</span>
        {paid > 0.009 && <><span aria-hidden="true">·</span><span>Received {money(paid, 2)}</span></>}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <A4Stage fit="page">
          <InvoicePreview formData={formData} totals={totals} isInterState={totals.isInterState} />
        </A4Stage>
      </div>
      <div className="prod-modal-foot">
        <button type="button" className="prod-btn-ghost" onClick={onClose}>Close</button>
        {onEdit && (
          <button type="button" className="prod-btn-ghost" onClick={onEdit}>
            <Pencil size={13} aria-hidden="true" /> Edit
          </button>
        )}
        <button type="button" className="prod-btn-primary" onClick={download} disabled={busy}>
          <Download size={13} aria-hidden="true" /> {busy ? 'Downloading...' : 'Download PDF'}
        </button>
      </div>
    </Modal>
  );
}
