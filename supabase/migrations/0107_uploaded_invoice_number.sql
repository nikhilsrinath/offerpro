-- 0107: an invoice's number can be changed to anything.
--
-- 0002 froze doc_number after insert. The user wants no such rule on
-- financial documents: the number is whatever they type. The only check left
-- is unique (org_id, doc_number), which refuses a number another document
-- already has. An empty number is still refused (doc_number is NOT NULL and a
-- blank one would be meaningless). HR records keep the freeze.

create or replace function app.freeze_doc_number()
returns trigger language plpgsql as $$
begin
  if new.doc_number is distinct from old.doc_number then
    if tg_table_name = 'financial_documents'
       and nullif(btrim(new.doc_number), '') is not null then
      return new;
    end if;
    raise exception 'doc_number is immutable once issued (% -> %)', old.doc_number, new.doc_number
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
