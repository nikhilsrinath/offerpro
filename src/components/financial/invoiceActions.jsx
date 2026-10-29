import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Ban, Eye, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Btn, Modal, Field, Textarea } from '../ui/edge';
import { useSection, money } from './financeHooks';
import InvoiceViewPanel from './InvoiceViewPanel';
import ClientInvoicePanel from './ClientInvoicePanel';
import { documentStore, docNumber } from '../../services/documentStore';
import { orgStore } from '../../services/orgStore';
import { receiptService } from '../../services/receiptService';
import { confirmDialog } from '../../services/confirm';
import { lifecycleOf, reactivationOf } from '../../services/documentLifecycle';
import { cancelDocument, deleteDocument, reactivateDocument } from '../../services/documentActions';
import { projectBillingForm } from '../projects/projectScope';
import { useToast } from '../shared/Toast';

/**
 * What a client invoice's row on a ledger can do: View Invoice, Edit, Cancel
 * Invoice and Delete (and Reactivate Invoice once cancelled). The rules are
 * Billing's own (documentLifecycle.js) and so are the writes
 * (documentActions.js), so an invoice changed here is changed everywhere.
 *
 * An uploaded invoice is its file: viewing opens the file, editing reopens
 * Upload Invoice on it. One made in EdgeOS is drawn as issued (InvoiceViewPanel)
 * and edited in its form, which comes back to this page when saved.
 *
 * Returns `menu(invoiceId)` and `receiptMenu(paymentId, invoiceId)` for
 * RowMenu, `view(invoiceId)` for the row's name, and `dialogs` to render.
 */
export function useInvoiceActions({ projectId = null, clients = [] } = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const docs = useSection('fin_docs');
  const [viewing, setViewing] = useState(null);
  const [editingUpload, setEditingUpload] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const canEdit = orgStore.can('financial_documents', 'edit');
  const canDelete = orgStore.can('financial_documents', 'delete');
  const docOf = (id) => docs.find((d) => d.id === id) || documentStore.getById(id);

  const view = async (id) => {
    const doc = docOf(id);
    if (!doc) { toast('This invoice no longer exists.', 'error'); return; }
    if (doc.upload_path) {
      if (!(await receiptService.open(doc.upload_path))) toast('The invoice file could not be opened.', 'error');
      return;
    }
    setViewing(id);
  };

  const edit = (id) => {
    const doc = docOf(id);
    if (!doc) return;
    if (doc.status === 'cancelled') { toast('This invoice is cancelled. Reactivate it before changing it.', 'info'); return; }
    setViewing(null);
    if (doc.upload_path) { setEditingUpload(doc); return; }
    navigate(projectId ? projectBillingForm(projectId, 'invoice', id) : `/clients/billing/invoices/${id}/edit`,
      { state: { returnTo: location.pathname + location.search } });
  };

  const openCancel = (doc) => {
    const rule = lifecycleOf(doc, documentStore.getAll()).cancel;
    if (!rule.allowed) { toast(rule.reason, 'info'); return; }
    setReason('');
    setCancelling(doc);
  };

  const cancel = async () => {
    if (!cancelling || busy) return;
    setBusy(true);
    try {
      const released = await cancelDocument(cancelling, reason);
      toast(released ? `${docNumber(cancelling)} cancelled. ${docNumber(released)} can be converted again` : `${docNumber(cancelling)} cancelled`, 'success');
      setCancelling(null);
    } catch (err) {
      toast(`Could not cancel: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (doc) => {
    const rule = lifecycleOf(doc, documentStore.getAll()).delete;
    if (!rule.allowed) { toast(rule.reason, 'info'); return; }
    const ok = await confirmDialog({
      title: `Delete ${docNumber(doc)}`,
      message: `Delete ${docNumber(doc)} for ${money(doc.grand_total, 2)} everywhere, including the client's General Ledger and any project it is on?${doc.upload_path ? ' Its uploaded file goes too.' : ''} This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const parent = await deleteDocument(doc);
      toast(parent ? `Deleted. ${docNumber(parent)} can be converted again` : `${docNumber(doc)} deleted`, 'success');
    } catch (err) {
      toast(`Could not delete: ${err.message}`, 'error');
    }
  };

  const reactivate = async (doc) => {
    const rule = reactivationOf(doc, documentStore.getAll());
    if (!rule.allowed) { toast(rule.reason, 'info'); return; }
    const ok = await confirmDialog({
      title: `Reactivate ${docNumber(doc)}`,
      message: `The invoice comes back under the same number and counts towards revenue, receivables and GST again.${rule.parent ? ` ${docNumber(rule.parent)} is marked converted to it again.` : ''}`,
      confirmLabel: 'Reactivate',
      tone: 'default',
    });
    if (!ok) return;
    try {
      await reactivateDocument(doc);
      toast(`${docNumber(doc)} reactivated`, 'success');
    } catch (err) {
      toast(`Could not reactivate: ${err.message}`, 'error');
    }
  };

  const menu = (id) => {
    const doc = docOf(id);
    if (!doc) return [];
    const rule = lifecycleOf(doc, docs);
    const cancelled = doc.status === 'cancelled';
    const back = cancelled ? reactivationOf(doc, docs) : null;
    return [
      { label: doc.upload_path ? 'View Uploaded Invoice' : 'View Invoice', icon: Eye, onClick: () => view(id) },
      // Shown even when it cannot be used yet: clicking says why.
      canEdit && {
        label: 'Edit', icon: Pencil, onClick: () => edit(id),
        muted: cancelled, hint: cancelled ? 'Cancelled. Reactivate it to change it.' : undefined, showHint: cancelled,
      },
      canEdit && cancelled && {
        label: 'Reactivate Invoice', icon: RotateCcw, onClick: () => reactivate(doc),
        muted: !back.allowed, hint: back.allowed ? undefined : back.reason, showHint: true,
      },
      canEdit && !cancelled && {
        label: 'Cancel Invoice', icon: Ban, tone: 'danger', onClick: () => openCancel(doc),
        muted: !rule.cancel.allowed, hint: rule.cancel.allowed ? undefined : rule.cancel.reason, showHint: true,
      },
      canDelete && {
        label: 'Delete', icon: Trash2, tone: 'danger', onClick: () => remove(doc),
        muted: !rule.delete.allowed, hint: rule.delete.allowed ? undefined : rule.delete.reason, showHint: true,
      },
    ];
  };

  // A payment recorded on the invoice in Billing: its invoice, or the payment taken off.
  const receiptMenu = (paymentId, invoiceId) => [
    { label: 'View Invoice', icon: Eye, onClick: () => view(invoiceId) },
    canEdit && {
      label: 'Delete Receipt', icon: Trash2, tone: 'danger',
      onClick: async () => {
        const doc = docOf(invoiceId);
        const p = (doc?.payments || []).find((x) => x.id === paymentId);
        const ok = await confirmDialog({
          title: 'Delete receipt',
          message: `Delete this receipt${p ? ` of ${money(p.amount, 2)}` : ''} on ${docNumber(doc) || 'the invoice'}? What it paid becomes owed again. This cannot be undone.`,
          confirmLabel: 'Delete',
          tone: 'danger',
        });
        if (!ok) return;
        try {
          await documentStore.deletePayment(paymentId, invoiceId);
          toast('Receipt deleted', 'success');
        } catch (err) {
          toast(`Could not delete: ${err.message}`, 'error');
        }
      },
    },
  ];

  const viewed = viewing ? docOf(viewing) : null;
  const dialogs = (
    <>
      {viewed && (
        <InvoiceViewPanel doc={viewed} onClose={() => setViewing(null)}
          onEdit={canEdit && viewed.status !== 'cancelled' ? () => edit(viewed.id) : undefined} />
      )}
      {editingUpload && (
        <ClientInvoicePanel invoice={editingUpload} clients={clients} projectId={projectId}
          onClose={() => setEditingUpload(null)} />
      )}
      <Modal
        open={!!cancelling}
        onClose={busy ? undefined : () => setCancelling(null)}
        title={`Cancel ${docNumber(cancelling) || 'invoice'}`}
        note={cancelling ? `${cancelling.issued_to || cancelling.clientName || 'Client'} · ${money(cancelling.grand_total, 2)}` : ''}
        footer={(
          <>
            <Btn onClick={() => setCancelling(null)} disabled={busy}>Keep It</Btn>
            <Btn danger onClick={cancel} disabled={busy}>{busy ? 'Cancelling…' : 'Cancel Invoice'}</Btn>
          </>
        )}
      >
        <p style={{ margin: '0 0 12px', fontSize: 13.5, lineHeight: 1.6 }}>
          The invoice keeps its number and is marked cancelled. It stops counting towards revenue, receivables and GST
          from now on, and stays on the ledger as cancelled so it can be reactivated.
          {cancelling?.converted_from ? ' The document it was converted from can be converted again.' : ''}
        </p>
        <Field label="Reason (optional)">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Client dropped the order, wrong amount, duplicate" />
        </Field>
      </Modal>
    </>
  );

  return { view, menu, receiptMenu, dialogs };
}
