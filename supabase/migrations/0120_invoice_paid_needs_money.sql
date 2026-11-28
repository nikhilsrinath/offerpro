-- ═════════════════════════════════════════════════════════════════════════════
-- 0120 · An invoice is paid only when money says so
-- ═════════════════════════════════════════════════════════════════════════════
--
-- The new-invoice form's Paid switch used to save the invoice with
-- status = 'paid' and record no money: no receipt on the ledger, no payment on
-- the invoice. Such an invoice read Paid while Received said 0, and there was
-- nothing to delete to make it unpaid again. The switch now records a real
-- receipt (as Mark Paid does), and app.recompute_amount_paid() (0110) is what
-- sets the status from the confirmed payments.
--
-- This puts the invoices saved the old way where their money puts them, with
-- the same rule as app.recompute_amount_paid(): nothing received → sent (the
-- app marks it overdue past its due date), some → partially paid. The ones
-- that were really paid are marked paid again with Mark Paid, at the real
-- date and amount.
--
-- Safe to run more than once.

update public.financial_documents d
   set status = case when coalesce(d.amount_paid, 0) > 0
                     then 'partially_paid'::doc_status
                     else 'sent'::doc_status end
 where d.type = 'invoice'
   and d.status::text = 'paid'
   and coalesce(d.amount_paid, 0) < coalesce(d.grand_total, 0) - 0.01;
