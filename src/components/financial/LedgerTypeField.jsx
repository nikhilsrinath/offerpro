import { useEffect, useState } from 'react';
import { loadFinanceCategories } from '../../services/financeCategories';
import { titleCase } from '../../utils/titleCase';
import { ledgerTypes, TYPE_NOTES } from './ledgerTypes';

/**
 * The Type row at the top of the purchase bill and Vendor Payment forms of a
 * new Credit or Debit. Picking another Type hands over to that Type's form
 * (`onChange(label)`); the General Ledger entry form has its own Type and
 * Sub-Type rows (CashEntryModal).
 */
export default function LedgerTypeField({ direction, value, onChange }) {
  const [, setReady] = useState(false);
  useEffect(() => { loadFinanceCategories().then(() => setReady(true)); }, []);
  const types = ledgerTypes(direction);
  const kind = types.find((x) => x.label === value)?.kind;
  return (
    <div className="prod-field full">
      <label htmlFor="lt-type">Type</label>
      <select id="lt-type" value={value} onChange={(e) => onChange(e.target.value)}>
        {types.map((x) => <option key={x.label} value={x.label}>{titleCase(x.name)}</option>)}
      </select>
      {TYPE_NOTES[kind] && <p className="prod-field-note">{TYPE_NOTES[kind]}</p>}
    </div>
  );
}
