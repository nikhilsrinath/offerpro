-- ─────────────────────────────────────────────────────────────────────────────
-- 0099 — Discount and items on purchase bills
--
-- A vendor's bill (a Credit on the Vendor ledgers) can now list what was
-- bought, and carry a discount on it.
--
--   · purchase_invoices.items            [{name, price, quantity, amount}],
--                                        optional; when there are any, the
--                                        amount before tax is their sum
--   · purchase_invoices.discount_type    'percent' | 'amount' | null
--   · purchase_invoices.discount_value   what was typed: 10 (%), or 500
--   · purchase_invoices.discount_amount  the discount in money, taken off the
--                                        amount before tax (not off the other
--                                        amount, which is taxed at its own rate)
--
-- subtotal stays the amount the bill is taxed on: already net of the discount.
-- So app.purchase_invoice_guard() (0086), the Tax Summary, Profit & Loss and
-- project splits read it unchanged, and the discount is never counted twice.
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.purchase_invoices
  add column if not exists items           jsonb         not null default '[]'::jsonb,
  add column if not exists discount_type   text,
  add column if not exists discount_value  numeric(14,2) not null default 0,
  add column if not exists discount_amount numeric(14,2) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'purchase_invoices_items_array') then
    alter table public.purchase_invoices
      add constraint purchase_invoices_items_array check (jsonb_typeof(items) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'purchase_invoices_discount_type') then
    alter table public.purchase_invoices
      add constraint purchase_invoices_discount_type check (discount_type is null or discount_type in ('percent', 'amount'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'purchase_invoices_discount_values') then
    alter table public.purchase_invoices
      add constraint purchase_invoices_discount_values check (
        discount_value >= 0 and discount_amount >= 0
        and (discount_type is distinct from 'percent' or discount_value <= 100));
  end if;
end $$;
