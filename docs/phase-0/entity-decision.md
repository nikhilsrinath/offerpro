# Entity Decision — `customers`, `crm_leads`, and the proposed `clients`

**Phase 0 · decision document. Proposal only. No migration is written in this phase.**

---

## 1. The finding that drives the decision

`customers` is not a client directory. It is a **derived projection of who has been
invoiced**, and it is destructive.

`src/services/customerService.js:85-135`, `syncFromInvoices()`:

```js
// Delete customers not backed by any financial doc
const existing = await customerService.getAll(orgId);
await Promise.all(
  existing
    .filter(c => !financialNames.has((c.clientName || '').toLowerCase().trim()))
    .map(c => customerService.delete(orgId, c.id))
);
```

It is called from `src/components/Customers.jsx:270`, on every load of the Customers page,
once per org per browser session (guarded by the in-memory `_syncedOrgs` set, which resets
on reload).

**Consequences as shipped today:**

| Behaviour | Effect |
|---|---|
| A client added by hand and not yet invoiced | **Deleted** on the next load of the Customers page |
| A lead dragged to "Deal" in the CRM (`CRM.jsx:139` calls `customerService.upsert`) | **Deleted**, because a deal has no invoice yet |
| Matching key | `lower(trim(name))` — email, GSTIN and phone are ignored |
| Two real clients with the same legal name | Impossible. `customers_org_name_idx` (`0001_init.sql:304`) is a **unique index on `(org_id, lower(btrim(name)))`** |
| `financial_documents.customer_id` | Nullable FK, `on delete set null`, and **the Customers detail pane does not use it** — `Customers.jsx:51-56` joins documents to a customer by **string-comparing `d.issued_to` to `customer.clientName`** |
| A client who renames | Loses their entire document history in the UI, and gets re-created as a second row by the next `upsert` |

So "Client Directory" is not a new feature and is not a working one either. It is an
existing screen sitting on a table whose contract is "billed parties", being asked to
behave like "every party we deal with".

`crm_leads` is the opposite: durable, never auto-deleted, but with no link to anything.
Nothing in the schema references it — **zero foreign keys point at `crm_leads`.** When a
lead becomes a deal, `CRM.jsx:139` copies three fields (`company_name`/`person_name`,
`email`, `phone`) into `customers` by name and the two rows drift apart forever.

**Verdict: unify. These are one entity with a lifecycle, modelled today as two tables plus
a lossy one-way copy.**

---

## 2. Proposed `clients` table

Not written as a migration in this phase. This is the shape to sign off.

```sql
-- PROPOSAL ONLY — not to be applied in Phase 0.
create type client_status as enum (
  'lead',        -- captured, not yet contacted        (crm_leads.stage = 'lead')
  'contacted',   -- in conversation                    (crm_leads.stage = 'contacted')
  'qualified',   -- fit confirmed, no document yet     (NEW — see §3)
  'active',      -- has at least one issued document   (crm_leads 'deal' + all of customers)
  'dormant',     -- was active, nothing in N months    (NEW — derived, see §3)
  'lost',        -- did not convert                    (crm_leads.stage = 'not_deal')
  'archived'     -- hidden by the operator             (NEW)
);

create table clients (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,

  -- Identity. `name` is the billing/legal name and is what appears on documents.
  -- `person_name` is the human contact. crm_leads has both today; customers has
  -- only one, which is why a lead's contact name is lost on conversion.
  name          text not null check (length(btrim(name)) > 0),
  person_name   text,
  email         citext,
  phone         text,
  address       text,

  -- Tax / place-of-supply. From customers.
  gstin         text,
  state         text,
  country_code  char(2) references country_codes(code),   -- DEFAULT only; see §6

  -- Lifecycle. Replaces crm_leads.stage and the existence-of-a-row semantics
  -- that customers uses today.
  status        client_status not null default 'lead',
  status_changed_at timestamptz not null default now(),

  -- Pipeline. From crm_leads.
  value         numeric(14,2) check (value is null or value >= 0),
  position      integer not null default 0,     -- kanban ordering within a status
  notes         text,

  -- Provenance, so "where did this client come from" survives the merge and the
  -- Phase 3 storefront can add its own value without a migration.
  source        text,          -- 'manual' | 'invoice_sync' | 'crm' | 'import' | 'checkout'

  extra         jsonb not null default '{}'::jsonb,   -- crm_leads.extra, preserved
  archived_at   timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint clients_named check (
    coalesce(btrim(name), '') <> '' or coalesce(btrim(person_name), '') <> ''
  )
);
```

### Three constraint decisions that need your sign-off

**(a) Drop the unique-name index.** `customers_org_name_idx` must **not** be carried over.
Two clients can legitimately share a name, and the index is the reason `upsert` was written
as a name match in the first place. Replace it with a **non-unique** index
`clients_org_name_idx on clients (org_id, lower(btrim(name)))` for lookup, plus an optional
partial unique index on `(org_id, lower(gstin)) where gstin is not null` — a GSTIN *is* a
real key.

**(b) Deletion becomes archival.** `financial_documents.customer_id` is
`on delete set null`. Hard-deleting a client silently detaches its invoices, which is how
`syncFromInvoices` has been quietly destroying attribution. `archived_at` + an admin-only
delete policy, matching the pattern `catalog_items` already established in
`0011_product_catalog.sql:52-55` for exactly this reason.

**(c) `syncFromInvoices()` is deleted, not ported.** Its only defensible half — creating a
client row for a buyer typed straight onto an invoice — becomes an **insert-only** upsert
with `source = 'invoice_sync'`. The delete arm goes away entirely. This is a behaviour
change users will notice: clients that would previously have vanished will stay.

---

## 3. CRM stage → `client_status` mapping

CRM stages today are hardcoded in JavaScript, not in the database: `src/components/CRM.jsx:10-15`.
`crm_leads.stage` is a bare `text not null default 'lead'` with **no check constraint**, so
any string can be stored.

| `crm_leads.stage` (today) | `client_status` | Notes |
|---|---|---|
| `lead` | `lead` | Direct |
| `contacted` | `contacted` | Direct |
| `deal` | `active` | `CRM.jsx:138-143` already copies these into `customers`; after the merge, the copy disappears and the status simply changes |
| `not_deal` | `lost` | Direct |
| *(any other string)* | `lead` | The column has no constraint, so the backfill must have a fallback. **Count the distinct values in prod before the migration is written.** |
| *(a row in `customers` with no CRM counterpart)* | `active` | Every existing `customers` row is by definition a billed or manually-added party |

**Two statuses are new and have no source data:** `qualified` and `dormant`.

- `qualified` is a genuine addition to the pipeline. If the brief does not ask for it,
  **drop it** — an enum value with no UI is a trap.
- `dormant` is derivable (`active` with no document in N months) and therefore should
  probably *not* be a stored status at all. Storing it means something has to write it,
  and nothing on a server currently runs on a schedule (see `feature-audit.md` #29).
  **Recommendation: cut both from v1.** Ship five values: `lead`, `contacted`, `active`,
  `lost`, `archived`. Adding an enum value later is a one-line migration; removing one
  is not.

**Sign-off item: five statuses or seven?**

---

## 4. Every foreign key that must be repointed

There are exactly **two**, and both point at `customers`. **Nothing anywhere references
`crm_leads`.**

| # | Table | Column | Current definition | Migration action |
|---|---|---|---|---|
| 1 | `financial_documents` | `customer_id` | `uuid references customers(id) on delete set null` (`0001_init.sql:420`) | Repoint to `clients(id)`. **Keep `on delete set null`** — the buyer identity is already frozen on the document in `bill_to_name` / `bill_to_email` / `bill_to_address` / `bill_to_gstin` / `bill_to_state`, so a detached document is still a complete document |
| 2 | `recurring_invoices` | `customer_id` | `uuid references customers(id) on delete set null` (`0001_init.sql:520`) | Repoint to `clients(id)`. Same reasoning; `recurring_invoices` also carries its own `bill_to_*` columns |

### Non-FK dependencies that break silently and are easy to miss

| # | Location | Dependency | Why it breaks |
|---|---|---|---|
| 3 | `app.resolve_document_country()` (`0013_sales_by_country.sql:97-140`) | `select c.country_code ... from public.customers c where c.id = p_customer` **twice**, plus `app.country_from_state(c.state)` | Reads `customers` **by name in SQL**. A rename breaks the country resolution chain for every new document. **This is the single highest-risk item in the merge** — it silently degrades to the org default rather than erroring |
| 4 | `app.fin_doc_set_country()` trigger (`0013:145-160`) | Calls #3 | Same |
| 5 | `public.sales_by_country()` (`0013:196+`) | `count(distinct s.customer_id)` on `financial_documents` | Column name only, not a join to `customers`. Survives an FK repoint **provided the column keeps its name**. **Recommendation: keep the column named `customer_id`, do not rename it to `client_id`** — it is read by a protected feature and renaming buys nothing |
| 6 | `supabase/tests/01_isolation_test.sql:14` | `truncate ... customers ...` | Test fixture references the table name |
| 7 | `0003_rls.sql:30` and `:97` | `customers` and `crm_leads` appear in both the enable-RLS array and the uniform-policy array | Both arrays need the new table name; the old ones must not be left with policies pointing at dropped tables |

---

## 5. Every screen and service that reads `customers` or `crm_leads` today

Complete list. Verified by grep across `src/` and `api/`.

### Reads / writes `customers`

| # | File | Line(s) | What it does | Impact |
|---|---|---|---|---|
| 1 | `src/services/orgStore.js` | 121-143 | `SECTIONS.customers` — `table: 'customers'`, `fromRow` maps to the legacy Firebase names `clientName` / `clientEmail` / `contactPhone` / `clientAddress` / `buyerGSTIN` / `buyerState`; `toRow` maps back | **The chokepoint.** Change `table:` here and the `fromRow`/`toRow` mapping and almost everything below keeps working unchanged. This is the adapter layer, and it already exists |
| 2 | `src/services/customerService.js` | whole file (173 lines) | `getAll` / `create` / `update` / `delete` / `upsert` / `deduplicate` / `syncFromInvoices` / `search` | `syncFromInvoices` **deleted**; `deduplicate` deleted (it exists only to service the unique-name index); `upsert` rewritten to match on id-or-GSTIN-or-email, never on name alone |
| 3 | `src/components/Customers.jsx` | 6, 270-271, 277, 313, 319, 334 | The Customers page: sync-on-load, list, search, create, update, delete | Remove the `syncFromInvoices` call at :270. Add a status filter |
| 4 | `src/components/Customers.jsx` | **44-66** | `CustomerDetail` joins documents to the client by **string-matching `d.issued_to` against `customer.clientName`** | Must be rewritten to use `customer_id`. This is a correctness fix that the merge forces and should be done regardless |
| 5 | `src/components/CRM.jsx` | 7, 139-143 | On drag to "Deal", copies the lead into `customers` via `upsert` | **Deleted.** After the merge this is a `status` update on one row |
| 6 | `src/components/InvoiceForm.jsx` | 5, 149, 165, 192, 357 | Client picker (`getAll` + `search`), inline create, and `upsert` on save | Reads via `customerService`; survives if the service keeps its signature |
| 7 | `src/components/financial/QuotationForm.jsx` | 6, 56, 213-221, 239, 358 | Same pattern, via `documentStore.getSavedClients()` for the dropdown and `customerService.upsert` on save | Same |
| 8 | `src/components/financial/ProformaInvoiceForm.jsx` | 6, 22, 94-102, 120, 273 | Same pattern | Same |
| 9 | `src/components/financial/RecurringInvoiceForm.jsx` | 114, 172-179, 358 | Client dropdown only (`getSavedClients`), no upsert | Same |
| 10 | `src/services/documentStore.js` | 52 | `getSavedClients: () => orgStore.getSectionAsList('customers')` | One-line change; rename the section key or keep `'customers'` as an alias |
| 11 | `src/App.jsx` | 67, 92 | Route id `customers`, nav label "Customers" | Rebrand to "Clients" |
| 12 | `src/components/Hub.jsx` | 20 | Module description already says *"CRM pipeline, client database, product catalogue…"* | Copy only |
| 13 | `api/portal.js` | — | Does **not** touch `customers`. It reads `financial_documents` and the frozen `bill_to_*` fields | **No impact.** Worth stating: the portal is insulated from this entire decision by the snapshot design |

### Reads / writes `crm_leads`

| # | File | Line(s) | What it does |
|---|---|---|---|
| 14 | `src/services/orgStore.js` | 146-167 | `SECTIONS.crm_leads`, including the `extra` jsonb spread on read and re-collection on write |
| 15 | `src/components/CRM.jsx` | 10-15 | `COLUMNS` — the four stages, hardcoded |
| 16 | `src/components/CRM.jsx` | 49-53 | `listenSection('crm_leads')` + `getSectionAsList` |
| 17 | `src/components/CRM.jsx` | 97, 101, 119, 129 | update / add / remove / move-stage |
| 18 | `src/App.jsx` | 67, 91, 248 | Route id `crm`, nav label, default page for the Business module |

### The AI layer — **currently reads neither, and is broken**

| # | File | Line(s) | Finding |
|---|---|---|---|
| 19 | `src/services/companyMemory.ts` | 979 | `sections.push(formatCRM(orgData.crm \|\| orgData.leads))` — **but `orgStore`'s cache key is `crm_leads`.** Neither `orgData.crm` nor `orgData.leads` exists, so `formatCRM` always hits its `if (!crm) return 'No CRM data available.'` guard |
| 20 | `src/services/companyMemory.ts` | — | **There is no `formatCustomers` at all.** The `customers` section is cached by `orgStore` and never formatted into a prompt |

**So the AI Co-founder cannot see a single lead or client today, and says so.** The merge
can only improve this — but the adapter has to be written deliberately, not assumed.
Detailed in `ai-context-contract.md` §4.

---

## 6. What the merge must not disturb

1. **`financial_documents.country_code` stays the authoritative country.** The client's
   `country_code` remains a **default only**, exactly as `0013_sales_by_country.sql`
   designed it. Do not "simplify" the country resolution chain into a join against
   `clients` — that is the regression `0013`'s header exists to prevent.
2. **Keep the column name `financial_documents.customer_id`.** Repoint the FK, do not
   rename the column. `public.sales_by_country()` reads it (`count(distinct s.customer_id)`).
3. **Frozen buyer identity stays frozen.** `bill_to_name`, `bill_to_email`,
   `bill_to_address`, `bill_to_gstin`, `bill_to_state` on both `financial_documents` and
   `recurring_invoices` are point-in-time snapshots. The merge must not start resolving
   them through the FK at render time.
4. **`crm_leads.extra` must survive.** It is a jsonb catch-all holding ad-hoc CRM form keys
   (`orgStore.js:144-145`). Backfill it into `clients.extra` verbatim; do not flatten it.

---

## 7. Recommendation, stated plainly

**Create `clients` as a new table; backfill from both `customers` and `crm_leads`; repoint
the two FKs; keep `customers` and `crm_leads` as read-only views for one release; then drop
them.** The view step is what lets `orgStore.SECTIONS` and every form above migrate one at
a time instead of in a single commit.

**The cheapest correct order** (sequenced in `migration-order.md` as M4–M9):

1. Create `clients` + `client_status` + RLS + policies. Nothing reads it yet.
2. Backfill from `crm_leads` first (it has both name fields), then merge `customers` rows
   into it on GSTIN, then email, then exact name — **never on fuzzy name** — recording
   `source`.
3. Add `financial_documents.client_id` and `recurring_invoices.client_id` **alongside** the
   existing `customer_id`, backfilled. Dual-write for one release.
4. Cut `orgStore.SECTIONS.customers` and `.crm_leads` over to `clients`. Delete
   `syncFromInvoices` and `deduplicate`. Fix `Customers.jsx:44-66` to join on the FK.
5. Update `app.resolve_document_country()` to read `clients`. **This is the one that
   silently degrades if forgotten** — it needs an explicit test asserting a new invoice for
   a client with a country still gets `country_source = 'customer'`.
6. Drop `customer_id`, drop `customers`, drop `crm_leads`.

### Sign-off items

| # | Question | My recommendation |
|---|---|---|
| E1 | Five statuses or seven? | **Five.** Cut `qualified` and `dormant` |
| E2 | Drop the unique-name constraint? | **Yes.** Replace with non-unique name index + partial unique GSTIN index |
| E3 | Delete `syncFromInvoices`'s delete arm? | **Yes.** Users will see previously-vanishing clients persist. This is a visible behaviour change and needs a line in the release note |
| E4 | Rename `customer_id` → `client_id` on documents? | **No.** Repoint the FK, keep the name. `sales_by_country()` reads it |
| E5 | Keep `customers` / `crm_leads` as views for a release? | **Yes.** It is the only thing that makes step 4 incremental |
| E6 | Is a client the same entity as a future *vendor*? | **Undecided — needs your call.** Phase 3 adds vendors. If a party can be both (you buy from and sell to the same company), `clients` should be `parties` with a role flag *now*, not split later. See `products-and-country-integration.md` §5 |
