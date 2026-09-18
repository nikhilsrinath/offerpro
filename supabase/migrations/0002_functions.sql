-- ============================================================================
-- EdgeOS · 0002_functions.sql
-- Authorization helpers, immutability guards, updated_at, atomic document
-- numbering, derived money totals, and usage counters.
--
-- Everything here is SECURITY DEFINER with a pinned search_path, or a plain
-- trigger. The authorization helpers MUST be SECURITY DEFINER: they read
-- `memberships`, which is itself under RLS, and an invoker-rights function
-- would recurse infinitely through its own policy.
-- ============================================================================

-- Internal helpers live in their own schema so they are not exposed through
-- PostgREST. Only the `public.` functions at the bottom are callable via RPC.
create schema if not exists app;
revoke all on schema app from public, anon, authenticated;
grant usage on schema app to postgres, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Authorization helpers
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app.is_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org and user_id = auth.uid()
  );
$$;

create or replace function app.member_role(p_org uuid)
returns member_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.memberships
  where org_id = p_org and user_id = auth.uid();
$$;

create or replace function app.is_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(app.member_role(p_org) in ('owner','admin'), false);
$$;

create or replace function app.is_owner(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(app.member_role(p_org) = 'owner', false);
$$;

-- A viewer may read but never write.
create or replace function app.can_write(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(app.member_role(p_org) in ('owner','admin','member'), false);
$$;

-- Platform administrator, asserted by a JWT claim set server-side via the admin
-- API. Replaces admin/index.html's `localStorage.admin_session === 'true'`.
create or replace function app.is_platform_admin()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'platform_admin')::boolean,
    false
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Generic triggers
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- A row must never be able to hop tenants. RLS alone does not prevent an UPDATE
-- that rewrites org_id to an org the caller is ALSO a member of.
create or replace function app.freeze_org_id()
returns trigger language plpgsql as $$
begin
  if new.org_id is distinct from old.org_id then
    raise exception 'org_id is immutable (attempted % -> %)', old.org_id, new.org_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- An issued document's number is part of a legal and statutory record.
create or replace function app.freeze_doc_number()
returns trigger language plpgsql as $$
begin
  if new.doc_number is distinct from old.doc_number then
    raise exception 'doc_number is immutable once issued (% -> %)', old.doc_number, new.doc_number
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function app.forbid_write()
returns trigger language plpgsql as $$
begin
  raise exception 'table % is append-only', tg_table_name using errcode = 'insufficient_privilege';
end $$;

-- Attach updated_at + org_id freeze to every table that has both.
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','org_banking','org_secrets','org_settings','subscriptions',
    'usage_counters','employees','employee_compensation','tasks','customers',
    'crm_leads','products','records','financial_documents','recurring_invoices',
    'ai_company_memory'
  ] loop
    execute format(
      'create trigger %I_touch before update on public.%I
         for each row execute function app.touch_updated_at()', t, t);
  end loop;

  foreach t in array array[
    'employees','employee_compensation','tasks','customers','crm_leads','products',
    'expenses','records','financial_documents','document_line_items','payments',
    'recurring_invoices','notifications','document_signatures','portal_tokens',
    'invitations','memberships'
  ] loop
    execute format(
      'create trigger %I_freeze_org before update on public.%I
         for each row execute function app.freeze_org_id()', t, t);
  end loop;
end $$;

create trigger records_freeze_number before update on public.records
  for each row execute function app.freeze_doc_number();
create trigger fin_docs_freeze_number before update on public.financial_documents
  for each row execute function app.freeze_doc_number();

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function app.forbid_write();

-- ─────────────────────────────────────────────────────────────────────────────
-- Atomic document numbering
--
-- Replaces documentStore.nextId() (documentStore.js:98-103):
--     const num = matching.length + 1;
--     return `${prefix}-2026-${String(num).padStart(4,'0')}`;
-- which duplicates an existing number as soon as any document is deleted,
-- races between concurrent users, and hardcodes the year 2026.
--
-- The INSERT .. ON CONFLICT DO UPDATE .. RETURNING takes a row lock for the
-- duration of the statement, so concurrent callers serialize and each receives
-- a distinct number. Gap-free.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app.doc_prefix(p_type doc_type)
returns text language sql immutable as $$
  select case p_type
    when 'invoice'     then 'INV'
    when 'quotation'   then 'QUO'
    when 'proforma'    then 'PI'
    when 'offer'       then 'OL'
    when 'certificate' then 'CRT'
    when 'nda'         then 'NDA'
    when 'mou'         then 'MOU'
  end;
$$;

create or replace function public.next_document_number(
  p_org  uuid,
  p_type doc_type,
  p_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := extract(year from p_date)::integer;
  v_num  integer;
begin
  if not app.is_member(p_org) then
    raise exception 'not a member of organization %', p_org
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.document_counters (org_id, type, year, last_num)
  values (p_org, p_type, v_year, 1)
  on conflict (org_id, type, year)
    do update set last_num = public.document_counters.last_num + 1
  returning last_num into v_num;

  return app.doc_prefix(p_type) || '-' || v_year || '-' || lpad(v_num::text, 4, '0');
end $$;

grant execute on function public.next_document_number(uuid, doc_type, date) to authenticated;

-- After the ETL, push each counter past the highest number already imported so
-- migrated and newly created documents cannot collide.
create or replace function app.reseed_document_counters()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.document_counters (org_id, type, year, last_num)
  select org_id, type,
         substring(doc_number from '-(\d{4})-')::int as year,
         max(substring(doc_number from '-(\d+)$')::int)
  from (
    select org_id, type, doc_number from public.records
    union all
    select org_id, type, doc_number from public.financial_documents
  ) d
  where doc_number ~ '-\d{4}-\d+$'
  group by org_id, type, substring(doc_number from '-(\d{4})-')::int
  on conflict (org_id, type, year) do update
    set last_num = greatest(public.document_counters.last_num, excluded.last_num);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Derived money — line totals, document totals, amount_paid
--
-- The audit found GST arithmetic done only in React with zero tests. Deriving
-- it in the database makes it impossible for a client to persist totals that
-- disagree with the line items.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app.line_item_total()
returns trigger language plpgsql as $$
begin
  new.line_total := round(coalesce(new.quantity,0) * coalesce(new.rate,0), 2);
  return new;
end $$;

create trigger line_items_compute before insert or update on public.document_line_items
  for each row execute function app.line_item_total();

create or replace function app.recompute_document_totals(p_doc uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d            public.financial_documents%rowtype;
  v_subtotal   numeric(14,2);
  v_discount   numeric(14,2);
  v_taxable    numeric(14,2);
  v_gst        numeric(14,2);
begin
  select * into d from public.financial_documents where id = p_doc;
  if not found then return; end if;

  select coalesce(sum(line_total), 0) into v_subtotal
  from public.document_line_items where document_id = p_doc;

  v_discount := case
    when d.discount_type = 'percent' then round(v_subtotal * least(d.discount_value, 100) / 100.0, 2)
    when d.discount_type = 'flat'    then least(d.discount_value, v_subtotal)
    else 0
  end;

  v_taxable := round(v_subtotal - v_discount + coalesce(d.making_charges, 0), 2);
  v_gst     := case when d.gst_enabled then round(v_taxable * d.gst_rate / 100.0, 2) else 0 end;

  update public.financial_documents
     set subtotal        = v_subtotal,
         discount_amount = v_discount,
         taxable_amount  = v_taxable,
         gst_amount      = v_gst,
         grand_total     = round(v_taxable + v_gst, 2)
   where id = p_doc;
end $$;

create or replace function app.line_items_changed()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.recompute_document_totals(coalesce(new.document_id, old.document_id));
  return null;
end $$;

create trigger line_items_recompute
  after insert or update or delete on public.document_line_items
  for each row execute function app.line_items_changed();

-- amount_paid is the sum of confirmed payments, never an asserted field.
create or replace function app.recompute_amount_paid()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_doc uuid := coalesce(new.document_id, old.document_id);
        v_paid numeric(14,2);
        v_total numeric(14,2);
begin
  select coalesce(sum(amount), 0) into v_paid
  from public.payments where document_id = v_doc and confirmed_at is not null;

  select grand_total into v_total from public.financial_documents where id = v_doc;

  update public.financial_documents
     set amount_paid = v_paid,
         status = case
           when v_paid <= 0                    then status
           when v_paid >= v_total - 0.01       then 'paid'::doc_status
           else 'partially_paid'::doc_status
         end
   where id = v_doc;
  return null;
end $$;

create trigger payments_recompute
  after insert or update or delete on public.payments
  for each row execute function app.recompute_amount_paid();

-- ─────────────────────────────────────────────────────────────────────────────
-- Usage counters — replaces the read-everything-and-count loop in
-- usePlanStatus.js:52-62, which was O(n) on every mount and drifted freely.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app.bump_usage()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org   uuid    := coalesce(new.org_id, old.org_id);
  v_type  doc_type := coalesce(new.type, old.type);
  v_delta integer := case when tg_op = 'INSERT' then 1 when tg_op = 'DELETE' then -1 else 0 end;
  v_col   text;
begin
  if v_delta = 0 then return null; end if;

  v_col := case v_type
    when 'offer'       then 'offer_letters'
    when 'certificate' then 'certificates'
    when 'nda'         then 'nda'
    when 'mou'         then 'mou'
    when 'invoice'     then 'invoices'
    when 'quotation'   then 'quotations'
    when 'proforma'    then 'proformas'
  end;

  insert into public.usage_counters (org_id) values (v_org) on conflict do nothing;
  execute format(
    'update public.usage_counters set %I = greatest(0, %I + $1), updated_at = now() where org_id = $2',
    v_col, v_col
  ) using v_delta, v_org;

  return null;
end $$;

create trigger records_usage    after insert or delete on public.records
  for each row execute function app.bump_usage();
create trigger fin_docs_usage   after insert or delete on public.financial_documents
  for each row execute function app.bump_usage();

-- Recount from scratch; run after the ETL and any bulk operation.
--
-- NOTE: the two document families are counted in SEPARATE subqueries and then
-- joined on org_id. Counting them with two LEFT JOINs off `organizations` in a
-- single query produces a Cartesian product — every records row pairs with
-- every financial_documents row — and multiplies all seven counts.
create or replace function app.rebuild_usage_counters()
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.usage_counters (org_id) select id from public.organizations
  on conflict do nothing;

  update public.usage_counters u set
    offer_letters = coalesce(r.offer, 0),
    certificates  = coalesce(r.cert,  0),
    nda           = coalesce(r.nda,   0),
    mou           = coalesce(r.mou,   0),
    invoices      = coalesce(f.inv,   0),
    quotations    = coalesce(f.quo,   0),
    proformas     = coalesce(f.pi,    0),
    updated_at    = now()
  from public.organizations o
  left join (
    select org_id,
      count(*) filter (where type = 'offer')       as offer,
      count(*) filter (where type = 'certificate') as cert,
      count(*) filter (where type = 'nda')         as nda,
      count(*) filter (where type = 'mou')         as mou
    from public.records group by org_id
  ) r on r.org_id = o.id
  left join (
    select org_id,
      count(*) filter (where type = 'invoice')   as inv,
      count(*) filter (where type = 'quotation') as quo,
      count(*) filter (where type = 'proforma')  as pi
    from public.financial_documents group by org_id
  ) f on f.org_id = o.id
  where u.org_id = o.id;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Organization bootstrap — one transaction, replacing dualWriteService.js's
-- three-store fan-out where a Firestore failure was caught and swallowed
-- (dualWriteService.js:154-157).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.create_organization(
  p_company_name text,
  p_profile      jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_org  uuid;
  v_dept uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  insert into public.organizations (
    company_name, company_email, owner_uid, owner_full_name, owner_role,
    document_designation, industry, country, city, company_size,
    company_description, company_website, primary_contact_name,
    use_cases, account_usage, referral_source, include_logo
  ) values (
    p_company_name,
    nullif(p_profile->>'company_email','')::citext,
    v_uid,
    p_profile->>'owner_full_name',
    p_profile->>'owner_role',
    p_profile->>'document_designation',
    p_profile->>'industry',
    p_profile->>'country',
    p_profile->>'city',
    p_profile->>'company_size',
    p_profile->>'company_description',
    p_profile->>'company_website',
    p_profile->>'primary_contact_name',
    coalesce(
      (select array_agg(value::text) from jsonb_array_elements_text(
         case when jsonb_typeof(p_profile->'use_cases') = 'array'
              then p_profile->'use_cases' else '[]'::jsonb end)),
      '{}'
    ),
    p_profile->>'account_usage',
    p_profile->>'referral_source',
    coalesce((p_profile->>'include_logo')::boolean, true)
  )
  returning id into v_org;

  insert into public.memberships (org_id, user_id, role) values (v_org, v_uid, 'owner');
  insert into public.org_settings   (org_id) values (v_org);
  insert into public.subscriptions  (org_id) values (v_org);
  insert into public.usage_counters (org_id) values (v_org);
  insert into public.org_banking    (org_id) values (v_org);

  insert into public.departments (org_id, name) values (v_org, 'Founder''s Office')
  returning id into v_dept;

  insert into public.employees (org_id, full_name, email, role, department_id, employment_type, is_owner)
  values (
    v_org,
    coalesce(nullif(p_profile->>'owner_full_name',''), p_company_name),
    nullif(p_profile->>'company_email','')::citext,
    coalesce(nullif(p_profile->>'owner_role',''), 'Founder'),
    v_dept, 'fulltime', true
  );

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id)
  values (v_org, v_uid, 'organization.created', 'organization', v_org);

  return v_org;
end $$;

grant execute on function public.create_organization(text, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Invitation acceptance — the missing half of multi-user support.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.accept_invitation(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_email citext := (current_setting('request.jwt.claims', true)::jsonb ->> 'email')::citext;
  inv     public.invitations%rowtype;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  select * into inv from public.invitations where token = p_token for update;

  if not found                          then raise exception 'invitation not found';       end if;
  if inv.revoked_at  is not null        then raise exception 'invitation revoked';         end if;
  if inv.accepted_at is not null        then raise exception 'invitation already used';    end if;
  if inv.expires_at  <= now()           then raise exception 'invitation expired';         end if;
  if lower(inv.email) <> lower(v_email) then raise exception 'invitation is for a different email address'; end if;

  insert into public.memberships (org_id, user_id, role)
  values (inv.org_id, v_uid, inv.role)
  on conflict (org_id, user_id) do update set role = excluded.role;

  update public.invitations
     set accepted_at = now(), accepted_by = v_uid
   where token = p_token;

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, diff)
  values (inv.org_id, v_uid, 'membership.accepted', 'membership', v_uid,
          jsonb_build_object('role', inv.role));

  return inv.org_id;
end $$;

grant execute on function public.accept_invitation(uuid) to authenticated;

-- An organization must always retain exactly one owner.
create or replace function app.protect_last_owner()
returns trigger language plpgsql as $$
declare v_owners integer;
begin
  if tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner'
     or tg_op = 'DELETE' and old.role = 'owner' then
    select count(*) into v_owners
    from public.memberships where org_id = old.org_id and role = 'owner';
    if v_owners <= 1 then
      raise exception 'an organization must always have at least one owner'
        using errcode = 'check_violation';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger memberships_protect_owner
  before update or delete on public.memberships
  for each row execute function app.protect_last_owner();
