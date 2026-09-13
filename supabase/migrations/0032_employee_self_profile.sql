-- ═══════════════════════════════════════════════════════════════════════════════
-- 0032 — Employees edit their own profile, photo included
-- ═══════════════════════════════════════════════════════════════════════════════
-- Until now the portal was read-only about the person using it: a new phone
-- number or a profile photo meant asking an admin. This file lets an employee
-- keep their own card current, and because it writes the same `employees` row
-- the admin screens read, the change is visible everywhere at once.
--
-- ─── Why a function and not a policy ────────────────────────────────────────
-- RLS secures rows, not columns. An `employees_self_update` policy would let an
-- employee rewrite their own role, department, manager, start date and exit —
-- everything that is an employer's decision rather than a personal detail. So
-- there is no such policy. update_my_profile() is SECURITY DEFINER, finds the
-- caller's row through app.my_employee_id(), and touches a fixed list of
-- columns and nothing else.
--
-- ─── Photos ─────────────────────────────────────────────────────────────────
-- An employee's own uploads live under `{org_id}/self/{employee_id}/…`. The
-- storage policies below allow writes only into that folder, and the function
-- refuses a photo_path outside it — otherwise one employee could point their
-- card at a colleague's photo, or at any object in the bucket.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. The personal details an employee owns
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.employees
  add column if not exists date_of_birth           date,
  add column if not exists bio                     text,
  add column if not exists emergency_contact_name  text,
  add column if not exists emergency_contact_phone text;

alter table public.employees
  drop constraint if exists employees_bio_len,
  add  constraint employees_bio_len check (bio is null or length(bio) <= 600),
  drop constraint if exists employees_dob_sane,
  -- No `< current_date` here: a CHECK must be immutable or a restore can fail
  -- on a row that was valid the day it was written. The function checks it.
  add  constraint employees_dob_sane check (date_of_birth is null or date_of_birth > date '1900-01-01');

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. update_my_profile(org, patch)
-- ═════════════════════════════════════════════════════════════════════════════
-- Only keys present in the patch are changed, so the portal can save one field
-- without round-tripping the others. An empty string clears a field.

create or replace function public.update_my_profile(p_org uuid, p_patch jsonb)
returns public.employees
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := app.my_employee_id(p_org);
  v_photo text;
  v_name  text;
  v_row   public.employees;
begin
  if v_me is null then
    raise exception 'No employee record is linked to your login in this organization.'
      using errcode = '42501';
  end if;

  if p_patch ? 'full_name' then
    v_name := btrim(coalesce(p_patch->>'full_name', ''));
    if length(v_name) = 0 then
      raise exception 'Your name cannot be empty.' using errcode = '22023';
    end if;
    if length(v_name) > 120 then
      raise exception 'That name is too long.' using errcode = '22023';
    end if;
  end if;

  if p_patch ? 'photo_path' then
    v_photo := nullif(btrim(coalesce(p_patch->>'photo_path', '')), '');
    if v_photo is not null
       and v_photo not like p_org::text || '/self/' || v_me::text || '/%' then
      raise exception 'That photo does not belong to you.' using errcode = '42501';
    end if;
  end if;

  if nullif(p_patch->>'date_of_birth', '') is not null
     and (p_patch->>'date_of_birth')::date >= current_date then
    raise exception 'Date of birth must be in the past.' using errcode = '22023';
  end if;

  update public.employees e set
    full_name               = case when p_patch ? 'full_name' then v_name else e.full_name end,
    phone                   = case when p_patch ? 'phone'
                                   then left(nullif(btrim(p_patch->>'phone'), ''), 40) else e.phone end,
    address                 = case when p_patch ? 'address'
                                   then left(nullif(btrim(p_patch->>'address'), ''), 400) else e.address end,
    bio                     = case when p_patch ? 'bio'
                                   then left(nullif(btrim(p_patch->>'bio'), ''), 600) else e.bio end,
    date_of_birth           = case when p_patch ? 'date_of_birth'
                                   then nullif(p_patch->>'date_of_birth', '')::date else e.date_of_birth end,
    emergency_contact_name  = case when p_patch ? 'emergency_contact_name'
                                   then left(nullif(btrim(p_patch->>'emergency_contact_name'), ''), 120)
                                   else e.emergency_contact_name end,
    emergency_contact_phone = case when p_patch ? 'emergency_contact_phone'
                                   then left(nullif(btrim(p_patch->>'emergency_contact_phone'), ''), 40)
                                   else e.emergency_contact_phone end,
    photo_path              = case when p_patch ? 'photo_path' then v_photo else e.photo_path end
  where e.id = v_me
  returning e.* into v_row;

  return v_row;
end;
$$;

revoke execute on function public.update_my_profile(uuid, jsonb) from public;
grant  execute on function public.update_my_profile(uuid, jsonb) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Storage: your own folder in employee-photos
-- ═════════════════════════════════════════════════════════════════════════════
-- Permissive, so these union with the matrix policies from 0029: an admin keeps
-- the whole bucket, an employee gains `{org}/self/{their id}/`. Reading is
-- already granted to the employee role through storage_employee_photos.view.

drop policy if exists employee_photos_self_insert on storage.objects;
drop policy if exists employee_photos_self_update on storage.objects;
drop policy if exists employee_photos_self_delete on storage.objects;

create policy employee_photos_self_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-photos'
              and (storage.foldername(name))[2] = 'self'
              and (storage.foldername(name))[3] = app.my_employee_id(app.storage_org(name))::text);

create policy employee_photos_self_update on storage.objects for update to authenticated
  using      (bucket_id = 'employee-photos'
              and (storage.foldername(name))[2] = 'self'
              and (storage.foldername(name))[3] = app.my_employee_id(app.storage_org(name))::text)
  with check (bucket_id = 'employee-photos'
              and (storage.foldername(name))[2] = 'self'
              and (storage.foldername(name))[3] = app.my_employee_id(app.storage_org(name))::text);

create policy employee_photos_self_delete on storage.objects for delete to authenticated
  using (bucket_id = 'employee-photos'
         and (storage.foldername(name))[2] = 'self'
         and (storage.foldername(name))[3] = app.my_employee_id(app.storage_org(name))::text);
