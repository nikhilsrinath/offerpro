import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import * as XLSX from 'xlsx';
import {
  formatOf, extractDocument, chunkMarkdown, docxToMarkdown, leadSummary, toTable, htmlToMarkdown,
} from './libraryExtract.js';
import { libraryQuery } from './brainRetrieval.js';

const enc = (s) => new TextEncoder().encode(s).buffer;

describe('formatOf', () => {
  it('trusts the extension over an unhelpful MIME type', () => {
    expect(formatOf('deck.pptx', 'application/octet-stream')).toBe('pptx');
    expect(formatOf('Scan.JPG', '')).toBe('image');
    expect(formatOf('notes', 'text/plain')).toBe('text');
    expect(formatOf('archive.zip', 'application/zip')).toBe('unsupported');
  });
});

describe('extractDocument', () => {
  it('reads plain text under a title and source line', async () => {
    const r = await extractDocument({ buffer: enc('Refunds are issued within 14 days.'), fileName: 'refunds.txt', title: 'Refund policy' });
    expect(r.status).toBe('ready');
    expect(r.markdown).toMatch(/^# Refund policy\n\n> Source file: refunds\.txt/);
    expect(r.markdown).toContain('Refunds are issued within 14 days.');
  });

  it('reads a Word document: headings, lists and tables in order', async () => {
    const xml = '<w:document><w:body>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Leave policy</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">Staff get </w:t></w:r><w:r><w:t>24 days.</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Type</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Days</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>Sick</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>12</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:sectPr/></w:body></w:document>';
    expect(docxToMarkdown(xml)).toBe('## Leave policy\n\nStaff get 24 days.\n\n| Type | Days |\n| --- | --- |\n| Sick | 12 |');

    const zip = zipSync({ 'word/document.xml': strToU8(xml) });
    const r = await extractDocument({ buffer: zip.buffer, fileName: 'leave.docx' });
    expect(r.status).toBe('ready');
    expect(r.method).toBe('docx');
  });

  it('reads a deck slide by slide, with speaker notes', async () => {
    const slide = (title, bullet) => strToU8(`<p:sld><a:p><a:r><a:t>${title}</a:t></a:r></a:p><a:p><a:r><a:t>${bullet}</a:t></a:r></a:p></p:sld>`);
    const zip = zipSync({
      'ppt/slides/slide2.xml': slide('Pricing', 'Pro is ₹999 &amp; up'),
      'ppt/slides/slide10.xml': slide('Roadmap', 'Q4 launch'),
      'ppt/slides/slide1.xml': slide('Intro', 'Who we are'),
      'ppt/notesSlides/notesSlide2.xml': strToU8('<p:notes><a:p><a:r><a:t>Mention the discount</a:t></a:r></a:p><a:p><a:r><a:t>2</a:t></a:r></a:p></p:notes>'),
    });
    const r = await extractDocument({ buffer: zip.buffer, fileName: 'sales.pptx' });
    expect(r.pages).toBe(3);
    const md = r.markdown;
    expect(md.indexOf('## Slide 1: Intro')).toBeLessThan(md.indexOf('## Slide 2: Pricing'));
    expect(md.indexOf('## Slide 2: Pricing')).toBeLessThan(md.indexOf('## Slide 10: Roadmap'));
    expect(md).toContain('- Pro is ₹999 & up');
    expect(md).toContain('> Speaker notes: Mention the discount');
  });

  it('reads every sheet of a workbook as a table', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['SKU', 'Price'], ['A-1', 100]]), 'Prices');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Region'], ['South']]), 'Regions');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const r = await extractDocument({ buffer: buf, fileName: 'prices.xlsx' });
    expect(r.markdown).toContain('## Sheet: Prices\n\n| SKU | Price |\n| --- | --- |\n| A-1 | 100 |');
    expect(r.markdown).toContain('## Sheet: Regions');
  });

  it('hands images to the injected reader, and stores them unread without one', async () => {
    const img = new Uint8Array([137, 80, 78, 71]).buffer;
    const unread = await extractDocument({ buffer: img, fileName: 'whiteboard.png', mimeType: 'image/png' });
    expect(unread.status).toBe('unsupported');

    let seen = null;
    const read = await extractDocument(
      { buffer: img, fileName: 'whiteboard.png', mimeType: 'image/png' },
      { ocr: async (_b, mime) => { seen = mime; return '## Board\n\nShip v2 on Friday'; } },
    );
    expect(seen).toBe('image/png');
    expect(read.method).toBe('ai_vision');
    expect(read.markdown).toContain('Ship v2 on Friday');
  });

  it('marks a file it cannot parse as stored-only rather than failing', async () => {
    const r = await extractDocument({ buffer: enc('PK'), fileName: 'backup.zip' });
    expect(r.status).toBe('unsupported');
    expect(r.error).toMatch(/stored but cannot be read/);
  });

  it('reports a corrupt Office file as failed, with the reason', async () => {
    const r = await extractDocument({ buffer: enc('not a zip'), fileName: 'broken.docx' });
    expect(r.status).toBe('failed');
    expect(r.error).toBeTruthy();
  });
});

describe('chunkMarkdown', () => {
  it('starts a passage at every section heading and carries it as provenance', () => {
    const md = '# Title\n\n> Source file: x.pdf\n\n## Page 1\n\nAlpha.\n\n## Page 2\n\nBeta.\n\nGamma.';
    expect(chunkMarkdown(md)).toEqual([
      { seq: 0, heading: 'Page 1', content: 'Alpha.' },
      { seq: 1, heading: 'Page 2', content: 'Beta.\n\nGamma.' },
    ]);
  });

  it('keeps passages near the target and never loses text', () => {
    const paras = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ` + 'x'.repeat(200));
    const chunks = chunkMarkdown(paras.join('\n\n'), { target: 1000, max: 1500 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(1500);
    const joined = chunks.map((c) => c.content).join('\n\n');
    for (const p of paras) expect(joined).toContain(p);
  });

  it('splits one oversized paragraph instead of emitting a giant passage', () => {
    const chunks = chunkMarkdown('y'.repeat(5000), { target: 1000, max: 2000 });
    expect(chunks.map((c) => c.content.length)).toEqual([2000, 2000, 1000]);
  });
});

describe('helpers', () => {
  it('escapes pipes in table cells', () => {
    expect(toTable([['a|b'], ['c']])).toBe('| a\\|b |\n| --- |\n| c |');
  });

  it('drops scripts and keeps headings when reading HTML', () => {
    const md = htmlToMarkdown('<head><title>x</title></head><script>evil()</script><h2>Terms</h2><p>Net 30.</p>');
    expect(md).toBe('## Terms\n\nNet 30.');
  });

  it('summarises from prose, not from headings or tables', () => {
    expect(leadSummary('# T\n\n> Source file: a\n\n## Page 1\n\n| a |\n\nThe actual lead.')).toBe('The actual lead.');
  });
});

describe('libraryQuery', () => {
  it('builds a prefix OR query that tolerates plurals and operator characters', () => {
    expect(libraryQuery('What do our policies say about refunds & returns?'))
      .toBe('polici:* | say:* | refun:* | retur:*');
    expect(libraryQuery('the a of')).toBe('');
  });
});
