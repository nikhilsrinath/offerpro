import { supabaseAdmin } from './_lib/supabaseAdmin.js';
import { sendError, readJsonBody, HttpError } from './_lib/auth.js';
import { verifyToken } from './_lib/portalToken.js';
import { recordFromRow, financialDocFromRow } from './_lib/docShape.js';

/**
 * The recipient portal's only door into the database.
 *
 *   GET  /api/portal?token=…            → { document, company }
 *   POST /api/portal  { token, action, payload }
 *
 * Recipients have no account. Under Firebase the portal called
 * signInAnonymously() and then read and wrote Firestore and RTDB directly,
 * which — with rules that only asked for `auth != null` — handed every
 * anonymous visitor the whole database. Here `anon` has no grants on any table
 * at all; the token is verified against portal_tokens and this endpoint does
 * the reads and writes under the service role, scoped to the one document the
 * token names.
 */

const SIGNATURE_BUCKET = 'signatures';
const BRANDING_BUCKET = 'org-branding';
const SIGNED_URL_TTL = 60 * 60; // an hour, matching the app's signing elsewhere

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await getDocument(req, res);
    if (req.method === 'POST') return await postAction(req, res);
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
    return sendError(res, err, 'api/portal');
  }
}

// ── Read ─────────────────────────────────────────────────────────────────────

async function getDocument(req, res) {
  const token = new URL(req.url, 'http://localhost').searchParams.get('token');
  const grant = await verifyToken(token);
  const { document, table } = await loadDocument(grant);

  // Opening the link is the "viewed" event the tracker reports on.
  if (['sent', 'pending', 'draft'].includes(document.status)) {
    await patchDocument(grant, table, { status: 'viewed' }, {
      first_viewed_at: document.first_viewed_at || new Date().toISOString(),
      last_viewed_at: new Date().toISOString(),
    });
    document.status = 'viewed';
  }

  const company = await loadCompany(grant.org_id, document, table);
  document.candidate_signature = await signIfPresent(document.signature_path);

  return res.status(200).json({ success: true, document, company, scope: grant.scope });
}

async function loadDocument(grant) {
  const admin = supabaseAdmin();

  if (grant.record_id) {
    const { data, error } = await admin
      .from('records').select('*').eq('id', grant.record_id).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, 'Document not found');
    return { document: recordFromRow(data), table: 'records', row: data };
  }

  const { data, error } = await admin
    .from('financial_documents')
    .select('*, document_line_items(*)')
    .eq('id', grant.financial_doc_id)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, 'Document not found');
  return { document: financialDocFromRow(data), table: 'financial_documents', row: data };
}

/**
 * The live organization profile, so a logo or address changed after issue is
 * reflected. Banking details go out only for the documents that ask to be paid
 * — org_banking is admin-only for every client role, and an offer letter has
 * no business carrying account numbers to a candidate.
 */
async function loadCompany(orgId, document, table) {
  const admin = supabaseAdmin();

  const { data: org, error } = await admin
    .from('organizations')
    .select('company_name, company_tagline, company_email, company_phone, company_address, company_website, owner_full_name, document_designation, logo_path, signature_path, stamp_path')
    .eq('id', orgId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message);
  if (!org) throw new HttpError(404, 'Organization not found');

  const company = {
    company_name: org.company_name || '',
    company_tagline: org.company_tagline || '',
    company_address: org.company_address || '',
    address: org.company_address || '',
    company_email: org.company_email || '',
    email: org.company_email || '',
    company_phone: org.company_phone || '',
    phone: org.company_phone || '',
    company_website: org.company_website || '',
    authorized_person: org.owner_full_name || '',
    authorized_designation: org.document_designation || '',
    logo_url: publicUrl(org.logo_path),
    stamp_url: publicUrl(org.stamp_path),
    signature_url: await signIfPresent(org.signature_path),
  };

  const wantsPayment = table === 'financial_documents';
  if (wantsPayment) {
    const { data: banking } = await admin
      .from('org_banking')
      .select('gstin, upi_id, bank_name, bank_account_number, bank_ifsc, bank_account_type')
      .eq('org_id', orgId)
      .maybeSingle();
    Object.assign(company, banking || {});
  }

  // The snapshot frozen onto the document fills anything the live profile lacks.
  return { ...(document.company_profile || {}), ...prune(company) };
}

function prune(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v != null));
}

function publicUrl(path) {
  if (!path) return '';
  return supabaseAdmin().storage.from(BRANDING_BUCKET).getPublicUrl(path).data.publicUrl;
}

async function signIfPresent(path) {
  if (!path) return '';
  const { data, error } = await supabaseAdmin()
    .storage.from(SIGNATURE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (error) {
    console.warn('[api/portal] could not sign signature URL:', error.message);
    return '';
  }
  return data?.signedUrl || '';
}

// ── Write ────────────────────────────────────────────────────────────────────

/**
 * Every action the portal can take, and the single status each one may set.
 * A recipient cannot name a status: they name an action, and the mapping
 * decides. `signs` marks the actions that capture a signature image.
 */
const ACTIONS = {
  accept_offer:         { status: 'signed',             outcome: 'accepted',     signs: true },
  acknowledge:          { status: 'acknowledged',       outcome: 'acknowledged', signs: true },
  mou_sign:             { status: 'fully_signed',       outcome: 'accepted',     signs: true },
  accept_quotation:     { status: 'accepted',           outcome: 'accepted',     signs: true },
  decline:              { status: 'declined',           outcome: 'declined' },
  request_revision:     { status: 'revision_requested' },
  confirm_order:        { status: 'order_confirmed' },
  payment_confirmation: { status: 'payment_submitted' },
  proforma_payment:     { status: 'advance_paid' },
};

// Once a recipient has responded, the link stops being a way to respond again.
const TERMINAL = new Set(['signed', 'declined', 'accepted', 'fully_signed',
  'acknowledged', 'payment_submitted', 'advance_paid', 'paid', 'cancelled']);

async function postAction(req, res) {
  const body = await readJsonBody(req);
  const { token, action, payload = {} } = body || {};

  const spec = ACTIONS[action];
  if (!spec) throw new HttpError(400, `Unknown action: ${action}`);

  const grant = await verifyToken(token, { requireScope: 'sign' });
  const { document, table } = await loadDocument(grant);

  if (TERMINAL.has(document.status)) {
    throw new HttpError(409, 'A response has already been recorded for this document.');
  }
  if (spec.signs && !payload.signature) {
    throw new HttpError(400, 'A signature is required.');
  }

  // Claim the document before doing any of the work.
  //
  // The check above reads and this writes, and between the two there is a window
  // — a double-tapped Sign button, or the same link open on a phone and a laptop,
  // sends two requests that both see a non-terminal status and both proceed. The
  // signature row is protected by sig_one_per_record, but that failure is only
  // warned about, so the second response still merged itself into the payload and
  // sent a second notification. This UPDATE carries the terminal check in its own
  // WHERE clause, so exactly one of the two can win.
  const claimed = await claimDocument(grant, table, spec.status);
  if (!claimed) {
    throw new HttpError(409, 'A response has already been recorded for this document.');
  }

  const signerName = String(payload.name || document.issued_to || '').trim();
  const extra = { ...buildExtra(action, payload, document), responded_at: new Date().toISOString() };

  let signaturePath = null;
  try {
    if (spec.signs) {
      signaturePath = await storeSignature(grant, payload.signature);
      extra.signature_path = signaturePath;
      extra.signature_method = payload.signature_method || null;
    }
    await patchDocument(grant, table, {}, extra);
  } catch (err) {
    // The status is already advanced. Put it back, or the recipient is locked out
    // of a document they have not actually responded to.
    await releaseDocument(grant, table, document.status);
    throw err;
  }

  // A payment claim becomes a row in the ledger, unconfirmed. Until an admin
  // verifies it, app.recompute_amount_paid() ignores it — so the document's
  // amount_paid and status are untouched — but the claim is now queryable
  // instead of living only inside the jsonb side-channel.
  if (extra.payment_confirmation) {
    await recordClaimedPayment(grant, extra.payment_confirmation);
  }

  if (spec.outcome) {
    await recordSignature(grant, {
      signer_name: signerName,
      signer_email: document.recipient_email || null,
      signature_path: signaturePath,
      outcome: spec.outcome,
      decline_reason: action === 'decline' ? (payload.reason || null) : null,
      req,
    });
  }

  // An HR notice is the instruction to change the employee record; the change
  // lands when the employee acknowledges it, not when the notice is issued.
  if (action === 'acknowledge') await applyHrNotice(grant, document);

  // An accepted offer is what turns a candidate into an employee. Doing it here
  // rather than in the admin's browser means the registry is correct the moment
  // the candidate signs, whether or not anyone has the app open.
  if (action === 'accept_offer' && table === 'records') {
    await onboardAcceptedCandidate(grant, document, signerName);
  }

  await notify(grant, action, document, signerName, payload);

  return res.status(200).json({ success: true, status: spec.status });
}

/** Per-action fields, kept out of the caller's hands so nothing arbitrary is merged. */
function buildExtra(action, payload, document) {
  const now = new Date().toISOString();
  switch (action) {
    case 'accept_offer':
      return { candidate_name: payload.name || document.issued_to, signed_at: now };
    case 'acknowledge':
      return { acknowledged_by: payload.name || document.issued_to, acknowledged_at: now };
    case 'mou_sign':
      return {
        party_b: {
          ...(document.party_b || {}),
          representative: payload.name || document.party_b?.representative,
          designation: payload.designation || document.party_b?.designation,
          signed_at: now,
        },
      };
    case 'accept_quotation':
      return { accepted_by: payload.name || document.issued_to, accepted_at: now };
    case 'decline':
      return { decline_reason: payload.reason || null };
    case 'request_revision':
      return { revision_notes: payload.notes || '' };
    case 'payment_confirmation':
    case 'proforma_payment':
      return { payment_confirmation: sanitizePayment(payload.payment) };
    default:
      return {};
  }
}

/** The recipient's claim about a transfer — evidence for the org, not a ledger entry. */
function sanitizePayment(payment = {}) {
  return {
    amountPaid: Number(payment.amountPaid) || 0,
    transactionId: String(payment.transactionId || '').slice(0, 100),
    paymentDate: payment.paymentDate || null,
    paymentMethod: String(payment.paymentMethod || '').slice(0, 50),
    note: String(payment.note || '').slice(0, 500),
    claimed_at: new Date().toISOString(),
  };
}

/**
 * Moves the document to `newStatus`, but only from a status that has not already
 * responded. Returns false if another request got there first.
 *
 * PostgREST applies the filters as the UPDATE's WHERE clause, so the terminal
 * check and the write are one statement and one row lock — which is what makes
 * this a claim rather than a check followed by a hope.
 */
async function claimDocument(grant, table, newStatus) {
  const id = table === 'records' ? grant.record_id : grant.financial_doc_id;

  const { data, error } = await supabaseAdmin()
    .from(table)
    .update({ status: newStatus })
    .eq('id', id)
    .not('status', 'in', `(${[...TERMINAL].join(',')})`)
    .select('id');

  if (error) throw new HttpError(500, error.message);
  return Array.isArray(data) && data.length > 0;
}

/** Undoes claimDocument() when the work after it fails. */
async function releaseDocument(grant, table, previousStatus) {
  const id = table === 'records' ? grant.record_id : grant.financial_doc_id;
  const { error } = await supabaseAdmin()
    .from(table)
    .update({ status: previousStatus })
    .eq('id', id);
  // Nothing useful to do if even the rollback fails; the thrown error is what the
  // recipient sees, and this line is what tells the operator the status is wrong.
  if (error) console.error('[api/portal] could not roll back status:', error.message);
}

/**
 * Merges the response fields into the jsonb side-channel each table keeps
 * (`records.data`, `financial_documents.payload`), which is where the portal's
 * response fields have always lived, plus any columns the caller names.
 */
async function patchDocument(grant, table, columns, extra) {
  const admin = supabaseAdmin();
  const isRecord = table === 'records';
  const id = isRecord ? grant.record_id : grant.financial_doc_id;
  const blobColumn = isRecord ? 'data' : 'payload';

  const { data: current, error: readErr } = await admin
    .from(table).select(blobColumn).eq('id', id).maybeSingle();
  if (readErr) throw new HttpError(500, readErr.message);

  const { error } = await admin
    .from(table)
    .update({ ...columns, [blobColumn]: { ...(current?.[blobColumn] || {}), ...extra } })
    .eq('id', id);

  if (error) throw new HttpError(500, error.message);
}

async function storeSignature(grant, dataUrl) {
  const match = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl).trim());
  if (!match) throw new HttpError(400, 'Signature must be a PNG, JPEG or WebP image.');

  const [, mime, ext, base64] = match;
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > 1024 * 1024) throw new HttpError(413, 'Signature image is too large.');

  const docId = grant.record_id || grant.financial_doc_id;
  const path = `${grant.org_id}/portal/${docId}-${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`;

  const { error } = await supabaseAdmin()
    .storage.from(SIGNATURE_BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: false });

  if (error) throw new HttpError(500, `Could not store signature: ${error.message}`);
  return path;
}

/**
 * The recipient's claim, as an unconfirmed `payments` row.
 *
 * confirmed_at stays null: the trigger sums only confirmed rows, so nothing
 * about the invoice moves until an admin verifies it in the finance screen.
 * `amount > 0` is a check constraint, and a claim of zero is not a payment —
 * the jsonb copy in the document payload is still the evidence either way, so a
 * failure here is a warning rather than a lost response.
 */
async function recordClaimedPayment(grant, payment) {
  if (!grant.financial_doc_id) return;

  const amount = Number(payment?.amountPaid) || 0;
  if (amount <= 0) return;

  const { error } = await supabaseAdmin().from('payments').insert({
    org_id: grant.org_id,
    document_id: grant.financial_doc_id,
    amount,
    paid_on: payment.paymentDate || new Date().toISOString().slice(0, 10),
    method: payment.paymentMethod || null,
    reference: payment.transactionId || null,
    note: payment.note || null,
    submitted_by_recipient: true,
    confirmed_at: null,
  });
  if (error) console.warn('[api/portal] payment claim not recorded:', error.message);
}

/** The evidentiary record: who signed what, when, and from where. */
async function recordSignature(grant, { signer_name, signer_email, signature_path, outcome, decline_reason, req }) {
  const { error } = await supabaseAdmin().from('document_signatures').insert({
    org_id: grant.org_id,
    record_id: grant.record_id,
    financial_doc_id: grant.financial_doc_id,
    signer_name: signer_name || null,
    signer_email: signer_email || null,
    signature_path,
    outcome,
    decline_reason,
    viewed_at: new Date().toISOString(),
    signer_ip: clientIp(req),
    signer_user_agent: String(req.headers['user-agent'] || '').slice(0, 500) || null,
  });

  // sig_one_per_record / sig_one_per_findoc make a second signature a conflict;
  // the document status is already written, so this is a warning, not a failure.
  if (error) console.warn('[api/portal] signature row not written:', error.message);
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.socket?.remoteAddress || '';
  // inet rejects anything malformed, and IPv6-mapped IPv4 arrives as ::ffff:1.2.3.4.
  const cleaned = ip.replace(/^::ffff:/, '');
  return cleaned || null;
}

async function applyHrNotice(grant, document) {
  if (!document.employee_id) return;
  const admin = supabaseAdmin();

  if (document.type === 'role_change') {
    const updates = {};
    if (document.new_role) updates.role = document.new_role;

    // The notice carries a department name; the column is an FK.
    const departmentId = await resolveDepartment(grant.org_id, document.new_department);
    if (departmentId) updates.department_id = departmentId;

    if (Object.keys(updates).length) {
      const { error } = await admin.from('employees')
        .update(updates).eq('id', document.employee_id).eq('org_id', grant.org_id);
      if (error) console.warn('[api/portal] role change not applied:', error.message);
    }

    // Pay is a separate, admin-only table; a notice that names a new salary
    // updates it there rather than on the employee row.
    if (document.new_salary) {
      const { error: compErr } = await admin.from('employee_compensation')
        .upsert({
          employee_id: document.employee_id,
          org_id: grant.org_id,
          amount: Number(document.new_salary),
        }, { onConflict: 'employee_id' });
      if (compErr) console.warn('[api/portal] compensation not applied:', compErr.message);
    }
    return;
  }

  if (document.type === 'termination') {
    const { error } = await admin.from('employees')
      .update({
        exited_at: document.last_day || new Date().toISOString(),
        // The notice form (Employees.jsx) collects this as `message`; there has
        // never been a `reason` field on it, so every termination was filed
        // under the fallback and the reason the admin typed was never stored.
        exit_reason: document.message || document.reason
          || 'Termination notice acknowledged',
      })
      .eq('id', document.employee_id)
      .eq('org_id', grant.org_id);
    if (error) console.warn('[api/portal] termination not applied:', error.message);
  }
}

// employees.employment_type is an enum of four values; the offer forms speak in
// offer types. Anything unmapped is a full-time hire.
const EMPLOYMENT_TYPE = {
  internship: 'intern', intern: 'intern',
  collaboration: 'contract', contract: 'contract',
  parttime: 'parttime', fulltime: 'fulltime',
};

async function onboardAcceptedCandidate(grant, document, signerName) {
  if (document.type !== 'offer' && document.type !== 'offer_letter') return;
  // Already an employee — an offer issued to someone on the registry, or a
  // second acceptance that slipped past the TERMINAL guard.
  if (document.employee_id) return;

  const admin = supabaseAdmin();
  const data = document.data || {};
  const fullName = String(document.issued_to || data.studentName || signerName || '').trim();
  const email = String(document.recipient_email || data.email || '').trim();
  if (!fullName) return;

  // Email is the app's identity key for a person — Employees.jsx dedupes on it
  // and deletes the older row when two share one — so an offer accepted at an
  // address already on the registry attaches to that employee instead of
  // creating a second row that would later be culled. Say so in the
  // notifications, or the acceptance looks like it did nothing.
  if (email) {
    const { data: existing } = await admin.from('employees')
      .select('id, full_name').eq('org_id', grant.org_id).eq('email', email).maybeSingle();
    if (existing) {
      await linkEmployee(grant, existing.id);
      await noteMatchedEmployee(grant, fullName, email, existing);
      return;
    }
  }

  const departmentId = await resolveDepartment(grant.org_id, document.department || data.department);
  const offerType = document.offer_type || data.offerType;

  const { data: employee, error } = await admin.from('employees').insert({
    org_id: grant.org_id,
    full_name: fullName,
    email: email || null,
    phone: document.recipient_phone || data.phone || null,
    role: document.role || data.role || null,
    department_id: departmentId,
    employment_type: EMPLOYMENT_TYPE[offerType] || 'fulltime',
    supervisor_name: document.supervisor || data.supervisorName || null,
    responsibilities: document.responsibilities || data.responsibilities || null,
    start_date: dateOnly(document.start_date || data.startDate),
    end_date: dateOnly(document.end_date || data.endDate),
  }).select('id').single();

  if (error) {
    // The offer is accepted either way; onboarding is a follow-up the admin can
    // still complete by hand from the Employees page.
    console.warn('[api/portal] employee not created from accepted offer:', error.message);
    return;
  }

  // Pay lives in the admin-only compensation table, never on the employee row.
  const salary = document.salary ?? data.stipend;
  if (salary) {
    const { error: compErr } = await admin.from('employee_compensation').upsert({
      employee_id: employee.id,
      org_id: grant.org_id,
      is_paid: true,
      amount: Number(salary) || 0,
      currency: String(document.currency || data.currency || 'INR').slice(0, 3).toUpperCase(),
      payment_frequency: document.payment_frequency || data.paymentFrequency || 'Monthly',
    }, { onConflict: 'employee_id' });
    if (compErr) console.warn('[api/portal] compensation not saved:', compErr.message);
  }

  await linkEmployee(grant, employee.id);
}

async function noteMatchedEmployee(grant, fullName, email, existing) {
  const { error } = await supabaseAdmin().from('notifications').insert({
    org_id: grant.org_id,
    type: 'offer_signed',
    title: `${fullName} accepted — matched to an existing employee`,
    message: `${email} is already on the registry as "${existing.full_name}", so the offer was linked `
      + `to that employee instead of adding a second one. Use a different address if these are different people.`,
    record_id: grant.record_id,
    financial_doc_id: null,
  });
  if (error) console.warn('[api/portal] match notification not written:', error.message);
}

/** Point the record at the employee it created, so nothing onboards them twice. */
async function linkEmployee(grant, employeeId) {
  const admin = supabaseAdmin();
  const { data: current } = await admin
    .from('records').select('data').eq('id', grant.record_id).maybeSingle();

  const { error } = await admin.from('records').update({
    employee_id: employeeId,
    data: { ...(current?.data || {}), employee_synced: true },
  }).eq('id', grant.record_id);
  if (error) console.warn('[api/portal] record not linked to employee:', error.message);
}

const dateOnly = (v) => (v ? String(v).slice(0, 10) : null);

async function resolveDepartment(orgId, name) {
  if (!name) return null;
  const { data } = await supabaseAdmin()
    .from('departments')
    .select('id')
    .eq('org_id', orgId)
    .ilike('name', String(name).trim())
    .maybeSingle();
  return data?.id || null;
}

const NOTIFICATION_COPY = {
  accept_offer:         (who, doc) => ['offer_signed', `Offer accepted by ${who}`, `${who} has signed offer ${doc.doc_number || doc.id}`],
  acknowledge:          (who, doc) => [`${doc.type}_acknowledged`, `${labelFor(doc.type)} acknowledged by ${who}`, `${who} has acknowledged the ${labelFor(doc.type).toLowerCase()}.`],
  mou_sign:             (who, doc) => ['mou_fully_signed', 'MoU fully signed', `Both parties have signed ${doc.doc_number || doc.id}`],
  accept_quotation:     (who, doc) => ['quotation_accepted', 'Quotation accepted', `${who} accepted ${doc.doc_number || doc.id}`],
  decline:              (who, doc, p) => ['document_declined', 'Document declined', `${who} declined ${doc.doc_number || doc.id}. Reason: ${p.reason || 'Not specified'}`],
  request_revision:     (who, doc, p) => ['revision_requested', `Revision requested for ${doc.doc_number || doc.id}`, p.notes || ''],
  confirm_order:        (who, doc) => ['order_confirmed', `Order confirmed for ${doc.doc_number || doc.id}`, `${who} confirmed the order.`],
  payment_confirmation: (who, doc, p) => ['payment_submitted', `Payment submitted for ${doc.doc_number || doc.id}`, `${formatAmount(p.payment)} — UTR: ${p.payment?.transactionId || '—'}`],
  proforma_payment:     (who, doc, p) => ['advance_paid', `Advance payment received for ${doc.doc_number || doc.id}`, `${formatAmount(p.payment)} advance paid`],
};

function labelFor(type) {
  return type === 'role_change' ? 'Role change notice' : type === 'termination' ? 'Termination notice' : 'Document';
}

function formatAmount(payment) {
  const amount = Number(payment?.amountPaid) || 0;
  return `₹${amount.toLocaleString('en-IN')}`;
}

async function notify(grant, action, document, signerName, payload) {
  const build = NOTIFICATION_COPY[action];
  if (!build) return;

  const [type, title, message] = build(signerName || 'The recipient', document, payload);
  const { error } = await supabaseAdmin().from('notifications').insert({
    org_id: grant.org_id,
    type,
    title,
    message,
    record_id: grant.record_id,
    financial_doc_id: grant.financial_doc_id,
  });
  if (error) console.warn('[api/portal] notification not written:', error.message);
}
