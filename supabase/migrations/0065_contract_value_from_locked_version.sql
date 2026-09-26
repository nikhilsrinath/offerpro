-- ─────────────────────────────────────────────────────────────────────────────
-- 0065 — A project's contract value is the accepted quotation's, exactly
--
-- projects.source_quotation_id has always carried a contract_value the browser
-- copied from the quotation when the form opened (projectService
-- prefillFromQuotation), then let anyone edit. With versioning (0064) there is
-- one authoritative figure: the taxable amount of the quotation's LOCKED
-- version — what the client actually agreed to, before GST (0061 labels
-- contract value "before GST").
--
--   · Linking a quotation requires it to be locked (accepted).
--   · While linked, contract_value is the locked version's taxable_amount,
--     whatever the client sends.
--   · If the quotation is reopened and a new version accepted, the linked
--     projects follow the new lock — unless the project is closed, whose
--     figures are history.
--
-- Milestones reprice themselves on a contract change (0047), so a relock flows
-- through to percentage milestones not yet invoiced.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app.locked_contract_value(p_quotation uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select (v.payload -> 'totals' ->> 'taxable_amount')::numeric
    from public.financial_documents f
    join public.document_versions v on v.id = f.locked_version_id
   where f.id = p_quotation
$$;

revoke all on function app.locked_contract_value(uuid) from public;

create or replace function app.project_contract_from_quotation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_value numeric;
begin
  if new.source_quotation_id is null then return new; end if;
  -- Left to RLS when the caller could not make this write anyway.
  if auth.uid() is not null
     and not app.has_permission(new.org_id, 'projects', case tg_op when 'INSERT' then 'create' else 'edit' end) then
    return new;
  end if;
  -- An unchanged link on a closed project keeps its historical figure.
  if tg_op = 'UPDATE' and new.source_quotation_id is not distinct from old.source_quotation_id
     and new.status::text in ('completed', 'cancelled') then
    new.contract_value := old.contract_value;
    return new;
  end if;

  v_value := app.locked_contract_value(new.source_quotation_id);
  if v_value is null then
    raise exception 'QUOTATION_NOT_LOCKED: a project can only be started from an accepted quotation'
      using errcode = 'check_violation';
  end if;
  new.contract_value := v_value;
  return new;
end $$;

drop trigger if exists projects_contract_from_quotation on public.projects;
create trigger projects_contract_from_quotation
  before insert or update of source_quotation_id, contract_value, status on public.projects
  for each row execute function app.project_contract_from_quotation();

-- The quotation was (re)locked: every open project built on it takes the new figure.
create or replace function app.quotation_lock_reprices_projects()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_value numeric := app.locked_contract_value(new.id);
begin
  if v_value is null then return null; end if;
  update public.projects p
     set contract_value = v_value
   where p.source_quotation_id = new.id and p.org_id = new.org_id
     and p.status::text not in ('completed', 'cancelled')
     and p.contract_value is distinct from v_value;
  return null;
end $$;

drop trigger if exists financial_documents_lock_reprices_projects on public.financial_documents;
create trigger financial_documents_lock_reprices_projects
  after update of locked_version_id on public.financial_documents
  for each row
  when (new.type = 'quotation' and new.locked_version_id is not null
        and new.locked_version_id is distinct from old.locked_version_id)
  execute function app.quotation_lock_reprices_projects();
