-- ============================================================================
-- Opstead · Discount and items on a purchase bill (0099)
--
--   · a bill saves without items or a discount, as before
--   · items and the discount are kept as given
--   · GST and the total come from the subtotal, already net of the discount
--   · a discount type other than percent or amount, a percentage over 100,
--     a negative discount or items that are not a list are refused
--
-- Everything runs in one transaction and rolls back at the end.
-- ============================================================================

\set QUIET on
\pset pager off
\pset tuples_only on
set client_min_messages = notice;

begin;

create or replace function pg_temp.check(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice '  PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end $$;

create or replace function pg_temp.refused(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when check_violation then
  return true;
end $$;

-- ─── Fixture ────────────────────────────────────────────────────────────────

insert into auth.users (id, email) values ('fa000000-0000-0000-0000-000000000001', 'owner@d.test');
insert into organizations (id, company_name, owner_uid) values
  ('faa00000-0000-0000-0000-00000000000a', 'Org D', 'fa000000-0000-0000-0000-000000000001');
insert into vendors (id, org_id, company_name) values
  ('fac00000-0000-0000-0000-000000000001', 'faa00000-0000-0000-0000-00000000000a', 'Cement Co');

-- ─── Without either ─────────────────────────────────────────────────────────

insert into purchase_invoices (id, org_id, vendor_id, bill_number, bill_date, subtotal, tax_rate) values
  ('fad00000-0000-0000-0000-000000000001', 'faa00000-0000-0000-0000-00000000000a',
   'fac00000-0000-0000-0000-000000000001', 'B-1', current_date, 1000, 18);

select pg_temp.check(
  (select items = '[]'::jsonb and discount_type is null and discount_amount = 0 and total = 1180
     from purchase_invoices where id = 'fad00000-0000-0000-0000-000000000001'),
  'a bill without items or a discount saves as before');

-- ─── With both: 2 x 400 + 1 x 200 = 1000, 10% off = 900 net, 18% GST ──────

insert into purchase_invoices (id, org_id, vendor_id, bill_number, bill_date, subtotal, tax_rate,
                               items, discount_type, discount_value, discount_amount) values
  ('fad00000-0000-0000-0000-000000000002', 'faa00000-0000-0000-0000-00000000000a',
   'fac00000-0000-0000-0000-000000000001', 'B-2', current_date, 900, 18,
   '[{"name":"Cement","price":400,"quantity":2,"amount":800},{"name":"Sand","price":200,"quantity":1,"amount":200}]',
   'percent', 10, 100);

select pg_temp.check(
  (select jsonb_array_length(items) = 2 and items->0->>'name' = 'Cement'
          and discount_type = 'percent' and discount_value = 10 and discount_amount = 100
     from purchase_invoices where id = 'fad00000-0000-0000-0000-000000000002'),
  'items and the discount are kept as given');

select pg_temp.check(
  (select tax_amount = 162 and total = 1062
     from purchase_invoices where id = 'fad00000-0000-0000-0000-000000000002'),
  'GST and the total come from the net subtotal');

-- ─── Refused ────────────────────────────────────────────────────────────────

select pg_temp.check(pg_temp.refused($$update purchase_invoices set discount_type = 'coupon'
  where id = 'fad00000-0000-0000-0000-000000000002'$$), 'an unknown discount type is refused');
select pg_temp.check(pg_temp.refused($$update purchase_invoices set discount_value = 120
  where id = 'fad00000-0000-0000-0000-000000000002'$$), 'a percentage over 100 is refused');
select pg_temp.check(pg_temp.refused($$update purchase_invoices set discount_amount = -5
  where id = 'fad00000-0000-0000-0000-000000000002'$$), 'a negative discount is refused');
select pg_temp.check(pg_temp.refused($$update purchase_invoices set items = '{"name":"x"}'
  where id = 'fad00000-0000-0000-0000-000000000002'$$), 'items that are not a list are refused');

rollback;
