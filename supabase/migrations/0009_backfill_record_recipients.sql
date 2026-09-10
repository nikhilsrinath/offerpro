-- ============================================================================
-- 0009_backfill_record_recipients.sql — move the recipient out of the blob.
--
-- storageService.save() writes the whole form to records.data and left the
-- promoted columns null, so documents created from the Offer Letter and Add
-- Employee pages have no recipient_name and no recipient_email. The portal
-- addressed them to nobody, the tracker showed "—" in the Candidate column and
-- the Email action had no address to send to.
--
-- orgStore/docShape now read through to the blob so those rows render, and
-- records.toRow promotes the columns on every write from here on. This fills in
-- what is already stored. Only nulls are touched, so it is safe to re-run.
--
-- Run AFTER 0008, and in its own statement.
-- ============================================================================

update records
   set recipient_name  = coalesce(recipient_name,
                                  nullif(data->>'studentName', ''),
                                  nullif(data->>'recipientName', ''),
                                  nullif(data->>'name', '')),
       recipient_email = coalesce(recipient_email, nullif(data->>'email', ''))
 where recipient_name is null
    or recipient_email is null;
