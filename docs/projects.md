# Projects — how the model works

A **project** is a unit of work the company delivers: for a client (`projects.client_id` set) or for itself (internal, `client_id` null). It ties together five things:

| | Where it lives |
|---|---|
| Money in | invoices and cash-book income **allocated** to the project |
| Money out | expenses and purchase bills allocated to it |
| People | `project_members`: role, share of time, dates |
| Plan | contract value, cost budget, `project_milestones` |
| Work | `tasks.project_id` / `tasks.milestone_id` |

Migrations: 0044–0052. Tests: `supabase/tests/08_projects_test.sql`.

## Allocations: the money link

Nothing about a project copies or moves money. An **allocation** (`project_allocations`) says *this much of that source belongs to this project*. The source can be an invoice, an income entry, an expense or a purchase bill. The finance tables stay exactly as they were, and the company P&L counts every rupee once, as before.

- **`full`**: the whole entry belongs to one project. It is then the only allocation of that entry.
- **`amount`**: a share, in INR, net of GST. An entry can be split across projects. The shares may not add up to more than the entry is worth. Whatever is left unallocated is overhead.

**What an entry is worth** is defined once, in `app.allocation_source()` (0049). It uses the same terms as the app's P&L:

| Source | Net value | Counts when |
|---|---|---|
| Invoice | `taxable_amount` (after discount, before GST) | not draft, cancelled, declined or expired |
| Income entry | `amount − tax_amount` (`amount` is already INR, 0041) | always; its treatment decides where it lands |
| Expense | `amount − tax_amount` | treatment `operating` or `non_operating` |
| Purchase bill | `subtotal` | not void |

Invoices carry no exchange rate (`financial_documents` has no `fx_rate`), so their taxable value is taken as INR, as the P&L already does. `app.allocation_source` is the one place to change when invoices gain a rate.

**Rules, all enforced by the database:**

- **Editing an entry.** You can't edit a cash-book entry or bill so that it is worth less than what has been allocated from it. The database raises `ALLOCATION_EXCEEDS_SOURCE`, and the UI says "adjust the project split first".
  - Invoices are the exception. The invoice form rewrites line items as a delete then an insert, in two requests, so for a moment the invoice is honestly worth zero.
  - Instead, the reports scale an over-allocated invoice's shares down to its current value, and the Finance tab flags it.
- **Deleting an entry** deletes its allocations. Each source table has an AFTER DELETE trigger to do this.
- **A cancelled invoice** keeps its allocation but stops counting as revenue.
- **Saving a split from a form** goes through `set_project_allocations(source_type, source_id, splits)`.
  - It runs as one transaction, under the caller's own RLS.
  - Rows that haven't changed aren't rewritten, and shrinking shares are applied before growing ones.
  - An untouched picker saves nothing, so a form nobody uses the picker in behaves exactly as it did before Projects.

## Profit

Profit is on an **invoiced (accrual) basis**, with collected cash shown alongside. Everything is net of GST and in INR. `public.project_financials(project, from, to)` returns:

| Line | Source |
|---|---|
| `revenue_invoiced` | allocated invoices that count, by issue date |
| `revenue_collected` | confirmed payments on those invoices in the period, converted to net: payment × allocated ÷ invoice grand total |
| `other_income` | allocated income entries treated `revenue` or `other_income` that are not the receipt of an invoice |
| `vendor_costs` | allocated purchase bills |
| `expense_costs` | allocated operating and non-operating expenses, less allocated `cost_recovery` income. Capex, financing, owner drawings and tax remittances are cash movements, not costs, and are left out, as in the P&L |
| `labour_cost` | see below |
| `gross_margin`, `net_margin` | revenue − direct costs; then − labour |

Budget burn, billed %, unbilled value and receivables are always **to date**, whatever period is asked for.

## Labour cost

```
monthly pay × 12 / 365 × days on the project × allocation % / 100
```

- **Days** is the overlap of three ranges: the membership's dates, the project's dates (start to actual end), and the period asked for. It is clipped at the employee's exit date and never runs past today.
- **Monthly pay** comes from `employee_compensation.amount` and `payment_frequency`:

| Frequency | Monthly pay |
|---|---|
| Monthly | the amount as it is |
| Yearly | the amount ÷ 12 |
| Weekly | the amount × 52 / 12 |
| One-time | nothing (a one-off payment has no daily rate) |

  People marked unpaid (`is_paid = false`) contribute nothing. Pay is assumed to be INR; the table has a currency but no exchange rate.
- **Where it's computed.** Labour cost exists only inside `app.project_labour_cost`. No client role can execute that function, and it is only ever returned as part of an aggregate.

Over-allocation is **allowed**. Someone at 60% on two projects is booked 120%, and `employee_allocation(date)` reports it. That function returns percentages and never money. The Team tab flags anyone over 100%.

## Health

`public.project_health(project)` (0053); the portfolio carries it too.

**At risk** when any of these hold:
- budget burn exceeds time elapsed by more than 10 points
- a milestone is overdue by up to 14 days
- any invoice on the project is overdue
- the projected end falls after the target date

**Off track** when any of these hold:
- burn is over 100% of budget
- a milestone is overdue by more than 14 days
- the project is past its target end date and still active
- net margin is below zero with more than half the contract billed

Closed projects have no health.

## Commercial links (0054)

An invoice can arrive already belonging to a project, and the database allocates it (`full`) on insert:

- from a milestone's **Create invoice** (`payload.milestone_id`), which also links and invoices the milestone;
- from a **conversion** — quotation → proforma → invoice — when the quotation started or is linked to a project;
- from a **recurring template** with `recurring_invoices.project_id` (`payload.recurring_invoice_id`);
- from **billed hours** (`payload.timesheet_ids`, 0060), which also marks those hours billed.

## Timesheets (0058–0060, Max)

- Employees log their own time (draft → submitted). The project manager or an owner/admin approves with `decide_timesheets`; nobody approves their own time. Approved time is locked.
- `projects.cost_method = 'timesheet'` switches labour cost to approved hours × monthly pay × 12 / (52 × 40).
- **Invoice unbilled hours** (time & materials) builds invoice lines from approved billable hours × the member's bill rate.

## Notifications (0056)

Sent once per threshold by `project_reminders_run`, called by the app's one scheduler: milestone due in 3 days and overdue, past target end (to the manager); budget burn at 80% and 100% (to owners/admins); added to a project (to the employee, in their portal).

## Plan limits

Active (open, unarchived) projects: Free 3, Pro 25, Max unlimited — enforced by the database (0055). Portfolio is Pro+; timesheets are Max.

## EdgeBrain (0061)

Project and milestone nodes (no money in their facts), edges to clients, people, tasks, milestones, documents and money (`allocated_to`, gated by `project_financials`), and `project.*` metrics under the same gate.

## Lifecycle

- **Codes.** Every project gets a code, `PRJ-YYYY-NNN`, numbered per organization and year by `app.next_project_code`. Codes are immutable; a client-sent code is ignored.
- **Closing.** Moving to `completed` or `cancelled` stamps `closed_at`, `closed_by` and (if empty) `actual_end_date`. The project's members, milestones and allocations then lock.
  - One exception: an invoice can still be linked to a milestone.
  - The database's own cascades still run, such as a deleted source removing its allocations, or an exit ending memberships.
- **Reopening** is only through `reopen_project(project, reason)`. It is owner/admin only, and the reason goes to the audit log. A plain status update out of a closed state is refused.
- **Deleting** is refused if the project has allocations, invoiced milestones or linked documents. Archive it instead.
- **Memberships** are ended, never deleted in the UI: labour cost needs the dates. When an employee exits, their open memberships end on the exit date.
- **The manager** is whoever holds the `manager` role in `project_members`. Only one manager at a time, and `projects.manager_employee_id` follows it.

## Permissions

| Role | Access |
|---|---|
| owner, admin | everything |
| member | projects, team and milestones: view, create, edit. Documents: view, create. Allocations are in the matrix, but every allocation policy also needs **Project financials**, which a member doesn't have by default |
| viewer | view projects, team, milestones, documents |
| employee | nothing through the matrix. They get `my_projects()` (their active projects, their role, the manager, milestones and their own tasks) and `project_team_public_v` (co-members' names and roles). No money, and no one else's allocation % |

- **`project_financials`** (view only) is the switch for money. It gates:
  - allocation reads and writes
  - `project_financials`
  - the money columns of `project_portfolio` (null without it)
  - allocation history in the audit log
- **Contract value, budgets and bill rates** are commercial figures, not pay. They live on readable rows, and the UI shows them only with Project financials.
- **Pay** never leaves the database except inside the labour-cost aggregate.
- **Guards defer to RLS.** A signed-in caller who couldn't make a write anyway gets the RLS refusal, never a guard's validation error. Otherwise an error like "already on the project" or "exceeds the source" would describe rows in an organization they can't see (`app.defer_to_rls`).

## Where things are

| | |
|---|---|
| Tables, rules | `supabase/migrations/0044`–`0052` |
| Reports | `0051_project_reporting.sql` |
| Client service | `src/services/projectService.js` (DB error codes → sentences in `friendlyError`) |
| Pure arithmetic | `src/services/projectAnalytics.js` (+ tests) |
| Screens | `src/components/projects/`, `shared/ProjectPicker.jsx`, `tasks/` |
| Preflight | `supabase/checks/projects_preflight.sql` — read-only; lists what the live database really has |
