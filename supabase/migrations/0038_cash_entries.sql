-- ─────────────────────────────────────────────────────────────────────────────
-- 0038 — money in and money out that no document represents
--
-- THE GAP THIS FILLS: revenue in EdgeOS could only arrive as an invoice. Cash
-- taken over the counter, a retainer paid in advance, interest credited by the
-- bank, a grant, a founder putting money in — none of it could be entered at
-- all, so every figure downstream (Billing & Revenue, Profit & Loss, the
-- Overview, EdgeBrain's revenue.* metrics) answered a narrower question than
-- the one being asked of it. Money out fared slightly better: `expenses` has
-- existed since 0001, but with one free-text category, no payer, no method, no
-- link to the product or the person the money was spent on, and two divergent
-- category lists hard-coded in two React files.
--
-- Three things are added:
--
--   finance_categories  reference data: the whole A–Z of reasons money moves,
--                       each one carrying its ACCOUNTING TREATMENT. This is the
--                       part that matters. "Loan received" is cash in and is
--                       not revenue; "equipment" is cash out and is not an
--                       expense; "owner drawings" is neither. A category list
--                       that does not say so produces a P&L that is wrong in
--                       exactly the way nobody notices.
--   income_entries      money in, with its category, party, method, GST and
--                       receipt — the mirror image of a purchase invoice.
--   expenses (+cols)    method, reference, the employee or product the spend
--                       belongs to, payment status, and the same treatment.
--
-- The treatment lives in the database rather than in JavaScript because three
-- consumers have to agree about it: the finance pages, the Overview, and
-- EdgeBrain's metrics — and the last of those is SQL, so the other two come
-- to it.
--
-- RE-RUNNABLE, throughout. Not a stylistic preference: this file creates two
-- tables, alters a third, seeds ~90 reference rows, adds a permission resource
-- and rewrites three EdgeBrain functions, and a single failure part-way through
-- would otherwise leave the schema in a state where neither finishing nor
-- starting again is possible. Every create is `if not exists` or preceded by a
-- `drop … if exists`, every insert has an `on conflict`, every rename is
-- guarded on not having happened, and the permission fan-out is called
-- explicitly rather than left to a trigger that does nothing on a re-run. Run
-- it as many times as needed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. The taxonomy
-- ═════════════════════════════════════════════════════════════════════════════
-- Reference data with no org_id, on the country_codes pattern (0012): every
-- signed-in user reads it, nobody writes it from a browser. A tenant who needs
-- a category that is not here is better served by asking for it than by each
-- org inventing its own spelling of "Salaries" and making any comparison
-- between two orgs — or between two years — impossible.
--
-- `treatment` is the whole point of the table. Its ten values split by
-- direction:
--
--   in   revenue        earned from customers; the top line of the P&L
--        other_income   earned, but not from operating (interest, rent, scrap)
--        capital_in     cash, NOT income (funding, loans, deposits received)
--        cost_recovery  money coming back (vendor refund, reimbursement) —
--                       reduces an expense rather than adding to income
--
--   out  operating      an ordinary cost of running; a P&L expense
--        non_operating  a real expense, below the operating line (interest,
--                       penalties, forex loss)
--        capex          buying an asset. Cash out, not an expense — it would be
--                       depreciated, and EdgeOS keeps no fixed-asset register,
--                       so it stays out of the P&L rather than distorting it.
--        financing      repaying loan principal, placing a deposit. Neither.
--        owner          drawings and dividends. A distribution of profit, not a
--                       cost of making it.
--        tax            income tax, TDS and GST remittances. Settling a
--                       liability the Tax Summary already computed; counting it
--                       as an expense would charge it twice.
--
-- Everything shows in cash flow whatever its treatment. That distinction —
-- cash moved vs. profit changed — is the one a single expenses table with a
-- free-text category could not express.

create table if not exists public.finance_categories (
  key         text primary key check (length(btrim(key)) > 0),
  label       text not null,
  direction   text not null check (direction in ('in', 'out')),
  group_label text not null,
  treatment   text not null check (treatment in (
                'revenue', 'other_income', 'capital_in', 'cost_recovery',
                'operating', 'non_operating', 'capex', 'financing', 'owner', 'tax')),
  hint        text,
  sort_order  integer not null default 500,
  -- Legacy category strings from 0001 and 0028 live here with active = false:
  -- resolvable, so an existing row still has a label and — more to the point —
  -- a treatment, but absent from the pickers so nothing new is filed under them.
  active      boolean not null default true,
  constraint finance_categories_direction_matches_treatment check (
    (direction = 'in'  and treatment in ('revenue','other_income','capital_in','cost_recovery')) or
    (direction = 'out' and treatment in ('operating','non_operating','capex','financing','owner','tax'))
  )
);
create index if not exists finance_categories_pick_idx
  on public.finance_categories (direction, sort_order) where active;

-- ── Money in ─────────────────────────────────────────────────────────────────
insert into public.finance_categories (key, label, direction, group_label, treatment, hint, sort_order) values
  -- Earned from customers
  ('product_sales',        'Product sales',               'in', 'Sales & services', 'revenue',      'Goods sold without raising an invoice — counter sales, marketplace payouts.',        10),
  ('service_income',       'Services & consulting',       'in', 'Sales & services', 'revenue',      'Work delivered and paid for without a document in EdgeOS.',                          20),
  ('subscription_income',  'Subscriptions & retainers',   'in', 'Sales & services', 'revenue',      'Recurring fees collected outside the recurring-invoice engine.',                     30),
  ('project_milestone',    'Project milestone',           'in', 'Sales & services', 'revenue',      'A stage payment on a project.',                                                      40),
  ('advance_received',     'Advance from customer',       'in', 'Sales & services', 'revenue',      'Money taken before the work. If you later invoice it, link the invoice instead.',    50),
  ('training_income',      'Training & workshops',        'in', 'Sales & services', 'revenue',      'Courses, workshops, paid sessions.',                                                 60),
  ('licensing_income',     'Licensing & royalties',       'in', 'Sales & services', 'revenue',      'Licence fees and royalties on your own work.',                                       70),
  ('commission_income',    'Commission & referral',       'in', 'Sales & services', 'revenue',      'Earned for referring or reselling someone else''s product.',                         80),
  ('maintenance_income',   'Maintenance / AMC',           'in', 'Sales & services', 'revenue',      'Annual maintenance and support contracts.',                                          90),
  ('freight_recovered',    'Shipping recovered',          'in', 'Sales & services', 'revenue',      'Delivery charges collected from the customer.',                                     100),
  -- Earned, but not from operating
  ('interest_income',      'Interest & investment',       'in', 'Other income',     'other_income', 'Bank interest, deposits maturing, dividends received.',                             200),
  ('rental_income',        'Rent received',               'in', 'Other income',     'other_income', 'Letting out space or equipment you own.',                                           210),
  ('scrap_sale',           'Scrap & asset sale',          'in', 'Other income',     'other_income', 'Selling off equipment, furniture or scrap.',                                        220),
  ('forex_gain',           'Foreign exchange gain',       'in', 'Other income',     'other_income', 'Gain on converting or settling in another currency.',                               230),
  ('grant_income',         'Grant / subsidy / incentive', 'in', 'Other income',     'other_income', 'Government or institutional support you do not repay.',                             240),
  ('other_income',         'Other income',                'in', 'Other income',     'other_income', 'Anything earned that fits nowhere above.',                                          290),
  -- Cash, not income
  ('capital_contribution', 'Owner / founder capital',     'in', 'Funding',          'capital_in',   'Your own money going in. Cash, not revenue — it never reaches the P&L.',            300),
  ('investment_received',  'Investor funding',            'in', 'Funding',          'capital_in',   'Equity raised. Cash, not revenue.',                                                 310),
  ('loan_received',        'Loan received',               'in', 'Funding',          'capital_in',   'Borrowed money: cash now, a liability until repaid. Never revenue.',                320),
  ('deposit_received',     'Security deposit received',   'in', 'Funding',          'capital_in',   'Held on someone else''s behalf and repayable.',                                     330),
  -- Money coming back
  ('vendor_refund',        'Refund from a vendor',        'in', 'Recoveries',       'cost_recovery','Money back on something you paid for. Reduces that cost; it is not new income.',    400),
  ('reimbursement_in',     'Reimbursement received',      'in', 'Recoveries',       'cost_recovery','A client or employee paying you back for something you covered.',                   410),
  ('tax_refund',           'Tax refund',                  'in', 'Recoveries',       'cost_recovery','Income tax, TDS or GST refunded.',                                                  420)
on conflict (key) do update
  set label = excluded.label, direction = excluded.direction,
      group_label = excluded.group_label, treatment = excluded.treatment,
      hint = excluded.hint, sort_order = excluded.sort_order;

-- ── Money out ────────────────────────────────────────────────────────────────
insert into public.finance_categories (key, label, direction, group_label, treatment, hint, sort_order) values
  -- What the thing you sell costs to make and to deliver
  ('raw_materials',        'Raw materials',               'out', 'Product & delivery', 'operating',     'Inputs consumed making the product.',                                          1000),
  ('inventory_purchase',   'Stock purchased for resale',  'out', 'Product & delivery', 'operating',     'Finished goods bought to sell on.',                                            1010),
  ('manufacturing',        'Manufacturing & job work',    'out', 'Product & delivery', 'operating',     'Fabrication, assembly and job work paid to a third party.',                    1020),
  ('packaging',            'Packaging',                   'out', 'Product & delivery', 'operating',     'Boxes, labels, filler, print on the pack.',                                    1030),
  ('inbound_freight',      'Inbound freight & duty',      'out', 'Product & delivery', 'operating',     'Getting materials to you, customs included.',                                  1040),
  ('shipping_delivery',    'Shipping & delivery',         'out', 'Product & delivery', 'operating',     'Getting the product to the customer.',                                         1050),
  ('subcontracting',       'Subcontracted services',      'out', 'Product & delivery', 'operating',     'Another firm delivering part of what you sold.',                               1060),
  ('hosting_infra',        'Hosting & infrastructure',    'out', 'Product & delivery', 'operating',     'Servers, storage, bandwidth and APIs the product runs on.',                    1070),
  ('payment_fees',         'Payment gateway fees',        'out', 'Product & delivery', 'operating',     'What the processor keeps out of each collection.',                             1080),
  -- Labour
  ('salaries',             'Salaries',                    'out', 'People & labour',    'operating',     'Monthly payroll for employees on the books.',                                  1100),
  ('wages',                'Wages & daily labour',        'out', 'People & labour',    'operating',     'Hourly, daily or piece-rate labour.',                                          1110),
  ('contractor_fees',      'Contractors & freelancers',   'out', 'People & labour',    'operating',     'People paid per engagement rather than on payroll.',                           1120),
  ('intern_stipend',       'Intern stipends',             'out', 'People & labour',    'operating',     'Stipends paid to interns.',                                                    1130),
  ('bonus_incentive',      'Bonus & incentives',          'out', 'People & labour',    'operating',     'Performance pay, festival bonus, sales incentive.',                            1140),
  ('employer_pf_esi',      'PF, ESI & employer dues',     'out', 'People & labour',    'operating',     'The employer''s share of statutory contributions.',                            1150),
  ('gratuity_settlement',  'Gratuity & leave encashment', 'out', 'People & labour',    'operating',     'Settlements paid when someone leaves.',                                        1160),
  ('recruitment',          'Recruitment & hiring',        'out', 'People & labour',    'operating',     'Job boards, agency fees, assessments.',                                        1170),
  ('training_cost',        'Training & development',      'out', 'People & labour',    'operating',     'Courses and certifications for the team.',                                     1180),
  ('employee_benefits',    'Benefits & welfare',          'out', 'People & labour',    'operating',     'Insurance, meals, transport, team welfare.',                                   1190),
  ('reimbursement_out',    'Employee reimbursements',     'out', 'People & labour',    'operating',     'Paying someone back for what they spent on the company.',                      1200),
  -- Winning the work
  ('advertising',          'Advertising & ads',           'out', 'Sales & marketing',  'operating',     'Paid media of any kind.',                                                      1300),
  ('marketing_content',    'Content & creative',          'out', 'Sales & marketing',  'operating',     'Design, video, copy, photography.',                                            1310),
  ('events_exhibitions',   'Events & exhibitions',        'out', 'Sales & marketing',  'operating',     'Stalls, sponsorships, conferences.',                                           1320),
  ('sales_commission',     'Sales commission',            'out', 'Sales & marketing',  'operating',     'Paid out on business that closed.',                                            1330),
  ('client_travel',        'Client travel & hosting',     'out', 'Sales & marketing',  'operating',     'Travel and entertainment for winning or serving a client.',                    1340),
  -- Keeping the lights on
  ('rent',                 'Rent & lease',                'out', 'Operations & admin', 'operating',     'Premises, co-working, equipment leases.',                                      1400),
  ('utilities',            'Utilities',                   'out', 'Operations & admin', 'operating',     'Electricity, water, gas, diesel.',                                             1410),
  ('internet_phone',       'Internet & phone',            'out', 'Operations & admin', 'operating',     'Connectivity and mobile bills.',                                               1420),
  ('software_subs',        'Software & subscriptions',    'out', 'Operations & admin', 'operating',     'The tools the business runs on.',                                              1430),
  ('office_supplies',      'Office supplies',             'out', 'Operations & admin', 'operating',     'Stationery, pantry, consumables.',                                             1440),
  ('repairs_maintenance',  'Repairs & maintenance',       'out', 'Operations & admin', 'operating',     'Fixing what you already own.',                                                 1450),
  ('insurance',            'Insurance',                   'out', 'Operations & admin', 'operating',     'Premiums on any policy.',                                                      1460),
  ('professional_fees',    'Professional fees',           'out', 'Operations & admin', 'operating',     'Accountants, lawyers, consultants, auditors.',                                 1470),
  ('bank_charges',         'Bank charges',                'out', 'Operations & admin', 'operating',     'Account fees, transfer charges, card fees.',                                   1480),
  ('courier_postage',      'Courier & postage',           'out', 'Operations & admin', 'operating',     'Documents and small parcels that are not product delivery.',                   1490),
  ('local_travel',         'Travel & commute',            'out', 'Operations & admin', 'operating',     'Business travel that is not client-facing.',                                   1500),
  ('licences_compliance',  'Licences & compliance',       'out', 'Operations & admin', 'operating',     'Registrations, filings, statutory fees.',                                      1510),
  ('security_housekeeping','Security & housekeeping',     'out', 'Operations & admin', 'operating',     'Guards, cleaning, facility services.',                                         1520),
  ('bad_debt',             'Bad debt written off',        'out', 'Operations & admin', 'operating',     'An invoice accepted as uncollectable.',                                        1530),
  ('donation_csr',         'Donation & CSR',              'out', 'Operations & admin', 'operating',     'Charitable and community spending.',                                           1540),
  ('other_expense',        'Other expense',               'out', 'Operations & admin', 'operating',     'An ordinary running cost that fits nowhere above.',                            1590),
  -- Things you buy and keep
  ('equipment',            'Equipment & machinery',       'out', 'Assets & capital',   'capex',         'Bought, not consumed: cash out, but not a cost — so it does not cut profit.',   1600),
  ('computers',            'Computers & devices',         'out', 'Assets & capital',   'capex',         'Laptops, phones, peripherals.',                                                1610),
  ('furniture',            'Furniture & fittings',        'out', 'Assets & capital',   'capex',         'Desks, chairs, fixtures.',                                                     1620),
  ('vehicle',              'Vehicles',                    'out', 'Assets & capital',   'capex',         'Company vehicles.',                                                            1630),
  ('leasehold_improve',    'Fit-out & improvements',      'out', 'Assets & capital',   'capex',         'Building out a space you lease.',                                              1640),
  ('deposit_paid',         'Security deposit paid',       'out', 'Assets & capital',   'financing',     'Refundable, so not a cost — you still hold the claim.',                        1650),
  -- Money and the taxman
  ('loan_repayment',       'Loan principal repaid',       'out', 'Financing & tax',    'financing',     'Principal only: cash out, but it settles a debt rather than costing you.',     1700),
  ('loan_interest',        'Loan interest',               'out', 'Financing & tax',    'non_operating', 'The cost of borrowing, as opposed to the borrowing itself.',                   1710),
  ('forex_loss',           'Foreign exchange loss',       'out', 'Financing & tax',    'non_operating', 'Loss on converting or settling in another currency.',                          1720),
  ('penalties_fines',      'Penalties & fines',           'out', 'Financing & tax',    'non_operating', 'Late fees, interest on tax, regulatory penalties.',                            1730),
  ('income_tax_paid',      'Income tax paid',             'out', 'Financing & tax',    'tax',           'Advance tax and self-assessment: paid out of profit, not before it.',          1740),
  ('tds_paid',             'TDS deposited',               'out', 'Financing & tax',    'tax',           'Tax withheld on someone else''s behalf and remitted.',                         1750),
  ('gst_paid',             'GST remitted',                'out', 'Financing & tax',    'tax',           'Settling the net liability the Tax Summary computes — not a second cost.',     1760),
  ('owner_drawings',       'Owner drawings',              'out', 'Financing & tax',    'owner',         'Taking money out for yourself: a share of profit, not a cost of earning it.',  1770),
  ('dividend_paid',        'Dividend paid',               'out', 'Financing & tax',    'owner',         'Paid to shareholders out of profit.',                                          1780)
on conflict (key) do update
  set label = excluded.label, direction = excluded.direction,
      group_label = excluded.group_label, treatment = excluded.treatment,
      hint = excluded.hint, sort_order = excluded.sort_order;

-- ── Legacy strings, kept resolvable ──────────────────────────────────────────
-- Every category value an existing expenses or purchase_invoices row can hold,
-- from 0001's list and 0028's. Inactive, so they are never offered again, but
-- present so that history keeps a label and a treatment instead of falling
-- through to a default — which would quietly restate what the P&L says about
-- periods that are already closed.
insert into public.finance_categories (key, label, direction, group_label, treatment, hint, sort_order, active) values
  ('Operations',        'Operations (legacy)',        'out', 'Legacy', 'operating', null, 9000, false),
  ('Marketing',         'Marketing (legacy)',         'out', 'Legacy', 'operating', null, 9010, false),
  ('Salaries',          'Salaries (legacy)',          'out', 'Legacy', 'operating', null, 9020, false),
  ('Tools & Software',  'Tools & Software (legacy)',  'out', 'Legacy', 'operating', null, 9030, false),
  ('Office',            'Office (legacy)',            'out', 'Legacy', 'operating', null, 9040, false),
  ('Travel',            'Travel (legacy)',            'out', 'Legacy', 'operating', null, 9050, false),
  ('Other',             'Other (legacy)',             'out', 'Legacy', 'operating', null, 9060, false),
  ('Inventory',         'Inventory (legacy)',         'out', 'Legacy', 'operating', null, 9070, false),
  ('Software',          'Software (legacy)',          'out', 'Legacy', 'operating', null, 9080, false),
  ('Hardware',          'Hardware (legacy)',          'out', 'Legacy', 'operating', null, 9090, false),
  ('Utilities',         'Utilities (legacy)',         'out', 'Legacy', 'operating', null, 9100, false),
  ('Professional fees', 'Professional fees (legacy)', 'out', 'Legacy', 'operating', null, 9110, false),
  ('Rent',              'Rent (legacy)',              'out', 'Legacy', 'operating', null, 9120, false)
on conflict (key) do nothing;
-- The live keys are snake_case ('rent', 'utilities', 'professional_fees'), so
-- none of these collide — the capitalisation is what marks a value as coming
-- from the old hard-coded lists.

alter table public.finance_categories enable row level security;
alter table public.finance_categories force  row level security;
drop policy if exists finance_categories_select on public.finance_categories;
create policy finance_categories_select on public.finance_categories
  for select to authenticated using (true);
-- No write policy: the taxonomy changes by migration, not from a browser.
revoke all on public.finance_categories from anon;
grant select on public.finance_categories to authenticated;
grant all    on public.finance_categories to service_role;

-- The one place a category is turned into a treatment. A key that is not in the
-- table — only reachable from a client that has not reloaded since this
-- migration — falls back to the neutral treatment for its direction, which is
-- also the treatment every legacy row above was given.
create or replace function app.finance_treatment(p_key text, p_direction text)
returns text language sql stable set search_path = public, pg_temp as $$
  select coalesce(
    (select c.treatment from public.finance_categories c
      where c.key = p_key and c.direction = p_direction),
    case when p_direction = 'in' then 'revenue' else 'operating' end);
$$;

-- Called only from the two guard triggers below, which are SECURITY DEFINER and
-- so reach it as the owner. Nothing else should.
revoke all on function app.finance_treatment(text, text) from public;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. income_entries — money in
-- ═════════════════════════════════════════════════════════════════════════════
-- Deliberately NOT a second kind of invoice. An invoice is a numbered document
-- issued to a party, printable and owed; this is a line in the cash book saying
-- money arrived and why. Keeping the two apart is what stops one rupee being
-- counted twice, and `document_id` exists so that when an entry IS the receipt
-- of an invoice the link is explicit and the analytics can exclude it.

create table if not exists public.income_entries (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  category       text not null default 'other_income' references public.finance_categories(key),
  -- Derived from category by the guard below. Stored rather than computed on
  -- read, so that re-categorising the taxonomy later cannot restate a period
  -- that has already been reported.
  treatment      text not null default 'revenue',
  description    text not null check (length(btrim(description)) > 0),
  client_id      uuid references public.clients(id) on delete set null,
  received_on    date not null default current_date,
  amount         numeric(14,2) not null check (amount >= 0),               -- gross, as received
  tax_amount     numeric(14,2) not null default 0 check (tax_amount >= 0), -- output GST inside `amount`
  net_amount     numeric(14,2) not null default 0,                         -- amount − tax_amount, derived
  payment_method text not null default 'bank_transfer'
                 check (payment_method in ('cash','bank_transfer','upi','card','cheque','wallet','other')),
  reference      text,                                                     -- UTR, cheque no., payout id
  -- Where the money came from, on 0037's terms, so that a revenue-by-country
  -- answer which includes counter sales still reconciles.
  country_code   char(2) references country_codes(code),
  -- Set when this entry records the receipt of an invoice that is also tracked
  -- as a document; such entries are excluded from revenue so the invoice is not
  -- counted twice.
  document_id    uuid references public.financial_documents(id) on delete set null,
  receipt_path   text,
  notes          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint income_tax_lte_amount check (tax_amount <= amount + 0.01)
);
create index if not exists income_entries_org_date_idx on public.income_entries (org_id, received_on desc);
create index if not exists income_entries_client_idx   on public.income_entries (client_id)   where client_id is not null;
create index if not exists income_entries_doc_idx      on public.income_entries (document_id) where document_id is not null;

-- The same shape as app.purchase_invoice_guard (0028): cross-tenant references
-- are refused here rather than trusted to the foreign key, derived columns are
-- computed here rather than accepted from the client, and the country falls
-- back through the client to the organisation so a row is never needlessly
-- unplaceable on a map.
-- SECURITY DEFINER, and it has to be: the body calls app.finance_treatment(),
-- and `authenticated` has no USAGE on schema app (0002), so as an invoker-rights
-- function every insert would fail with "permission denied for schema app". The
-- pinned search_path is what makes definer rights safe here. It also means the
-- three cross-tenant checks are not themselves subject to RLS, which is correct:
-- they are scoped by new.org_id and either raise or do not, and under the
-- caller's privileges a member without `clients.view` would have been told a
-- client of their own org does not belong to it.
create or replace function app.income_entry_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_country char(2);
begin
  if new.client_id is not null and not exists (
       select 1 from public.clients c where c.id = new.client_id and c.org_id = new.org_id) then
    raise exception 'client % does not belong to this organization', new.client_id
      using errcode = '23503';
  end if;
  if new.document_id is not null and not exists (
       select 1 from public.financial_documents f
        where f.id = new.document_id and f.org_id = new.org_id) then
    raise exception 'document % does not belong to this organization', new.document_id
      using errcode = '23503';
  end if;

  new.treatment  := app.finance_treatment(new.category, 'in');
  new.net_amount := round(new.amount - new.tax_amount, 2);

  if new.country_code is null then
    select coalesce(c.country_code, o.country_code) into v_country
      from public.organizations o
      left join public.clients c on c.id = new.client_id
     where o.id = new.org_id;
    new.country_code := v_country;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists income_entries_guard on public.income_entries;
create trigger income_entries_guard
  before insert or update on public.income_entries
  for each row execute function app.income_entry_guard();

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. expenses grows the fields the money-out story needed
-- ═════════════════════════════════════════════════════════════════════════════
-- Additive and defaulted, so every existing row stays valid and every existing
-- reader keeps working. `treatment` is backfilled through the same function the
-- new rows use — which is why the legacy category strings had to be seeded.
alter table public.expenses
  add column if not exists treatment      text not null default 'operating',
  add column if not exists payment_method text not null default 'bank_transfer',
  add column if not exists reference      text,
  -- Who the money was spent on (payroll, stipend, reimbursement) and what it
  -- was spent on (a product or project). Both optional; both are what turns
  -- "we spent four lakh on labour" into "and here is exactly where".
  add column if not exists employee_id    uuid references public.employees(id) on delete set null,
  add column if not exists product_id     uuid references public.products(id)  on delete set null,
  add column if not exists status         text not null default 'paid',
  add column if not exists paid_on        date,
  add column if not exists notes          text,
  add column if not exists created_by     uuid references auth.users(id) on delete set null,
  add column if not exists updated_at     timestamptz not null default now();

-- Named constraints added conditionally: `add column if not exists` is
-- re-runnable, an unguarded `add constraint` is not.
do $mig$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_payment_method_check') then
    alter table public.expenses add constraint expenses_payment_method_check
      check (payment_method in ('cash','bank_transfer','upi','card','cheque','wallet','other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_status_check') then
    alter table public.expenses add constraint expenses_status_check
      check (status in ('paid','pending'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_treatment_check') then
    alter table public.expenses add constraint expenses_treatment_check
      check (treatment in ('operating','non_operating','capex','financing','owner','tax'));
  end if;
  -- 0028 added tax_amount without bounding it against the amount it is supposed
  -- to be part of, so an expense could claim more input GST than it cost. The
  -- UI has always refused it; the table never did.
  if not exists (select 1 from pg_constraint where conname = 'expenses_tax_lte_amount') then
    alter table public.expenses add constraint expenses_tax_lte_amount
      check (tax_amount <= amount + 0.01);
  end if;
end $mig$;

-- SECURITY DEFINER for the same two reasons as app.income_entry_guard() above.
create or replace function app.expense_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.vendor_id is not null and not exists (
       select 1 from public.vendors v where v.id = new.vendor_id and v.org_id = new.org_id) then
    raise exception 'vendor % does not belong to this organization', new.vendor_id
      using errcode = '23503';
  end if;
  if new.employee_id is not null and not exists (
       select 1 from public.employees e where e.id = new.employee_id and e.org_id = new.org_id) then
    raise exception 'employee % does not belong to this organization', new.employee_id
      using errcode = '23503';
  end if;
  if new.product_id is not null and not exists (
       select 1 from public.products p where p.id = new.product_id and p.org_id = new.org_id) then
    raise exception 'product % does not belong to this organization', new.product_id
      using errcode = '23503';
  end if;

  new.treatment := app.finance_treatment(new.category, 'out');
  -- A spend marked paid has a payment date; one still pending must not keep a
  -- stale one, which is how a cash-flow chart starts showing money leaving on a
  -- day it did not.
  if new.status = 'paid' and new.paid_on is null then new.paid_on := new.incurred_on; end if;
  if new.status <> 'paid' then new.paid_on := null; end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists expenses_guard on public.expenses;
create trigger expenses_guard
  before insert or update on public.expenses
  for each row execute function app.expense_guard();

-- Backfill: rows that predate the trigger get the treatment and paid_on it
-- would have given them.
update public.expenses
   set treatment = app.finance_treatment(category, 'out'),
       paid_on   = coalesce(paid_on, incurred_on)
 where paid_on is null or treatment <> app.finance_treatment(category, 'out');

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Permissions, RLS and audit
-- ═════════════════════════════════════════════════════════════════════════════
-- Every statement in this section is written to be safely re-runnable. The
-- policies 0027 generates are `app.has_permission(org_id, 'income_entries', …)`
-- and nothing else, so a tenant whose role_permissions never received the row
-- gets a bare 403 on the first insert with no hint as to why. Re-running this
-- block is the repair, and it has to work whether the earlier statements landed
-- or not.
insert into public.permission_resources (key, label, category, description, actions, sort_order) values
  ('income_entries', 'Income entries', 'Finance',
   'Money received that no invoice represents — cash sales, retainers, interest, funding.',
   array['view','create','edit','delete'], 425)
on conflict (key) do update
  set label       = excluded.label,
      category    = excluded.category,
      description = excluded.description,
      actions     = excluded.actions,
      sort_order  = excluded.sort_order;

-- Read by everyone, written by members, deleted by admins: the shape `expenses`
-- has had since 0026, because an income entry is the same kind of record seen
-- from the other side.
--
-- Driven off `roles` rather than a literal list, so a tenant on a deployment
-- that has added a role still gets a row for it — a role with no row at all is
-- a role that silently cannot use the feature.
insert into public.role_permission_defaults (role, resource, can_view, can_create, can_edit, can_delete)
select r.key, 'income_entries',
       true,
       r.key in ('owner','admin','member'),
       r.key in ('owner','admin','member'),
       r.key in ('owner','admin')
  from public.roles r
 where r.key in ('owner','admin','member','viewer')
on conflict (role, resource) do nothing;

-- 0026's statement trigger on role_permission_defaults normally fans the new
-- defaults out to every organization. It is called here explicitly as well,
-- because the trigger does nothing when the insert above was a no-op (a partial
-- earlier run), and because a deployment that lost the trigger would otherwise
-- leave every existing org without the row and refuse every insert with a 403.
select app.sync_role_permissions(null);

select app.secure_tenant_table('public.income_entries'::regclass, 'income_entries');

grant select, insert, update, delete on public.income_entries to authenticated;
grant all on public.income_entries to service_role;

drop trigger if exists income_entries_audit on public.income_entries;
create trigger income_entries_audit after insert or update or delete on public.income_entries
  for each row execute function app.write_audit();

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. EdgeBrain reads it too
-- ═════════════════════════════════════════════════════════════════════════════
-- Without this the assistant would answer "what was our revenue?" from invoices
-- alone and be confidently short by whatever came in over the counter — the
-- same class of failure 0037 was written to end, so it is prevented the same
-- way: nodes for the entities, aggregates with their definitions attached for
-- the totals, and the word "revenue" given exactly one meaning.

-- ── Nodes ────────────────────────────────────────────────────────────────────
-- 0033's brain_sync_spend is renamed rather than restated, and the name it
-- vacates is taken by a wrapper that runs it and then adds income entries. The
-- orchestrator calls app.brain_sync_spend(p_org, v_since) and reads 'nodes' and
-- 'removed' off the result; both are preserved. Guarded, so re-running this
-- migration cannot nest the wrapper inside itself.
do $mig$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'brain_sync_spend_core'
  ) then
    alter function app.brain_sync_spend(uuid, timestamptz) rename to brain_sync_spend_core;
  end if;
end $mig$;

create or replace function app.brain_sync_spend(p_org uuid, p_since timestamptz default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $fn$
declare v_res jsonb; v_nodes integer := 0; v_removed integer := 0; v_n integer;
begin
  v_res     := app.brain_sync_spend_core(p_org, p_since);
  v_nodes   := coalesce((v_res->>'nodes')::int, 0);
  v_removed := coalesce((v_res->>'removed')::int, 0);

  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, synced_at, deleted_at)
  select i.org_id, 'income_entry', i.id, 'income_entries', i.updated_at, 'income_entries',
         i.description,
         concat_ws(' · ', coalesce(fc.label, i.category),
                   to_char(i.amount, 'FM999999990.00'),
                   to_char(i.received_on, 'DD Mon YYYY'),
                   nullif(c.name, '')),
         i.treatment,
         jsonb_strip_nulls(jsonb_build_object(
           'description', i.description, 'category', i.category,
           'category_label', fc.label, 'treatment', i.treatment,
           -- Spelled out on every node, because "is this revenue?" is precisely
           -- the question a model gets wrong when left to infer it from a name.
           'counts_as_revenue', i.treatment in ('revenue','other_income')
                                and i.document_id is null,
           'amount', i.amount, 'tax_amount', i.tax_amount, 'net_amount', i.net_amount,
           'received_on', i.received_on, 'payment_method', i.payment_method,
           'reference', i.reference, 'client_id', i.client_id, 'client_name', c.name,
           'country_code', i.country_code, 'document_id', i.document_id,
           'notes', i.notes, 'created_at', i.created_at)),
         now(), null
    from public.income_entries i
    left join public.finance_categories fc on fc.key = i.category
    left join public.clients c on c.id = i.client_id
   where i.org_id = p_org and (p_since is null or i.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, source_updated_at = excluded.source_updated_at,
        synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'income_entry',
    coalesce((select array_agg(id) from public.income_entries where org_id = p_org), '{}'::uuid[]));

  return jsonb_build_object('nodes', v_nodes, 'removed', v_removed);
end $fn$;

revoke all on function app.brain_sync_spend(uuid, timestamptz) from public;

-- ── Aggregates ───────────────────────────────────────────────────────────────
-- Every figure carries the definition that makes it quotable in a sentence.
-- The pair that matters most is income.direct_revenue against cash_in.total:
-- they differ by exactly the funding and the refunds, and a model that answers
-- a revenue question with the second is the failure this group exists to make
-- impossible.
create or replace function app.brain_refresh_metrics_cash(p_org uuid)
returns integer language plpgsql set search_path = public, pg_temp as $fn$
declare v_n integer;
begin
  insert into public.brain_metrics (org_id, key, bucket, value, dims, definition, resource)
  select p_org, 'income.direct_revenue', '', coalesce(sum(i.net_amount), 0), '{}'::jsonb,
         'Revenue received WITHOUT an invoice - counter sales, retainers, work billed outside '
         'EdgeOS - at net value, excluding the GST collected on it. Entries linked to an invoice are '
         'excluded so nothing counts twice, and funding and refunds are excluded because they are not '
         'earned. Total revenue = revenue.billed (or revenue.collected, on a cash basis) PLUS this '
         'number; quoting revenue.* alone understates any business that also takes money directly.',
         'income_entries'
    from public.income_entries i
   where i.org_id = p_org and i.document_id is null
     and i.treatment in ('revenue', 'other_income')

  union all
  select p_org, 'income.direct_revenue_by_month', to_char(i.received_on, 'YYYY-MM'),
         coalesce(sum(i.net_amount), 0), '{}'::jsonb,
         'Non-invoice revenue by the month the money arrived, net of GST.', 'income_entries'
    from public.income_entries i
   where i.org_id = p_org and i.document_id is null
     and i.treatment in ('revenue', 'other_income')
     and i.received_on >= (date_trunc('month', current_date) - interval '11 months')::date
   group by to_char(i.received_on, 'YYYY-MM')

  union all
  select p_org, 'income.by_category', i.category, coalesce(sum(i.net_amount), 0),
         jsonb_build_object('category', i.category, 'label', coalesce(fc.label, i.category),
                            'treatment', i.treatment,
                            'counts_as_revenue', i.treatment in ('revenue','other_income')),
         'Money in per reason, net of GST. Buckets whose treatment is capital_in (funding, loans, '
         'deposits received) or cost_recovery (refunds) are cash but NOT revenue, and belong in no '
         'revenue total.', 'income_entries'
    from public.income_entries i
    left join public.finance_categories fc on fc.key = i.category
   where i.org_id = p_org
   group by i.category, i.treatment, fc.label

  union all
  select p_org, 'income.funding_received', '', coalesce(sum(i.amount), 0), '{}'::jsonb,
         'Capital put in or borrowed: owner contributions, investor funding, loans and deposits '
         'received. Cash, never revenue, and never to be added to a revenue figure.',
         'income_entries'
    from public.income_entries i
   where i.org_id = p_org and i.treatment = 'capital_in'

  union all
  select p_org, 'cash_in.total', '', coalesce(sum(i.amount), 0), '{}'::jsonb,
         'Every rupee recorded as arriving through the cash book, gross and for any reason - '
         'revenue, funding and refunds together. A cash-flow figure, not an income figure.',
         'income_entries'
    from public.income_entries i where i.org_id = p_org

  -- ── Money out, by what it actually does to profit ──────────────────────────
  union all
  select p_org, 'spend.by_category', e.category, coalesce(sum(e.amount - e.tax_amount), 0),
         jsonb_build_object('category', e.category, 'label', coalesce(fc.label, e.category),
                            'treatment', e.treatment,
                            'group', coalesce(fc.group_label, 'Legacy'),
                            'hits_profit', e.treatment in ('operating','non_operating')),
         'Money out per reason, net of the input GST claimed back. Buckets whose treatment is capex, '
         'financing, owner or tax are cash leaving the business but are NOT expenses: an asset '
         'purchase, a loan repayment, a drawing and a tax remittance each reduce the bank balance '
         'without reducing profit. Only the operating and non_operating buckets sum to the P&L '
         'expense line.', 'expenses'
    from public.expenses e
    left join public.finance_categories fc on fc.key = e.category
   where e.org_id = p_org
   group by e.category, e.treatment, fc.label, fc.group_label

  union all
  select p_org, 'spend.by_group', coalesce(fc.group_label, 'Legacy'),
         coalesce(sum(e.amount - e.tax_amount), 0),
         jsonb_build_object('group', coalesce(fc.group_label, 'Legacy')),
         'Money out rolled up to the reason-group: product and delivery, people and labour, sales and '
         'marketing, operations and admin, assets and capital, financing and tax. This is the answer '
         'to "where does our money go".', 'expenses'
    from public.expenses e
    left join public.finance_categories fc on fc.key = e.category
   where e.org_id = p_org
   group by fc.group_label

  union all
  select p_org, 'spend.labour_total', '', coalesce(sum(e.amount - e.tax_amount), 0), '{}'::jsonb,
         'Everything spent on people: salaries, wages, contractors, stipends, bonuses, statutory '
         'employer dues, recruitment, training, benefits and reimbursements, net of input GST. '
         'Expense entries only - labour billed on a vendor bill sits in payables instead.',
         'expenses'
    from public.expenses e
    join public.finance_categories fc on fc.key = e.category
   where e.org_id = p_org and fc.group_label = 'People & labour'

  union all
  select p_org, 'spend.product_total', '', coalesce(sum(e.amount - e.tax_amount), 0), '{}'::jsonb,
         'Everything spent making and delivering what you sell: materials, stock, manufacturing, '
         'packaging, freight, shipping, subcontracting, hosting and payment fees, net of input GST. '
         'The cost side of gross margin.', 'expenses'
    from public.expenses e
    join public.finance_categories fc on fc.key = e.category
   where e.org_id = p_org and fc.group_label = 'Product & delivery'

  union all
  select p_org, 'spend.operating_total', '', coalesce(sum(e.amount - e.tax_amount), 0), '{}'::jsonb,
         'Expense entries that reduce profit (treatment operating or non_operating), net of input '
         'GST. This is the figure that belongs in a P&L; expenses.total is gross and also contains '
         'asset purchases, loan repayments, drawings and tax remittances, which do not.', 'expenses'
    from public.expenses e
   where e.org_id = p_org and e.treatment in ('operating', 'non_operating')

  union all
  select p_org, 'cash_out.total', '', coalesce(sum(e.amount), 0), '{}'::jsonb,
         'Every rupee recorded as leaving through expense entries, gross and for any reason. A '
         'cash-flow figure, not an expense figure.', 'expenses'
    from public.expenses e where e.org_id = p_org

  union all
  select p_org, 'spend.pending', '', coalesce(sum(e.amount), 0), '{}'::jsonb,
         'Recorded spend that has not actually been paid out yet.', 'expenses'
    from public.expenses e where e.org_id = p_org and e.status = 'pending';

  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

revoke all on function app.brain_refresh_metrics_cash(uuid) from public;

-- The splice 0037 used, one layer further out: the name in use is renamed aside
-- and a new wrapper takes it, so neither 0035's core nor 0037's geo group is
-- restated here and each file still owns only what it added.
do $mig$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'brain_refresh_metrics_with_geo'
  ) then
    alter function app.brain_refresh_metrics(uuid) rename to brain_refresh_metrics_with_geo;
  end if;
end $mig$;

create or replace function app.brain_refresh_metrics(p_org uuid)
returns jsonb language plpgsql set search_path = public, pg_temp as $fn$
declare v_res jsonb; v_n integer := 0;
begin
  -- Runs first: the core inside it deletes every metric for the org before
  -- rewriting them, so this group has to be an addition to that pass.
  v_res := app.brain_refresh_metrics_with_geo(p_org);

  begin
    v_n := app.brain_refresh_metrics_cash(p_org);
  exception when others then
    -- Its own exception block, like every other group: a tenant on whom this
    -- migration has only half applied loses the cash-book numbers and keeps the
    -- other forty.
    return jsonb_build_object(
      'metrics', coalesce((v_res->>'metrics')::integer, 0),
      'failed_groups', coalesce(v_res->'failed_groups', '[]'::jsonb) || jsonb_build_array('cash'),
      'errors', coalesce(v_res->'errors', '[]'::jsonb) || jsonb_build_array(
                  jsonb_build_object('domain', 'metrics.cash', 'error', sqlerrm, 'at', now())));
  end;

  return v_res || jsonb_build_object('metrics', coalesce((v_res->>'metrics')::integer, 0) + v_n);
end $fn$;

revoke all on function app.brain_refresh_metrics(uuid) from public;

-- ── Keep the projection current ──────────────────────────────────────────────
-- 0034 marks an org dirty when a table the brain projects changes. income_entries
-- is new and has to join that list, with the same three statement triggers and
-- for the same reason: one trigger may not reference both NEW TABLE and OLD
-- TABLE. expenses was already watched.
do $mig$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'brain_mark_dirty'
  ) then
    execute 'drop trigger if exists brain_dirty_ins on public.income_entries';
    execute 'drop trigger if exists brain_dirty_upd on public.income_entries';
    execute 'drop trigger if exists brain_dirty_del on public.income_entries';
    execute 'create trigger brain_dirty_ins after insert on public.income_entries
               referencing new table as changed
               for each statement execute function app.brain_mark_dirty()';
    execute 'create trigger brain_dirty_upd after update on public.income_entries
               referencing new table as changed
               for each statement execute function app.brain_mark_dirty()';
    execute 'create trigger brain_dirty_del after delete on public.income_entries
               referencing old table as changed
               for each statement execute function app.brain_mark_dirty()';
  end if;
end $mig$;

-- An existing brain knows none of this until it resyncs. Hand every org that
-- has one to 0034's drain rather than waiting for the next unrelated edit.
insert into public.brain_dirty (org_id, marked_at, hits)
select s.org_id, now(), 1 from public.brain_state s
on conflict (org_id) do update
  set marked_at = now(), hits = public.brain_dirty.hits + 1;
