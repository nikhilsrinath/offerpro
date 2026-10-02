-- Hotfix: live DB has project_allocations but not set_project_allocations().
-- Copied verbatim from 0049_project_allocations.sql (function + grants), then reloads the API schema cache.
-- Safe to re-run (create or replace). Not a numbered migration.

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

notify pgrst, 'reload schema';
