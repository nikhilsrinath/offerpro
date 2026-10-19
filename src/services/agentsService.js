import { supabase } from '../lib/supabase';

/**
 * The Agents page's calls to /api/agents. Everything an agent knows comes
 * from the server, through the person's own token: the browser never runs an
 * agent's rules over the whole org, and never sees the alert history of an
 * org it is not an owner or admin of.
 */

async function call(body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('You are signed out. Sign in again.');
  const res = await fetch('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  let out = {};
  try { out = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || out.success === false) throw new Error(out.error || out.result?.reason || `Request failed (${res.status})`);
  return out;
}

export const agentsService = {
  /** Findings over what this person may see, plus settings and recent runs. */
  scan: (orgId) => call({ org_id: orgId, agent: 'deadline_watch', mode: 'scan' }),
  saveSettings: (orgId, config) => call({ org_id: orgId, agent: 'deadline_watch', mode: 'settings', config }),
  runNow: (orgId) => call({ org_id: orgId, agent: 'deadline_watch', mode: 'run' }),
  /** Business Intelligence: a period's figures, the comparison and what needs attention. Read-only. */
  businessSnapshot: (orgId, period = 'this_month', compare = 'previous') => call({ org_id: orgId, agent: 'business_intelligence', mode: 'snapshot', period, compare }),
  /** Deal Intelligence: the pipeline, deals created / won / lost in a period, risks and priorities. Read-only. */
  dealSnapshot: (orgId, period = 'this_month', compare = 'previous') => call({ org_id: orgId, agent: 'deal_intelligence', mode: 'snapshot', period, compare }),
  /** Operations Monitoring: issues, priorities, projects behind, blockers and the week's trend. */
  opsSnapshot: (orgId) => call({ org_id: orgId, agent: 'operations_monitor', mode: 'snapshot' }),
  opsSaveSettings: (orgId, config) => call({ org_id: orgId, agent: 'operations_monitor', mode: 'settings', config }),
  opsRunNow: (orgId) => call({ org_id: orgId, agent: 'operations_monitor', mode: 'run' }),
};

export default agentsService;
