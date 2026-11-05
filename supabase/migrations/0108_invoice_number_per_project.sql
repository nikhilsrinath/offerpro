-- 0108: the same invoice number may be used once in each project.
--
-- Each project bills its own client in its own series, so Amoldo Technologies
-- and RedAnt Media can both have "INV - 26-27/001". Until now the number had
-- to be unique across the whole company, unique (org_id, doc_number), and the
-- second project was refused.
--
-- The project an invoice's number belongs to is payload.number_project_id
-- (a project uuid, or absent for an invoice outside any project). It lives in
-- payload rather than a new column so that a browser on a build that knows it
-- keeps saving against a database that does not yet: before this migration
-- the key is simply ignored and the old company-wide rule still applies.
--
-- The number stays exactly what was typed; nothing is suffixed. Within one
-- project, and among invoices with no project, a repeat is still refused.
--
-- The app sets the key when it saves an invoice from a project. The trigger
-- below keeps it in step with the invoice's project allocations (0049) so a
-- change of project made anywhere moves the number with it: one project → that
-- project; none, or a split over several → no project.

-- 1. Backfill from the allocations. Every number is still unique company-wide
--    here, so nothing this writes can collide.
update public.financial_documents f
   set payload = coalesce(f.payload, '{}'::jsonb)
                 || jsonb_build_object('number_project_id', a.project_id::text)
  from (select source_id, min(project_id::text)::uuid as project_id
          from public.project_allocations
         where source_type = 'invoice'
         group by source_id
        having count(distinct project_id) = 1) a
 where f.id = a.source_id
   and f.type = 'invoice'
   and (f.payload ->> 'number_project_id') is distinct from a.project_id::text;

-- 2. The new rule first, then drop the old one, so there is never a moment
--    with neither.
create unique index if not exists financial_documents_number_scope_key
  on public.financial_documents (org_id, coalesce(payload ->> 'number_project_id', ''), doc_number);

alter table public.financial_documents
  drop constraint if exists financial_documents_org_id_doc_number_key;

-- 3. Keep payload.number_project_id in step with the allocations.
create or replace function app.sync_invoice_number_project()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_src  uuid := coalesce(new.source_id, old.source_id);
  v_type public.allocation_source := coalesce(new.source_type, old.source_type);
  v_proj uuid;
  v_n    integer;
begin
  if v_type <> 'invoice' then return null; end if;

  select count(distinct project_id), min(project_id::text)::uuid
    into v_n, v_proj
    from public.project_allocations
   where source_type = 'invoice' and source_id = v_src;

  update public.financial_documents f
     set payload = case when v_n = 1
                        then coalesce(f.payload, '{}'::jsonb)
                             || jsonb_build_object('number_project_id', v_proj::text)
                        else coalesce(f.payload, '{}'::jsonb) - 'number_project_id' end
   where f.id = v_src
     and f.type = 'invoice'
     and (f.payload ->> 'number_project_id')
         is distinct from (case when v_n = 1 then v_proj::text end);
  return null;
end $$;

revoke execute on function app.sync_invoice_number_project() from public;

drop trigger if exists project_allocations_invoice_number on public.project_allocations;
create trigger project_allocations_invoice_number
  after insert or update or delete on public.project_allocations
  for each row execute function app.sync_invoice_number_project();
