-- ─────────────────────────────────────────────────────────────────────────────
-- 0115 — The entries behind each line of a project's Profit & Loss
--
-- The project Profit & Loss page lost its "Costs by Category" card (bug list
-- 18 Nov 2026). Instead, clicking a line of the Statement (Invoiced Revenue,
-- Other Income, Vendor Bills, Other Expenses) opens a side panel listing what
-- that line is made of. So the panel always adds up to the line, its rows
-- come from the same loop app.project_financials_calc (0110) runs, row for
-- row, rather than being worked out again in the browser.
--
--   public.project_pl_lines(project, from, to)
--     one row per source counted on a line:
--       line         'invoiced_revenue' | 'other_income' | 'vendor_bills' | 'other_expenses'
--       source_type  invoice | income_entry | expense | purchase_invoice
--       source_id    the invoice, entry or bill
--       on_date      the date the line counts it on
--       label        invoice / bill number, or the entry's description
--       category     the entry's or bill's category key (null for invoices)
--       amount       what it adds to the line, before GST, at this project's
--                    share (a cost recovery is negative on Other Expenses)
--
-- Read-only, same gate as public.project_financials: the caller needs
-- project_financials:view in the project's organization. No table, no
-- role_permissions rows.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.project_pl_lines(p_project_id uuid, p_from date default null, p_to date default null)
returns table (line text, source_type text, source_id uuid, on_date date,
               label text, category text, amount numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
  r     record;
begin
  select p.org_id into v_org from public.projects p where p.id = p_project_id;
  -- Same answer for "no such project" and "not yours": neither leaks existence.
  if v_org is null or not app.has_permission(v_org, 'project_financials', 'view') then
    raise exception 'PERMISSION_DENIED: project financials are not available to you'
      using errcode = 'insufficient_privilege';
  end if;

  for r in select * from app.project_allocation_rows(p_project_id) loop
    -- Only what falls in the period, as app.project_financials_calc counts it.
    continue when r.on_date is null
               or (p_from is not null and r.on_date < p_from)
               or (p_to   is not null and r.on_date > p_to);

    line := null;
    if r.source_type = 'invoice' then
      if r.counts then
        line := 'invoiced_revenue'; amount := r.allocated;
      end if;

    elsif r.source_type = 'income_entry' then
      if r.treatment in ('revenue', 'other_income') and r.linked_document is null then
        -- Only what was not laid over a client invoice (0110).
        line := 'other_income'; amount := r.allocated * app.client_receipt_unapplied_share(r.source_id);
      elsif r.treatment = 'cost_recovery' then
        line := 'other_expenses'; amount := -r.allocated;
      end if;

    elsif r.source_type = 'expense' then
      if r.treatment in ('operating', 'non_operating') then
        -- The part of a debit to a vendor that pays their bills is the bill's cost (0110).
        line := 'other_expenses'; amount := r.allocated * app.vendor_cost_unapplied_share(r.source_id);
      end if;

    elsif r.source_type = 'purchase_invoice' then
      if r.counts then
        line := 'vendor_bills'; amount := r.allocated;
      end if;
    end if;

    -- A source that adds nothing (a receipt wholly laid over invoices, a
    -- vendor payment wholly against bills) is not listed.
    continue when line is null or abs(coalesce(amount, 0)) < 0.005;
    source_type := r.source_type::text;
    source_id   := r.source_id;
    on_date     := r.on_date;
    label       := r.label;
    category    := r.category;
    return next;
  end loop;
end $$;

revoke execute on function public.project_pl_lines(uuid, date, date) from public, anon;
grant execute on function public.project_pl_lines(uuid, date, date) to authenticated;
