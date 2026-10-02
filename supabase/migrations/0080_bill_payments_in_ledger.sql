-- ─────────────────────────────────────────────────────────────────────────────
-- 0080 — Paying a purchase bill lands in the General Ledger
--
-- "Record payment" on a purchase bill used to bump purchase_invoices.amount_paid
-- and nothing else: the money left the bank but never appeared under Money out.
-- Now the payment IS a money-out entry, linked to the bill it settles.
--
--   · expenses.purchase_invoice_id   the bill this entry pays. Deleting a bill
--                                    that has payments is refused (restrict):
--                                    the money really left, so the entry must
--                                    be removed deliberately first.
--   · finance_categories 'vendor_bill_payment'
--                                    treatment 'financing': the bill already
--                                    counts the cost in P&L and its input GST in
--                                    the Tax Summary, so the payment is cash
--                                    only. Not pickable by hand (active = false).
--   · app.expense_bill_link()        BEFORE: a linked entry takes its category,
--                                    vendor and GST from the bill — none of them
--                                    can be chosen. The bill must be in the same
--                                    organization and not void.
--   · app.expense_bill_paid()        AFTER: the bill's amount_paid moves by what
--                                    the entry pays, so its status follows. An
--                                    overpayment trips purchase_paid_lte_total
--                                    and the entry is refused with it.
--
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.expenses
  add column if not exists purchase_invoice_id uuid
    references public.purchase_invoices(id) on delete restrict;

create index if not exists expenses_purchase_invoice_idx
  on public.expenses (purchase_invoice_id) where purchase_invoice_id is not null;

insert into public.finance_categories (key, label, direction, group_label, treatment, hint, sort_order, active) values
  ('vendor_bill_payment', 'Vendor bill payment', 'out', 'Financing & tax', 'financing',
   'Pays a purchase bill. The bill already counts the cost and its GST, so this is cash only.', 1690, false)
on conflict (key) do update
  set label = excluded.label, group_label = excluded.group_label, treatment = excluded.treatment,
      hint = excluded.hint, sort_order = excluded.sort_order, active = excluded.active;

create or replace function app.expense_bill_link()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_bill public.purchase_invoices;
begin
  if new.purchase_invoice_id is null then return new; end if;
  select * into v_bill from public.purchase_invoices
   where id = new.purchase_invoice_id and org_id = new.org_id;
  if not found then
    raise exception 'bill % does not belong to this organization', new.purchase_invoice_id
      using errcode = '23503';
  end if;
  if v_bill.status = 'void' and (tg_op = 'INSERT' or old.purchase_invoice_id is distinct from new.purchase_invoice_id) then
    raise exception 'bill % is void and cannot be paid', v_bill.bill_number using errcode = '23514';
  end if;
  new.category   := 'vendor_bill_payment';
  new.vendor_id  := v_bill.vendor_id;
  new.tax_amount := 0;
  new.tax_rate   := 0;
  new.billable   := false;
  return new;
end $$;
revoke all on function app.expense_bill_link() from public;

-- Named to sort before expenses_guard: BEFORE triggers fire alphabetically, and
-- the guard stamps the treatment from the category set here.
drop trigger if exists expenses_bill_link on public.expenses;
create trigger expenses_bill_link
  before insert or update on public.expenses
  for each row execute function app.expense_bill_link();

create or replace function app.expense_bill_paid()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old numeric := 0;
  v_new numeric := 0;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.purchase_invoice_id is not null and old.status = 'paid' then
    v_old := old.amount;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.purchase_invoice_id is not null and new.status = 'paid' then
    v_new := new.amount;
  end if;

  if tg_op = 'UPDATE' and old.purchase_invoice_id is not distinct from new.purchase_invoice_id then
    if v_new <> v_old then
      update public.purchase_invoices
         set amount_paid = greatest(0, amount_paid + v_new - v_old)
       where id = new.purchase_invoice_id;
    end if;
  else
    if v_old <> 0 then
      update public.purchase_invoices
         set amount_paid = greatest(0, amount_paid - v_old)
       where id = old.purchase_invoice_id;
    end if;
    if v_new <> 0 then
      update public.purchase_invoices
         set amount_paid = amount_paid + v_new
       where id = new.purchase_invoice_id;
    end if;
  end if;
  return null;
end $$;
revoke all on function app.expense_bill_paid() from public;

drop trigger if exists expenses_bill_paid on public.expenses;
create trigger expenses_bill_paid
  after insert or update or delete on public.expenses
  for each row execute function app.expense_bill_paid();
