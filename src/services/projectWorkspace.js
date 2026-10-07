// projectWorkspace.js: the rules behind a project's Client, Vendor and
// Documents pages that are worth testing on their own: validation, invoice
// state, template placeholders, and turning a template's HTML into something
// a PDF or a Word file can be built from. Nothing here touches the network or
// the DOM (the unit tests run in node).

// ─── Validation ──────────────────────────────────────────────────────────────

export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
/** 7–15 digits, allowing + ( ) - . and spaces around them. */
export const isPhone = (v) => {
  const s = String(v || '').trim();
  if (!/^\+?[\d\s().-]+$/.test(s)) return false;
  const digits = s.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
};
export const isUrl = (v) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(String(v || '').trim());
/** Indian GSTIN: 2 digits, PAN (5 letters, 4 digits, 1 letter), entity digit, Z, check char. */
export const isGstin = (v) => /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(v || '').trim().toUpperCase());
export const isIfsc = (v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(v || '').trim().toUpperCase());
export const isSwift = (v) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(String(v || '').trim().toUpperCase());

/**
 * Checks a form against rules and returns { field: message } for what fails.
 * rules: { field: [{ test: (value, form) => bool, message }] }; an empty
 * optional value skips every rule but `required`.
 */
export function validate(form, rules) {
  const errors = {};
  for (const [field, list] of Object.entries(rules)) {
    const value = form[field];
    const empty = value == null || String(value).trim() === '';
    for (const rule of list) {
      if (rule.required) {
        if (empty) { errors[field] = rule.message || 'Required.'; break; }
        continue;
      }
      if (empty) break;
      if (!rule.test(value, form)) { errors[field] = rule.message; break; }
    }
  }
  return errors;
}

/** The standard rules for a contact person list: a name, and a valid email/phone when given. */
export function contactErrors(contacts) {
  const out = [];
  contacts.forEach((c, i) => {
    if (!String(c.name || '').trim()) out.push(`Contact ${i + 1} needs a name.`);
    if (c.email && !isEmail(c.email)) out.push(`Contact ${i + 1}: that email does not look right.`);
    if (c.phone && !isPhone(c.phone)) out.push(`Contact ${i + 1}: that phone number does not look right.`);
  });
  if (contacts.length && contacts.filter((c) => c.primary).length !== 1) out.push('Mark exactly one contact as primary.');
  return out;
}

// ─── Invoices and payments ───────────────────────────────────────────────────

export const PAYMENT_STATUSES = [
  { id: 'paid', label: 'Paid', color: '#10b981' },
  { id: 'partial', label: 'Partially paid', color: '#3b82f6' },
  { id: 'pending', label: 'Pending', color: '#f59e0b' },
  { id: 'overdue', label: 'Overdue', color: '#ef4444' },
];
export const PAYMENT_BY_ID = Object.fromEntries(PAYMENT_STATUSES.map((s) => [s.id, s]));

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** Days from `a` to `b` (YYYY-MM-DD), b − a. */
export function dayDiff(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/**
 * Where one invoice stands for the project. `share` is the project's part of
 * it (1 = all). Overdue is automatic: a balance left after the due date.
 * `dueSoon` is a balance falling due within `soonDays`.
 */
export function invoiceState(doc, { share = 1, today, soonDays = 7 } = {}) {
  const total = round2(Number(doc.grand_total) * share);
  const paid = round2(Math.min(Number(doc.amount_paid) || 0, Number(doc.grand_total) || 0) * share);
  const balance = round2(Math.max(0, total - paid));
  const due = doc.due_date ? String(doc.due_date).slice(0, 10) : null;
  let status;
  if (total > 0 && balance <= 0.005) status = 'paid';
  else if (due && today && due < today) status = 'overdue';
  else if (paid > 0) status = 'partial';
  else status = 'pending';
  const daysLeft = due && today ? dayDiff(today, due) : null;
  return {
    total, paid, balance, status, due,
    daysLate: status === 'overdue' ? -daysLeft : 0,
    dueSoon: status !== 'paid' && status !== 'overdue' && daysLeft != null && daysLeft >= 0 && daysLeft <= soonDays,
  };
}

/** The four headline figures. Pending is what the contract has not yet brought in. */
export function paymentTotals(contractValue, states) {
  const invoiced = round2(states.reduce((s, x) => s + x.total, 0));
  const received = round2(states.reduce((s, x) => s + x.paid, 0));
  const overdue = round2(states.filter((x) => x.status === 'overdue').reduce((s, x) => s + x.balance, 0));
  const value = round2(Math.max(Number(contractValue) || 0, invoiced));
  return { value, invoiced, received, pending: round2(Math.max(0, value - received)), overdue };
}

// ─── Template placeholders ───────────────────────────────────────────────────

export const PLACEHOLDER_GROUPS = [
  { id: 'company', label: 'Your company' },
  { id: 'project', label: 'Project' },
  { id: 'client', label: 'Client' },
  { id: 'vendor', label: 'Vendor' },
  { id: 'date', label: 'Dates' },
];

export const PLACEHOLDERS = [
  { key: 'company_name', label: 'Company name', group: 'company' },
  { key: 'company_address', label: 'Company address', group: 'company' },
  { key: 'company_email', label: 'Company email', group: 'company' },
  { key: 'company_phone', label: 'Company phone', group: 'company' },
  { key: 'company_website', label: 'Company website', group: 'company' },
  { key: 'company_gstin', label: 'Company GSTIN', group: 'company' },
  { key: 'company_cin', label: 'Company CIN', group: 'company' },
  { key: 'project_name', label: 'Project name', group: 'project' },
  { key: 'project_code', label: 'Project code', group: 'project' },
  { key: 'project_description', label: 'Project description', group: 'project' },
  { key: 'project_start', label: 'Start date', group: 'project' },
  { key: 'project_end', label: 'Target end date', group: 'project' },
  { key: 'project_manager', label: 'Project manager', group: 'project' },
  { key: 'amount', label: 'Contract value', group: 'project' },
  { key: 'client_name', label: 'Client name', group: 'client' },
  { key: 'client_contact', label: 'Contact person', group: 'client' },
  { key: 'client_email', label: 'Client email', group: 'client' },
  { key: 'client_phone', label: 'Client phone', group: 'client' },
  { key: 'client_address', label: 'Billing address', group: 'client' },
  { key: 'client_gstin', label: 'Client GSTIN', group: 'client' },
  { key: 'vendor_name', label: 'Vendor name', group: 'vendor' },
  { key: 'vendor_contact', label: 'Contact person', group: 'vendor' },
  { key: 'vendor_email', label: 'Vendor email', group: 'vendor' },
  { key: 'vendor_phone', label: 'Vendor phone', group: 'vendor' },
  { key: 'vendor_address', label: 'Vendor address', group: 'vendor' },
  { key: 'vendor_gstin', label: 'Vendor GSTIN', group: 'vendor' },
  { key: 'date', label: "Today's date", group: 'date' },
];
export const PLACEHOLDER_BY_KEY = Object.fromEntries(PLACEHOLDERS.map((p) => [p.key, p]));

// What people actually type for a variable, mapped to its key.
const ALIASES = {
  company: 'company_name', your_company: 'company_name', your_company_name: 'company_name', organisation: 'company_name',
  organization: 'company_name', org_name: 'company_name',
  client: 'client_name', customer: 'client_name', customer_name: 'client_name',
  vendor: 'vendor_name', supplier: 'vendor_name', supplier_name: 'vendor_name',
  project: 'project_name', manager: 'project_manager', project_manager_name: 'project_manager',
  contract_value: 'amount', value: 'amount', project_value: 'amount',
  today: 'date', todays_date: 'date', current_date: 'date',
  start_date: 'project_start', end_date: 'project_end', target_end_date: 'project_end',
};

const fmtDay = (d) => (d
  ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  : '');
export const fmtMoney = (v, currency = 'INR') => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
};

const str = (v) => (v == null ? '' : String(v).trim());

/**
 * What each placeholder fills with, from whatever the project knows. Unknowns
 * are ''. `company` is the org profile (or just its name).
 */
export function placeholderValues({ project = {}, client = null, vendor = null, manager = '', company = '', today }) {
  const primary = (client?.contacts || []).find((c) => c.primary) || null;
  const vPrimary = (vendor?.contacts || []).find((c) => c.primary) || null;
  const co = typeof company === 'string' ? { company_name: company } : (company || {});
  return {
    company_name: str(co.company_name || co.name),
    company_address: str(co.company_address),
    company_email: str(co.company_email),
    company_phone: str(co.company_phone),
    company_website: str(co.company_website),
    company_gstin: str(co.gstin).toUpperCase(),
    company_cin: str(co.cin).toUpperCase(),
    project_name: str(project.name),
    project_code: str(project.code),
    project_description: str(project.description),
    project_start: fmtDay(project.start_date),
    project_end: fmtDay(project.target_end_date),
    project_manager: str(manager),
    amount: Number(project.contract_value) > 0 ? fmtMoney(project.contract_value, project.currency || 'INR') : '',
    client_name: str(client?.name || client?.clientName),
    client_contact: str(primary?.name || client?.person_name),
    client_email: str(primary?.email || client?.email),
    client_phone: str(primary?.phone || client?.phone),
    client_address: str(client?.address),
    client_gstin: str(client?.gstin).toUpperCase(),
    vendor_name: str(vendor?.company_name),
    vendor_contact: str(vPrimary?.name || vendor?.contact_name),
    vendor_email: str(vPrimary?.email || vendor?.email),
    vendor_phone: str(vPrimary?.phone || vendor?.phone),
    vendor_address: str(vendor?.address),
    vendor_gstin: str(vendor?.gstin).toUpperCase(),
    date: fmtDay(today),
  };
}

/** The variables that have something to fill with, in display order. */
export function availablePlaceholders(values) {
  return PLACEHOLDERS.filter((p) => str(values[p.key]));
}

// {{ … }} with anything but braces inside, tags included: a rich-text editor
// happily wraps part of a variable in <b> or a stray <span>.
const PH = /\{\{((?:[^{}<]|<[^>]*>){1,120}?)\}\}/g;

/**
 * The key a placeholder means. Forgiving about how it was typed,
 * `{{ Company Name }}`, `{{company-name}}`, `{{<b>company</b>_name}}` and
 * `{{company}}` all mean company_name. Returns '' for something that is not
 * a name at all.
 */
export function placeholderKey(inner) {
  const text = decode(String(inner).replace(/<[^>]*>/g, ''))
    .toLowerCase().trim().replace(/['’]/g, '').replace(/[\s\-.]+/g, '_').replace(/_+/g, '_');
  if (!/^[a-z][a-z0-9_]*$/.test(text)) return '';
  return ALIASES[text] || text;
}

/** The placeholder keys a text uses, once each, in order. */
export function findPlaceholders(text) {
  const seen = [];
  for (const m of String(text || '').matchAll(PH)) {
    const key = placeholderKey(m[1]);
    if (key && !seen.includes(key)) seen.push(key);
  }
  return seen;
}

/**
 * Fills {{key}} from `values`, HTML-escaped. A key with no value is left as
 * it is, so the reader can see what still needs filling. Tags caught inside
 * the braces are kept after the value so the markup stays balanced.
 */
export function fillPlaceholders(html, values) {
  return String(html || '').replace(PH, (whole, inner) => {
    const key = placeholderKey(inner);
    const v = key ? values[key] : '';
    if (v == null || String(v).trim() === '') return whole;
    return escapeHtml(v) + (inner.match(/<[^>]*>/g) || []).join('');
  });
}

// ─── HTML (the template editor's output) ─────────────────────────────────────

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function decode(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'li', 'blockquote']);
const INLINE = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u' };
const KEEP = new Set(['p', 'div', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'u', 'br', 'blockquote']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math']);
// A <br> is held as U+2028 inside a run until the block is finished.
const BR = String.fromCharCode(0x2028);
const BR_RUN = new RegExp(` ?${BR} ?`, 'g');
const TOKEN = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|[^<]+|</g;

/**
 * The template editor's HTML reduced to a few formatting tags with no
 * attributes: safe to render with dangerouslySetInnerHTML and to store.
 */
export function sanitizeHtml(html) {
  let out = '';
  let skip = 0;
  let skipTag = '';
  for (const m of String(html || '').matchAll(TOKEN)) {
    const [tok, rawName] = m;
    if (tok.startsWith('<!--')) continue;
    const name = rawName?.toLowerCase();
    const closing = tok.startsWith('</');
    if (skip) {
      if (name === skipTag) skip += closing ? -1 : (tok.endsWith('/>') ? 0 : 1);
      continue;
    }
    if (!name) { out += tok === '<' ? '&lt;' : escapeHtml(decode(tok)); continue; }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !tok.endsWith('/>')) { skip = 1; skipTag = name; }
      continue;
    }
    if (!KEEP.has(name)) continue;
    if (name === 'br') { out += '<br>'; continue; }
    out += closing ? `</${name}>` : `<${name}>`;
  }
  return out;
}

/**
 * HTML to blocks: [{ type: 'h1'|'h2'|'h3'|'p'|'li'|'quote', list: 'ul'|'ol'|null,
 * index, depth, runs: [{ text, b, i, u }] }]. A <br> is a '\n' inside a run.
 */
export function htmlToBlocks(html) {
  const blocks = [];
  const lists = [];
  const style = { b: 0, i: 0, u: 0 };
  let cur = null;
  const open = (type) => {
    flush();
    const list = lists[lists.length - 1] || null;
    if (type === 'li' && list) list.n += 1;
    cur = { type, list: type === 'li' && list ? list.kind : null, index: type === 'li' && list ? list.n : 0, depth: Math.max(0, lists.length - 1), runs: [] };
  };
  const flush = () => {
    if (cur && cur.runs.some((r) => r.text.trim())) {
      // Source whitespace collapses as a browser would; a <br> (held as
      // U+2028 until now) becomes a real line break.
      cur.runs = cur.runs.map((r) => ({ ...r, text: r.text.replace(/[ \t\r\n]+/g, ' ').replace(BR_RUN, '\n') }));
      blocks.push(cur);
    }
    cur = null;
  };
  const text = (t) => {
    if (!cur) open('p');
    const run = { text: t, b: style.b > 0, i: style.i > 0, u: style.u > 0 };
    const last = cur.runs[cur.runs.length - 1];
    if (last && last.b === run.b && last.i === run.i && last.u === run.u) last.text += t;
    else cur.runs.push(run);
  };
  for (const m of sanitizeHtml(html).matchAll(TOKEN)) {
    const [tok, rawName] = m;
    const name = rawName?.toLowerCase();
    if (!name) { text(decode(tok)); continue; }
    const closing = tok.startsWith('</');
    if (name === 'br') { text(BR); continue; }
    if (INLINE[name]) { style[INLINE[name]] += closing ? -1 : 1; style[INLINE[name]] = Math.max(0, style[INLINE[name]]); continue; }
    if (name === 'ul' || name === 'ol') {
      flush();
      if (closing) lists.pop(); else lists.push({ kind: name, n: 0 });
      continue;
    }
    if (BLOCK.has(name)) {
      if (closing) flush();
      else open(name === 'blockquote' ? 'quote' : name === 'div' ? 'p' : name);
    }
  }
  flush();
  // Trim each block's outer whitespace (not its line breaks).
  return blocks.map((b) => {
    const runs = b.runs.slice();
    runs[0] = { ...runs[0], text: runs[0].text.replace(/^ +/, '') };
    const l = runs.length - 1;
    runs[l] = { ...runs[l], text: runs[l].text.replace(/ +$/, '') };
    return { ...b, runs: runs.filter((r) => r.text) };
  });
}

/** Plain text of a template, for search and previews. */
export const htmlToText = (html) => htmlToBlocks(html).map((b) => b.runs.map((r) => r.text).join('')).join('\n');

/** A minimal Word document (the parts of WordprocessingML every reader accepts). */
export function blocksToDocxXml(blocks) {
  const x = (s) => escapeHtml(s).replace(/'/g, '&apos;');
  const SIZE = { h1: 36, h2: 30, h3: 26 };
  const paras = blocks.map((b) => {
    const size = SIZE[b.type];
    const prefix = b.type === 'li' ? (b.list === 'ol' ? `${b.index}. ` : '• ') : '';
    const ind = b.type === 'li' ? `<w:ind w:left="${360 * (b.depth + 1)}" w:hanging="260"/>` : b.type === 'quote' ? '<w:ind w:left="480"/>' : '';
    const spacing = `<w:spacing w:after="${size ? 160 : 120}"/>`;
    const runs = [{ text: prefix, b: false, i: false, u: false }, ...b.runs].filter((r) => r.text).map((r) => {
      const props = [
        (r.b || size) ? '<w:b/>' : '', r.i || b.type === 'quote' ? '<w:i/>' : '', r.u ? '<w:u w:val="single"/>' : '',
        size ? `<w:sz w:val="${size}"/>` : '',
      ].join('');
      return r.text.split('\n').map((part, k) => `${k ? '<w:r><w:br/></w:r>' : ''}<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${x(part)}</w:t></w:r>`).join('');
    }).join('');
    return `<w:p><w:pPr>${spacing}${ind}</w:pPr>${runs}</w:p>`;
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + (paras || '<w:p/>')
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
    + '</w:body></w:document>';
}

export const DOCX_PARTS = {
  '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>',
  '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>',
};

// ─── Files ───────────────────────────────────────────────────────────────────

export const FILE_KINDS = [
  { id: 'pdf', label: 'PDF', test: (m, n) => m === 'application/pdf' || /\.pdf$/i.test(n) },
  { id: 'image', label: 'Image', test: (m, n) => m.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(n) },
  { id: 'doc', label: 'Document', test: (m, n) => /word|opendocument\.text|rtf/.test(m) || /\.(docx?|odt|rtf|pages)$/i.test(n) },
  { id: 'sheet', label: 'Spreadsheet', test: (m, n) => /sheet|excel|csv/.test(m) || /\.(xlsx?|ods|csv|numbers)$/i.test(n) },
  { id: 'slides', label: 'Presentation', test: (m, n) => /presentation|powerpoint/.test(m) || /\.(pptx?|odp|key)$/i.test(n) },
  { id: 'text', label: 'Text', test: (m, n) => m.startsWith('text/') || /\.(txt|md|html?|json|xml)$/i.test(n) },
  { id: 'archive', label: 'Archive', test: (m, n) => /zip|compressed|tar|rar/.test(m) || /\.(zip|rar|7z|tar|gz)$/i.test(n) },
];
export function fileKind(mime = '', name = '') {
  return FILE_KINDS.find((k) => k.test(String(mime || '').toLowerCase(), String(name || '')))?.id || 'other';
}
/** Previewable in the browser: PDFs, images and plain text. */
export const canPreview = (mime, name) => ['pdf', 'image', 'text'].includes(fileKind(mime, name));

export function fmtBytes(b) {
  const n = Number(b) || 0;
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** The folder path from the top down to `id`. */
export function folderPath(folders, id) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out = [];
  const seen = new Set();
  for (let f = byId.get(id); f && !seen.has(f.id); f = byId.get(f.parent_id)) { seen.add(f.id); out.unshift(f); }
  return out;
}
/** `id` and every folder under it. */
export function folderSubtree(folders, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) { out.add(f.id); grew = true; }
  }
  return out;
}
