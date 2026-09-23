import { describe, it, expect } from 'vitest';
import { mapHeaders, rowsToLeads } from './leadImport';
import { toDownloadUrl } from '../../api/sheet-import.js';

describe('mapHeaders', () => {
  it('matches common header spellings', () => {
    expect(mapHeaders(['Company Name', 'Contact Person', 'E-mail', 'Mobile No.', 'Lead Status', 'City'])).toEqual({
      'Company Name': 'company_name',
      'Contact Person': 'person_name',
      'E-mail': 'email',
      'Mobile No.': 'phone',
      'Lead Status': 'stage',
      City: null,
    });
  });
});

describe('rowsToLeads', () => {
  it('maps rows, joins first/last name and keeps unknown columns in notes', () => {
    const { leads } = rowsToLeads([
      { 'First Name': 'Asha', 'Last Name': 'Rao', Company: 'Acme', Email: 'a@acme.com', City: 'Chennai', Status: 'Won' },
    ]);
    expect(leads).toEqual([{
      company_name: 'Acme', person_name: 'Asha Rao', email: 'a@acme.com', phone: '',
      notes: 'City: Chennai', stage: 'deal',
    }]);
  });

  it('skips empty rows and duplicates within the sheet and against existing leads', () => {
    const res = rowsToLeads([
      { Name: 'A', Email: 'A@x.com' },
      { Name: 'A again', Email: 'a@x.com' },
      { Name: 'B', Phone: '+91 98765 43210' },
      { Name: '', Email: '' },
      { Name: 'C', Email: 'c@x.com' },
    ], [{ email: 'c@x.com' }]);
    expect(res.leads.map(l => l.person_name)).toEqual(['A', 'B']);
    expect(res.skippedDuplicate).toBe(2);
    expect(res.skippedEmpty).toBe(1);
  });
});

describe('toDownloadUrl', () => {
  it('turns a Google Sheets edit link into an xlsx export keeping the tab', () => {
    expect(toDownloadUrl('https://docs.google.com/spreadsheets/d/abc123/edit#gid=42'))
      .toBe('https://docs.google.com/spreadsheets/d/abc123/export?format=xlsx&gid=42');
  });
  it('forces download on Dropbox and OneDrive share links', () => {
    expect(toDownloadUrl('https://www.dropbox.com/s/x/leads.xlsx?dl=0')).toContain('dl=1');
    expect(toDownloadUrl('https://acme.sharepoint.com/:x:/g/abc')).toContain('download=1');
  });
  it('rejects garbage', () => {
    expect(() => toDownloadUrl('not a url')).toThrow('not a valid URL');
  });
});
