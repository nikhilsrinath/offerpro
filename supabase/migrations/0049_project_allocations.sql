-- ─────────────────────────────────────────────────────────────────────────────
-- 0049 — Projects: allocations (the money link)
--
-- Which money belongs to which project. One row says "this much of that source
-- is this project's", where the source is an invoice, a cash-book income entry,
-- an expense or a purchase bill. A source can be split across projects; what is
-- not allocated is overhead. Nothing here moves money or changes a source row:
-- the source stays exactly what it was, and the P&L keeps counting it once.
--
-- ─── What a source is worth ─────────────────────────────────────────────────
-- app.allocation_source() is the one definition, used by the cap below and by
-- every report in 0051. Net of GST, in INR, on the same terms the app's P&L
-- already uses (src/services/financeAnalytics.js):
--
--   invoice           financial_documents.taxable_amount — after discount and
--                     making charges, before GST (0002 recompute_document_totals).
--                     Only type = 'invoice'. Counts unless draft / cancelled /
--                     declined / expired, the P&L's DEAD set; a cancelled
--                     invoice keeps its allocations but stops being revenue.
--                     financial_documents has no FX column (preflight): the
--                     P&L treats taxable_amount as base currency and so does
--                     this. When invoices gain an fx_rate this is the one place
--                     to apply it.
--   income_entry      amount − tax_amount. `amount` is already INR (0041 derives
--                     it from original_amount × fx_rate). Computed rather than
--                     read from net_amount, for the reason financeAnalytics.net()
--                     gives: a row written without the trigger kept a zero there.
--   expense           amount − tax_amount, as above. expenses has no net_amount
--                     column at all on the live project.
--   purchase_invoice  subtotal (the taxable value; tax_amount is input GST).
--                     Counts unless void.
--
-- ─── Rules ──────────────────────────────────────────────────────────────────
--   · mode 'full' = the whole net amount, and then it is the only allocation of
--     that source. mode 'amount' rows for one source sum to ≤ its net amount.
--   · Editing a cash-book entry or a bill below what is allocated from it fails
--     with ALLOCATION_EXCEEDS_SOURCE; the UI turns that into "adjust the project
--     split first". Invoices are the exception: orgStore rewrites an invoice's
--     line items as a delete then an insert in two requests, so between them
--     the invoice is honestly worth zero and a hard check would break every
--     invoice edit. For invoices the reports scale amount-allocations down to
--     the invoice's value instead (app.project_allocation_rows), and the UI
--     flags the invoice as over-allocated.
--   · Deleting a source deletes its allocations (there is no polymorphic FK, so
--     each source table gets an AFTER DELETE trigger).
--   · A closed project's allocations are locked (0045's guard) — except that a
--     source being deleted still takes its allocations with it.
--
-- ─── Who can see them ───────────────────────────────────────────────────────
-- Every policy is the matrix verb on project_allocations AND view on
-- project_financials. A member holds the first by default and not the second,
-- so a member sees no allocations until an admin grants Project financials.
-- NOTE: app.secure_tenant_table() drops and rebuilds a table's policies from
-- the matrix alone; re-running it on this table would silently drop the
-- financials clause. Section 5 below is what has to be re-run after it.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.project_allocations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete restrict,
  source_type  public.allocation_source not null,
  source_id    uuid not null,
  mode         public.allocation_mode not null default 'full',
  amount       numeric(14,2) check (amount is null or amount > 0),
  note         text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint project_allocations_source_project_key unique (source_type, source_id, project_id),
  constraint project_allocations_amount_matches_mode check (
    (mode = 'full' and amount is null) or (mode = 'amount' and amount is not null))
);
create index if not exists project_allocations_project_idx on public.project_allocations (project_id);
create index if not exists project_allocations_source_idx  on public.project_allocations (source_type, source_id);
create index if not exists project_allocations_org_idx     on public.project_allocations (org_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. What a source is worth
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.allocation_source(p_type public.allocation_source, p_id uuid)
returns table (org_id uuid, net numeric, on_date date, client_id uuid, counts boolean,
               label text, category text, treatment text, gross numeric, amount_paid numeric,
               due_date date, status text)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.org_id, f.taxable_amount, f.issue_date, f.customer_id,
         f.status not in ('draft', 'cancelled', 'declined', 'expired'),
         f.doc_number, null::text, 'revenue'::text, f.grand_total, f.amount_paid,
         f.due_date, f.status::text
    from public.financial_documents f
   where p_type = 'invoice' and f.id = p_id and f.type = 'invoice'
  union all
  select i.org_id, round(i.amount - i.tax_amount, 2), i.received_on, i.client_id, true,
         i.description, i.category, i.treatment, i.amount, i.amount,
         null::date, null::text
    from public.income_entries i
   where p_type = 'income_entry' and i.id = p_id
  union all
  select e.org_id, round(e.amount - e.tax_amount, 2), e.incurred_on, e.client_id, true,
         e.description, e.category, e.treatment, e.amount,
         case when e.status = 'paid' then e.amount else 0 end,
         null::date, e.status
    from public.expenses e
   where p_type = 'expense' and e.id = p_id
  union all
  select b.org_id, b.subtotal, b.bill_date, null::uuid, b.status <> 'void',
         b.bill_number, b.category, 'operating'::text, b.total, b.amount_paid,
         b.due_date, b.status
    from public.purchase_invoices b
   where p_type = 'purchase_invoice' and b.id = p_id
$$;

create or replace function app.allocation_source_net(p_type public.allocation_source, p_id uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select net from app.allocation_source(p_type, p_id)
$$;

revoke execute on function app.allocation_source(public.allocation_source, uuid) from public;
revoke execute on function app.allocation_source_net(public.allocation_source, uuid) from public;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. The row guard: cap, exclusivity, same tenant
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.project_allocation_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_src_org uuid;
  v_net     numeric;
  v_others  numeric;
begin
  -- A missing reference is left to NOT NULL, which runs after RLS: raising
  -- here would answer a caller RLS is about to refuse with a constraint error
  -- instead (tests/04_role_smoke_test.sql holds every guard to that).
  if new.project_id is null or new.source_id is null or new.source_type is null
     or app.defer_to_rls(new.org_id, 'project_allocations', tg_op)
     or (auth.uid() is not null and not app.has_permission(new.org_id, 'project_financials', 'view')) then
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.source_type <> old.source_type or new.source_id <> old.source_id) then
    raise exception 'an allocation cannot be pointed at a different source; remove it and allocate again'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'project % does not belong to this organization', new.project_id using errcode = '23503';
  end if;

  select s.org_id, s.net into v_src_org, v_net
    from app.allocation_source(new.source_type, new.source_id) s;
  if v_src_org is null or v_src_org <> new.org_id then
    raise exception 'ALLOCATION_SOURCE_NOT_FOUND: that % does not exist in this organization', new.source_type
      using errcode = '23503';
  end if;

  -- One writer per source at a time, so two splits cannot both fit.
  perform pg_advisory_xact_lock(hashtextextended('project_allocations:' || new.source_id::text, 0));

  if new.mode = 'full' then
    new.amount := null;
    if exists (select 1 from public.project_allocations a
                where a.source_type = new.source_type and a.source_id = new.source_id and a.id <> new.id) then
      raise exception 'ALLOCATION_FULL_CONFLICT: this entry is already split across projects; a whole-entry allocation must be the only one'
        using errcode = 'check_violation';
    end if;
  else
    if new.amount is null or new.amount <= 0 then
      raise exception 'an amount allocation needs an amount above zero' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.project_allocations a
                where a.source_type = new.source_type and a.source_id = new.source_id
                  and a.id <> new.id and a.mode = 'full') then
      raise exception 'ALLOCATION_FULL_CONFLICT: this entry is already allocated in full to a project'
        using errcode = 'check_violation';
    end if;
    select coalesce(sum(a.amount), 0) into v_others
      from public.project_allocations a
     where a.source_type = new.source_type and a.source_id = new.source_id and a.id <> new.id;
    if v_others + new.amount > coalesce(v_net, 0) + 0.005 then
      raise exception 'ALLOCATION_EXCEEDS_SOURCE: % allocated against a net value of %', v_others + new.amount, coalesce(v_net, 0)
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  else
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists project_allocations_lock on public.project_allocations;
create trigger project_allocations_lock
  before insert or update or delete on public.project_allocations
  for each row execute function app.project_lock_guard();

drop trigger if exists project_allocations_guard on public.project_allocations;
create trigger project_allocations_guard
  before insert or update on public.project_allocations
  for each row execute function app.project_allocation_guard();

drop trigger if exists project_allocations_freeze_org on public.project_allocations;
create trigger project_allocations_freeze_org
  before update on public.project_allocations
  for each row execute function app.freeze_org_id();

drop trigger if exists project_allocations_touch on public.project_allocations;
create trigger project_allocations_touch
  before update on public.project_allocations
  for each row execute function app.touch_updated_at();

drop trigger if exists project_allocations_audit on public.project_allocations;
create trigger project_allocations_audit
  after insert or update or delete on public.project_allocations
  for each row execute function app.write_audit();

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. The source tables: delete cascades, edits respect the cap
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.allocation_source_deleted()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type public.allocation_source := tg_argv[0]::public.allocation_source;
  v_prev text := coalesce(current_setting('app.project_system_write', true), '');
begin
  perform set_config('app.project_system_write', 'on', true);
  delete from public.project_allocations a where a.source_type = v_type and a.source_id = old.id;
  perform set_config('app.project_system_write', v_prev, true);
  return null;
end $$;

-- AFTER UPDATE, so the row's own BEFORE guard has already derived its final
-- amounts (expense_guard computes amount from original_amount × fx_rate).
create or replace function app.allocation_source_updated()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type public.allocation_source := tg_argv[0]::public.allocation_source;
  v_net  numeric;
  v_sum  numeric;
begin
  select coalesce(sum(a.amount), 0) into v_sum
    from public.project_allocations a
   where a.source_type = v_type and a.source_id = new.id and a.mode = 'amount';
  if v_sum = 0 then return null; end if;

  v_net := app.allocation_source_net(v_type, new.id);
  if v_sum > coalesce(v_net, 0) + 0.005 then
    raise exception 'ALLOCATION_EXCEEDS_SOURCE: % is allocated to projects from this entry, more than its new net value of %', v_sum, coalesce(v_net, 0)
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

do $mig$
declare r record;
begin
  for r in select * from (values
      ('financial_documents', 'invoice'),
      ('income_entries',      'income_entry'),
      ('expenses',            'expense'),
      ('purchase_invoices',   'purchase_invoice')) v(tbl, src)
  loop
    execute format('drop trigger if exists %I on public.%I', r.tbl || '_project_allocations_delete', r.tbl);
    execute format(
      'create trigger %I after delete on public.%I for each row execute function app.allocation_source_deleted(%L)',
      r.tbl || '_project_allocations_delete', r.tbl, r.src);
    -- Invoices are left out of the edit check; see the header.
    if r.tbl <> 'financial_documents' then
      execute format('drop trigger if exists %I on public.%I', r.tbl || '_project_allocations_cap', r.tbl);
      execute format(
        'create trigger %I after update on public.%I for each row execute function app.allocation_source_updated(%L)',
        r.tbl || '_project_allocations_cap', r.tbl, r.src);
    end if;
  end loop;
end $mig$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. A project with history is archived, not deleted
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.project_delete_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.project_allocations a where a.project_id = old.id)
     or exists (select 1 from public.project_milestones m where m.project_id = old.id and m.invoice_id is not null)
     or exists (select 1 from public.project_documents d where d.project_id = old.id) then
    raise exception 'PROJECT_HAS_HISTORY: this project has money or documents linked to it; archive it instead'
      using errcode = 'foreign_key_violation';
  end if;
  return old;
end $$;

drop trigger if exists projects_delete_guard on public.projects;
create trigger projects_delete_guard
  before delete on public.projects
  for each row execute function app.project_delete_guard();

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Policies: the matrix AND project_financials
-- ═════════════════════════════════════════════════════════════════════════════

select app.secure_tenant_table('public.project_allocations'::regclass, 'project_allocations');

drop policy if exists project_allocations_select on public.project_allocations;
drop policy if exists project_allocations_insert on public.project_allocations;
drop policy if exists project_allocations_update on public.project_allocations;
drop policy if exists project_allocations_delete on public.project_allocations;

create policy project_allocations_select on public.project_allocations for select to authenticated
  using (app.has_permission(org_id, 'project_allocations', 'view')
         and app.has_permission(org_id, 'project_financials', 'view'));
create policy project_allocations_insert on public.project_allocations for insert to authenticated
  with check (app.has_permission(org_id, 'project_allocations', 'create')
              and app.has_permission(org_id, 'project_financials', 'view'));
create policy project_allocations_update on public.project_allocations for update to authenticated
  using      (app.has_permission(org_id, 'project_allocations', 'edit')
              and app.has_permission(org_id, 'project_financials', 'view'))
  with check (app.has_permission(org_id, 'project_allocations', 'edit')
              and app.has_permission(org_id, 'project_financials', 'view'));
create policy project_allocations_delete on public.project_allocations for delete to authenticated
  using (app.has_permission(org_id, 'project_allocations', 'delete')
         and app.has_permission(org_id, 'project_financials', 'view'));

grant select, insert, update, delete on public.project_allocations to authenticated;
grant all on public.project_allocations to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. Saving a split in one transaction
-- ═════════════════════════════════════════════════════════════════════════════
-- The pickers in the invoice, cash-book and bill forms hand over the whole
-- split for one source: [{ "project_id": …, "amount": null | n }], where a
-- single row with a null amount means "all of it". This makes the source's
-- allocations equal to that list — unchanged rows are left alone (so a closed
-- project's untouched share is not rewritten and refused), shrinking rows are
-- applied before growing ones, and new rows last, so the cap is never tripped
-- by the order of the edit. An empty list removes every allocation of the
-- source: "rest is overhead".
--
-- SECURITY INVOKER on purpose: every row it touches passes the caller's own
-- policies, exactly as if the browser had written them one by one — it only
-- adds atomicity.
create or replace function public.set_project_allocations(
  p_source_type public.allocation_source, p_source_id uuid, p_splits jsonb)
returns setof public.project_allocations
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_splits jsonb := coalesce(p_splits, '[]'::jsonb);
  v_split  jsonb;
  v_full   boolean;
  r        record;
begin
  if jsonb_typeof(v_splits) <> 'array' then
    raise exception 'splits must be a JSON array' using errcode = '22023';
  end if;
  v_full := jsonb_array_length(v_splits) = 1 and (v_splits -> 0 ->> 'amount') is null;
  if jsonb_array_length(v_splits) > 1
     and exists (select 1 from jsonb_array_elements(v_splits) e where (e ->> 'amount') is null) then
    raise exception 'ALLOCATION_FULL_CONFLICT: a split across several projects needs an amount on every line'
      using errcode = 'check_violation';
  end if;

  -- 1. Rows whose project is no longer in the split.
  delete from public.project_allocations a
   where a.source_type = p_source_type and a.source_id = p_source_id
     and not exists (select 1 from jsonb_array_elements(v_splits) e
                      where (e ->> 'project_id')::uuid = a.project_id);

  -- 2. Changed rows, shrinking first.
  for r in
    select a.id, a.mode, a.amount,
           (e ->> 'amount')::numeric as new_amount
      from public.project_allocations a
      join jsonb_array_elements(v_splits) e
        on (e ->> 'project_id')::uuid = a.project_id
     where a.source_type = p_source_type and a.source_id = p_source_id
     order by coalesce((e ->> 'amount')::numeric, 0) - coalesce(a.amount, 0)
  loop
    if v_full and r.mode <> 'full' then
      update public.project_allocations set mode = 'full', amount = null where id = r.id;
    elsif not v_full and (r.mode <> 'amount' or r.amount is distinct from r.new_amount) then
      update public.project_allocations set mode = 'amount', amount = r.new_amount where id = r.id;
    end if;
  end loop;

  -- 3. New rows. The org is the project's (read through the caller's own
  -- RLS); the row guard then refuses a source from any other organization.
  for v_split in select * from jsonb_array_elements(v_splits) loop
    if not exists (select 1 from public.project_allocations a
                    where a.source_type = p_source_type and a.source_id = p_source_id
                      and a.project_id = (v_split ->> 'project_id')::uuid) then
      insert into public.project_allocations (org_id, project_id, source_type, source_id, mode, amount, note)
      values ((select p.org_id from public.projects p where p.id = (v_split ->> 'project_id')::uuid),
              (v_split ->> 'project_id')::uuid, p_source_type, p_source_id,
              case when v_full then 'full' else 'amount' end::public.allocation_mode,
              case when v_full then null else (v_split ->> 'amount')::numeric end,
              nullif(v_split ->> 'note', ''));
    end if;
  end loop;

  return query select * from public.project_allocations a
                where a.source_type = p_source_type and a.source_id = p_source_id;
end $$;

revoke execute on function public.set_project_allocations(public.allocation_source, uuid, jsonb) from public, anon;
grant execute on function public.set_project_allocations(public.allocation_source, uuid, jsonb) to authenticated;

do $mig$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_allocations') then
    alter publication supabase_realtime add table public.project_allocations;
  end if;
end $mig$;
