import { describe, it, expect } from 'vitest';
import { esc, safeImageUrl } from './htmlEscape';

// The payloads from FIX_PLAN item 8's verify line: a company name and a logo_url
// that used to execute when InvoiceList assembled its A4 sheet with innerHTML.
describe('esc', () => {
  it('neutralises a script-bearing company name', () => {
    expect(esc('<img src=x onerror=alert(1)>'))
      .toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('closes the attribute-escape route in both quote styles', () => {
    expect(esc('x" onerror="alert(3)')).toBe('x&quot; onerror=&quot;alert(3)');
    expect(esc("x' onerror='alert(3)")).toBe('x&#39; onerror=&#39;alert(3)');
  });

  it('keeps ampersands and apostrophes in real company names legible', () => {
    expect(esc("Smith & Sons' Ltd")).toBe('Smith &amp; Sons&#39; Ltd');
  });

  it('escapes the ampersand first, so entities are not double-built', () => {
    expect(esc('&lt;')).toBe('&amp;lt;');
  });

  it('renders nullish as empty, never as the string null', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc(0)).toBe('0');
  });
});

describe('safeImageUrl', () => {
  it('accepts an https CDN url', () => {
    expect(safeImageUrl('https://cdn.example.com/logo.png'))
      .toBe('https://cdn.example.com/logo.png');
  });

  it('accepts an inline base64 image', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(safeImageUrl(png)).toBe(png);
  });

  it('refuses javascript: however it is cased or padded', () => {
    expect(safeImageUrl('javascript:alert(1)')).toBe('');
    expect(safeImageUrl('  JavaScript:alert(1)')).toBe('');
  });

  it('refuses a non-image data url', () => {
    expect(safeImageUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe('');
  });

  it('refuses plain http, which would be blocked as mixed content anyway', () => {
    expect(safeImageUrl('http://example.com/logo.png')).toBe('');
  });

  it('escapes the quote in an otherwise valid url, so the attribute holds', () => {
    const out = safeImageUrl('https://example.com/a.png?x="onerror="alert(1)');
    expect(out).not.toContain('"');
    expect(out.startsWith('https://example.com/a.png')).toBe(true);
  });

  it('treats empty and nullish as no image', () => {
    expect(safeImageUrl('')).toBe('');
    expect(safeImageUrl(null)).toBe('');
  });
});
