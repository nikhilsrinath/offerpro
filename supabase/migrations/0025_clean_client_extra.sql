-- ─────────────────────────────────────────────────────────────────────────────
-- 0025 — remove keys from clients.extra that shadow real columns
--
-- clients.extra is the jsonb side-channel the crm_leads adapter uses for fields
-- the table has no column for. Its toRow() built `extra` by destructuring the
-- known keys out of the incoming object and sweeping up the rest — and CRM.jsx
-- sent `status` alongside `stage` on every save and every drag. `status` was not
-- in the destructure list, so it was swept into extra.
--
-- On the way back out, both adapters spread `...r.extra` last, after the real
-- columns. So extra.status — holding a CRM stage name like 'deal' — overwrote the
-- client_status column on read. The Customers page showed a stage where a status
-- belongs, and any code branching on customer.status saw a value that is not in
-- the client_status enum at all.
--
-- Fixed in the app (orgStore.js: extra is spread first and `status` is dropped in
-- toRow; CRM.jsx no longer sends it). This clears what was already written.
--
-- Only keys that duplicate a real column are removed. Everything else in extra is
-- genuine overflow data from the Firebase era and is left alone.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_shadow text[] := array[
    'status', 'stage', 'id', 'org_id', 'name', 'person_name', 'email', 'phone',
    'address', 'gstin', 'state', 'country_code', 'value', 'position', 'notes',
    'source', 'archived_at', 'created_at', 'updated_at', 'status_changed_at',
    -- The display-only aliases the adapter synthesises from the columns above.
    'clientName', 'clientEmail', 'clientAddress', 'contactPhone',
    'buyerGSTIN', 'buyerState', 'company_name'
  ];
  n integer;
begin
  select count(*) into n from public.clients where extra ?| v_shadow;
  raise notice '0025: % client rows carry a shadowing key in extra', n;

  -- The audit trigger from 0020 is attached to clients. This is a one-off
  -- cleanup of a serialisation bug, not a business edit, and one audit row per
  -- client saying so would bury the real history on day one.
  alter table public.clients disable trigger clients_audit;

  update public.clients
     set extra = extra - v_shadow
   where extra ?| v_shadow;

  alter table public.clients enable trigger clients_audit;

  if exists (select 1 from public.clients where extra ?| v_shadow) then
    raise exception '0025: clients.extra still contains shadowing keys';
  end if;

  raise notice '0025: done.';
end $$;
