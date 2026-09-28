// agreementModel.js — the one description of a Partnership or Custom agreement.
//
// AgreementPreview (the live sheet) and pdfService.generateAgreement (the PDF)
// both render what buildAgreement() returns, so the page on screen and the file
// that downloads cannot say different things.
//
// A built agreement is plain data:
//   { title, preamble: [block], clauses: [{ heading, blocks: [block] }],
//     closing, signatories: [party], witnesses, fileName }
// where a block is { kind: 'para' | 'bold' | 'italic' | 'center' | 'bullet', text }.

const BLANK = '___________';

export const TEMPLATE_KINDS = {
  partnership: { label: 'Partnership Agreement', short: 'Partnership' },
  custom: { label: 'Custom Template', short: 'Custom' },
};

export function fmtDatePreamble(d) {
  if (!d) return BLANK;
  return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function fmtDate(d) {
  if (!d) return BLANK;
  const dt = new Date(d);
  const day = dt.getDate();
  const suffix = [null, 'st', 'nd', 'rd'][day % 10 > 3 ? 0 : (day % 100 - day % 10 === 10 ? 0 : day % 10)] || 'th';
  return `${day}${suffix} ${dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
}

function numWord(n) {
  const w = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  return w[parseInt(n, 10)] || String(n);
}

const lines = (s) => (s || '').split('\n').map((l) => l.trim()).filter(Boolean);
const para = (text) => ({ kind: 'para', text });
const bold = (text) => ({ kind: 'bold', text });
const bullet = (text) => ({ kind: 'bullet', text });

/** Blank form state for a template kind, pre-filled from the active org. */
export function initialAgreement(kind, org = {}) {
  return {
    templateKind: kind,
    title: kind === 'partnership' ? 'Partnership Agreement' : '',
    effectiveDate: '',
    executionCity: '',
    executionState: '',

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

    // Custom templates choose which of these appear; a partnership has all three.
    showFirstParty: true,
    showSecondParty: true,
    showWitnesses: true,

    firstPartyName: org.company_name || '',
    firstPartyIncorporation: 'India',
    firstPartyAddress: org.company_address || '',
    secondPartyName: '',
    secondPartyType: 'company',
    secondPartyIncorporation: 'India',
    secondPartyAddress: '',

    // Partnership terms.
    businessName: '',
    businessPurpose: '',
    firstPartyContribution: '',
    secondPartyContribution: '',
    firstPartyShare: '50',
    firstPartyResponsibilities: '',
    secondPartyResponsibilities: '',
    termYears: '3',
    noticeDays: '60',
    arbitrationCity: '',

    // Custom template body: numbered clauses, each a heading and its text.
    clauses: kind === 'custom' ? [{ id: 1, heading: '', body: '' }] : [],

    firstPartySignatoryName: org.owner_full_name || '',
    firstPartySignatoryDesignation: org.document_designation || '',
    firstPartySignatoryDate: '',
    firstPartySignature: org.signature_url || null,
    secondPartySignatoryName: '',
    secondPartySignatoryDesignation: '',
    secondPartySignatoryDate: '',
    secondPartySignature: null,
  };
}

/** Which parties this agreement names. A partnership always names both. */
export function partiesShown(data) {
  const custom = data.templateKind === 'custom';
  return {
    first: custom ? !!data.showFirstParty : true,
    second: custom ? !!data.showSecondParty : true,
    witnesses: custom ? !!data.showWitnesses : true,
  };
}

function partyParas(data, shown) {
  const fp = data.firstPartyName || BLANK;
  const sp = data.secondPartyName || BLANK;
  const spType = data.secondPartyType === 'individual' ? 'an individual' : 'a company';
  const tail = (label, end) => `(hereinafter referred to as the "${label}", which expression shall unless repugnant to the context or meaning thereof include its successors and permitted assigns)${end}`;
  const blocks = [];
  const both = shown.first && shown.second;

  if (shown.first) {
    blocks.push(para(`${fp.toUpperCase()}, a company incorporated under the laws of ${data.firstPartyIncorporation || 'India'}, having its registered office at ${data.firstPartyAddress || BLANK} ${tail('First Party', both ? ';' : '.')}`));
  }
  if (both) blocks.push({ kind: 'center', text: 'AND' });
  if (shown.second) {
    const where = data.secondPartyType === 'individual'
      ? `residing at ${data.secondPartyAddress || BLANK}`
      : `incorporated under the laws of ${data.secondPartyIncorporation || 'India'}, having its registered office at ${data.secondPartyAddress || BLANK}`;
    blocks.push(para(`${sp.toUpperCase()}, ${spType} ${where} ${tail('Second Party', '.')}`));
  }
  if (both) {
    blocks.push({ kind: 'italic', text: 'The First Party and Second Party shall hereinafter individually be referred to as a "Party" and collectively as the "Parties."' });
  }
  return blocks;
}

function partnershipClauses(data) {
  const fp = data.firstPartyName || 'the First Party';
  const sp = data.secondPartyName || 'the Second Party';
  const fpShare = Math.min(100, Math.max(0, parseFloat(data.firstPartyShare) || 0));
  const spShare = Math.round((100 - fpShare) * 100) / 100;
  const term = data.termYears || 3;
  const notice = data.noticeDays || 60;
  const business = data.businessName ? `under the name and style of "${data.businessName}"` : 'under such name as the Parties may mutually agree';

  const fpDuties = lines(data.firstPartyResponsibilities);
  const spDuties = lines(data.secondPartyResponsibilities);

  return [
    { heading: 'FORMATION AND PURPOSE', blocks: [
      para(`The Parties hereby agree to carry on business in partnership ${business}, with effect from the Effective Date.`),
      para('The business of the partnership shall be:'),
      para(data.businessPurpose || '________________________________________'),
      para('The Parties may extend the business to such other activities as they mutually agree in writing.'),
    ] },
    { heading: 'CONTRIBUTIONS', blocks: [
      para('Each Party shall contribute to the partnership as follows:'),
      bullet(`${fp}: ${data.firstPartyContribution || '________________________'}`),
      bullet(`${sp}: ${data.secondPartyContribution || '________________________'}`),
      para('No Party shall be entitled to interest on its contribution unless the Parties agree otherwise in writing. Any further contribution shall be made only with the written consent of both Parties.'),
    ] },
    { heading: 'SHARING OF PROFITS AND LOSSES', blocks: [
      para('The net profits and losses of the partnership, after meeting all expenses and liabilities, shall be shared between the Parties in the following ratio:'),
      bullet(`${fp}: ${fpShare}%`),
      bullet(`${sp}: ${spShare}%`),
      para('Profits shall be computed and distributed at the close of each financial year, or at such other intervals as the Parties may agree.'),
    ] },
    { heading: 'ROLES AND RESPONSIBILITIES', blocks: [
      bold('The First Party shall:'),
      ...(fpDuties.length ? fpDuties.map(bullet) : [bullet('Manage operations and resources related to ________________________')]),
      bold('The Second Party shall:'),
      ...(spDuties.length ? spDuties.map(bullet) : [bullet('Manage operations and resources related to ________________________')]),
    ] },
    { heading: 'MANAGEMENT AND DECISIONS', blocks: [
      para('Both Parties shall be entitled to take part in the conduct of the business. Decisions in the ordinary course of business may be taken by either Party; decisions on borrowing, capital expenditure, admission of a new partner, or any matter outside the ordinary course of business shall require the written consent of both Parties.'),
    ] },
    { heading: 'BOOKS OF ACCOUNT', blocks: [
      para('Proper books of account shall be maintained at the principal place of business and shall be open to inspection by either Party at all reasonable times. The accounts shall be closed at the end of each financial year and a statement of profit and loss shall be prepared and signed by both Parties.'),
    ] },
    { heading: 'CONFIDENTIALITY', blocks: [
      para('Each Party shall keep confidential all information relating to the business of the partnership and of the other Party, and shall not disclose it to any third party without the prior written consent of the other Party, except as required by law.'),
    ] },
    { heading: 'INTELLECTUAL PROPERTY', blocks: [
      para('Intellectual property owned by a Party before the Effective Date shall remain its property. Intellectual property created for the partnership in the course of its business shall belong to the partnership unless the Parties agree otherwise in writing.'),
    ] },
    { heading: 'TERM AND TERMINATION', blocks: [
      para(`This Agreement shall remain in force for a period of ${term} (${numWord(term)}) year${parseInt(term, 10) !== 1 ? 's' : ''} from the Effective Date and may be renewed by mutual written agreement.`),
      para(`Either Party may terminate this Agreement by giving ${notice} days' written notice to the other Party.`),
      para('On termination, the assets of the partnership shall be applied first to its debts and liabilities, then to repayment of each Party\'s contribution, and any balance shall be shared in the profit-sharing ratio.'),
    ] },
    { heading: 'DISPUTE RESOLUTION', blocks: [
      para('The Parties shall first attempt to resolve any dispute arising out of this Agreement through mutual discussion. A dispute not resolved amicably shall be referred to arbitration by a sole arbitrator mutually appointed by the Parties, in accordance with the Arbitration and Conciliation Act, 1996.'),
      para(`The place of arbitration shall be ${data.arbitrationCity || BLANK}, India, and the award shall be final and binding on the Parties.`),
    ] },
    { heading: 'GOVERNING LAW', blocks: [
      para('This Agreement shall be governed by and construed in accordance with the laws of India, including the Indian Partnership Act, 1932 where applicable.'),
    ] },
    { heading: 'AMENDMENT AND ASSIGNMENT', blocks: [
      para('This Agreement may be amended only in writing signed by both Parties. Neither Party shall assign or transfer its interest in the partnership without the prior written consent of the other Party.'),
    ] },
    { heading: 'ENTIRE AGREEMENT', blocks: [
      para('This Agreement constitutes the entire understanding between the Parties with respect to its subject matter and supersedes all prior discussions and communications.'),
    ] },
  ];
}

function customClauses(data) {
  return (data.clauses || [])
    .filter((c) => (c.heading || '').trim() || (c.body || '').trim())
    .map((c) => ({
      heading: (c.heading || '').trim().toUpperCase(),
      blocks: lines(c.body).map(para),
    }));
}

export function buildAgreement(data) {
  const custom = data.templateKind === 'custom';
  const shown = partiesShown(data);
  const title = (data.title || '').trim() || (custom ? 'Untitled document' : 'Partnership Agreement');
  const namesParty = shown.first || shown.second;
  const where = [data.executionCity, data.executionState].filter(Boolean).join(', ');

  const preamble = [];
  if (namesParty) {
    preamble.push(para(`This ${title} ("Agreement") is made on this ${fmtDatePreamble(data.effectiveDate)} ("Effective Date")${where || !custom ? `, at ${where || BLANK}` : ''}.`));
    preamble.push(bold(shown.first && shown.second ? 'BY AND BETWEEN' : 'BY'));
    preamble.push(...partyParas(data, shown));
  } else if (data.effectiveDate) {
    preamble.push(para(`Date: ${fmtDatePreamble(data.effectiveDate)}${where ? `, ${where}` : ''}`));
  }

  // Numbered only when a clause has a heading, so a custom body can be plain
  // paragraphs.
  let n = 0;
  const clauses = (custom ? customClauses(data) : partnershipClauses(data))
    .map((c) => ({ ...c, heading: c.heading ? `${++n}. ${c.heading}` : '' }));

  const signatories = [];
  if (shown.first) {
    signatories.push({
      party: data.firstPartyName || BLANK,
      name: data.firstPartySignatoryName, designation: data.firstPartySignatoryDesignation,
      date: fmtDate(data.firstPartySignatoryDate || data.effectiveDate),
      signature: data.firstPartySignature, stamp: true,
    });
  }
  if (shown.second) {
    signatories.push({
      party: data.secondPartyName || BLANK,
      name: data.secondPartySignatoryName, designation: data.secondPartySignatoryDesignation,
      date: fmtDate(data.secondPartySignatoryDate || data.effectiveDate),
      signature: data.secondPartySignature, stamp: false,
    });
  }

  const slug = (s) => (s || '').trim().replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');
  const fileName = [slug(title) || 'Document', slug(shown.first && data.firstPartyName), slug(shown.second && data.secondPartyName)]
    .filter(Boolean).join('_') + '.pdf';

  return {
    title: title.toUpperCase(),
    preamble,
    clauses,
    closing: signatories.length
      ? `IN WITNESS WHEREOF, the ${signatories.length > 1 ? 'Parties have' : 'Party has'} executed this ${title} on the date first written above.`
      : '',
    signatories,
    witnesses: shown.witnesses,
    fileName,
  };
}

/** The records-list title for a saved agreement. */
export function agreementRecordTitle(data) {
  const shown = partiesShown(data);
  const names = [shown.first && data.firstPartyName, shown.second && data.secondPartyName].filter(Boolean).join(' & ');
  const title = (data.title || '').trim() || TEMPLATE_KINDS[data.templateKind]?.label || 'Agreement';
  return names ? `${title}: ${names}` : title;
}
