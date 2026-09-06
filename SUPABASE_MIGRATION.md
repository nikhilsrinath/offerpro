# EdgeOS — Firebase → Supabase Migration

**Decision: migrate first, then run the remaining fix plan against Postgres.**

This document is the migration plan and the schema. The schema is the one-way door — review Part 2 before any code is written.

---

## Part 0 — Why this is tractable

Three facts from the codebase, verified:

**The data layer is already abstracted.** All Firebase access lives in **8 files**:

```
src/lib/firebase.js                     src/context/AuthContext.jsx
src/services/orgStore.js                src/context/OrgContext.jsx
src/services/documentStore.js           src/components/portal/RecipientPortal.jsx
src/services/dualWriteService.js        src/services/companyMemory.ts
```

The other ~100 components never import Firebase. They call `orgStore.getSection()`, `getSectionAsList()`, `addItem()`, `updateItem()`, `removeItem()`, `setSection()`, `listenSection()` — via `storageService` and `documentStore`. **Preserve that API contract and the component layer barely changes.**

**Firebase Storage is not in use.** `grep` for `firebase/storage`, `getStorage`, `uploadBytes`, `getDownloadURL` returns nothing. Logos, signatures and stamps are inline base64 data URLs (`imageUploadService.js:35`, `imageUtils.js:52`). There is no blob data to move — Supabase Storage is a fresh build, which also resolves fix-plan item 24.

**Realtime is 4 call sites,** all inside `orgStore.listenSection` (lines 436–477). They map one-to-one onto Supabase Realtime channels.

### What the migration absorbs from the fix plan

Moving to Postgres deletes work rather than adding it:

| Fix-plan item | Fate under Supabase |
|---|---|
| **4** — Firestore security rules (~2 wks) | Becomes RLS policies, written once as part of the schema |
| **17** — collapse three sources of truth (~1.5 wks) | **Is** the migration; there is only one database afterwards |
| **23** — collision-free IDs | Postgres sequences + an atomic `next_document_number()` function |
| **25** — notifications out of a single document | A real `notifications` table with per-user read state |
| **22** — validation layer | Half absorbed: `CHECK` constraints and FKs in the DB, zod still needed client-side |
| **26** — pagination | `LIMIT`/`OFFSET` and keyset pagination come free; UI work remains |
| **21** — field-level protection for salary/bank | Separate tables + RLS, which Postgres does natively |

**Net: ~6 weeks of Firebase-specific work is never done.**

---

## Part 1 — What has to move

| Firebase | Rows (est.) | Supabase target |
|---|---|---|
| `organizations/{orgId}` (~42 profile fields) | 1 per tenant | `organizations` + `org_banking` + `org_secrets` (split by sensitivity) |
| `memberships/{id}` | 1 per user-org | `memberships` with `UNIQUE(org_id, user_id)` |
| `users/{uid}.organizations` | 1 per user | **dropped** — `memberships` is the single source |
| `employees`, `ex_employees`, `departments`, `customers`, `expenses`, `records`, `fin_docs`, `products`, `crm_leads`, `tasks` | flat, `orgId`-tagged | 10 tables, `org_id uuid NOT NULL REFERENCES` |
| `org_metadata/{orgId}.fin_notifs` | array in one doc | `notifications` table |
| `org_metadata/{orgId}.fin_recurring` | array in one doc | `recurring_invoices` table |
| `org_metadata/{orgId}.hierarchy` | blob | `org_settings.hierarchy jsonb` (org-chart node positions — legitimately a blob) |
| RTDB mirror of all the above | — | **discarded** after reconciliation |
| `localStorage` cache | — | **discarded**; replaced by an explicit client cache |
| Firebase Auth (email/password, Google) | | Supabase Auth |
| Firebase Storage | **empty** | Supabase Storage (greenfield) |

### The one hard problem: password hashes

Google sign-in users migrate cleanly — same Google identity, Supabase just needs the OAuth client configured.

**Email/password users are the friction.** Firebase hashes with a modified scrypt using project-specific parameters. Supabase can accept those hashes, but you must export the parameters from the Firebase console **before decommissioning the project**:

```
firebase auth:export users.json --format=json --project offerpro-892b9
```

This emits `passwordHash`, `salt`, and the project's `signerKey`, `saltSeparator`, `rounds`, `memCost`. Capture all of it. If any is missing or the import misbehaves, the fallback is a forced password reset for email/password users — acceptable, but it must be a decision, not a surprise on cutover day.

**Do this export in week 1, before touching anything else.**

---

## Part 2 — The schema

Review this section before implementation begins. Changing it after data lands is expensive.

### Extensions and enums

```sql
create extension if not exists "pgcrypto";
create extension if not exists "citext";

create type member_role      as enum ('owner','admin','member','viewer');
create type doc_type         as enum ('offer','certificate','nda','mou','invoice','quotation','proforma');
create type doc_status       as enum ('draft','sent','viewed','accepted','declined','paid','partial','overdue','cancelled');
create type employment_type  as enum ('fulltime','intern','contract','parttime');
create type plan_tier        as enum ('free','pro','max');
```

### Core tenancy

```sql
create table organizations (
  id                  uuid primary key default gen_random_uuid(),
  company_name        text not null check (length(company_name) between 1 and 200),
  company_tagline     text check (length(company_tagline) <= 300),
  company_email       citext,
  company_phone       text,
  company_website     text,
  company_address     text,
  company_description text,
  owner_uid           uuid not null references auth.users(id) on delete restrict,
  owner_full_name     text,
  owner_role          text,
  document_designation text,
  logo_url            text,          -- Supabase Storage URL, never base64
  signature_url       text,
  stamp_type          text,
  stamp_url           text,
  stamp_city          text,
  industry            text,
  country             text,
  city                text,
  company_size        text,
  primary_contact_name text,
  use_cases           text[],
  include_logo        boolean not null default true,
  account_usage       text,
  referral_source     text,
  deleted_at          timestamptz,   -- soft delete (fix-plan 6, 9)
  deleted_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on organizations (owner_uid);
create index on organizations (deleted_at) where deleted_at is null;
```

**Sensitive columns are split out** — Postgres RLS is row-level, so separating by sensitivity is how field-level protection is achieved (fix-plan item 21):

```sql
-- Owner/admin only.
create table org_banking (
  org_id              uuid primary key references organizations(id) on delete cascade,
  gstin               text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'),
  cin                 text,
  upi_id              text,
  bank_name           text,
  bank_account_number text,
  bank_ifsc           text check (bank_ifsc is null or bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_account_type   text,
  updated_at          timestamptz not null default now()
);

-- NO client access at any role. service_role only. RLS denies everything.
create table org_secrets (
  org_id            uuid primary key references organizations(id) on delete cascade,
  gmail_user        citext,
  gmail_cipher      bytea,   -- AES-256-GCM ciphertext
  gmail_iv          bytea,
  gmail_tag         bytea,
  updated_at        timestamptz not null default now()
);
```

> This kills the audit's C-5: `gmail_app_password` can no longer reach the browser, RTDB or `localStorage`, because no client role can read the table at all.

```sql
create table memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       member_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index on memberships (user_id);
```

> The `UNIQUE(org_id, user_id)` constraint is what the Firestore plan needed a `{uid}_{orgId}` composite-ID migration to fake. Here it is a one-line constraint.

```sql
create table org_settings (
  org_id     uuid primary key references organizations(id) on delete cascade,
  hierarchy  jsonb not null default '{}'::jsonb,   -- org-chart node positions + edges
  updated_at timestamptz not null default now()
);

create table subscriptions (               -- fix-plan 35; server-write only
  org_id             uuid primary key references organizations(id) on delete cascade,
  plan               plan_tier not null default 'free',
  provider           text,
  provider_sub_id    text unique,
  status             text not null default 'active',
  current_period_end timestamptz,
  cancel_at          timestamptz,
  updated_at         timestamptz not null default now()
);

create table usage_counters (              -- replaces the O(n) count in usePlanStatus
  org_id         uuid primary key references organizations(id) on delete cascade,
  offer_letters  integer not null default 0 check (offer_letters >= 0),
  mou            integer not null default 0 check (mou >= 0),
  nda            integer not null default 0 check (nda >= 0),
  invoices       integer not null default 0 check (invoices >= 0),
  quotations     integer not null default 0 check (quotations >= 0),
  updated_at     timestamptz not null default now()
);
```

### Tenant data

```sql
create table departments (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table employees (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  name           text not null,           -- RTDB called this studentName; normalize on import
  email          citext,
  phone          text,
  role           text,
  department_id  uuid references departments(id) on delete set null,
  offer_type     employment_type,
  is_owner       boolean not null default false,
  reports_to     uuid references employees(id) on delete set null,
  joined_at      date,
  exited_at      date,                    -- non-null == ex-employee; replaces ex_employees
  exit_reason    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on employees (org_id) where exited_at is null;
create index on employees (org_id, department_id);

-- Owner/admin only. Salary must not be readable by every member.
create table employee_compensation (
  employee_id  uuid primary key references employees(id) on delete cascade,
  org_id       uuid not null references organizations(id) on delete cascade,
  amount       numeric(14,2) check (amount >= 0),
  currency     text not null default 'INR',
  period       text not null default 'annual',
  updated_at   timestamptz not null default now()
);

create table customers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  email       citext,
  phone       text,
  company     text,
  address     text,
  gstin       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on customers (org_id);

create table financial_documents (         -- was fin_docs
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  doc_number      text not null,           -- human-readable, from next_document_number()
  type            doc_type not null,
  status          doc_status not null default 'draft',
  customer_id     uuid references customers(id) on delete set null,
  issue_date      date not null default current_date,
  due_date        date,
  currency        text not null default 'INR',
  subtotal        numeric(14,2) not null default 0 check (subtotal >= 0),
  discount_type   text,
  discount_value  numeric(14,2) not null default 0 check (discount_value >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  taxable_amount  numeric(14,2) not null default 0 check (taxable_amount >= 0),
  gst_rate        numeric(5,2)  not null default 18 check (gst_rate between 0 and 100),
  gst_amount      numeric(14,2) not null default 0 check (gst_amount >= 0),
  grand_total     numeric(14,2) not null default 0 check (grand_total >= 0),
  payload         jsonb not null default '{}'::jsonb,   -- line items, notes, terms
  signed_at       timestamptz,
  signed_by_name  text,
  signed_ip       inet,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, doc_number)
);
create index on financial_documents (org_id, type, created_at desc);
create index on financial_documents (org_id, status);
```

> **`numeric(14,2)`, not float.** The audit flagged untested GST arithmetic; Firestore had no numeric type to enforce. Postgres does, and the `CHECK` constraints reject the negative quantities and `NaN` that item 22 had to catch in application code.

```sql
create table records (                     -- HR documents: offer, certificate, nda, mou
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  doc_number  text not null,
  type        doc_type not null,
  title       text not null,
  data        jsonb not null default '{}'::jsonb,
  pdf_path    text,                        -- Supabase Storage object path
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (org_id, doc_number)
);
create index on records (org_id, type, created_at desc);

create table expenses (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  description text not null,
  amount      numeric(14,2) not null check (amount >= 0),
  category    text,
  incurred_on date not null default current_date,
  created_at  timestamptz not null default now()
);
create index on expenses (org_id, incurred_on desc);

create table products (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  description text,
  status      text,
  created_at  timestamptz not null default now()
);

create table crm_leads (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  company     text,
  email       citext,
  phone       text,
  stage       text not null default 'new',
  value       numeric(14,2) check (value >= 0),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on crm_leads (org_id, stage, position);

create table tasks (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  title        text not null,
  description  text,
  status       text not null default 'todo',
  assignee_id  uuid references employees(id) on delete set null,
  due_at       timestamptz,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on tasks (org_id, status, position);

create table recurring_invoices (          -- was the fin_recurring array
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  customer_id   uuid references customers(id) on delete set null,
  frequency     text not null,
  next_run_on   date not null,
  active        boolean not null default true,
  template      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index on recurring_invoices (org_id, next_run_on) where active;
```

### Notifications — per-user read state

```sql
create table notifications (               -- was an unbounded array in one document
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  type        text not null,
  title       text not null,
  message     text,
  document_id uuid,
  created_at  timestamptz not null default now()
);
create index on notifications (org_id, created_at desc);

create table notification_reads (          -- fixes org-global read state
  notification_id uuid not null references notifications(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);
```

### Portal, invitations, audit

```sql
create table portal_tokens (               -- fix-plan 5
  jti          uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  document_id  uuid not null,
  doc_kind     text not null check (doc_kind in ('financial','record')),
  scope        text not null check (scope in ('view','sign')),
  recipient_email citext,
  issued_by    uuid references auth.users(id),
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  used_at      timestamptz
);
create index on portal_tokens (document_id) where revoked_at is null;

create table invitations (                 -- fix-plan 21
  token       uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  email       citext not null,
  role        member_role not null default 'member',
  invited_by  uuid references auth.users(id),
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (org_id, email)
);

create table audit_log (                   -- fix-plan 37; append-only
  id          bigserial primary key,
  org_id      uuid references organizations(id) on delete set null,
  actor_id    uuid references auth.users(id),
  action      text not null,
  entity_type text,
  entity_id   uuid,
  diff        jsonb,
  ip          inet,
  created_at  timestamptz not null default now()
);
create index on audit_log (org_id, created_at desc);
```

### Atomic document numbering — replaces `nextId`

The audit's M-2: `matching.length + 1` duplicates IDs after a delete and races under concurrency. Postgres solves it properly:

```sql
create table document_counters (
  org_id   uuid not null references organizations(id) on delete cascade,
  type     doc_type not null,
  year     integer not null,
  last_num integer not null default 0,
  primary key (org_id, type, year)
);

create or replace function next_document_number(p_org uuid, p_type doc_type, p_date date)
returns text language plpgsql security definer set search_path = public as $$
declare v_year integer := extract(year from p_date)::int;
        v_num  integer;
        v_pfx  text;
begin
  insert into document_counters (org_id, type, year, last_num)
  values (p_org, p_type, v_year, 1)
  on conflict (org_id, type, year)
  do update set last_num = document_counters.last_num + 1
  returning last_num into v_num;

  v_pfx := case p_type
    when 'invoice' then 'INV' when 'quotation' then 'QUO' when 'proforma' then 'PI'
    when 'offer' then 'OL'    when 'certificate' then 'CRT'
    when 'nda' then 'NDA'     when 'mou' then 'MOU' end;

  return v_pfx || '-' || v_year || '-' || lpad(v_num::text, 4, '0');
end $$;
```

Gap-free, unique under concurrency, and the year comes from the document date rather than the hardcoded `2026`.

### Row Level Security

```sql
create or replace function is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where org_id = p_org and user_id = auth.uid()
  );
$$;

create or replace function member_role(p_org uuid)
returns member_role language sql stable security definer set search_path = public as $$
  select role from memberships where org_id = p_org and user_id = auth.uid();
$$;

create or replace function is_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select member_role(p_org) in ('owner','admin');
$$;
```

Enable RLS on **every** table, then:

```sql
-- Pattern applied to all 10 tenant tables:
alter table employees enable row level security;

create policy employees_select on employees for select
  using (is_member(org_id));

create policy employees_insert on employees for insert
  with check (is_member(org_id) and member_role(org_id) <> 'viewer');

create policy employees_update on employees for update
  using (is_member(org_id) and member_role(org_id) <> 'viewer')
  with check (org_id = (select org_id from employees where id = employees.id));  -- org_id is immutable

create policy employees_delete on employees for delete
  using (is_admin(org_id));

-- Sensitive splits: admin only
alter table org_banking enable row level security;
create policy org_banking_rw on org_banking for all
  using (is_admin(org_id)) with check (is_admin(org_id));

alter table employee_compensation enable row level security;
create policy comp_rw on employee_compensation for all
  using (is_admin(org_id)) with check (is_admin(org_id));

-- Secrets: no client access at all. service_role bypasses RLS.
alter table org_secrets enable row level security;
-- (deliberately no policy — every client role is denied)

-- Server-authoritative billing: read-only to members
alter table subscriptions enable row level security;
create policy subs_select on subscriptions for select using (is_member(org_id));
-- (no insert/update/delete policy — only service_role writes)

-- Audit log: readable by admins, never writable by clients
alter table audit_log enable row level security;
create policy audit_select on audit_log for select using (is_admin(org_id));
```

> **Verify `subscriptions` has no write policy.** That single omission is what makes `plan: 'max'` unwritable from the browser — the audit's C-7.

### Storage buckets

```sql
insert into storage.buckets (id, name, public) values
  ('org-branding', 'org-branding', true),   -- logos, stamps: public read, member write
  ('signatures',   'signatures',   false),  -- private
  ('documents',    'documents',    false);  -- generated PDFs, private
```

Objects are pathed `{org_id}/...` and policed by a storage policy checking `is_member((storage.foldername(name))[1]::uuid)`.

---

## Part 3 — Execution

### M0 · Preparation (week 1) — do this before anything else

- [ ] **`firebase auth:export users.json --project offerpro-892b9`** — capture `passwordHash`, `salt`, `signerKey`, `saltSeparator`, `rounds`, `memCost`. Without this, every email/password user needs a reset.
- [ ] Full Firestore + RTDB export to JSON. This is the migration source **and** the backup the audit says does not exist (fix-plan item 9's export half).
- [ ] Create the Supabase project; record URL, anon key, service-role key. **Service-role key never enters client code or any `VITE_` variable.**
- [ ] Configure Google OAuth in Supabase with the same client so Google users carry over.
- [ ] **Fix-plan items 1, 2, 3** — the crash, gitignore, `/admin` offline. One day, unrelated to the migration.

### M1 · Schema (week 1–2)

- [ ] `supabase/migrations/0001_init.sql` — Part 2 verbatim, reviewed and signed off.
- [ ] `supabase/migrations/0002_rls.sql` — all policies.
- [ ] `supabase/migrations/0003_functions.sql` — `next_document_number`, `is_member`, `member_role`, `is_admin`, `updated_at` triggers.
- [ ] **pgTAP tests proving isolation** — org A cannot read org B; `viewer` cannot write; `member` cannot read `employee_compensation` or `org_banking`; no client role reads `org_secrets`; no client role writes `subscriptions`. These are the tests the Firebase plan wanted and they are cheaper here.

### M2 · ETL (week 2–3)

- [ ] `scripts/migrate/01-extract.js` — pull Firestore + RTDB into normalized JSON.
- [ ] `scripts/migrate/02-transform.js` — reconcile the three sources; map push IDs → UUIDs keeping a `legacy_id` lookup table; normalize `studentName` → `name`; **collapse `ex_employees` into `employees.exited_at`**; explode `fin_notifs` and `fin_recurring` arrays into rows; split profile fields into `organizations` / `org_banking` / `org_secrets`; extract base64 images to files for M3.
- [ ] `scripts/migrate/03-load.js` — insert via service role in FK order, idempotent, resumable.
- [ ] `scripts/migrate/04-verify.js` — **row counts per table per org, and a financial-totals checksum**. A migration that loses one invoice is a failed migration.
- [ ] Import `users.json` into Supabase Auth with the scrypt parameters; verify a real login for both an email/password and a Google account.

### M3 · Storage (week 3)

- [ ] Upload the extracted base64 images to `org-branding` / `signatures`; rewrite `logo_url`, `signature_url`, `stamp_url` to Storage URLs.
- [ ] Rewrite `imageUploadService.js` and `imageUtils.js` to upload binary rather than produce data URLs; add MIME + 2 MB validation.
- [ ] Keep `ensureBase64` fetching from URL at PDF-generation time so jsPDF still works.

### M4 · Application layer (week 3–5) — the 8 files

- [ ] `src/lib/supabase.js` replaces `src/lib/firebase.js`.
- [ ] **`orgStore.js` rewritten against Supabase, preserving its public API** (`getSection`, `getSectionAsList`, `getItem`, `addItem`, `setItem`, `updateItem`, `removeItem`, `setSection`, `listenSection`, `getProfile`, `updateProfile`). Take fix-plan item 18 here at no extra cost: make it `createOrgStore(orgId)` returning an instance, killing the module globals. **`listenSection` becomes a Supabase Realtime channel.**
- [ ] `AuthContext.jsx` → Supabase Auth (`signInWithPassword`, `signUp`, `signInWithOAuth`, `updateUser`). **Fix the dead onboarding gate while here** (fix-plan 16) — capture the `userHasOrganization` result instead of discarding it.
- [ ] `OrgContext.jsx` → one `memberships` join instead of three fallback round-trips; drop `ensureLocalOrg`'s phantom workspace.
- [ ] **Delete `dualWriteService.js` entirely** — there is no second store to write to.
- [ ] `documentStore.js` / `storageService.js` → thin wrappers over the new store; **fix the `doc` shadowing crash** by deletion.
- [ ] `RecipientPortal.jsx` → server endpoints with signed tokens (fix-plan 5); **remove `signInAnonymously`**.
- [ ] `companyMemory.ts` — swap `orgStore.getCache()` for the new store. *(AI behaviour unchanged, per scope.)*
- [ ] `api/email.js` → verify Supabase JWT, read credentials from `org_secrets` via service role (fix-plan 7).
- [ ] `admin/index.html` → Supabase Auth + an `admin` claim in `app_metadata` (fix-plan 6).

### M5 · Cutover (week 5–6)

- [ ] Dry run against a production snapshot in staging; run `04-verify` and review the checksum report.
- [ ] Announce a maintenance window.
- [ ] Freeze writes → final delta ETL → verify → flip → smoke test all seven document types, both auth paths, and the portal.
- [ ] Keep Firebase **read-only, not deleted**, for 30 days as the rollback path.
- [ ] Configure Supabase PITR + daily backups (completes fix-plan 9).

---

## Part 4 — The plan afterwards

`FIX_PLAN.md`'s 48 items become **~35**, because the migration absorbs 4, 17, 23, 25, and parts of 18, 21, 22, 24, 26.

Everything below is unaffected by the database choice and carries over unchanged:

**Do during the migration** (they make it safer, and are DB-agnostic):
`10` DB-agnostic tests — GST arithmetic, `planConfig`, PDF snapshots · `11` 86 lint errors, incl. the sparse arrays in NDA/MoU content · `12` split `pdfService` · `14` error boundaries + Sentry

**After cutover, in order:**
`13` dependency CVEs · `19` org switcher · `20` TypeScript + domain types · `21` RBAC app layer + invitations · `22` zod client-side · `24` Storage polish · `26` pagination UI · `27` marketing/app split · `28` code-splitting · `29` CSS tokens · `30` SEO · `31` pinch-zoom · `32` Realtime subscriptions · `33` accessibility · `34` offline · `35` payments · `36` security headers · `37` audit-log wiring · `38` bulk durability · `39` rate limiting · `40` dev parity · `41–48` docs

**Still excluded per your instruction:** the committed `.env` / NVIDIA key, and `/api/nvidia`.

---

## Timeline

| Milestone | Weeks | Gate |
|---|---|---|
| M0 Preparation | 1 | Auth export captured; Supabase project live |
| M1 Schema | 1–2 | pgTAP isolation tests green |
| M2 ETL | 2–3 | Row counts and financial checksums match |
| M3 Storage | 3 | PDFs render with logos and signatures |
| M4 Application | 3–5 | Full click-through of all 30+ routes |
| M5 Cutover | 5–6 | Live on Supabase; Firebase read-only for 30 days |

**~6 weeks to cutover**, then ~7 weeks of the remaining plan — versus 14 weeks of Firebase work with 6 of them thrown away.

---

## What I need to start

1. **Sign-off on the Part 2 schema** — specifically: collapsing `ex_employees` into `employees.exited_at`, splitting banking and secrets into their own tables, and `jsonb` for document line items.
2. **Firebase auth export**, run before anything else (Part 3, M0).
3. **Supabase project** — URL, anon key, service-role key.
4. Confirmation on the **password-hash fallback**: import Firebase scrypt hashes, or force a reset for email/password users?

I can write the schema migrations, RLS policies, ETL scripts and the rewritten data layer without any of these — only running them needs the credentials.
