// generate-country-seed.js — emit supabase/migrations/0012_country_codes.sql
//
// Run:  node scripts/generate-country-seed.js
//
// The reference table exists so that "India" -> 'IN' is a lookup rather than a
// guess, and so country_code has something to point a foreign key at. Generated
// from i18n-iso-countries (ISO 3166-1) rather than typed by hand, because a
// hand-typed list of 250 countries is a list with mistakes in it.
import { writeFileSync } from 'node:fs';
import countries from 'i18n-iso-countries';

const official = countries.getNames('en', { select: 'official' });
const aliasIndex = countries.getNames('en', { select: 'alias' });

const rows = Object.keys(official)
  .sort()
  .map((code) => {
    const name = official[code];
    const short = aliasIndex[code];
    // Alternate spellings people actually type into a free-text field. Stored
    // as an array so the lookup can match any of them case-insensitively.
    const aliases = new Set([name]);
    if (short && short !== name) aliases.add(short);
    const extra = countries.getNames('en', { select: 'all' })[code];
    if (Array.isArray(extra)) extra.forEach((n) => aliases.add(n));
    return { code, name, aliases: [...aliases] };
  });

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const arr = (xs) => `array[${xs.map(q).join(', ')}]`;

const values = rows
  .map((r) => `  (${q(r.code)}, ${q(r.name)}, ${arr(r.aliases)})`)
  .join(',\n');

const sql = `-- ============================================================================
-- EdgeOS · 0012_country_codes.sql
--
-- GENERATED FILE — do not edit by hand.
-- Regenerate with:  node scripts/generate-country-seed.js
--
-- ISO 3166-1 alpha-2, from the i18n-iso-countries package. This is reference
-- data, not tenant data: one row per country, shared by every organisation,
-- readable by anyone signed in and writable by no one.
--
-- It earns its place twice over:
--   1. \`aliases\` makes organizations.country, a free-text field somebody typed
--      during registration ("India", "USA", "United States"), resolvable to a
--      code without a pile of guesswork in a CASE expression.
--   2. country_code columns get a foreign key, so a typo cannot become a
--      country that the map has no shape for and no report can explain.
-- ============================================================================

create table country_codes (
  code    char(2) primary key check (code ~ '^[A-Z]{2}$'),
  name    text not null,
  aliases text[] not null default '{}'
);

insert into country_codes (code, name, aliases) values
${values};

-- No index. The table is 250 rows that never grow, and the lookup below runs
-- once per document insert; a sequential scan over 250 rows is cheaper than the
-- index it would have to maintain.

-- Reference data: every signed-in user reads it, nobody writes it. There is no
-- org_id here, so the member test that guards every tenant table does not
-- apply — being authenticated is the whole check.
alter table public.country_codes enable row level security;
alter table public.country_codes force  row level security;

create policy country_codes_select on country_codes for select to authenticated using (true);
-- No insert/update/delete policy: the list changes when ISO changes it, which
-- means regenerating this file, not writing from the browser.

revoke all on public.country_codes from anon;
revoke insert, update, delete on public.country_codes from authenticated;

-- Resolve whatever a human typed into a code. Returns null when nothing
-- matches, which callers treat as "country unknown" rather than as an error.
create or replace function app.country_code_from_name(p_name text)
returns char(2) language sql stable as $fn$
  select c.code
    from public.country_codes c
   where p_name is not null
     and btrim(p_name) <> ''
     and (
       lower(btrim(p_name)) = lower(c.name)
       or lower(btrim(p_name)) = lower(c.code)
       or exists (
         select 1 from unnest(c.aliases) a
          where lower(a) = lower(btrim(p_name))
       )
     )
   limit 1;
$fn$;
`;

writeFileSync('supabase/migrations/0012_country_codes.sql', sql, 'utf8');
console.log(`wrote supabase/migrations/0012_country_codes.sql (${rows.length} countries, ${(sql.length / 1024).toFixed(0)} KB)`);
