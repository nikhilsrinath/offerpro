# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server; also serves api/* in-process (see below)
npm run build        # two entries: index.html (app) + admin/index.html
npm run lint         # eslint .
npm test             # vitest run
npm run test:watch
npx vitest run src/services/leaveService.test.js      # a single test file
npx vitest run -t "name of test"                       # a single test
bash scripts/run-db-tests.sh                           # SQL/RLS tests, needs Docker
UPTO=0025 bash scripts/run-db-tests.sh                 # stop after that migration
```

`run-db-tests.sh` rebuilds a throwaway Postgres from `supabase/migrations/*.sql` in order,
then runs `supabase/tests/0[1-9]*.sql`. It expects a container named `edgeos-pg`
(`docker run -d --name edgeos-pg -e POSTGRES_PASSWORD=pg postgres:15`), overridable with
`CONTAINER=`. `02_access_matrix.sql` is diffed against
`supabase/tests/expected/day_one_access.out` rather than printing PASS/FAIL.

Vitest uses `vitest.config.js`, deliberately **not** `vite.config.js` — the latter loads
`.env`, mutates `process.env` and registers dev middleware, none of which belongs in a unit
run. It injects placeholder Supabase env vars (`src/lib/supabase.js` calls `createClient()`
at import time) and includes `api/**` as well as `src/**`.

## Environment

`.env` is read by `vite.config.js` via `loadEnv()`, which then copies every key into
`process.env` so the in-process `api/` handlers can see server-only secrets on localhost. A
real shell variable always wins. Only `VITE_`-prefixed keys reach the browser.

- Client: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Server-only: `SUPABASE_SERVICE_ROLE_KEY`, `SECRETS_ENCRYPTION_KEY` (32 bytes, hex or
  base64), `PORTAL_TOKEN_SECRET` (32+ chars), `NVIDIA_API_KEY`, `PORTAL_ALLOWED_ORIGINS`

Missing server-only vars produce a `[vite]` warning at startup and `/api/*` failures, not a
build failure.

## Architecture

React 19 + Vite 7 SPA (vanilla CSS, no Tailwind in the app), Supabase Postgres for data and
auth, and a small `api/` directory of Vercel-style serverless handlers for everything that
needs a secret or a privileged write. Deployed to Vercel (`vercel.json`) or Netlify
(`netlify.toml`), both rewriting all non-API paths to `index.html`.

### The security model is the architecture

This codebase was migrated off Firebase specifically because there was no server-side
authorization (`MEGA_AUDIT.md` documents the original state; `FIX_PLAN.md` and
`SUPABASE_MIGRATION.md` document the remediation). The resulting invariants are load-bearing
— do not work around them:

- **RLS is the authority.** Tenant isolation, roles and the permission matrix are enforced
  in Postgres, not in client query filters. `anon` has no grants on any table.
- **Every new table ships its RLS in the same migration that creates it**, with both
  `enable` and `force row level security`. `docs/phase-0/definition-of-done.md` is the
  checklist and gives the four standard policies (`app.is_member` / `app.can_write` /
  `app.is_admin`); follow it for schema work.
- **`api/` handlers use the service role, which bypasses RLS**, so each one re-asserts
  authorization itself: `requireUser(req)` then `requireOrgRole(userId, orgId, minRole)`
  from `api/_lib/auth.js` (`viewer < member < admin < owner`), or `requirePlatformAdmin`
  for `api/admin.js`. `HttpError(status, msg)` + `sendError` is the error convention.
- **Recipient portal tokens** are `<jti>.<exp>.<hmac>` — signed with `PORTAL_TOKEN_SECRET`
  *and* backed by a revocable `portal_tokens` row, both checked on every request
  (`api/_lib/portalToken.js`). `/api/portal` is the only way an unauthenticated recipient
  reaches data.
- **Gmail app passwords** are AES-256-GCM encrypted server-side (`api/_lib/crypto.js`),
  stored as three bytea columns in `org_secrets`. Never let a secret reach the client.

### Data layer

`src/services/orgStore.js` is the single org-scoped data layer over Supabase. Its shape is
inherited from the Firebase version on purpose (~88 call sites):

- `load(orgId)` hydrates every "section" in one batch; `getSection`/`getItem`/`getProfile`
  are **synchronous** reads of that in-memory cache.
- A "section" is a Postgres table. Sections keep the old Firebase field names; a `SECTIONS`
  registry (`table`, `filter`, `fromRow`, `toRow`, `order`) translates at the boundary.
- `localStorage` mirrors the cache for instant paint — it is a cache only, never a pending-
  write buffer.
- `employees` and `ex_employees` are two filtered views of one table; an exit sets
  `exited_at` and the id never changes.

`src/services/documentStore.js` sits on top for documents. Financial types
(`invoice`/`quotation`/`proforma`) live in `fin_docs`; HR types (`offer`, `certificate`,
`nda`, `mou`, `role_change`, `termination`) live in `records`. `getById` checks both.
Document numbers come from the `next_document_number()` RPC at save time — anything
user-visible must go through `docNumber(doc)`, never `doc.id` (which is now a uuid).
`'offer_letter'` is normalized to `'offer'`.

### App shell and routing

`src/App.jsx` holds the whole route table plus the navigation model: `NAV_ITEMS` (the flat
rail), `MODULE_FILTER` (which page ids belong to which module), `MODULE_EXTRA_PAGES` (pages
in a module but not its rail, e.g. editors), and `FLUSH_PAGES` (pages that manage their own
scrolling). Modules themselves are declared in `src/components/shell/modules.js` and framed
by `ModuleShell.jsx`. Adding a page means touching the route, `NAV_ITEMS` and
`MODULE_FILTER` together. `/portal/:documentId` and `/join` render outside the shell.

`AuthProvider` → `OrgProvider` wrap everything; membership rows are the definition of "user
belongs to an org", and RLS scopes those queries automatically, so never add a `user_id`
filter to a `memberships` query.

### UI

`src/components/ui/edge.jsx` is the design-system kit every converted page is built from
(`src/theme/edge.js` holds tokens, `EdgeTheme.jsx` the provider). Read the header comment in
`edge.jsx` before adding components — it encodes the rules (one typeface/three sizes, colour
means something, actions in a toolbar or at the end of their row). Theme comes from
`useEdgeTheme()`, which reads the context or falls back to observing `data-theme` on
`<html>`; do not call the standalone `useTheme()` hook from a page — it creates an
unsynchronised second copy. `DESIGN_SYSTEM_AUDIT.md` tracks conversion status.

The `/admin` platform panel is a separate static entry (`admin/index.html`, Tailwind CDN,
Chart.js), built as a second Rollup input and served in dev by a middleware in
`vite.config.js`.

### Lint conventions worth knowing

`no-shadow` is an error because a shadowed import once turned every document write into a
runtime `TypeError`. `no-unused-vars` allows `_`-prefixed args/caught errors and
`^[A-Z_]` vars. Most of `eslint-plugin-react`'s recommended set is intentionally off —
only `jsx-uses-vars` is on, so `no-unused-vars` can see JSX usage.

## Reference documents

- `SUPABASE_MIGRATION.md` — the schema and cutover; supersedes parts of `FIX_PLAN.md`
- `FIX_PLAN.md` — 48-item remediation backlog, with checkmarks for what's done
- `MEGA_AUDIT.md` — the original audit these changes answer
- `docs/phase-0/` — decision documents (definition of done, document model, entity model,
  migration order, AI context contract)
- `docs/RUNBOOK-restore.md` — backup/restore; `.github/workflows/backup.yml` is the weekly
  encrypted off-platform backup
- `supabase/pending/` — migrations written but deliberately not applied yet
