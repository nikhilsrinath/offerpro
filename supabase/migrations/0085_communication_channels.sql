-- 0085 — client communication channels + approval kind note: Online meet / In person meet, and an
-- optional note on what "Other" was. The legacy 'meeting' value stays valid so
-- existing log entries keep working.

alter table public.client_communications
  add column if not exists channel_other text
    check (channel_other is null or length(channel_other) <= 100);

alter table public.client_communications
  drop constraint if exists client_communications_channel_check;

alter table public.client_communications
  add constraint client_communications_channel_check
  check (channel in ('email', 'phone', 'whatsapp', 'meeting', 'online_meet', 'in_person_meet', 'other'));

-- Send for approval: an optional note on what an "Other" kind was.
alter table public.client_approvals
  add column if not exists item_type_other text
    check (item_type_other is null or length(item_type_other) <= 100);
