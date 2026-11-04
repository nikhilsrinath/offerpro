import { describe, it, expect } from 'vitest';
import {
  domainOf, domainForRecord, normalizeOrganization, normalizeCandidate, normalizePersonPreview, normalizePerson,
  growthText, isHiringFast, blanksToFill, makeCountryCode, sizeText,
} from './apollo.js';

/*
 * Apollo.io, the pure half: which domain a record belongs to, what Apollo's
 * answers are cut down to, and which blank fields a lookup may fill.
 */

describe('domainOf', () => {
  it('reads a domain from websites, URLs and emails', () => {
    expect(domainOf('https://www.Acme.in/about?x=1')).toBe('acme.in');
    expect(domainOf('acme.co.in')).toBe('acme.co.in');
    expect(domainOf('ravi@Acme.in')).toBe('acme.in');
    expect(domainOf('http://shop.acme.com:8080/')).toBe('shop.acme.com');
    expect(domainOf('www2.acme.com')).toBe('acme.com');
  });

  it('refuses personal mail and things that are not domains', () => {
    expect(domainOf('ravi@gmail.com')).toBeNull();
    expect(domainOf('rediffmail.com')).toBeNull();
    expect(domainOf('Acme Pvt Ltd')).toBeNull();
    expect(domainOf('localhost')).toBeNull();
    expect(domainOf('')).toBeNull();
    expect(domainOf(null)).toBeNull();
  });

  it('takes the first usable domain on a record', () => {
    expect(domainForRecord({ website: '', clientEmail: 'a@gmail.com', contacts: [{ email: 'b@kite.io' }] })).toBe('kite.io');
    expect(domainForRecord({ website: 'kite.io', clientEmail: 'a@other.com' })).toBe('kite.io');
    expect(domainForRecord({ email: 'a@yahoo.co.in' })).toBeNull();
  });
});

const ORG = {
  id: '5e66b6381e05b4008c8331b8', name: 'Kite Labs', website_url: 'http://www.kitelabs.in', primary_domain: 'kitelabs.in',
  linkedin_url: 'http://www.linkedin.com/company/kite-labs', logo_url: 'https://zenprospect.example/logo.png',
  industry: 'information technology & services', keywords: ['saas', 'erp', '  ', 'india'],
  estimated_num_employees: 140, organization_headcount_six_month_growth: 0.1834, organization_headcount_twelve_month_growth: null,
  annual_revenue: 12000000, annual_revenue_printed: '12M', founded_year: 2016, primary_phone: { number: '+91 80 4000 0000' },
  raw_address: 'Indiranagar, Bengaluru, Karnataka, India', city: 'Bengaluru', state: 'Karnataka', country: 'India',
  short_description: 'Kite Labs builds   software.', departmental_head_count: { engineering: 60 },
};

describe('normalizeOrganization', () => {
  it('keeps what Opstead uses, in its own names', () => {
    const p = normalizeOrganization(ORG, { now: new Date('2026-11-02T10:00:00Z') });
    expect(p).toMatchObject({
      source: 'apollo', fetched_at: '2026-11-02T10:00:00.000Z', apollo_id: ORG.id, name: 'Kite Labs', domain: 'kitelabs.in',
      website: 'http://www.kitelabs.in/', linkedin_url: 'http://www.linkedin.com/company/kite-labs',
      industry: 'Information Technology & Services', keywords: ['saas', 'erp', 'india'], employees: 140,
      growth_6m: 0.1834, growth_12m: null, annual_revenue: 12000000, founded_year: 2016, phone: '+91 80 4000 0000',
      city: 'Bengaluru', state: 'Karnataka', country: 'India', description: 'Kite Labs builds software.',
    });
    expect(p).not.toHaveProperty('departmental_head_count');
  });

  it('is null for nothing, and drops links that are not http(s)', () => {
    expect(normalizeOrganization(null)).toBeNull();
    const p = normalizeOrganization({ name: 'X', linkedin_url: 'javascript:alert(1)', primary_domain: 'x.io' });
    expect(p.linkedin_url).toBeNull();
    expect(p.website).toBe('https://x.io');
  });

  it('cuts long text', () => {
    const p = normalizeOrganization({ name: 'X', short_description: 'a'.repeat(2000) });
    expect(p.description.length).toBe(600);
  });
});

describe('people and candidates', () => {
  it('shows the free search as Apollo gives it, without contact details', () => {
    expect(normalizePersonPreview({ id: 'p1abcdef', first_name: 'Asha', last_name_obfuscated: 'Ra***n', title: 'CTO', has_email: true }))
      .toEqual({ id: 'p1abcdef', name: 'Asha Ra***n', title: 'CTO', has_email: true });
    expect(normalizePersonPreview({ first_name: 'No id' })).toBeNull();
  });

  it('offers only a verified work email', () => {
    expect(normalizePerson({ id: 'p1abcdef', name: 'Asha Raman', title: 'CTO', email: 'asha@kitelabs.in', email_status: 'verified', linkedin_url: 'linkedin.com/in/asha' }))
      .toMatchObject({ name: 'Asha Raman', email: 'asha@kitelabs.in', linkedin_url: 'https://linkedin.com/in/asha' });
    expect(normalizePerson({ id: 'x1abcdef', first_name: 'B', last_name: 'C', email: 'b@k.in', email_status: 'guessed' }).email).toBeNull();
    expect(normalizePerson({ id: 'x1abcdef', name: 'B', email: 'email_not_unlocked@domain.com' }).email).toBeNull();
  });

  it('keeps candidates that have a domain', () => {
    expect(normalizeCandidate({ id: 'o1', name: 'Kite', primary_domain: 'kite.io', city: 'Pune', country: 'India' }))
      .toMatchObject({ name: 'Kite', domain: 'kite.io', place: 'Pune, India' });
  });
});

describe('showing it', () => {
  it('writes growth and size for people', () => {
    expect(growthText(0.1834)).toBe('+18%');
    expect(growthText(-0.04)).toBe('−4%');
    expect(growthText(0)).toBe('0%');
    expect(growthText(null)).toBeNull();
    expect(sizeText(1250)).toBe('1,250 people');
    expect(sizeText(null)).toBeNull();
  });

  it('calls 10%+ six-month headcount growth fast hiring, not for a tiny team', () => {
    expect(isHiringFast({ growth_6m: 0.1, employees: 40 })).toBe(true);
    expect(isHiringFast({ growth_6m: 0.09, employees: 40 })).toBe(false);
    expect(isHiringFast({ growth_6m: 0.5, employees: 3 })).toBe(false);
    expect(isHiringFast({ growth_6m: null })).toBe(false);
    expect(isHiringFast(null)).toBe(false);
  });
});

describe('blanksToFill', () => {
  const cc = makeCountryCode([['IN', 'India'], ['US', 'United States of America']]);
  const p = normalizeOrganization(ORG);

  it('fills only empty fields of a client', () => {
    expect(blanksToFill({ clientName: 'Kite', industry: 'Software', website: '' }, p, 'client', { countryCode: cc })).toEqual({
      website: 'http://www.kitelabs.in', clientAddress: ORG.raw_address, country_code: 'IN', buyerState: 'Karnataka',
    });
  });

  it('leaves a GST state alone outside India', () => {
    const us = { ...p, country: 'United States', state: 'California' };
    const out = blanksToFill({ clientName: 'K' }, us, 'client', { countryCode: cc });
    expect(out.country_code).toBe('US');
    expect(out).not.toHaveProperty('buyerState');
  });

  it('fills a vendor in vendor names', () => {
    expect(blanksToFill({ company_name: 'Kite', address: 'Typed' }, p, 'vendor', { countryCode: cc }))
      .toEqual({ website: 'http://www.kitelabs.in', state: 'Karnataka' });
  });

  it('does nothing without a profile', () => {
    expect(blanksToFill({}, null)).toEqual({});
  });
});
