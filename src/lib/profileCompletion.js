// profileCompletion.js — what registration deliberately did not ask for.
//
// The onboarding wizard collects the six answers an organization cannot be
// created without. Everything a document actually needs to look official —
// address, phone, the title under the signature, the logo and the signature
// image — is left to the company profile, where there is a real form with a
// live letterhead preview beside it.
//
// Nothing chases the user for those unless something says they are missing,
// so this is the single definition of "missing" behind the red dot on the
// account chip in the hub and in every module shell. Each entry names the
// section id it lives in inside CompanyProfile, so the dot can jump straight
// to the field rather than dropping the user at the top of a long page.

export const PROFILE_ESSENTIALS = [
  { id: 'company_address', section: 'company', label: 'Registered address', todo: 'Add your registered address' },
  { id: 'company_phone', section: 'contact', label: 'Contact phone', todo: 'Add a contact phone number' },
  { id: 'document_designation', section: 'signatory', label: 'Title on documents', todo: 'Set the title under your signature' },
  { id: 'logo_url', section: 'branding', label: 'Company logo', todo: 'Upload your company logo' },
  { id: 'signature_url', section: 'branding', label: 'Signature', todo: 'Upload your signature' },
];

/** The essentials still blank on an organization, in the order above. */
export function missingProfileEssentials(org) {
  if (!org) return [];
  return PROFILE_ESSENTIALS.filter((f) => !String(org[f.id] ?? '').trim());
}

/**
 * A short sentence for the account menu: what is missing, without making the
 * user open the profile to find out.
 */
export function profileGapSummary(missing) {
  if (!missing.length) return '';
  const names = missing.map((m) => m.label.toLowerCase());
  if (names.length === 1) return `Missing ${names[0]}`;
  if (names.length === 2) return `Missing ${names[0]} and ${names[1]}`;
  return `${names.length} details still missing`;
}
