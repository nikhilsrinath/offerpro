/**
 * EdgeOS migration · Step 2 — Transform
 *
 * Reads the raw Firebase export produced by 01-extract.js and emits normalized,
 * load-ready JSON matching the Postgres schema in supabase/migrations/0001_init.sql.
 *
 * This is where every quirk found in the codebase audit is dealt with. Each is
 * annotated with the source that proves it.
 *
 *   node scripts/migrate/02-transform.js \
 *     --in .migration/raw --out .migration/ready
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Legacy id → uuid, stable across re-runs so the whole pipeline is idempotent.
// ─────────────────────────────────────────────────────────────────────────────
const idMap = new Map();          // `${entity}:${legacyId}` -> uuid
const idRows = [];                // rows for the legacy_id_map table

function uuidFor(entity, legacyId, orgId = null, source = 'both') {
  if (legacyId == null || legacyId === '') return randomUUID();
  const key = `${entity}:${legacyId}`;
  if (!idMap.has(key)) {
    const id = randomUUID();
    idMap.set(key, id);
    idRows.push({ entity, legacy_id: String(legacyId), new_id: id, org_id: orgId, source });
  }
  return idMap.get(key);
}
const lookup = (entity, legacyId) =>
  legacyId == null ? null : (idMap.get(`${entity}:${legacyId}`) ?? null);

// ─────────────────────────────────────────────────────────────────────────────
// Coercion. Firebase stored numbers as strings, dates in four formats, and
// booleans as 'Yes'/'No' (dualWriteService.js:47 `include_logo: formData.include_logo === 'Yes'`).
// ─────────────────────────────────────────────────────────────────────────────
const nn = (v) => (v === undefined || v === '' ? null : v);

function num(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(String(v).replace(/[,\s₹]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}
function money(v, fallback = 0) {
  return Math.round(num(v, fallback) * 100) / 100;
}
function bool(v, fallback = false) {
  if (typeof v === 'boolean') return v;
  if (v === 'Yes' || v === 'true' || v === 1 || v === '1') return true;
  if (v === 'No'  || v === 'false' || v === 0 || v === '0') return false;
  return fallback;
}
function ts(v) {
  if (!v) return null;
  if (typeof v === 'object') {
    // Firestore Timestamp, in either export shape
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    if (v._seconds  != null) return new Date(v._seconds  * 1000).toISOString();
    if (v.seconds   != null) return new Date(v.seconds   * 1000).toISOString();
  }
  if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000).toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function date(v) {
  const t = ts(v);
  return t ? t.slice(0, 10) : null;
}
function email(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY: the company_profile snapshot scrub.
//
// Every financial document and offer letter embeds `company_profile: {...company}`
// (QuotationForm.jsx:277, ProformaInvoiceForm.jsx:200, InvoiceForm.jsx:217,
// OfferForm.jsx:179, Employees.jsx:103,122, OfferTracker.jsx:1058,
// BulkOfferLetters.jsx:131), where `company` is orgStore.getProfile() — the FULL
// PROFILE_FIELDS set. That includes gmail_app_password and bank_account_number
// (orgStore.js:31,36).
//
// Those documents are served to unauthenticated recipients through the portal.
// So the Gmail App Password is duplicated into potentially every document in the
// database. Nothing may carry it into Postgres.
// ─────────────────────────────────────────────────────────────────────────────
const SECRET_KEYS = new Set([
  'gmail_app_password', 'gmail_user',
  'emailjs_service_id', 'emailjs_template_id', 'emailjs_public_key',
  'bank_account_number', 'bank_ifsc', 'bank_name', 'bank_account_type',
  'upi_id', 'gstin', 'cin',
  'plan', 'is_premium', 'ai_message_count', 'owner_uid',
]);

let scrubCount = 0;
function scrubSnapshot(profile) {
  if (!profile || typeof profile !== 'object') return {};
  const clean = {};
  for (const [k, v] of Object.entries(profile)) {
    if (SECRET_KEYS.has(k)) { scrubCount++; continue; }
    if (typeof v === 'string' && v.startsWith('data:')) continue;  // base64 image → Storage
    clean[k] = v;
  }
  return clean;
}

// Base64 images are pulled out for 03-load.js to upload to Storage.
const assets = [];
function extractImage(dataUrl, orgId, kind, ownerId = null) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[m[1]] || 'bin';
  const bucket = kind === 'signature' ? 'signatures' : 'org-branding';
  const path = `${orgId}/${kind}-${ownerId ?? randomUUID()}.${ext}`;
  assets.push({ bucket, path, mime: m[1], base64: m[2] });
  return path;
}

// ─────────────────────────────────────────────────────────────────────────────
const out = {
  organizations: [], org_banking: [], org_secrets: [], org_settings: [],
  memberships: [], subscriptions: [], departments: [], employees: [],
  employee_compensation: [], tasks: [], customers: [], crm_leads: [],
  products: [], expenses: [], records: [], financial_documents: [],
  document_line_items: [], payments: [], recurring_invoices: [],
  document_signatures: [], notifications: [], ai_company_memory: [],
};
const warnings = [];
const warn = (m) => { warnings.push(m); };

// ─────────────────────────────────────────────────────────────────────────────
export function transformOrg(orgId, src, authUsers) {
  const newOrgId = uuidFor('organization', orgId);
  const p = src.profile ?? {};

  const ownerUid = authUsers.get(p.owner_uid) ? p.owner_uid : null;
  if (!ownerUid) warn(`org ${orgId}: owner_uid ${p.owner_uid} not in the auth export — needs manual assignment`);

  // ── organizations ──────────────────────────────────────────────────────────
  out.organizations.push({
    id: newOrgId,
    company_name: String(p.company_name ?? p.name ?? 'Untitled Organization').slice(0, 200).trim() || 'Untitled Organization',
    company_tagline: nn(p.company_tagline)?.slice(0, 300) ?? null,
    company_email: email(p.company_email),
    company_phone: nn(p.company_phone),
    company_website: nn(p.company_website),
    company_address: nn(p.company_address),
    company_description: nn(p.company_description),
    owner_uid: ownerUid,
    owner_full_name: nn(p.owner_full_name),
    owner_role: nn(p.owner_role),
    document_designation: nn(p.document_designation),
    primary_contact_name: nn(p.primary_contact_name),
    logo_path:      extractImage(p.logo_url,      newOrgId, 'logo'),
    signature_path: extractImage(p.signature_url, newOrgId, 'signature'),
    stamp_path:     extractImage(p.stamp_url,     newOrgId, 'stamp'),
    stamp_type: nn(p.stamp_type),
    stamp_city: nn(p.stamp_city),
    include_logo: bool(p.include_logo, true),
    industry: nn(p.industry), country: nn(p.country), city: nn(p.city),
    company_size: nn(p.company_size),
    use_cases: Array.isArray(p.use_cases) ? p.use_cases.map(String)
             : p.use_cases ? [String(p.use_cases)] : [],
    account_usage: nn(p.account_usage),
    referral_source: nn(p.referral_source),
    created_at: ts(p.created_at) ?? new Date().toISOString(),
  });

  out.org_banking.push({
    org_id: newOrgId,
    // Reject rather than import malformed values; the CHECK constraints would
    // fail the load and a bad GSTIN is worse than a null one.
    gstin: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(String(p.gstin ?? '').toUpperCase())
             ? String(p.gstin).toUpperCase() : null,
    cin: nn(p.cin),
    upi_id: nn(p.upi_id),
    bank_name: nn(p.bank_name),
    bank_account_number: nn(p.bank_account_number),
    bank_ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(p.bank_ifsc ?? '').toUpperCase())
             ? String(p.bank_ifsc).toUpperCase() : null,
    bank_account_type: nn(p.bank_account_type),
  });
  if (p.gstin && !out.org_banking.at(-1).gstin) warn(`org ${orgId}: GSTIN "${p.gstin}" is malformed — dropped, re-enter in the app`);
  if (p.bank_ifsc && !out.org_banking.at(-1).bank_ifsc) warn(`org ${orgId}: IFSC "${p.bank_ifsc}" is malformed — dropped`);

  // Credentials are NOT carried over. They were stored in plaintext and are
  // considered compromised; 03-load leaves org_secrets empty and each customer
  // re-enters an App Password after revoking the old one in their Google account.
  if (p.gmail_app_password) {
    out.org_secrets.push({ org_id: newOrgId, gmail_user: email(p.gmail_user) });
    warn(`org ${orgId}: had a plaintext Gmail App Password. NOT migrated — the customer must revoke it in Google and re-enter it.`);
  }

  out.org_settings.push({
    org_id: newOrgId,
    hierarchy: src.hierarchy && typeof src.hierarchy === 'object'
      ? { nodes: src.hierarchy.nodes ?? {}, edges: src.hierarchy.edges ?? {} }
      : { nodes: {}, edges: {} },
  });

  // plan lived on the org profile and was client-writable. It is carried across
  // as-is, but into a table no client can write.
  out.subscriptions.push({
    org_id: newOrgId,
    plan: ['free', 'pro', 'max'].includes(p.plan) ? p.plan : (bool(p.is_premium) ? 'pro' : 'free'),
    status: 'active',
  });

  // ── memberships ────────────────────────────────────────────────────────────
  for (const m of src.memberships ?? []) {
    if (!authUsers.get(m.user_id)) { warn(`org ${orgId}: membership for unknown user ${m.user_id} — skipped`); continue; }
    out.memberships.push({
      org_id: newOrgId,
      user_id: m.user_id,
      role: ['owner', 'admin', 'member', 'viewer'].includes(m.role) ? m.role : 'member',
      created_at: ts(m.created_at) ?? new Date().toISOString(),
    });
  }
  if (ownerUid && !out.memberships.some(m => m.org_id === newOrgId && m.user_id === ownerUid)) {
    out.memberships.push({ org_id: newOrgId, user_id: ownerUid, role: 'owner', created_at: new Date().toISOString() });
  }

  // ── departments ────────────────────────────────────────────────────────────
  // employees.department is a NAME string (EmployeeForm.jsx:40), not a reference.
  // Build the department set from both the departments collection and every
  // distinct name actually used, so no employee loses its department.
  const deptByName = new Map();
  const addDept = (name, legacyId = null) => {
    const clean = String(name ?? '').trim();
    if (!clean) return null;
    const k = clean.toLowerCase();
    if (!deptByName.has(k)) {
      const id = legacyId ? uuidFor('department', legacyId, newOrgId) : randomUUID();
      deptByName.set(k, id);
      out.departments.push({ id, org_id: newOrgId, name: clean, created_at: new Date().toISOString() });
    } else if (legacyId) {
      idMap.set(`department:${legacyId}`, deptByName.get(k));
    }
    return deptByName.get(k);
  };
  for (const [legacyId, d] of Object.entries(src.departments ?? {})) addDept(d?.name, legacyId);

  // ── employees (+ ex_employees merged in) ───────────────────────────────────
  // Firebase DELETED the employee from `employees` and re-inserted it into
  // `ex_employees` under the same key (Employees.jsx:725-730), which orphaned
  // every task and document pointing at that id. Here they are one table.
  const employeeRows = new Map();

  const pushEmployee = (legacyId, e, exited) => {
    if (!e || typeof e !== 'object') return;
    const id = uuidFor('employee', legacyId, newOrgId);
    const name = String(e.studentName ?? e.name ?? e.full_name ?? '').trim();
    if (!name) { warn(`org ${orgId}: employee ${legacyId} has no name — imported as "Unnamed"`); }

    employeeRows.set(id, {
      id, org_id: newOrgId,
      full_name: name || 'Unnamed',
      email: email(e.email),
      phone: nn(e.phone),
      address: nn(e.studentAddress ?? e.address),
      role: nn(e.role),
      department_id: addDept(e.department),
      employment_type: ['fulltime', 'intern', 'contract', 'parttime'].includes(e.offerType)
        ? e.offerType : 'fulltime',
      reports_to: null,                      // second pass, below
      supervisor_name: nn(e.supervisorName),
      responsibilities: nn(e.responsibilities),
      is_owner: bool(e.is_owner),
      start_date: date(e.startDate),
      end_date: date(e.endDate),
      acceptance_deadline: date(e.acceptanceDeadline),
      exited_at: exited
        ? (ts(e.terminated_at) ?? ts(e.termination_date) ?? ts(e.archived_at) ?? new Date().toISOString())
        : null,
      exit_reason: exited ? nn(e.termination_reason ?? e.exit_reason) : null,
      created_at: ts(e.created_at) ?? new Date().toISOString(),
      _legacy: { id: legacyId, stipend: e.stipend ?? e.salary, currency: e.currency, isPaid: e.isPaid, paymentFrequency: e.paymentFrequency, supervisorId: e.supervisor_id ?? e.reports_to },
    });
  };

  for (const [legacyId, e] of Object.entries(src.employees ?? {}))    pushEmployee(legacyId, e, false);
  for (const [legacyId, e] of Object.entries(src.ex_employees ?? {})) {
    // If the same id exists in both, ex_employees wins — it is the later state.
    pushEmployee(legacyId, e, true);
  }

  // Enforce the single-owner index; keep the earliest.
  let ownerSeen = false;
  for (const e of employeeRows.values()) {
    if (e.is_owner) {
      if (ownerSeen) { e.is_owner = false; warn(`org ${orgId}: more than one is_owner employee — kept the first`); }
      ownerSeen = true;
    }
  }

  // Reporting lines: prefer the hierarchy edges the org chart actually saved
  // (TeamHierarchy.jsx:631), falling back to a supervisor id on the employee.
  const edges = Object.values(src.hierarchy?.edges ?? {});
  for (const edge of edges) {
    const child  = lookup('employee', edge.target);
    const parent = lookup('employee', edge.source);
    if (child && parent && employeeRows.has(child) && child !== parent) {
      employeeRows.get(child).reports_to = parent;
    }
  }
  for (const e of employeeRows.values()) {
    if (!e.reports_to && e._legacy.supervisorId) {
      const parent = lookup('employee', e._legacy.supervisorId);
      if (parent && parent !== e.id) e.reports_to = parent;
    }
  }
  // Break any cycle the Firebase data allowed; the FK would accept it but the
  // org chart would loop forever.
  for (const e of employeeRows.values()) {
    const seen = new Set([e.id]);
    let cur = e.reports_to;
    while (cur) {
      if (seen.has(cur)) { warn(`org ${orgId}: reporting cycle at ${e.full_name} — link cleared`); e.reports_to = null; break; }
      seen.add(cur);
      cur = employeeRows.get(cur)?.reports_to ?? null;
    }
  }

  for (const e of employeeRows.values()) {
    const legacy = e._legacy; delete e._legacy;
    out.employees.push(e);
    if (legacy.stipend != null && legacy.stipend !== '') {
      out.employee_compensation.push({
        employee_id: e.id, org_id: newOrgId,
        is_paid: bool(legacy.isPaid, true),
        amount: money(legacy.stipend, 0),
        currency: (legacy.currency || 'INR').slice(0, 3).toUpperCase(),
        payment_frequency: legacy.paymentFrequency || 'Monthly',
      });
    }
  }

  // ── tasks ──────────────────────────────────────────────────────────────────
  // taskStore.ts uses camelCase createdAt/updatedAt and a hyphenated
  // 'in-progress' status; both are normalized here.
  const TASK_STATUS = { pending: 'pending', 'in-progress': 'in_progress', in_progress: 'in_progress', done: 'done', overdue: 'overdue' };
  let taskPos = 0;
  for (const [legacyId, t] of Object.entries(src.tasks ?? {})) {
    if (!t?.title) continue;
    const assignee = lookup('employee', t.assignedTo);
    out.tasks.push({
      id: uuidFor('task', legacyId, newOrgId),
      org_id: newOrgId,
      title: String(t.title).trim(),
      description: nn(t.description),
      status: TASK_STATUS[t.status] ?? 'pending',
      priority: ['low', 'medium', 'high'].includes(t.priority) ? t.priority : 'medium',
      assignee_id: assignee,
      assignee_label: assignee ? null : nn(t.assignedName),
      deadline: date(t.deadline),
      notes: nn(t.notes),
      follow_up_sent_at: ts(t.followUpSentAt),
      position: taskPos++,
      created_at: ts(t.createdAt ?? t.created_at) ?? new Date().toISOString(),
    });
    if (t.assignedTo && !assignee) warn(`org ${orgId}: task "${t.title}" pointed at missing employee ${t.assignedTo} — name kept as a label`);
  }

  // ── customers ──────────────────────────────────────────────────────────────
  // Firebase names: clientName / clientEmail / clientAddress / buyerGSTIN /
  // buyerState / contactPhone (customerService.js:48).
  // customerService.deduplicate() matched case-insensitively on name, which the
  // new unique index enforces — so collapse duplicates here rather than failing
  // the load.
  const customerByName = new Map();
  for (const [legacyId, c] of Object.entries(src.customers ?? {})) {
    const name = String(c?.clientName ?? c?.name ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (customerByName.has(key)) {
      idMap.set(`customer:${legacyId}`, customerByName.get(key));   // alias the duplicate
      warn(`org ${orgId}: duplicate customer "${name}" merged`);
      continue;
    }
    const id = uuidFor('customer', legacyId, newOrgId);
    customerByName.set(key, id);
    out.customers.push({
      id, org_id: newOrgId, name,
      email: email(c.clientEmail ?? c.email),
      phone: nn(c.contactPhone ?? c.phone),
      address: nn(c.clientAddress ?? c.address),
      gstin: nn(c.buyerGSTIN ?? c.gstin),
      state: nn(c.buyerState ?? c.state),
      created_at: ts(c.created_at) ?? new Date().toISOString(),
    });
  }
  const customerIdForName = (n) => customerByName.get(String(n ?? '').trim().toLowerCase()) ?? null;

  // ── crm_leads / products / expenses ────────────────────────────────────────
  let leadPos = 0;
  for (const [legacyId, l] of Object.entries(src.crm_leads ?? {})) {
    const company = nn(l?.company_name), person = nn(l?.person_name);
    if (!company && !person) continue;                       // violates crm_leads_named
    // company_name/person_name/value/updated_at are pulled out to keep them OUT
    // of ...extra — they are written explicitly below from `company`/`person`.
    const { company_name: _cn, person_name: _pn, email: e, phone, status, stage,
            value: _v, notes, created_at, updated_at: _u, id: _i, ...extra } = l;
    out.crm_leads.push({
      id: uuidFor('crm_lead', legacyId, newOrgId),
      org_id: newOrgId, company_name: company, person_name: person,
      email: email(e), phone: nn(phone),
      stage: nn(stage ?? status) ?? 'lead',
      value: l.value != null ? money(l.value) : null,
      notes: nn(notes), position: leadPos++,
      extra: Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)),
      created_at: ts(created_at) ?? new Date().toISOString(),
    });
  }

  for (const [legacyId, pr] of Object.entries(src.products ?? {})) {
    if (!pr?.name) continue;
    out.products.push({
      id: uuidFor('product', legacyId, newOrgId), org_id: newOrgId,
      name: String(pr.name).trim(),
      description: nn(pr.description),
      status: nn(pr.status) ?? 'planned',
      priority: nn(pr.priority) ?? 'medium',
      due_date: date(pr.due_date),
      created_at: ts(pr.created_at) ?? new Date().toISOString(),
    });
  }

  for (const [legacyId, x] of Object.entries(src.expenses ?? {})) {
    if (!x?.description) continue;
    const amount = money(x.amount);
    if (amount < 0) { warn(`org ${orgId}: expense "${x.description}" was negative (${x.amount}) — imported as 0`); }
    out.expenses.push({
      id: uuidFor('expense', legacyId, newOrgId), org_id: newOrgId,
      description: String(x.description).trim(),
      amount: Math.max(0, amount),
      category: nn(x.category) ?? 'Operations',
      incurred_on: date(x.date ?? x.incurred_on) ?? new Date().toISOString().slice(0, 10),
      created_at: ts(x.created_at) ?? new Date().toISOString(),
    });
  }

  // ── records (HR documents) ─────────────────────────────────────────────────
  // Sources: organizations/{orgId}/records AND the legacy RTDB path
  // organizations/{orgId}/hr_records (admin/index.html:590).
  const HR_TYPES = new Set(['offer', 'certificate', 'nda', 'mou']);
  const seenRecordNumbers = new Set();
  const recordSources = { ...(src.hr_records ?? {}), ...(src.records ?? {}) };

  for (const [legacyId, r] of Object.entries(recordSources)) {
    if (!r || !HR_TYPES.has(r.type)) continue;
    const id = uuidFor('record', legacyId, newOrgId);
    const data = r.data ?? {};

    // Firebase used the human number as the key; where it is missing or already
    // taken, mint a deterministic one so the (org_id, doc_number) unique index holds.
    let docNumber = String(r.doc_number ?? r.id ?? legacyId);
    if (!/^[A-Z]{2,3}-\d{4}-\d+$/.test(docNumber) || seenRecordNumbers.has(docNumber)) {
      const prefix = { offer: 'OL', certificate: 'CRT', nda: 'NDA', mou: 'MOU' }[r.type];
      const yr = (ts(r.created_at) ?? new Date().toISOString()).slice(0, 4);
      let n = 1, candidate;
      do { candidate = `${prefix}-${yr}-${String(n++).padStart(4, '0')}`; } while (seenRecordNumbers.has(candidate));
      if (docNumber !== candidate) warn(`org ${orgId}: record ${legacyId} had number "${docNumber}" — reassigned ${candidate}`);
      docNumber = candidate;
    }
    seenRecordNumbers.add(docNumber);

    out.records.push({
      id, org_id: newOrgId, doc_number: docNumber, type: r.type,
      status: normalizeStatus(r.status, data),
      title: String(r.title ?? data.studentName ?? data.recipientName ?? docNumber).slice(0, 500),
      employee_id: lookup('employee', r.employee_id ?? data.employee_id),
      recipient_name: nn(data.studentName ?? data.recipientName ?? r.title),
      recipient_email: email(data.email ?? data.recipientEmail),
      issue_date: date(r.created_at) ?? new Date().toISOString().slice(0, 10),
      data: stripImages(data, newOrgId, id),
      company_snapshot: scrubSnapshot(r.company_profile ?? data.company_profile),
      created_at: ts(r.created_at) ?? new Date().toISOString(),
    });

    collectSignature(r, newOrgId, { record_id: id });
  }

  // ── financial documents ────────────────────────────────────────────────────
  // Three Firebase sources are reconciled: the RTDB tree, the flat Firestore
  // `fin_docs` collection, and the Firestore SUBcollection
  // organizations/{orgId}/fin_docs (admin/index.html:595). 01-extract merges
  // them; later updated_at wins.
  const FIN_TYPES = new Set(['invoice', 'quotation', 'proforma']);
  const seenFinNumbers = new Set();

  for (const [legacyId, d] of Object.entries(src.fin_docs ?? {})) {
    if (!d || !FIN_TYPES.has(d.type)) continue;
    const id = uuidFor('financial_document', legacyId, newOrgId);

    let docNumber = String(d.id ?? legacyId);
    if (seenFinNumbers.has(docNumber)) {
      // documentStore.nextId() used `matching.length + 1`, which duplicates after
      // any delete. Real collisions are expected here.
      const suffix = `-DUP${seenFinNumbers.size}`;
      warn(`org ${orgId}: duplicate document number ${docNumber} — imported as ${docNumber}${suffix}`);
      docNumber += suffix;
    }
    seenFinNumbers.add(docNumber);

    const client = d.client ?? {};
    const billName = String(client.company ?? client.name ?? d.issued_to ?? 'Unknown').trim() || 'Unknown';

    const discountType = d.discount?.type === 'percent' ? 'percent'
                       : d.discount?.type === 'flat'    ? 'flat' : null;

    out.financial_documents.push({
      id, org_id: newOrgId, doc_number: docNumber, type: d.type,
      status: normalizeStatus(d.status, d),
      revision: nn(d.revision) ?? 'v1',
      customer_id: customerIdForName(billName),
      bill_to_name: billName,
      bill_to_email: email(client.email),
      bill_to_address: nn(client.address),
      bill_to_gstin: nn(client.gstin ?? client.buyerGSTIN),
      bill_to_state: nn(client.state ?? client.buyerState),
      issue_date: date(d.issue_date ?? d.created_at) ?? new Date().toISOString().slice(0, 10),
      due_date: date(d.due_date ?? d.dueDate),
      valid_until: date(d.valid_until ?? d.validUntil),
      currency: 'INR',
      // Totals are placeholders: the DB recomputes them from the line items via
      // the trigger in 0002_functions.sql. 04-verify compares the recomputed
      // value against what Firebase stored and reports any drift.
      subtotal: money(d.subtotal),
      discount_type: discountType,
      discount_value: money(d.discount?.value),
      discount_amount: money(d.discount?.amount),
      taxable_amount: money(d.subtotal) - money(d.discount?.amount),
      gst_enabled: bool(d.enableGst, true),
      gst_rate: Math.min(100, Math.max(0, num(d.gstRate, 18))),
      gst_amount: money(d.gst),
      is_inter_state: bool(d.isInterState),
      making_charges: money(d.makingCharges),
      grand_total: money(d.grand_total ?? d.amount),
      amount_in_words: nn(d.amount_in_words),
      amount_paid: 0,                                     // derived from payments
      advance_percent: d.advancePercent != null ? num(d.advancePercent) : null,
      payment_instructions: nn(d.payment_instructions),
      terms: nn(d.terms),
      notes: nn(d.notes),
      company_snapshot: scrubSnapshot(d.company_profile),
      payload: {},
      created_at: ts(d.created_at) ?? new Date().toISOString(),
      _firebase_totals: {                                 // for 04-verify only
        subtotal: money(d.subtotal), gst: money(d.gst),
        grand_total: money(d.grand_total ?? d.amount),
      },
    });

    (Array.isArray(d.items) ? d.items : []).forEach((it, i) => {
      out.document_line_items.push({
        id: randomUUID(), document_id: id, org_id: newOrgId, position: i,
        description: String(it?.description ?? ''),
        hsn_sac: nn(it?.hsnSac),
        quantity: Math.max(0, num(it?.quantity, 1)),
        unit: nn(it?.unit) ?? 'Nos',
        rate: Math.max(0, money(it?.rate)),
        gst_rate: it?.gstRate != null ? Math.min(100, Math.max(0, num(it.gstRate))) : null,
      });
      if (num(it?.quantity, 1) < 0 || num(it?.rate) < 0) {
        warn(`org ${orgId}: ${docNumber} line ${i} had a negative quantity or rate — clamped to 0`);
      }
    });

    if (money(d.amount_paid) > 0 || d.status === 'paid') {
      out.payments.push({
        id: randomUUID(), org_id: newOrgId, document_id: id,
        amount: money(d.amount_paid) || money(d.grand_total ?? d.amount),
        paid_on: date(d.paid_at ?? d.updated_at) ?? new Date().toISOString().slice(0, 10),
        method: nn(d.payment_method), reference: nn(d.payment_reference),
        note: 'Imported from Firebase',
        submitted_by_recipient: false,
        confirmed_at: ts(d.paid_at ?? d.updated_at) ?? new Date().toISOString(),
      });
    }

    collectSignature(d, newOrgId, { financial_doc_id: id });
  }

  // ── recurring invoices ─────────────────────────────────────────────────────
  // Was an ARRAY inside org_metadata/{orgId}.fin_recurring, rewritten whole on
  // every change (documentStore.js:141-148).
  const FREQ = { weekly: 'weekly', monthly: 'monthly', quarterly: 'quarterly',
                 'half-yearly': 'half_yearly', half_yearly: 'half_yearly', yearly: 'yearly', annual: 'yearly' };
  for (const r of Array.isArray(src.fin_recurring) ? src.fin_recurring : []) {
    if (!r?.clientName && !r?.clientCompany) continue;
    const freq = FREQ[String(r.frequency ?? '').toLowerCase()];
    if (!freq) { warn(`org ${orgId}: recurring invoice with unknown frequency "${r.frequency}" — skipped`); continue; }
    const name = String(r.clientCompany ?? r.clientName).trim();
    out.recurring_invoices.push({
      id: uuidFor('recurring', r.id ?? randomUUID(), newOrgId),
      org_id: newOrgId,
      customer_id: customerIdForName(name),
      bill_to_name: name,
      bill_to_company: nn(r.clientCompany),
      bill_to_email: email(r.clientEmail),
      bill_to_address: nn(r.clientAddress),
      bill_to_gstin: nn(r.clientGstin),
      invoice_prefix: nn(r.invoicePrefix) ?? 'INV',
      frequency: freq,
      start_date: date(r.startDate) ?? new Date().toISOString().slice(0, 10),
      end_date: bool(r.noEndDate) ? null : date(r.endDate),
      no_end_date: bool(r.noEndDate),
      next_invoice_date: date(r.nextInvoiceDate),
      due_offset_days: Math.max(0, num(r.dueOffsetDays, 15)),
      total_cycles: r.totalCycles != null ? Math.max(0, num(r.totalCycles)) : null,
      cycles_completed: Math.max(0, num(r.cyclesCompleted, 0)),
      auto_action: r.autoAction === 'send' ? 'send' : 'draft',
      gst_rate: Math.min(100, Math.max(0, num(r.gstRate, 18))),
      subtotal: money(r.subtotal), gst_amount: money(r.gst), grand_total: money(r.grandTotal),
      items: Array.isArray(r.items) ? r.items : [],
      notes: nn(r.notes),
      active: r.active !== false,
      created_at: ts(r.created_at) ?? new Date().toISOString(),
    });
  }

  // ── notifications ──────────────────────────────────────────────────────────
  // Was an unbounded array in one document with Date.now() ids and an
  // org-global `read` flag (documentStore.js:111-115). Per-user read state did
  // not exist, so nothing is marked read on import.
  for (const n of Array.isArray(src.fin_notifs) ? src.fin_notifs : []) {
    if (!n?.title) continue;
    out.notifications.push({
      id: randomUUID(), org_id: newOrgId,
      type: String(n.type ?? 'info'),
      title: String(n.title).slice(0, 500),
      message: nn(n.message),
      record_id: lookup('record', n.document_id),
      financial_doc_id: lookup('financial_document', n.document_id),
      created_at: ts(n.created_at) ?? new Date().toISOString(),
    });
  }

  // ── AI memory (data preservation only; behaviour unchanged) ────────────────
  if (src.memory && Object.keys(src.memory).length) {
    out.ai_company_memory.push({ org_id: newOrgId, memory: src.memory });
  }
}

// Portal outcomes were written as loose fields on the document by an anonymous
// user (RecipientPortal.jsx). They become first-class signature rows.
function collectSignature(d, orgId, target) {
  const signedAt = ts(d.signed_at ?? d.accepted_at ?? d.acknowledged_at);
  const declined = ts(d.declined_at) ?? (d.status === 'declined' ? ts(d.updated_at) : null);
  if (!signedAt && !declined) return;
  out.document_signatures.push({
    id: randomUUID(), org_id: orgId, ...target,
    record_id: target.record_id ?? null,
    financial_doc_id: target.financial_doc_id ?? null,
    signer_name: nn(d.signed_by ?? d.signed_by_name ?? d.accepted_by),
    signer_email: email(d.signed_by_email ?? d.recipient_email),
    signature_path: null,                 // base64 signature blobs go to Storage in 03-load
    outcome: declined ? 'declined' : (d.acknowledged_at ? 'acknowledged' : 'accepted'),
    decline_reason: nn(d.decline_reason),
    viewed_at: ts(d.viewed_at),
    signed_at: signedAt ?? declined,
  });
}

const STATUS_MAP = {
  draft: 'draft', sent: 'sent', viewed: 'viewed', accepted: 'accepted',
  signed: 'accepted', declined: 'declined', rejected: 'declined',
  paid: 'paid', partial: 'partially_paid', partially_paid: 'partially_paid',
  overdue: 'overdue', cancelled: 'cancelled', canceled: 'cancelled', expired: 'expired',
};
function normalizeStatus(s, ctx = {}) {
  const mapped = STATUS_MAP[String(s ?? '').toLowerCase()];
  if (mapped) return mapped;
  if (ctx.signed_at || ctx.accepted_at) return 'accepted';
  return 'draft';
}

// Pull any base64 image out of a record's data blob so a 4 MB offer letter does
// not become a 4 MB jsonb column.
function stripImages(data, orgId, ownerId) {
  const clean = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (typeof v === 'string' && v.startsWith('data:')) {
      const path = extractImage(v, orgId, 'record-asset', `${ownerId}-${k}`);
      if (path) clean[`${k}_path`] = path;
      continue;
    }
    clean[k] = v;
  }
  return clean;
}

// ─────────────────────────────────────────────────────────────────────────────
function main() {
  const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith('--') ? [[a.slice(2), arr[i + 1]]] : []));
  const inDir  = args.in  ?? '.migration/raw';
  const outDir = args.out ?? '.migration/ready';
  mkdirSync(outDir, { recursive: true });

  const raw = JSON.parse(readFileSync(join(inDir, 'firebase-export.json'), 'utf8'));
  const authUsers = new Map(
    (existsSync(join(inDir, 'users.json'))
      ? JSON.parse(readFileSync(join(inDir, 'users.json'), 'utf8')).users ?? []
      : []
    ).map(u => [u.localId ?? u.uid, u])
  );

  for (const [orgId, src] of Object.entries(raw.organizations ?? {})) {
    transformOrg(orgId, src, authUsers);
  }

  writeFileSync(join(outDir, 'load.json'), JSON.stringify(out, null, 2));
  writeFileSync(join(outDir, 'assets.json'), JSON.stringify(assets, null, 2));
  writeFileSync(join(outDir, 'legacy_id_map.json'), JSON.stringify(idRows, null, 2));
  writeFileSync(join(outDir, 'warnings.txt'), warnings.join('\n'));

  console.log('\n  Transform complete\n');
  for (const [table, rows] of Object.entries(out)) {
    if (rows.length) console.log(`    ${String(rows.length).padStart(7)}  ${table}`);
  }
  console.log(`\n    ${String(assets.length).padStart(7)}  images extracted for Storage`);
  console.log(`    ${String(scrubCount).padStart(7)}  secret fields scrubbed from document snapshots`);
  console.log(`    ${String(warnings.length).padStart(7)}  warnings -> ${join(outDir, 'warnings.txt')}\n`);
  if (warnings.length) {
    console.log('  Review the warnings before loading. First 10:');
    warnings.slice(0, 10).forEach(w => console.log(`    · ${w}`));
    console.log('');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
export { out, assets, idRows, warnings, scrubSnapshot, money, ts, date, bool, normalizeStatus };
