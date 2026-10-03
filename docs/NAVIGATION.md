# EdgeOS — Navigation Map

Every URL in the app, where it sits in the sidebar (the module rail in `ModuleShell`), and what you can do on it.

Sources: routes in `src/App.jsx`, rail config in `MODULE_FILTER` / `NAV_ITEMS` (`src/App.jsx`), hub modules in `src/components/shell/modules.js`, project rail in `src/components/projects/ProjectDetail.jsx` (`TABS`, `projectRail`), admin in `src/components/admin/AdminApp.jsx`.

---

## 1. How navigation works

| Layer | What it is |
|---|---|
| **Hub** (`/hub`) | Home screen. Left: the module rail (7 modules). Centre: a board of widgets you choose and arrange. Top-right: the account menu. |
| **Module sidebar** | Opening a module puts you in `ModuleShell`. Its sidebar lists only that module's pages (`MODULE_FILTER`). |
| **Hidden pages** | Some pages belong to a module but have no sidebar item: editors, forms, old routes (`MODULE_EXTRA_PAGES`). They still show that module's sidebar. |
| **Project workspace** | Inside `/projects/:id` the sidebar becomes that project's own sections (Dashboard, Finance, Project Management, …). |
| **Page tabs** | Some pages have tabs at the top instead of extra sidebar items. The tab is in the URL as `?mode=` (Offers, Certificates, Employees, Attendance) or `?tab=` (project sections). |
| **Back arrow** | Goes to the page you were on before (`useGoBack` / `navHistory`). If there isn't one, it goes to the hub, or to *All projects* when you're inside a project. |
| **Phone** | A bottom bar shows the same modules (`MobileNav.jsx`). The rest are under *More*. |
| **EdgeAI** | The floating copilot is on every page. It can open any page in `api/_lib/agent/tools/navigate.js` (`open_page`) or any record (`open_record`). |
| **Employee role** | Users with the `employee` role never see the admin shell. Every URL shows them the **Employee Portal**. |

---

## 2. Public & standalone routes (outside the workspace)

| URL | Page | What you can do |
|---|---|---|
| `/` (signed out) | Landing page | Marketing home page; *Enter* goes to sign in |
| `/login` | Auth | Sign in with email/password or Google |
| `/signup` | Registration | Create an account and company. Google users without a company land here too, for onboarding. |
| `/join` | Join portal | Accept an invite to an existing organisation, then sign in |
| `/portal/:documentId` | Recipient portal | For the person a document was sent to. Zoom the document, then: **Accept & Sign** (offer), **Sign Agreement** (NDA/MoU), **Accept Quotation**, **Request Revision**, **Acknowledge & Sign** (role change/exit), **Decline** |
| `/ai-cofounder`, `/pricing`, `/invoicing`, `/offer-letters`, `/legal-documents`, `/certificates`, `/documentation`, `/support`, `/changelog`, `/privacy`, `/terms`, `/security` | Marketing sub-pages (`subPageData.js`) | Read-only product, pricing and legal pages. The hub's *Plans & billing* links to `/pricing`. |

### Platform admin console (`/admin/*`)
Has its own operator sign-in, separate from the workspace login.

| URL | Sidebar | What you can do |
|---|---|---|
| `/admin` | Overview | All tenants, their revenue, and the last twelve months |
| `/admin/orgs` | Organisations | Users, contacts, revenue and plans. Open a row to see the full record and change it. |
| `/admin/mail` | Mail | Write to one tenant, a plan tier, or every tenant |

---

## 3. Hub (`/hub`)

**Module rail:** `/` redirects here. Each module opens on its default page:

| Code | Module | Description | Opens |
|---|---|---|---|
| DSH | Dashboard | Full analytics | `/dashboard/projects` |
| PRJ | Projects | Delivery · tasks | `/projects` |
| FIN | Finance | Invoices · quotes | `/finance-status` |
| CMP | Company | Registry · hierarchy | `/team-hierarchy` |
| CLM | Business (sidebar title: *Client Management*) | Clients · vendors | `/customers` |
| DOC | Documents | Library · letters · NDAs | `/library` |
| BRN | EdgeBrain | Company intelligence | `/edgebrain` |

**Widget board:** add, remove, resize and arrange widgets (`widgetCatalog.js`). Some widgets let you pick a 1/3/6/12-month period. Clicking a widget opens its page:

| Group | Widgets → page |
|---|---|
| Projects | Projects, Project health, Project shortcuts → `/projects`. Budget burn, Spent vs budget, Project billing, Utilisation, Project margin, Project margin % → `/portfolio`. Project tasks → `/tasks` |
| Finance | Revenue, Settlement, Awaiting payment → `/invoices`. Expenses, Net cash, Cash flow → `/cashbook`. Revenue/Expenses per head → `/dashboard/finance`. Gross profit & operating ratio → `/profit-loss`. Payables → `/purchases` |
| Sales & Markets | Geography, Top markets, Sales & marketing spend → `/dashboard/sales`. Pipeline → `/crm`. Annual recurring revenue → `/recurring` |
| People & Work | Team, People by location → `/employees`. Tasks → `/tasks` |
| Documents | Documents, Issuance → `/records` |
| General | EdgeBrain → `/edgebrain`. Activity → `/offer-tracker`. Shortcuts → `/dashboard` |

**Notifications:** quotation notifications open `/new-quotation`. Payment notifications open `/invoices`. Everything else opens `/offer-tracker`.

**Account menu:**
- Company profile → `/profile` (or `/profile#<next-section>` while the profile is incomplete)
- My portal → `/me`
- Plans & billing → `/pricing`
- Light/Dark mode
- Log out

---

## 4. Dashboard module (DSH)

On this module the pages appear as a navigation bar along the top instead of a sidebar (`topNav`). `/dashboard` redirects to `/dashboard/projects`.

| URL | Sidebar item | What you can do |
|---|---|---|
| `/dashboard/projects` | Projects | See what is being delivered, what is late, and whether it pays. Click any figure to open the analysis behind it. |
| `/dashboard/finance` | Finance | Money in, money out, receivables and payables, per-head figures |
| `/dashboard/sales` | Sales & Marketing | Pipeline, recurring revenue, quotations, customers, markets (world map) and acquisition spend |
| `/dashboard/team` | Team | Headcount, attendance, leave, and who is carrying the work |
| `/dashboard/documents` | Documents | Everything issued, every reply, and the library EdgeBrain reads |
| `/dashboard/usage` | Usage | AI messages used against your plan's limits |

---

## 5. EdgeBrain module (BRN)

| URL | Sidebar item | What you can do |
|---|---|---|
| `/edgebrain` | Company Brain | Your company as one connected context the AI reasons over. The dock has these views: **Summary**, **Entities**, **Inspect**, **Ask** (question the copilot), **Health** (build runs, entities, links, duration). There is an onboarding checklist covering Team, Customers, Finance, Products, Documents, Operations, Activity, Relationships and History. |

---

## 6. Company module (CMP)

| URL | Sidebar item | What you can do |
|---|---|---|
| `/team-hierarchy` | Company Hierarchy | Visual org chart. **Edit structure**, drag nodes, connect reporting lines, **Arrange**, manage **Departments**, **Save** |
| `/employees` | Employees | Tabs (`?mode=`): **Registry** — table/card view; filter by Everyone / Full-time / Interns or by department; add a department; open an employee to **Edit details**, issue a **Role change** or **End employment**, give or **Turn off access** (login credentials handed over). **Ex-Employees** (`?mode=former`) — everyone who has left, with tenure and whether they can still sign in. **Bulk import** (`?mode=bulk`) — add team members from a CSV. |
| `/employees/new` | *(hidden)* | Add an employee: photo, type (Full-time / Part-time / Internship / Collaboration), paid or unpaid |
| `/attendance` | Attendance | Tabs: **Attendance** — daily sheet (**Mark all**, per-person details, in/out times, hours, note) or one person's month. **Leave** (`?mode=leave`) — **Approve** or **Reject** requests with a comment, view history, manage **Leave types** (annual quota, paid/unpaid, open or retired). |
| `/offer-tracker` | Recruitment Tracker | Live status of every offer letter, role change and exit (Draft → Sent → Opened → Accepted / Declined …). **New offer**, **Edit**, copy the portal link, share on **WhatsApp** |
| `/announcements` | Announcements | **Board** / **History**. **New announcement** for everyone or one department. **Pin**, **Edit**, set an expiry. |
| `/ex-employees` | *(redirect)* | → `/employees?mode=former` |
| `/leave` | *(redirect)* | → `/attendance?mode=leave` |
| `/bulk-team` | *(redirect)* | → `/employees?mode=bulk` |

---

## 7. Business module (CLM — "Client Management")

| URL | Sidebar item | What you can do |
|---|---|---|
| `/customers` | Client Directory | Search, filter and sort clients. **Add Client**, **Edit**, **Delete**. See each client's documents (invoice / quotation / proforma) with Total billed, Paid and Outstanding. |
| `/vendors` | Vendor Directory | Add, edit, **Archive** or **Delete** vendors (GSTIN, state, payment terms). See Billed, Paid, Outstanding and overdue payables. Toggle **Archived** to show archived vendors. |
| `/products` | Products Directory | **Catalogue** tab: **New product** (SKU, HSN/SAC, unit, price, tax rate, stock, low-stock warning, *Belongs to* a project, Internal or General). Edit, archive, delete permanently. **Product Performance** tab: billed and collected per product for a date range. |
| `/crm` | *(hidden — reached from widgets and EdgeAI)* | Lead pipeline: Lead → Contacted → Deal / Not Deal. Add and edit leads, **Move to** another stage, **Start project** from a won deal. |

---

## 8. Documents module (DOC)

| URL | Sidebar item | What you can do |
|---|---|---|
| `/library` | Document Library | Upload files into the General / Process assets / Lessons learned collections. Each file shows whether the AI can read it (readable / partly / waiting / could not read / stored only). **View**, **Open original**, **Download** |
| `/offers` | Offer Letters | Tabs: **Single offer** — fill in the form beside a live preview, **Preview as PDF**, **Open PDF**, send to the recipient's portal. **Bulk offers** (`?mode=bulk`) — upload a CSV and generate the letters. |
| `/new-certificates` | Certificates | Tabs: **Single certificate** (with PDF preview) or **Bulk certificates** from a CSV (`?mode=bulk`) |
| `/templates` | Templates | Gallery of agreements on your letterhead. Pick one to start. |
| `/templates/nda` | *(hidden)* | Draft a non-disclosure agreement (PDF preview, send for signature) |
| `/templates/mou` | *(hidden)* | Draft a memorandum of understanding |
| `/templates/partnership` | *(hidden)* | Partnership agreement: contributions, profit sharing, terms |
| `/templates/custom` | *(hidden)* | Your own title and clauses on the letterhead |
| `/records` | *(hidden — reached from widgets)* | Every issued document, filtered by type (Offer Letters, Certificates, NDAs, MoUs, Templates, Invoices). Download. |
| `/certificates` | *(app alias of `/new-certificates`)* | ⚠ This path is also a marketing sub-page, and the top-level route matches first. A signed-in user who opens `/certificates` (for example through EdgeAI's `certificates` page) probably gets the marketing page. |
| `/ndas`, `/mous` | *(redirect)* | → `/templates/nda`, `/templates/mou` |
| `/bulk-offers`, `/bulk-certificates`, `/bulk-history` | *(redirect)* | → `/offers?mode=bulk`, `/new-certificates?mode=bulk`, `/records` |

---

## 9. Finance module (FIN)

In the sidebar, Quotations, Proforma and Invoices are folded into one **Billing** item.

| URL | Sidebar item | What you can do |
|---|---|---|
| `/finance-status` | Finance Status | Follow every quotation, proforma and invoice through its lifecycle as a **Pipeline** or a **List**. Filter by type, see ageing buckets (not yet due, 1–30 … 90+ days), search, sort, **copy the portal link** |
| `/cashbook` | General Ledger | Money in and money out, by project or General. **Record money in** / **Record money out** (payment method, tax rate, receipt). Filter by date preset, direction, project and reason group. Edit, delete, view the receipt, **Export CSV**. Payments recorded on bills appear here as locked entries. |
| `/quotations` · `/proforma` · `/invoices` | Billing | One page with a tab per document kind. List, open, edit, and start new ones. |
| `/purchases` | Purchase Bills | Bills from vendors: vendor, number, dates, category, amount, input GST, **Round off**. **Record payment** (creates a locked Cash Out entry), **Void**, edit, delete, view the receipt. Shows Total billed, Payable and Overdue. |
| `/tax-summary` | Tax Summary | Output GST against input GST, **Monthly** or **Quarterly**. **Export CSV**. A preparation aid, not a filing tool. |
| `/profit-loss` | Profit & Loss | Income, expenses and net margin for this month / quarter / FY / all time / a custom range. **Export CSV** |
| `/new-invoice` | *(hidden, lights Billing)* | Build an invoice: line items, **Save as Customer**, **Preview as PDF**, **Open PDF** |
| `/new-quotation`, `/new-quotation/:docId` | *(hidden)* | Create or revise a quotation. **Save Draft**, **Send to client** |
| `/new-proforma` | *(hidden)* | Proforma with advance-payment tracking. **Save Draft**, **Preview**, **Send to client** |
| `/recurring` | *(hidden)* | List of recurring invoices (in normal use reached from a project's Billing) |
| `/recurring/new`, `/recurring/edit/:id` | *(hidden)* | Recurring invoice: frequency (weekly → yearly), terms (Net 15/30/45/custom), items |
| `/revenue` | *(no sidebar, no module)* | Legacy Billing & Revenue page |

When an invoice, quotation, proforma or recurring form is opened with `?project=<id>`, its back arrow returns to that project's Billing page.

---

## 10. Projects module (PRJ)

| URL | Sidebar item | What you can do |
|---|---|---|
| `/projects` | Projects (expands to list every live project, by code) | List or Board view. Filter Open / Active / Planned / On hold / All, **My projects**, show archived. **New project**. Columns: manager, status, health, dates, progress, contract value, net margin. |
| `/kanban` | Kanban Chart | Every project by status (Not started / In progress / On hold / Ended / Past due). Filters, **New project** |
| `/portfolio` | Portfolio | Health, margin and team load for every project. Choose a period, **Sort**, **Export CSV**. Totals for active, at-risk, contract and invoiced. *(plan-gated)* |
| `/projects/new` | *(hidden)* | Create a project for a client or internal work: team, budget, billing split (None / 30-70 / 50-50 / monthly retainer) |
| `/tasks` | *(hidden — reached from widgets)* | All tasks on a Board or List (Pending / In progress / Done). **New task**, **My tasks**, edit, reopen, filter Active / Overdue |
| `/timesheets` | *(hidden)* | Hours by person and project for each week. **Approvals**: **Approve** / **Reject**. *(plan-gated)* |

### 10a. Inside one project — `/projects/:projectId`

The sidebar becomes the project's own sections. Its top arrow leads back to *All projects*. A group (Finance, Project Management, …) is one sidebar item, and its pages are tabs at the top of the page. Sections marked 💰 only appear for users who can see financials (`canSeeFinancials`).

**Project actions menu** (on the project page): Edit, Duplicate, Archive / Unarchive, Delete, Close / **Reopen**.

| Sidebar item | Page (tab) | URL | What you can do |
|---|---|---|---|
| *(project home)* | Overview | `/projects/:id` | Snapshot of contract, billed, collected, cost to date and net margin. Open tasks, team (**Manage**), recent activity, and the *Needs attention* list of important tasks |
| **Dashboard** | Overview · Finance 💰 · Sales 💰 · Team · Documents | `/projects/:id/dashboard/:view` (`overview` by default) | That project's dashboards, switched with tabs at the top |
| **Finance** 💰 | Financial Status | `?tab=finance` | Invoiced, collected, outstanding and overdue. **Allocate existing** ledger entries, **Invoice unbilled hours**, revenue against direct costs and labour |
| | Cash Book | `?tab=cashbook` | This project's money in and out |
| | Billing | `?tab=billing` | Quotations · Proforma · Invoices · Recurring for this project |
| | Purchase Bills | `?tab=bills` | Vendor bills for this project |
| | Tax Summary | `?tab=tax` | This project's GST |
| | Profit & Loss | `?tab=pl` | This project's P&L |
| **Project Management** | Portfolio / Overview | `?tab=pm` | Percentage complete, overdue, forecast finish, critical path |
| | Tasks (WBS) | `?tab=wbs` | Work breakdown: sub-projects and tasks in an outline or hierarchy view. Add, indent / outdent, move, expand / collapse all, **Export CSV** |
| | Kanban Board | `?tab=tasks` | Task board (Not started / In progress / Done). Priority, Important star |
| | Gantt Chart | `?tab=gantt` | Timeline. **Link tasks** (dependencies), **Reschedule** |
| **Team Management** | Team Members | `?tab=team` | Add and remove members and their allocation |
| | Team Hierarchy | `?tab=raci` | RACI ("who does what") and reporting structure. Add rows by hand or from the plan, and fix rows that have no role |
| | Attendance | `?tab=attendance` | Day and month views for project members. **Apply for leave**, approve or reject leave |
| | Announcements | `?tab=announcements` | Project-only announcements with priority. Pin, edit |
| **Client Management** | Client Directory | `?tab=clients` | Add or link the client, contacts, GST and billing address. Shortcuts to Communications and Payments |
| | CRM | `?tab=crm` | This project's lead pipeline |
| | Client's Communication | `?tab=comms` | **Approvals** (send a design / document / milestone / quote / timeline for approval and track the client's response) and **Channels** (email, phone, WhatsApp, meeting) |
| | Payment Status & Pendings 💰 | `?tab=payments` | Project value, received, pending and overdue. **Record payment**, attach the invoice copy or receipt, **Export CSV / Excel** (also needs the `payments` permission) |
| **Vendor Management** | Vendor Directory | `?tab=vendors` | Vendors on this project: contract dates and value, scope, bank details (hidden until revealed). Grid or list |
| **Documents Management** | Project Documents | `?tab=documents` | Linked records (quotations, invoices, agreements, vendor bills): **New document**, **Link existing**. Project files: folders, upload, versions with **Restore**, rename and tags, move, choose who can see a file, preview, download |
| | Custom Templates | `?tab=templates` | Write or upload templates (Proposal, Quotation, Report, Meeting minutes …). **Generate document**, download as **PDF** or **Word** |
| **Milestones** | — | `?tab=milestones` | Add, reorder and edit milestones (Pending / In progress / Completed / Cancelled). **Create invoice** from a milestone |
| **Activity** | — | `?tab=activity` | The project's full change log |

---

## 11. Settings & personal

| URL | Reached from | What you can do |
|---|---|---|
| `/profile` | Hub account menu → Company profile | The sidebar lists sections that you check off as you finish them (`/profile#<section>`): **Company basics**, **Contact & tax**, **Signatory**, **Logo & signature**, **Company stamp** (uploaded or generated), **Payments** (UPI / bank), **Email sending** (connect Gmail), **Team access**, **Plan**, **Account & data** |
| `/me` | Hub account menu → My portal | Employee Portal (also every employee-role user's whole app). Tabs: **Overview**, **Attendance**, **My projects**, **Timesheet**, **Leave**, **Announcements**, **My profile**, plus Sign out |

---

## 12. Catch-all

Any unknown URL inside the workspace redirects to `/hub`. Unknown `/admin/*` URLs redirect to `/admin`.
