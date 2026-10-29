import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FilePlus, FileUp, Eye, Paperclip } from 'lucide-react';
import { Modal } from './financeUi';
import { money } from './financeHooks';
import { GST_RATES } from './cashEntry';
import ProjectPicker from '../shared/ProjectPicker';
import { documentStore } from '../../services/documentStore';
import { orgStore } from '../../services/orgStore';
import { receiptService, validateReceipt, RECEIPT_ACCEPT } from '../../services/receiptService';
import { pickerFor, pickerFromAllocations, saveSplitFromPicker } from '../../services/projectService';
import { documentTotals } from '../../shared/finDocs';
import { useToast } from '../shared/Toast';

const TITLE = 'Create/Upload Client Invoice';
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The Client General Ledger's Create/Upload Client Invoice: Generate Invoice
 * goes to Billing's invoice form, Upload Invoice takes a file from the
 * computer and asks only what the ledger needs from it.
 *
 * An uploaded invoice is an ordinary invoice row, issued, with one line for
 * its amount before GST, so the totals trigger, Billing, the portal and the
 * ledger read it like any other. The file sits in the private receipts bucket
 * and its path rides in the payload (`upload_path`, `uploaded`).
 *
 * With `invoice` (an uploaded invoice, from a ledger row's Edit) it opens on
 * the details of that invoice: the same number, its file kept unless
 * replaced, and saving updates it in place.
 */
export default function ClientInvoicePanel({ clients, clientId = '', projectId = null, startOn = projectId, invoice = null, onClose }) {
  const navigate = useNavigate();
  const toast = useToast();
  const fileInput = useRef(null);
  const [step, setStep] = useState(invoice ? 'details' : 'choose');
  // The file on hand; `kept` is the one the saved invoice already has, which
  // closing without saving must not remove.
  const [file, setFile] = useState(invoice?.upload_path ? { path: invoice.upload_path, name: invoice.upload_name || 'Invoice file', kept: true } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(() => (invoice ? {
    doc_number: invoice.doc_number || '', customer_id: invoice.customer_id || '',
    issue_date: invoice.issue_date || today(), due_date: invoice.due_date || '',
    amount: String(Number(invoice.items?.[0]?.rate ?? invoice.subtotal) || ''),
    gst_rate: invoice.gst_enabled === false ? 0 : Number(invoice.gstRate ?? invoice.gst_rate) || 0,
    notes: invoice.notes || '', _picker: pickerFromAllocations('invoice', invoice.id),
  } : {
    doc_number: '', customer_id: clientId || '', issue_date: today(), due_date: '',
    amount: '', gst_rate: 18, notes: '', _picker: pickerFor(startOn || ''),
  }));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const generate = () => {
    onClose();
    navigate('/clients/billing/invoices/new', { state: { projectId: startOn, clientId: clientId || undefined } });
  };

  // Uploaded first, so the details step always has its file.
  const pick = async (e) => {
    const chosen = e.target.files?.[0];
    e.target.value = '';
    if (!chosen) return;
    const problem = validateReceipt(chosen);
    if (problem) { setError(problem.replace('Receipts', 'Invoices').replace('Receipt', 'The invoice')); return; }
    setBusy(true);
    setError('');
    try {
      const path = await receiptService.upload(orgStore.getOrgId(), 'invoices', chosen);
      if (file?.path && !file.kept) receiptService.remove(file.path);
      setFile({ path, name: chosen.name });
      setStep('details');
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  // Closed without saving: a file uploaded here goes too; the saved one stays.
  const close = () => {
    if (file?.path && !file.kept) receiptService.remove(file.path);
    onClose();
  };

  const rate = Number(form.gst_rate) || 0;
  const totals = useMemo(() => documentTotals({
    items: [{ quantity: 1, rate: Number(form.amount) || 0 }], gstEnabled: rate > 0, gstRate: rate,
  }), [form.amount, rate]);

  const save = async (e) => {
    e.preventDefault();
    const client = clients.find((c) => c.id === form.customer_id);
    if (!client) { setError('Choose the client this invoice is for.'); return; }
    if (!(Number(form.amount) > 0)) { setError('Enter the amount before GST.'); return; }
    setBusy(true);
    setError('');
    try {
      if (!file?.path) { setError('Upload the invoice file.'); setBusy(false); return; }
      const saved = await documentStore.save({
        ...(invoice ? { id: invoice.id } : {}),
        type: 'invoice',
        // Editing keeps where its payments put it.
        status: invoice ? invoice.status : 'sent',
        title: 'Tax Invoice',
        doc_number: form.doc_number.trim() || undefined,
        customer_id: client.id,
        clientName: client.name,
        clientEmail: client.email,
        clientAddress: client.address,
        buyerGSTIN: client.gstin,
        buyerState: client.state,
        issue_date: form.issue_date,
        due_date: form.due_date || undefined,
        items: [{ description: 'As per the uploaded invoice', quantity: 1, rate: Number(form.amount), unit: '' }],
        enableGst: rate > 0,
        gstRate: rate,
        notes: form.notes.trim() || (invoice ? '' : undefined),
        uploaded: true,
        upload_path: file.path,
        upload_name: file.name,
      });
      try {
        await saveSplitFromPicker('invoice', saved?.id, form._picker);
      } catch (allocErr) {
        toast(`Invoice saved, but the project split was not: ${allocErr.message}`, 'error');
      }
      // The file it had before, now replaced.
      if (invoice?.upload_path && invoice.upload_path !== file.path) receiptService.remove(invoice.upload_path);
      toast(invoice ? 'Invoice updated' : 'Invoice uploaded', 'success');
      onClose();
    } catch (err) {
      setError(err?.code === '23505' || /unique|duplicate/i.test(err.message || '')
        ? `Invoice No ${form.doc_number.trim()} is already used. Enter a different number.`
        : err.message || 'The invoice was not saved.');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'choose') {
    return (
      <Modal title={TITLE} onClose={close}>
        <div className="prod-modal-body">
          <input ref={fileInput} type="file" accept={RECEIPT_ACCEPT} hidden aria-label="Invoice file" onChange={pick} />
          {error && <div className="prod-form-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'grid', gap: 10 }}>
            <ChoiceBtn icon={FileUp} label={busy ? 'Uploading...' : 'Upload Invoice'} disabled={busy}
              note="An invoice made outside EdgeOS. Choose the PDF or image from your computer."
              onClick={() => fileInput.current?.click()} />
            <ChoiceBtn icon={FilePlus} label="Generate Invoice" disabled={busy}
              note="Build a new tax invoice in Billing, with line items, GST and payment terms."
              onClick={generate} />
          </div>
          <p className="prod-field-note" style={{ marginTop: 12 }}>PDF, PNG, JPEG or WebP, up to 5 MB. Stored privately.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={invoice ? `Edit Invoice ${invoice.doc_number || ''}`.trim() : 'Upload Invoice'} onClose={close} dirty>
      <form onSubmit={save} className="prod-modal-body cb-form">
        {error && <div className="prod-form-error" role="alert">{error}</div>}
        <input ref={fileInput} type="file" accept={RECEIPT_ACCEPT} hidden aria-label="Invoice file" onChange={pick} />
        <div className="prod-form-grid">
          <div className="prod-field full">
            <label>Invoice File</label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{file.name}</span>
              <button type="button" className="prod-btn-ghost" onClick={() => receiptService.open(file.path)}>
                <Eye size={13} /> View
              </button>
              <button type="button" className="prod-btn-ghost" disabled={busy} onClick={() => fileInput.current?.click()}>
                <Paperclip size={13} /> Replace
              </button>
            </div>
          </div>

          <div className="prod-field">
            <label htmlFor="ui-no">Invoice No</label>
            <input id="ui-no" value={form.doc_number} placeholder="As printed on the invoice" readOnly={!!invoice}
              onChange={(e) => set('doc_number', e.target.value)} />
            <p className="prod-field-note">{invoice ? 'A saved invoice keeps its number.' : 'Left blank, it takes the next number.'}</p>
          </div>

          <div className="prod-field">
            <label className="req" htmlFor="ui-client">Client</label>
            <select id="ui-client" required value={form.customer_id} onChange={(e) => set('customer_id', e.target.value)}>
              <option value="">Choose a client</option>
              {clients.filter((c) => !c.archived_at || c.id === form.customer_id)
                .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="prod-field">
            <label className="req" htmlFor="ui-date">Invoice Date</label>
            <input id="ui-date" type="date" required value={form.issue_date} onChange={(e) => set('issue_date', e.target.value)} />
          </div>

          <div className="prod-field">
            <label htmlFor="ui-due">Due Date</label>
            <input id="ui-due" type="date" value={form.due_date} min={form.issue_date || undefined}
              onChange={(e) => set('due_date', e.target.value)} />
          </div>

          <div className="prod-field">
            <label className="req" htmlFor="ui-amount">Amount Before GST</label>
            <input id="ui-amount" type="number" min="0.01" step="0.01" required inputMode="decimal" placeholder="0"
              value={form.amount} onChange={(e) => set('amount', e.target.value)} />
          </div>

          <div className="prod-field">
            <label htmlFor="ui-gst">GST Rate</label>
            <select id="ui-gst" value={form.gst_rate} onChange={(e) => set('gst_rate', Number(e.target.value))}>
              {GST_RATES.map((r) => <option key={r} value={r}>{r === 0 ? 'No GST' : `${r}%`}</option>)}
            </select>
          </div>

          <div className="prod-field full">
            <p className="prod-field-note" aria-live="polite">
              GST {money(totals.gst, 2)} · Invoice total <strong>{money(totals.grandTotal, 2)}</strong>, owed by the client.
            </p>
          </div>

          {/* Inside a project it is that project's, and not asked. */}
          {!projectId && (
            <ProjectPicker label="Project or General" noneLabel="Others (not for a project)"
              value={form._picker} onChange={(p) => set('_picker', p)}
              net={totals.taxable} clientId={form.customer_id || null} />
          )}

          <div className="prod-field full">
            <label htmlFor="ui-notes">Notes</label>
            <textarea id="ui-notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
        </div>

        <div className="prod-modal-foot">
          <button type="button" className="prod-btn-ghost" onClick={close}>Cancel</button>
          <button type="submit" className="prod-btn-primary" disabled={busy}>{busy ? 'Saving...' : invoice ? 'Save Changes' : 'Save Invoice'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** One of the two ways to make a client invoice. */
function ChoiceBtn({ icon: Icon, label, note, onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="edge-tr" style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px', borderRadius: 12, width: '100%',
      textAlign: 'left', fontFamily: 'inherit', cursor: disabled ? 'default' : 'pointer',
      background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)',
    }}>
      <span aria-hidden="true" style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center',
        background: 'var(--bg-raised)', color: 'var(--text-primary)',
      }}><Icon size={17} /></span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>{note}</span>
      </span>
    </button>
  );
}
