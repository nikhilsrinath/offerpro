-- ============================================================================
-- EdgeOS · 0001_init.sql
-- Extensions, enumerated types, and every table.
--
-- Derived from the live Firebase shapes, not from guesswork. Source of each
-- mapping is noted inline as:  << firebase.path (file:line)
--
-- Naming: everything is snake_case. The Firebase data mixes conventions
-- (customers use created_at, tasks use createdAt, employees use studentName);
-- 02-transform.js normalizes on the way in.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive email

-- ─────────────────────────────────────────────────────────────────────────────
-- Types
-- ─────────────────────────────────────────────────────────────────────────────

create type member_role as enum ('owner', 'admin', 'member', 'viewer');

-- << orgStore KEYED_SECTIONS + documentStore.nextId prefixes
create type doc_type as enum (
  'offer', 'certificate', 'nda', 'mou',        -- records  (HR)
  'invoice', 'quotation', 'proforma'           -- financial_documents
);

-- << documentStore.updateStatus + RecipientPortal + OfferTracker
create type doc_status as enum (
  'draft', 'sent', 'viewed', 'accepted', 'declined',
  'paid', 'partially_paid', 'overdue', 'cancelled', 'expired'
);

-- << EmployeeForm.jsx:34  offerType
create type employment_type as enum ('fulltime', 'intern', 'contract', 'parttime');

-- << taskStore.ts:13-14
create type task_status   as enum ('pending', 'in_progress', 'done', 'overdue');
create type task_priority as enum ('low', 'medium', 'high');

-- << planConfig.js PLANS
create type plan_tier as enum ('free', 'pro', 'max');

create type discount_kind as enum ('percent', 'flat');

-- ═════════════════════════════════════════════════════════════════════════════
-- CORE TENANCY
-- ═════════════════════════════════════════════════════════════════════════════

-- << organizations/{orgId}, minus banking and secrets which are split out below.
--    Firebase kept all 42 PROFILE_FIELDS (orgStore.js:26-37) in one document,
--    which is why a member could read the Gmail App Password. Postgres RLS is
--    row-level, so splitting by sensitivity is how field-level access is done.
create table organizations (
  id                   uuid primary key default gen_random_uuid(),
  company_name         text not null check (length(btrim(company_name)) between 1 and 200),
  company_tagline      text check (length(company_tagline) <= 300),
  company_email        citext,
  company_phone        text,
  company_website      text,
  company_address      text,
  company_description  text,

  owner_uid            uuid not null references auth.users(id) on delete restrict,
  owner_full_name      text,
  owner_role           text,
  document_designation text,          -- signatory title printed on documents
  primary_contact_name text,

  -- Storage object paths. Firebase stored base64 data URLs inline
  -- (imageUploadService.js:35); 03-load.js uploads them and writes paths here.
  logo_path            text,
  signature_path       text,
  stamp_path           text,
  stamp_type           text,
  stamp_city           text,
  include_logo         boolean not null default true,

  industry             text,
  country              text,
  city                 text,
  company_size         text,
  use_cases            text[]         not null default '{}',
  account_usage        text,
  referral_source      text,

  deleted_at           timestamptz,   -- soft delete; admin hard-delete is gone
  deleted_by           uuid references auth.users(id),

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table organizations is 'Tenant root. Banking and secrets deliberately live in separate tables.';
create index organizations_owner_idx  on organizations (owner_uid);
create index organizations_active_idx on organizations (id) where deleted_at is null;

-- << the gstin/cin/upi/bank_* subset of PROFILE_FIELDS.
--    RLS: owner/admin only.
create table org_banking (
  org_id              uuid primary key references organizations(id) on delete cascade,
  gstin               text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$'),
  cin                 text,
  upi_id              text,
  bank_name           text,
  bank_account_number text,
  bank_ifsc           text check (bank_ifsc is null or bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_account_type   text,
  updated_at          timestamptz not null default now()
);

-- << gmail_user / gmail_app_password (orgStore.js:36), previously PLAINTEXT in
--    Firestore, RTDB and localStorage, and additionally copied into every
--    document's company_profile snapshot.
--    RLS is ENABLED with NO POLICY: no client role can read this at all.
--    Only the service role (which bypasses RLS) touches it, from api/email.
create table org_secrets (
  org_id       uuid primary key references organizations(id) on delete cascade,
  gmail_user   citext,
  gmail_cipher bytea,     -- AES-256-GCM
  gmail_iv     bytea,
  gmail_tag    bytea,
  rotated_at   timestamptz,
  updated_at   timestamptz not null default now(),
  constraint gmail_cipher_complete check (
    (gmail_cipher is null and gmail_iv is null and gmail_tag is null)
    or (gmail_cipher is not null and gmail_iv is not null and gmail_tag is not null)
  )
);
comment on table org_secrets is 'Server-only. RLS enabled with no policy: every client role is denied.';

-- << memberships/{pushId} {organization_id, user_id, role}
--    The UNIQUE constraint is what the Firestore plan needed a {uid}_{orgId}
--    composite-ID migration to emulate.
create table memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id)   on delete cascade,
  role       member_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index memberships_user_idx on memberships (user_id);

-- << org_metadata/{orgId}.hierarchy  (TeamHierarchy.jsx:631)
--    Shape: { nodes: {id:{id,position}}, edges: {id:{id,source,target}} }
--    Node ids are employee ids. Reporting lines are ALSO denormalized onto
--    employees.reports_to; this table holds canvas geometry only.
create table org_settings (
  org_id     uuid primary key references organizations(id) on delete cascade,
  hierarchy  jsonb not null default '{"nodes":{},"edges":{}}'::jsonb,
  updated_at timestamptz not null default now()
);

-- << organizations/{orgId}.plan | is_premium  (previously client-writable —
--    orgStore.updateProfile() wrote it straight from the browser).
--    RLS grants SELECT to members and NO write policy to anyone.
create table subscriptions (
  org_id             uuid primary key references organizations(id) on delete cascade,
  plan               plan_tier not null default 'free',
  status             text not null default 'active'
                       check (status in ('active','past_due','cancelled','paused','trialing')),
  provider           text,
  provider_sub_id    text unique,
  current_period_end timestamptz,
  cancel_at          timestamptz,
  updated_at         timestamptz not null default now()
);

-- Replaces the O(n) count-everything loop in usePlanStatus.js:52-62.
-- Maintained by triggers in 0002; never written by the client.
create table usage_counters (
  org_id        uuid primary key references organizations(id) on delete cascade,
  offer_letters integer not null default 0 check (offer_letters >= 0),
  certificates  integer not null default 0 check (certificates  >= 0),
  nda           integer not null default 0 check (nda           >= 0),
  mou           integer not null default 0 check (mou           >= 0),
  invoices      integer not null default 0 check (invoices      >= 0),
  quotations    integer not null default 0 check (quotations    >= 0),
  proformas     integer not null default 0 check (proformas     >= 0),
  updated_at    timestamptz not null default now()
);

-- ═════════════════════════════════════════════════════════════════════════════
-- TEAM
-- ═════════════════════════════════════════════════════════════════════════════

-- << organizations/{orgId}/departments  (storageService.js:82-103)
create table departments (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

-- << organizations/{orgId}/employees  +  .../ex_employees
--
--    Firebase kept two collections: an employee was DELETED from `employees`
--    and re-inserted into `ex_employees` under the same key
--    (Employees.jsx:725-730). That loses referential integrity — tasks and
--    documents still point at the id. Here it is one table with exited_at.
--
--    NOTE: employees.department in Firebase is a department NAME string, not a
--    reference (EmployeeForm.jsx:40). 02-transform.js resolves it to
--    department_id, creating any department it does not find.
create table employees (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,

  -- RTDB called this studentName, Firestore mirrored it as name
  -- (dualWriteService.js:58-79). Normalized here.
  full_name         text not null check (length(btrim(full_name)) > 0),
  email             citext,
  phone             text,
  address           text,

  role              text,
  department_id     uuid references departments(id) on delete set null,
  employment_type   employment_type not null default 'fulltime',
  reports_to        uuid references employees(id) on delete set null,
  supervisor_name   text,               -- free text kept where reports_to is unresolved
  responsibilities  text,

  is_owner          boolean not null default false,
  start_date        date,
  end_date          date,
  acceptance_deadline date,

  exited_at         timestamptz,        -- non-null ⇒ ex-employee
  exit_reason       text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint employees_no_self_report check (reports_to is null or reports_to <> id),
  constraint employees_dates_ordered  check (end_date is null or start_date is null or end_date >= start_date)
);
create index employees_org_active_idx on employees (org_id) where exited_at is null;
create index employees_org_exited_idx on employees (org_id, exited_at desc) where exited_at is not null;
create index employees_dept_idx       on employees (org_id, department_id);
create index employees_reports_to_idx on employees (reports_to);
-- One owner row per org.
create unique index employees_single_owner_idx on employees (org_id) where is_owner;

-- << employees.stipend | salary | currency | paymentFrequency | isPaid
--    (EmployeeForm.jsx:46-49). Split out so `member` and `viewer` roles cannot
--    read compensation — Postgres RLS cannot secure individual columns.
create table employee_compensation (
  employee_id       uuid primary key references employees(id) on delete cascade,
  org_id            uuid not null references organizations(id) on delete cascade,
  is_paid           boolean not null default true,
  amount            numeric(14,2) check (amount is null or amount >= 0),
  currency          char(3) not null default 'INR',
  payment_frequency text not null default 'Monthly',
  updated_at        timestamptz not null default now()
);
create index employee_compensation_org_idx on employee_compensation (org_id);

-- << organizations/{orgId}/tasks  (taskStore.ts:3-20)
--    Firebase denormalized assignedName/Email/Phone/Role/Dept onto every task;
--    those are dropped in favour of the employees FK. 02-transform keeps the
--    denormalized name only when the assignee cannot be resolved.
create table tasks (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  title            text not null check (length(btrim(title)) > 0),
  description      text,
  status           task_status   not null default 'pending',
  priority         task_priority not null default 'medium',
  assignee_id      uuid references employees(id) on delete set null,
  assignee_label   text,                -- fallback when assignee_id is unresolved
  deadline         date,
  notes            text,
  follow_up_sent_at timestamptz,
  position         integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index tasks_org_status_idx on tasks (org_id, status, position);
create index tasks_assignee_idx   on tasks (assignee_id) where assignee_id is not null;
create index tasks_deadline_idx   on tasks (org_id, deadline) where status <> 'done';

-- ═════════════════════════════════════════════════════════════════════════════
-- BUSINESS
-- ═════════════════════════════════════════════════════════════════════════════

-- << organizations/{orgId}/customers  (customerService.js)
--    Firebase field names were clientName / clientEmail / clientAddress /
--    buyerGSTIN / buyerState / contactPhone. Renamed here; the ETL maps them.
create table customers (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  email        citext,
  phone        text,
  address      text,
  gstin        text,
  state        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index customers_org_idx on customers (org_id);
-- customerService.deduplicate() matched case-insensitively on name; enforce it.
create unique index customers_org_name_idx on customers (org_id, lower(btrim(name)));

-- << organizations/{orgId}/crm_leads  (CRM.jsx:101-106)
create table crm_leads (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  company_name text,
  person_name  text,
  email        citext,
  phone        text,
  stage        text not null default 'lead',
  value        numeric(14,2) check (value is null or value >= 0),
  notes        text,
  position     integer not null default 0,
  extra        jsonb not null default '{}'::jsonb,   -- unmapped formData keys
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint crm_leads_named check (
    coalesce(btrim(company_name), '') <> '' or coalesce(btrim(person_name), '') <> ''
  )
);
create index crm_leads_org_stage_idx on crm_leads (org_id, stage, position);

-- << organizations/{orgId}/products  (ProductPlanner.jsx:56)
create table products (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null check (length(btrim(name)) > 0),
  description text,
  status      text not null default 'planned',
  priority    text not null default 'medium',
  due_date    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index products_org_idx on products (org_id, status);

-- << organizations/{orgId}/expenses  (BillingRevenue.jsx:121)
create table expenses (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  description text not null check (length(btrim(description)) > 0),
  amount      numeric(14,2) not null check (amount >= 0),
  category    text not null default 'Operations',
  incurred_on date not null default current_date,
  created_at  timestamptz not null default now()
);
create index expenses_org_date_idx on expenses (org_id, incurred_on desc);

-- ═════════════════════════════════════════════════════════════════════════════
-- DOCUMENTS  (HR: offer / certificate / nda / mou)
-- ═════════════════════════════════════════════════════════════════════════════

-- << organizations/{orgId}/records  (storageService.js:36) and the legacy RTDB
--    path organizations/{orgId}/hr_records (admin/index.html:590).
--    Firebase shape: { id, type, title, data:{...whole form...}, user_id, created_at }
--
--    `data` stays jsonb: it is a point-in-time snapshot of a legal document and
--    its shape differs per type. But the fields the app QUERIES on are promoted
--    to real columns so they can be indexed and constrained.
create table records (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  doc_number      text not null,                 -- OL-2026-0001 etc.
  type            doc_type not null,
  status          doc_status not null default 'draft',
  title           text not null,

  employee_id     uuid references employees(id) on delete set null,
  recipient_name  text,
  recipient_email citext,

  issue_date      date not null default current_date,
  data            jsonb not null default '{}'::jsonb,

  -- Immutable snapshot of issuer identity at issue time.
  -- SCRUBBED: 02-transform strips gmail_app_password / bank_* / gstin from the
  -- Firebase company_profile blob before it lands here.
  company_snapshot jsonb not null default '{}'::jsonb,

  pdf_path        text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint records_type_is_hr check (type in ('offer','certificate','nda','mou')),
  unique (org_id, doc_number)
);
create index records_org_type_idx on records (org_id, type, created_at desc);
create index records_employee_idx on records (employee_id) where employee_id is not null;

-- ═════════════════════════════════════════════════════════════════════════════
-- FINANCE
-- ═════════════════════════════════════════════════════════════════════════════

-- << organizations/{orgId}/fin_docs  AND the Firestore flat collection
--    `fin_docs`  AND the Firestore subcollection
--    organizations/{orgId}/fin_docs (admin/index.html:595) — the ETL reads all
--    three and reconciles.
--
--    Firebase used the human document number as the primary key
--    (InvoiceForm.jsx:211 `id: formData.invoiceNumber`), generated by
--    documentStore.nextId() as `matching.length + 1` — which duplicates after a
--    delete and races under concurrency. Here the key is a uuid and doc_number
--    is a separate unique-per-org column produced by next_document_number().
--
--    Money is numeric(14,2). Firestore had no numeric type, which is a large
--    part of why the GST arithmetic was never verifiable.
create table financial_documents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  doc_number       text not null,
  type             doc_type not null,
  status           doc_status not null default 'draft',
  revision         text not null default 'v1',

  customer_id      uuid references customers(id) on delete set null,
  -- Buyer identity frozen at issue time; a later customer edit must not
  -- retroactively alter an issued invoice.
  bill_to_name     text not null,
  bill_to_email    citext,
  bill_to_address  text,
  bill_to_gstin    text,
  bill_to_state    text,

  issue_date       date not null default current_date,
  due_date         date,
  valid_until      date,                          -- quotations

  currency         char(3) not null default 'INR',
  subtotal         numeric(14,2) not null default 0 check (subtotal >= 0),
  discount_type    discount_kind,
  discount_value   numeric(14,2) not null default 0 check (discount_value >= 0),
  discount_amount  numeric(14,2) not null default 0 check (discount_amount >= 0),
  taxable_amount   numeric(14,2) not null default 0 check (taxable_amount >= 0),
  gst_enabled      boolean not null default true,
  gst_rate         numeric(5,2)  not null default 18 check (gst_rate between 0 and 100),
  gst_amount       numeric(14,2) not null default 0 check (gst_amount >= 0),
  is_inter_state   boolean not null default false, -- IGST vs CGST+SGST
  making_charges   numeric(14,2) not null default 0 check (making_charges >= 0),
  grand_total      numeric(14,2) not null default 0 check (grand_total >= 0),
  amount_in_words  text,
  amount_paid      numeric(14,2) not null default 0 check (amount_paid >= 0),

  -- proforma advance tracking (ProformaInvoiceForm.jsx:56-58)
  advance_percent  numeric(5,2) check (advance_percent is null or advance_percent between 0 and 100),

  payment_instructions text,
  terms                text,
  notes                text,

  company_snapshot jsonb not null default '{}'::jsonb,  -- scrubbed, see records
  payload          jsonb not null default '{}'::jsonb,  -- anything unmapped

  pdf_path         text,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint fin_docs_type_is_financial check (type in ('invoice','quotation','proforma')),
  constraint fin_docs_paid_lte_total     check (amount_paid <= grand_total + 0.01),
  constraint fin_docs_discount_sane      check (discount_amount <= subtotal + 0.01),
  unique (org_id, doc_number)
);
create index fin_docs_org_type_idx  on financial_documents (org_id, type, created_at desc);
create index fin_docs_org_status_idx on financial_documents (org_id, status);
create index fin_docs_customer_idx  on financial_documents (customer_id) where customer_id is not null;
create index fin_docs_due_idx       on financial_documents (org_id, due_date)
  where status in ('sent','viewed','partially_paid','overdue');

-- << the `items` array inside each fin_doc (QuotationForm.jsx:283-289).
--    Normalized out of jsonb so totals are checkable in SQL and 04-verify can
--    prove the migration preserved every rupee.
create table document_line_items (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references financial_documents(id) on delete cascade,
  org_id       uuid not null references organizations(id) on delete cascade,
  position     integer not null default 0,
  description  text not null default '',
  hsn_sac      text,
  quantity     numeric(14,3) not null default 1 check (quantity >= 0),
  unit         text not null default 'Nos',
  rate         numeric(14,2) not null default 0 check (rate >= 0),
  gst_rate     numeric(5,2)  check (gst_rate is null or gst_rate between 0 and 100),
  line_total   numeric(14,2) not null default 0 check (line_total >= 0),
  unique (document_id, position)
);
create index line_items_doc_idx on document_line_items (document_id);
create index line_items_org_idx on document_line_items (org_id);

-- << PaymentConfirmationForm.jsx + the 'payment_submitted' notification type.
--    Firebase recorded payments as loose fields on the doc; a table gives an
--    auditable history and lets amount_paid be derived rather than asserted.
create table payments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  document_id   uuid not null references financial_documents(id) on delete cascade,
  amount        numeric(14,2) not null check (amount > 0),
  paid_on       date not null default current_date,
  method        text,
  reference     text,
  note          text,
  submitted_by_recipient boolean not null default false,
  confirmed_at  timestamptz,
  confirmed_by  uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index payments_doc_idx on payments (document_id);
create index payments_org_idx on payments (org_id, paid_on desc);

-- << org_metadata/{orgId}.fin_recurring — an ARRAY inside a single document,
--    rewritten wholesale on every change (documentStore.js:141-148).
--    (RecurringInvoiceForm.jsx:283-305)
create table recurring_invoices (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  customer_id       uuid references customers(id) on delete set null,
  bill_to_name      text not null,
  bill_to_company   text,
  bill_to_email     citext,
  bill_to_address   text,
  bill_to_gstin     text,
  invoice_prefix    text not null default 'INV',
  frequency         text not null check (frequency in ('weekly','monthly','quarterly','half_yearly','yearly')),
  start_date        date not null,
  end_date          date,
  no_end_date       boolean not null default false,
  next_invoice_date date,
  due_offset_days   integer not null default 15 check (due_offset_days >= 0),
  total_cycles      integer check (total_cycles is null or total_cycles >= 0),
  cycles_completed  integer not null default 0 check (cycles_completed >= 0),
  auto_action       text not null default 'draft' check (auto_action in ('draft','send')),
  gst_rate          numeric(5,2) not null default 18 check (gst_rate between 0 and 100),
  subtotal          numeric(14,2) not null default 0 check (subtotal >= 0),
  gst_amount        numeric(14,2) not null default 0 check (gst_amount >= 0),
  grand_total       numeric(14,2) not null default 0 check (grand_total >= 0),
  items             jsonb not null default '[]'::jsonb,
  notes             text,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint recurring_end_after_start check (end_date is null or end_date >= start_date)
);
create index recurring_due_idx on recurring_invoices (org_id, next_invoice_date) where active;

-- ═════════════════════════════════════════════════════════════════════════════
-- SIGNATURES & PORTAL
-- ═════════════════════════════════════════════════════════════════════════════

-- << RecipientPortal.jsx — viewed_at / signed_at / accepted_at / declined_at /
--    decline_reason / acknowledged_at, previously loose fields written straight
--    onto the document by an ANONYMOUS user with no token validation.
--
--    One table for both document families, with a check constraint guaranteeing
--    exactly one FK is set (polymorphism without losing referential integrity).
create table document_signatures (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  record_id         uuid references records(id)              on delete cascade,
  financial_doc_id  uuid references financial_documents(id)  on delete cascade,

  signer_name       text,
  signer_email      citext,
  signature_path    text,               -- Storage object, not a base64 blob
  outcome           text not null check (outcome in ('accepted','declined','acknowledged')),
  decline_reason    text,

  viewed_at         timestamptz,
  signed_at         timestamptz not null default now(),
  signer_ip         inet,               -- evidentiary value
  signer_user_agent text,

  constraint sig_exactly_one_target check (
    (record_id is not null)::int + (financial_doc_id is not null)::int = 1
  )
);
create unique index sig_one_per_record on document_signatures (record_id)        where record_id is not null;
create unique index sig_one_per_findoc on document_signatures (financial_doc_id) where financial_doc_id is not null;
create index sig_org_idx on document_signatures (org_id, signed_at desc);

-- Replaces PortalLinkGenerator.jsx:11 — `Math.random()` regenerated on every
-- render and never validated anywhere.
create table portal_tokens (
  jti              uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  record_id        uuid references records(id)             on delete cascade,
  financial_doc_id uuid references financial_documents(id) on delete cascade,
  scope            text not null check (scope in ('view','sign')),
  recipient_email  citext,
  issued_by        uuid references auth.users(id) on delete set null,
  issued_at        timestamptz not null default now(),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  used_at          timestamptz,
  constraint token_exactly_one_target check (
    (record_id is not null)::int + (financial_doc_id is not null)::int = 1
  ),
  constraint token_expiry_future check (expires_at > issued_at)
);
create index portal_tokens_live_idx on portal_tokens (org_id, expires_at)
  where revoked_at is null;

-- ═════════════════════════════════════════════════════════════════════════════
-- NOTIFICATIONS
-- ═════════════════════════════════════════════════════════════════════════════

-- << org_metadata/{orgId}.fin_notifs — an unbounded ARRAY in a single document
--    (documentStore.js:111-115), rewritten in full on every insert, with ids
--    from Date.now() and a `read` flag shared by the whole organization.
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  type        text not null,
  title       text not null,
  message     text,
  record_id        uuid references records(id)             on delete cascade,
  financial_doc_id uuid references financial_documents(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index notifications_org_idx on notifications (org_id, created_at desc);

-- Per-user read state; Firebase had none, so one user reading a notification
-- hid it from everyone in the org.
create table notification_reads (
  notification_id uuid not null references notifications(id) on delete cascade,
  user_id         uuid not null references auth.users(id)    on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);

-- ═════════════════════════════════════════════════════════════════════════════
-- PLATFORM
-- ═════════════════════════════════════════════════════════════════════════════

-- Team invitations. Firebase had no mechanism to add a second user to an org.
create table invitations (
  token       uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  email       citext not null,
  role        member_role not null default 'member',
  invited_by  uuid references auth.users(id) on delete set null,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create unique index invitations_pending_idx on invitations (org_id, email)
  where accepted_at is null and revoked_at is null;

-- Append-only. No client role may INSERT, UPDATE or DELETE.
create table audit_log (
  id          bigint generated always as identity primary key,
  org_id      uuid references organizations(id) on delete set null,
  actor_id    uuid references auth.users(id)    on delete set null,
  action      text not null,
  entity_type text,
  entity_id   uuid,
  diff        jsonb,
  ip          inet,
  created_at  timestamptz not null default now()
);
create index audit_log_org_idx    on audit_log (org_id, created_at desc);
create index audit_log_entity_idx on audit_log (entity_type, entity_id);

-- Gap-free per-org/type/year document numbering. See next_document_number().
create table document_counters (
  org_id   uuid not null references organizations(id) on delete cascade,
  type     doc_type not null,
  year     integer  not null check (year between 2000 and 2200),
  last_num integer  not null default 0 check (last_num >= 0),
  primary key (org_id, type, year)
);

-- << RTDB memory/{orgId} and Firestore memory/{orgId} (companyMemory.ts:151,289)
--    Migrated for data preservation only. AI behaviour is unchanged.
create table ai_company_memory (
  org_id     uuid primary key references organizations(id) on delete cascade,
  memory     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ETL bookkeeping: maps every Firebase push-ID to its new uuid so 03-load.js is
-- idempotent and resumable, and so 04-verify.js can reconcile row-for-row.
-- Drop this table once the 30-day Firebase rollback window closes.
create table legacy_id_map (
  entity      text not null,
  legacy_id   text not null,
  new_id      uuid not null,
  org_id      uuid references organizations(id) on delete cascade,
  source      text not null check (source in ('rtdb','firestore','both')),
  migrated_at timestamptz not null default now(),
  primary key (entity, legacy_id)
);
create index legacy_id_map_new_idx on legacy_id_map (entity, new_id);
