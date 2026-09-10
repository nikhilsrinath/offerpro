# AI Context Contract — what the Co-founder reads, and what the entity merge breaks

**Phase 0 · decision document. No code changes in this phase.**

Scope: `src/services/cofounderAI.ts` (`EdgeContext`), `src/services/companyMemory.ts`
(Company Memory), and their wiring through `src/App.jsx`,
`src/components/cofounder/CopilotPanel.tsx` and `api/nvidia.js`.

---

## 0. Headline: three of the AI's four data paths are already broken

Before the entity decision breaks anything, the following is true of `main` today. All
three are verified by reading the call sites, not inferred.

| # | Break | Evidence | Effect on answers |
|---|---|---|---|
| **B1** | **`buildEdgeContext()` is never called.** `App.jsx:567-574` passes a **hardcoded, all-zero literal** as `edgeContext`. | `grep -rn buildEdgeContext src api` returns only its definition (`cofounderAI.ts:60`) and its re-export (`:695`). `App.jsx` supplies `financials: { totalRevenue: 0, pendingRevenue: 0, avgMonthlyRevenue: 0, lastMonthRevenue: 0, growthRate: '0%', invoicesIssued: 0, invoicesPaid: 0, invoicesPending: 0 }` and `documents: { total: 0, ... }` | Every number in `EdgeContext` is **literally zero**. Only `company`, `team.user` and `orgId` carry real values. The suggested-prompt generator (`getSuggestedPrompts`, `cofounderAI.ts:545`) branches on these zeros |
| **B2** | **Company Memory is extracted from a single `organizations` row.** `refreshMemory()` (`companyMemory.ts:366-378`) and `loadCompanyMemory()` (`:292-317`) do `supabase.from('organizations').select('*')` and pass that row to `extractCompanyMemory()` | `extractKeyMetrics()` (`:399`) reads `orgData.employees`, `orgData.crm`, `orgData.fin_docs`, `orgData.records`. **None of these is a column on `organizations`.** They are all `undefined`, so every `if (x && typeof x === 'object')` guard fails | `key_metrics` comes back **empty**. `analyzeCRM`, `analyzeFinancials`, `analyzeTeam` and `analyzeDocuments` (`:450`, `:490`, `:520`, `:551`) all return immediately. So `insights` / `opportunities` / `risks` are permanently empty arrays, and `getRelevantMemory()` returns three empty lists to every reasoning query |
| **B3** | **The CRM section key is wrong.** `formatRawDataForPrompt` does `formatCRM(orgData.crm \|\| orgData.leads)` (`companyMemory.ts:979`, and again in the fallback at `:1002`) | `orgStore`'s cache keys are the `SECTIONS` keys (`orgStore.js:65-340`): `departments`, `employees`, `ex_employees`, `tasks`, **`customers`**, **`crm_leads`**, `products`, `catalog`, `expenses`, `records`, `fin_notifs`, `fin_recurring`, plus `fin_docs` (hydrated separately, `orgStore.js:1043`). **There is no `crm` key and no `leads` key** | `formatCRM` always hits its `return 'No CRM data available.'` guard. **The AI cannot see a single lead.** |
| **B4** | **There is no `formatCustomers` at all.** | `companyMemory.ts` has `formatFinancials`, `formatProducts`, `formatCatalog`, `formatEmployees`, `formatCRM`, `formatTasks`, `formatCompanyInfo` — and nothing for `customers` | The `customers` section is loaded into the cache on every login and **never reaches a prompt**. Ask "who are our clients" and the AI answers from nothing |

**This matters for Phase 0 planning in a specific way:** the entity merge cannot "silently
degrade" the CRM/customer answers, because they are already at zero. But it *will* be
blamed for it if these are not fixed and tested in the same change. **Fix B3/B4 as part of
the merge, with a test, or the merge takes the blame for a pre-existing bug.**

---

## 1. The one path that works: `formatRawDataForPrompt`

This is the real context pipeline, and it is good.

```
CopilotPanel.tsx:680  getContextForQuery(orgId, message, memory)
  └─ companyMemory.ts:1011  getContextForQuery
       ├─ detectQueryIntent(message)                    → 'factual' | 'reasoning' | 'combined'
       ├─ fetchRawOrgData(orgId)          (:648)        → orgStore.getCache()   ← no DB read
       └─ formatRawDataForPrompt(orgData, intent, msg)  (:894)
            └─ keyword-gated sections, joined into the system prompt
```

`fetchRawOrgData` reads **`orgStore.getCache()`**, not the database. It bootstraps
`orgStore.load(orgId)` if the cache is cold. So **the AI's view of the tenant is exactly
`orgStore.SECTIONS` plus `_profile` plus `fin_docs`** — nothing more, nothing less.

### The complete read map

Every table and field the working path reaches, via the `orgStore` section that supplies it.

| orgStore key | Table | Formatter | Fields actually read by the formatter |
|---|---|---|---|
| `_profile` | `organizations` (+ `org_banking`, `subscriptions`, `org_settings` merged in `orgStore.js:539-557`) | `formatCompanyInfo` (`:869`) | `company_name`, `owner_full_name` (falling back through `founder_name`/`owner_name`/`first_name`/`name`), `industry`, `company_size`, `city`, `country`, `company_website`, `company_description` |
| `employees` | `employees` where `exited_at is null` | `formatEmployees` (`:823`) | `studentName`/`name`/`fullName`, `designation`/`role`/`position`, `department`, `email` — i.e. the **legacy aliases** `orgStore.employeeFromRow` emits, not the column names |
| `tasks` | `tasks` | `formatTasks` (`:845`) | `title`, `status`, `assignedName`, `assignedRole`, `deadline`, `priority`, `description`, `notes` |
| `fin_docs` | `financial_documents` | `formatFinancials` (`:667`) | `type`, `status`, `grand_total`\|`amount`, `invoice_number`\|`id`, `client_name`\|`issued_to`\|`customer_name`, `issue_date`\|`created_at` |
| `expenses` | `expenses` | `formatFinancials` (same fn) | `amount`, `category`, `description` |
| `catalog` | **`catalog_items`** | `formatCatalog` (`:756`) | `name`, `sku`, `unit_price`, `unit`, `category`, `tax_rate`, `hsn_sac`, `units_sold`, `invoice_count`, `revenue`, `revenue_paid`, `last_sold_at`, `track_inventory`, `stock_qty`, `archived_at` |
| `products` | `products` (ProductPlanner roadmap) | `formatProducts` (`:740`) | `name`, `status`, `priority`, `due_date` |
| `crm_leads` | `crm_leads` | — | **Unreachable (B3)** |
| `customers` | `customers` | — | **No formatter exists (B4)** |
| `records` | `records` | — | **No formatter.** Read only by the broken `extractKeyMetrics` path |
| `ai_company_memory` | `ai_company_memory` | `getRelevantMemory` | `memory.facts`, `.insights[0..2]`, `.opportunities[0..2]`, `.risks[0..2]`, `.onboarding.*` |

### Section gating

`formatRawDataForPrompt` (`:894-1008`) selects sections by **keyword match on the user's
message**, not by intent alone. `needsCRM` fires on `customer` / `lead` / `client` / `crm`
/ `deal` / `contact`; `needsProducts` on `product` / `sku` / `catalog` / `sell` / `sold` /
`sales` / `inventory` / `stock` / `hsn`; and so on. If nothing matches, it falls back to
dumping employees + financials + catalogue + CRM + tasks (`:1000-1007`).

**Note for the merge:** `needsCRM`'s keyword list already includes `client`. The
vocabulary is ready for the rename; the data path is not.

### What `formatCatalog` gets right, and must keep

`companyMemory.ts:748-755` documents it explicitly: the rollups
(`units_sold` / `revenue` / `revenue_paid` / `last_sold_at`) are **maintained in Postgres by
`app.recompute_catalog_sales()`**, so the model reads a ranking rather than deriving totals
from a list of invoices. This is the correct pattern and is the model to follow for every
new AI-visible aggregate. **Do not regress it.**

---

## 2. `EdgeContext` — the contract as written vs. as fed

`cofounderAI.ts:16-42`. Declared shape:

| Field | Declared source (in `buildEdgeContext`, `:60-122`) | **Actually fed today** |
|---|---|---|
| `company` | `activeOrg.company_name \|\| activeOrg.name` | Real |
| `financials.totalRevenue` | `finDocs` type `invoice`, status `paid`, sum of `grand_total \|\| amount \|\| subtotal` | **`0`** |
| `financials.pendingRevenue` | invoices with status `pending` **or `sent`** | **`0`** |
| `financials.avgMonthlyRevenue` / `lastMonthRevenue` / `growthRate` | 6-month buckets on `issue_date \|\| created_at` | **`0` / `0` / `'0%'`** |
| `financials.invoicesIssued/Paid/Pending` | counts | **`0`** |
| `documents.*` | `records` by `type`, `finDocs` by `type` | **`0`** |
| `trends.monthlyRevenue` | 6-element array | **`[]`** |
| `trends.documentGrowth` | hardcoded `'stable'` even in the real builder | `'stable'` |
| `team.user` / `team.role` | `user.email` / `user.role` | `user.email` / `'Admin'` (hardcoded) |
| `orgId` | `activeOrg.id` | Real |

Two latent bugs in `buildEdgeContext` itself, for whenever it is wired up:

- `:70` filters `status === 'pending' || status === 'sent'` for pending revenue. `pending`
  is a **records/offer** status (`0008_pending_status.sql`), not an invoice status. It also
  misses `viewed`, `partially_paid`, `overdue` and `payment_submitted` — the statuses that
  `app.catalog_is_sold()` (`0011:110-116`) treats as issued. **Pending revenue would be
  understated.**
- `:69` counts revenue as `status === 'paid'` only, which *does* agree with
  `app.catalog_is_collected()`. But it calls that number `totalRevenue`, while
  `sales_by_country()` and `catalog_performance()` call the *issued* figure "revenue" and
  the paid figure "collected". **Three definitions of "revenue" across the product.**

---

## 3. `Company Memory` — the contract

`ai_company_memory` is one row per org: `org_id` PK, `memory jsonb`, `updated_at`
(`0001_init.sql:680`). RLS: member-read, writer-write (`0003_rls.sql:167-170`).

`memory` holds a `CompanyMemory` (`companyMemory.ts:48-56`):

- `facts: CompanyFacts` — `company_name`, `industry`, `team_size`, `country`, `city`,
  `website`, `description`, `key_metrics{ total_revenue, pending_revenue, invoice_count,
  employee_count, lead_count, customer_count, total_documents, offer_count, nda_count,
  mou_count }`
- `insights[]`, `opportunities[]`, `risks[]` — capped at 20 each (`MAX_ITEMS_PER_CATEGORY`)
- `onboarding` — eight answers (`ONBOARDING_QUESTIONS`, `:85-94`): firstName, lastName,
  role, companyName, companyStage, description, targetCustomer, painPoints

Per **B2**, `facts.key_metrics` and all three list fields are empty in practice. What
actually survives and is used is **`onboarding`** — written by `saveOnboardingAnswer()`
(`:132`) straight from the chat, read by `buildSystemPrompt()` (`cofounderAI.ts:133-140`).
That path works.

---

## 4. What the entity decision breaks, item by item

Cross-referenced against `entity-decision.md`.

| # | Breakage | Severity | Where | Fix |
|---|---|---|---|---|
| **A1** | `formatCRM(orgData.crm \|\| orgData.leads)` — a rename of the `crm_leads` section to `clients` changes nothing, because the key was already wrong (**B3**) | **Latent → must fix with the merge** | `companyMemory.ts:979`, `:1002` | Replace both call sites with `formatClients(orgData.clients)`. Do not preserve the `\|\| orgData.leads` fallback — it has never resolved |
| **A2** | `formatCRM` partitions on `item.status === 'customer' \|\| item.stage === 'customer' \|\| item.status === 'won'` (`:790-791`) | **High** | `companyMemory.ts:788-792` | Neither `'customer'` nor `'won'` is a value in `crm_leads.stage` today (`CRM.jsx` writes `lead`/`contacted`/`deal`/`not_deal`) **or** in the proposed `client_status`. The partition must be rewritten against `client_status` explicitly: `lead`/`contacted` → pipeline, `active` → clients, `lost` → excluded |
| **A3** | `formatCRM` reads `item.name \|\| item.company \|\| item.contact` (`:783`) | **High** | `companyMemory.ts:783` | `crm_leads` has `company_name` and `person_name`; **none of `name`/`company`/`contact` exists**. Every lead would render as `"Unknown"` even after A1 is fixed. Map to `clients.name` / `clients.person_name` |
| **A4** | `extractKeyMetrics` reads `orgData.crm \|\| orgData.leads` and counts `stage === 'lead'` / `status === 'customer'` (`:408-413`) | **Medium** (already dead per B2) | `companyMemory.ts:408-413` | `lead_count` / `customer_count` become counts over `client_status`. Fix only in the same change that fixes B2, or it stays dead |
| **A5** | `analyzeCRM` reads `item.value \|\| item.deal_value \|\| item.amount` and `item.stage.includes('negotiation'\|'proposal')` (`:450-475`) | **Medium** (dead per B2) | `companyMemory.ts:450` | `clients.value` survives. **The `negotiation` / `proposal` stage strings match no stage that has ever existed in this product** — dead branches, delete them rather than porting |
| **A6** | `formatFinancials` reads `d.client_name \|\| d.issued_to \|\| d.customer_name` off financial docs (`:687`) | **None** | `companyMemory.ts:687` | Reads the **frozen `bill_to_*` snapshot** surfaced by `orgStore.financialDocFromRow`, not the client table. The merge does not touch this — by design, per `entity-decision.md` §6.3 |
| **A7** | `orgStore.SECTIONS.customers.fromRow` emits legacy aliases `clientName`/`clientEmail`/`contactPhone`/`clientAddress`/`buyerGSTIN`/`buyerState` (`orgStore.js:124-133`) | **Medium** | `orgStore.js` | **This is the adapter, and it already exists.** Keep emitting the aliases from the new `clients` table so the four finance forms and `documentStore.getSavedClients()` need no change. Add the new fields (`status`, `person_name`, `value`, `source`) alongside |
| **A8** | `needsCRM` keyword gate (`:909-910`) | **None** | `companyMemory.ts:909` | Already includes `client`, `customer`, `lead`, `crm`, `deal`, `contact`. No change needed |
| **A9** | `app.resolve_document_country()` reads `public.customers` twice by name (`0013:104-118`) | **Highest** | `0013_sales_by_country.sql` | Not an AI break, but it feeds `sales_by_country()` which feeds a protected widget. Listed here because it is the one that **fails silently**: the chain falls through to `org_default` and the map keeps rendering, just wrong. See `entity-decision.md` §4 #3 |

---

## 5. The adapter layer

**Decision: `orgStore.SECTIONS` is the adapter. Do not add a second one.**

It already does exactly this job — `SECTIONS.customers.fromRow` translates Postgres column
names into the Firebase-era names the UI was written against, and `toRow` translates back.
`SECTIONS.employees` does the same at a larger scale (`orgStore.js:342-372`, mapping
`full_name` → `studentName`/`name`/`fullName` and `exited_at` →
`terminated_at`/`termination_date`). Adding a separate AI adapter would mean two mapping
layers that can disagree.

### The contract, stated so it can be tested

> **The AI reads `orgStore.getCache()`. Any schema change that alters a `SECTIONS` key, or
> alters a field name emitted by a `fromRow`, is a change to the AI's context and must be
> accompanied by the matching change to the formatter in `companyMemory.ts`.**

### Required work, in the same commit as the entity merge

1. **Rename the section, keep the aliases.** `SECTIONS.clients` with `table: 'clients'`,
   whose `fromRow` emits *both* the new fields (`status`, `person_name`, `value`, `source`,
   `country_code`) **and** every legacy alias A7 lists. Keep `customers` as a deprecated
   alias key pointing at the same cache object for one release, so
   `documentStore.getSavedClients()` (`documentStore.js:52`) and the four finance forms
   keep working untouched.
2. **Delete `SECTIONS.crm_leads`.** Preserve its `extra` jsonb round-trip behaviour on
   `clients`.
3. **Write `formatClients(clients)`** in `companyMemory.ts`, replacing `formatCRM`. It must:
   - group by `client_status`, not by the invented `'customer'`/`'won'` strings (A2);
   - read `name` / `person_name`, not `name`/`company`/`contact` (A3);
   - surface `value` for pipeline entries and document count for `active` ones;
   - state its definitions in the prompt text the way `formatCatalog` does
     (`companyMemory.ts:781-784`) — "active means at least one issued document".
4. **Wire both call sites** (`:979`, `:1002`) to `formatClients(orgData.clients)`.
5. **Fix B1** — call `buildEdgeContext({ records, finDocs, user, activeOrg })` in `App.jsx`
   instead of the zero literal, or delete `EdgeContext`'s numeric fields entirely. Shipping
   a rebrand on a context object that reports ₹0 revenue is not acceptable either way.
6. **Fix B2** — `refreshMemory` must pass `orgStore.getCache()` to `extractCompanyMemory`,
   not a bare `organizations` row.
7. **Align "revenue" on one definition.** Use `app.catalog_is_sold()` /
   `app.catalog_is_collected()` (`0011:110-120`) as the single source, the way
   `sales_by_country()` already does. Three definitions across `BillingRevenue.jsx`,
   `Hub.jsx` and `cofounderAI.ts` is a support burden and an AI-hallucination surface.

### The regression test the contract needs

A fixture org with: one `lead`, one `active` client with a paid invoice, one `lost` client,
one catalogue item sold. Assert the built prompt string contains the client's real name,
the correct status partition, and a revenue figure that equals
`sales_by_country()`'s `collected` for the same window. **This test is what turns the
contract above from a comment into a guarantee**, and it is why `definition-of-done.md`
does not list "AI context" as optional.

---

## 6. Server-side surface

`api/nvidia.js` is the only server component. It:

- reads the caller's org from the request and increments `usage_counters.ai_messages` via
  `public.bump_ai_usage()` (`0010_ai_usage.sql`), service-role only;
- reads `subscriptions.plan` and returns **HTTP 429** over the ceiling (`:60-66`);
- duplicates `planConfig.js`'s `aiMessages` limits deliberately (`:17`).

**This is the only server-enforced plan limit in the product.** It is the template
`definition-of-done.md` §5 points at. The entity merge does not touch it.

---

## 7. Sign-off items

| # | Question | Recommendation |
|---|---|---|
| AI1 | Fix B1–B4 inside the entity merge, or as a separate prior change? | **Separate prior change.** Otherwise the merge gets blamed for a pre-existing zero-context bug, and its own regression test has no working baseline to compare against |
| AI2 | Wire `buildEdgeContext`, or delete `EdgeContext`'s numeric fields? | **Wire it**, and fix the `pending`/`sent` status filter at `cofounderAI.ts:70` while doing so |
| AI3 | One definition of "revenue"? | **Yes — `app.catalog_is_sold` / `is_collected`.** Everything else reports against those two |
| AI4 | Keep `orgStore.SECTIONS` as the sole adapter? | **Yes.** A second AI-specific mapping layer is how the two drift |
| AI5 | Does the AI get to see `audit_log` once the Activity Log is populated? | **Undecided — your call.** It would make "what changed last week" answerable, and it is the one table members cannot read (`audit_log_select` is admin-only), so it needs a deliberate policy decision, not a formatter |
