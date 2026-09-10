# Document Model Decision — generated records vs. uploaded files

**Phase 0 · decision document. No table is created in this phase.**

---

## 1. What exists today

There is **no table for uploaded files anywhere in the schema.** I checked all thirteen
migrations. What exists is:

### Generated documents — two tables, both with a full lifecycle

| | `records` (`0001_init.sql:364`) | `financial_documents` (`0001_init.sql:412`) |
|---|---|---|
| Types | `offer`, `certificate`, `nda`, `mou`, `role_change`, `termination` | `invoice`, `quotation`, `proforma` |
| Number | `doc_number` unique per org, allocated by `public.next_document_number()` | Same |
| Status | `doc_status` enum, 20 values | Same enum |
| Issuer snapshot | `company_snapshot jsonb`, scrubbed of secrets | Same |
| Body | `data jsonb` (form snapshot) | Normalised into `document_line_items` + money columns |
| PDF | `pdf_path text` → `documents` bucket | Same |
| Portal | `portal_tokens.record_id` | `portal_tokens.financial_doc_id` |
| Signature | `document_signatures.record_id` | `document_signatures.financial_doc_id` |
| Money | none | 15 numeric columns, all trigger-maintained |
| Counted for billing | `app.bump_usage()` trigger | Same |

Both are **issued artefacts**: they have a number, a status that moves, a recipient, an
immutable issuer snapshot, a PDF, a shareable expiring link, and a signature slot. Every
one of those is a lifecycle property.

### Storage — three purpose-built buckets, no metadata table

`0004_storage.sql`:

| Bucket | Public | Limit | MIME | Purpose |
|---|---|---|---|---|
| `org-branding` | **yes** | 2 MB | png/jpeg/webp/svg | Logo, stamp — printed on documents recipients open without an account |
| `signatures` | no | 1 MB | png/jpeg/webp | Authorised signature, and signatures captured in the portal |
| `documents` | no | 20 MB | `application/pdf` **only** | Generated PDFs |

All three are policed on the first path segment being the org id
(`app.storage_org(name)`). Object paths are recorded in **columns on the owning row**
(`organizations.logo_path`, `records.pdf_path`, `document_signatures.signature_path`) —
there is no row per object.

**So the question is real:** the brief's file-library / attachment features have nowhere to
land, and the choice is whether they land in the existing document tables or a new one.

---

## 2. The two options

### Option A — one table for everything

Add a `records`-and-`financial_documents`-superset table (or widen `records`) with a
`kind` discriminator, nullable lifecycle columns, and a `storage_path`. Uploads are rows
with `doc_number = null`, `status = null`, no snapshot, no counter.

### Option B — two tables (**recommended**)

Leave `records` and `financial_documents` exactly as they are. Add one new table,
`files`, for uploaded blobs. Unify them at **read time** through a view, not at write time
through a shared table.

---

## 3. Recommendation: **Option B, two tables**

### Why

**1. The lifecycle columns are `not null` for a reason, and Option A makes every one of
them nullable.**
`records.doc_number` is `not null` with `unique (org_id, doc_number)`.
`records.title` is `not null`. `status` is `not null default 'draft'`. `issue_date` is
`not null`. An uploaded receipt has none of these. Option A's first migration is
"make five NOT NULL columns nullable", which permanently removes the guarantee that every
issued document has a number — the exact guarantee `next_document_number()` and
`app.freeze_doc_number()` (`0002_functions.sql:115`) were built to provide.

**2. Two triggers would fire on rows they were never meant to see.**
`app.bump_usage()` (`0002:337`) increments `usage_counters` on every insert into `records`
and `financial_documents`. Under Option A, **uploading a PDF would consume the user's
offer-letter quota.** The fix is a `when` clause on the trigger — i.e. adding a
discriminator check to a billing path, which is where you least want a new branch.
`app.freeze_doc_number()` has the same problem in reverse.

**3. The polymorphism is already at its limit.**
`portal_tokens` and `document_signatures` each carry two nullable FKs plus a check
constraint asserting exactly one is set:

```sql
constraint token_exactly_one_target check (
  (record_id is not null)::int + (financial_doc_id is not null)::int = 1
)
```

That is a clean two-way union. Option A does not reduce it to one FK — it *adds* a third
kind of row to a table those FKs point at, which means either a third nullable FK or a
table where some rows can never be tokenised. Option B leaves the constraint untouched:
files are simply not portal-shareable, which is correct — a portal link is a link to an
*issued document*, with a scope of `view` or `sign`.

**4. Attachments have an owner; documents have a recipient.** An uploaded file is almost
always *attached to something* — an expense receipt, a client's signed contract scan, an
employee's ID proof. That is a polymorphic parent pointer, a fundamentally different
relationship from `records`' `employee_id` / `recipient_email`. Modelling both on one row
means half the columns are null on every row.

**5. `records.data jsonb` would become a dumping ground.** It is currently a documented
point-in-time snapshot of a legal document. Sharing the table with uploads invites
"just put the file metadata in `data`", and the shape stops being knowable.

**6. Option B is reversible; Option A is not.** Adding a `files` table later merges into
Option A trivially. Widening `records` and then splitting it back out means re-issuing
document numbers.

### What Option B costs, stated honestly

- Two tables to query for "show me everything about this client". Solved by the view in §5.
- Two RLS policy sets instead of one. Cheap — `0003_rls.sql:97` already applies a uniform
  policy to twelve tables from an array; `files` is one more array entry.
- Two places to enforce a storage quota, if files are ever metered.

---

## 4. Proposed `files` table

**Proposal only — not created in Phase 0.**

```sql
-- PROPOSAL ONLY.
create table files (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,

  -- Storage object in a NEW bucket. The existing `documents` bucket is
  -- application/pdf-only, 20 MB, and holds generated output — mixing user
  -- uploads into it would mean loosening its MIME allowlist, which is the one
  -- thing keeping a public-facing bucket boring.
  bucket        text not null default 'uploads',
  storage_path  text not null,           -- always '{org_id}/...' — app.storage_org() polices it

  filename      text not null,           -- as the user named it
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes >= 0),
  checksum      text,                    -- sha256, for dedupe

  -- What this file is attached to. Nullable: a file can live in the library
  -- attached to nothing. Deliberately a loose (type, id) pair rather than N
  -- nullable FKs — unlike portal_tokens, the set of attachable parents is open
  -- (expenses today, vendors and purchase orders in Phase 3) and a check
  -- constraint enumerating them would need a migration per new parent.
  parent_type   text check (parent_type is null or parent_type in
                  ('client','employee','expense','record','financial_document','task')),
  parent_id     uuid,

  label         text,
  uploaded_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,             -- soft delete; the storage object is reaped separately

  constraint files_parent_paired check (
    (parent_type is null) = (parent_id is null)
  )
);
```

**Open question for sign-off (D3 below):** the loose `(parent_type, parent_id)` pair buys
extensibility at the cost of referential integrity — nothing stops a `parent_id` pointing
at a deleted row, and `on delete cascade` cannot be expressed. The alternative is one
nullable FK per parent with a `check (...)::int + ... <= 1`, matching `portal_tokens`.
That is stricter and I would normally prefer it; I am recommending the loose pair **only**
because Phase 3 adds vendors and purchase orders and each would otherwise be a schema
change to this table. **Your call.**

Plus one new bucket:

```sql
-- PROPOSAL ONLY.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', false, 25 * 1024 * 1024, null);   -- MIME allowlist TBD
```

with the same four `app.storage_org(name)` policies the other three buckets use.

---

## 5. The unified search surface

This is the part that makes two tables acceptable, and it should be designed now even
though it is built later.

**A single read-only view, one row per searchable thing, never written through.**

```sql
-- PROPOSAL ONLY.
create view searchable_documents as
  select
    'record'::text            as kind,
    r.id, r.org_id,
    r.doc_number              as reference,
    r.title,
    r.type::text              as subtype,
    r.status::text            as status,
    r.recipient_name          as party_name,
    r.issue_date              as dated_on,
    null::numeric             as amount,
    r.pdf_path                as storage_path,
    r.created_at
  from records r

  union all

  select
    'financial_document', d.id, d.org_id, d.doc_number,
    coalesce(d.bill_to_name, d.doc_number),
    d.type::text, d.status::text, d.bill_to_name,
    d.issue_date, d.grand_total, d.pdf_path, d.created_at
  from financial_documents d

  union all

  select
    'file', f.id, f.org_id, null,
    coalesce(f.label, f.filename),
    f.mime_type, null, null,
    f.created_at::date, null, f.storage_path, f.created_at
  from files f
  where f.deleted_at is null;
```

### Why a view and not a materialised search table

- **RLS composes for free.** A view owned by a non-`SECURITY DEFINER` role runs with the
  caller's privileges, so `records_select`, `fin_docs_select` and `files_select` each apply
  to their own branch. No new policy, and no way for the search surface to become the one
  place tenant isolation leaks. A materialised table would need its own policy *and* its
  own isolation test, and would be a second copy of tenant data.
- **No staleness.** A materialised view or a `search_index` table needs a refresh trigger
  on three tables; `records` and `financial_documents` already carry five triggers each.
- **It costs nothing until something reads it.**

### Full-text, when it is needed

`union all` over three indexed tables is fine for the row counts this product has. When it
is not:

- Add a **generated `tsvector` column plus a GIN index to each base table** — not to the
  view. `records`: `title || recipient_name || doc_number`. `financial_documents`:
  `bill_to_name || doc_number`, and separately `document_line_items.description`.
  `files`: `filename || label`.
- The view then exposes the vector and the predicate pushes down into each branch.
- Do **not** put a `tsvector` on `records.data` or `financial_documents.payload`. Those
  jsonb blobs contain the full form snapshot including addresses and, historically, fields
  that had to be scrubbed (`0001:376-379`). Indexing them makes every scrubbing bug a
  search-result leak.

### One thing the view must not do

It must not expose `financial_documents.company_snapshot` or `records.company_snapshot`.
Those are scrubbed on write, but the search surface should not be the thing that discovers
a scrubbing gap.

---

## 6. Recommendation summary and sign-off items

**Two tables. `records` and `financial_documents` stay untouched. Add `files` + an
`uploads` bucket. Unify at read time with a plain `union all` view.**

| # | Question | Recommendation |
|---|---|---|
| D1 | One table or two? | **Two.** Chiefly because `app.bump_usage()` would otherwise bill users for uploading files, and because five NOT NULL lifecycle columns would have to become nullable |
| D2 | New `uploads` bucket, or widen `documents`? | **New bucket.** `documents` is `application/pdf`-only by design; widening its MIME allowlist to accept arbitrary user uploads is a security decision disguised as a convenience |
| D3 | `files` parent: loose `(parent_type, parent_id)` or N nullable FKs? | **Loose pair, reluctantly** — Phase 3 vendors/POs would each need a migration otherwise. Accepts dangling parents. **Flip to nullable FKs if you want the integrity guarantee more than the extensibility** |
| D4 | Are files metered by plan? | **Undecided — your call.** `planConfig.js` has no storage limit today. If yes, it needs a server-side check per `definition-of-done.md` §5, and `usage_counters` needs a `storage_bytes` column in `migration-order.md` |
| D5 | Search: view now, or full-text from the start? | **View now.** Add `tsvector` columns to the base tables only when a real row count justifies it |
| D6 | Should uploaded files ever be portal-shareable? | **No, in v1.** `portal_tokens`' `exactly_one_target` check stays a clean two-way union. Revisit only with a concrete requirement |
