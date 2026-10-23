import { INDIAN_STATES } from '../../data/indianStates';

// Indian states only make sense for India (or before a country is picked, when
// it is worked out from the org). Any other country gets a free-text field.
export default function PlaceOfSupplyInput({ id, country, value, onChange }) {
  const india = !country || country === 'IN';
  if (!india) {
    return (
      <input id={id} value={value || ''} placeholder="State, province or region"
        onChange={(e) => onChange(e.target.value)} />
    );
  }
  const custom = value && !INDIAN_STATES.includes(value);
  return (
    <select id={id} value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">Not recorded</option>
      {custom && <option value={value}>{value}</option>}
      {INDIAN_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
    </select>
  );
}
