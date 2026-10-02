-- ─────────────────────────────────────────────────────────────────────────────
-- 0079 — Round off on purchase bills
--
-- A vendor's printed bill is often rounded (₹11,799.60 billed as ₹11,800).
-- The Purchase Bills form lets the user type the bill's final total; the
-- difference from subtotal + GST is kept as round_off and shown as its own
-- line, so the GST figures stay exact and the payable matches the paper.
--
--   · purchase_invoices.round_off   signed, default 0
--   · app.purchase_invoice_guard()  total := subtotal + tax_amount + round_off
--
-- Body is otherwise 0028's, character for character. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.purchase_invoices
  add column if not exists round_off numeric(14,2) not null default 0;

create or replace function app.purchase_invoice_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.vendors v
                  where v.id = new.vendor_id and v.org_id = new.org_id) then
    raise exception 'vendor % does not belong to this organization', new.vendor_id
      using errcode = '23503';
  end if;

  new.tax_amount := round(new.subtotal * new.tax_rate / 100, 2);
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
