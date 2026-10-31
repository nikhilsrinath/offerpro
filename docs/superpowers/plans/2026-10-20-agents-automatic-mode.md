# Agents Automatic Mode (Phases 1–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An on/off switch on every Ask → Agents card, and automatic (scheduled, alerting) modes for Deal Intelligence and Business Intelligence, on the same run/alert tables the two existing daily agents use.

**Architecture:** A small shared runner (`api/_lib/agentRun.js`) does claim → evaluate → commit alerts → email → finish for any agent. Deal and BI each add pure alert/digest rules in `src/shared/` and a server run in their `api/_lib/` file. `/api/agents` gains a per-agent cron GET, a cross-agent `automation` status/set call, and `settings`/`run` modes for Deal and BI. The cards get a switch.

**Tech Stack:** Vercel functions (Node ESM), Supabase (service role for runs), React, Vitest with `api/_lib/agent/testing/fakeDb.js`.

**Spec:** `docs/superpowers/specs/2026-10-20-agents-automatic-mode-design.md`

## Global Constraints

- Automatic runs never call `api/_lib/llm.js` and never write business records. Writes: `agent_settings`, `agent_runs`, `agent_alerts`, `notifications` (via `agent_alerts_commit`), and the optional digest email.
- No new migration. Uses 0089 tables + 0090 `agent_alerts_commit(p_org, p_agent, p_seen, p_sent, p_notifs)`.
- Agent ids: `deadline_watch`, `operations_monitor`, `deal_intelligence`, `business_intelligence`, `internal_knowledge`.
- Recipients: owners and admins (`recipientsOf` in `api/_lib/deadlines.js`).
- Every alert names counts and links its records; a figure from a table that was not read is left out and named, never shown as 0.
- UI copy: headings/buttons/tabs Title Case, body sentence case, no ALL CAPS; no focus ring on inputs; match the existing `ag-*` styles.
- Default for every agent: `daily: false`, `email_digest: false`, `notify_min: 'high'`, `repeat_days: 3`.

## Review Focus

- Switch flipped while 0089 tables are missing on the database → switch disabled with "Needs database migration 0089", no fake "On" state. (Task 6 test `status reports unavailable`.)
- Weekly summary trigger on the wrong day because of UTC vs org timezone (cron at 02:30 UTC is already Monday 08:00 IST) → day is taken from `todayIn(org tz)`. (Task 4 test `weekly runs only on summary_day in the org's timezone`.)
- A member (not owner/admin) calls `automation set` or Deal/BI `settings`/`run` directly → 403, nothing saved. (Task 6 tests.)
- BI daily alert on a finance insight whose tables were not visible → never alerted (insight absent). Weekly summary with expenses unreadable → "left out" line, no ₹0. (Task 4 test `summary names figures it could not read`.)
- Same deal risk on consecutive days → alerted once, again only after `repeat_days` or on escalation. (Task 3 test `second day does not resend`.)

---

### Task 1: Shared runner

**Files:**
- Create: `api/_lib/agentRun.js`
- Test: `api/_lib/agentRun.test.js`

**Interfaces:**
- Consumes: `recipientsOf(admin, orgId)`, `emailDigest(orgId, recipients, digest, orgName, deps, label)` from `api/_lib/deadlines.js`; `todayIn`, `DEFAULT_TZ` from `src/shared/dates.js`.
- Produces:
  - `runAgentPass(admin, org, { agent, label, trigger = 'schedule', deps = {}, force = false, runKey = null, settings, evaluate }) → Promise<{ org, status: 'succeeded'|'skipped'|'failed', run?, reason?, ...stats }>`
    - `settings`: the result of a `readSettings` call (`{ config, unavailable? }`).
    - Skips with `reason: 'migration 0089 not applied'` when `settings.unavailable`; with `'daily run off'` when `trigger==='schedule' && !config.daily && !force`; with `'already ran or running'` when the claim returns null.
    - Run key: `runKey ?? (trigger === 'schedule' ? today : 'manual:' + now.toISOString().slice(0,16))`, `today = todayIn(org tz, now)`, `now = deps.now?.() ?? new Date()`.
    - `evaluate({ config, today, now, tz }) → Promise<{ seen: Array<{key, record_type, record_id, due_date, severity}>, due: Array<{finding:{key}}>, digest: {title, message, text} | null, emailDigest?: digest, stats: object }>`. A thrown error fails the run.
    - Then: recipients (only when `digest`), `agent_alerts_commit` with notifs = one per recipient `{ title, message, user_id }`, email when `digest && config.email_digest` (uses `emailDigest ?? digest`), `agent_run_finish`. Returned/stored stats = `{ ...stats, alerted: due.length, notifications, recipients, email }`.
  - `runAgentScheduled(admin, { agent, normalize, runOne, budgetMs = 45000 }) → Promise<result[]>`: orgs from `agent_settings` where `normalize(config).daily`, each through `runOne(org)`, `'deferred'` past budget (same as `runOpsScheduled`).

- [ ] **Step 1: Write failing tests** (`fakeDb` seeded like `operations.test.js`, `agent: 'test_agent'`): `skips when daily is off`; `claims once per day` (second call same `now` → skipped 'already ran or running'); `commits seen and sent and notifies owners and admins only` (member gets no notification); `no digest → no notifications, run succeeded`; `evaluate throws → run failed with the message, nothing committed`; `emails only when email_digest is on` (deps stub `loadOrgCredentials` returns null → stats.email `'not_configured'`); `scheduled defers orgs past the budget`.
- [ ] **Step 2:** `npx vitest run api/_lib/agentRun.test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement both functions, lifted from `runOpsForOrg` / `runOpsScheduled` (`api/_lib/operations.js:250-337`). Do not change the two existing agents.
- [ ] **Step 4:** Rerun → PASS.
- [ ] **Step 5:** Commit `feat: shared runner for scheduled agent passes`.

### Task 2: Deal alert rules (pure)

**Files:**
- Modify: `src/shared/dealIntel.js` (DEFAULT_CONFIG at :54, normalizeConfig at :71)
- Test: `src/shared/dealIntel.test.js`

**Interfaces:**
- Produces:
  - `DEFAULT_CONFIG` gains `notify_min: 'high', repeat_days: 3, email_digest: false, daily: false`; `normalizeConfig` keeps them (`notify_min` ∈ SEVERITIES, `repeat_days` int 0–60, booleans only if boolean).
  - `AGENT_NAME = 'Deal Intelligence Agent'`.
  - `dealAlertsDue(findings, sent, config, now) → [{ finding, why }]` — delegates to `alertsDue` from `deadlineWatch.js` with `{ notify_min, repeat_days }`.
  - `buildDealDigest(findings, due, orgName = '') → { title, message, text, lines }`. Title `Deal Intelligence Agent: 2 critical, 1 high`. Each line `• [severity] <deal name> — <title>. <next_step>`, max 12 then `…and N more.`; text ends `Open Opstead → Ask → Agents → Deal Intelligence Agent for the full list.`

- [ ] **Step 1: Failing tests:** `normalizeConfig keeps alert settings and drops a bad notify_min`; `dealAlertsDue sends new high findings and not medium by default`; `escalation resends`; `buildDealDigest counts by severity and caps at 12 lines`.
- [ ] **Step 2:** Run `npx vitest run src/shared/dealIntel.test.js` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun → PASS (and the existing dealIntel tests still pass).
- [ ] **Step 5:** Commit `feat: deal intelligence alert rules`.

### Task 3: Deal Intelligence server run

**Files:**
- Modify: `api/_lib/deals.js`
- Test: `api/_lib/deals.test.js`

**Interfaces:**
- Consumes: Task 1 `runAgentPass`, `runAgentScheduled`; Task 2 rules; `readSettings(admin, orgId, agent, normalize)`, `alertState(admin, orgId, agent)` from `deadlines.js`; `buildDealSnapshot`, `loadDealRows`.
- Produces:
  - `readDealSettings(admin, orgId) → { config, updated_at, unavailable? }`
  - `saveDealSettings(admin, orgId, userId, raw) → config` (upsert like `operations.js:178`, message `Deal Intelligence Agent settings need database migration 0089.`)
  - `runDealsForOrg(admin, org, { trigger, deps, force }) → result` — loads with `loadDealRows(admin, org.id, () => true)`; fails if `coverage.clients` is not ok/truncated; seen = every finding `{ key, record_type: category, record_id: deal.id, due_date: null, severity }`; stats `{ today, findings, critical, high, open_deals }`.
  - `runDealsScheduled(admin, { budgetMs, deps })`.
  - `dealSnapshotFor(ctx, { period, compare, config })` unchanged signature; the endpoint now passes the saved config.

- [ ] **Step 1: Failing tests:** `run alerts owners and admins about a quotation unanswered for 22 days`; `second day does not resend` (advance `now` one day; `alerted: 0`); `reads only this org` (rival org's deal never in the digest); `daily off → skipped`; `clients table unreadable → failed run, nothing sent`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: deal intelligence daily run`.

### Task 4: Business Intelligence rules and server run

**Files:**
- Modify: `src/shared/bizIntel.js`, `api/_lib/bizIntel.js`
- Test: `src/shared/bizIntel.test.js`, `api/_lib/bizIntel.test.js`

**Interfaces:**
- Produces (shared):
  - `AGENT_NAME = 'Business Intelligence Agent'`; `AUTO_DEFAULTS = { daily: false, weekly_summary: true, summary_day: 1, notify_min: 'high', repeat_days: 3, email_digest: false }`; `normalizeAutoConfig(raw)` (`summary_day` int 0–6, 0 = Sunday).
  - `bizAlertable(insights) → findings` — `area === 'finance'` and `severity !== 'positive'`; each `{ ...insight, key: insight.id }`.
  - `bizAlertsDue(findings, sent, config, now)` — delegates to deadlineWatch `alertsDue`.
  - `buildBizDigest(findings, due, orgName) → { title, message, text }` — lines `• [severity] <title>: <finding> <next_step>`.
  - `lastWeek(today) → { from, to, prevFrom, prevTo }` — the Monday–Sunday before `today`'s week and the week before it.
  - `buildWeeklySummary(snap, orgName) → { title, message, text }` — title `Business Intelligence Agent: week of <from> – <to>`; lines for invoiced, collected, cash in/out, receivable outstanding and overdue, payable overdue, each with the change vs the week before (`change`/`pctText`); a null figure becomes `<label>: left out (could not read <tables>)`; then up to 5 non-positive insights.
- Produces (server):
  - `readBizSettings`, `saveBizSettings` (as Task 3).
  - `runBizForOrg(admin, org, { trigger, deps, force }) → result` — daily: loads with `loadSources(admin, org.id, () => true)`, `buildSnapshot` for `this_month` vs `previous`, alerts `bizAlertsDue(bizAlertable(snap.insights))`; seen `{ key, record_type: 'insight', record_id: null, due_date: null, severity }`.
  - `runBizWeeklyForOrg(admin, org, { deps, force }) → result` — runs only when `config.daily && config.weekly_summary` and the org-timezone weekday of today equals `summary_day` (or `force`); run key `week:<lastWeek.from>`; snapshot `{ from, to }` vs `{ prevFrom, prevTo }`; digest = weekly summary, `due: []`, `seen: []`, always notifies.
  - `runBizScheduled(admin, { budgetMs, deps })` — per org: daily pass then weekly pass.

- [ ] **Step 1: Failing tests:** shared — `bizAlertable keeps finance concerns only`; `lastWeek on a Wednesday gives the Monday–Sunday before`; `summary names figures it could not read` (coverage `expenses: 'not_visible'` → text contains `left out`, not `₹0`). Server — `daily run alerts large overdue receivables once`; `weekly runs only on summary_day in the org's timezone` (`now = 2026-10-18T20:00Z` is Monday 01:30 IST → runs; `2026-10-19T20:00Z` → skipped); `weekly sends once per week` (second Monday call skipped); `weekly off → no summary`.
- [ ] **Step 2:** Run both test files → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS, existing bizIntel tests still pass.
- [ ] **Step 5:** Commit `feat: business intelligence daily alerts and weekly summary`.

### Task 5: Agent registry and endpoint

**Files:**
- Create: `api/_lib/agentRegistry.js`
- Modify: `api/agents.js`, `vercel.json`
- Test: `api/_lib/agentsEndpoint.test.js`

**Interfaces:**
- Produces:
  - `SERVER_AGENTS: Record<id, { name, read(admin, orgId), save(admin, orgId, userId, raw), runScheduled(admin, opts), runOne(admin, org, opts) }>` for `deadline_watch`, `operations_monitor`, `deal_intelligence`, `business_intelligence`.
  - `GET /api/agents?agent=<id>` (cron auth unchanged) → that agent's `runScheduled` with `budgetMs: 50000`; unknown id → 400; no `agent` → today's deadline+ops behaviour.
  - `POST { agent: 'automation', mode: 'status', org_id }` (any member) → `{ success, can_manage, unavailable, agents: { [id]: { daily, weekly_summary? } } }`; `internal_knowledge` reported `{ daily: false, coming_soon: true }`.
  - `POST { agent: 'automation', mode: 'set', org_id, target, daily }` (admin) → merges `daily` into that agent's stored config through its `save`; returns `{ success, agents }`. `internal_knowledge` → 400.
  - Deal and BI accept `mode: 'settings'` (admin, `{ config }`) and `mode: 'run'` (admin; BI body may carry `weekly: true` to send the summary now with `force`). Deal snapshot passes the saved config to `dealSnapshotFor`; both snapshots add `settings`, `settings_unavailable`, `can_manage`, and `runs` (owners/admins).
  - `vercel.json` crons: `/api/agents?agent=deadline_watch` `30 2 * * *`, `operations_monitor` `35 2 * * *`, `deal_intelligence` `40 2 * * *`, `business_intelligence` `45 2 * * *` (replacing the single entry).

- [ ] **Step 1: Failing tests:** `status lists all five with daily state`; `status reports unavailable when agent_settings is missing`; `a member cannot set` (403, no row written); `set keeps the agent's other settings`; `cron GET runs only the named agent`; `deal settings and run are admin only`.
- [ ] **Step 2:** Run `npx vitest run api/_lib/agentsEndpoint.test.js` → FAIL.
- [ ] **Step 3:** Implement; keep the file's existing header comment updated with the new modes.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: agents endpoint — automation status/set, per-agent cron`.

### Task 6: Switch on the cards

**Files:**
- Create: `src/components/agents/automation.js` (hook), `src/components/agents/AgentSwitch.jsx`
- Modify: `src/services/agentsService.js`, the five `*Card` components, `src/components/today/AskPage.jsx:101-118`, `src/components/agents/agents.css`, `src/components/shell/ModuleShell.jsx:617-626`

**Interfaces:**
- Produces:
  - `agentsService.automation(orgId)`, `agentsService.setAutomation(orgId, target, daily)`, `dealSaveSettings`, `dealRunNow`, `bizSaveSettings`, `bizRunNow(orgId, { weekly })`.
  - `useAutomation() → { agents, canManage, unavailable, loading, set(id, daily) }` — one status call for the grid; `set` is optimistic and rolls back with an error message.
  - `<AgentSwitch id auto />` — `role="switch"`, `aria-checked`, label `Run automatically`; owners/admins only; others see the existing `ag-state` pill (`Daily` / `Daily · Weekly Summary` / `On Demand`). Disabled with a tooltip when `unavailable` (`Needs database migration 0089`) or `coming_soon` (`Coming Soon`).
  - Cards: the outer element becomes `<div className="ag-card">` holding a full-card `<button className="ag-card-hit">` (open) and the switch above it (no button inside a button). Pills `Read-Only` on BI/Deal become the automation state.
  - `notifTarget`: any of the four server agent ids → `/ask?agent=<id>`.
- [ ] **Step 1:** Implement; `npm run build` passes; `npx vitest run` all green.
- [ ] **Step 2:** In the running app (owner login): flip Deal on → reload → still on; member login → no switch, pill shows state; keyboard Space toggles; card still opens on click.
- [ ] **Step 3:** Commit `feat: run-automatically switch on every agent card`.

### Task 7: Settings, Run Now and Recent Runs on Deal and BI pages

**Files:**
- Create: `src/components/agents/AgentRuns.jsx` (props `{ runs, weeklyKey? }`, same markup as `OperationsMonitor.jsx:412` Runs; a `week:` run shows `Weekly summary`)
- Modify: `src/components/agents/DealIntel.jsx`, `src/components/agents/BusinessIntel.jsx`

**Interfaces:**
- Consumes: Task 5 modes, Task 6 service calls.
- Deal Settings fields: Daily Run, Email Digest, Alert From, Remind Again After, plus `stale_days`, `very_stale_days`, `quote_wait_days`, `quote_expiry_warn_days`, `approval_wait_days`, `critical_after_days`. BI Settings: Daily Run, Weekly Summary, Summary Day (Sunday–Saturday), Email Digest, Alert From, Remind Again After. Same form markup as `OperationsMonitor.jsx:464`. BI header gets **Run Now** and **Send Weekly Summary**.
- Header line: `Alerts every morning` / `Alerts only when run` (+ ` · weekly summary on Mondays` for BI).
- [ ] **Step 1:** Implement; `npm run build`.
- [ ] **Step 2:** Running app: save Deal settings → page findings recomputed with them; Run Now shows the flash (`N alerts sent to owners and admins.` / `Nothing new to alert…`); bell shows the notification and opens `/ask?agent=deal_intelligence`. BI Send Weekly Summary → notification arrives.
- [ ] **Step 3:** Commit `feat: deal and business intelligence settings, run now, recent runs`.

### Task 8: Whole-suite check and notes

- [ ] `npx vitest run` → all green except the known pre-existing reds; `npm run build` passes.
- [ ] Update `docs/superpowers/specs/...-design.md` Status to `built (phases 1–2)`; update memory notes (deal/BI agent memories: now have automatic mode; CRON_SECRET + 0090 still needed on live).
- [ ] Commit `docs: agents automatic mode phases 1–2`.
