-- ─────────────────────────────────────────────────────────────────────────────
-- 0084 · Custom templates: a name for an "Other" type, and letterhead printing
--
--   · type_label  — optional name for a template whose category is 'other'
--                   ("Work order", "Site visit note"…). Ignored for the rest.
--   · letterhead  — when true, a generated PDF / Word file starts with the
--                   company letterhead (logo, name, CIN, address, contacts),
--                   the same header the agreements print.
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.project_templates
  add column if not exists type_label text,
  add column if not exists letterhead boolean not null default false;

do $mig$ begin
  if not exists (select 1 from pg_constraint where conname = 'project_templates_type_label_len') then
    alter table public.project_templates
      add constraint project_templates_type_label_len
      check (type_label is null or length(type_label) <= 60);
  end if;
end $mig$;

notify pgrst, 'reload schema';
