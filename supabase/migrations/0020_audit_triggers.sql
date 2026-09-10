-- ─────────────────────────────────────────────────────────────────────────────
-- 0020 — a generic audit trigger, attached to the tables worth auditing
-- Phase 1 · M7 (migration-order.md §2)
--
-- audit_log has existed since 0001 and is append-only (app.forbid_write blocks
-- UPDATE and DELETE, and 0003 revokes every write verb from `authenticated`),
-- but until now the only things writing to it were /api/admin and two functions
-- in 0002. Nothing recorded an ordinary edit, so feature-audit.md #24 — "who
-- changed this, and when" — had no data behind it.
--
-- Design notes:
--
--   * SECURITY DEFINER. `authenticated` has no INSERT on audit_log and must not
--     get one: a client that could insert could forge history. The trigger runs
--     as the owner instead, which is also why it sets search_path explicitly.
--
--   * The diff is the changed columns only, old and new side by side. Storing
--     whole rows would double the database and bury the one field that moved.
--
--   * Column-level exclusions. updated_at changes on every write by trigger, so
--     recording it adds a row of pure noise to every diff.
--
--   * The actor is auth.uid(), which is null for a service-role write. That is
--     correct and deliberate: a null actor means "the server did this", and the
--     endpoints that act on a recipient's behalf (api/portal.js) have no user to
--     name. api/admin.js keeps writing its own rows because it knows the
--     platform admin's id, which auth.uid() would not give it.
--
--   * AFTER, and it never raises. An audit failure must not roll back the write
--     it was describing; anything unexpected is swallowed and logged as a
--     warning. A missing audit row is a gap, a failed invoice save is an outage.
-- ─────────────────────────────────────────────────────────────────────────────

-- Columns that change on their own and say nothing about intent.
create or replace function app.audit_ignored_columns()
returns text[] language sql immutable as $$
  select array['updated_at', 'created_at', 'status_changed_at']::text[]
$$;

-- Most audited tables have an `id`; employee_compensation is keyed by
-- employee_id instead, and an audit row with a null entity_id cannot be joined
-- back to anything.
create or replace function app.audit_entity_id(p_row jsonb)
returns uuid language sql immutable as $$
  select coalesce(p_row ->> 'id', p_row ->> 'employee_id')::uuid
$$;

create or replace function app.write_audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org       uuid;
  v_entity    uuid;
  v_action    text;
  v_diff      jsonb := '{}'::jsonb;
  v_old       jsonb;
  v_new       jsonb;
  v_key       text;
  v_ignored   text[] := app.audit_ignored_columns();
begin
  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_new := '{}'::jsonb;
    v_org := (v_old ->> 'org_id')::uuid;
    v_entity := app.audit_entity_id(v_old);
    v_action := tg_table_name || '.delete';
  elsif tg_op = 'INSERT' then
    v_old := '{}'::jsonb;
    v_new := to_jsonb(new);
    v_org := (v_new ->> 'org_id')::uuid;
    v_entity := app.audit_entity_id(v_new);
    v_action := tg_table_name || '.insert';
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_org := (v_new ->> 'org_id')::uuid;
    v_entity := app.audit_entity_id(v_new);
    v_action := tg_table_name || '.update';
  end if;

  if tg_op = 'UPDATE' then
    -- Changed columns only.
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key = any(v_ignored) then
        continue;
      end if;
      if (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_diff := v_diff || jsonb_build_object(
          v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key)
        );
      end if;
    end loop;

    -- A write that changed nothing we care about is not worth a row.
    if v_diff = '{}'::jsonb then
      return null;
    end if;
  else
    -- Insert and delete record the row's own identifying fields rather than
    -- every column: the row itself is still there (or still in a backup), and
    -- an audit trail is an index into it, not a second copy of it.
    v_diff := jsonb_strip_nulls(jsonb_build_object(
      'name',       coalesce(v_new -> 'name',       v_old -> 'name'),
      'title',      coalesce(v_new -> 'title',      v_old -> 'title'),
      'full_name',  coalesce(v_new -> 'full_name',  v_old -> 'full_name'),
      'doc_number', coalesce(v_new -> 'doc_number', v_old -> 'doc_number'),
      'status',     coalesce(v_new -> 'status',     v_old -> 'status'),
      'amount',     coalesce(v_new -> 'amount',     v_old -> 'amount')
    ));
  end if;

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, diff)
  values (v_org, auth.uid(), v_action, tg_table_name, v_entity, v_diff);

  return null;  -- AFTER trigger; the return value is ignored either way.
exception when others then
  raise warning 'audit trigger on % failed: %', tg_table_name, sqlerrm;
  return null;
end $$;

-- ─── Attach ───────────────────────────────────────────────────────────────────
--
-- The list is migration-order.md M7's, unchanged except that `customers` and
-- `crm_leads` are absent: 0016-0018 moved the app onto `clients`, nothing writes
-- the legacy tables any more, and M9 drops them.
--
-- employee_compensation is audited even though it is not on M7's list. It is the
-- most sensitive table in the schema that a human edits, and "who changed this
-- salary" is exactly the question an audit log exists to answer.
do $$
declare t text;
begin
  foreach t in array array[
    'clients', 'financial_documents', 'records', 'employees', 'tasks',
    'payments', 'catalog_items', 'expenses', 'employee_compensation'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I '
      'for each row execute function app.write_audit()',
      t || '_audit', t
    );
  end loop;
end $$;
