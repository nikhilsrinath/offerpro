# Opstead — The Complete Project Guide

> One document that explains Opstead from end to end: what it is, the tech stack, how the pieces fit together at runtime, every module and page, the data layer, the serverless API, the AI agent, the database and security model, the design system, and how to run, test and deploy it.
>
> Written 2026-10-19 against `main` @ `46653c6`. The older, file-by-file map is `CODEBASE_OVERVIEW.md` (2026-09-25). URLs and the navigation have changed since then, and this guide follows the current code. Sizes are approximate: about 105k lines of JS/TS across `src/` and `api/`, 88 migrations, 42 unit-test files and 20+ SQL test suites.

---

## Contents

1. [What Opstead is](#1-what-edgeos-is)
2. [Tech stack](#2-tech-stack)
3. [Repository layout](#3-repository-layout)
4. [Architecture: how it works end to end](#4-architecture-how-it-works-end-to-end)
5. [Request lifecycles (worked examples)](#5-request-lifecycles-worked-examples)
6. [Navigation, routing and the app shell](#6-navigation-routing-and-the-app-shell)
7. [Feature modules](#7-feature-modules)
8. [EdgeAI (the agent) and EdgeBrain (the knowledge graph)](#8-edgeai-the-agent-and-edgebrain-the-knowledge-graph)
9. [Client data layer (`src/services`, `src/shared`)](#9-client-data-layer-srcservices-srcshared)
10. [Serverless API (`api/`)](#10-serverless-api-api)
11. [Database (`supabase/`)](#11-database-supabase)
12. [Security model](#12-security-model)
13. [Design system and UI conventions](#13-design-system-and-ui-conventions)
14. [Plans, quotas and metering](#14-plans-quotas-and-metering)
15. [Running locally](#15-running-locally)
16. [Testing](#16-testing)
17. [Build, deploy, backups](#17-build-deploy-backups)
18. [Known caveats and loose ends](#18-known-caveats-and-loose-ends)
19. [Where to look for X](#19-where-to-look-for-x)
20. [Glossary](#20-glossary)

---

## 1. What Opstead is

Opstead is a **multi-tenant, all-in-one back office for small Indian companies**. One sign-in gives a company:

| Area | What it covers |
|---|---|
| **Today & Ask** | A daily briefing built from the company's own records, and a full-page AI copilot |
| **Dashboard** | Analytics by area: Projects, Finance, Sales & Marketing, Team, Documents, AI Usage |
| **Projects** | Client and internal projects. Each has its own workspace covering finance, WBS/Gantt/Kanban planning, team, RACI, clients, vendors, documents, milestones and activity. Also timesheets and a portfolio view. |
| **Finance** | Quotations, proforma, invoices, recurring invoices, the General Ledger (cash book), the Company Ledger (vendor bills and payments), GST tax summary, P&L, and a finance status pipeline |
| **Business** | Client directory, vendor directory, products/services catalogue, CRM pipeline |
| **Company** | Org-chart hierarchy, employee registry (with Employee IDs), attendance and leave, announcements, recruitment tracker |
| **Documents** | Document library that the AI can read, offer letters, certificates, agreement templates (NDA, MoU, partnership, custom) on the company letterhead, and issued records |
| **EdgeBrain** | A SQL-derived knowledge graph of the company that grounds AI answers |
| **Portals** | A token-gated **recipient portal** (sign, accept, pay, with no account needed) and a self-service **employee portal** |
| **Platform console** | `/admin`: a cross-tenant operator console for plans, org lifecycle and mail |

Plans are tiered **Free / Pro / Max** with quotas on documents, AI messages, active projects and some features.

**Naming leftovers:** the npm package is still `qbitointern` and `README.md` still says "OfferPro". Both predate the Opstead name. `/api/nvidia` is actually Gemini.

---

## 2. Tech stack

| Layer | Choice | Notes / where |
|---|---|---|
| UI framework | **React 19** + **React Router 7** | `src/main.jsx`, `src/App.jsx` |
| Build / dev server | **Vite 7** + `@vitejs/plugin-react` | `vite.config.js` also runs `api/*` in-process on localhost |
| Language | JavaScript/JSX, with TypeScript in a few AI/task files (`*.ts`) | no TS build step; Vite strips types |
| Styling | Plain CSS + JS design tokens (no Tailwind) | `src/index.css`, `src/theme/*`, `shell/edgeBridge.css`, `hub/hub.css`, `assistant/copilot.css` |
| Font | Inter (Helvetica fallback) | `theme/surface.css` |
| Icons / motion | `lucide-react`, `framer-motion` | throughout |
| Charts | `recharts` + a hand-rolled SVG kit | `overview/vizKit.jsx`, `overview/dashKit.jsx`, `hub/widgets.jsx` |
| Graph canvases | `@xyflow/react` (org chart), custom SVG (EdgeBrain graph, Gantt) | `TeamHierarchy.jsx`, `brain/KnowledgeGraph.jsx`, `projects/pm/GanttPage.jsx` |
| PDF | `jspdf` + capture of the live A4 preview | `services/pdfService.js`, `shared/A4Stage.jsx` |
| Spreadsheets | `xlsx` | CSV/XLSX import & export (bulk import, attendance, ledgers) |
| File reading | `unpdf` (PDF text), `fflate` (unzip DOCX/PPTX/ODF) | `api/_lib/libraryExtract.js` |
| Misc UI | `qrcode.react` (UPI QR), `react-signature-canvas` | `shared/UPIQRGenerator.jsx`, `shared/SignatureCapture.jsx` |
| Backend | **Supabase**: Postgres + Row-Level Security, Auth, Storage, Realtime | `supabase/`, `src/lib/supabase.js` |
| Serverless | **Vercel functions** (Node) | `api/*.js` |
| Email | **Nodemailer** over each org's own Gmail SMTP (app password, AES-256-GCM encrypted) | `api/email.js` |
| AI model | **Google Gemini** (`GEMINI_API_KEY`), model `gemini-3.6-flash` by default (override with `GEMINI_MODEL`). Every call goes through `api/_lib/llm.js`; the browser cannot choose the model | `api/_lib/llm.js`, used by `api/_lib/agent/model.js`, `api/brain.js`, `api/library.js`, `api/nvidia.js` |
| Unit tests | **Vitest** | `vitest.config.js` |
| DB tests | Plain-Postgres SQL tests in Docker | `supabase/tests/`, `scripts/run-db-tests.sh` |
| Lint | ESLint 9 (react, react-hooks, react-refresh) | `eslint.config.js` |
| Map data (dev only) | `d3-geo`, `topojson-client`, `world-atlas`, `i18n-iso-countries` | `scripts/generate-world-map.js` → `src/data/worldMap.js` |
| CI | GitHub Actions | `.github/workflows/backup.yml` (weekly encrypted backup) |

---

## 3. Repository layout

```
EdgeOs/
├── api/                        Vercel serverless functions
│   ├── agent.js                EdgeAI agent (SSE chat + confirm/cancel/undo)
│   ├── brain.js                EdgeBrain build/sync/search/ask
│   ├── library.js              Document library upload → Markdown → chunks
│   ├── email.js                Send mail via the org's Gmail
│   ├── org-secrets.js          Store the Gmail app password (encrypted)
│   ├── portal.js               Recipient portal's only door (token-gated)
│   ├── portal-token.js         Mint signed portal links
│   ├── export.js               Full tenant JSON export
│   ├── admin.js                Platform console actions
│   ├── nvidia.js               Co-founder chat proxy to Gemini (name is historical)
│   └── _lib/                   auth, crypto, portal tokens, AI usage, brain retrieval,
│       └── agent/              the agent runtime (registry, tools/, loop, pipeline, executor…)
├── src/
│   ├── main.jsx                React root + BrowserRouter
│   ├── App.jsx                 All routes, module config, shell selection, redirects (MOVED)
│   ├── index.css               Global stylesheet (legacy + page styles)
│   ├── components/
│   │   ├── *.jsx               Top-level pages (Auth, Registration, Hub, forms/previews, CRM, Employees…)
│   │   ├── admin/              Platform console
│   │   ├── agreements/         Templates gallery, partnership/custom agreement form + preview
│   │   ├── assistant/          EdgeAI copilot: context, cards, voice call, markdown
│   │   ├── brain/              EdgeBrain page, graph, dock
│   │   ├── bulk/               Bulk offers / certificates / team import
│   │   ├── financial/          Finance pages (billing, ledgers, tax, P&L…)
│   │   ├── hub/                Hub widget board (catalog, widgets, layout, drill)
│   │   ├── landing/            Marketing sub-pages
│   │   ├── library/            Document Library
│   │   ├── overview/           Dashboard pages + vizKit/dashKit + overviewModel
│   │   ├── people/             Attendance, leave, announcements, departments
│   │   ├── portal/             Recipient portal, employee portal (me/), /join
│   │   ├── projects/           Projects list, Kanban, Portfolio, Timesheets, project workspace
│   │   │   ├── pm/             Portfolio overview, WBS, Gantt
│   │   │   ├── team/           RACI, project attendance, project announcements
│   │   │   ├── parties/        Project clients, vendors, communication, payments
│   │   │   └── docs/           Project files, custom templates
│   │   ├── settings/           Roles & permissions, join code, access role picker
│   │   ├── shared/             Reusable pieces (A4Stage, pickers, signature, toast, confirm…)
│   │   ├── shell/              ModuleShell, MobileNav, modules.js, rail pin/slot
│   │   ├── tasks/              Task board + modal
│   │   ├── today/              Today page, Ask page, todayModel
│   │   └── ui/                 The "edge" component kit (edge.jsx, edgeUtils.js)
│   ├── context/                AuthContext, OrgContext
│   ├── hooks/                  Theme, plan status, speech, pan-zoom, deadline monitor, leave guard…
│   ├── lib/                    Supabase client, auth errors, profile completion
│   ├── services/               Data + domain logic (orgStore, documentStore, projects, finance…)
│   ├── shared/                 Pure domain code shared by browser AND server (cashIntent, dates, finDocs…)
│   ├── theme/                  edge.js tokens, EdgeTheme context, surface.css
│   ├── data/                   indianStates, dialCodes, worldMap (generated)
│   └── utils/                  htmlEscape, imageUtils, imageAdjust, titleCase
├── supabase/
│   ├── migrations/             0001 … 0088
│   ├── checks/                 Preflight SQL to compare live with repo before risky migrations
│   ├── pending/                Not-yet-applied migrations
│   ├── tests/                  SQL RLS/feature tests + expected output
│   └── config.toml
├── scripts/                    DB test runner, agent evals, admin setup, map/country generators, Firebase ETL
├── docs/                       NAVIGATION.md, projects.md, edgeai-agent.md, RUNBOOK-restore.md, phase-0/
├── public/                     Logo, icon, PWA manifest
├── .github/workflows/          backup.yml
├── vite.config.js · vitest.config.js · eslint.config.js · vercel.json · netlify.toml
└── .env / .env.example
```

---

## 4. Architecture: how it works end to end

```
┌──────────────────────────── Browser (React SPA) ─────────────────────────────┐
│ AuthProvider ── Supabase Auth (email/password, Google OAuth)                  │
│ OrgProvider  ── memberships → active org → orgStore.load(orgId)               │
│   orgStore: in-memory cache of every org "section" (≈ one Postgres table),    │
│             localStorage mirror for instant paint, Realtime listeners         │
│ Pages read orgStore synchronously; writes go straight to Supabase (RLS)       │
│ AssistantProvider ── EdgeAI chats; turns stream from /api/agent               │
│ Privileged calls → fetch('/api/…', Authorization: Bearer <access token>)      │
└──────────────┬───────────────────────────────────────┬───────────────────────┘
               │ supabase-js (anon key + user JWT)     │ /api/* (user JWT)
               ▼                                       ▼
┌──────────── Supabase ─────────────┐   ┌────────── Vercel functions ───────────┐
│ Postgres                          │   │ requireUser / requireOrgRole /        │
│  • tenant tables, RLS everywhere  │◄──┤ requirePlatformAdmin (_lib/auth.js)   │
│  • policies read role_permissions │   │ supabaseAdmin(): service role (only   │
│    + member_permissions           │   │   where unavoidable)                  │
│  • schema `app`: guards, triggers,│   │ Agent writes run AS THE USER (their   │
│    numbering, totals, EdgeBrain   │   │   JWT) so RLS still applies           │
│ Auth · Storage buckets · Realtime │   │ Gmail SMTP · Gemini · HMAC tokens ·   │
└───────────────────────────────────┘   │ AES-GCM secrets                       │
                                        └───────────────────────────────────────┘
```

### Design principles (stated throughout the code)

1. **The database is the authority.** RLS policies and `app.*` triggers decide who may do what and keep derived values right: document numbers, totals, `amount_paid`, project codes, allocation caps, closed-project locks. The UI only mirrors those rules so its controls don't lie. `orgStore.can()` is for showing and hiding controls only.
2. **No secrets in the browser.** The Gmail password, portal HMAC key, Gemini key and service role live server-side. `anon` has no table grants, so the public recipient portal goes through `/api/portal`.
3. **Derived, not duplicated.** Finance and dashboard figures are pure functions over recorded rows (`financeAnalytics.js`, `overviewModel.js`, `todayModel.js`). EdgeBrain is a SQL projection of the tables. Revenue by country is aggregated in Postgres.
4. **The AI must not bluff.** Answers come from real data with counts and provenance. The model understands the request, and code only parses values or fills blanks, with no trigger-word routing. Every AI write is **proposed** as a card and runs only when the user confirms it, as that user.
5. **Idempotent, additive migrations.** New columns are optional, and the app sends them only when filled, so a database that lags the repo keeps working for everything else.

---

## 5. Request lifecycles (worked examples)

### 5.1 Sign-up → first screen

1. `/signup` → `Registration.jsx` asks for credentials, company, signatory and one line of AI context.
2. `OrgContext.createOrganization` → `services/orgProvisioning.js` → RPC **`create_organization`**. One transaction seeds the org, owner membership, a department, the founder as an employee, settings, subscription, usage counters, banking and the role-permission rows.
3. `AuthContext` sees the membership and `OrgContext` sets the active org. `orgStore.load(orgId)` hydrates every section the caller is allowed to read and subscribes to Realtime.
4. `AppContent` asks `meService.getMyRole()`. **Employees** get the Employee Portal. Everyone else gets the workspace (`/hub`).

### 5.2 Creating an invoice

1. Finance › Billing › Invoices › New (`/finance/billing/invoices/new`, or inside a project: `/projects/:id/finance/billing/invoices/new`).
2. `InvoiceForm.jsx` handles line items (`shared/LineItemsEditor.jsx`), catalogue items (`ProductPicker`), client (`ClientProjectSelect`), GST: CGST+SGST vs IGST by place of supply (`data/indianStates.js`), and a UPI QR.
3. Save → `orgStore.saveFinDoc` writes `financial_documents` + `document_line_items`. Postgres assigns the number through `next_document_number()` (e.g. `INV-001`), recomputes totals (`app.recompute_document_totals`) and, when the invoice came from a project, milestone or recurring template, allocates it to the project.
4. Send → `/api/portal-token` mints a signed link, and `/api/email` mails it through the org's Gmail (rate-limited by `claim_email_quota`).
5. The client opens `/portal/:id?token=…` and confirms payment. `/api/portal` applies `payment_confirmation` under the service role, scoped to that one document, and writes a notification.
6. Recording the payment (`documentStore.recordPayment`) inserts into `payments`. SQL recomputes `amount_paid` and derives `paid` / `partially_paid`. `useTaskDeadlineMonitor` → `invoiceReminderService.runCheck()` flags overdue invoices and sends up to 3 reminders, 7 days apart.

### 5.3 Paying a vendor bill

The Company Ledger (`/finance/company-ledger`) holds a bill with subtotal, GST, an optional **other amount** with its own GST (0086), and **round off** (0079). "Record payment" creates a **locked Cash Out entry** in the General Ledger linked to the bill (0080), so the money appears under Money out exactly once. The bill's paid state is derived from those entries.

### 5.4 Asking EdgeAI to do something

1. The user types "Invoice Acme ₹50,000 for the website, due next Friday" in the copilot (dock, full-screen, or `/ask`).
2. `AssistantContext` → `agentService.streamAgent` → `POST /api/agent` (`mode:'chat'`, SSE).
3. The server builds context: user, role, `my_permissions`, plan, today in the org's timezone, current page, recent entities, and EdgeBrain facts as `<data>`. It runs the model (Gemini) with **function calling** over only the tools this user may use, for up to 8 steps.
4. Read tools (`search`, `list_invoices`, `finance_summary`, `ask_brain`…) run immediately. A write tool (`create_invoice_draft`) **resolves names to records, never guessing** (`resolvers.js`). It then stores a proposal in `ai_actions` and streams an **action card**.
5. The user taps **Confirm** (or Ctrl/⌘+Enter). `executor.js` applies the plan **with the user's own JWT**, with optimistic concurrency, so RLS and every SQL guard apply. `audit_log` rows are stamped `via = 'edgeai'` with the `ai_action_id`.
6. The receipt card offers **Undo** for 10 minutes and **Open**. AI usage is metered once per user message (`bump_ai_usage`, `ai_usage_events`).

### 5.5 Uploading to the Document Library

`/documents/document-library` → `POST /api/library`. The server reads the file into one Markdown document (PDF via `unpdf`, Office/ODF via `fflate`, sheets via `xlsx`, images and scanned PDFs via the Gemini model, metered). It cuts that into passages in `library_chunks` (full-text indexed) and files it under a register: General, Process assets or Lessons learned (0069). EdgeBrain turns each file into a `library_document` node, and the copilot's context gets ranked passages via `library_search`.

---

## 6. Navigation, routing and the app shell

### 6.1 Shells

- **Hub sidebar everywhere.** Every module page keeps the hub's own sidebar with the current module highlighted. The module's pages are **tabs across the top** (`ModuleShell` `topNav`).
- **Sidebar groups** (`shell/modules.js` → `RAIL_GROUPS`):
  - **Main menu:** Today · Ask · Dashboard · Projects · Finance · Business
  - **Features:** Company · Documents · EdgeBrain
- **Project workspace.** Inside `/projects/:id` the sidebar becomes that project's sections, with "Back to projects" at the top.
- **Back buttons.** The only back links are *Back to hub* and *Back to projects*.
- **Phone.** `MobileNav.jsx` is a bottom bar with the same modules; the rest sit under *More*.
- **Employee role.** These users never see the workspace; every URL renders the Employee Portal.

### 6.2 URL scheme: module-first, mirroring the sidebar

| Module | Pages (URL) |
|---|---|
| — | `/hub`, `/today`, `/ask`, `/profile`, `/me` |
| Dashboard | `/dashboard/projects` (default), `/dashboard/finance`, `/dashboard/sales`, `/dashboard/team`, `/dashboard/documents`, `/dashboard/usage` |
| Projects | `/projects`, `/projects/new`, `/projects/tasks`, `/projects/kanban-chart`, `/projects/portfolio`, `/projects/timesheets`, `/projects/:id/...` |
| Finance | `/finance/finance-status`, `/finance/general-ledger`, `/finance/billing/{quotations,proforma,invoices,recurring}` (+ `/new`, `/:id/edit`), `/finance/company-ledger`, `/finance/tax-summary`, `/finance/profit-loss` |
| Business | `/business/client-directory`, `/business/vendor-directory`, `/business/products-directory`, `/business/crm` |
| Company | `/company/company-hierarchy`, `/company/employees[/:tab]`, `/company/employees/new`, `/company/attendance[/:tab]`, `/company/announcements`, `/company/recruitment-tracker` |
| Documents | `/documents/document-library[/:register]`, `/documents/offer-letters[/:tab]`, `/documents/certificates[/:tab]`, `/documents/templates`, `/documents/templates/{nda,mou,partnership,custom}`, `/documents/records` |
| EdgeBrain | `/edgebrain` |

- A bare module path (`/finance`, `/company`…) lands on its first page.
- **Old URLs still work.** `MOVED` in `App.jsx` maps every previous path (`/cashbook`, `/invoices`, `/employees`, `/library`, `/purchases`…) to its current one, keeping query and hash.
- Unknown workspace URLs redirect to `/hub`.

**Inside a project** (`projects/projectPaths.js` → `SECTION_PATHS`), the path follows the project's sidebar group › page › view:

```
/projects/:id                               → /projects/:id/dashboard/overview
/projects/:id/dashboard/:view               overview | finance | sales | team | documents
/projects/:id/finance/status | general-ledger | billing/<kind>[/new|/:doc/edit] | company-ledger | tax-summary | profit-loss
/projects/:id/project-management/portfolio-overview | tasks-wbs | kanban-board | gantt-chart | sku
/projects/:id/team-management/team-members | team-hierarchy | attendance | announcements
/projects/:id/client-management/client-directory | crm | client-communication | payment-status
/projects/:id/vendor-management/vendor-directory
/projects/:id/documents-management/project-documents[/business-documents|general-documents] | custom-templates
/projects/:id/milestones · /projects/:id/activity
```

Older `?tab=` links are rewritten into these paths by `ProjectDetail`.

### 6.3 Public routes (outside the workspace)

| Path | Page |
|---|---|
| `/` (signed out) | Marketing landing page |
| `/login`, `/signup` | `Auth.jsx`, `Registration.jsx` |
| `/join?t=…` / `?c=…` | `portal/JoinPortal.jsx` (employee invite / join code) |
| `/portal/:documentId?token=…` | `portal/RecipientPortal.jsx` |
| `/admin/*` | Platform console (its own sign-in) |
| `/pricing`, `/privacy`, `/terms`, `/security`, `/ai-cofounder`, `/invoicing`, `/offer-letters`, `/legal-documents`, `/certificates`, `/documentation`, `/support`, `/changelog` | Marketing sub-pages (`landing/subPageData.js`) |

### 6.4 `AppContent` gate order

1. Loading → spinner.
2. No user → `/login`, `/signup`, else the landing page.
3. User without membership → `Registration` (Google onboarding).
4. Resolve the role → `employee` gets the `EmployeePortal`.
5. Otherwise render the route inside `ShellFrame` → `ModuleShell`, wrapped in `AssistantProvider`, with the global AI launcher. `useTaskDeadlineMonitor()` runs here; it covers task deadlines and overdue-invoice reminders.

---

## 7. Feature modules

### 7.1 Hub (`Hub.jsx`, `hub/`)

The home screen. Its header carries the company name, and the body is a **customisable widget board**:

- `widgetCatalog.js` defines the widgets and default layout.
- `widgets.jsx` / `projectWidgets.jsx` render them.
- `useHubData.js` reads live orgStore data plus the geo RPC.
- `useWidgetLayout.js` handles add, remove, resize and move by menu, keyboard or drag, saved per viewer.
- `WidgetDrill.jsx` / `HubActivity.jsx` are drill-downs.

Widget groups: Projects (health, budget burn, margin, utilisation, tasks), Finance (revenue, expenses, net cash, cash flow, receivables, payables, per-head, gross profit, ARR), Sales & Markets (geography map, top markets, pipeline, S&M spend), People (team, people by location), Documents, EdgeBrain, Activity, Shortcuts. Many widgets take a 1/3/6/12-month period (`hub/periods.js`). Clicking a widget opens its page.

### 7.2 Today and Ask (`today/`)

- **Today** (`/today`). `todayModel.js` is a pure function from live lists (plus the hub's money figures, so numbers agree with the tiles) to the page's sections: overdue invoices, bills due, late tasks and milestones, leave waiting for approval, and so on. Every line is one record or a count of records and links to where it lives. Nothing is sampled. Tested in `todayModel.test.js`.
- **Ask** (`/ask`). The copilot as a full page (`AskPage.jsx` wraps `Copilot` in its page variant), with an **Ask | Agents | Connectors** switch. Connectors is empty for now.
- **Agents** (`/ask?view=agents`, an agent at `/ask?agent=<id>`; `components/agents/`). Agents are added one at a time. The first is **Compliance and Deadline Agent** (`DeadlineWatch.jsx`). It lists overdue and coming-due tasks, milestones, invoices and vendor bills by severity, each with a next action, Open and Ask. Beside the list is `AgentChat` (exported from `Copilot.jsx`), the agent's own EdgeAI conversation on the same runtime. Owners and admins also get Settings, Run Now and Recent Runs.
  - Rules: `src/shared/deadlineWatch.js` (pure, tested; severity is never decided by the model). Server: `api/_lib/deadlines.js` (load per org, the alerting run, the email digest). EdgeAI tool: `deadline_watch`. Endpoint: `/api/agents`. Storage: 0089.
  - Scheduling: a Vercel Cron (`vercel.json`, 02:30 UTC = 08:00 IST) calls `GET /api/agents` with `Authorization: Bearer $CRON_SECRET`. It runs only for orgs whose admin switched on **Daily Run**. Each run's key is the org's date, so a second trigger does nothing; a failed run is retried by the next trigger. Alerts go to owners and admins as in-app notifications (type `deadline_watch`, linking to the agent), plus an email digest through the org's Gmail when switched on. `agent_alerts` stops the same unresolved item being sent again before `repeat_days`.
- The second agent is **Business Intelligence** (`BusinessIntel.jsx`, `/ask?agent=business_intelligence`). Read-only. For a chosen period (this month, last month, this quarter, last 30 days, this FY) against the previous period or the same dates last year, it shows: money (revenue net of GST, invoiced, collected, expenses, P&L net, net money movement); what is owed today (receivables with aging, payables); "Needs Attention" findings, each with its evidence, why it matters and a suggested next step; work and people counts; and the biggest expenses and who owes most. Its `AgentChat` is told it is the BI chat (`context.agent`) and is read-only by default.
  - Figures: `src/shared/bizIntel.js` (pure, tested). It never defines a figure of its own: P&L and money in/out come from `src/shared/financeReports.js` (moved out of `services/financeAnalytics.js`, which re-exports it), receivables from `finDocs.js`, overdue milestones from `deadlineWatch.js`, and project health from `project_portfolio` (0053). A period in progress is compared like for like (1–19 Oct against 1–19 Sep). There is no percentage from zero or across a sign change. A figure whose tables the caller cannot see, or that failed to load, is null (`NEEDS`), never zero.
  - Server: `api/_lib/bizIntel.js` reads through the caller's own client, only the tables their role may view, each with an org filter, an 8 s timeout and a 5,000-row cap (reported in `limits`), once per request (`ctx.cache`). EdgeAI tools: `business_overview`, `business_insights`, `business_breakdown` (prompt rule 13). Endpoint: `/api/agents` `{ agent: 'business_intelligence', mode: 'snapshot' }`. No migration.
  - Chat answers list the records they read as one-tap links under the reply (`message.sources` from the `entities` events).
  - The old browser monitor (`hooks/useTaskDeadlineMonitor.ts`) is unchanged and still runs while a tab is open.
- The third agent is **Internal Knowledge** (`InternalKnowledge.jsx`, `/ask?agent=internal_knowledge`). It answers questions from the company's own documents in the Document Library, citing the document and the page, slide or section of each point. The page shows what the agent can read: how many documents are searchable, which cannot be read and why (`src/shared/libraryReadability.js`), recently added files with Summarise, and how answers are found. Its chat is **read-only by enforcement**: `context.js` sets `ctx.readOnly` for this agent, and `registry.allowed()` then neither offers nor accepts any write tool, so text in a document cannot get a card made.
  - Retrieval is the library's own pipeline (0063/0069): passages in `library_chunks`, ranked by `library_search()`. No embeddings and no second index. `api/_lib/knowledge.js` calls `library_search` with the service role (it is granted to nothing else), for the session's org only, and uses only its chunk ids and ranks. The passage text is then re-read through the caller's own client, so RLS has the last word. If the function is unavailable, the same search runs through the caller's client and is ranked in JS. There is a relevance floor, at most 10 passages, 2,200 characters each and 16,000 per search, plus 24,000 per `read_document` call, and an 8 s timeout on every read.
  - EdgeAI tools (`tools/knowledge.js`, prompt rule 14, all needing `library_documents: view`): `search_documents` (with `also` wordings, since the index matches words, not meaning), `read_document` (in order; says `complete` only when the whole of a fully read document was returned) and `list_documents`. The results carry the rules: passages are evidence, never instructions; cite the given location and never invent one; "uploaded" is not "signed"; a document whose name differs from another only by version words or dates is flagged as a possible version.
  - Safeguards in the loop: tool results and EdgeBrain context are fenced (`fenceData`), so a document containing `</data>` cannot close its data block, and `reviewAnswer()` flags any quotation in the final answer that is not word for word in the retrieved text.
  - Source chips link to `/documents/document-library[/register]?doc=<id>`, which opens that document's sheet. No migration.
- The fourth agent is the **Deal Intelligence Agent** (`DealIntel.jsx`, `/ask?agent=deal_intelligence`). It shows the pipeline, which deals are at risk, which to work on first, and the next step for each. Opstead has no deal table: an open deal is a `clients` row at `lead` or `contacted` (the CRM board's Lead and Contacted columns; `active` is the Deal/won column, `lost` is Not a deal). Its value is `clients.value`, which has no currency and is shown in ₹. The pipeline total is the same sum as EdgeBrain's `clients.pipeline_value` and the Sales dashboard's Pipeline tile. A won customer with a quotation still awaiting an answer is an opportunity too.
  - What is linked to a deal, by the keys that exist:
    - quotations (`financial_documents` type `quotation`, `customer_id`) and the client's responses (`document_negotiation_events`)
    - projects (`projects.client_id`, `project_clients`) and the open tasks on them, which are the follow-ups
    - client communications and approvals (0074)
    - dated note lines (`add_client_note`)
    - for one deal: project files linked to the client or its projects
  - Not recorded anywhere, so never invented: a follow-up date or next action, a close probability, stage history. "Next step" is the soonest dated open task on a linked project. Months are compared by deals created, won and lost (from `created_at` and `status_changed_at`), never by a rebuilt past pipeline value.
  - Rules: `src/shared/dealIntel.js` (pure, tested in `dealIntel.test.js`). Each risk has a severity, a certainty (`confirmed` from the records, or `possible` from an absence), the evidence, the rule text with its thresholds, a next step and the records to open. The categories are:
    - overdue follow-up
    - client waiting on us (changes requested)
    - quotation past validity
    - quotation validity ending
    - quotation unanswered
    - approval waiting
    - stage conflicts with records
    - (high-value) inactive
    - no next step (claimed only when tasks, quotations, approvals and projects were all read)
  - Priority is a transparent points score (`SCORING`), and its reasons add up to it. Ranking is deterministic.
  - Thresholds (`DEFAULT_CONFIG`) can be overridden per question (`stale_days`, `quote_wait_days`, `horizon_days`). They are not stored settings.
  - Server: `api/_lib/deals.js` reads through the caller's own client with `bizIntel.loadSources` (an org filter, an 8 s timeout and a 5,000-row cap on each read, once per request). A table missing on the database (0074 on live) is `missing`, which means nothing is recorded there; that is kept apart from `failed`.
  - EdgeAI tools: `tools/deals.js`, prompt rule 15, all reads needing `clients: view`. They are `deal_pipeline`, `deal_list`, `deal_risks`, `deal_priorities` and `deal_detail`.
  - Endpoint: `/api/agents` `{ agent: 'deal_intelligence', mode: 'snapshot' }`.
  - The chat is read-only by default, not by enforcement. A follow-up task or note is proposed only when asked, through the usual cards. `create_task` refuses an open task with the same title on the same project, and `add_client_note` refuses the same note on the same day; both checks run at proposal and again at confirm.
  - No migration.

### 7.3 Dashboard (`overview/`)

Six pages: `ProjectsDash`, `FinanceDash`, `SalesDash`, `TeamDash`, `DocumentsDash`, `UsageDash`. They share `useOverviewModel.js` → `overviewModel.js`, a pure model for periods, buckets, ageing, collections, expense and document events, and drill-downs (`customerDetail`, `categoryDetail`, `productDetail`, `departmentDetail`…). Clicking any figure opens `Drilldown.jsx`. Charts come from `vizKit.jsx` (Columns, Area, RankBars, SplitBar, Funnel, CalendarHeat, Spark, Gauge…). Layout uses `dashKit.jsx` (Card, Tile, Figure, CardGrid, ArrangeBar) in a bento layout. The world map lazy-loads `data/worldMap.js` and is fed by the `sales_by_country()` RPC.

### 7.4 Projects (`projects/`) — see also `docs/projects.md`

A project is **client work** (has a client) or **internal**. It has a type, a product/service flag, budget, billing type (Fixed price / T&M / Retainer / Others), team, milestones, tasks, money links and documents.

| Page | What it does |
|---|---|
| `ProjectsPage` | List and board. Filters for status, client, manager, *My projects*, archived. Contract and margin columns only for users with `project_financials.view`. Pinned projects. |
| `KanbanChart` | Every project by status (Not started / In progress / On hold / Ended / Past due) |
| `Portfolio` | Health, margin and utilisation across projects. CSV export. Pro+. |
| `Timesheets` + `WeekGrid` | Weekly hours per person and project, submit week, approval queue (`decide_timesheets`; you can never approve your own). Max plan. |
| `TasksPage` | All tasks on a board or list (`services/taskStore.ts`) |
| `ProjectForm` | Create/edit. Prefills from `?fromQuotation=` or `?client=`. Milestone templates (30/70, 50/50, monthly retainer). |
| `ProjectDetail` | The project workspace (below) |

**Project workspace sections**

- **Overview dashboard.** A customisable widget board (`projectOverviewWidgets.jsx`, dashKit tiles) with contract, billed, collected, cost to date, net margin, health, open tasks, team, activity, and **Needs attention**: open tasks an admin starred as important (0077).
- **Dashboard views.** Overview · Finance · Sales · Team · Documents.
- **Finance** (financial users only):
  - Financial Status (P&L from RPC `project_financials`, allocate existing entries, invoice unbilled hours)
  - General Ledger: the project's money in/out, with Record Money in Type › Sub-Type steps (`LedgerTypePicker`)
  - Billing (quotations / proforma / invoices / recurring)
  - Company Ledger (vendor bills and payments)
  - Tax Summary
  - P&L
- **Project Management:**
  - Portfolio overview (% complete, overdue, forecast finish, critical path)
  - **WBS** with sub-projects and nesting (0072/0083)
  - **Kanban board**
  - **Gantt** with dependencies and reschedule
  - SKU
- **Team Management** (0073):
  - Team members (allocation, end membership, never delete)
  - **RACI** / team hierarchy, with nesting
  - Project attendance and leave
  - Project announcements
- **Client Management** (0074):
  - Client directory
  - CRM
  - Client communication: approvals, plus channels (email, phone, WhatsApp, meeting, other) (0085)
  - Payment status & pendings
- **Vendor Management.** Vendors on the project with contract value, scope and bank details (hidden until revealed). A vendor can belong to several projects (0083).
- **Documents Management:**
  - Linked business documents
  - Project files with folders, versions and restore, tags and visibility
  - Custom templates (generate as PDF/Word; "Other" type; print on letterhead — 0084)
- **Milestones.** Billing % or amount; **Create invoice** from a milestone, which the DB links and allocates.
- **Activity.** The audit log for the project.

**Money model.** Ledger entries, invoices and bills are linked to projects through **allocations** (`project_allocations`). An allocation is either full or split. Caps and exclusivity are enforced in SQL (`app.allocation_source`, RPC `set_project_allocations`, one transaction). Labour cost comes from timesheets or allocation (`app.project_labour_cost`, `projects.cost_method`). Salary figures never leak to non-financial users; a SQL test checks this. Closed projects are locked except through owner/admin **reopen**. Project codes follow `PRJ-YYYY-NNN`.

### 7.5 Finance (`financial/`, `InvoiceForm.jsx`)

| Page | Notes |
|---|---|
| Finance Status | Every quotation, proforma and invoice as a pipeline or list. Ageing buckets, payment position cards, portal-link copy. |
| **General Ledger** (`CashBook.jsx`) | Money in (`income_entries`) and out (`expenses`) that no invoice or bill covers, by project or General. Records category, GST rate, place of supply, payment method (incl. **RTGS**, 0088), currency/FX, country and receipt. Bill payments appear as locked rows. CSV export. |
| **Billing** (`CompanyBilling.jsx` → `InvoiceList.jsx`) | One page with Quotations / Proforma / Invoices / Recurring tabs. Status changes, record payment, portal links, reminders, conversions quotation → proforma → invoice (`ConvertDialog`). The Project column is always shown. |
| Quotation / Proforma / Invoice / Recurring forms | Per-line GST on quotations (0086). GST defaults to 0%. Catalogue rule on invoices. Revisions and validity on quotations; advance tracking on proformas; weekly → yearly frequency on recurring. |
| **Company Ledger** (`PurchaseInvoices.jsx`) | Company-wide vendor bills and payments. Uses `ProjectLedger` in company mode (no project). Other amount + GST, round off, Record payment → locked Cash Out, void, delete-with-payments. |
| Tax Summary | Output vs input GST, monthly or quarterly. *A preparation aid, not a filing tool.* |
| Profit & Loss | Income, expenses and net for any period, before GST |

**Accounting model** (`financeCategories.js`, 0038/0041). Every cash row carries a DB-stamped **treatment**:

- `revenue` / `other_income` count as income.
- `operating` / `non_operating` count as expenses.
- Cost recovery, capital, loans, drawings and tax remittances move cash without touching profit.

P&L reads treatments; cash flow reads every row (`financeAnalytics.js`).

### 7.6 Business

- **Client Directory** (`Customers.jsx`): clients with documents, totals billed/paid/outstanding, and notes. `customerService` handles upsert, dedupe, sync-from-invoices and safe delete.
- **Vendor Directory** (`Vendors.jsx`): GSTIN, state, terms, what's owed, archive. *Belongs to* a project, Internal, or General (0078).
- **Products Directory** (`Products.jsx`): the sellable catalogue (`catalog_items`) with SKU, HSN/SAC, unit, price, tax, stock and *Belongs to*. The Performance tab is fed by RPC `catalog_performance()`.
- **CRM** (`CRM.jsx`): pipeline over `clients` (Lead → Contacted → Deal / Not Deal), with **Start project** on won deals.

`customers` and `crm_leads` were unified into one `clients` table (0015–0019). orgStore still exposes both section names over it.

### 7.7 Company (people ops)

- **Company Hierarchy** (`TeamHierarchy.jsx`): React Flow org chart with drag, reporting lines, arrange and departments. Stored in `org_settings`.
- **Employees** (tabs: Registry / Former / Bulk import):
  - Each employee gets an **Employee ID** `EMP-0001…` per org; a bulk import may bring its own (0082).
  - Records carry location (0076) and role title.
  - From the employee sheet: edit, **role change** and **end employment** (both are HR notices signed through the portal), access role, and portal login create/reset/revoke.
- **Attendance** (tabs: Attendance / Leave): daily sheet with Mark all and in/out times, plus month view and XLSX export. Admin writes use `source:'admin'`, so employees can't overwrite corrections. Leave has approve/reject, types, quotas and balances (`leave_balances_v`). Self-approval is blocked in SQL.
- **Announcements**: org-wide or per department, with pins, expiry and per-user read state.
- **Recruitment Tracker** (`OfferTracker.jsx`): live status of offers, role changes and exits, with portal link and WhatsApp share.

### 7.8 Documents

- **Document Library**: see §5.5. Three registers (General / Process assets / Lessons learned), each showing an AI-readability status.
- **Offer Letters** (single / bulk) and **Certificates** (single / bulk). Each has a form beside a live A4 preview, PDF output, and sending to the recipient's portal. The certificate is edited on the sheet itself (canvas-first editor).
- **Templates** (`agreements/`): gallery of NDA, MoU, Partnership and Custom agreements on the company letterhead (0070/0071, `records` with the `agreement` doc type).
- **Records** (`InternRecords.jsx`): every issued document, filterable and downloadable, with CSV export.
- **Bulk** (`bulk/`): CSV → validate → generate → optionally email. Max plan. Bulk History is not persisted yet.

### 7.9 Portals

**Recipient portal** (`portal/RecipientPortal.jsx`, public). It loads through `GET /api/portal` with the token, and actions go through `POST /api/portal`:

| Action | Resulting status |
|---|---|
| `accept_offer` | `signed`, and the recipient becomes an employee |
| `acknowledge` | `acknowledged`. A role change applies the new title/salary; a termination exits the employee. |
| `mou_sign` | `fully_signed` |
| `accept_quotation` | `accepted` |
| `decline` / `request_revision` | `declined` / `revision_requested` |
| `payment_confirmation` / `proforma_payment` | `payment_submitted` / `advance_paid` |

Each action writes a notification for the org.

**Employee portal** (`portal/EmployeePortal.jsx`, `portal/me/*`, also at `/me`). Tabs: Overview (clock-in card, month KPIs), Attendance, My projects, Timesheet, Leave, Announcements, My profile (self-edit via `update_my_profile`, photo, change password). There are three ways in:

- an invite link (`accept_invitation`)
- a join code (`claim_portal_seat`)
- an admin-created password login (`create_portal_login`)

### 7.10 Company Profile / Settings (`CompanyProfile.jsx`, `/profile`)

Sections, ticked off as completed (a red dot shows gaps): Company basics · Contact & tax · Signatory · Logo & signature · Company stamp (uploaded or generated SVG) · Payments (UPI/bank) · Email sending (Gmail via `/api/org-secrets`, with Test) · **Team access** (role × resource permission grid, per-member exceptions, join code) · Plan · Account & data (full export via `/api/export`).

### 7.11 Platform console (`admin/`, `/admin`)

Access needs both the `app_metadata.platform_admin` claim (granted by `scripts/setup-admin.js`) and a match with `PLATFORM_ADMIN_EMAIL`.

- Overview: tenants, MRR, plan mix
- Organisations: list, detail, set plan, delete/restore
- Mail: sent from the platform's own SMTP, never a tenant's

---

## 8. EdgeAI (the agent) and EdgeBrain (the knowledge graph)

### 8.1 EdgeAI agent — full write-up in `docs/edgeai-agent.md`

| Piece | File(s) |
|---|---|
| Client state | `assistant/AssistantContext.jsx` (provider), `assistantStore.js` (`useAssistant`). Chats persist in `localStorage['edgeos.ai.chats']` (max 60) with cards and recent entities, so "it" or "that task" resolves. |
| UI | `Copilot.jsx` (variants: `dock` in the hub, `full` full-screen, page for `/ask`), `ActionCard.jsx`, `DisambiguationCard.jsx`, `FollowUpChips.jsx`, `DocPaper.jsx`, `Markdown.jsx` (safe renderer), `Orb.jsx`, `VoiceCall.jsx` (voice mode via `hooks/useSpeechRecognition.js`), `AIAssistant.jsx` (global launcher) |
| Transport | `services/agentService.js`: SSE events `text`, `card`, `choice`, `input`, `notice`, `navigate`, `entities`, `status`; card actions confirm / cancel / undo / status |
| Server entry | `api/agent.js` |
| Runtime | `api/_lib/agent/`: `registry.js` (tool catalogue, risk level, permission filter), `loop.js` (≤ 8 model steps), `model.js` (Gemini call), `prompt.js` (`AGENT_PROMPT_VERSION`), `context.js`, `resolvers.js` (names → records, never a guess), `pipeline.js` (propose / confirm / undo), `executor.js` (apply as the user, optimistic concurrency), `actions.js`, `db.js` (user-token client, friendly errors) |
| Tools | **read:** `search`, `get_record`, `list_tasks`, `list_invoices`, `list_leave`, `get_attendance`, `finance_summary`, `ask_brain`, `list_bills` · **navigate:** `open_page`, `open_record` · **tasks:** `create_task`, `update_task`, `complete_task`, `reopen_task`, `delete_task` · **clients:** `create_client`, `update_client`, `move_client_stage`, `add_client_note`, `delete_client` · **finance:** `create_{quotation,proforma,invoice}_draft`, `convert_quotation`, `issue_document`, `record_payment`, `mark_invoice_paid`, `create_vendor`, `create_purchase_bill`, `cancel_financial_document`, `delete_financial_document` · **cash:** `create_cash_entry` · **agents:** `deadline_watch`, `business_overview`, `business_insights`, `business_breakdown` (read) |
| Storage | `ai_actions` (0068): proposals → executed / undone. Users see their own rows; owner/admin see all; only the service role writes. `audit_log.via` / `ai_action_id`. |
| Evals | `scripts/eval-agent.js` (+ `.cases.js`, `.world.js`) |

**Rules:** there are no trigger words; the model reads every message, and parsers (`src/shared/cashIntent.js`, `dates.js`) only convert values or fill blanks. Low-risk cards show a field diff. High-risk cards show the exact row, a named button and an irreversibility note.

### 8.2 EdgeBrain

- **Concept.** Supabase holds the truth, EdgeBrain is a derived representation, the context engine does retrieval, and the model reasons.
- **SQL** (0033–0037, extended by 0041/0061/0066/0069):
  - Tables: `brain_nodes`, `brain_edges`, `brain_metrics`, `brain_insights`, `brain_state`, `brain_sync_runs`, `brain_dirty`.
  - Sync functions: `app.brain_sync_*` (org, people, clients, catalog, finance, spend, ops, projects, library).
  - Triggers mark rows dirty, and `public.brain_sync` / `brain_drain` process them.
  - Brain RLS mirrors the source tables' permissions (resource `edgebrain`; project metrics are gated by `project_financials`).
- **Server.** `api/brain.js` handles `status`, `build`, `sync`, `search`, `entity`, `neighbors`, `metrics`, `context`, `ask`. `api/_lib/brainRetrieval.js` does discover / traverse / retrieve / aggregate, then `compactFacts` and `fitToBudget`, and adds a DOCUMENT LIBRARY section.
- **Client.** `services/brainService.js`. UI in `brain/`: `EdgeBrain.jsx`, `KnowledgeGraph.jsx` (SVG, clustered by domain), `BrainDock` (Summary / Inspector / Ask / Health), `BrainOnboarding`.

---

## 9. Client data layer (`src/services`, `src/shared`)

### 9.1 `orgStore.js` — the data layer

- Maps app **sections** to Postgres tables with `fromRow` / `toRow` adapters.
- `load(orgId)` hydrates everything once. After that, reads are **synchronous** from cache, mirrored to `localStorage` (`edgeos_org_<id>`) and kept live by Realtime (`listenSection`).
- Writes (`addItem`, `updateItem`, `removeItem`, `saveFinDoc`…) go to Supabase and are checked by RLS.
- It snapshots the caller's permissions: `can(resource, action)` and `getRole()`. Sections whose `requires` permission the caller lacks are never requested (e.g. `project_allocations` needs `project_financials.view`).

Main sections → tables: `departments`, `employees` / `ex_employees` (same table, `exited_at`), `tasks`, `projects`, `project_members`, `project_milestones`, `project_documents`, `project_allocations`, `timesheet_entries`, `customers` / `crm_leads` → `clients`, `catalog` → `catalog_items`, `expenses`, `income_entries`, `vendors`, `purchase_invoices`, `records`, `fin_docs` → `financial_documents` (+ line items, payments), `fin_notifs` → `notifications`, `fin_recurring` → `recurring_invoices`, `hierarchy` → `org_settings`, `_profile` / `_usage`.

### 9.2 Other services (selection)

| Service | Responsibility |
|---|---|
| `documentStore.js` | Financial docs, HR notices, notifications, recurring invoices, payments |
| `storageService.js` | HR records/employees API (legacy shape) + CSV export |
| `projectService.js` / `projectAnalytics.js` | Project CRUD, close/reopen/duplicate, members, milestones, allocations (`set_project_allocations`), reports; pure progress/burn/health maths |
| `financeAnalytics.js` / `financeCategories.js` | Pure finance maths (tax summary, P&L, cash flow, payment position, periods); treatments |
| `customerService.js`, `catalogService.js`, `clientProjects.js`, `belongsTo.js` | Clients, catalogue, client↔project links, Belongs-to |
| `importantTasks.js` | "Needs attention" selection |
| `ledgerSplit.js` | Splitting ledger amounts across projects |
| `attendanceService.js`, `leaveService.js`, `announcementService.js`, `meService.js` | People ops & self-service |
| `permissionService.js`, `planConfig.js` | Role/permission matrix, members; plan tiers & limits |
| `emailService.js`, `portalService.js`, `portalAccessService.js` | Mail, recipient portal links, employee portal access |
| `pdfService.js`, `imageUploadService.js`, `receiptService.js` | PDF generation; WebP branding uploads; receipts bucket |
| `invoiceReminderService.js` | Overdue flagging + reminder emails |
| `salesGeoService.js` | Revenue by country |
| `libraryService.js`, `brainService.js`, `agentService.js`, `aiUsageService.js` | Library, EdgeBrain, agent client, AI usage |
| `employeeImport.js`, `importDates.js` | Bulk employee import parsing & date normalisation |
| `orgProvisioning.js`, `adminService.js` | Org creation RPC; platform console client |

### 9.3 `src/shared/` — code shared by browser and server

`cashIntent.js` (sentence → cash entry draft), `dates.js` (dates as said, resolved in the org timezone), `financeTaxonomy.js`, `finDocs.js` (rows, line items, totals, company snapshot, receivables), `documentConversion.js`, `documentLifecycle.js`, `proformaAdvance.js`. **It imports nothing outside itself**, which `sharedBoundary.test.js` enforces. That lets `api/` use it safely.

### 9.4 Hooks, context, lib, utils

- **Hooks:** `useTheme` (light/dark on `<html data-theme>`), `usePlanStatus`, `useProfileCompletion`, `useTaskDeadlineMonitor`, `useSpeechRecognition`, `usePanZoom`, `useLeaveGuard` (unsaved-changes guard), `useTrimmedImage`.
- **Context:** `AuthContext` (user, login/signup/Google, needsOnboarding), `OrgContext` (orgs, activeOrg, create/update).
- **lib:** `supabase.js` (browser client, anon key), `authErrors.js`, `user.js`, `profileCompletion.js`.
- **utils:** `htmlEscape.js` (XSS safety for the one innerHTML path), `imageUtils.js` (images for jsPDF, stamp SVG/PNG), `imageAdjust.js`, `titleCase.js` (labels).

---

## 10. Serverless API (`api/`)

All handlers are Vercel functions. Auth is `Authorization: Bearer <Supabase access token>`, checked by `_lib/auth.js` (`requireUser`, `requireOrgRole`, `requirePlatformAdmin`).

| Route | Method | Who | Purpose |
|---|---|---|---|
| `/api/agent` | POST | member (acts as caller) | EdgeAI: `chat` (SSE), `confirm`, `cancel`, `undo`, `status` |
| `/api/brain` | POST | member + `edgebrain` | EdgeBrain actions (§8.2) |
| `/api/library` | POST | member + `library_documents` | Upload → extract → chunk (§5.5) |
| `/api/email` | POST | member | Send via the org's Gmail. `mode:'test'`. Max 50 recipients. Header-injection guard. Rate-limited (100/hr, 20 tests/day). |
| `/api/org-secrets` | GET/POST | admin | Gmail configured? / set creds (AES-256-GCM). Never returns the password. |
| `/api/portal-token` | POST | member | Mint a `portal_tokens` row + signed URL `<jti>.<exp>.<hmac>` |
| `/api/portal` | GET/POST | portal token | Recipient portal load + actions (service role, one document) |
| `/api/export` | GET | owner/admin | Full tenant JSON export |
| `/api/admin` | POST | platform admin | Console actions |
| `/api/nvidia` | POST | member | Co-founder chat proxy to Gemini, metered |
| `/api/agents` | POST / GET | member (scan, BI snapshot) · admin (settings, run) · cron secret (GET) | Agents: Compliance and Deadline Agent scan, settings, run now; Business Intelligence snapshot; GET is the scheduled run |

**`api/_lib/`:** `auth.js`, `supabaseAdmin.js` (lazy service-role client, never imported from `src/`), `crypto.js`, `portalToken.js`, `aiUsage.js`, `docShape.js`, `brainRetrieval.js`, `libraryExtract.js`, `wbsSuggest.js` (WBS suggestions), `agent/`.

**Environment variables** (`.env.example`):

| Variable | Side | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | client | Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | server | Service-role client |
| `SECRETS_ENCRYPTION_KEY` | server | AES key for Gmail passwords (`openssl rand -hex 32`) |
| `PORTAL_TOKEN_SECRET` | server | HMAC key for portal links (32+ chars) |
| `GEMINI_API_KEY` | server | Gemini (all AI routes) |
| `GEMINI_MODEL` | server, optional | Gemini model id; default `gemini-3.6-flash` |
| `AGENT_MODEL` | server | Optional model override |
| `PORTAL_ALLOWED_ORIGINS` | server | Allowed origins for portal links |
| `PLATFORM_ADMIN_EMAIL`, `PLATFORM_SMTP_USER`, `PLATFORM_SMTP_PASSWORD`, `PLATFORM_MAIL_FROM` | server | Platform console |
| `CRON_SECRET` | server | Bearer secret Vercel Cron sends to `GET /api/agents` (16+ chars). Unset = scheduled runs refused. |

⚠ **Never prefix a server secret with `VITE_`.** Vite inlines those into the browser bundle.

---

## 11. Database (`supabase/`)

### 11.1 Core tables

| Domain | Tables |
|---|---|
| Tenancy | `organizations`, `memberships`, `invitations`, `org_settings`, `org_banking`, `org_secrets` (no client access), `subscriptions`, `usage_counters` |
| Permissions | `roles`, `permission_resources`, `role_permission_defaults`, `role_permissions`, `member_permissions` (0062) |
| People | `departments`, `employees` (+ `employee_code`, `location`), `employee_compensation` (owner/admin only), `attendance_days`, `leave_types`, `leave_requests`, `leave_adjustments`, `announcements`, `announcement_reads`, view `leave_balances_v` |
| Clients & sales | `clients`, `catalog_items`, `products` (legacy roadmap), `country_codes` |
| Documents | `records` (HR + agreements), `financial_documents`, `document_line_items`, `document_signatures`, `document_counters`, `document_versions`, `recurring_invoices`, `portal_tokens`, `library_documents`, `library_chunks` |
| Money | `payments`, `expenses`, `income_entries`, `finance_categories`, `vendors`, `purchase_invoices` |
| Projects | `projects`, `project_code_counters`, `project_members`, `project_milestones`, `project_documents`, `project_allocations`, `tasks` (project/milestone/WBS/dependencies/important), `timesheet_entries`, plus 0073/0074 tables for RACI, project announcements, project clients/vendors, communications and files |
| AI | `ai_company_memory`, `ai_usage_events`, `ai_actions`, `brain_*` |
| System | `notifications`, `notification_reads`, `audit_log` (append-only), `email_events`, `legacy_id_map` |

**Storage buckets:**

| Bucket | Access | Contents |
|---|---|---|
| `org-branding` | public, 2 MB | logo, stamp |
| `signatures` | private, 1 MB | signature images |
| `documents` | private | generated PDFs |
| `receipts` | private, 5 MB | expense and bill receipts |
| `employee-photos` | private | employee photos |
| `library` | private, 25 MB | Document Library files |

### 11.2 Migration log (grouped)

| Range | Theme |
|---|---|
| 0001–0004 | Initial schema, `app.*` helpers/guards/numbering/totals, RLS everywhere, storage |
| 0005–0010 | Enum extensions (HR notices, pending), service-role grants, recipient backfill, AI usage counter |
| 0011–0019 | Product catalogue, country codes, sales by country, cross-tenant guards, **clients unification** |
| 0020–0025 | Audit triggers, default privileges, snapshot scrubbing, email rate limit |
| 0026–0027 | **Roles & permissions as data**; every policy reads `role_permissions` |
| 0028–0032 | Vendors/payables/receipts; people ops; employee portal access, credentials, self-profile |
| 0033–0037 | EdgeBrain |
| 0038–0043 | Cash entries & treatments (+ 403 repair), guard fixes, cash dimensions, geo incl. cash, client notes |
| 0044–0061 | **Projects**: permissions, projects, members, milestones, documents, allocations, task links, reporting, access, health, commercial links, plan limit, reminders, employee tasks, **timesheets**, EdgeBrain projects |
| 0062–0068 | Per-member permissions, document library, document versions, headline totals, AI usage events, **AI actions** |
| 0069 | Library registers (general / process assets / lessons learned) |
| 0070–0071 | Agreement doc type + agreement records |
| 0072 | WBS & task dependencies |
| 0073–0075 | Project team (RACI, announcements); project clients/vendors/documents; `defer_to_rls` on live |
| 0076 | Employee location |
| 0077 | Important tasks |
| 0078 | Belongs-to for vendors/products |
| 0079–0080 | Purchase round off; bill payments as locked ledger entries |
| 0081–0082 | Project form fields; Employee ID |
| 0083 | Project type, product/service, RACI nesting, pins, vendor multi-project |
| 0084 | Template "Other" type + print on letterhead |
| 0085 | Communication channels |
| 0086–0087 | Purchase other amount + GST, per-line quotation GST; project billing "Others" |
| 0088 | RTGS payment method |
| 0089 | Agents: `agent_settings`, `agent_runs`, `agent_alerts` (service role only) + `agent_run_claim` / `agent_run_finish` / `agent_alerts_commit` |

- Two files share the `0038_` prefix. Apply `0038_cash_entries.sql` before `0038_repair_income_permissions.sql`.
- `supabase/checks/*_preflight.sql` compare live objects with repo definitions before risky migrations (agent, agreement, projects, versioning).
- `supabase/pending/` holds migrations that have not been applied, such as dropping the legacy client tables.

### 11.3 Key RPCs

`create_organization`, `accept_invitation`, `next_document_number`, `bump_ai_usage`, `catalog_performance`, `sales_by_country`, `claim_email_quota`, `org_members`, `my_permissions`, `user_permissions`, portal access RPCs (`invite_employee_to_portal`, `claim_portal_seat`, `create_portal_login`, `reset_portal_password`, `revoke_portal_login`, `rotate_portal_join_code`…), `update_my_profile`, `set_my_task_status`, project RPCs (`set_project_allocations`, `project_financials`, `project_portfolio`, `employee_allocation`, `project_health`, `my_projects`, `reopen_project`, `project_reminders_run`, `decide_timesheets`, `project_hours`, `unbilled_hours`), `library_search`, `brain_sync`, `brain_drain`.

---

## 12. Security model

- **RLS on every table.** Since 0027 every configurable policy calls `app.has_permission(org, resource, action)`, which reads `role_permissions` and, since 0062, per-person `member_permissions` exceptions.
- **Roles:** `owner`, `admin`, `member`, `viewer`, plus `employee` (own rows only, served the Employee Portal).
- **Actions** per resource: view / create / edit / delete, edited in the **Team access** grid (`settings/RolePermissions.jsx`).
- **Hard guards in SQL**, which no permission setting can override:
  - The owner row is fixed and the last owner is protected.
  - Only owner/admin can grant owner/admin.
  - Pay, banking and email credentials are owner/admin only.
  - `org_id` and document numbers are immutable.
  - Cross-tenant foreign-key guards.
  - Nobody approves their own leave or timesheets.
  - Banking data is scrubbed from document snapshots.
  - Closed projects are locked.
  - Allocation caps.
  - Salary never reaches non-financial users.
- **New tenant tables** go through `app.secure_tenant_table` and **must get `role_permissions` rows seeded**, or every request 403s. The cause is the policy, not grants.
- **The service role** is used only server-side, only where unavoidable (portal, metering, `ai_actions`, export, admin). Agent writes run with the user's JWT.
- **Secrets:** Gmail passwords are AES-256-GCM encrypted in `org_secrets`; portal links are HMAC-signed and revocable; the Gemini key is server-only.
- **Email:** header-injection guards, 50-recipient cap, per-org rate limit.
- **Audit:** `audit_log` is append-only, project-aware, and marks AI-originated writes.

---

## 13. Design system and UI conventions

- **One look app-wide.** Every page sits in `ModuleShell`, uses the `ui/edge` kit, and follows the hub's Inter / single-blue look (the "Findexa" look, approved 2026-10-09).
- **Tokens:** `theme/edge.js` (`makeTokens(isDark)`, documented contrast floors), `theme/EdgeTheme.jsx`, `theme/surface.css` (CSS variables).
- **Component kit** (`ui/edge.jsx`): Page, Toolbar, Panel, Grid, Btn, Seg, Search, Field, Input, Select, Textarea, Status, Avatar, Stat, StatBand, Table, Empty, Loading, Modal, ConfirmBtn, DialogSheet, RowMenu. `ui/edgeUtils.js` adds `useT`, `useSearch`, `useDialog` (focus trap, Esc, focus return), and date formatting.
- **Dashboards** use `overview/dashKit.jsx` tiles and cards; charts use `vizKit.jsx`.
- **Labels:** headings, buttons and tabs are **Title Case** via `utils/titleCase`. Never ALL CAPS. Body text is sentence case.
- **Inputs:** **no blue focus ring or glow** on focused fields, only a neutral border (rule at the end of `index.css`). Number spinners are hidden.
- **Accessibility:** real buttons and labels, keyboard-operable widgets and dialogs.
- **Mockups** (`main-hub.html`, `mock-today-ask.html`) give **structure only**, not colours or fonts.
- **Legacy CSS:** `src/index.css` is restyled into the edge look by `shell/edgeBridge.css`.
- **Feedback:** `shared/Toast.jsx` for toasts; `services/confirm.js` + `shared/ConfirmHost.jsx` for in-app confirmations (no browser dialogs).

---

## 14. Plans, quotas and metering

- **Tiers** (`services/planConfig.js`): **Free / Pro / Max**, with limits on documents, AI messages, active projects (Free 3 / Pro 25 / Max unlimited, enforced in SQL by 0055), bulk operations (Max), Portfolio (Pro+) and Timesheets (Max).
- **AI metering:** a lifetime AI counter (`bump_ai_usage`). Blocked calls count too, and every call is logged in `ai_usage_events` (0067). The agent charges once per user message; tapping a chip or answering a follow-up costs nothing. Limits are enforced server-side, with a 429 when exceeded. `/dashboard/usage` shows usage.
- **Email:** 100 sends/hour and 20 test sends/day per org.

---

## 15. Running locally

```bash
npm install
cp .env.example .env        # fill in Supabase + server secrets
npm run dev                 # Vite on http://localhost:5173
```

- `vite.config.js` loads `.env` into `process.env` and **runs every `api/*` handler in-process** through the `dev-api-routes` plugin, so `/api/*` works on localhost with the same auth and metering as production. It warns if server-only variables are missing.
- To verify a change in the browser, run your own dev port and sign in as a real user of the target org.
- `scripts/setup-admin.js <email> [password]` grants the platform-admin claim for `/admin`.

---

## 16. Testing

| What | How |
|---|---|
| Unit tests | `npm test` (Vitest over `src/**/*.test.*` and `api/**/*.test.*`, placeholder Supabase env, no network). 42 files: finance analytics, cash intent, dates, overview/today models, project paths/pins, ledger split, belongs-to, important tasks, leave, employee import, document conversion/lifecycle, agent core/loop/tools/finance, brain retrieval, library extract, WBS suggest, email, htmlEscape, titleCase… |
| SQL tests | `scripts/run-db-tests.sh` (Docker Postgres `edgeos-pg`). Applies `00_harness.sql` (emulates Supabase auth/roles/storage), then every migration, then the suites `01`–`20`: isolation, access matrix, roles, people ops, portal, projects (3 phases), member permissions, document versions, brain totals, AI usage, AI actions, document totals, WBS, important tasks, belongs-to, bill payments, employee code, project type/services/RACI. Expected output is in `supabase/tests/expected/`. |
| Agent evals | `node scripts/eval-agent.js` (cases + a fake world) |
| Lint | `npm run lint` |

Known pre-existing failures: SQL suites 03/04 (`purchase_invoices`) and a CRLF issue in 02.

---

## 17. Build, deploy, backups

- **Build:** `npm run build` → `dist/`. `npm run preview` to serve it.
- **Vercel (primary):** `vercel.json` passes `/api/*` to the functions and rewrites everything else to `index.html`. Set the server env vars in the Vercel project.
- **Netlify:** `netlify.toml` is an SPA fallback only. **No API functions run there.**
- **Database changes:** apply migrations in order to the live Supabase project. Run the relevant `supabase/checks/*_preflight.sql` first where one exists. After adding a tenant table, seed `role_permissions`.
- **Backups:** `.github/workflows/backup.yml` makes a weekly encrypted `pg_dump` plus a Storage copy, kept as a 90-day artifact. It needs the secrets `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `BACKUP_PASSPHRASE`. The restore procedure is in `docs/RUNBOOK-restore.md`, which has **not been rehearsed**.

---

## 18. Known caveats and loose ends

- **Live DB ≠ repo migrations.** The deployed schema has drifted. For example, the live permission key for attendance is `attendance`, while the repo seeds `attendance_days`. Check live before writing policy or permission code.
- **Many recent migrations are not yet on live.** Project notes record 0068–0088 (agent actions, library registers, agreements, project team/parties, employee location, important tasks, belongs-to, round off, bill payments, Employee ID, project type, letterhead, other amount, billing Others, RTGS) as pending on live. Features that depend on them degrade gracefully, because optional columns are sent only when filled, but they won't fully work until applied.
- **Orphaned code:** `components/Dashboard.jsx`, `financial/FinancialDocuments.jsx`, `cofounder/CopilotPanel.tsx` (with `decisionEngine.ts`, `followUpEngine.ts`, `employeeAI.ts`), `landing/pages/QuotationsPage.jsx`.
- **Routed but in no menu:** `/revenue` (legacy Billing & Revenue).
- **Bulk History** is empty; batches aren't persisted.
- **`certificateTemplates.js`** is a no-op stub.
- **Legacy names:** `qbitointern`, "OfferPro", `/api/nvidia`, and the orgStore sections `customers` / `crm_leads` that both map to `clients`.
- **Untracked files in the working tree:** `mock-today-ask.html`, `motions/`.
- **`.env` exists locally.** It is gitignored; keep it that way.

---

## 19. Where to look for X

| I want to… | Start here |
|---|---|
| Add a page to a module | `src/App.jsx` (route + module page config) and `shell/modules.js`; add the old path to `MOVED` if it replaces one |
| Add a project page | `projects/projectPaths.js` (`SECTION_PATHS`) + `ProjectDetail.jsx` |
| Read or write org data | `services/orgStore.js` |
| Add a table | migration (idempotent) + `app.secure_tenant_table` + `permission_resources` row + `role_permissions` seed + orgStore section + SQL test |
| Change permissions | migrations 0026/0027/0062; UI `settings/RolePermissions.jsx` |
| Change invoice / GST maths | `InvoiceForm.jsx`, `shared/LineItemsEditor.jsx`, `src/shared/finDocs.js`, `app.recompute_document_totals` |
| Change P&L / tax / cash flow | `services/financeAnalytics.js`, `financeCategories.js` |
| Change ledgers | `financial/CashBook.jsx`, `PurchaseInvoices.jsx`, `projects/ProjectFinance.jsx` (`ProjectLedger`), `financial/cashEntry.js` |
| Change dashboard numbers | `overview/overviewModel.js` |
| Change the Today page | `today/todayModel.js` (pure, tested) |
| Add a hub widget | `hub/widgetCatalog.js` + `hub/widgets.jsx` + `hub/useHubData.js` |
| Add a project overview widget | `projects/projectOverviewWidgets.jsx` |
| Project money / labour cost | migrations 0049, 0051, 0060; `docs/projects.md` |
| Change a PDF layout | `services/pdfService.js` + the matching `*Preview.jsx` |
| Change AI behaviour | `api/_lib/agent/prompt.js` (bump `AGENT_PROMPT_VERSION`), `loop.js`, `assistant/AssistantContext.jsx`; run the evals |
| Give the AI a new ability | add a tool in `api/_lib/agent/tools/` and register it (`docs/edgeai-agent.md`) |
| See what the AI changed | `ai_actions`; `audit_log where via = 'edgeai'` |
| Change what EdgeBrain knows | `app.brain_sync_*` migrations + `api/_lib/brainRetrieval.js` |
| Email / portal | `emailService.js` → `api/email.js`; `portalService.js` → `api/portal*.js`; `portal/RecipientPortal.jsx` |
| Employee self-service | `portal/EmployeePortal.jsx`, `portal/me/*`, `meService.js` |
| Theme / styling | `theme/edge.js`, `theme/surface.css`, `ui/edge.jsx`, `shell/edgeBridge.css` |

---

## 20. Glossary

| Term | Meaning |
|---|---|
| **Org / tenant** | One company. Every row carries `org_id`. |
| **Section** | An orgStore cache bucket, roughly one table |
| **General Ledger** | The cash book: money in/out not covered by an invoice or bill |
| **Company Ledger** | Vendor bills and their payments (formerly "Purchase Bills") |
| **Allocation** | A link putting all or part of a money row onto a project |
| **Treatment** | How a cash row affects profit (revenue, operating, capital, loan…) |
| **Belongs to** | Vendor/product scope: a project, Internal or General |
| **Important task** | An admin-starred task that appears under *Needs attention* |
| **RACI** | Responsible / Accountable / Consulted / Informed matrix per project |
| **WBS** | Work breakdown structure: nested sub-projects and tasks |
| **Recipient portal** | The public, token-gated page where a document's recipient acts on it |
| **Employee portal** | Self-service app for users with the `employee` role (`/me`) |
| **Action card** | An AI-proposed write awaiting the user's Confirm |
| **EdgeBrain** | SQL-derived knowledge graph that grounds AI answers |
| **Preflight** | SQL that checks live objects against repo definitions before a migration |
