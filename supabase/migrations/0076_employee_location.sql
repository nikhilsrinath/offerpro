-- 0076 — where each employee works.
--
-- The hub's "People by location" widget groups the active team by this. Free
-- text on purpose ("Bengaluru", "Remote", "Dubai office"): the places a small
-- company works from are few and its own, and a lookup table would be a form
-- to fill before the first answer. Empty means not set, and the widget says so.

alter table public.employees
  add column if not exists location text;

comment on column public.employees.location is
  'Where the employee works (city, office or "Remote"). Grouped by the hub''s People by location widget.';
