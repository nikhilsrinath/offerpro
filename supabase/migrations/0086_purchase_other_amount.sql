-- ─────────────────────────────────────────────────────────────────────────────
-- 0086 — Other amount on purchase bills
--
-- A vendor bill often carries a second charge (freight, packing, installation)
-- that is taxed at its own GST rate. The Purchase Bills form takes it as
-- "Other amount" with its own rate.
--
--   · purchase_invoices.other_amount    part of subtotal, default 0
--   · purchase_invoices.other_label     what it is for (free text, optional)
--   · purchase_invoices.other_tax_rate  GST rate on that part, default 0
--   · app.purchase_invoice_guard()      tax_amount := GST on (subtotal -
--                                       other_amount) at tax_rate + GST on
--                                       other_amount at other_tax_rate
--
-- subtotal stays the whole amount before tax (main + other), so the Tax
-- Summary, Profit & Loss and project splits read it unchanged.
-- Body is otherwise 0079's. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.purchase_invoices
  add column if not exists other_amount   numeric(14,2) not null default 0 check (other_amount >= 0),
  add column if not exists other_label    text,
  add column if not exists other_tax_rate numeric(5,2)  not null default 0 check (other_tax_rate between 0 and 100);

create or replace function app.purchase_invoice_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.vendors v
                  where v.id = new.vendor_id and v.org_id = new.org_id) then
    raise exception 'vendor % does not belong to this organization', new.vendor_id
      using errcode = '23503';
  end if;

  new.other_amount   := coalesce(new.other_amount, 0);
  new.other_tax_rate := coalesce(new.other_tax_rate, 0);
  if new.other_amount > new.subtotal then
    raise exception 'other amount cannot exceed the amount before tax'
      using errcode = '23514';
  end if;
  new.tax_amount := round((new.subtotal - new.other_amount) * new.tax_rate / 100, 2)
                  + round(new.other_amount * new.other_tax_rate / 100, 2);
  new.round_off  := coalesce(new.round_off, 0);
  new.total      := new.subtotal + new.tax_amount + new.round_off;
  if new.total < 0 then
    raise exception 'round off cannot take the bill total below zero'
      using errcode = '23514';
  end if;
  if new.status <> 'void' then
    new.status := case
      when new.total > 0 and new.amount_paid >= new.total - 0.01 then 'paid'
      when new.amount_paid > 0 then 'partially_paid'
      else 'unpaid' end;
  end if;
  if new.status = 'paid' and new.paid_on is null then new.paid_on := current_date; end if;
  if new.status <> 'paid' then new.paid_on := null; end if;
  new.updated_at := now();
  return new;
end $$;
