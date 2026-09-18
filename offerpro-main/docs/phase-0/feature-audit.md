# Feature Audit — 46 brief features reclassified against the repo

**Phase 0 · decision document. No code, no migrations, no schema changes.**
Audited 2026-09-08 against the working tree at `main` (`0f7375b`), migrations `0001`–`0013`.

---

## 0. A contradiction to settle before anything else

**The 46-feature brief is not in this repository.** I searched the whole tree
(`MEGA_AUDIT.md`, `FIX_PLAN.md`, `SUPABASE_MIGRATION.md`, `README.md`, `SKILL.md`, and every
other `.md`) and found no 46-item list, no `Agentrive` string anywhere in the codebase, and
no Existing/New classification.

So this audit is built from two sources, and **every row is tagged with which one**:

| Tag | Meaning |
|---|---|
| **[named]** | You named this feature explicitly in the Phase 0 instruction. Classification is verified against code. |
| **[inferred]** | Reconstructed from what a business-OS brief of this shape contains and from what the repo does and does not have. **The name may not match the brief's wording.** |

**Sign-off item #1: send me the actual 46-item brief and I will re-key this table to it.**
The `[inferred]` rows are the ones most likely to be wrong *as names*; the evidence columns
are correct regardless, because they come from the code.

What I can assert without the brief: **the "26 New" number is wrong, and it is wrong by at
least 13.** Every one of the 13 items you flagged is present in the repo in some form, and
the file, table or route is cited for each below.

---

## 1. Classification key

| Class | Definition used here |
|---|---|
| **Existing** | Works end-to-end today: schema + service + UI + RLS. Ship-blocking gaps may still exist; they are named in the Gap column. |
| **Extended** | The substance exists (table, service, or route). What the brief asks for is a delta on top — a column, a screen, a job, a policy — not a build. |
| **New** | Nothing in the repo covers it. Genuine greenfield. |

---

## 2. The 20 the brief calls "Existing"

Checked to confirm the brief is not *over*-claiming. All 20 are real.

| # | Feature | Verdict | Evidence | Gap before it ships as Agentrive |
|---|---|---|---|---|
| 1 | Offer letters | **Existing** | `records` type `offer`; `src/components/OfferForm.jsx`, `OfferPreview.jsx`, `OfferTracker.jsx`; numbering `app.doc_prefix` → `OL` (`supabase/migrations/0006_hr_notices.sql:24`) | Status `pending` was missing from the live enum until `0008`; confirm it is applied in prod |
| 2 | Certificates | **Existing** | `records` type `certificate`; `CertificateForm.jsx`, `services/certificateTemplates.js` | — |
| 3 | NDA | **Existing** | `records` type `nda`; `NdaForm.jsx`, `NdaPreview.jsx` | — |
| 4 | MoU | **Existing** | `records` type `mou`; `MoUForm.jsx`; two-party states `party_a_signed` / `fully_signed` (`0005_extend_enums.sql:36-38`) | — |
| 5 | HR notices (role change / termination) | **Existing** | `doc_type` values added `0005:22-23`, routed to `records` by `0006_hr_notices.sql` | — |
| 6 | Bulk document generation | **Existing** | `src/components/bulk/` — `BulkOfferLetters.jsx`, `BulkCertificates.jsx`, `BulkTeamMembers.jsx`, `BulkHistory.jsx`, `shared/CSVUploader.jsx` | Gated by `planConfig.js` `bulkOperations` **client-side only** — see `definition-of-done.md` §5 |
| 7 | Employee directory | **Existing** | `employees` (`0001_init.sql:206`); `Employees.jsx`, `EmployeeForm.jsx` | — |
| 8 | Ex-employee archive | **Existing** | Same table via `exited_at`; `orgStore.js` `SECTIONS.ex_employees`; `ExEmployees.jsx` | — |
| 9 | Team hierarchy / org chart | **Existing** | `org_settings.hierarchy` jsonb (`0001:148`); `TeamHierarchy.jsx` on `@xyflow/react` | — |
| 10 | Departments | **Existing** | `departments` (`0001:188`) | — |
| 11 | GST invoices | **Existing** | `financial_documents` + `document_line_items`; totals computed server-side by `app.recompute_document_totals()` (`0002_functions.sql:261`) | — |
| 12 | Quotations | **Existing** | type `quotation`; `financial/QuotationForm.jsx` | — |
| 13 | Proforma invoices | **Existing** | type `proforma`; `advance_percent` column; `financial/ProformaInvoiceForm.jsx` | — |
| 14 | Recurring invoices | **Existing (client-driven)** | `recurring_invoices` (`0001:517`); `financial/RecurringInvoiceForm.jsx` | **No scheduler.** `next_invoice_date` is indexed but no server reads it. Generation happens only while a browser is open. Reclassify **Extended** if the brief promises unattended recurrence |
| 15 | Finance status board | **Existing** | `financial/FinanceStatus.jsx`, `financial/InvoiceList.jsx` | — |
| 16 | Recipient portal | **Existing** | `api/portal.js` (576 lines), `api/portal-token.js`, `portal_tokens`, `src/components/portal/RecipientPortal.jsx` (1590 lines) | — |
| 17 | Company profile & branding | **Existing** | `organizations` / `org_banking` / `org_secrets` split; buckets in `0004_storage.sql` | — |
| 18 | CRM pipeline | **Existing** | `crm_leads` (`0001:307`); `CRM.jsx` kanban, four stages | Stage set is hardcoded in JS (`CRM.jsx:10-15`), not in the DB — see `entity-decision.md` §3 |
| 19 | Product planner (roadmap) | **Existing** | `products` table (`0001:328`); `ProductPlanner.jsx` | **Name collision** with the Products catalogue — see §5.1 |
| 20 | AI Co-founder | **Existing** | `services/cofounderAI.ts`, `services/companyMemory.ts`, `ai_company_memory`, `api/nvidia.js`, `usage_counters.ai_messages` (`0010_ai_usage.sql`) | The only server-enforced plan limit in the product |

---

## 3. The 26 the brief calls "New" — reclassified

### 3a. The 13 you flagged. All 13 exist. **None of them is New.**

| # | Feature `[named]` | Brief | **Actual** | Evidence | What "Extended" means here |
|---|---|---|---|---|---|
| 21 | **Client Directory** | New | **Extended** | `customers` (`0001:290`) — name / email / phone / address / gstin / state / `country_code`; `src/components/Customers.jsx` (608 lines) with list, detail pane, search, sort, CRUD; `src/services/customerService.js` | **It is not a directory — it is a derived list.** `customerService.syncFromInvoices()` (`customerService.js:85-135`) **deletes every customer not backed by a financial document**, once per org per session. A client added by hand and not yet invoiced is destroyed on the next load. This is the single most important finding in the audit. See `entity-decision.md` |
| 22 | **E-Signature Integration** | New | **Existing** | `document_signatures` (`0001:559`) — signer name/email, signature image path, outcome, `signer_ip inet`, `signer_user_agent`, `viewed_at`, `signed_at`, one-signature-per-document unique indexes (`sig_one_per_record`, `sig_one_per_findoc`). Capture: `shared/SignatureCapture.jsx`, `bulk/shared/SignatureCanvas.jsx`, dependency `react-signature-canvas`. Server: `api/portal.js:350` `recordSignature()`; image stored to the private `signatures` bucket at `api/portal.js:316` | Nothing to build. If the brief means a *third-party* e-sign vendor (DocuSign / Zoho), that is a **replacement of a working, evidence-bearing feature**, not a new one, and needs its own explicit decision |
| 23 | **Document Sharing with Expiry** | New | **Existing** | `portal_tokens` (`0001:586`) — `jti`, `scope` (`view` / `sign`), `expires_at` with `check (expires_at > issued_at)`, `revoked_at`, `used_at`, `recipient_email`, `issued_by`. Minting is server-only (`portal_tokens` has no INSERT policy): `api/portal-token.js`, default TTL 30 days, max 365. Validation returns HTTP 410 on expiry (`api/_lib/portalToken.js:71`). UI: `shared/PortalLinkGenerator.jsx:64` prints the expiry date | Nothing to build. Missing only a **revoke** UI: `revoked_at` is writable under policy `portal_tokens_revoke` (`0003_rls.sql:144`) but no component calls it |
| 24 | **Activity Log** | New | **Extended** | `audit_log` (`0001:655`) — org, actor, action, entity_type, entity_id, `diff jsonb`, `ip`. Genuinely append-only: `app.forbid_write()` on trigger `audit_log_no_update` (`0002:163`) blocks UPDATE and DELETE, proven in `supabase/tests/01_isolation_test.sql:293-299` | **The table is nearly empty.** Three writers exist in the entire codebase: `api/admin.js:69`, `public.create_organization()` (`0002:483`), `public.accept_invitation()` (`0002:526`). No invoice, document, employee, customer or task write is logged. And **no read surface** — `audit_log_select` (`0003:160`) is admin-only and no component queries it. The hard part (immutability) is done; the feature is not |
| 25 | **Payment Tracking** | New | **Existing** | `payments` (`0001:497`) — amount, `paid_on`, method, reference, `submitted_by_recipient`, `confirmed_at`, `confirmed_by`. `financial_documents.amount_paid` is **derived, not asserted** — trigger `payments_recompute` → `app.recompute_amount_paid()` (`0002:306`). Recipient self-report: `api/portal.js:335` inserts an unconfirmed row and `payment_submitted` is a status distinct from `paid` (`0005:44-46`). UPI QR `shared/UPIQRGenerator.jsx`; confirmation UI `shared/PaymentConfirmationForm.jsx`; constraint `fin_docs_paid_lte_total` | Nothing to build |
| 26 | **Expense Tracking** | New | **Extended** | `expenses` (`0001:342`) — description, amount, category, `incurred_on`; RLS via the uniform loop (`0003:97`); `orgStore` section `expenses`; add-expense form and category pie in `BillingRevenue.jsx:137` | Exists but thin: **no receipt attachment, no vendor link, no approval state, no recurring expense, no tax/ITC fields.** That is the Extended delta, and it collides directly with the Phase 3 vendor work — see `products-and-country-integration.md` §5 |
| 27 | **Task Assignment** | New | **Existing** | `tasks.assignee_id` → `employees(id) on delete set null`, with `assignee_label` as the unresolved fallback (`0001:263`); `tasks/TasksPage.jsx`, `tasks/TaskModal.jsx`, `services/taskStore.ts`. The AI can assign: `cofounderAI.ts:574` `detectTaskAssignIntent()`, `:620` `buildTaskAssignPrompt()`, `:646` `parseTaskAssignResponse()` | Nothing to build |
| 28 | **Task Status** | New | **Existing** | `task_status` enum `pending / in_progress / done / overdue` and `task_priority` `low / medium / high` (`0001:38-39`); `position` for board ordering; index `tasks_org_status_idx` | Nothing to build |
| 29 | **Task Deadline Alerts** | New | **Extended** | `tasks.deadline`; partial index `tasks_deadline_idx ... where status <> 'done'`; `follow_up_sent_at` so a reminder fires exactly once. `src/hooks/useTaskDeadlineMonitor.ts` marks tasks overdue and emails the assignee through `emailService` | **Runs in the browser.** `setTimeout(runCheck, 5000)` then `setInterval(..., 1h)` (`useTaskDeadlineMonitor.ts:57-62`). Nobody signed in ⇒ no alert *and* nothing marks the task overdue. It also silently no-ops unless `profile.emailjs_service_id` is set. The delta is a server-side job, not a feature |
| 30 | **Basic P&L** | New | **Extended** | `BillingRevenue.jsx:76-123` computes `totalRevenue`, `totalMakingCharges`, `grossProfit`, `totalExpenses`, `netProfit`, a six-month cash-flow series and an expense-category pie, rendered with `recharts` | Computed **in the browser** from whatever `orgStore` happens to have cached, and the monthly series buckets on `created_at` (`BillingRevenue.jsx:96`) while `Hub.jsx:81` deliberately buckets on `issue_date`. Two screens, two definitions of "when". The delta is a server-side aggregate — the move `sales_by_country()` and `catalog_performance()` already made |
| 31 | **Business Overview Dashboard** | New | **Existing** | **Two of them.** `src/components/Dashboard.jsx` (page `dashboard`, module `overall`) — four stat tiles, revenue-trend area chart, document-distribution pie, and it hosts `SalesByCountries` at `Dashboard.jsx:224`. Plus `src/components/Hub.jsx` (671 lines) — module launcher with its own four stat tiles and a period-selectable daily revenue series | **Two overlapping overview screens computing the same numbers independently** is the real problem, not a missing dashboard. Consolidation is a decision, not a build |
| 32 | **Products catalog** | New | **Existing — PROTECTED** | `catalog_items` (`0011_product_catalog.sql:29`) — name, sku, description, category, `unit_price`, `unit`, `hsn_sac`, `tax_rate`, `track_inventory` / `stock_qty` / `low_stock_at`, `archived_at`; trigger-owned rollups `units_sold` / `revenue` / `revenue_paid` / `invoice_count` / `last_sold_at` with a column-level `REVOKE UPDATE` so the browser cannot assert them; `document_line_items.catalog_item_id` FK; RPC `public.catalog_performance(org, from, to)`. UI `Products.jsx` (667 lines), `shared/ProductPicker.jsx`, `services/catalogService.js` | **Do not touch.** See `products-and-country-integration.md` |
| 33 | **Sales by Countries** | New | **Existing — PROTECTED** | `0013_sales_by_country.sql` — `country_source` enum, `country_code` on `organizations` / `customers` / `financial_documents`, resolution chain `app.resolve_document_country()`, BEFORE INSERT trigger `fin_docs_set_country`, one-time backfill, and RPC `public.sales_by_country(org, from, to, catalog_item)` returning revenue / collected / pipeline / doc_count / customer_count / prev_revenue. UI `dashboard/SalesByCountries.jsx`, `services/salesGeoService.js`, `src/data/worldMap.js` (generated by `scripts/generate-world-map.js`) | **Do not touch.** See `products-and-country-integration.md` |

**Score for this block: 0 New · 8 Existing · 5 Extended.**

### 3b. The other 13 "New" items — `[inferred]` names, verified absence

The names are my reconstruction (see §0). The *absence* claims are verified by grep across
`src/`, `api/`, `supabase/` and `scripts/`.

| # | Feature `[inferred]` | Verdict | Evidence of absence / partial presence |
|---|---|---|---|
| 34 | General file uploads / document library | **New** | Three buckets exist (`0004_storage.sql`) and all three are purpose-built: `org-branding` (public, images), `signatures` (private, images), `documents` (private, `application/pdf` only, 20 MB). **No table models an uploaded file.** See `document-model-decision.md` |
| 35 | Global search across records | **New** | No `globalSearch`, no command palette, no `tsvector` column, no `pg_trgm`. Search today is per-screen and client-side (`customerService.search()`, consumed at `Customers.jsx:277`) |
| 36 | Vendor / supplier management | **New** | Zero hits for `vendor` or `supplier` in `src`, `api`, `supabase` |
| 37 | Purchase orders / bills payable | **New** | Zero hits for `purchase_order`. `doc_type` has no inbound-document value; every value is something the org issues |
| 38 | Inventory management | **Extended** | `catalog_items.track_inventory` / `stock_qty` / `low_stock_at` exist, and `0011:44-51` states explicitly that stock is **operator-maintained and deliberately not decremented by the sales trigger**, because there is no goods-receipt or returns table to move it the other way. Real inventory = those two tables plus reversing that decision |
| 39 | Storefront / checkout | **New** | Not built — but **designed for**. `country_source` already reserves `checkout_form` and `checkout_geoip` (`0013:34-40`), and `0013`'s header explains the country trigger is BEFORE INSERT and no-ops on a supplied value precisely so checkout can drop in |
| 40 | Customer self-service accounts | **New** | The portal is token-per-document (`portal_tokens`), not an account. No customer-facing auth, no `auth.users` row for a recipient |
| 41 | Notes / interaction timeline on a client | **Extended** | `crm_leads.notes` and a `notes` field per record are single free-text fields. No timeline table. Overlaps #24 Activity Log — decide once, not twice |
| 42 | Email campaigns / sequences | **Extended** | `services/emailService.js` (299 lines) plus `api/email.js` send transactional mail through per-org SMTP credentials in `org_secrets`; `services/followUpEngine.ts` exists. No campaign, list, template or send-log table |
| 43 | Calendar / scheduling | **New** | No calendar table, no component, no dependency |
| 44 | Reporting & export | **Extended** | `xlsx` is a dependency; `storageService.exportToCSV()` (`storageService.js:132`); two server-side aggregates already exist (`catalog_performance`, `sales_by_country`). No report builder or saved report |
| 45 | Roles & permissions UI | **Extended** | `member_role` enum plus `app.is_member` / `can_write` / `is_admin` / `is_owner` are fully enforced in RLS (`0002:22-77`); `invitations` and `public.accept_invitation()` work; `app.protect_last_owner()` guards the last owner. **No screen** invites a teammate or changes a role — the mechanism has no UI |
| 46 | Multi-currency | **Extended** | `financial_documents.currency char(3) default 'INR'` and `employee_compensation.currency` exist. Everything downstream is hardcoded rupees — `₹` literals and `en-IN` formatting in `Hub.jsx`, `Dashboard.jsx`, `BillingRevenue.jsx`, `Products.jsx`, and `companyMemory.ts` `formatCatalog()`. Column present, feature absent |

---

## 4. Revised counts

| | Brief claims | This audit finds |
|---|---|---|
| **Existing** | 20 | **28** — the 20 above plus 8 from block 3a |
| **Extended** | (not a category) | **13** — 5 from 3a, 8 from 3b |
| **New** | 26 | **5** on the named items (zero) plus **5–7** on the inferred ones: #34, #35, #36, #37, #39, #40, #43 |

**The brief overstates greenfield work by roughly 19 of its 26 "New" items.** Estimating
against "26 new features" budgets for building things that already exist, and would very
likely produce a second `products`-vs-`catalog_items` table collision.

---

## 5. Repo-versus-brief contradictions, called out

1. **`products` is already taken.** `public.products` (`0001:328`) is ProductPlanner's
   roadmap — name, status, priority, due_date, **no price, no SKU, no tax**. The sellable
   catalogue is `catalog_items` (`0011`), and `0011`'s header documents the split
   deliberately. Any brief item that says "add a products table" is already wrong. Two UI
   pages, two tables, one word.
2. **"Customers" is not a client list.** It is a projection of who has been invoiced, and
   it actively deletes rows (§3a #21). A brief item reading "Client Directory — new" is
   half-right for the wrong reason: the screen exists, the *durability* does not.
3. **Country is already transaction-level, not customer-level.** `0013` chose this on
   purpose and documents why (a relocating customer must not rewrite last year's map, and
   a document with a null `customer_id` must still have a country). A brief item proposing
   country-on-customer would be a regression.
4. **Plan limits are client-side except AI.** `planConfig.js` is imported only by React
   (`usePlanStatus.js`). The single server-enforced limit is `aiMessages`
   (`api/nvidia.js:60` calling `bump_ai_usage`). Every metered feature in the brief
   inherits an unenforced limit by default.
5. **Two dashboards, not zero.** See #31.
6. **`doc_status` drift is a live production risk.** `0005` and `0008` exist because
   `0001` defined the enums from a design document rather than from the running code, and
   `0008`'s header records that a probe of the *live* enum still found `pending` missing.
   Confirm `0005`–`0013` are all applied to production before any Phase 1 estimate means
   anything.

---

## 6. Things I could not determine

Stated rather than guessed:

- **Whether migrations `0005`–`0013` are applied in production.** I read files, not a live
  database. `0008`'s existence proves at least one earlier migration was applied only
  partially.
- **The brief's actual wording for rows 34–46.** See §0.
- **Whether "Products / Sales by Countries are in progress" means something is unmerged.**
  Both are present as migrations and components in the working tree, but per `git status`
  the files `src/components/Products.jsx`, `src/components/dashboard/`,
  `src/components/shared/ProductPicker.jsx`, `src/components/shared/CountrySelect.jsx`,
  `src/data/`, `src/services/catalogService.js` and `src/services/salesGeoService.js` are
  **untracked** — not yet committed. Migrations `0011`–`0013` are likewise untracked or
  uncommitted.
- **Whether `EdgeOS-Overview.pdf` (untracked, 671 KB, added 2026-09-07) contains the
  brief.** I did not open it. If it does, it supersedes §0 and I should re-key this table.
