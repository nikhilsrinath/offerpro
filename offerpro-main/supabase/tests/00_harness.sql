-- Local-only harness that emulates the parts of a Supabase project the
-- migrations depend on (auth schema, roles, storage, auth.uid()), so the
-- migrations and RLS tests can be run against a plain PostgreSQL instance.
--
-- NOT applied to a real Supabase project — Supabase provides all of this.

create schema if not exists auth;
create schema if not exists storage;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin;          end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- crypt()/gen_salt() for the generated portal passwords in 0031. A real project
-- has pgcrypto installed in `extensions`; here public is close enough, and the
-- functions that use it search both.
create extension if not exists pgcrypto;

-- Mirrors the GoTrue columns 0031 writes, and nothing else. The test suite only
-- ever asserts that a row with a usable bcrypt password and an identity was
-- written — it cannot prove GoTrue accepts it, which is why 0031 says so out
-- loud in its header.
create table if not exists auth.users (
  id                      uuid primary key default gen_random_uuid(),
  instance_id             uuid,
  aud                     text,
  role                    text,
  email                   text unique,
  encrypted_password      text,
  email_confirmed_at      timestamptz,
  raw_app_meta_data       jsonb,
  raw_user_meta_data      jsonb,
  created_at              timestamptz,
  updated_at              timestamptz,
  confirmation_token      text,
  recovery_token          text,
  email_change            text,
  email_change_token_new  text
);

create table if not exists auth.identities (
  id              uuid primary key default gen_random_uuid(),
  provider_id     text,
  user_id         uuid references auth.users(id) on delete cascade,
  identity_data   jsonb,
  provider        text,
  last_sign_in_at timestamptz,
  created_at      timestamptz,
  updated_at      timestamptz
);

-- Supabase resolves these from the request JWT. Locally they read GUCs that the
-- tests set with set_local.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text not null references storage.buckets(id),
  name       text not null,
  owner      uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select string_to_array(name, '/');
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
