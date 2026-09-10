# Migration Order — the frozen list

**Phase 0 · decision document. This list is the agreement. No migration in it is written
until the list is signed off.**

Baseline: `supabase/migrations/0001` … `0013` are applied (**see §0 — this is not verified**).
Everything below starts at `0014`.

---

## 0. Preconditions — must be settled before `0014` is written

| # | Precondition | Why it blocks |
|---|---|---|
| **P-0** | **Verify `0005`–`0013` are actually applied to production.** | `0008_pending_status.sql` exists because a probe of the *live* `doc_status` enum found `pending` missing after `0005` was supposedly applied. If the baseline is not what the files say, every migration below is sequenced against a fiction. **Run `select unnest(enum_range(null::doc_status));` and `select tablename from pg_tables where schemaname='public';` against prod and paste the output before anything else.** |
| **P-1** | **Commit the untracked Products / Sales-by-Country files.** | `products-and-country-integration.md` P1 |
| **P-2** | **Count `select distinct stage, count(*) from crm_leads group by 1;` in prod.** | `crm_leads.stage` is unconstrained `text`. The M4 backfill needs the real value set, not `CRM.jsx`'s four |
| **P-3** | **Decide E6 / P4: is a vendor the same entity as a client?** | If yes, M4 creates `parties`, not `clients`. Deciding after M4 means repointing the same two FKs twice |
| **P-4** | **Decide D3: `files` parent as a loose pair or nullable FKs.** | Changes M12's shape |

---

## 1. Rules this list follows

1. **Enum-value additions get their own migration and their own transaction.** Postgres
   forbids using a newly added enum value in the transaction that added it. This repo has
   already been bitten twice — `0005`/`0006` are split for exactly this reason, and `0008`
   exists because the rule was missed. Every `alter type ... add value` below is alone.
2. **No migration drops a column or table in the same release that stops writing to it.**
   Add → dual-write → cut readers over → drop, as separate migrations.
3. **Every migration has a rollback statement in this document.** A migration whose
   rollback is "restore from backup" is called out as such rather than pretended otherwise.
4. **Every new table gets RLS enabled *and* forced, plus policies, in its own creation
   migration** — never in a follow-up. `0011` established this: a table added without it
   fails open.
5. **Every new operator-writable column on `catalog_items` is added to the column-level
   `grant update` list in the same migration** (`products-and-country-integration.md` §5.2).

---

## 2. The ordered list

Legend — **Rev**: `full` = the rollback restores the prior state exactly; `lossy` = the
rollback loses data written since; `none` = not reversible without a restore.

### Phase 1 — entity unification and the safety floor

> **As shipped, the file numbers are one higher than planned here** — `0014` was taken by
> `0014_customer_org_guard.sql`, the Phase 0 carry-over, so M1 became `0015_client_status_enum.sql`
> and the chain shifted: M2 `0016_clients`, M3 `0017_clients_backfill`, M4+M9(partial)
> `0018_repoint_fks` (E4's keep-the-column-name route, so `sales_by_country()` survives), M6
> `0019_country_guard_clients`. M7 and M8 kept their planned numbers. Four migrations not in this
> plan were added alongside them:
>
> | File | Why |
> |---|---|
> | `0022_authenticated_default_privileges.sql` | `0003`'s grant to `authenticated` was one-time, not a default privilege, so every table created after it (`catalog_items`, `country_codes`, `clients`) was relying on a Supabase project setting no migration asserts. `0007` had already closed this for `service_role` only |
> | `0023_scrub_snapshot_secrets.sql` | `orgStore.scrubSnapshot()` stripped credentials but not banking, and `_profile` is the org row **plus** `org_banking` — so every document written since cutover froze the company's account number into `company_snapshot`, which `api/portal.js` hands to recipients |
> | `0024_email_rate_limit.sql` | FIX_PLAN item 7's rate limits. In the database because `api/` is serverless and has no process to hold a counter in |
> | `0025_clean_client_extra.sql` | `CRM.jsx` sent `status` alongside `stage`; it fell into `clients.extra` and then shadowed the real `client_status` column on read |


| # | File | What | Depends on | Rollback | Rev |
|---|---|---|---|---|---|
| **M1** ☑ | `0014_client_status_enum.sql` | `create type client_status as enum ('lead','contacted','active','lost','archived');` **Nothing else in this file** (rule 1) | P-0, P-2, E1 signed off | `drop type client_status;` | full |
| **M2** ☑ | `0015_clients.sql` | `create table clients` (shape in `entity-decision.md` §2), indexes (**non-unique** name index; partial unique GSTIN index), `touch_updated_at` + `freeze_org_id` triggers, RLS enable **and** force, the four uniform policies, `revoke all ... from anon` | M1 | `drop table clients cascade;` | full |
| **M3** ☑ | `0016_clients_backfill.sql` | Backfill: `crm_leads` first (it has both name fields), then merge `customers` on `gstin` → `email` → exact `lower(trim(name))`. **Never fuzzy.** Records `source`. Copies `extra` jsonb verbatim. Copies `country_code`. Maps stage → status per `entity-decision.md` §3, with the P-2 fallback | M2 | `delete from clients;` (table stays) | full — source tables untouched |
| **M4** ☑ | `0017_documents_client_id.sql` | `alter table financial_documents add column client_id uuid references clients(id) on delete set null;` same for `recurring_invoices`. Backfill from `customer_id` via the M3 id map. **`customer_id` is not touched** | M3 | `alter table ... drop column client_id;` | full |
| **M5** ☑ | `0018_compat_views.sql` | Drop the *tables* `customers` / `crm_leads`? **No.** Instead: leave them in place, untouched and still written by nothing after the app cuts over. Rename deferred to M9 | M4 | n/a | — |
| **M6** ☑ | `0019_country_chain_clients.sql` | Rewrite `app.resolve_document_country()` to read `clients` instead of `customers`. **The single highest-risk change in Phase 1** (`products-and-country-integration.md` §5.5). Must ship with the test asserting a new invoice for a client with a country gets `country_source = 'customer'`, not `'org_default'` | M4, and the app cut-over | `create or replace function` with the `0013` body | full |
| **M7** ☑ | `0020_audit_triggers.sql` — **shipped** | A generic `app.write_audit()` AFTER trigger, attached to `clients`, `financial_documents`, `records`, `employees`, `tasks`, `payments`, `catalog_items`, `expenses`. Writes `action`, `entity_type`, `entity_id`, `diff`. Makes `feature-audit.md` #24 real | M2 | `drop trigger ... ; drop function app.write_audit();` — **audit rows already written are not deletable** (`app.forbid_write` blocks DELETE on `audit_log`) | lossy |
| **M8** ☑ | `0021_audit_read_policy.sql` — **shipped**, widened to members except `employee_compensation` / `organization` | Decide and apply the read policy for `audit_log`. Today it is `app.is_admin(org_id)` (`0003:160`) with no reader. If the Activity Log is a member-visible feature, this widens to `app.is_member` **for non-sensitive entity types only** | M7 | restore the `0003` policy | full |
| **M9** | `0022_drop_legacy_client_tables.sql` | `alter table financial_documents drop column customer_id;` — **wait.** `public.sales_by_country()` reads `count(distinct s.customer_id)`. Per `entity-decision.md` E4 the recommendation is to **keep the column name and repoint the FK instead**, in which case M4 and this migration merge into one `alter table ... drop constraint ...; add constraint ... references clients(id)`. **This entry is the one that changes shape depending on E4.** Then `drop table customers; drop table crm_leads;` | M6, M7, and one full release of the app running on `clients` | `drop table` is **not reversible** without a restore | none |

### Phase 2 — files, search, and the metering floor

| # | File | What | Depends on | Rollback | Rev |
|---|---|---|---|---|---|
| **M10** | `0023_uploads_bucket.sql` | `insert into storage.buckets ('uploads', private, 25 MB, MIME allowlist TBD)` + the four `app.storage_org(name)` policies, mirroring `0004` | — (independent of Phase 1) | `delete from storage.buckets where id='uploads';` — **objects must be reaped first** | lossy |
| **M11** | `0024_files.sql` | `create table files` (`document-model-decision.md` §4), RLS enable + force, four policies, `revoke all ... from anon` | M10, P-4 | `drop table files;` | full |
| **M12** | `0025_searchable_documents_view.sql` | `create view searchable_documents` as the three-branch `union all` (`document-model-decision.md` §5). **Not** `security_definer` — RLS must compose from the base tables | M11 | `drop view searchable_documents;` | full |
| **M13** | `0026_usage_counters_storage.sql` | *Conditional on D4.* `alter table usage_counters add column storage_bytes bigint not null default 0;` + a trigger on `files` | M11, D4 signed off | `alter table usage_counters drop column storage_bytes;` | full |
| **M14** | `0027_plan_limits_server.sql` | The gap `feature-audit.md` §5.4 names: a `public.check_plan_limit(p_org, p_feature)` SECURITY DEFINER function reading `subscriptions.plan` and `usage_counters`, modelled on `bump_ai_usage` (`0010`). Called from `api/` before any metered create | M13 (if D4 yes), else M2 | `drop function public.check_plan_limit(uuid, text);` | full |
| **M15** | `0028_search_tsvector.sql` | **Deferred.** Generated `tsvector` columns + GIN indexes on `records`, `financial_documents`, `files`. **Only when a real row count justifies it**, and never over `records.data` / `financial_documents.payload` (`document-model-decision.md` §5) | M12 | `alter table ... drop column search_vector;` | full |

### Phase 3 — vendors, purchases, expenses

**These shapes depend on P-3 and P4 and are therefore provisional. They are listed so the
ordering is agreed, not the columns.**

| # | File | What | Depends on | Rollback | Rev |
|---|---|---|---|---|---|
| **M16** | `0029_parties_vendor_role.sql` | *If P-3 = "same entity":* add a role dimension to `clients` (and this whole block collapses). *If P-3 = "different":* `create table vendors` mirroring `clients`' shape and policies | P-3, M9 | `drop table vendors;` / revert the role column | full |
| **M17** | `0030_purchase_documents.sql` | `create table purchase_documents` + `purchase_line_items`, **separate from `financial_documents`** per `products-and-country-integration.md` §5.3 — so that `fin_docs_set_country`, `app.bump_usage`, `line_items_catalog_rollup`, `fin_docs_catalog_rollup` and `app.recompute_amount_paid` are not fired on rows they were never written for | M16 | `drop table purchase_line_items; drop table purchase_documents;` | full |
| **M18** | `0031_catalog_purchase_rollups.sql` | *Conditional on P4.* If a catalogue item can be purchased: `units_purchased` / `cost` columns, an `app.catalog_is_purchased()` predicate, its own trigger, **and the additions to the column-level `grant update` list** (rule 5) | M17, P4 | drop the columns, the predicate, the trigger; restore the grant list | full |
| **M19** | `0032_expenses_extend.sql` | `expenses`: vendor FK, approval state, `tax_amount`. Receipt attachment needs **no** column — it is a `files` row with `parent_type='expense'` | M16, M11 | drop the added columns | full |
| **M20** | `0033_recurring_scheduler.sql` | The server-side job `feature-audit.md` #14 and #29 both need: a `job_runs` table, and either `pg_cron` or an external scheduler hitting an `api/` route. **Scope decision required — this is the one entry that may not be a migration at all** | M9 | `drop table job_runs;` | full |

### Not scheduled

`storefront / checkout` (`feature-audit.md` #39) needs **no migration** —
`0013_sales_by_country.sql` was written for it: `country_source` already reserves
`checkout_form` and `checkout_geoip`, and `fin_docs_set_country` no-ops on a supplied
value. Listed here so it is not budgeted as schema work.

---

## 3. Dependency graph

```
P-0 ─┬─> M1 ─> M2 ─> M3 ─> M4 ─┬─> M6 ──┐
     │                          │        ├─> M9  (drop legacy)  [needs 1 full release gap]
P-2 ─┘                          └─> M7 ─> M8 ─┘
                                        │
P-3 ────────────────────────────────────┴──────> M16 ─> M17 ─┬─> M18   [P4]
                                                              └─> M19
M10 ─> M11 ─┬─> M12 ─> M15  [deferred]
            ├─> M13 [D4] ─> M14
            └─────────────> M19
```

Two independent tracks: **M1–M9** (entity) and **M10–M15** (files). They meet only at M19.
M10–M14 can ship first if the entity decision is still open — which is worth knowing, since
`entity-decision.md` has six open sign-off items and `document-model-decision.md` has six.

---

## 4. Rollback statements

Stated per migration in §2. Three notes on the ones that are not clean:

- **M7 (audit triggers) is lossy on rollback.** `app.forbid_write()` on trigger
  `audit_log_no_update` (`0002:163`) blocks DELETE on `audit_log` *even for a
  superuser-owned role* — proven at `01_isolation_test.sql:296-299`. Dropping the triggers
  stops new rows; it cannot remove the ones already written. That is the design working
  correctly, and it means M7 should not be applied casually to production.
- **M9 (drop legacy tables) is not reversible.** It requires a full release gap after M6 —
  long enough that a rollback would mean rolling back the application too, not just the
  schema. **This is the only entry in the list with no rollback path, and it should be the
  last thing scheduled, not the tidy-up at the end of a sprint.**
- **M10 (bucket) is lossy** if objects have been uploaded — `delete from storage.buckets`
  will not remove them.

Everything else is `create` / `add column` and drops cleanly.

---

## 5. What this list deliberately does not contain

| Not here | Why |
|---|---|
| Anything touching `catalog_items`' existing columns, triggers, predicates, or its column-level grant | Protected feature. Only M18 adds to it, additively |
| Anything touching `financial_documents.country_code` / `country_source` / `fin_docs_set_country` | Protected feature. M6 changes only the *source table* the resolution chain reads |
| A `products` → `catalog_items` rename, or a merge of the two | `0011`'s header is explicit that they are different things. Renaming `products` would break `ProductPlanner.jsx` and `formatProducts()` for no gain |
| A rename of `financial_documents.customer_id` | `public.sales_by_country()` reads it (E4) |
| Any change to `app.catalog_is_sold` / `app.catalog_is_collected` | Frozen public API (P2). Both the Products page and the Sales map read them |
| A `search_index` materialised table | `document-model-decision.md` §5 — a plain view composes RLS for free; a materialised copy is a second copy of tenant data with its own isolation risk |

---

## 6. Sign-off

**No migration file is written until this list is agreed.** The entries most likely to
change shape on your answers:

| Entry | Changes if… |
|---|---|
| M1 | E1 — seven statuses instead of five |
| M4 / M9 | E4 — rename `customer_id` vs. repoint the FK in place |
| M11 | D3 — loose parent pair vs. nullable FKs |
| M13 / M14 | D4 — are files metered |
| M16–M19 | P-3 and P4 — is a vendor a client; can a catalogue item be purchased |
| M20 | Whether the recurring/deadline scheduler is in scope at all |
