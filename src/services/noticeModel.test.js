import { describe, it, expect } from 'vitest';
import { addDays, buildNotice, initialNotice } from './noticeModel';

const emp = { studentName: 'Ajith', role: 'Digital Marketer', department: "Founder's Office", employee_code: 'EMP-0002' };
const org = { company_name: 'StemGrid', owner_full_name: 'Sai Krishna' };

describe('noticeModel', () => {
  it('adds calendar days across a month end', () => {
    expect(addDays('2026-11-27', 30)).toBe('2026-12-27');
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('starts the last working day at the notice date plus the period', () => {
    const n = initialNotice(emp, org);
    expect(n.lastDay).toBe(addDays(n.noticeDate, 30));
    expect(n.employeeName).toBe('Ajith');
    expect(n.firstPartyName).toBe('StemGrid');
  });

  it('writes the period and last day into the notice, numbered', () => {
    const doc = buildNotice({ ...initialNotice(emp, org), noticeDate: '2026-11-27', noticeDays: '45', lastDay: '2027-01-11' });
    expect(doc.clauses[0].heading).toBe('1. NOTICE');
    expect(doc.clauses[0].blocks[0].text).toContain("45 (forty-five) days' notice");
    expect(doc.signatories).toHaveLength(2);
    expect(doc.fileName).toBe('Notice_Ajith.pdf');
  });

  it('leaves out switched-off terms and keeps sections of the admin\'s own', () => {
    const doc = buildNotice({
      ...initialNotice(emp, org), showProperty: false, showConfidentiality: false,
      clauses: [{ id: 1, heading: 'Non-solicitation', body: 'For one year.' }],
    });
    const headings = doc.clauses.map((c) => c.heading).filter(Boolean);
    expect(headings.some((h) => h.includes('PROPERTY'))).toBe(false);
    expect(headings.some((h) => h.includes('CONFIDENTIALITY'))).toBe(false);
    expect(headings.at(-1)).toMatch(/NON-SOLICITATION$/);
  });

  it('says pay in lieu when the notice is not served', () => {
    const doc = buildNotice({ ...initialNotice(emp, org), noticePay: 'lieu' });
    const period = doc.clauses.find((c) => c.heading.endsWith('NOTICE PERIOD'));
    expect(period.blocks[0].text).toContain('in lieu of notice');
  });
});
