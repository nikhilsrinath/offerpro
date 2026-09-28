-- ─────────────────────────────────────────────────────────────────────────────
-- 0069 · Library collections
--
-- The document library holds three registers that are uploaded and read the
-- same way but mean different things to the company:
--   general  General Documents               — any file the company keeps
--   opa      Organisational Process Assets   — policies, templates, procedures
--   lessons  Lessons Learned Register        — what past work taught
--
-- `collection` is the register a file belongs to; `category` stays the free
-- topic label inside it. EdgeBrain is told the register of every document and
-- passage so an answer can say where it came from.
--
-- Additive and idempotent: every existing row becomes 'general'.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.library_documents
  add column if not exists collection text not null default 'general';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'library_documents_collection_check'
       and conrelid = 'public.library_documents'::regclass
  ) then
    alter table public.library_documents
      add constraint library_documents_collection_check
      check (collection in ('general', 'opa', 'lessons'));
  end if;
end $$;

create index if not exists library_documents_org_collection_idx
  on public.library_documents (org_id, collection, created_at desc);

create or replace function app.library_collection_label(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case p
    when 'opa'     then 'Organisational Process Assets'
    when 'lessons' then 'Lessons Learned Register'
    else 'General Documents'
  end
$$;

-- The audit trigger follows the columns a person edits.
drop trigger if exists library_documents_audit on public.library_documents;
create trigger library_documents_audit after insert or update of title, description, category, collection, tags, storage_path
  or delete on public.library_documents
  for each row execute function app.write_audit();

-- ═════════════════════════════════════════════════════════════════════════════
-- Passage search: now says which register each passage is from. The return
-- type changes, so the function is replaced rather than redefined.
-- ═════════════════════════════════════════════════════════════════════════════

drop function if exists public.library_search(uuid, text, integer);

create function public.library_search(p_org uuid, p_query text, p_limit integer default 8)
returns table (
  chunk_id uuid, document_id uuid, seq integer, heading text, content text, rank real,
  title text, file_name text, category text, collection text, extracted_at timestamptz
)
language sql stable set search_path = public, pg_temp as $$
  with q as (select to_tsquery('simple'::regconfig, p_query) as tsq)
  select c.id, c.document_id, c.seq, c.heading, c.content,
         ts_rank_cd(c.search_text, q.tsq, 32) as rank,
         d.title, d.file_name, d.category, d.collection, d.extracted_at
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
-- EdgeBrain node per document: the register joins the summary and the facts.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.brain_sync_library(p_org uuid, p_since timestamptz default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  v_res   text := app.brain_resource('library_documents');
  v_nodes integer := 0;
  v_removed integer := 0;
begin
  if v_res is null then
    return jsonb_build_object('nodes', 0, 'removed', 0, 'skipped', 'library_documents resource missing');
  end if;

  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, metrics, synced_at, deleted_at)
  select d.org_id, 'library_document', d.id, 'library_documents', d.updated_at, v_res,
         d.title,
         concat_ws(' · ', app.library_collection_label(d.collection), d.category, d.file_name,
                   left(coalesce(d.summary, d.description), 400)),
         d.extraction_status,
         jsonb_strip_nulls(jsonb_build_object(
           'title', d.title, 'name', d.file_name, 'type', d.mime_type,
           'register', app.library_collection_label(d.collection), 'category', d.category,
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
