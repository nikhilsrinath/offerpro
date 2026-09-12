// orgStore.js — org-scoped data layer over Supabase.
//
// The public API is unchanged from the Firebase version on purpose: there are
// ~88 call sites across 20 files, and they only ever touch these methods. Keep
// the signatures and the rest of the app needs no edits.
//
// Two properties of the old design are deliberately preserved:
//   1. getSection/getItem/getProfile are SYNCHRONOUS reads of an in-memory
//      cache. load(orgId) hydrates every section in one batch up front.
//   2. A localStorage mirror gives instant paint on reload. It is now only a
//      cache — never a pending-write buffer, since there is one authoritative
//      store instead of two disagreeing ones.
//
// What the app calls a "section" is a Postgres table. Sections keep their old
// names and their old field names; the adapters below translate at the
// boundary. The mappings are lifted from scripts/migrate/02-transform.js.
import { supabase } from '../lib/supabase';
import { IMAGE_KINDS, resolveImageUrl } from './imageUploadService';

let _orgId = null;
let _cache = {};
let _loaded = false;
let _channels = [];

const LS_KEY = (orgId) => `edgeos_org_${orgId}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const nn = (v) => (v === undefined || v === '' ? null : v);
const bool = (v, dflt = false) => (v === undefined || v === null ? dflt : v === true || v === 'Yes' || v === 'true');
const num = (v, dflt = null) => (v === undefined || v === '' || v === null ? dflt : Number(v));
const date = (v) => (v ? String(v).slice(0, 10) : null);
const nowIso = () => new Date().toISOString();

function stripNulls(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) if (v !== undefined) out[k] = v;
  return out;
}

// ─── Section registry ─────────────────────────────────────────────────────────
//
// `table`      Postgres table
// `filter`     extra PostgREST filter applied on load
// `fromRow`    row  -> app-shaped item (old Firebase field names)
// `toRow`      item -> row
// `order`      load ordering

const EMPLOYMENT_TYPES = ['fulltime', 'intern', 'contract', 'parttime'];

// department name <-> id, resolved against the already-hydrated cache.
function deptIdByName(name) {
  if (!name) return null;
  const target = String(name).trim().toLowerCase();
  const found = Object.values(_cache.departments || {}).find(
    (d) => String(d.name || '').trim().toLowerCase() === target
  );
  return found ? found.id : null;
}
function deptNameById(id) {
  if (!id) return '';
  return (_cache.departments || {})[id]?.name || '';
}

const SECTIONS = {
  departments: {
    table: 'departments',
    order: 'name',
    fromRow: (r) => ({ id: r.id, name: r.name, created_at: r.created_at }),
    toRow: (i) => ({ name: i.name }),
  },

  // employees and ex_employees are two windows onto one table. Firebase deleted
  // the row from `employees` and re-inserted it into `ex_employees` under the
  // same key, orphaning every task and document that pointed at it; here an exit
  // is just `exited_at` being set, and the id never changes.
  employees: {
    table: 'employees',
    filter: (q) => q.is('exited_at', null),
    order: 'created_at',
    fromRow: employeeFromRow,
    toRow: employeeToRow,
  },
  ex_employees: {
    table: 'employees',
    filter: (q) => q.not('exited_at', 'is', null),
    order: 'exited_at',
    fromRow: employeeFromRow,
    // The caller's exit date wins over "now": archiving someone whose last
    // working day was last Friday must record last Friday. The old version
    // stamped nowIso() unconditionally and dropped `terminated_at` entirely,
    // so the date the UI passed in never reached the database.
    toRow: (i) => ({
      ...employeeToRow(i),
      exited_at: i.exited_at || i.terminated_at || i.termination_date || nowIso(),
      exit_reason: nn(i.exit_reason),
    }),
  },

  tasks: {
    table: 'tasks',
    order: 'position',
    fromRow: (r) => ({
      id: r.id, title: r.title, description: r.description,
      status: r.status, priority: r.priority,
      assignedTo: r.assignee_id, assignedName: r.assignee_label,
      deadline: r.deadline, notes: r.notes,
      follow_up_sent_at: r.follow_up_sent_at, position: r.position,
      created_at: r.created_at,
    }),
    toRow: (i) => ({
      title: i.title || 'Untitled', description: nn(i.description),
      status: i.status || 'pending', priority: i.priority || 'medium',
      assignee_id: nn(i.assignedTo), assignee_label: nn(i.assignedName),
      deadline: date(i.deadline), notes: nn(i.notes),
      follow_up_sent_at: nn(i.follow_up_sent_at),
      position: num(i.position, 0),
    }),
  },

  // Two sections, one table. `customers` is the billing view of a client and
  // `crm_leads` the pipeline view; since 0016 unified them they are the same row
  // seen through two adapters, which is the point of the merge.
  //
  // The `customers` section is deliberately UNFILTERED, and the Customers page
  // filters by status in the UI instead (entity-decision.md §5 row 3). The
  // distinction matters: customerService.upsert() dedupes an incoming client
  // against this cache by GSTIN, then email, then name, and a cache that held
  // only billable clients would never match a party still sitting in the
  // pipeline — so saving an invoice for them would create a second row for
  // someone the CRM already knows.
  customers: {
    table: 'clients',
    order: 'name',
    fromRow: (r) => ({
      // `extra` is spread FIRST, so a stray key inside it can never shadow a real
      // column. It used to be spread last, and CRM.jsx wrote `status` into extra
      // on every stage change — which then overwrote the real client_status here
      // with a CRM stage name like 'deal'.
      ...(r.extra || {}),
      id: r.id,
      clientName: r.name,
      name: r.name,
      person_name: r.person_name,
      clientEmail: r.email,
      email: r.email,
      contactPhone: r.phone,
      phone: r.phone,
      clientAddress: r.address,
      address: r.address,
      buyerGSTIN: r.gstin,
      gstin: r.gstin,
      buyerState: r.state,
      state: r.state,
      country_code: r.country_code || null,
      status: r.status,
      value: r.value,
      notes: r.notes,
      source: r.source,
      archived_at: r.archived_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }),
    toRow: (i) => ({
      name: i.clientName || i.name || 'Unnamed',
      person_name: nn(i.person_name),
      email: nn(i.clientEmail || i.email),
      phone: nn(i.contactPhone || i.phone),
      address: nn(i.clientAddress || i.address),
      gstin: nn(i.buyerGSTIN || i.gstin),
      state: nn(i.buyerState || i.state),
      country_code: nn(i.country_code),
      status: i.status || 'active',
      value: num(i.value),
      notes: nn(i.notes),
      position: num(i.position, 0),
      source: i.source || 'manual',
      extra: i.extra || {},
    }),
  },

  crm_leads: {
    table: 'clients',
    order: 'position',
    // The board shows the pipeline. A client who has been billed and is not in
    // any conversation is a customer, not a lead, and belongs on the other screen
    // — but 'active' stays here because that is what the "Deal" column is.
    filter: (q) => q.in('status', ['lead', 'contacted', 'active', 'lost']),
    fromRow: (r) => ({
      // extra first, for the same reason as the customers adapter above: a key
      // that leaked into the jsonb must not shadow a real column.
      ...(r.extra || {}),
      id: r.id,
      company_name: r.name,
      name: r.name,
      person_name: r.person_name,
      email: r.email,
      phone: r.phone,
      stage: r.status === 'active' ? 'deal' : r.status === 'lost' ? 'not_deal' : r.status,
      value: r.value,
      notes: r.notes,
      position: r.position,
      created_at: r.created_at,
    }),
    toRow: (i) => {
      // `status` is destructured out and thrown away deliberately. It is derived
      // from `stage` on the line below, and CRM.jsx sends both; without this it
      // fell into ...extra and was written into the clients.extra jsonb, where it
      // shadowed the real column on read.
      const { id: _id, company_name, name, person_name, email, phone, stage, value,
        notes, position, status: _st, created_at: _c, updated_at: _u, org_id: _o, ...extra } = i;
      return {
        name: nn(company_name || name || person_name) || 'Unnamed Lead',
        person_name: nn(person_name),
        email: nn(email),
        phone: nn(phone),
        status: stage === 'deal' ? 'active' : stage === 'not_deal' ? 'lost' : (stage || 'lead'),
        value: num(value),
        notes: nn(notes),
        position: num(position, 0),
        source: 'crm',
        extra,
      };
    },
  },

  products: {
    table: 'products',
    order: 'created_at',
    fromRow: (r) => ({
      id: r.id, name: r.name, description: r.description, status: r.status,
      priority: r.priority, due_date: r.due_date, created_at: r.created_at,
    }),
    toRow: (i) => ({
      name: i.name || 'Untitled', description: nn(i.description),
      status: i.status || 'planned', priority: i.priority || 'medium',
      due_date: date(i.due_date),
    }),
  },

  // The sellable catalogue. NOT the same thing as `products` above, which is
  // ProductPlanner's roadmap — see 0011_product_catalog.sql for why the two are
  // separate tables. The UI calls this one "Products" and the planner keeps its
  // own page.
  //
  // units_sold / revenue / revenue_paid / invoice_count / last_sold_at are
  // trigger-owned and column-level revoked from `authenticated`, so toRow must
  // never emit them: sending one back would fail the UPDATE outright.
  catalog: {
    table: 'catalog_items',
    order: 'name',
    fromRow: (r) => ({
      id: r.id, name: r.name, sku: r.sku, description: r.description,
      category: r.category,
      unit_price: r.unit_price, unit: r.unit,
      hsn_sac: r.hsn_sac, tax_rate: r.tax_rate,
      track_inventory: r.track_inventory, stock_qty: r.stock_qty,
      low_stock_at: r.low_stock_at,
      archived_at: r.archived_at,
      units_sold: Number(r.units_sold) || 0,
      revenue: Number(r.revenue) || 0,
      revenue_paid: Number(r.revenue_paid) || 0,
      invoice_count: Number(r.invoice_count) || 0,
      last_sold_at: r.last_sold_at,
      created_at: r.created_at, updated_at: r.updated_at,
    }),
    toRow: (i) => ({
      name: i.name || 'Untitled',
      // Blank is not a SKU. nn() turns '' into null, which is what the partial
      // unique index wants — otherwise every product without a code would
      // collide with every other one on the empty string.
      sku: nn(i.sku ? String(i.sku).trim() : null),
      description: nn(i.description),
      category: nn(i.category),
      unit_price: num(i.unit_price, 0),
      unit: i.unit || 'Nos',
      hsn_sac: nn(i.hsn_sac),
      tax_rate: num(i.tax_rate, 18),
      track_inventory: bool(i.track_inventory, false),
      stock_qty: num(i.stock_qty, 0),
      low_stock_at: num(i.low_stock_at),
      archived_at: nn(i.archived_at),
    }),
  },

  expenses: {
    table: 'expenses',
    order: 'incurred_on',
    fromRow: (r) => ({
      id: r.id, description: r.description, amount: r.amount,
      category: r.category, date: r.incurred_on, incurred_on: r.incurred_on,
      tax_amount: Number(r.tax_amount) || 0, receipt_path: r.receipt_path || null,
      vendor_id: r.vendor_id || null,
      created_at: r.created_at,
    }),
    toRow: (i) => ({
      description: i.description || '', amount: num(i.amount, 0),
      category: i.category || 'Operations',
      incurred_on: date(i.date || i.incurred_on) || date(nowIso()),
      tax_amount: num(i.tax_amount, 0),
      receipt_path: nn(i.receipt_path),
      vendor_id: nn(i.vendor_id),
    }),
  },

  // Supplier directory (0028). Archived rather than deleted once billed.
  vendors: {
    table: 'vendors',
    order: 'company_name',
    fromRow: (r) => ({
      id: r.id, company_name: r.company_name, contact_name: r.contact_name,
      email: r.email, phone: r.phone, address: r.address, state: r.state,
      gstin: r.gstin, payment_terms_days: r.payment_terms_days,
      category: r.category, notes: r.notes, archived_at: r.archived_at,
      created_at: r.created_at,
    }),
    toRow: (i) => ({
      company_name: (i.company_name || '').trim(),
      contact_name: nn(i.contact_name), email: nn(i.email), phone: nn(i.phone),
      address: nn(i.address), state: nn(i.state),
      gstin: nn((i.gstin || '').trim().toUpperCase()),
      payment_terms_days: num(i.payment_terms_days, 30),
      category: nn(i.category), notes: nn(i.notes),
      archived_at: nn(i.archived_at),
    }),
  },

  // Bills received from vendors (0028). tax_amount, total and status are
  // recomputed by app.purchase_invoice_guard(); what is sent for them is ignored.
  purchase_invoices: {
    table: 'purchase_invoices',
    order: 'bill_date',
    fromRow: (r) => ({
      id: r.id, vendor_id: r.vendor_id, bill_number: r.bill_number,
      bill_date: r.bill_date, due_date: r.due_date, category: r.category,
      description: r.description,
      subtotal: Number(r.subtotal) || 0, tax_rate: Number(r.tax_rate) || 0,
      tax_amount: Number(r.tax_amount) || 0, total: Number(r.total) || 0,
      amount_paid: Number(r.amount_paid) || 0, status: r.status,
      paid_on: r.paid_on, receipt_path: r.receipt_path, notes: r.notes,
      created_at: r.created_at,
    }),
    toRow: (i) => ({
      vendor_id: i.vendor_id, bill_number: (i.bill_number || '').trim(),
      bill_date: date(i.bill_date) || date(nowIso()),
      due_date: date(i.due_date), category: i.category || 'Operations',
      description: nn(i.description),
      subtotal: num(i.subtotal, 0), tax_rate: num(i.tax_rate, 18),
      amount_paid: num(i.amount_paid, 0),
      status: i.status === 'void' ? 'void' : 'unpaid',
      receipt_path: nn(i.receipt_path), notes: nn(i.notes),
    }),
  },

  // HR documents. doc_number is NOT NULL with unique(org_id, doc_number), and
  // HR records never had a number under Firebase — so one is allocated by the
  // next_document_number() RPC before insert.
  records: {
    table: 'records',
    order: 'created_at',
    needsDocNumber: true,
    // The form snapshot is spread first so the promoted columns win: they are
    // the authoritative copy, and it is where status changes land. The
    // recipient falls back into the snapshot because documents saved from the
    // form pages keep the candidate under data.studentName and left
    // recipient_name null.
    fromRow: (r) => {
      const d = r.data || {};
      return {
        ...d,
        data: d,
        id: r.id, doc_number: r.doc_number, type: r.type, status: r.status,
        title: r.title,
        employee_id: r.employee_id ?? d.employee_id ?? null,
        issued_to: r.recipient_name || d.studentName || d.recipientName || d.name || '',
        recipient_email: r.recipient_email || d.email || '',
        issue_date: r.issue_date, created_at: r.created_at,
        company_profile: r.company_snapshot,
      };
    },
    toRow: (i) => {
      const { id: _id, doc_number: _dn, type, status, title, employee_id, issued_to,
        recipient_email, issue_date, created_at: _c, updated_at: _u, org_id: _o,
        company_profile, data, ...rest } = i;
      // Two shapes reach this table: the document forms save the whole form
      // under `data` (studentName/email), while OfferTracker and the notices
      // pass the promoted fields at the top level. Look in both, or the portal
      // gets a document addressed to nobody.
      const d = data || {};
      const docType = normalizeDocType(type);
      const recipientName = nn(issued_to || rest.recipientName || rest.studentName
        || d.studentName || d.recipientName || d.name);
      return {
        type: docType, status: status || 'draft',
        // `title` is what the recipient portal and the records list call the
        // document, and it is NOT NULL. OfferTracker and the notices don't send
        // one, so name it after the type and the person it is addressed to.
        title: title || [RECORD_TITLES[docType] || 'Document', recipientName]
          .filter(Boolean).join(' — '),
        employee_id: nn(employee_id ?? d.employee_id),
        recipient_name: recipientName,
        recipient_email: nn(recipient_email || rest.email || d.email),
        issue_date: date(issue_date) || date(nowIso()),
        // The forms reach this table two ways. documentStore.save() passes the
        // profile at the top level, but storageService.save() nests the whole
        // form under `data` — so a document saved from the HR pages left
        // company_snapshot as {} while its branding sat one level down. Look in
        // both, or the snapshot column is empty for exactly the documents that
        // outlive a rebrand.
        company_snapshot: scrubSnapshot(company_profile || d.company_profile),
        data: { ...d, ...rest },
      };
    },
  },

  fin_notifs: {
    table: 'notifications',
    order: 'created_at',
    orderDesc: true,
    fromRow: (r) => ({
      id: r.id, type: r.type, title: r.title, message: r.message,
      record_id: r.record_id, financial_doc_id: r.financial_doc_id,
      document_id: r.financial_doc_id || r.record_id,
      created_at: r.created_at,
      // Read state is per-user now (notification_reads), merged in on load.
      read: r._read === true,
    }),
    toRow: (i) => ({
      type: i.type || 'info', title: i.title || '', message: nn(i.message),
      record_id: nn(i.record_id), financial_doc_id: nn(i.financial_doc_id),
    }),
  },

  fin_recurring: {
    table: 'recurring_invoices',
    order: 'created_at',
    fromRow: (r) => ({ ...r, id: r.id }),
    toRow: (i) => ({
      customer_id: nn(i.customer_id),
      bill_to_name: i.bill_to_name || i.clientName || 'Unnamed',
      bill_to_company: nn(i.bill_to_company), bill_to_email: nn(i.bill_to_email),
      bill_to_address: nn(i.bill_to_address), bill_to_gstin: nn(i.bill_to_gstin),
      invoice_prefix: i.invoice_prefix || 'INV',
      frequency: i.frequency || 'monthly',
      start_date: date(i.start_date) || date(nowIso()),
      end_date: date(i.end_date), no_end_date: bool(i.no_end_date, true),
      next_invoice_date: date(i.next_invoice_date),
      due_offset_days: num(i.due_offset_days, 15),
      total_cycles: num(i.total_cycles), cycles_completed: num(i.cycles_completed, 0),
      auto_action: i.auto_action || 'draft',
      gst_rate: num(i.gst_rate, 18), subtotal: num(i.subtotal, 0),
      gst_amount: num(i.gst_amount, 0), grand_total: num(i.grand_total, 0),
      items: Array.isArray(i.items) ? i.items : [],
      notes: nn(i.notes), active: bool(i.active, true),
    }),
  },
};

function employeeFromRow(r) {
  const comp = r.employee_compensation?.[0] || r.employee_compensation || null;
  return {
    id: r.id,
    studentName: r.full_name, name: r.full_name, full_name: r.full_name,
    email: r.email, phone: r.phone, address: r.address, studentAddress: r.address,
    role: r.role,
    department: deptNameById(r.department_id), department_id: r.department_id,
    offerType: r.employment_type,
    is_owner: r.is_owner,
    supervisorName: r.supervisor_name, reports_to: r.reports_to,
    responsibilities: r.responsibilities,
    startDate: r.start_date, endDate: r.end_date,
    acceptanceDeadline: r.acceptance_deadline,
    exited_at: r.exited_at, exit_reason: r.exit_reason,
    // ExEmployees.jsx renders `terminated_at || termination_date` and
    // Employees.jsx filters on `termination_date`. Neither was ever a column
    // and neither was ever written, so the archive showed a blank date on every
    // row. `exited_at` is the real value; expose it under the names the UI
    // already asks for rather than renaming the columns underneath it.
    terminated_at: r.exited_at, termination_date: r.exited_at,
    status: r.exited_at ? 'terminated' : 'active',
    created_at: r.created_at,
    // 0029. `user_id` is the login attached to this record; `access_revoked_at`
    // is stamped by app.revoke_employee_access() when the exit deletes their
    // membership, which is what ExEmployees.jsx shows as proof access is gone.
    photo_path: r.photo_path,
    user_id: r.user_id,
    access_revoked_at: r.access_revoked_at,
    // employee_compensation is admin-only under RLS. A non-admin simply gets
    // no row back — not an error — so these stay undefined rather than throwing.
    ...(comp ? {
      stipend: comp.amount, salary: comp.amount, currency: comp.currency,
      isPaid: comp.is_paid, paymentFrequency: comp.payment_frequency,
    } : {}),
  };
}

function employeeToRow(i) {
  return {
    full_name: String(i.studentName ?? i.name ?? i.full_name ?? '').trim() || 'Unnamed',
    email: nn(i.email), phone: nn(i.phone),
    address: nn(i.studentAddress ?? i.address),
    role: nn(i.role),
    department_id: i.department_id ?? deptIdByName(i.department),
    employment_type: EMPLOYMENT_TYPES.includes(i.offerType) ? i.offerType : 'fulltime',
    supervisor_name: nn(i.supervisorName),
    reports_to: nn(i.reports_to),
    responsibilities: nn(i.responsibilities),
    is_owner: bool(i.is_owner),
    start_date: date(i.startDate), end_date: date(i.endDate),
    acceptance_deadline: date(i.acceptanceDeadline),
    // `user_id` is deliberately absent: linking a login is meService's job, not
    // a field an employee form can overwrite by round-tripping a stale object.
    photo_path: nn(i.photo_path),
  };
}

// The app and admin panel disagree on the offer key ('offer' vs 'offer_letter');
// the enum uses 'offer'.
const RECORD_TITLES = {
  offer: 'Offer Letter', certificate: 'Certificate', nda: 'NDA', mou: 'MoU',
  role_change: 'Role Change Notice', termination: 'Termination Notice',
};

function normalizeDocType(type) {
  return type === 'offer_letter' ? 'offer' : type;
}

// Documents embed a snapshot of the company profile. Under Firebase that
// snapshot carried the Gmail app password into every record. Strip anything
// secret before it lands in company_snapshot.
//
// Banking is on this list as well as the credentials, and it has to be: _profile
// is org columns PLUS org_banking (see loadProfile below), and company_snapshot
// is handed to recipients. api/portal.js deliberately skips the org_banking
// lookup for records — an offer letter has no business carrying account numbers
// to a candidate — but it merges the snapshot underneath the live profile, so
// anything left in here reaches the recipient anyway and defeats that check.
// 0001_init.sql:380 states the same contract for the ETL ("strips
// gmail_app_password / bank_* / gstin"); this is the app honouring it.
//
// Nothing renders banking from the snapshot: the invoice forms copy the live
// values into the document's own payload (`docData.bank`, `docData.upi_id`) and
// the portal falls back to the live org_banking read, which only financial
// documents get.
const SECRET_KEYS = ['gmail_user', 'gmail_app_password', 'emailjs_service_id',
  'emailjs_template_id', 'emailjs_public_key',
  'bank_account_number', 'bank_ifsc', 'bank_name', 'bank_account_type',
  'upi_id', 'gstin', 'cin'];
function scrubSnapshot(profile) {
  if (!profile || typeof profile !== 'object') return {};
  const clean = { ...profile };
  for (const k of SECRET_KEYS) delete clean[k];

  // A snapshot outlives any URL in it. logo_url and stamp_url are permanent CDN
  // links from the public bucket and can be stored as-is, but signature_url is a
  // signed URL that expires in an hour — persisting it would leave every
  // document without a signature by tomorrow. Store the stable object path and
  // let the renderer sign it on demand.
  const signaturePath = _cache._profile?.signature_path || profile.signature_path;
  if (signaturePath) {
    clean.signature_path = signaturePath;
    delete clean.signature_url;
  } else if (typeof clean.signature_url === 'string' && clean.signature_url.includes('token=')) {
    // A signed URL with no path to fall back on is worse than nothing.
    delete clean.signature_url;
  }

  return clean;
}

// Sections that are a single jsonb blob rather than a table of rows.
const SINGLETONS = {
  hierarchy: {
    table: 'org_settings',
    column: 'hierarchy',
    empty: () => ({ nodes: {}, edges: {} }),
  },
};

// ─── Profile ──────────────────────────────────────────────────────────────────
//
// Firebase kept all 42 profile fields in one document. The schema splits them by
// sensitivity, and RLS enforces the split:
//   organizations  — readable by any member
//   org_banking    — owner/admin only
//   org_secrets    — NO client policy: write-only from the browser, never read
//   subscriptions  — select only; plan can no longer be self-granted

const BANKING_FIELDS = ['gstin', 'cin', 'upi_id', 'bank_name',
  'bank_account_number', 'bank_ifsc', 'bank_account_type'];
const SECRET_FIELDS = ['gmail_user', 'gmail_app_password', 'emailjs_service_id',
  'emailjs_template_id', 'emailjs_public_key'];
const ORG_FIELDS = ['company_name', 'company_tagline', 'company_email',
  'company_phone', 'company_website', 'company_address', 'company_description',
  'owner_full_name', 'owner_role', 'document_designation', 'industry', 'country',
  'city', 'company_size', 'primary_contact_name', 'use_cases', 'account_usage',
  'referral_source', 'include_logo', 'logo_path', 'signature_path', 'stamp_path',
  'stamp_type', 'stamp_city'];

// The app says logo_url/signature_url/stamp_url; the schema stores Storage
// object paths in logo_path/signature_path/stamp_path.
const URL_TO_PATH = { logo_url: 'logo_path', signature_url: 'signature_path', stamp_url: 'stamp_path' };
const PATH_TO_URL = { logo_path: 'logo_url', signature_path: 'signature_url', stamp_path: 'stamp_url' };
// Which bucket each image lives in, for turning a stored path into a URL.
const PATH_BUCKET = {
  logo_path: IMAGE_KINDS.logo.bucket,
  stamp_path: IMAGE_KINDS.stamp.bucket,
  signature_path: IMAGE_KINDS.signature.bucket,
};

function splitProfileUpdates(updates) {
  const org = {}, banking = {}, secrets = {};
  for (const [rawKey, value] of Object.entries(updates || {})) {
    // An explicit *_path (set by the upload flow) wins over the display-only
    // *_url alongside it, which holds a signed or CDN URL that must never be
    // written back to the column.
    if (URL_TO_PATH[rawKey] && updates[URL_TO_PATH[rawKey]] !== undefined) continue;
    const key = URL_TO_PATH[rawKey] || rawKey;
    if (BANKING_FIELDS.includes(key)) banking[key] = value;
    else if (SECRET_FIELDS.includes(key)) {
      // An empty secret means "the form could not show me what is stored", not
      // "delete what is stored". org_secrets is write-only — the profile form
      // reloads with a blank App Password every time because there is no way to
      // read one back — so passing the blank through would make every unrelated
      // profile edit (a new address, a new logo) silently wipe the org's Gmail
      // credentials and break all outbound email. Clearing is a deliberate act
      // and has to send an explicit null.
      if (value === '' || value === undefined) continue;
      secrets[key] = value;
    }
    else if (ORG_FIELDS.includes(key)) org[key] = value;
    // Anything else (id, plan, is_premium, ai_message_count, created_at) is
    // derived or server-owned and is silently dropped rather than rejected.
  }
  return { org, banking, secrets };
}

function createEmptyCache(profile = {}) {
  const cache = { _profile: profile || {}, _usage: {} };
  Object.keys(SECTIONS).forEach((s) => { cache[s] = {}; });
  Object.entries(SINGLETONS).forEach(([s, def]) => { cache[s] = def.empty(); });
  return cache;
}

// ─── Local change notification ────────────────────────────────────────────────
//
// Realtime is the cross-client channel, but it round-trips through the server
// and is not guaranteed to be enabled for every table. Every local mutation
// already writes the in-memory cache, so listeners are told about it directly:
// the tab that made the change repaints on the spot instead of waiting for a
// realtime echo (or a manual refresh when there is none).
const _subs = new Map();

function subscribeSection(section, emit) {
  let set = _subs.get(section);
  if (!set) { set = new Set(); _subs.set(section, set); }
  set.add(emit);
  return () => {
    const s = _subs.get(section);
    if (!s) return;
    s.delete(emit);
    if (s.size === 0) _subs.delete(section);
  };
}

/** Push the current cache value for `section` to every live listener. */
function notifySection(section) {
  const set = _subs.get(section);
  if (!set || set.size === 0) return;
  const singleton = SINGLETONS[section];
  const value = _cache[section] ?? (singleton ? singleton.empty() : {});
  set.forEach((emit) => {
    try { emit(value); } catch (e) { console.warn(`[orgStore] listener for '${section}' threw:`, e.message); }
  });
}

function persistToLS() {
  if (!_orgId) return;
  try {
    localStorage.setItem(LS_KEY(_orgId), JSON.stringify(_cache));
  } catch (e) {
    console.warn('[orgStore] localStorage write failed:', e.message);
  }
}

function readFromLS(orgId) {
  try {
    const raw = localStorage.getItem(LS_KEY(orgId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function keyById(rows, fromRow) {
  const out = {};
  for (const row of rows || []) {
    const item = fromRow(row);
    out[item.id] = item;
  }
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const orgStore = {
  async load(orgId) {
    if (!orgId) return null;
    _orgId = orgId;

    // Paint from the last known state immediately; the network fill replaces it.
    const cached = readFromLS(orgId);
    if (cached && Object.keys(cached).length > 0) {
      _cache = cached;
      _loaded = true;
    } else {
      _cache = createEmptyCache();
    }

    const [orgRes, bankingRes, subRes, settingsRes, usageRes] = await Promise.all([
      supabase.from('organizations').select('*').eq('id', orgId).maybeSingle(),
      // Admin-only: a plain member gets null here, not an error.
      supabase.from('org_banking').select('*').eq('org_id', orgId).maybeSingle(),
      supabase.from('subscriptions').select('plan, status, current_period_end').eq('org_id', orgId).maybeSingle(),
      supabase.from('org_settings').select('*').eq('org_id', orgId).maybeSingle(),
      // Read-only for every client role; the server and the triggers write it.
      supabase.from('usage_counters').select('*').eq('org_id', orgId).maybeSingle(),
    ]);

    if (orgRes.error) throw orgRes.error;
    if (!orgRes.data) {
      // Not a member, or soft-deleted: both are invisible under RLS.
      _cache = createEmptyCache();
      _loaded = false;
      return null;
    }

    const org = orgRes.data;
    const profile = { ...org };
    // The columns hold Storage object paths. Resolve them to something an
    // <img> can render: a CDN URL for the public branding bucket, a signed URL
    // for the private signatures bucket. Values that are already a data: or
    // http: URL pass straight through, so hand-entered logo links and any
    // leftover base64 keep working.
    await Promise.all(Object.entries(PATH_TO_URL).map(async ([pathKey, urlKey]) => {
      profile[urlKey] = await resolveImageUrl(org[pathKey], PATH_BUCKET[pathKey]);
    }));
    Object.assign(profile, bankingRes.data || {});
    profile.plan = subRes.data?.plan || 'free';
    profile.is_premium = profile.plan !== 'free';
    _cache._profile = profile;
    _cache._usage = usageRes.data || {};

    _cache.hierarchy = settingsRes.data?.hierarchy || SINGLETONS.hierarchy.empty();

    // Departments first: employee rows map department_id -> name against them.
    const deptRes = await supabase.from('departments').select('*').eq('org_id', orgId).order('name');
    if (deptRes.error) throw deptRes.error;
    _cache.departments = keyById(deptRes.data, SECTIONS.departments.fromRow);

    const names = Object.keys(SECTIONS).filter((s) => s !== 'departments');
    const results = await Promise.all(names.map(async (name) => {
      const def = SECTIONS[name];
      const select = def.table === 'employees' ? '*, employee_compensation(*)' : '*';
      let q = supabase.from(def.table).select(select).eq('org_id', orgId);
      if (def.filter) q = def.filter(q);
      if (def.order) q = q.order(def.order, { ascending: !def.orderDesc, nullsFirst: false });
      const { data, error } = await q;
      if (error) {
        console.warn(`[orgStore] load ${name} failed:`, error.message);
        return [name, {}];
      }
      return [name, keyById(data, def.fromRow)];
    }));
    for (const [name, section] of results) _cache[name] = section;

    await hydrateNotificationReads();
    await hydrateFinancialDocuments(orgId);

    _loaded = true;
    persistToLS();
    return profile;
  },

  getOrgId: () => _orgId,
  isLoaded: () => _loaded,
  getCache: () => _cache,
  getProfile: () => _cache._profile || {},

  // usage_counters. Document counts are maintained by app.bump_usage() on
  // insert and delete; ai_messages by the server on each AI call.
  getUsage: () => _cache._usage || {},

  /** Re-read after something the server counts — an AI message, notably. */
  async refreshUsage() {
    if (!_orgId) return {};
    const { data, error } = await supabase
      .from('usage_counters').select('*').eq('org_id', _orgId).maybeSingle();
    if (error) {
      console.warn('[orgStore] usage refresh failed:', error.message);
      return _cache._usage || {};
    }
    _cache._usage = data || {};
    persistToLS();
    return _cache._usage;
  },

  getSection(section) {
    const data = _cache[section];
    if (data !== undefined && data !== null) return data;
    return SINGLETONS[section] ? SINGLETONS[section].empty() : {};
  },

  getSectionAsList(section) {
    const data = _cache[section];
    if (!data || typeof data !== 'object') return [];
    return Object.entries(data).map(([key, val]) => ({
      id: key,
      ...(typeof val === 'object' && val !== null ? val : {}),
    }));
  },

  getItem(section, id) {
    return (_cache[section] || {})[id] || null;
  },

  async updateProfile(updates) {
    if (!_orgId) return;
    Object.assign(_cache._profile, updates);
    _cache._profile.id = _orgId;
    persistToLS();

    const { org, banking, secrets } = splitProfileUpdates(updates);

    if (Object.keys(org).length) {
      const { error } = await supabase.from('organizations').update(org).eq('id', _orgId);
      if (error) throw error;
    }
    if (Object.keys(banking).length) {
      const { error } = await supabase.from('org_banking')
        .upsert({ org_id: _orgId, ...banking }, { onConflict: 'org_id' });
      if (error) throw error;
    }
    if (Object.keys(secrets).length) {
      // org_secrets has no client policy at all, so this cannot be written from
      // the browser. It goes through the server, which holds the encryption key.
      await saveSecretsViaServer(secrets);
      // Never keep secrets in the local cache or localStorage.
      for (const k of SECRET_FIELDS) delete _cache._profile[k];
      persistToLS();
    }
  },

  async addItem(section, data) {
    if (!_orgId) throw new Error('[orgStore] No orgId set');
    const def = SECTIONS[section];
    if (!def) throw new Error(`[orgStore] Unknown section: ${section}`);

    const row = stripNulls({ ...def.toRow(data), org_id: _orgId });

    // records/financial_documents carry a gap-free per-org, per-type, per-year
    // number allocated atomically by the DB. The old client-side nextId()
    // counted existing rows, so it reissued numbers after a delete and raced
    // between concurrent clients.
    if (def.needsDocNumber && !row.doc_number) {
      row.doc_number = await nextDocumentNumber(row.type);
    }

    const { data: inserted, error } = await supabase
      .from(def.table).insert(row).select().single();
    if (error) throw error;

    const item = def.fromRow(inserted);
    if (!_cache[section]) _cache[section] = {};
    _cache[section][item.id] = item;
    persistToLS();
    notifySection(section);

    if (section === 'employees' || section === 'ex_employees') {
      await saveCompensation(item.id, data);
    }
    return item;
  },

  async setItem(section, id, data) {
    if (!_orgId) return;
    const def = SECTIONS[section];
    if (!def) return;

    const row = stripNulls(def.toRow(data));
    const { data: updated, error } = await supabase
      .from(def.table).update(row).eq('id', id).select().single();
    if (error) throw error;

    const item = def.fromRow(updated);
    if (!_cache[section]) _cache[section] = {};
    _cache[section][id] = item;
    persistToLS();
    notifySection(section);

    if (section === 'employees' || section === 'ex_employees') {
      await saveCompensation(id, data);
    }
  },

  async updateItem(section, id, updates) {
    if (!_orgId) return;
    const def = SECTIONS[section];
    if (!def) return;

    // Optimistic cache write first so the UI updates without waiting, matching
    // the old fire-and-forget behaviour.
    if (!_cache[section]) _cache[section] = {};
    const merged = { ...(_cache[section][id] || {}), ...updates };
    _cache[section][id] = merged;
    persistToLS();
    notifySection(section);

    const row = stripNulls(def.toRow(merged));
    const { data: updated, error } = await supabase
      .from(def.table).update(row).eq('id', id).select().single();
    if (error) throw error;

    _cache[section][id] = def.fromRow(updated);
    persistToLS();
    notifySection(section);
  },

  // `options.reason` fills employees.exit_reason, which existed from the start
  // and had no writer — every archived employee left without a recorded reason.
  // `options.exitedAt` backdates the exit to the real last working day.
  async removeItem(section, id, options = {}) {
    if (!_orgId) return;
    const def = SECTIONS[section];
    if (!def) return;

    if (_cache[section]) {
      delete _cache[section][id];
      persistToLS();
      notifySection(section);
    }

    // An "ex-employee" is not a deletion: keep the row so tasks and documents
    // that reference the employee keep their foreign key.
    if (section === 'employees') {
      const { error } = await supabase.from('employees')
        .update({
          exited_at: options.exitedAt || nowIso(),
          exit_reason: nn(options.reason),
        }).eq('id', id);
      if (error) throw error;
      return;
    }

    const { error } = await supabase.from(def.table).delete().eq('id', id);
    if (error) throw error;
  },

  async setSection(section, value) {
    const singleton = SINGLETONS[section];
    if (!singleton) {
      console.warn(`[orgStore] setSection is only supported for ${Object.keys(SINGLETONS).join(', ')} — ` +
        `use addItem/updateItem/removeItem for '${section}'.`);
      return;
    }
    _cache[section] = value;
    persistToLS();
    notifySection(section);

    const { error } = await supabase.from(singleton.table)
      .upsert({ org_id: _orgId, [singleton.column]: value }, { onConflict: 'org_id' });
    if (error) throw error;
  },

  // Supabase Realtime replaces the Firestore onSnapshot listener. Same
  // signature, same unsubscribe contract.
  //
  // The callback fires immediately with the current data (from the hydrated
  // cache when there is one, then again once the server answers) and after
  // that on every realtime change. Callers gate a `loading` flag on the first
  // call, so a listener that only spoke on changes left them spinning forever.
  listenSection(section, callback) {
    if (!_orgId) return () => {};

    const singleton = SINGLETONS[section];
    const def = SECTIONS[section];
    // fin_docs spans two tables and is hydrated by its own loader.
    const isFinDocs = section === 'fin_docs';
    const table = isFinDocs ? 'financial_documents' : (singleton ? singleton.table : def?.table);
    if (!table) {
      // Unknown section: answer once with nothing so callers gating a
      // `loading` flag on the first callback resolve instead of spinning.
      console.warn(`[orgStore] listenSection: unknown section '${section}'`);
      callback({});
      return () => {};
    }

    let stopped = false;
    const emit = (value) => { if (!stopped) callback(value); };
    // Local mutations push straight to this listener, so the tab that made the
    // change repaints immediately instead of waiting on a realtime echo.
    const unsubscribeLocal = subscribeSection(section, emit);

    const fetchSection = async () => {
      if (isFinDocs) {
        await hydrateFinancialDocuments(_orgId);
        persistToLS();
        return _cache.fin_docs || {};
      }
      if (singleton) {
        const { data, error } = await supabase.from(singleton.table)
          .select(singleton.column).eq('org_id', _orgId).maybeSingle();
        if (error) throw error;
        const value = data?.[singleton.column] ?? singleton.empty();
        _cache[section] = value;
        persistToLS();
        return value;
      }
      const select = def.table === 'employees' ? '*, employee_compensation(*)' : '*';
      let q = supabase.from(def.table).select(select).eq('org_id', _orgId);
      if (def.filter) q = def.filter(q);
      if (def.order) q = q.order(def.order, { ascending: !def.orderDesc, nullsFirst: false });
      const { data, error } = await q;
      if (error) throw error;
      const next = keyById(data, def.fromRow);
      _cache[section] = next;
      persistToLS();
      return next;
    };

    const refresh = async () => {
      try {
        emit(await fetchSection());
      } catch (err) {
        console.warn(`[orgStore] listenSection ${section} refresh failed:`, err.message);
        // Never leave the caller waiting: hand back whatever the cache holds.
        emit(_cache[section] ?? (singleton ? singleton.empty() : {}));
      }
    };

    // Instant paint from the hydrated cache, then the authoritative read.
    if (_cache[section] !== undefined && _cache[section] !== null) emit(_cache[section]);
    refresh();

    const channel = supabase
      .channel(`org:${_orgId}:${section}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table, filter: `org_id=eq.${_orgId}` },
        () => { refresh(); })
      .subscribe();

    const unsubscribe = () => {
      stopped = true;
      unsubscribeLocal();
      supabase.removeChannel(channel);
    };
    _channels.push(unsubscribe);
    return unsubscribe;
  },

  // ── Financial documents ────────────────────────────────────────────────────
  // Kept off the generic section machinery because they span two tables and
  // their money columns are computed by triggers rather than written.

  async saveFinDoc(data) {
    if (!_orgId) throw new Error('[orgStore] No orgId set');

    const type = data.type;
    const row = stripNulls({ ...finDocToRow(data), org_id: _orgId });
    if (!row.doc_number) row.doc_number = await nextDocumentNumber(type);

    const { data: inserted, error } = await supabase
      .from('financial_documents').insert(row).select().single();
    if (error) throw error;

    await replaceLineItems(inserted.id, data.items);
    return await refreshFinDoc(inserted.id);
  },

  async updateFinDoc(id, updates) {
    if (!_orgId) return null;
    const existing = _cache.fin_docs?.[id] || {};
    const merged = { ...existing, ...updates };

    // doc_number is frozen by a trigger after insert; never send it back.
    const row = stripNulls(finDocToRow(merged));
    delete row.doc_number;

    const { error } = await supabase
      .from('financial_documents').update(row).eq('id', id);
    if (error) throw error;

    if (updates.items) await replaceLineItems(id, updates.items);
    return await refreshFinDoc(id);
  },

  async deleteFinDoc(id) {
    if (_cache.fin_docs) {
      delete _cache.fin_docs[id];
      persistToLS();
      notifySection('fin_docs');
    }
    const { error } = await supabase.from('financial_documents').delete().eq('id', id);
    if (error) throw error;
  },

  // ── Payments ───────────────────────────────────────────────────────────────
  //
  // financial_documents.amount_paid and the paid/partially_paid status are
  // computed by app.recompute_amount_paid() from CONFIRMED payment rows, so
  // none of these write a status: they write the ledger and read the document
  // back. Marking an invoice paid by setting the status alone — which is what
  // the app did — left amount_paid at 0 forever and made partially_paid
  // unreachable.

  /**
   * @param {object} p
   * @param {string} p.documentId
   * @param {number} p.amount        must be > 0 (check constraint)
   * @param {boolean} p.confirmed    false records an unverified claim
   * @param {boolean} p.bySubmitter  true when the recipient claimed it via the portal
   */
  async addPayment({ documentId, amount, paidOn, method, reference, note,
    confirmed = true, bySubmitter = false }) {
    if (!_orgId) throw new Error('[orgStore] No orgId set');
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error('A payment amount must be greater than zero.');
    }

    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase.from('payments').insert({
      org_id: _orgId,
      document_id: documentId,
      amount: value,
      paid_on: date(paidOn) || date(nowIso()),
      method: nn(method),
      reference: nn(reference),
      note: nn(note),
      submitted_by_recipient: bySubmitter,
      confirmed_at: confirmed ? nowIso() : null,
      confirmed_by: confirmed ? (user?.id || null) : null,
    }).select().single();
    if (error) throw error;

    await refreshFinDoc(documentId);
    return data;
  },

  /** Turns a recipient's claim into money on the books. Admin-only under RLS. */
  async confirmPayment(paymentId, documentId) {
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase.from('payments')
      .update({ confirmed_at: nowIso(), confirmed_by: user?.id || null })
      .eq('id', paymentId);
    if (error) throw error;

    return await refreshFinDoc(documentId);
  },

  async deletePayment(paymentId, documentId) {
    const { error } = await supabase.from('payments').delete().eq('id', paymentId);
    if (error) throw error;
    return await refreshFinDoc(documentId);
  },

  clear() {
    _channels.forEach((unsub) => { try { unsub(); } catch { /* already gone */ } });
    _channels = [];
    _subs.clear();
    _orgId = null;
    _cache = {};
    _loaded = false;
  },
};

// ─── Internals that need the module state ─────────────────────────────────────

async function nextDocumentNumber(type) {
  const { data, error } = await supabase.rpc('next_document_number', {
    p_org: _orgId,
    p_type: type,
  });
  if (error) throw error;
  return data;
}

// Pay is split into employee_compensation so a member or viewer cannot read it.
// A non-admin write is rejected by RLS; that is not fatal to saving the employee.
async function saveCompensation(employeeId, data) {
  const amount = data?.stipend ?? data?.salary;
  if (amount === undefined || amount === null || amount === '') return;

  const { error } = await supabase.from('employee_compensation').upsert({
    employee_id: employeeId,
    org_id: _orgId,
    is_paid: bool(data.isPaid, true),
    amount: num(amount, 0),
    currency: (data.currency || 'INR').slice(0, 3).toUpperCase(),
    payment_frequency: data.paymentFrequency || 'Monthly',
  }, { onConflict: 'employee_id' });

  if (error) console.warn('[orgStore] compensation not saved:', error.message);
}

// Notification read state is per-user now. Under Firebase one person opening a
// notification marked it read for the whole organization.
async function hydrateNotificationReads() {
  const ids = Object.keys(_cache.fin_notifs || {});
  if (ids.length === 0) return;

  const { data, error } = await supabase
    .from('notification_reads').select('notification_id').in('notification_id', ids);
  if (error) return;

  const read = new Set((data || []).map((r) => r.notification_id));
  for (const id of ids) _cache.fin_notifs[id].read = read.has(id);
}

// financial_documents keeps its line items in a child table, and its money
// columns are computed by triggers. Rebuild the flat `items` array the forms
// expect when reading.
async function hydrateFinancialDocuments(orgId) {
  const { data: docs, error } = await supabase
    .from('financial_documents')
    .select('*, document_line_items(*), payments(*)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[orgStore] load fin_docs failed:', error.message);
    _cache.fin_docs = {};
    return;
  }
  _cache.fin_docs = keyById(docs, financialDocFromRow);
}

export function financialDocFromRow(r) {
  const items = (r.document_line_items || [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((li) => ({
      id: li.id, description: li.description, hsn: li.hsn_sac,
      quantity: li.quantity, unit: li.unit, rate: li.rate,
      gst_rate: li.gst_rate, amount: li.line_total,
      // Which catalogue row this line was billed against, if any. Reloading a
      // saved document into a form has to bring this back, or re-saving would
      // silently detach the line and the product would lose the sale.
      catalog_item_id: li.catalog_item_id || null,
    }));

  return {
    id: r.id,
    invoiceNumber: r.doc_number, doc_number: r.doc_number,
    type: r.type, status: r.status, revision: r.revision,
    customer_id: r.customer_id,
    clientName: r.bill_to_name, clientEmail: r.bill_to_email,
    clientAddress: r.bill_to_address, buyerGSTIN: r.bill_to_gstin,
    buyerState: r.bill_to_state,
    issue_date: r.issue_date, due_date: r.due_date, valid_until: r.valid_until,
    // Where this sale happened, frozen onto the document. `country_source`
    // says how it got here — a customer record today, a storefront checkout
    // later — and the Sales by Countries widget groups on country_code without
    // caring which.
    country_code: r.country_code || null,
    country_source: r.country_source || null,
    currency: r.currency,
    subtotal: r.subtotal, discount_type: r.discount_type,
    discount_value: r.discount_value, discount_amount: r.discount_amount,
    taxable_amount: r.taxable_amount,
    gst_enabled: r.gst_enabled, gst_rate: r.gst_rate, gst_amount: r.gst_amount,
    is_inter_state: r.is_inter_state, making_charges: r.making_charges,
    grand_total: r.grand_total, amount_in_words: r.amount_in_words,
    amount_paid: r.amount_paid, advance_percent: r.advance_percent,
    payment_instructions: r.payment_instructions, terms: r.terms, notes: r.notes,
    company_profile: r.company_snapshot,
    items,
    // The ledger behind amount_paid. Absent when the row was selected without
    // the join (api/_lib/docShape.js does exactly that for the portal), so this
    // is always an array and never undefined.
    payments: (r.payments || [])
      .slice()
      .sort((a, b) => new Date(a.paid_on) - new Date(b.paid_on)),
    created_at: r.created_at, updated_at: r.updated_at,
    ...(r.payload || {}),
  };
}

// Columns the database owns. subtotal, discount_amount, taxable_amount,
// gst_amount and grand_total are recomputed by app.recompute_document_totals()
// from the line items; amount_paid by app.recompute_amount_paid() from confirmed
// payments. Writing them from the client would be silently overwritten at best.
function finDocToRow(i) {
  const known = {
    type: i.type,
    status: i.status || 'draft',
    revision: i.revision || 'v1',
    customer_id: nn(i.customer_id),
    bill_to_name: i.clientName || i.bill_to_name || 'Unnamed',
    bill_to_email: nn(i.clientEmail || i.bill_to_email),
    bill_to_address: nn(i.clientAddress || i.bill_to_address),
    bill_to_gstin: nn(i.buyerGSTIN || i.bill_to_gstin),
    bill_to_state: nn(i.buyerState || i.bill_to_state),
    issue_date: date(i.issue_date) || date(nowIso()),
    due_date: date(i.due_date),
    valid_until: date(i.valid_until),
    // Omitted entirely — not nulled — when the caller has no opinion, so the
    // BEFORE INSERT trigger can resolve it from the customer or the org.
    //
    // `undefined` rather than nn(): stripNulls() drops undefined but keeps an
    // explicit null, and nothing re-resolves country on UPDATE. Sending null
    // here would erase a resolved country on any save whose cache entry was
    // cold — editing an old document in a fresh session, say. Passing '' still
    // clears it, which is what someone deliberately blanking the field means.
    country_code: i.country_code === undefined ? undefined : nn(i.country_code),
    country_source: i.country_source === undefined ? undefined : nn(i.country_source),
    currency: (i.currency || 'INR').slice(0, 3).toUpperCase(),
    // The forms speak camelCase and nest the discount; the columns are
    // snake_case and flat. These are not cosmetic aliases: the totals trigger
    // computes subtotal/gst/grand_total from discount_type, discount_value,
    // making_charges, gst_enabled and gst_rate on THIS row, so a name that
    // fails to land here silently saves the wrong money.
    discount_type: nn(i.discount_type ?? i.discountType ?? i.discount?.type),
    discount_value: num(i.discount_value ?? i.discountValue ?? i.discount?.value, 0),
    gst_enabled: bool(i.gst_enabled ?? i.enableGst, true),
    gst_rate: num(i.gst_rate ?? i.gstRate, 18),
    // NOT NULL with a default in the schema. stripNulls() only removes
    // `undefined`, so emitting null here sent an explicit null to Postgres and
    // every insert died with 23502 — which is what stopped invoices saving.
    is_inter_state: bool(i.is_inter_state ?? i.isInterState, false),
    // Deliberately NOT aliased to the forms' `makingCharges`. The trigger ADDS
    // making_charges to the taxable amount, but InvoiceForm's makingCost is an
    // internal per-item cost used for the profit estimate (BillingRevenue.jsx:66
    // subtracts it from revenue). Mapping the two would inflate every total.
    making_charges: num(i.making_charges, 0),
    amount_in_words: nn(i.amount_in_words),
    advance_percent: num(i.advance_percent),
    payment_instructions: nn(i.payment_instructions),
    terms: nn(i.terms),
    notes: nn(i.notes),
    company_snapshot: scrubSnapshot(i.company_profile),
    doc_number: nn(i.doc_number || i.invoiceNumber || i.proformaNumber || i.quotationNumber),
  };

  // Everything the forms carry that has no column keeps working via `payload`.
  const MAPPED = new Set(['id', 'type', 'status', 'revision', 'customer_id',
    // Aliases consumed above. Without these they would also be copied into
    // `payload`, leaving two disagreeing copies of the same number.
    'discountType', 'discountValue', 'discount', 'enableGst', 'gstRate',
    'isInterState',
    'clientName', 'bill_to_name', 'clientEmail', 'bill_to_email', 'clientAddress',
    'bill_to_address', 'buyerGSTIN', 'bill_to_gstin', 'buyerState', 'bill_to_state',
    'issue_date', 'due_date', 'valid_until', 'currency', 'country_code',
    'country_source', 'discount_type',
    'discount_value', 'gst_enabled', 'gst_rate', 'is_inter_state', 'making_charges',
    'amount_in_words', 'advance_percent', 'payment_instructions', 'terms', 'notes',
    'company_profile', 'company_snapshot', 'doc_number', 'invoiceNumber', 'items',
    'subtotal', 'discount_amount', 'taxable_amount', 'gst_amount', 'grand_total',
    // `payments` is a joined child table, not a form field. Without it here the
    // whole ledger would be copied into payload on every save and then shadow
    // the real join when read back.
    'amount_paid', 'payments', 'created_at', 'updated_at', 'org_id', 'payload']);
  const payload = {};
  for (const [k, v] of Object.entries(i)) if (!MAPPED.has(k)) payload[k] = v;
  known.payload = payload;

  return known;
}

// Line items are replaced wholesale: the forms hand back the entire array, and
// unique(document_id, position) makes an in-place diff more trouble than it is
// worth. Deleting them re-fires the totals trigger, so ordering matters.
async function replaceLineItems(documentId, items) {
  if (!Array.isArray(items)) return;

  const { error: delErr } = await supabase
    .from('document_line_items').delete().eq('document_id', documentId);
  if (delErr) throw delErr;

  const rows = items
    .filter((it) => it && (it.description || it.rate || it.quantity))
    .map((it, position) => ({
      document_id: documentId,
      org_id: _orgId,
      position,
      description: it.description || '',
      hsn_sac: nn(it.hsn || it.hsn_sac || it.hsnSac || it.hsnCode),
      quantity: num(it.quantity, 1),
      unit: it.unit || 'Nos',
      rate: num(it.rate, 0),
      gst_rate: num(it.gst_rate),
      // The catalogue attribution. The forms spell it several ways depending on
      // which one saved the document; accept all of them, because a line that
      // arrives without it is a sale that never reaches Product Performance.
      catalog_item_id: nn(it.catalog_item_id || it.catalogItemId || it.productId),
      // line_total is trigger-computed; not sent.
    }));

  if (rows.length === 0) return;
  const { error } = await supabase.from('document_line_items').insert(rows);
  if (error) throw error;
}

// Read the row back after writing so the trigger-computed totals reach the cache.
async function refreshFinDoc(id) {
  const { data, error } = await supabase
    .from('financial_documents')
    .select('*, document_line_items(*), payments(*)').eq('id', id).single();
  if (error) throw error;

  const item = financialDocFromRow(data);
  if (!_cache.fin_docs) _cache.fin_docs = {};
  _cache.fin_docs[id] = item;
  persistToLS();
  notifySection('fin_docs');
  return item;
}

// org_secrets is unreadable and unwritable by every client role, by design.
// The server holds the AES key and does the encryption.
async function saveSecretsViaServer(secrets) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const res = await fetch('/api/org-secrets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ org_id: _orgId, secrets }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Could not save email credentials');
  }
}
