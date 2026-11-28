// noticeModel.js: an employee's notice of termination, as an editable template.
//
// buildNotice() returns the same shape as agreementModel.buildAgreement(), so
// the live sheet (AgreementPreview) and the PDF (pdfService.generateAgreement)
// render it with no code of their own, and the two cannot say different things.
// The company is the "first party" in the field names those two already read
// (firstPartyName, firstPartyAddress, firstPartySignature...).

import { fmtDate, fmtDatePreamble } from './agreementModel';

const BLANK = '___________';
const para = (text) => ({ kind: 'para', text });
const bold = (text) => ({ kind: 'bold', text });
const lines = (s) => (s || '').split('\n').map((l) => l.trim()).filter(Boolean);

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function inWords(n) {
  const v = parseInt(n, 10);
  if (!(v >= 0) || v > 999) return String(n);
  if (v <= 20) return NUMBER_WORDS[v];
  if (v < 100) return TENS[Math.floor(v / 10)] + (v % 10 ? `-${NUMBER_WORDS[v % 10]}` : '');
  return `${NUMBER_WORDS[Math.floor(v / 100)]} hundred${v % 100 ? ` and ${inWords(v % 100)}` : ''}`;
}

const today = () => new Date().toISOString().slice(0, 10);

/** `iso` plus `days` calendar days, as YYYY-MM-DD. */
export function addDays(iso, days) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (parseInt(days, 10) || 0));
  return d.toISOString().slice(0, 10);
}

export const NOTICE_PAY = {
  serve: 'Serves the notice period',
  lieu: 'Paid in lieu of notice',
};

export const DEFAULT_SETTLEMENT = 'Your salary up to the last working day, payment for earned leave not availed (where Company policy provides for it) and any other amounts due to you will be paid in a full and final settlement, after adjusting any amounts you owe the Company. Your relieving letter and experience certificate will be issued once the settlement is complete.';
export const DEFAULT_PROPERTY = 'On or before your last working day, please return all Company property in your possession, including your laptop and other equipment, ID and access cards, documents, and files, and hand over your work and its status to the person your manager names.';
export const DEFAULT_CONFIDENTIALITY = 'Your obligations of confidentiality, and any other obligations in your employment agreement that are meant to continue, remain in force after your employment ends.';

/** A new notice for `emp`, filled from the employee and the active org. */
export function initialNotice(emp = {}, org = {}) {
  const noticeDate = today();
  const noticeDays = '30';
  return {
    title: 'Notice of Termination of Employment',
    noticeDate,
    noticeDays,
    lastDay: addDays(noticeDate, noticeDays),
    // Until the last day is typed, it follows the notice date and period.
    lastDayTyped: false,
    noticePay: 'serve',
    settlementDays: '45',
    reason: '',

    employeeName: emp.studentName || emp.name || '',
    employeeCode: emp.employee_code || '',
    employeeRole: emp.role || '',
    employeeDepartment: emp.department || '',
    employeeAddress: emp.address || emp.studentAddress || '',

    showSettlement: true,
    settlementText: DEFAULT_SETTLEMENT,
    showProperty: true,
    propertyText: DEFAULT_PROPERTY,
    showConfidentiality: true,
    confidentialityText: DEFAULT_CONFIDENTIALITY,
    // Any clauses of the admin's own, each a heading and its text.
    clauses: [],
    closingText: 'Please sign below to acknowledge that you have received this notice. We thank you for your contribution to the Company and wish you well for the future.',

    companyLogo: org.logo_url || null,
    companyTagline: org.company_tagline || '',
    cin: org.cin || '',
    companyPhone: org.company_phone || '',
    companyEmail: org.company_email || '',
    companyWebsite: org.company_website || '',
    stampType: org.stamp_type || 'generated',
    stampUrl: org.stamp_url || '',
    stampCity: org.stamp_city || '',
    showStamp: true,

    firstPartyName: org.company_name || '',
    firstPartyAddress: org.company_address || '',
    firstPartySignatoryName: org.owner_full_name || '',
    firstPartySignatoryDesignation: org.document_designation || '',
    firstPartySignature: org.signature_url || null,
  };
}

export function buildNotice(data) {
  const company = data.firstPartyName || 'the Company';
  const name = data.employeeName || BLANK;
  const days = parseInt(data.noticeDays, 10) || 0;
  const lieu = data.noticePay === 'lieu';
  const title = (data.title || '').trim() || 'Notice of Termination of Employment';

  const preamble = [
    para(`Date: ${fmtDatePreamble(data.noticeDate)}`),
    bold('To,'),
    // The address block: one line each, with no space between them.
    ...[
      name,
      [data.employeeRole, data.employeeDepartment].filter(Boolean).join(', '),
      data.employeeCode && `Employee ID: ${data.employeeCode}`,
      ...lines(data.employeeAddress),
    ].filter(Boolean).map((text) => ({ kind: 'line', text })),
    bold(`Subject: ${title}`),
    para(`Dear ${data.employeeName || 'Sir / Madam'},`),
  ];

  const clauses = [];
  clauses.push({
    heading: 'NOTICE',
    blocks: [
      para(`This letter is formal notice that your employment with ${company}${data.employeeRole ? ` as ${data.employeeRole}` : ''} will end. You are given ${days} (${inWords(days)}) day${days === 1 ? '' : 's'}' notice from ${fmtDate(data.noticeDate)}, and your last working day will be ${fmtDate(data.lastDay)}.`),
    ],
  });
  if ((data.reason || '').trim()) {
    clauses.push({ heading: 'REASON', blocks: lines(data.reason).map(para) });
  }
  clauses.push({
    heading: 'NOTICE PERIOD',
    blocks: [para(lieu
      ? `The Company will pay you your salary for the notice period in lieu of notice. You are not required to report to work after ${fmtDate(data.noticeDate)}, and the payment will be made with your full and final settlement.`
      : `During the notice period you will continue to receive your salary and are expected to carry out your duties as usual, and to complete a handover of your work before your last working day.`)],
  });
  if (data.showSettlement) {
    const within = parseInt(data.settlementDays, 10);
    clauses.push({
      heading: 'FULL AND FINAL SETTLEMENT',
      blocks: [
        ...lines(data.settlementText).map(para),
        ...(within > 0 ? [para(`The settlement will be paid within ${within} (${inWords(within)}) days of your last working day.`)] : []),
      ],
    });
  }
  if (data.showProperty) clauses.push({ heading: 'RETURN OF COMPANY PROPERTY', blocks: lines(data.propertyText).map(para) });
  if (data.showConfidentiality) clauses.push({ heading: 'CONFIDENTIALITY', blocks: lines(data.confidentialityText).map(para) });
  for (const c of data.clauses || []) {
    if (!(c.heading || '').trim() && !(c.body || '').trim()) continue;
    clauses.push({ heading: (c.heading || '').trim().toUpperCase(), blocks: lines(c.body).map(para) });
  }

  let n = 0;
  const numbered = clauses.map((c) => ({ ...c, heading: c.heading ? `${++n}. ${c.heading}` : '' }));
  if ((data.closingText || '').trim()) numbered.push({ heading: '', blocks: lines(data.closingText).map(para) });

  const slug = (s) => (s || '').trim().replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');
  return {
    title: title.toUpperCase(),
    preamble,
    clauses: numbered,
    closing: '',
    signatories: [
      {
        party: `For ${data.firstPartyName || BLANK}`,
        name: data.firstPartySignatoryName, designation: data.firstPartySignatoryDesignation,
        date: fmtDate(data.noticeDate),
        side: 'firstParty', signature: data.firstPartySignature, signatureAdjust: data.firstPartySignatureAdjust, stamp: true,
      },
      {
        party: 'Received and acknowledged',
        name: data.employeeName, designation: data.employeeRole,
        date: BLANK,
        side: 'secondParty', signature: null, stamp: false,
      },
    ],
    witnesses: false,
    fileName: `${['Notice', slug(data.employeeName)].filter(Boolean).join('_')}.pdf`,
  };
}
