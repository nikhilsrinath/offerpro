import { useCallback, useRef, useState } from 'react';
import { ModalSwap } from './modalSwap';
import { orgStore } from '../../services/orgStore';
import { loadFinanceCategories } from '../../services/financeCategories';
import { pickerFor, pickerFromAllocations } from '../../services/projectService';
import CashEntryModal from './CashEntryModal';
import VendorPaymentModal from './VendorPaymentModal';
import PurchaseBillModal from './PurchaseBillModal';
import { blank as blankEntry } from './cashEntry';
import { billForEdit, blankBill } from './billMath';
import { defaultType, ledgerTypes } from './ledgerTypes';

/**
 * Record Money's Credit and Debit, one flow wherever they are offered: the
 * Company Ledger, and the Vendor Company and General Ledgers (`party`
 * 'vendor'). The form opens straight away with its Type as the first row.
 * Sales & Services is a purchase bill, Vendor Payment pays a vendor, and any
 * other Type is a General Ledger entry (on the project, when there is one)
 * with its Sub-Type. Picking another Type swaps the form.
 *
 * `startOn` is the project a new bill or entry starts on; `projectClient` the
 * client a new credit is from, when not on a vendor's page. Render `forms`.
 */
export function useRecordMoney({ projectId = null, startOn = null, party = null, projectClient = '' }) {
  const [bill, setBill] = useState(null);
  const [entry, setEntry] = useState(null);
  const [payingVendor, setPayingVendor] = useState(null);
  // 'in' | 'out' while a new Credit or Debit from Record Money is open, so its form shows the Type.
  const [recording, setRecording] = useState(null);
  // The saved bill whose Type is being changed to another kind of credit.
  const [converting, setConverting] = useState(null);
  // A Type switch replaces the open form in place, so the new one does not animate in.
  const [swapped, setSwapped] = useState(false);
  // Each bill opened is a fresh form, even when one replaces another.
  const seq = useRef(0);
  const showBill = (b) => setBill(b && { ...b, _seq: ++seq.current });

  const freshBill = useCallback((vendorId = '') => (startOn
    ? { ...blankBill(vendorId), _picker: pickerFor(startOn) }
    : blankBill(vendorId)), [startOn]);
  const freshEntry = useCallback((direction) => ({
    ...blankEntry(direction),
    ...(startOn ? { _picker: pickerFor(startOn) } : {}),
    ...(direction === 'in' && party === 'vendor' ? { vendor_id: '' }
      : direction === 'in' && projectClient ? { client_id: projectClient } : {}),
  }), [startOn, projectClient, party]);

  const closeAll = () => { setBill(null); setEntry(null); setPayingVendor(null); setConverting(null); };

  // A new Credit or Debit of one Type: that Type's form, in place of the open one.
  const openType = (direction, label) => {
    const type = ledgerTypes(direction).find((x) => x.label === label);
    setSwapped(!!(bill || entry || payingVendor));
    closeAll();
    setRecording(direction);
    if (type?.kind === 'bill') showBill(freshBill(''));
    else if (type?.kind === 'vendor') setPayingVendor({ vendorId: '' });
    else setEntry({ ...freshEntry(direction), ...(type?.group.items[0] ? { category: type.group.items[0].key } : {}) });
  };
  // A vendor's ledger opens on the purchase bill or Vendor Payment.
  const record = async (direction) => {
    await loadFinanceCategories();
    openType(direction, defaultType(direction, party === 'vendor')?.label);
  };
  // A saved General Ledger entry, a bill, a new bill for a vendor, paying one.
  const openEntry = (r, direction) => {
    const full = r._full || r;
    setSwapped(false);
    closeAll();
    setRecording(null);
    setEntry({ ...full, direction, date: full.date || full.received_on || full.incurred_on });
  };
  const editBill = (b) => { setSwapped(false); closeAll(); setRecording(null); showBill(billForEdit(b)); };

  /**
   * A saved bill given another Type: the credit entry form, filled in from the
   * bill, which replaces the bill once it is saved. Picking Sales & Services
   * again goes back to the bill as it was.
   */
  const convertBill = (label, billId) => {
    const type = ledgerTypes('in').find((x) => x.label === label);
    const original = orgStore.getSectionAsList('purchase_invoices').find((x) => x.id === billId);
    if (!type || !original) return;
    setSwapped(true);
    closeAll();
    setRecording(null);
    if (type.kind === 'bill') { showBill(billForEdit(original)); return; }
    setConverting(original.id);
    const projectPick = projectId ? null : pickerFromAllocations('purchase_invoice', original.id);
    setEntry({
      ...freshEntry('in'),
      ...(projectPick ? { _picker: projectPick } : {}),
      category: type.group.items[0]?.key || '',
      vendor_id: original.vendor_id || '', client_id: '',
      original_amount: String(Number(original.total) || 0),
      description: original.description || `Bill ${original.bill_number || ''}`.trim(),
      date: original.bill_date || freshEntry('in').date,
      receipt_path: original.receipt_path || null,
      receipt_number: original.bill_number || '',
      notes: original.notes || '',
      _replacesBill: original.id,
    });
  };
  const newBill = (vendorId = '') => { setSwapped(false); closeAll(); setRecording(null); showBill(freshBill(vendorId)); };
  const payVendor = (vendorId = '') => { setSwapped(false); closeAll(); setRecording(null); setPayingVendor({ vendorId }); };

  const forms = (
    <ModalSwap.Provider value={swapped}>
      {bill && (
        <PurchaseBillModal key={bill._seq} bill={bill} projectId={projectId} party={party}
          onType={recording === 'in' && !bill.id ? (label) => openType('in', label) : undefined}
          onConvert={bill.id ? (label) => convertBill(label, bill.id) : undefined}
          onClose={() => setBill(null)} />
      )}
      {entry && <CashEntryModal key={entry.id || `new-${entry.direction}-${entry.category}`} entry={entry} fresh={freshEntry} projectId={projectId} party={party}
        onType={converting ? (label) => convertBill(label, converting)
          : recording && !entry.id ? (label) => openType(recording, label) : undefined}
        onClose={() => { setEntry(null); setConverting(null); }} />}
      {payingVendor && (
        <VendorPaymentModal vendorId={payingVendor.vendorId} startOn={startOn} projectId={projectId} party={party}
          onType={recording === 'out' ? (label) => openType('out', label) : undefined} onClose={() => setPayingVendor(null)} />
      )}
    </ModalSwap.Provider>
  );

  return { record, openEntry, editBill, newBill, payVendor, forms };
}
