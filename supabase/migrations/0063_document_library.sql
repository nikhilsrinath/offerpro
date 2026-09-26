-- ─────────────────────────────────────────────────────────────────────────────
-- 0063 — General document library (Documents → General Documents)
--
-- Any file the company wants to keep: PDFs, decks, spreadsheets, text, images.
-- The file itself lives in the private `library` bucket. What it SAYS is read
-- server-side by /api/library and stored twice, for two different readers:
--
--   library_documents.content_md   the whole document as one Markdown file —
--                                  what a person views or downloads, and the
--                                  unit that is re-extracted when a file is
--                                  replaced. One Markdown per document, never
--                                  one file for the whole library: a document
--                                  can then be re-read, deleted or permission-
--                                  checked on its own, and retrieval never has
--                                  to parse a monolith to find one passage.
--   library_chunks                 the same Markdown cut into passages of about
--                                  a page, each with the heading it sits under
--                                  (page / slide / sheet / section), and a
--                                  full-text index. This is what the AI reads:
--                                  the few passages a question matches, with
--                                  the file and page they came from.
--
-- EdgeBrain gets one node per document (kind `library_document`), so the
-- library appears in the graph and — more importantly — in INVENTORY, the
-- counts that stop the assistant from claiming a document does not exist.
--
-- Permissions: one resource, `library_documents`, gates the table, the chunks,
-- the bucket and the brain nodes alike.
--   owner, admin   everything
--   member         view, upload, edit details
--   viewer         view
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Tables
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.library_documents (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  title              text not null check (length(btrim(title)) between 1 and 200),
  description        text check (description is null or length(description) <= 2000),
  category           text not null default 'general' check (category ~ '^[a-z][a-z0-9_]{1,30}$'),
  tags               text[] not null default '{}',

  file_name          text not null check (length(file_name) between 1 and 255),
  mime_type          text not null default 'application/octet-stream',
  size_bytes         bigint not null check (size_bytes > 0),
  -- '<org_id>/<uuid>.<ext>' — the layout app.storage_org() reads.
  storage_path       text not null unique,

  -- pending → processing → ready | partial | failed | unsupported
  extraction_status  text not null default 'pending'
                       check (extraction_status in ('pending','processing','ready','partial','failed','unsupported')),
  extraction_method  text,
  extraction_error   text,
  content_md         text,
  summary            text,
  page_count         integer,
  char_count         integer,
  chunk_count        integer not null default 0,
  extracted_at       timestamptz,

  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists library_documents_org_idx
  on public.library_documents (org_id, created_at desc);

create table if not exists public.library_chunks (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  document_id  uuid not null references public.library_documents(id) on delete cascade,
  seq          integer not null check (seq >= 0),
  heading      text,
  content      text not null,
  -- `simple`, like brain_nodes.search_text: no stemming, so a company's own
  -- vocabulary — product names, clause numbers, codes — matches as written.
  search_text  tsvector generated always as (
                 to_tsvector('simple'::regconfig, coalesce(heading, '') || ' ' || content)
               ) stored,
  created_at   timestamptz not null default now(),
  unique (document_id, seq)
);

create index if not exists library_chunks_search_idx on public.library_chunks using gin (search_text);
create index if not exists library_chunks_org_idx    on public.library_chunks (org_id, document_id);

drop trigger if exists library_documents_touch on public.library_documents;
create trigger library_documents_touch before update on public.library_documents
  for each row execute function app.touch_updated_at();

-- The org on a chunk is the org of its document, whoever writes it.
create or replace function app.library_chunk_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select d.org_id into new.org_id from public.library_documents d where d.id = new.document_id;
  if new.org_id is null then
    raise exception 'library document % does not exist', new.document_id using errcode = '23503';
  end if;
  return new;
end $$;

drop trigger if exists library_chunks_guard on public.library_chunks;
create trigger library_chunks_guard before insert or update on public.library_chunks
  for each row execute function app.library_chunk_guard();

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Permissions — idempotent, with an explicit fan-out (see 0039)
-- ═════════════════════════════════════════════════════════════════════════════

insert into public.permission_resources (key, label, category, description, actions, sort_order) values
  ('library_documents', 'General documents', 'Documents',
   'The document library: any file the company stores, and the text EdgeBrain reads out of it.',
   array['view','create','edit','delete'], 335)
on conflict (key) do update
  set label = excluded.label, category = excluded.category,
      description = excluded.description, actions = excluded.actions, sort_order = excluded.sort_order;

insert into public.role_permission_defaults (role, resource, can_view, can_create, can_edit, can_delete)
select r.key, 'library_documents',
       r.key in ('owner','admin','member','viewer'),
       r.key in ('owner','admin','member'),
       r.key in ('owner','admin','member'),
       r.key in ('owner','admin')
  from public.roles r
 where r.key in ('owner','admin','member','viewer','employee')
on conflict (role, resource) do nothing;

select app.sync_role_permissions(null) as rows_added;

select app.secure_tenant_table('public.library_documents'::regclass, 'library_documents');
select app.secure_tenant_table('public.library_chunks'::regclass,    'library_documents');

grant select, insert, update, delete on public.library_documents to authenticated;
-- Chunks are written only by the extractor, which runs as the service role.
-- Members may read them (in-document search), never forge them. The revoke is
-- explicit because 0022's default privileges already granted everything.
revoke insert, update, delete, truncate on public.library_chunks from authenticated;
grant select on public.library_chunks to authenticated;
grant all on public.library_documents, public.library_chunks to service_role;

create trigger library_documents_audit after insert or update of title, description, category, tags, storage_path
  or delete on public.library_documents
  for each row execute function app.write_audit();

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Bucket — private, 25 MB, any type
-- ─────────────────────────────────────────────────────────────────────────────
-- No MIME allow-list on purpose: the library is for "whatever the company has".
-- Files are only ever served through five-minute signed URLs from the storage
-- origin, never inlined into the app.
-- ═════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('library', 'library', false, 26214400, null)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = null;

drop policy if exists library_select on storage.objects;
drop policy if exists library_insert on storage.objects;
drop policy if exists library_delete on storage.objects;

create policy library_select on storage.objects for select to authenticated
  using (bucket_id = 'library'
         and app.has_permission(app.storage_org(name), 'library_documents', 'view'));
create policy library_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'library'
              and app.has_permission(app.storage_org(name), 'library_documents', 'create'));
create policy library_delete on storage.objects for delete to authenticated
  using (bucket_id = 'library'
         and app.has_permission(app.storage_org(name), 'library_documents', 'delete'));

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Ranked passage search (server only)
-- ─────────────────────────────────────────────────────────────────────────────
-- PostgREST's textSearch filters but cannot rank, and an OR-query over a few
-- question words without a rank returns whichever passages Postgres met first.
-- The caller is /api/_lib/brainRetrieval.js on the service role, which has
-- already checked library_documents:view for this user.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.library_search(p_org uuid, p_query text, p_limit integer default 8)
returns table (
  chunk_id uuid, document_id uuid, seq integer, heading text, content text, rank real,
  title text, file_name text, category text, extracted_at timestamptz
)
language sql stable set search_path = public, pg_temp as $$
  with q as (select to_tsquery('simple'::regconfig, p_query) as tsq)
  select c.id, c.document_id, c.seq, c.heading, c.content,
         ts_rank_cd(c.search_text, q.tsq, 32) as rank,
         d.title, d.file_name, d.category, d.extracted_at
    from public.library_chunks c
    join public.library_documents d on d.id = c.document_id
    cross join q
   where c.org_id = p_org and d.org_id = p_org
     and c.search_text @@ q.tsq
   order by rank desc, c.seq
   limit least(greatest(coalesce(p_limit, 8), 1), 40)
$$;

revoke all on function public.library_search(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.library_search(uuid, text, integer) to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. EdgeBrain — one node per document
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.brain_sync_library(p_org uuid, p_since timestamptz default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  v_res   text := app.brain_resource('library_documents');
  v_nodes integer := 0;
  v_removed integer := 0;
begin
  -- Fail closed: an unresolved resource key means no gate, so no nodes.
  if v_res is null then
    return jsonb_build_object('nodes', 0, 'removed', 0, 'skipped', 'library_documents resource missing');
  end if;

  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, metrics, synced_at, deleted_at)
  select d.org_id, 'library_document', d.id, 'library_documents', d.updated_at, v_res,
         d.title,
         concat_ws(' · ', d.category, d.file_name, left(coalesce(d.summary, d.description), 400)),
         d.extraction_status,
         jsonb_strip_nulls(jsonb_build_object(
           'title', d.title, 'name', d.file_name, 'type', d.mime_type, 'category', d.category,
           'tags', case when cardinality(d.tags) > 0 then array_to_string(d.tags, ', ') end,
           'description', d.description, 'summary', left(d.summary, 600),
           'pages', d.page_count, 'status', d.extraction_status,
           'size_kb', round(d.size_bytes / 1024.0), 'created_at', d.created_at,
           'extracted_at', d.extracted_at)),
         jsonb_build_object('passages', d.chunk_count, 'characters', coalesce(d.char_count, 0)),
         now(), null
    from public.library_documents d
   where d.org_id = p_org and (p_since is null or d.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, metrics = excluded.metrics, resource = excluded.resource,
        source_updated_at = excluded.source_updated_at, synced_at = now(), deleted_at = null;
  get diagnostics v_nodes = row_count;

  v_removed := app.brain_tombstone(p_org, 'library_document',
    coalesce((select array_agg(id) from public.library_documents where org_id = p_org), '{}'::uuid[]));

  return jsonb_build_object('nodes', v_nodes, 'removed', v_removed);
end $$;

revoke all on function app.brain_sync_library(uuid, timestamptz) from public;

-- 0061's wrapper, with the library added. brain_sync and brain_drain call this
-- name, so documents are part of every sync. Each domain in its own block, so
-- a library failure narrows the brain instead of failing the run.
create or replace function app.brain_sync_ops(p_org uuid, p_since timestamptz default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare a jsonb; b jsonb; c jsonb;
begin
  a := app.brain_sync_ops_core(p_org, p_since);
  b := app.brain_sync_projects(p_org, p_since);
  begin
    c := app.brain_sync_library(p_org, p_since);
  exception when others then
    c := jsonb_build_object('nodes', 0, 'removed', 0, 'error', sqlerrm);
  end;
  return a || jsonb_build_object(
    'nodes',   coalesce((a->>'nodes')::int, 0) + coalesce((b->>'nodes')::int, 0) + coalesce((c->>'nodes')::int, 0),
    'removed', coalesce((a->>'removed')::int, 0) + coalesce((b->>'removed')::int, 0) + coalesce((c->>'removed')::int, 0),
    'projects', b,
    'library', c);
end $$;

revoke all on function app.brain_sync_ops(uuid, timestamptz) from public;

do $mig$
begin
  execute 'drop trigger if exists brain_dirty_ins on public.library_documents';
  execute 'drop trigger if exists brain_dirty_upd on public.library_documents';
  execute 'drop trigger if exists brain_dirty_del on public.library_documents';
  execute 'create trigger brain_dirty_ins after insert on public.library_documents referencing new table as changed
             for each statement execute function app.brain_mark_dirty()';
  execute 'create trigger brain_dirty_upd after update on public.library_documents referencing new table as changed
             for each statement execute function app.brain_mark_dirty()';
  execute 'create trigger brain_dirty_del after delete on public.library_documents referencing old table as changed
             for each statement execute function app.brain_mark_dirty()';
end $mig$;
