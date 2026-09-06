# EdgeOS — Fix Plan

> ## ⚠️ Superseded in part — read `SUPABASE_MIGRATION.md` first
>
> **Decision taken: migrate to Supabase before working this backlog.**
>
> The migration **absorbs** items **4** (security rules → RLS), **17** (single source of truth), **23** (ID generation → Postgres function), **25** (notifications → table), and parts of **18**, **21**, **22**, **24**, **26**. Do not start those here — they are executed as part of the schema in `SUPABASE_MIGRATION.md`.
>
> **Do these alongside the migration** (DB-agnostic, and they make the cutover safer): **1**, **2**, **3**, **8**, **10** (DB-agnostic tests only — skip the Firebase rules tests), **11**, **12**, **14**.
>
> Everything else below carries over unchanged and runs after cutover. ~35 of the 48 items remain.

Complete execution backlog derived from `MEGA_AUDIT.md`, in dependency order.
**48 work items.** Each is scoped to specific files, with what changes and how it is verified.

## Scope

**Excluded by request** — not in this plan, and left unfixed:

| Audit ID | Item | Why excluded |
|---|---|---|
| **C-3** | Committed `.env` + live NVIDIA key, `VITE_` prefix inlining it into the client bundle | API key |
| **C-6** | `/api/nvidia` unauthenticated, `ACAO: *`, unbounded `max_tokens` | API key + AI feature |
| — | `ai_message_count` quota never incremented; AI plan limits unenforced | AI feature |
| — | `companyMemory.ts` sending org data to a third-party inference provider | AI feature |
| — | AI Co-founder UI, `cofounderAI.ts`, `decisionEngine.ts`, `employeeAI.ts` behaviour | AI feature |

> Two consequences to be aware of while working this plan: the leaked key stays live and the AI proxy stays open. Item 13 (dependency CVEs) and item 20 (TypeScript) will *touch* the AI service files — item 13 only via package versions, item 20 only to make them type-check. Neither changes AI behaviour.

**In scope:** 7 of 9 Critical · 14 of 14 High · 16 of 16 Medium · 9 of 9 Low.

---

## Phase 0 — Immediate (day 1)

Small, independent, no prerequisites. Do these before anything else.

### ☐ 1. Fix the `documentStore.save` shadowing crash — `H-3`
**Files:** `src/services/documentStore.js`
The `save` parameter is named `doc`, shadowing the Firestore `doc` import from line 4, so line 63 calls a plain object → `TypeError: doc is not a function` on the portal write path.
- Rename the parameter to `docData`; update all references in lines 48–69.
- Audit the file and `src/services/` for other shadowing of `doc`/`set`/`get`/`update`/`remove`.
- Add `no-shadow` and `no-shadow-restricted-names` to `eslint.config.js`.
**Verify:** unit test calling `save()` with `orgStore` unloaded and `_portalOrgId` set; assert no throw and both writes attempted.
**Effort:** 10 minutes.

### ☐ 2. Repository hygiene — `L-4`
**Files:** `.gitignore`, `nohup.out`
`nohup.out` is committed and leaks an internal LAN address (`192.168.29.229`). `.gitignore` also fails to cover `service-account.json`, which `scripts/setup-admin.js:5` reads — a full Firebase admin credential.
- Add `service-account.json`, `*.pem`, `*.key`, `nohup.out`, `dist/` to `.gitignore`.
- `git rm --cached nohup.out`.
- Leave `.env` handling alone (excluded — see Scope).
**Verify:** `git status` clean; `git ls-files | grep -E "nohup|service-account"` empty.
**Effort:** 15 minutes.

### ☐ 3. Take `/admin` offline temporarily — `C-2` (stopgap)
**Files:** `vite.config.js` (lines 18–28, 83–90), `vercel.json`
Anyone can set `localStorage.admin_session='true'` and permanently delete any organization. Until item 8 lands, remove the attack surface.
- Remove the `admin` entry from `build.rollupOptions.input`, or block `/admin` at the edge.
**Verify:** `npm run build` no longer emits `dist/admin/index.html`; `/admin` 404s on a preview deploy.
**Effort:** 30 minutes.

---

## Phase 1 — Make the data safe (weeks 1–3)

Nothing else matters until tenant isolation is real. Item 4 gates most of this phase.

### ☐ 4. Server-side authorization: Firestore + RTDB security rules — `C-1`
**Files:** new `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `database.rules.json`; `src/services/dualWriteService.js`, `src/context/OrgContext.jsx`; new `scripts/migrate-membership-ids.js`
No rules exist anywhere in the repository. Isolation is only the client-side `where('orgId','==',_orgId)` filter at `orgStore.js:193`, over flat global collections. Anonymous auth is enabled and the deployed rule is `auth != null`.
- Change membership doc IDs from push IDs to deterministic `{uid}_{orgId}` so rules resolve them in O(1); backfill existing docs first.
- `isSignedIn()` excluding anonymous; `isMember(orgId)`; `memberRole(orgId)`.
- Every `KEYED_SECTIONS` collection: read/write only if `isMember(resource.data.orgId)`; deny any write that changes `orgId`.
- `organizations/{orgId}` and `org_metadata/{orgId}`: read = member, write = owner/admin.
- Default-deny catch-all. Mirror in `database.rules.json`.
- Composite index on `(orgId)` for all 10 collections.
**Coordinate with:** item 5 — the portal must move to signed tokens in the same release, or anonymous reads have to stay open.
**Verify:** `npm run test:rules` proving org A cannot read org B's employees/customers/fin_docs/records; anonymous reads nothing; non-owner cannot write the org doc.
**Effort:** ~2 weeks. **Blocks:** 5, 6, 7, 21.

### ☐ 5. Recipient portal: signed, expiring, revocable tokens — `C-4`
**Files:** new `api/portal/issue-token.js`, `api/portal/document.js`, `api/portal/sign.js`; `src/components/shared/PortalLinkGenerator.jsx`, `src/components/portal/RecipientPortal.jsx`, `src/services/documentStore.js`
The token at `PortalLinkGenerator.jsx:11` uses `Math.random()`, regenerates on every render, and is never validated. IDs are sequential (`INV-2026-0001`), so documents are enumerable — and the portal captures legally binding signatures.
- JWT with `{documentId, orgId, recipientEmail, scope, exp: +14d, jti}`, signed with `PORTAL_TOKEN_SECRET`; persist `jti` in `portal_tokens` for revocation.
- Server endpoints verify signature + expiry + revocation before returning anything; explicit field allowlist so `gmail_app_password` and `bank_account_number` can never leak.
- Remove `signInAnonymously` (lines 101–103) and the direct `getDoc`/`get(ref(db,...))` calls (lines 120–155).
- Replace "Link does not expire" with the real expiry; add a Revoke button.
**Edge cases:** expired/revoked → friendly page not a crash; already-signed → read-only, never overwrite; 60s clock skew; second device must work; rate-limit to stop `jti` brute-force.
**Verify:** no token, random token, expired token, and a token minted for a *different* document all fail closed; a valid token allows view + sign exactly once.
**Effort:** ~4 days. **Depends on:** 4. **Pairs with:** 23.

### ☐ 6. Rebuild the admin panel on server-verified identity — `C-2`
**Files:** `admin/index.html`, `scripts/setup-admin.js`, new `api/admin/*`, `firestore.rules`
Auth is `localStorage.getItem('admin_password') || 'admin123'` (line 490) and the session gate is just `admin_session === 'true'` (line 394) — no password needed. `setup-admin.js:11-12` provisions a real Firebase user with that credential.
- Delete all client-side password logic and `signInAnonymously`.
- Firebase Auth sign-in + `admin: true` custom claim read from the ID token; no claim → sign out.
- Rewrite `setup-admin.js` to take credentials from argv/env, refuse passwords under 16 chars, and set the claim.
- Move destructive/cross-tenant operations into `api/admin/*` behind `verifyIdToken()` + server-side claim re-check.
- Soft delete (`deleted_at`, `deleted_by`) + 30-day purge; write to `audit_log`.
**Verify:** `localStorage.admin_session='true'` grants nothing; non-admin rejected; `grep -r "admin123" dist/` empty.
**Effort:** ~3 days. **Depends on:** 4. **Supersedes:** 3.

### ☐ 7. Email: authenticate the endpoint, encrypt credentials server-side — `C-5`
**Files:** `api/email.js`, `src/services/emailService.js`, `src/services/orgStore.js`, `src/components/CompanyProfile.jsx`, `vite.config.js`; new `api/lib/crypto.js`, `api/email/credentials.js`
`api/email.js` has no auth of any kind — an open SMTP relay accepting arbitrary credentials and recipients. `transporter.verify()` (line 39) makes it a Gmail credential-validation oracle. Credentials travel from the browser and are stored in plaintext in Firestore, RTDB and `localStorage`.
- Require `Authorization: Bearer <ID token>`; verify and confirm org membership.
- Stop accepting credentials from the client; load them server-side via the admin SDK.
- AES-256-GCM encryption into a server-only `org_secrets/{orgId}` collection; **remove `gmail_user` and `gmail_app_password` from `PROFILE_FIELDS` (`orgStore.js:36`)** so they can never reach RTDB or `localStorage` again.
- Rate-limit (100 emails/hr, 20 test-connections/day). Validate recipients, cap `to` at 50, reject CR/LF injection.
- Test-connection may only test the caller's own stored credentials.
- Update the `vite.config.js` dev shim to exercise the same auth.
**Note:** already-exposed App Passwords must be revoked by each customer in their Google account — the migration cannot undo the exposure.
**Verify:** no header → 401; wrong org → 403; normal send works; response no longer distinguishes valid from invalid third-party credentials; no App Password value in the client bundle.
**Effort:** ~3 days. **Depends on:** 4.

### ☐ 8. Fix the DOM XSS sinks — `C-8`
**Files:** `src/components/financial/InvoiceList.jsx` (lines 135–230), `src/components/StampPreview.jsx`, `src/utils/imageUtils.js`
`InvoiceList.jsx:144` builds an A4 sheet by string concatenation into `innerHTML` with unescaped `company.*` fields; `logo_url` is interpolated inside an `src` attribute. `StampPreview.jsx:9` uses `dangerouslySetInnerHTML` on an SVG built from user-supplied company name and city.
- Preferred: render the existing `InvoicePreview.jsx` component offscreen with `ReactDOM.createRoot` instead of assigning `innerHTML` — React escapes text nodes by default.
- If a string path must remain: `escapeHtml()` on every interpolation; validate `logo_url` with `new URL()` allowing only `https:` and `data:image/`.
- Build the stamp from real React SVG elements; drop `dangerouslySetInnerHTML`.
**Edge cases:** names with `&`/`'` and multi-line addresses must still render; `html2canvas` needs the container in-document (`left:-9999px`, not `display:none`) with fonts/images loaded and `crossOrigin="anonymous"` preserved.
**Verify:** `<img src=x onerror=alert(1)>` as company name and `x" onerror="alert(3)` as logo_url fire nothing and render literally; PDF visually identical.
**Effort:** ~1 day. **Independent — can run in parallel.**

### ☐ 9. Backups, restore, export, and a migration framework — `C-9`
**Files:** new `firebase.json` backup config, `migrations/`, `docs/RUNBOOK-restore.md`; `src/services/orgStore.js`, `src/components/CompanyProfile.jsx`
No backup config, no migrations, no customer export — against a live permanent-delete path.
- Daily Firestore + RTDB exports to GCS (30-day retention, monthly kept 12 months); enable Point-in-Time Recovery. As code, not console clicks.
- Write **and rehearse** `docs/RUNBOOK-restore.md` — perform one real restore into a scratch project and record the time.
- Customer "Export all data" → authenticated function returning a ZIP of every collection plus generated PDFs, excluding `org_secrets`.
- `migrations/` with numbered idempotent forward-only scripts and a `schema_version` on `org_metadata`.
- Convert the implicit RTDB "HYBRID HEAL" (`orgStore.js:226-275`) into a versioned run-once migration.
- Document RPO 24h / RTO 4h.
**Verify:** full restore into a scratch project with integrity confirmed; soft-delete then restore an org; downloaded export opens and is complete.
**Effort:** ~1 week. **Blocks:** 17.

---

## Phase 2 — Make it correct (weeks 4–6)

Tests come before the Phase 3 refactors, or those refactors are done blind.

### ☐ 10. Testing foundation and CI — `H-12`
**Files:** new `vitest.config.js`, `.github/workflows/ci.yml`, `*.test.js`, Playwright config; `package.json`
Zero tests, no runner, no `test` script, no `.github/` directory.
- Vitest + Testing Library + jsdom; `test`, `test:watch`, `test:coverage` scripts.
- Start where a bug costs money or legal standing: **GST arithmetic** (subtotal, percent vs flat discount, CGST/SGST split vs IGST, 2-decimal rounding, 0% rate, 100% discount, qty 0, 18% of 1234.55), `documentStore.nextId` duplication, `planConfig` boundaries including `Infinity`.
- `@firebase/rules-unit-testing` against item 4's rules — the highest-value tests in the codebase.
- Component tests: `OfferForm` submit, `QuotationForm` line-item add/remove/reorder, portal signature flow.
- Playwright E2E: signup → org → offer letter → PDF; invoice → portal link → sign; auth guard on `/hub`.
- CI: lint (`--max-warnings 0`), test, build, `npm audit --audit-level=high`. Required status check.
- Ratcheting coverage floor.
**Verify:** breaking a GST calculation fails a test; weakening a security rule fails a rules test.
**Effort:** ongoing. **Blocks:** 11, 13, 17, 18. **Sequence after:** 11 (or start CI lint non-blocking).

### ☐ 11. Clear all 86 ESLint errors — `H-5`
**Files:** 46 files; see the rule groups below
Not style — several are real defects.
1. **`react-hooks/purity` (5):** `QuotationForm.jsx:91,98`, `ProformaInvoiceForm.jsx:55,60` call `Date.now()` during render for line-item IDs and due dates; `PortalLinkGenerator.jsx:11` calls `Math.random()`. Move into lazy `useState` initializers or event handlers; use `crypto.randomUUID()` for item IDs.
2. **`react-hooks/immutability` (2):** `InternRecords.jsx:39`, `FinanceStatus.jsx:78` call a `const` arrow declared below the effect. Convert to `useCallback` declared first, add to deps.
3. **`no-sparse-arrays` (4):** `MoUPreview.jsx:14`, `NdaPreview.jsx:14`, `pdfService.js:569,875` — double-comma typos inserting `undefined` into **legal-document content arrays**. Determine whether an element is *missing* (a dropped clause) before deleting the comma.
4. **`react-hooks/exhaustive-deps` (13):** stale closures. Fix properly — no `eslint-disable`.
5. **`react-hooks/set-state-in-effect` (6):** derive during render or use a key-reset.
6. **`no-undef` (5):** `process`/`__dirname` in `vite.config.js`, `api/`, `scripts/` — fix via a `node` globals block in `eslint.config.js`, not by editing source.
7. **`react-refresh/only-export-components` (4)** and **`no-empty` (2)** (`orgStore.js:480`, `pdfService.js:151`).
8. **`no-unused-vars` (57):** delete dead code, don't rename.
- Add `eslint-plugin-jsx-a11y` (feeds item 33).
**Verify:** `npx eslint .` exits 0; create a quotation with multiple line items and reorder/delete them; **diff generated MoU and NDA PDFs before/after** to confirm no clause changed.
**Effort:** ~3 days.

### ☐ 12. Split `pdfService.js` and add snapshot tests — `M-12`
**Files:** `src/services/pdfService.js` → `src/services/pdf/{offer,certificate,nda,mou,invoice,quotation,proforma}.js` + shared primitives
1,115 lines / 58 KB producing every legally binding document, with no tests. Statically imported, so jsPDF ships in the main bundle.
- Split by document type with a shared layout module.
- Make it dynamically imported at call sites.
- Snapshot tests generating each type against committed reference PDFs.
**Verify:** all seven document types render identically to the pre-split output.
**Effort:** ~3 days. **Blocks:** 13, 28.

### ☐ 13. Remediate 25 dependency vulnerabilities — `H-10`
**Files:** `package.json`, `package-lock.json`, new `.github/dependabot.yml`, `SECURITY.md`
3 critical, 15 high.
- **`jspdf` (CRITICAL, PDF object injection)** — core to every document. Upgrade, then regression-test all seven types via item 12's snapshots.
- **`nodemailer` (HIGH, CRLF header injection)** — directly exploitable through item 7's endpoint; upgrade *and* keep the input validation.
- `protobufjs` (CRITICAL) and `@grpc/grpc-js` (HIGH) — transitive under `firebase`; lift by upgrading the SDK, `overrides` only if it lags.
- Build-chain: `postcss`, `browserslist`, `js-yaml`, `minimatch`, `picomatch`, `brace-expansion`, `flatted`, `nanoid`.
- Verify `xlsx` against the vendor distribution (registry copy is often stale) and confirm `CSVUploader.jsx` validates input.
- Dependabot weekly + CI `npm audit --audit-level=high`.
**Do not** run `npm audit fix --force` blindly — it will bump majors and silently change PDF output.
**Verify:** audit clean at high; PDF diffs unchanged; org chart and bulk import still work after peer-dep shifts.
**Effort:** ~2 days. **Depends on:** 12.

### ☐ 14. Error boundaries, Sentry, and a real logger — `H-4`
**Files:** new `src/components/shared/ErrorBoundary.jsx`; `src/main.jsx`, `src/App.jsx`; new `src/utils/logger.js`
No `ErrorBoundary`, no `componentDidCatch`, no monitoring anywhere. React 19 unmounts the whole tree on an uncaught render error → white page, no report.
- Boundaries at three levels: root (`main.jsx`), route level (inside `<Routes>` so a feature crash doesn't blank the sidebar), and around `CopilotPanel` and the portal as independent failure domains.
- Chunk-load-error case → "A new version is available — reload" (pairs with item 28).
- Sentry behind an env var, with release tracking, source maps, and `beforeSend` scrubbing `gmail_app_password`, `bank_account_number`, salaries and full org profiles.
- Replace the 96 `console.*` calls with a logger that no-ops debug/info in production.
**Edge cases:** boundaries don't catch event handlers, async code or effect cleanup — add explicit `try/catch` + `captureException` in `orgStore`, `documentStore`, `emailService`, `pdfService`. Don't report validation failures or 429s as exceptions.
**Verify:** throwing in a route keeps the sidebar alive; a source-mapped stack arrives in staging.
**Effort:** ~1 day.

### ☐ 15. Stop swallowing errors silently — `M-5`
**Files:** `src/services/orgStore.js` (lines 342, 384, 397, 408, 419, 428, 480), `src/services/pdfService.js:151`, `src/context/AuthContext.jsx`, `src/context/OrgContext.jsx`
`.catch(() => {})` on six RTDB writes; two empty catch blocks; `console.warn`-and-continue as the default failure mode in both contexts.
- Policy: recoverable → user-visible toast (`ToastProvider` already exists) + Sentry breadcrumb; unrecoverable → boundary; expected → neither.
- Every write returns an awaitable promise; failures roll back optimistic UI.
- No empty catch survives without a comment explaining why.
**Verify:** force a write failure; the user sees it and the UI rolls back.
**Effort:** ~2 days. **Depends on:** 14. **Pairs with:** 17.

### ☐ 16. Repair the onboarding gate — `H-8`
**Files:** `src/context/AuthContext.jsx` (lines 20–77), `src/context/OrgContext.jsx` (lines 16–25, 61–106), `src/App.jsx:233`
`userHasOrganization` makes three sequential round-trips and its result is discarded; `needsOnboarding` is set `false` on both branches, so the guard can never fire.
- Capture the result: `setNeedsOnboarding(!hasOrg)`.
- On network error, retry with backoff then show a retry screen — do not assume the user has an org.
- Parallelize the Firestore checks with `Promise.allSettled`; short-circuit on the local check.
- **Gate `ensureLocalOrg`** (`OrgContext.jsx:66-72, 91`) behind an explicit offline state — it currently fabricates a phantom workspace on any transient failure, hiding the bug.
**Edge cases:** new Google user → Registration; existing user → hub with no flicker; email signup bypasses `onAuthStateChanged` via `signupInProgressRef` — verify that path; invited users must not be sent through org creation.
**Verify:** test with an account having a Firestore org, one with only legacy RTDB, and one with only `localStorage` — none re-onboarded.
**Effort:** ~1 day.

---

## Phase 3 — Make it sound (weeks 6–9)

The architectural work, survivable now that Phase 2 exists.

### ☐ 17. Collapse three sources of truth into one — `H-7`
**Files:** `src/services/orgStore.js` (112–139, 176–318, and all six write methods), `src/services/dualWriteService.js`, `src/services/documentStore.js`, `src/services/storageService.js`, `src/lib/firebase.js`
Every write fans out to `localStorage` + RTDB + Firestore with no coordination. The reconciliation heuristic at `orgStore.js:288` keeps whichever store has *more items* — silently resurrecting deleted records. The heal loop runs on every load.
- Commit to **Firestore** as the single source of truth (get explicit sign-off — one-way door).
- Versioned idempotent migration copying RTDB-only data across, with a reconciliation report reviewed before cut-over.
- Delete the RTDB write path from all six methods and from `dualWriteService`.
- **Delete the HYBRID HEAL block (226–275) and the "more items wins" merge (277–301).**
- Replace `localStorage`-as-write-target with Firestore IndexedDB persistence.
- Add a `pending_writes` indicator.
**Edge cases:** users currently offline with unsynced `localStorage` need a one-time client-side flush before cut-over; documented resolution rule for divergent records (prefer Firestore, log for review); confirm deletes are not resurrected during the migration window; check org-profile document sizes against the 1 MiB limit before migrating (see item 24).
**Verify:** reconciliation report shows zero unexplained divergences; a forced write failure surfaces to the user; a deleted record stays deleted across reload.
**Effort:** ~1.5 weeks. **Depends on:** 9, 10, 15.

### ☐ 18. Per-org store instances — `H-2`
**Files:** `src/services/orgStore.js` (lines 9–12 and every method), `src/services/storageService.js`, `src/services/documentStore.js`, `src/context/OrgContext.jsx`, `src/hooks/usePlanStatus.js`
Module globals `_orgId`, `_cache`, `_loaded`, `_listeners` mean every consumer reads whatever org loaded last. `storageService.getAll(orgId)` **accepts an orgId and ignores it**. `fetchOrganizations` loops calling `load()`, each overwriting the global.
- `createOrgStore(orgId)` factory closing over its own state; no module-level mutable state.
- Provide through context keyed on `activeOrg.id` so switching tears down and rebuilds by construction.
- `fetchOrganizations` must read names from membership/org docs, not load every org's full dataset.
- Fix `storageService`/`documentStore` to honour the org they're given; delete the ignored-parameter pattern.
- Guarantee listener teardown on logout and org switch.
**Edge cases:** `documentStore._portalOrgId` should be deleted entirely once item 5 lands; per-store re-derivation of the pending-writes merge.
**Verify:** a two-org user sees correct records with no bleed-through; logout/login as a different user leaves no residue; unit test two simultaneous stores for isolation.
**Effort:** ~1 week. **Depends on:** 10, 17. **Blocks:** 19, 21.

### ☐ 19. Real org switching — `M-11`
**Files:** `src/context/OrgContext.jsx` (line 94, 185), `src/App.jsx` sidebar
`setActiveOrg(nextOrgs[0])` is arbitrary — `fetchOrganizationIds` builds a `Set` from three sources in non-deterministic order. `setActiveOrg` is exported but nothing calls it, and calling it wouldn't reload data.
- Persist last active org per user; build a switcher in the sidebar; make switching rebuild the data layer.
- Handle removed-from-org by falling back to another org or an empty state.
**Effort:** ~2 days. **Depends on:** 18.

### ☐ 20. TypeScript configuration and domain types — `H-13`
**Files:** new `tsconfig.json`, `src/types/`; `package.json`, `eslint.config.js`; the 8 existing `.ts` files
~2,800 lines of `.ts` with **no `tsconfig.json` and no `typescript` dependency** — esbuild strips the annotations and nothing checks them.
- Add `typescript` + `typescript-eslint`; `tsconfig.json` with `strict`, `noUncheckedIndexedAccess`, `allowJs`, `checkJs: false`.
- `typecheck` script (`tsc --noEmit`) in CI.
- Fix the errors this surfaces, smallest file first: `taskStore` → `useTaskDeadlineMonitor` → `followUpEngine` → `decisionEngine` → `employeeAI` → `cofounderAI` → `companyMemory`. *(Types only — no behaviour change to the AI services.)*
- Define `src/types/`: `Organization`, `Employee`, `Customer`, `FinancialDocument` (discriminated union), `Record`, `Task`, `CrmLead`, `Membership`, `Plan` — the missing schema documentation.
- Type the data layer next; then migrate `.jsx` → `.tsx` incrementally, financial forms first.
**Edge cases:** if `strict` is unmanageable, start at `noImplicitAny` and ratchet; use `unknown` + narrowing, never `any`; add runtime validation at the Firestore boundary (item 22) rather than asserting.
**Verify:** `npm run typecheck` exits 0; CI fails on an introduced type error.
**Effort:** ~3 days. **Best done alongside:** 17.

### ☐ 21. Role-based access control and team invitations — `H-9`
**Files:** `firestore.rules`, `src/services/dualWriteService.js`, `src/context/OrgContext.jsx`; new `src/hooks/usePermissions.js`, invitation endpoints, Team Management screen; `src/components/Employees.jsx`, `CompanyProfile.jsx`
Memberships carry a `role` field that is **never read for any access decision**. There is no way to add a second user to an org at all. Every member can read salaries, bank details and the Gmail App Password, and delete anything.
- Roles: `owner` (everything incl. billing), `admin` (all but billing/owner removal), `member` (documents, no salary/bank, no delete), `viewer` (read-only).
- **Enforce in rules first.** Firestore has no field-level security, so **move salary into `employee_compensation/{empId}` and bank/GST into `org_financial/{orgId}`** — this is the key architectural change; plan it before writing rules.
- `usePermissions()` hook for UI gating — hide rather than disable where the action's existence is sensitive.
- Invitations: `invitations/{token}` with `{orgId, email, role, expires_at, accepted_at}`; emailed via item 7's secured path; acceptance creates the `{uid}_{orgId}` membership.
- Team Management: list, change role, remove, resend/revoke. Every change to `audit_log`.
**Edge cases:** last owner cannot be removed or demoted (server-enforced); a removed member must lose access on next read and be signed out of that org gracefully; role is per-org, so `usePermissions` keys off the active org.
**Verify:** rules tests — `member` cannot read `employee_compensation` or `org_financial`; `viewer` cannot write; `admin` cannot change billing. Invite a second user end to end and confirm limits hold from the Firestore console, not just the UI.
**Effort:** ~1 week. **Depends on:** 4, 18.

### ☐ 22. Input validation and sanitization layer — `M-4`
**Files:** new `src/schemas/`; every form component; `src/services/orgStore.js`, `firestore.rules`
No validation library and no schema validation anywhere. `orgStore.sanitize()` only strips `undefined`. GSTIN/IFSC/email/phone accept anything; numeric fields accept negatives and `NaN` (a negative quantity produces a negative invoice); free text is unbounded.
- zod schemas per entity, mirroring item 20's domain types.
- Validate on submit **and** in the data layer before any write.
- Format validators: GSTIN (15-char + checksum), IFSC `^[A-Z]{4}0[A-Z0-9]{6}$`, PAN, email, phone.
- Length caps and numeric ranges (qty > 0, rate ≥ 0, discount 0–100%).
- Mirror constraints in `firestore.rules`. Inline error surfacing.
**Verify:** boundary and malicious inputs rejected at both layers.
**Effort:** ~4 days. **Depends on:** 20.

### ☐ 23. Collision-free ID generation — `M-2`
**Files:** `src/services/documentStore.js` (lines 98–103, 113), new counter transaction
`nextId` uses `matching.length + 1` — delete a middle document and the next ID **duplicates an existing one**, overwriting it via `setItem`. Concurrent users collide. The year `2026` is hardcoded. Notification IDs use `Date.now()`, which collides within a millisecond and makes `deleteNotification` remove both.
- Separate storage key from display number: `crypto.randomUUID()` for the key.
- Display sequence from a server-side Firestore transaction on a per-org, per-type, per-year counter.
- Derive the year from the document date.
- `crypto.randomUUID()` for notification IDs.
- Migrate existing documents keeping their display numbers.
**Verify:** create documents concurrently in two tabs → no duplicates; delete a middle document → next number does not collide.
**Effort:** ~2 days. **Pairs with:** 5.

### ☐ 24. Move base64 images to Firebase Storage — `M-1`
**Files:** `src/services/imageUploadService.js:35`, `src/utils/imageUtils.js:52`, `src/services/orgStore.js:32`, `src/components/CompanyProfile.jsx`, `src/components/ImageEditor.jsx`
Logos, signatures and stamps are stored as base64 data URLs in the org profile — risking Firestore's **1 MiB document limit**, consuming the `localStorage` quota (where `persistToLS` only warns on failure, so writes silently stop persisting), and re-transferring on every read with no CDN caching.
- Upload binary to Storage; store only the download URL.
- MIME + size validation (reject > 2 MB before upload); generate resized variants; long cache headers.
- Migration extracting existing base64 blobs.
- Keep `imageUtils.ensureBase64` working for jsPDF by fetching from URL at generation time (that path already exists at `imageUtils.js:4`).
**Verify:** org profile document well under 1 MiB; PDFs still render logos, signatures and stamps.
**Effort:** ~3 days. **Blocks:** 17 cut-over.

### ☐ 25. Notifications into their own collection — `M-6`
**Files:** `src/services/documentStore.js` (lines 106–133), `src/services/orgStore.js:129-132`, `src/App.jsx`
`addNotification` does `unshift` then writes the **entire array** to one field on `org_metadata/{orgId}`. It never truncates, so every new notification rewrites the whole history until the 1 MiB limit fails the write — silently. The UI only shows 20. `read` state is global to the org, so one user marking a notification read hides it from everyone.
- Move to a `notifications` collection with `orgId`, queried `orderBy('created_at','desc').limit(50)`.
- Per-user read state.
- TTL or scheduled cleanup of read notifications older than 90 days.
**Verify:** 10,000 notifications keep writes fast and bounded.
**Effort:** ~2 days.

### ☐ 26. Pagination and lazy section loading — `M-3`
**Files:** `src/services/orgStore.js` (lines 192–198, 249–262), `InternRecords.jsx`, `InvoiceList.jsx`, `Employees.jsx`, `CRM.jsx`
`load()` issues 10 parallel `getDocs` plus 2 doc reads on every app load, then up to 10 **sequential** RTDB reads in the healing loop — worst case for a new org. It loads every record the org has ever created; there is no pagination anywhere.
- Remove the healing loop (item 17 covers this).
- Load only what the current route needs; lazy, cached section loading.
- `limit` + cursor pagination on `records`, `fin_docs`, `employees`, `crm_leads`; paginate or virtualize the consuming lists.
**Verify:** measure Firestore reads per session before/after — target 10× reduction; an org with 1,000+ records loads in under 2s.
**Effort:** ~4 days. **Depends on:** 17.

---

## Phase 4 — Make it fast and findable (weeks 9–11)

### ☐ 27. Split the marketing shell from the app shell — `M-10`
**Files:** `src/App.jsx` (lines 226–231, 610–628), `src/main.jsx`
`LandingPage`, `Auth` and `Registration` render *inside* `AppContent`, below `AuthProvider` and `OrgProvider` — so anonymous visitors initialize Firebase Auth, mount both providers, and pull the whole app bundle.
- Split the route tree at the top so marketing routes render outside both providers and outside the app bundle.
**Verify:** an anonymous visit makes zero Firestore reads and downloads only the marketing chunk.
**Effort:** ~2 days. **Blocks:** 28, 30.

### ☐ 28. Code-split the 3.38 MB bundle — `H-1`
**Files:** `src/App.jsx` (lines 12–58, 516–553), `vite.config.js`, all `pdfService`/`xlsx` call sites
One 3,382 KB chunk (976 KB gzip) plus 260 KB CSS, served to every anonymous landing-page visitor.
- `React.lazy()` + `<Suspense>` with real skeletons for every route; heaviest first — `TeamHierarchy` (`@xyflow/react`), `BillingRevenue`/`Dashboard` (`recharts`), the four bulk components (`xlsx`), everything importing `pdfService`.
- Dynamic `await import()` for `pdfService` and `xlsx` at call sites.
- `manualChunks` isolating `react`/`react-dom`, `firebase`, charts.
- Split `src/index.css` per feature so it code-splits with its route.
- `rollup-plugin-visualizer` + a CI size budget failing above 200 KB gzipped on the landing route.
- Do **not** just raise `chunkSizeWarningLimit`.
**Edge cases:** `Suspense` above `Routes`; a failed lazy chunk (stale deploy) must show "reload to update", not a white screen (item 14); keep `/portal` lightweight; preserve the admin entry point.
**Verify:** no chunk over 500 KB; landing initial JS under 200 KB gzip; Lighthouse before/after.
**Effort:** ~4 days. **Depends on:** 12, 14, 27.

### ☐ 29. Tokenize and split the CSS — `M-8`
**Files:** `src/index.css` (13,302 lines / 250 KB), all components with inline styles
187 `!important` declarations, 459 hardcoded hex colors against only 62 custom properties, and **2,169 inline `style={{...}}` objects** that can't be themed or cached and force `style-src 'unsafe-inline'` in any CSP.
- Extract a complete design-token layer; replace the 459 hexes with tokens (this also fixes theming gaps).
- Split by feature, co-located with components so it code-splits.
- Eliminate `!important` by fixing specificity, working down by frequency.
- Migrate the highest-traffic inline styles (list rows, repeated renders) to classes.
**Verify:** visual regression snapshots in both themes at three breakpoints — target zero visual change.
**Effort:** ~1 week. **Supports:** 28, 36.

### ☐ 30. SEO: metadata, structured data, prerendering — `H-6`
**Files:** `index.html`, new `public/robots.txt`, `public/sitemap.xml`, OG image; `src/components/landing/subPageData.js` and the 12 page components
22 lines with a `<title>` and nothing else: no description, OG, canonical, robots, sitemap, structured data, per-route meta, or SSR. Twelve well-written content pages are invisible to search.
- Base meta + full Open Graph + Twitter Card; a real 1200×630 OG image.
- Per-route metadata via `react-helmet-async` or React 19 document metadata, derived from `subPageData`.
- `robots.txt` allowing marketing, disallowing `/hub`, `/admin`, `/portal`, `/dashboard`.
- Build-time `sitemap.xml` generation so it can't go stale.
- JSON-LD: `SoftwareApplication` (offers matching real tiers), `Organization`, `BreadcrumbList`.
- **Prerender** the landing page and 12 sub-pages to static HTML.
- Semantic pass: one `<h1>`, correct heading order, `<nav>`/`<main>`/`<footer>` landmarks.
**Edge cases:** guard browser-only code during prerender; exclude `/portal` from the sitemap.
**Verify:** Lighthouse SEO 100; Rich Results Test passes; OG card renders in Slack/LinkedIn; `curl` shows real content.
**Effort:** ~4 days. **Depends on:** 27.

### ☐ 31. Restore pinch-zoom — `H-6` / `M-7`
**Files:** `index.html:10`
`maximum-scale=1.0, user-scalable=no` is a WCAG 2.1 SC 1.4.4 failure and a mobile-usability negative signal.
- Remove both; fix any layout bugs that surface at high zoom rather than reverting.
**Verify:** pinch-zoom works; layout holds at 200% and 400%.
**Effort:** ~half a day (plus layout fixes).

### ☐ 32. Replace interval polling with subscriptions — `H-14`
**Files:** `src/App.jsx` (lines 171–188), `src/components/tasks/TasksPage.jsx:83`
Notifications re-read **every 3 seconds** forever, re-rendering the whole app shell 20×/minute because `setNotifications` gets a fresh array reference each tick. Tasks poll every 5s. Meanwhile `orgStore.listenSection` already implements correct `onSnapshot` subscriptions and goes unused. (`useTaskDeadlineMonitor`'s hourly interval is fine — leave it.)
- Swap both polls for `listenSection`, returning the unsubscriber and re-running on org change.
- Only `setNotifications` when content actually changed; `useMemo` the `unreadCount` (line 176).
- Consider a notifications context so an update doesn't re-render the sidebar and CopilotPanel.
- Debounce the `isMobile` resize listener (lines 171–175).
**Edge cases:** tear down on logout and org switch; `onSnapshot` fires immediately from cache — don't emit a spurious "new notification" on mount.
**Verify:** React DevTools shows no idle re-render; a notification in one browser appears in another within ~1s.
**Effort:** ~1 day. **Depends on:** 18.

### ☐ 33. Accessibility to WCAG AA — `M-7`
**Files:** app-wide; `eslint.config.js`, `src/index.css`, `src/App.jsx:453`, all modals
Only **4** `aria-label` attributes in the entire app; **28** `<div onClick>` handlers with no role, tabIndex or key handler; no skip link; no focus trap in the notification panel or any modal; 459 hardcoded colors with unverified contrast.
- `eslint-plugin-jsx-a11y` and fix everything it reports.
- Convert every `<div onClick>` to `<button>` (or add role/tabIndex/Enter+Space).
- Skip-to-content link; focus trapping + Escape-to-close with focus restored on close.
- `aria-label` on every icon-only button (sidebar, mobile top bar, table row actions).
- Audit all text/background pairs for AA (4.5:1 body, 3:1 large) **in both themes**.
**Verify:** full keyboard-only pass; screen-reader pass; Lighthouse Accessibility ≥ 95.
**Effort:** ~1 week. **Depends on:** 29, 31.

### ☐ 34. Offline handling and sync state — `M-9`
**Files:** `src/lib/firebase.js`, `src/App.jsx`, document list components
No `navigator.onLine` check, no offline banner, no retry, no queued-write indicator, and Firestore persistence isn't enabled. Because writes hit `localStorage` first and fire-and-forget, **the app appears to work offline and silently loses data**.
- Enable Firestore IndexedDB persistence.
- Online/offline detector + persistent banner.
- Per-document sync state: synced / pending / failed.
- Exponential-backoff retry for transient failures; never report success for an unconfirmed write.
**Verify:** create a record offline in DevTools, go online, confirm it syncs exactly once.
**Effort:** ~3 days. **Depends on:** 17.

---

## Phase 5 — Make it a business (weeks 11–14)

### ☐ 35. Payments and server-authoritative billing — `C-7`
**Files:** `src/services/orgStore.js` (lines 26–37, 333–344), `src/hooks/usePlanStatus.js:19`, `src/services/planConfig.js`, `PricingPage.jsx`, `CompanyProfile.jsx`; new `api/billing/*`
`plan` and `is_premium` are client-writable profile fields — `orgStore.updateProfile({plan:'max'})` works from the console. Enforcement is UI-only. **No payment provider exists in the codebase**, while `PricingPage.jsx` advertises paid tiers.
- Pick a provider (**Razorpay** suits the INR/GST orientation; Stripe if global) — confirm before building.
- Remove `plan`, `is_premium`, `ai_message_count` from `PROFILE_FIELDS`; move billing state to `subscriptions/{orgId}`, read-only to members and server-write-only.
- `api/billing/`: `create-checkout-session`, `webhook`, `portal-session`. The webhook **verifies the signature, is idempotent, and is the only writer** of subscription state. Handle created/renewed/failed/cancelled/upgraded/downgraded.
- Enforce quota-bearing creates server-side (rules or serverless), keeping the client check as UX only. *(AI message quota excluded from this plan.)*
- Replace the O(n) usage counting with transactional counters on `org_metadata/{orgId}.usage`.
- Lifecycle: trial, dunning, grace period, downgrade-over-limit (read-only, never delete data), cancellation with export.
- Wire `PricingPage` to real checkout; add a Billing section with plan, usage, invoices, manage-subscription.
**Edge cases:** webhook may land before the client redirect — the subscription doc is truth; duplicate webhooks need idempotency keys; GST invoice requirements for Indian customers; refunds/chargebacks revoke access.
**Verify:** console `updateProfile({plan:'max'})` grants nothing; a real test-mode checkout changes the plan; a failed-renewal webhook degrades access; tests for webhook idempotency and signature rejection.
**Effort:** ~2 weeks. **Depends on:** 4, 21.

### ☐ 36. Security headers and a single deployment target — `H-11`
**Files:** `vercel.json` / `netlify.toml` (delete one), `vite.config.js`
The repo ships **both** configs; `netlify.toml` has no `/api` handling, so deploying there silently returns `index.html` for `/api/*` and breaks both functions. Neither sets a single security header. `vercel.json`'s catch-all also has no `/admin` exclusion.
- Pick one target and delete the other (the handlers use the Vercel signature).
- CSP (Report-Only → tuned → enforced), HSTS, `X-Frame-Options: DENY` + `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- Explicit `/admin` rewrite matching the dev middleware.
- Immutable long-cache for `/assets/*`, `no-cache` for `index.html`.
**Edge cases:** CSP will break the QR generator, jsPDF canvas, `html2canvas` `crossOrigin` loads and Firebase websockets — run Report-Only through a full QA pass first; `img-src` must allow `data:`; `style-src` needs `'unsafe-inline'` until item 29 reduces the 2,169 inline styles.
**Verify:** securityheaders.com grade A; no CSP violations across every route including PDF generation and the portal; `/api/*` returns JSON on a real preview deploy.
**Effort:** ~1 day. **Depends on:** 29.

### ☐ 37. Append-only audit trail — `M-13`
**Files:** new `audit_log` collection + rules; server write paths; per-document history view
Nothing records who issued, edited, sent, signed or deleted a document. Edits overwrite in place.
- Actor uid, action, entity type/id, orgId, timestamp, IP, before/after diff.
- Written server-side; rules deny all client writes.
- Cover: document created/edited/sent/signed/declined/deleted; member added/removed/role changed; profile and bank-detail changes; admin actions; logins.
- Per-document history view. Retain 7 years for Indian statutory requirements.
**Effort:** ~4 days. **Depends on:** 4, 21.

### ☐ 38. Durable, resumable bulk jobs — `M-14`
**Files:** `src/components/bulk/*` (1,100+ lines)
No transaction, rollback or resume. A failure at item 40 of 100 leaves 39 documents issued and emailed, with no record of where it stopped.
- Persist the job with per-item status written **before** processing.
- Idempotent per-row processing so a resume never re-sends.
- Resume and retry-failed-only actions; per-item result table with downloadable errors.
- Rate-limit sends to respect Gmail limits and item 7's limiter.
**Verify:** kill the tab mid-job and resume cleanly.
**Effort:** ~4 days. **Depends on:** 7.

### ☐ 39. Rate limiting and abuse protection — `M-16`
**Files:** `api/email.js`, auth paths, portal endpoints; Firebase App Check
No rate limiting on email, auth, signup or the portal; no CAPTCHA. *(The AI endpoint is excluded from this plan.)*
- Per-IP and per-org limits (Upstash Redis or Firestore counters).
- Firebase App Check to block non-app clients.
- CAPTCHA or App Check on signup; rate-limit portal token verification against `jti` brute-force.
- Alerting on anomalous volume.
**Effort:** ~3 days. **Depends on:** 5, 7.

### ☐ 40. Dev/production parity — `M-15`
**Files:** `vite.config.js` (lines 30–65)
The hand-rolled `/api/email` shim with a fake `res` object means local development never exercises the real handler — including, after item 7, its authentication.
- Use `vercel dev` (or the chosen platform's local runtime) and delete the shim.
- If a shim must remain, have it import and invoke the real handler with a faithful req/res including auth.
- *(The `/api/nvidia` direct proxy at lines 67–81 is out of scope.)*
**Verify:** a request rejected in production is equally rejected locally.
**Effort:** ~1 day. **Depends on:** 7.

---

## Phase 6 — Documentation and polish

Independent of everything above; can be picked up any time.

### ☐ 41. Rename the package and adopt real versioning — `L-1`
**Files:** `package.json` (lines 2–4)
Named `qbitointern` at version `0.0.0`. Rename to `edgeos`; drive the version from a real release process.

### ☐ 42. Rewrite the README to match reality — `L-2`
**Files:** `README.md:19`
States "Backend / Auth: **Supabase**" — the app uses Firebase throughout. Document the real architecture, setup and environment variables.

### ☐ 43. Fix the broken README reference — `L-3`
**Files:** `README.md:44`
Points at "`walkthrough.md` in the brain directory", which does not exist. Remove it or write the actual schema documentation.

### ☐ 44. Relocate the stray root `SKILL.md` — `L-5`
**Files:** `SKILL.md`
A generic "frontend-design" AI skill file unrelated to this project sitting in the repo root. Move to `.claude/skills/` or delete.

### ☐ 45. Generate real PWA icons — `L-6`
**Files:** `public/manifest.json`, `public/`
The same 192px PNG is declared for both 192 and 512, and for `maskable`. Generate proper sizes and a real maskable variant.

### ☐ 46. Add a service worker or drop the PWA claim — `L-7`
**Files:** `public/manifest.json`, `src/main.jsx`
A manifest exists with no service worker registration. Either add one with offline shell caching (pairs with item 34) or remove the PWA claim.

### ☐ 47. Internationalization and multi-currency — `L-8`
**Files:** `src/App.jsx:487` and the financial components
`en-IN` and ₹ are hardcoded throughout. Add i18n and multi-currency if international sale is intended.

### ☐ 48. Move stale documentation into `docs/` — `L-9`
**Files:** `DESIGN_SYSTEM_AUDIT.md` (23 KB, repo root)
Move to `docs/` and verify it still reflects `src/index.css` after item 29.

---

## Dependency graph (critical path)

```
 1,2,3  ──────────────────────────────── independent, day 1
   │
   4 (rules) ──┬── 5 (portal) ──┬─────────────── 23 (IDs)
               ├── 6 (admin)    │
               ├── 7 (email) ───┼── 38, 39, 40
               └── 21 (RBAC) ───┤
                     │          │
   8 (XSS) ──────────┼──────────┤   independent
   9 (backups) ──────┤          │
                     │          │
  10 (tests) ──┬── 11 (lint)    │
               ├── 12 (pdf) ── 13 (deps)
               └── 14 (errors) ── 15 (error policy)
                        │
  16 (onboarding)       │
                        │
  17 (one truth) ── 18 (per-org store) ──┬── 19 (switcher)
        │                                ├── 26 (pagination)
   20 (TS) ── 22 (validation)            └── 32 (subscriptions)
   24 (images) ──┘
   25 (notifications)
                        │
  27 (shell split) ──┬── 28 (code split)
                     └── 30 (SEO)
  29 (CSS) ──┬── 33 (a11y) ──── 31 (zoom)
             └── 36 (headers)
  34 (offline)
                        │
  35 (payments) ── 37 (audit log)
                        │
  41–48 (docs) ──────────── independent
```

---

## Summary

| Phase | Items | Duration | Exit criteria |
|---|---|---|---|
| **0** Immediate | 1–3 | 1 day | Crash fixed, admin surface closed |
| **1** Data safety | 4–9 | 3 weeks | Tenant isolation enforced server-side; backups tested |
| **2** Correctness | 10–16 | 3 weeks | Tests + CI green; zero lint errors; errors observable |
| **3** Architecture | 17–26 | 3 weeks | One source of truth; RBAC; validation; typed |
| **4** Performance | 27–34 | 2 weeks | Code-split, indexed, accessible, real-time |
| **5** Business | 35–40 | 3 weeks | Enforced billing, audit trail, abuse protection |
| **6** Polish | 41–48 | ongoing | Documentation matches reality |

**Total: 48 items, ~14 weeks.**

Items **1, 2, 8, 41–48** have no prerequisites and can start immediately alongside anything else.
