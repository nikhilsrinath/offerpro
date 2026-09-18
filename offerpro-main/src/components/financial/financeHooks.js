// Formatting helpers and the live-section hook shared by the finance pages.
// Kept out of financeUi.jsx so that file exports only components.
import { useEffect, useState } from 'react';
import { orgStore } from '../../services/orgStore';

export const money = (v, digits = 0) => (Number(v) || 0).toLocaleString('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: digits,
});

export const fmtDate = (d) => (d
  ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—');

/** Live list for an orgStore section; re-renders on every write to it. */
export function useSection(section) {
  const [list, setList] = useState(() => orgStore.getSectionAsList(section));
  useEffect(() => orgStore.listenSection(section, (value) => {
    setList(Object.values(value || {}));
  }), [section]);
  return list;
}
