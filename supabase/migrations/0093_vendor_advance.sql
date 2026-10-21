-- ─────────────────────────────────────────────────────────────────────────────
-- 0093 — Advance to a vendor
--
-- The Company Ledger's Vendor Payment had "New Purchase, Paid Now", which made
-- a bill and paid it in one click. It is now "Advance": money paid to a vendor
-- before their bill. Only the debit is recorded; the bill (the credit) comes
-- later and the advance is adjusted against it.
--
--   · finance_categories 'vendor_advance'
--                         treatment 'financing': it is not a cost until the
--                         bill arrives (the bill counts the cost and its GST),
--                         so it stays out of P&L and the Tax Summary. Not
--                         pickable by hand (active = false).
--   · app.expense_bill_link()
--                         an advance keeps its category when it is linked to
--                         the bill it is adjusted against, so an adjusted
--                         advance can still be told from a payment, and goes
--                         back to being an open advance if the bill is deleted.
--                         Everything else about a linked entry is as in 0080.
--
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.finance_categories (key, label, direction, group_label, treatment, hint, sort_order, active) values
  ('vendor_advance', 'Vendor advance', 'out', 'Financing & tax', 'financing',
   'Paid to a vendor before their bill. Adjusted against the bill when it comes, so this is cash only.', 1695, false)
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
  if new.category is distinct from 'vendor_advance' then
    new.category := 'vendor_bill_payment';
  end if;
  new.vendor_id  := v_bill.vendor_id;
  new.tax_amount := 0;
  new.tax_rate   := 0;
  new.billable   := false;
  return new;
end $$;
revoke all on function app.expense_bill_link() from public;
