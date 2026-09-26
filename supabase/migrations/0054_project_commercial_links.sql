-- ─────────────────────────────────────────────────────────────────────────────
-- 0054 — Projects: invoices that arrive already knowing their project
--
-- Three ways an invoice can be born belonging to a project, all handled here,
-- AFTER INSERT on financial_documents, so no client path can forget them:
--
--   1. A milestone's "Create invoice". The form puts milestone_id into the
--      document's payload (unmapped keys land there, orgStore finDocToRow). The
--      milestone's invoice_id is set (0047 then moves it to `invoiced`) and the
--      invoice is allocated in full to the milestone's project. Honoured only
--      for a writer who may edit that project's milestones.
--   2. A conversion. InvoiceList stores payload.converted_from on every
--      quotation → proforma → invoice step. The chain is walked back (at most
--      three hops) to a quotation that a project was started from
--      (projects.source_quotation_id) or has linked (project_documents).
--   3. A recurring invoice. recurring_invoices.project_id (new here) is the
--      template's project; an invoice whose payload carries
--      recurring_invoice_id is allocated to it. (No generator exists in the
--      codebase yet; whichever one is written gets this for free.)
--
-- In every case: only an invoice, only when it has no allocation yet, only to
-- an open project in the same organization, and always `full`.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.recurring_invoices
  add column if not exists project_id uuid references public.projects(id) on delete set null;
create index if not exists recurring_invoices_project_idx on public.recurring_invoices (project_id) where project_id is not null;

create or replace function app.recurring_project_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.project_id is not null and not exists (
       select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'project % does not belong to this organization', new.project_id using errcode = '23503';
  end if;
  return new;
end $$;

drop trigger if exists recurring_invoices_project_guard on public.recurring_invoices;
create trigger recurring_invoices_project_guard
  before insert or update of project_id on public.recurring_invoices
  for each row execute function app.recurring_project_guard();

-- The project a quotation (or anything converted from one) belongs to.
create or replace function app.project_of_document(p_doc uuid)
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_doc     uuid := p_doc;
  v_project uuid;
  v_hops    integer := 0;
begin
  while v_doc is not null and v_hops < 4 loop
    select p.id into v_project from public.projects p where p.source_quotation_id = v_doc limit 1;
    if v_project is null then
      select d.project_id into v_project from public.project_documents d
       where d.financial_document_id = v_doc order by d.created_at limit 1;
    end if;
    if v_project is not null then return v_project; end if;
    select nullif(f.payload ->> 'converted_from', '')::uuid into v_doc
      from public.financial_documents f where f.id = v_doc;
    v_hops := v_hops + 1;
  end loop;
  return null;
exception when invalid_text_representation then
  return null;
end $$;

create or replace function app.invoice_project_links()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_project   uuid;
  v_milestone uuid;
  v_prev      text := coalesce(current_setting('app.project_system_write', true), '');
begin
  if new.type <> 'invoice' then return null; end if;

  begin
    v_milestone := nullif(new.payload ->> 'milestone_id', '')::uuid;
  exception when invalid_text_representation then v_milestone := null;
  end;

  if v_milestone is not null then
    select m.project_id into v_project from public.project_milestones m
     where m.id = v_milestone and m.org_id = new.org_id and m.invoice_id is null;
    if v_project is not null and (auth.uid() is null or app.has_permission(new.org_id, 'project_milestones', 'edit')) then
      update public.project_milestones set invoice_id = new.id where id = v_milestone;
    else
      v_project := null;
    end if;
  end if;

  if v_project is null then
    begin
      v_project := app.project_of_document(nullif(new.payload ->> 'converted_from', '')::uuid);
    exception when invalid_text_representation then v_project := null;
    end;
  end if;

  if v_project is null and new.payload ? 'recurring_invoice_id' then
    begin
      select r.project_id into v_project from public.recurring_invoices r
       where r.id = (new.payload ->> 'recurring_invoice_id')::uuid and r.org_id = new.org_id;
    exception when invalid_text_representation then v_project := null;
    end;
  end if;

  if v_project is null
     or not exists (select 1 from public.projects p where p.id = v_project and p.org_id = new.org_id
                     and not app.project_is_closed_status(p.status))
     or exists (select 1 from public.project_allocations a where a.source_type = 'invoice' and a.source_id = new.id) then
    return null;
  end if;

  perform set_config('app.project_system_write', 'on', true);
  insert into public.project_allocations (org_id, project_id, source_type, source_id, mode, note)
  values (new.org_id, v_project, 'invoice', new.id, 'full', 'Linked automatically');
  perform set_config('app.project_system_write', v_prev, true);
  return null;
end $$;

drop trigger if exists financial_documents_project_links on public.financial_documents;
create trigger financial_documents_project_links
  after insert on public.financial_documents
  for each row execute function app.invoice_project_links();
