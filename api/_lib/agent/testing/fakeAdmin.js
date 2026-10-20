/**
 * A service-role client over fakeDb's tables, with 0089/0090's agent
 * functions modelled (agent_run_claim, agent_run_finish, agent_alerts_commit),
 * for the scheduled-run tests. The same model operations.test.js keeps
 * inline. Not a test file itself.
 *
 * `clock()` gives the time the functions stamp; pass the test's own.
 */
export function fakeAdmin(db, clock = () => new Date()) {
  const T = db.tables;
  for (const t of ['agent_runs', 'agent_alerts', 'notifications', 'agent_settings']) T[t] = T[t] || [];
  let n = 0;
  const rpc = {
    agent_run_claim: ({ p_org, p_agent, p_key, p_trigger }) => {
      const hit = T.agent_runs.find((r) => r.org_id === p_org && r.agent === p_agent && r.run_key === p_key);
      if (!hit) {
        const id = `run-${++n}`;
        T.agent_runs.push({ id, org_id: p_org, agent: p_agent, run_key: p_key, trigger: p_trigger, status: 'running', attempt: 1, started_at: clock().toISOString() });
        return id;
      }
      if (hit.status === 'failed') { Object.assign(hit, { status: 'running', attempt: hit.attempt + 1 }); return hit.id; }
      return null;
    },
    agent_run_finish: ({ p_run, p_status, p_stats, p_error }) => {
      const r = T.agent_runs.find((x) => x.id === p_run && x.status === 'running');
      if (r) Object.assign(r, { status: p_status, stats: p_stats, error: p_error || null });
    },
    agent_alerts_commit: ({ p_org, p_agent, p_seen, p_sent, p_notifs }) => {
      const stamp = clock().toISOString();
      for (const s of p_seen) {
        const a = T.agent_alerts.find((x) => x.org_id === p_org && x.agent === p_agent && x.dedupe_key === s.key);
        if (a) Object.assign(a, { severity: s.severity, last_seen_at: stamp, last_notified_at: a.resolved_at ? null : a.last_notified_at, resolved_at: null });
        else T.agent_alerts.push({ org_id: p_org, agent: p_agent, dedupe_key: s.key, severity: s.severity, notify_count: 0, first_seen_at: stamp, last_seen_at: stamp, last_notified_at: null, resolved_at: null });
      }
      for (const a of T.agent_alerts) {
        if (a.org_id !== p_org || a.agent !== p_agent) continue;
        if (p_sent.includes(a.dedupe_key)) Object.assign(a, { last_notified_at: stamp, notified_severity: a.severity, notify_count: a.notify_count + 1 });
        if (!a.resolved_at && !p_seen.some((s) => s.key === a.dedupe_key)) a.resolved_at = stamp;
      }
      const members = (T.memberships || []).filter((m) => m.org_id === p_org).map((m) => m.user_id);
      const ok = p_notifs.filter((x) => members.includes(x.user_id));
      for (const x of ok) T.notifications.push({ org_id: p_org, type: p_agent, ...x });
      return ok.length;
    },
  };
  return {
    ...db,
    from: (t) => db.from(t),
    rpc: async (fn, params) => {
      db.writes.push({ op: 'rpc', fn, params });
      if (rpc[fn]) return { data: rpc[fn](params), error: null };
      return db.rpc(fn, params);
    },
    auth: { admin: { getUserById: async (id) => ({ data: { user: { email: `${id}@mail.test` } } }) } },
  };
}

/** deps for a run with no mail server: the org's Gmail is not set up. */
export const noMail = (now) => ({
  now: () => now,
  loadOrgCredentials: async () => { const e = new Error('Email is not configured.'); e.status = 412; throw e; },
});
