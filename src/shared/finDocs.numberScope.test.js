import { describe, it, expect } from 'vitest';
import { findNumberClash, numberProjectFromPicker } from './finDocs.js';

// 0108: an invoice number is unique within its project, not across the company.
const AMOLDO = 'p-amoldo';
const REDANT = 'p-redant';
const docs = [
  { id: 'a1', doc_number: 'INV - 26-27/001', number_project_id: AMOLDO },
  { id: 'g1', doc_number: 'INV-005' },
];

describe('findNumberClash', () => {
  it('lets another project use the same number', () => {
    expect(findNumberClash(docs, 'INV - 26-27/001', REDANT)).toBeNull();
  });

  it('refuses it in the same project, ignoring spaces and case', () => {
    expect(findNumberClash(docs, 'inv-26-27/001', AMOLDO)?.id).toBe('a1');
  });

  it('treats no project as a scope of its own', () => {
    expect(findNumberClash(docs, 'INV-005', null)?.id).toBe('g1');
    expect(findNumberClash(docs, 'INV-005', AMOLDO)).toBeNull();
    expect(findNumberClash(docs, 'INV - 26-27/001', null)).toBeNull();
  });

  it('skips the invoice being edited, and a blank number', () => {
    expect(findNumberClash(docs, 'INV - 26-27/001', AMOLDO, 'a1')).toBeNull();
    expect(findNumberClash(docs, '  ', AMOLDO)).toBeNull();
  });
});

describe('numberProjectFromPicker', () => {
  it('is the one project picked', () => {
    expect(numberProjectFromPicker({ mode: 'single', rows: [{ project_id: AMOLDO }] })).toBe(AMOLDO);
  });

  it('is none for no project or a split over several', () => {
    expect(numberProjectFromPicker({ mode: 'single', rows: [{ project_id: '' }] })).toBeNull();
    expect(numberProjectFromPicker({ mode: 'split', rows: [{ project_id: AMOLDO }, { project_id: REDANT }] })).toBeNull();
    expect(numberProjectFromPicker(null)).toBeNull();
  });
});
