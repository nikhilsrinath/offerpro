-- ─────────────────────────────────────────────────────────────────────────────
-- 0048 — Projects: document links (no money)
--
-- A project's paperwork: the NDA, the MoU, the offer letters (records), and the
-- quotations and proformas that led to it (financial_documents). Exactly one of
-- the two targets per row. Invoices are deliberately NOT linkable here — an
-- invoice's relationship to a project is money, and money goes through
-- project_allocations (0049), where it is counted exactly once.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.project_documents (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  project_id             uuid not null references public.projects(id) on delete cascade,
  record_id              uuid references public.records(id) on delete cascade,
  financial_document_id  uuid references public.financial_documents(id) on delete cascade,
  created_by             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint project_documents_one_target check (num_nonnulls(record_id, financial_document_id) = 1)
);
create unique index if not exists project_documents_record_key
  on public.project_documents (project_id, record_id) where record_id is not null;
create unique index if not exists project_documents_findoc_key
  on public.project_documents (project_id, financial_document_id) where financial_document_id is not null;
create index if not exists project_documents_record_idx on public.project_documents (record_id) where record_id is not null;
create index if not exists project_documents_findoc_idx on public.project_documents (financial_document_id) where financial_document_id is not null;

create or replace function app.project_document_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- A missing reference is left to NOT NULL, which runs after RLS: raising
  -- here would answer a caller RLS is about to refuse with a constraint error
  -- instead (tests/04_role_smoke_test.sql holds every guard to that).
  if new.project_id is null or app.defer_to_rls(new.org_id, 'project_documents', tg_op) then return new; end if;
  if not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'project % does not belong to this organization', new.project_id using errcode = '23503';
  end if;
  if new.record_id is not null and not exists (
       select 1 from public.records r where r.id = new.record_id and r.org_id = new.org_id) then
    raise exception 'document % does not belong to this organization', new.record_id using errcode = '23503';
  end if;
  if new.financial_document_id is not null and not exists (
       select 1 from public.financial_documents f
        where f.id = new.financial_document_id and f.org_id = new.org_id
          and f.type in ('quotation', 'proforma')) then
    raise exception 'only a quotation or proforma of this organization can be linked; invoices are allocated'
      using errcode = '23503';
  end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists project_documents_guard on public.project_documents;
create trigger project_documents_guard
  before insert or update on public.project_documents
  for each row execute function app.project_document_guard();

drop trigger if exists project_documents_freeze_org on public.project_documents;
create trigger project_documents_freeze_org
  before update on public.project_documents
  for each row execute function app.freeze_org_id();

drop trigger if exists project_documents_touch on public.project_documents;
create trigger project_documents_touch
  before update on public.project_documents
  for each row execute function app.touch_updated_at();

drop trigger if exists project_documents_audit on public.project_documents;
create trigger project_documents_audit
  after insert or update or delete on public.project_documents
  for each row execute function app.write_audit();

select app.secure_tenant_table('public.project_documents'::regclass, 'project_documents');
grant select, insert, delete on public.project_documents to authenticated;
grant all on public.project_documents to service_role;

do $mig$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_documents') then
    alter publication supabase_realtime add table public.project_documents;
  end if;
end $mig$;
