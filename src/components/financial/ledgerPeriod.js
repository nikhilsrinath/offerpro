import { useState } from 'react';
import { periodBounds } from '../../services/financeAnalytics';

/** The period picked on the ledger's bar (LedgerBar), and the dates it runs between (null for open-ended). */
export function useLedgerPeriod() {
  const [preset, setPreset] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const range = preset === 'custom' ? { from: from || null, to: to || null } : periodBounds(preset);
  return { preset, setPreset, from, setFrom, to, setTo, range };
}

/** A project filter's choices over the whole company: all, General (on no project) or one. */
export function projectChoices(projects, current) {
  return [
    ['all', 'All projects'], ['general', 'General (no project)'],
    ...projects.filter((p) => !p.archived_at || p.id === current).map((p) => [p.id, [p.code, p.name].filter(Boolean).join(' · ')]),
  ];
}
