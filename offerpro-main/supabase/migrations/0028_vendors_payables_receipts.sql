-- ─────────────────────────────────────────────────────────────────────────────
-- 0028 — vendors, purchase (payable) invoices, expense receipts
--
-- Money out becomes a record rather than only an expense line:
--   vendors            the supplier directory (company, contact, terms, GSTIN)
--   purchase_invoices  bills received from vendors; input GST lives here, which
--                      is what the Tax Summary nets against output GST
--   expenses           gain a receipt_path, an optional input-GST amount and an
--                      optional vendor
--   receipts bucket    private, 5 MB ceiling, images and PDFs only
--
-- Both new tables go through app.secure_tenant_table (0027), so their policies
-- read the role_permissions matrix like every other tenant table.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Tables
-- ═════════════════════════════════════════════════════════════════════════════

create table public.vendors (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  company_name       text not null check (length(btrim(company_name)) > 0),
  contact_name       text,
  email              citext,
  phone              text,
  address            text,
  state              text,
  gstin              text check (gstin is null or gstin ~ '^[0-9A-Z]{15}$'),
  -- Net days. 0 means due on receipt.
  payment_terms_days integer not null default 30 check (payment_terms_days between 0 and 365),
  category           text,
  notes              text,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index vendors_org_name_idx on public.vendors (org_id, company_name);

create table public.purchase_invoices (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  -- RESTRICT, not SET NULL: a payable with no vendor is not a payable. Vendors
  -- with history are archived instead of deleted.
  vendor_id    uuid not null references public.vendors(id) on delete restrict,
  bill_number  text not null check (length(btrim(bill_number)) > 0),
  bill_date    date not null default current_date,
  due_date     date,
  category     text not null default 'Operations',
  description  text,
  subtotal     numeric(14,2) not null default 0 check (subtotal >= 0),
  tax_rate     numeric(5,2)  not null default 18 check (tax_rate between 0 and 100),
  tax_amount   numeric(14,2) not null default 0 check (tax_amount >= 0),  -- input GST
  total        numeric(14,2) not null default 0 check (total >= 0),
  amount_paid  numeric(14,2) not null default 0 check (amount_paid >= 0),
  status       text not null default 'unpaid'
               check (status in ('unpaid', 'partially_paid', 'paid', 'void')),
  paid_on      date,
  receipt_path text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint purchase_paid_lte_total check (amount_paid <= total + 0.01),
  unique (org_id, vendor_id, bill_number)
);
create index purchase_invoices_org_date_idx on public.purchase_invoices (org_id, bill_date desc);
create index purchase_invoices_vendor_idx   on public.purchase_invoices (vendor_id);

-- A purchase invoice's vendor must belong to the same org — the FK alone would
-- let a client point a bill at another tenant's vendor id. Totals and status
-- are derived here so the ledger cannot disagree with itself.
create or replace function app.purchase_invoice_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.vendors v
                  where v.id = new.vendor_id and v.org_id = new.org_id) then
    raise exception 'vendor % does not belong to this organization', new.vendor_id
      using errcode = '23503';
  end if;

  new.tax_amount := round(new.subtotal * new.tax_rate / 100, 2);
  new.total      := new.subtotal + new.tax_amount;
  if new.status <> 'void' then
    new.status := case
      when new.total > 0 and new.amount_paid >= new.total - 0.01 then 'paid'
      when new.amount_paid > 0 then 'partially_paid'
      else 'unpaid' end;
  end if;
  if new.status = 'paid' and new.paid_on is null then new.paid_on := current_date; end if;
  if new.status <> 'paid' then new.paid_on := null; end if;
  new.updated_at := now();
  return new;
end $$;

create trigger purchase_invoices_guard
  before insert or update on public.purchase_invoices
  for each row execute function app.purchase_invoice_guard();

create or replace function app.touch_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger vendors_touch
  before update on public.vendors
  for each row execute function app.touch_updated_at();

alter table public.expenses
  add column if not exists receipt_path text,
  add column if not exists tax_amount   numeric(14,2) not null default 0 check (tax_amount >= 0),
  add column if not exists vendor_id    uuid references public.vendors(id) on delete set null;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Permissions
-- ═════════════════════════════════════════════════════════════════════════════

insert into public.permission_resources (key, label, category, description, actions, sort_order) values
  ('vendors',           'Vendors',           'Finance', 'Supplier directory.',                        array['view','create','edit','delete'], 430),
  ('purchase_invoices', 'Purchase invoices', 'Finance', 'Bills received from vendors (payables).',    array['view','create','edit','delete'], 440),
  ('storage_receipts',  'Receipt files',     'Files',   'Expense and bill receipts. Private bucket.', array['view','create','delete'],        640);

-- Same shape as expenses: everyone reads, members write, admins delete.
-- The statement trigger from 0026 copies these into every existing org.
insert into public.role_permission_defaults (role, resource, can_view, can_create, can_edit, can_delete)
select r.key, s.resource,
       true,
       r.key in ('owner','admin','member'),
       s.editable and r.key in ('owner','admin','member'),
       r.key in ('owner','admin')
  from public.roles r
 cross join (values ('vendors', true), ('purchase_invoices', true), ('storage_receipts', false))
       s(resource, editable)
 where r.key in ('owner','admin','member','viewer');

select app.secure_tenant_table('public.vendors'::regclass,           'vendors');
select app.secure_tenant_table('public.purchase_invoices'::regclass, 'purchase_invoices');

grant select, insert, update, delete on public.vendors, public.purchase_invoices to authenticated;
grant all on public.vendors, public.purchase_invoices to service_role;

-- Audited, as 0020 does for the other finance tables.
create trigger vendors_audit after insert or update or delete on public.vendors
  for each row execute function app.write_audit();
create trigger purchase_invoices_audit after insert or update or delete on public.purchase_invoices
  for each row execute function app.write_audit();

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Receipts bucket — private, 5 MB ceiling
-- ═════════════════════════════════════════════════════════════════════════════
-- Object names are '<org_id>/<kind>/<uuid>.<ext>', the layout app.storage_org()
-- reads the tenant from. Reads go through short-lived signed URLs only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880,
        array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts'
         and app.has_permission(app.storage_org(name), 'storage_receipts', 'view'));
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts'
              and app.has_permission(app.storage_org(name), 'storage_receipts', 'create'));
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts'
         and app.has_permission(app.storage_org(name), 'storage_receipts', 'delete'));
