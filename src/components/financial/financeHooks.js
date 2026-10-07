// Formatting helpers and the live-section hook shared by the finance pages.
// Kept out of financeUi.jsx so that file exports only components.
import { useEffect, useState } from 'react';
import { orgStore } from '../../services/orgStore';

export const money = (v, digits = 0) => (Number(v) || 0).toLocaleString('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: digits,
});

export const fmtDate = (d) => (d
  ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : '-');

/** Live list for an orgStore section; re-renders on every write to it. */
export function useSection(section) {
  // listenSection is a no-op until an org is loaded, so a caller mounted
  // before that (the app shell) must subscribe again once one is. And again
  // on a switch, so it never keeps listing the previous org's rows.
  const orgId = orgStore.getOrgId();
  const [list, setList] = useState(() => orgStore.getSectionAsList(section));
  useEffect(() => {
    setList(orgStore.getSectionAsList(section));
    return orgStore.listenSection(section, (value) => {
      setList(Object.values(value || {}));
    });
  }, [section, orgId]);
  return list;
}
