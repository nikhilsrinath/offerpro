# Definition of Done

**Phase 0 · decision document. The ship criteria every feature from Phase 1 onward must meet.**

Five gates. A feature that misses any one of them is not done, regardless of whether it
works. Each gate below names the existing repo convention it follows, so "done" is a thing
that can be pointed at rather than argued about.

---

## 1. An RLS policy

**Every new table has `enable row level security` *and* `force row level security`, plus
its policies, in the same migration that creates it.**

Not a follow-up migration. `0011_product_catalog.sql` states the reason: *"a table added
without this fails open, which is the one failure mode this schema does not accept."*

### The default shape

Unless there is a stated reason otherwise, a tenant table gets the four uniform policies
(`0003_rls.sql:97-116`):

```sql
create policy <t>_select on public.<t> for select to authenticated
  using (app.is_member(org_id));
create policy <t>_insert on public.<t> for insert to authenticated
  with check (app.can_write(org_id));
create policy <t>_update on public.<t> for update to authenticated
  using (app.can_write(org_id)) with check (app.can_write(org_id));
create policy <t>_delete on public.<t> for delete to authenticated
  using (app.is_admin(org_id));
```

### The checklist

- [ ] `enable` **and** `force` row level security
- [ ] Four policies (or a documented reason for a different set)
- [ ] `revoke all on public.<t> from anon;` — `0003:43` revoked `anon` from every table
      *then existing*; a new table is not covered
- [ ] `org_id` column with `references organizations(id) on delete cascade`
- [ ] `app.freeze_org_id()` trigger — a row must not be able to change tenant
- [ ] `app.touch_updated_at()` trigger if the table has `updated_at`
- [ ] If any column must not be client-writable: **table-level `revoke update` followed by
      a column-list `grant update`**. Not a column-level revoke — privileges are additive
      and a column-level revoke against a standing table-wide grant changes nothing
      (`0011_product_catalog.sql`, closing section)
- [ ] SECURITY DEFINER functions carry an explicit membership gate in the body
      (`app.is_member(p_org)`) **and** `revoke execute ... from public, anon`
      (`catalog_performance`, `sales_by_country`, `bump_ai_usage` all do this)
- [ ] New storage bucket → the four `app.storage_org(name)` policies from `0004_storage.sql`

---

## 2. A tenant-isolation test

**Every new table gets assertions in `supabase/tests/01_isolation_test.sql`.**

Run: `psql -d edgeos -v ON_ERROR_STOP=1 -f supabase/tests/01_isolation_test.sql`
(harness: `supabase/tests/00_harness.sql`, which emulates `auth`/`storage`/roles so the
suite runs against plain PostgreSQL).

The file already provides `assert(cond, label)` (`:75`), `assert_denied(sql, label)`
(`:87`) and `assert_no_rows(sql, label)` (`:104`), and fixtures for two orgs and four users
(owner A, member A, viewer A, owner B).

### Minimum assertions per new table

```sql
-- as owner of org A
select assert((select count(*) from <t>) = 1, '<t>: only own org');
-- as member of org A  → can read, can write
-- as viewer of org A  → can read, cannot write
select assert_denied('insert into <t> ...', 'viewer cannot write <t>');
-- as owner of org B   → sees nothing
select assert((select count(*) from <t>) = 0, '<t>: org B sees nothing');
-- as anon
select assert_denied('select * from <t>', 'anon cannot read <t>');
```

Plus, where applicable:

- [ ] The table is added to the `truncate` list at `01_isolation_test.sql:10-17`
- [ ] Column-level grants are **proven**: `assert_denied('update <t> set <rollup_col> = ...')`
- [ ] SECURITY DEFINER RPCs are called as a non-member and asserted empty or denied

### Outstanding debt this gate creates immediately

`01_isolation_test.sql`'s truncate list covers 28 tables and includes **neither
`catalog_items` nor `country_codes`** — the file predates `0011`–`0013`. So the newest and
most privilege-sensitive table in the schema, the one with a column-level `REVOKE UPDATE`,
has **zero coverage, and nothing proves the revoke holds.**

**This is pre-existing debt, and this gate makes it a blocker: it must be paid before
Phase 1 ships, not deferred behind it.** (`products-and-country-integration.md` P7.)

---

## 3. An audit-log entry

**Every create, update and delete of a tenant-visible business record writes to
`audit_log`.**

`audit_log` (`0001_init.sql:655`) is genuinely append-only — `app.forbid_write()` on
trigger `audit_log_no_update` (`0002_functions.sql:163`) blocks UPDATE and DELETE even for a
superuser-owned role, proven at `01_isolation_test.sql:293-299`. The immutability is done.
**The writing is not:** only three call sites exist in the entire codebase
(`api/admin.js:69`, `create_organization()`, `accept_invitation()`).

### The checklist

- [ ] The table is attached to the generic `app.write_audit()` trigger introduced by
      **M7** in `migration-order.md`
- [ ] `action` is a stable dotted string (`client.created`, `invoice.status_changed`) — not
      free text, because this is what a future filter reads
- [ ] `entity_type` and `entity_id` are set, so `audit_log_entity_idx` is usable
- [ ] `diff` records what changed. **It must not contain secrets** — the same scrubbing
      `records.company_snapshot` gets (`0001:376-379`, ETL strips
      `gmail_app_password` / `bank_*` / `gstin`). An audit trail that leaks a credential is
      worse than no audit trail, because it is retained and unerasable by design
- [ ] Server-side writes through `api/` set `actor_id` and `ip`
- [ ] **A read surface exists.** Today `audit_log_select` (`0003:160`) is
      `app.is_admin(org_id)` and **no component queries the table**. A feature that writes
      audit rows nobody can see has not shipped its audit log

---

## 4. A mobile layout below 768px

**Every new or modified screen is usable at 375px wide.**

The repo's existing convention is a JS breakpoint at `768`, either as a
`useWindowWidth()` hook (`CRM.jsx:31-37`, `Hub.jsx:33`) or a `window.innerWidth` read, used
to switch grid templates and to swap a kanban for a tabbed single column
(`CRM.jsx:292` `mobileTab`).

**Nine of the repo's 76 components handle a breakpoint.** `CopilotPanel.tsx`,
`CompanyProfile.jsx`, `CRM.jsx`, `Hub.jsx`, `OfferTracker.jsx`, `TasksPage.jsx`,
`TeamHierarchy.jsx` and two landing CSS files. That is the baseline; it is not a licence to
skip the gate.

### The checklist

- [ ] No horizontal page scroll at 375px. Wide content (tables, charts) scrolls **inside its
      own container**, not the body
- [ ] Multi-column grids collapse. `Hub.jsx:179` is the pattern:
      `isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)'`
- [ ] Kanban/board layouts get a tabbed single-column mode (`CRM.jsx:292-317`)
- [ ] Tap targets ≥ 44px. Several existing action buttons are `padding: '0.25rem 0.5rem'`
      (`Customers.jsx:489`) and are below this
- [ ] Modals and forms are reachable and dismissible without a hover state
- [ ] `recharts` containers are `ResponsiveContainer`-wrapped with an explicit mobile height

### Outstanding debt this gate creates immediately

**`src/components/Products.jsx` (667 lines) and
`src/components/dashboard/SalesByCountries.jsx` (348 lines) contain no `768`, no
`innerWidth`, no `matchMedia` and no `@media` — verified by grep.** Both are protected
features that must be carried forward, and under this gate neither currently ships.

**The ask is a responsive layout pass only — no logic change, no visual redesign.**
(`products-and-country-integration.md` P6.)

---

## 5. A server-side plan-limit check where the feature is metered

**A limit enforced only in React is not enforced.**

Today `src/services/planConfig.js` is imported by exactly one consumer,
`src/hooks/usePlanStatus.js`, which is React. Every document limit — offer letters, MoU,
NDA, invoices, quotations — and the `bulkOperations` gate are **client-side only**. A user
with devtools, or any direct PostgREST call with their own JWT, is unlimited.

### The one that is done right, and is the template

`api/nvidia.js`:

- `public.bump_ai_usage(p_org)` (`0010_ai_usage.sql`) does the increment **in the database**,
  atomically — `update ... set ai_messages = ai_messages + 1 ... returning`, because a
  read-modify-write from a serverless function loses counts on overlap
- It is `security definer` and `revoke execute ... from public, anon, authenticated;
  grant execute ... to service_role` — *"a quota the metered party controls is not a quota"*
- `api/nvidia.js:60` compares against `subscriptions.plan` and returns **HTTP 429**
- The limits table is duplicated in `api/nvidia.js:17` **deliberately**, so the server does
  not import a client module

### The checklist

- [ ] The counter lives in `usage_counters` (or an equivalent server-owned table) — **never
      on `organizations`**, which every member can read and which `0010`'s header calls out
      as the reason the AI counter was moved
- [ ] The counter is maintained by a trigger (`app.bump_usage()`, `0002:337`) or by a
      `security definer` RPC granted to `service_role` only
- [ ] The check runs in `api/` **before** the write, and returns 429 with `used` and `limit`
- [ ] The client check stays — it is for UX, not enforcement — and the two limit tables are
      kept in sync by convention, with a comment on both saying so
- [ ] `app.rebuild_usage_counters()` is updated if the new counter is rebuildable from rows.
      If it is not (like `ai_messages`, because messages are not rows anywhere), say so in a
      comment

### Which features are metered

`planConfig.js` today: `offerLetters`, `mou`, `nda`, `invoices`, `quotations`,
`aiMessages`, `bulkOperations`, `prioritySupport`, `recipientPortal`, `teamFollowUp`.
**Only `aiMessages` is enforced.** Migration **M14** in `migration-order.md`
(`public.check_plan_limit`) is what closes this, and whether files/storage joins the list is
open item **D4**.

---

## 6. The gate, as a PR checklist

Copy into the PR description:

```
### Definition of Done
- [ ] RLS: enable + force + 4 policies + revoke anon + freeze_org_id, in the creating migration
- [ ] Column-level grants where any column is trigger-owned
- [ ] Isolation test: own-org / other-org / viewer-write-denied / anon-denied, table added to the truncate list
- [ ] Audit: app.write_audit attached; action/entity_type/entity_id set; diff scrubbed; a read surface exists
- [ ] Mobile: usable at 375px, no body h-scroll, grids collapse, tap targets >= 44px
- [ ] Plan limit: server-side check in api/ returning 429, counter server-owned  (or: N/A, not metered)
- [ ] AI context: if this changes an orgStore SECTION key or a fromRow field name, the matching
      companyMemory.ts formatter is updated in the same commit  (ai-context-contract.md §5)
```

The last line is not one of the five gates but belongs on the same checklist: the AI reads
`orgStore.getCache()`, so a schema change that alters a section key or a `fromRow` field
name is a change to the AI's context whether or not anyone intended it.

---

## 7. Pre-existing debt this document promotes to blocking

Stated together, because these are the items that will look like new work and are not:

| # | Debt | Gate | Doc |
|---|---|---|---|
| 1 | `catalog_items` and `country_codes` have no isolation test; the column-level `REVOKE UPDATE` is unproven | §2 | `products-and-country-integration.md` P7 |
| 2 | `Products.jsx` and `SalesByCountries.jsx` have no mobile layout | §4 | `products-and-country-integration.md` P6 |
| 3 | Five of six plan limits are client-side only | §5 | `feature-audit.md` §5.4 |
| 4 | `audit_log` has three writers and no reader | §3 | `feature-audit.md` #24 |
| 5 | `buildEdgeContext()` is never called; `App.jsx` feeds the AI an all-zero literal | §6 last line | `ai-context-contract.md` B1 |
| 6 | `formatCRM` reads a cache key that does not exist; there is no `formatCustomers` | §6 last line | `ai-context-contract.md` B3, B4 |
| 7 | Products / Sales-by-Country source files are untracked in git | — | `feature-audit.md` §6 |

**Recommendation: items 1, 2 and 7 are paid before Phase 1 opens** — they concern the two
protected features, and a fixed point that is untested, unresponsive and uncommitted is not
fixed. Items 3–6 are scheduled inside Phase 1 (M7, M8, M14, and the pre-merge AI fix in
`ai-context-contract.md` AI1).
