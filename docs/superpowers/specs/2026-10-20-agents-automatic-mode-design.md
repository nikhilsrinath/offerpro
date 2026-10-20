# Agents: automatic mode for all five — design

Date: 2026-10-20 · Status: approved; phases 1–2 built (uncommitted), phase 3 not started

## Why

Ask → Agents gets an on/off switch on every agent card. Today only two agents
(Compliance and Deadline, Operations Monitoring) can run on their own; the
other three answer only when someone opens them. The owner wants every agent
to be able to work in the background once it is switched on, so problems
reach the team without anyone opening the page.

## Goals

- One switch per agent card: **On** = the agent runs on its own schedule and
  alerts; **Off** = it still works when opened (today's behaviour).
- Business Intelligence and Deal Intelligence gain an automatic mode now.
  Internal Knowledge gains one in a later phase (it needs new fields).
- Every agent's automatic mode works the same way: a scheduled run, saved
  settings, at most one run a day, each item alerted once (again only if it
  gets worse or stays unresolved for `repeat_days`), bell notification to
  owners and admins, optional email digest, a run history.

## Non-goals

- No agent ever changes a business record. Automatic runs read and alert only.
- No AI in automatic runs. Findings come from the existing fixed rules
  (`src/shared/*`) and the alert text is written from templates, so an
  automatic run uses no AI and never touches the AI usage counter.
- No per-deal owners, no bank-balance alert, no new chat behaviour.

## Anti-goals (would be a failure even if it works)

- An alert that states something the records do not show (EdgeBrain must
  not bluff): every alert carries counts and links to the records behind it.
- The same item arriving every morning, or two agents alerting the same thing.
- A switch that looks on but does nothing (e.g. on live before the migration).

## What exists (reuse, do not rebuild)

- `agent_settings`, `agent_runs`, `agent_alerts`, `agent_run_claim`,
  `agent_run_finish`, `agent_alerts_commit` (0089, 0090) are keyed by agent
  id already, so new agents need **no migration** for Phase 1–2.
- 0090 makes the notification `type` the agent id. It is still pending on
  live; without it new agents' alerts are written as `deadline_watch`.
- `api/_lib/deadlines.js` and `api/_lib/operations.js` hold the run pattern
  (claim → load with service role → findings → `alertsDue` → commit → email →
  finish). `recipientsOf` and `emailDigest` are shared.
- Deal rules: `src/shared/dealIntel.js` `detectRisks` gives findings with a
  stable `key`, `severity`, `next_step` and `records`. Loading:
  `api/_lib/deals.js` `loadDealRows(db, orgId, can)`.
- Business rules: `src/shared/bizIntel.js` `buildSnapshot` → `insights`
  (ids such as `receivables_overdue`, `payables_overdue`, `revenue_down`,
  `collections_down`, `expenses_up`, `costs_exceed_revenue`, …). Loading:
  `api/_lib/bizIntel.js` `loadSources`.

## The design

### 1. The switch (all five cards)

- On each card on the Agents grid, a switch, shown to owners and admins.
  Members see the state ("Daily", "Weekly", "On Demand") but no switch.
- Flipping it saves `daily: true/false` in that agent's settings through
  `/api/agents` mode `settings` (owner/admin checked on the server).
- Each agent's page keeps its own Settings panel for the details (warning
  days, minimum severity, repeat days, email digest) and a **Run Now**
  button, as the two existing agents have.
- Internal Knowledge's switch is disabled with "Coming soon" until Phase 3.
- When the server reports the agent tables are missing
  (`settings_unavailable`), the switch is disabled with a reason.

### 2. Scheduling

- One cron entry per agent in `vercel.json`, a few minutes apart from 02:30
  UTC (08:00 IST), each calling `GET /api/agents?agent=<id>` with the
  `CRON_SECRET`. Each agent then gets the whole 60 s function limit. The
  existing deadline + operations pass keeps working (no `agent` = today's
  behaviour) until the new entries replace it.
- A run's key is the org's date, so a repeat trigger the same day does
  nothing.

### 3. Deal Intelligence — automatic

- Daily. Alerts on `detectRisks` findings at or above `notify_min`
  (default `high`): follow-up overdue, client waiting on us, quotation
  validity passed or ending, quotation unanswered, approval waiting, high-
  value deal inactive, or a deal with no activity for `very_stale_days`.
  Anything rated below the threshold (e.g. `no_next_step`) is not alerted
  unless the threshold is lowered.
- Settings: the agent's existing thresholds (`stale_days`, `quote_wait_days`,
  …) plus `notify_min`, `repeat_days`, `email_digest`, `daily`.
- Recipients: owners and admins. The CRM has no deal owner today, so it
  cannot alert "the person on the deal".
- Digest: "3 deals need action" + top items with their next step, links to
  `/ask?agent=deal_intelligence`.

### 4. Business Intelligence — automatic

- **Daily alerts** on finance insights only, at or above `notify_min`
  (default `high`), e.g. overdue receivables that are large or old.
  Operations-area insights (tasks/milestones/projects overdue) are left to
  the Deadline and Operations agents, so nothing is alerted twice.
- **Weekly summary**, on a weekday set in settings (default Monday): one
  notification + optional email with last week against the week before —
  invoiced, collected, money in and out, receivables and overdue, and the
  top insights. Sent even when nothing is wrong; it is a report, not an
  alert. Its run key is the ISO week, so it goes once a week.
- A figure whose table could not be read is left out of the summary and
  named as left out, never shown as zero (`NEEDS` / `limitsOf`).
- Settings: `daily` (the switch), `weekly_summary` (on/off), `summary_day`,
  `notify_min`, `repeat_days`, `email_digest`.

### 5. Internal Knowledge — automatic (Phase 3, needs migration 0092)

- `library_documents` has no end or review date today. 0092 (0091 is taken by org currency) adds optional
  `expires_on date` and `review_by date`, set on the library's upload/edit
  form.
- Daily checks: document expired or expiring within N days; review date
  passed; document that could not be read (`extraction_status` failed /
  unsupported / partial, or pending more than a day) so it is not searchable.
- Same alerting pattern and recipients.

### 6. Shared server code

- A small shared runner (`api/_lib/agentRun.js`) for claim → commit →
  email → finish, so Deal, BI and Knowledge do not copy the 80-line run
  three more times. The two existing agents may move onto it later; not
  required now.
- `/api/agents` accepts `settings` and `run` for every server agent id;
  read/snapshot behaviour of each agent is unchanged.
- `ModuleShell` `notifTarget` opens `/ask?agent=<id>` for any known agent id.

## Phases

1. Switch on all cards + shared runner + per-agent cron + Deal Intelligence
   automatic mode.
2. Business Intelligence daily alerts + weekly summary.
3. Internal Knowledge: 0092, form fields, automatic checks.

Each phase: unit tests on the rules and the run (as `deadlines.test.js` /
`operations.test.js` do), endpoint tests, then a check in the running app.

## Before it works on live

- `CRON_SECRET` set in Vercel (16+ characters).
- 0090 applied (and 0092 for Phase 3).

## Calls I made (check these)

- No AI in automatic runs — so no AI cost question.
- Alerts go to owners and admins (no deal owner exists).
- BI alerts finance only; operations items stay with the other two agents.
- No "cash below a level" alert: EdgeOS records money in and out, not a bank
  balance, so the figure would be invented.
- One cron per agent instead of one shared run, for the time limit.
- Members see the state but cannot flip the switch.
