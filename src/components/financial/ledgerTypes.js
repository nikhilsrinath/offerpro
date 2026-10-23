import { groupedCategories } from '../../services/financeCategories';

/** Sales & Services on the Credit side is goods or services taken on a bill. */
const isSalesGroup = (label) => /^sales/i.test(String(label || ''));

/** Product & Delivery on the Debit side is shown, and works, as Vendor Payment. */
const isVendorGroup = (label) => /^product\s*&\s*delivery/i.test(String(label || ''));

export const VENDOR_LABEL = 'Vendor Payment';

/**
 * The Types of a Credit or Debit, the category groups, each with the form it
 * is recorded on: 'bill' (Sales & Services on the Credit side, a purchase bill
 * owed to the vendor), 'vendor' (Product & Delivery on the Debit side, shown
 * as Vendor Payment: always against what is pending or an advance, so it has
 * no Sub-Type) or 'entry' (any other, with its categories as Sub-Types).
 */
export function ledgerTypes(direction) {
  const isIn = direction === 'in';
  return groupedCategories(direction).map((g) => {
    const kind = isIn && isSalesGroup(g.label) ? 'bill' : !isIn && isVendorGroup(g.label) ? 'vendor' : 'entry';
    return { label: g.label, name: kind === 'vendor' ? VENDOR_LABEL : g.label, kind, group: g };
  });
}

export const kindOfType = (direction, label) => ledgerTypes(direction).find((x) => x.label === label)?.kind || 'entry';

/** The Type a fresh Credit or Debit opens on: the purchase bill or Vendor
    Payment on a vendor's ledger, otherwise the first one. */
export function defaultType(direction, vendorSide = false) {
  const types = ledgerTypes(direction);
  const want = vendorSide ? (direction === 'in' ? 'bill' : 'vendor') : null;
  return (want && types.find((x) => x.kind === want)) || types[0] || null;
}

export const TYPE_NOTES = {
  bill: 'Goods or services taken on a bill, owed to the vendor.',
  vendor: 'Paid to a vendor, against what is pending or as an advance before their bill.',
};
