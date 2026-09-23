/**
 * Turns spreadsheet rows into CRM leads.
 *
 * Headers are matched loosely (case, spaces and punctuation ignored) against the
 * aliases below, because every exported lead list names its columns differently.
 * Columns that match nothing are kept, appended to the lead's notes as
 * "Header: value", so importing never throws information away.
 */

const FIELD_ALIASES = {
  company_name: ['company', 'companyname', 'organization', 'organisation', 'org', 'business', 'businessname', 'account', 'accountname', 'firm', 'client', 'clientname'],
  person_name: ['name', 'fullname', 'contact', 'contactname', 'contactperson', 'person', 'personname', 'leadname', 'customername'],
  first_name: ['firstname', 'first', 'fname', 'givenname'],
  last_name: ['lastname', 'last', 'lname', 'surname', 'familyname'],
  email: ['email', 'emailaddress', 'mail', 'emailid', 'workemail'],
  phone: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'mobileno', 'phoneno', 'contactnumber', 'contactno', 'whatsapp', 'whatsappnumber', 'tel', 'telephone', 'cell'],
  stage: ['stage', 'status', 'leadstatus', 'pipeline', 'pipelinestage'],
  value: ['value', 'dealvalue', 'amount', 'budget', 'dealsize', 'revenue'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks', 'remark', 'description'],
};

const STAGE_ALIASES = {
  lead: ['lead', 'new', 'open', 'cold', 'prospect'],
  contacted: ['contacted', 'inprogress', 'followup', 'warm', 'called', 'emailed', 'qualified', 'negotiation'],
  deal: ['deal', 'won', 'closed', 'closedwon', 'converted', 'customer', 'active', 'hot'],
  not_deal: ['notdeal', 'lost', 'closedlost', 'rejected', 'dead', 'notinterested', 'junk'],
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (v) => String(v ?? '').trim();

/** Maps each header of the sheet to a lead field, or null when unrecognised. */
export function mapHeaders(headers) {
  const used = new Set();
  const mapping = {};
  for (const h of headers) {
    const key = norm(h);
    const field = Object.keys(FIELD_ALIASES).find(f => !used.has(f) && FIELD_ALIASES[f].includes(key));
    mapping[h] = field || null;
    if (field) used.add(field);
  }
  return mapping;
}

function toStage(v) {
  const key = norm(v);
  if (!key) return 'lead';
  return Object.keys(STAGE_ALIASES).find(s => STAGE_ALIASES[s].includes(key)) || 'lead';
}

/** Identity used to skip leads that already exist (or repeat within the sheet). */
export function leadKey(l) {
  const email = clean(l.email).toLowerCase();
  if (email) return `e:${email}`;
  const phone = clean(l.phone).replace(/\D/g, '');
  if (phone.length >= 6) return `p:${phone}`;
  const name = norm(l.person_name) + '|' + norm(l.company_name);
  return name === '|' ? null : `n:${name}`;
}

/**
 * @returns {{ leads: object[], skippedEmpty: number, skippedDuplicate: number, mapping: object }}
 */
export function rowsToLeads(rows, existingLeads = []) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const mapping = mapHeaders(headers);
  const seen = new Set(existingLeads.map(leadKey).filter(Boolean));
  const leads = [];
  let skippedEmpty = 0;
  let skippedDuplicate = 0;

  for (const row of rows) {
    const lead = {};
    const extraNotes = [];
    for (const [header, raw] of Object.entries(row)) {
      const v = clean(raw);
      if (!v) continue;
      const field = mapping[header];
      if (field) lead[field] = v;
      else if (!header.startsWith('__EMPTY')) extraNotes.push(`${header}: ${v}`);
    }

    if (!lead.person_name && (lead.first_name || lead.last_name)) {
      lead.person_name = [lead.first_name, lead.last_name].filter(Boolean).join(' ');
    }
    delete lead.first_name;
    delete lead.last_name;

    if (!lead.person_name && !lead.company_name && !lead.email && !lead.phone) {
      skippedEmpty++;
      continue;
    }

    const key = leadKey(lead);
    if (key && seen.has(key)) { skippedDuplicate++; continue; }
    if (key) seen.add(key);

    const value = lead.value ? Number(String(lead.value).replace(/[^0-9.-]/g, '')) : null;
    leads.push({
      company_name: lead.company_name || '',
      person_name: lead.person_name || '',
      email: lead.email || '',
      phone: lead.phone || '',
      notes: [lead.notes, ...extraNotes].filter(Boolean).join('\n'),
      stage: toStage(lead.stage),
      ...(Number.isFinite(value) ? { value } : {}),
    });
  }

  return { leads, skippedEmpty, skippedDuplicate, mapping };
}
