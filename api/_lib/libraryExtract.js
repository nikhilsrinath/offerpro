/**
 * Document library · reading what a file says.
 *
 * Turns an uploaded file into one Markdown document, then cuts that Markdown
 * into passages for retrieval. Nothing here touches the database or the
 * network except `ocr`, which the caller injects — so every format path is a
 * pure function of the bytes, and testable as one.
 *
 * ─── Why Markdown ──────────────────────────────────────────────────────────
 * It is the one representation every format degrades into without losing what
 * the AI needs: headings survive as `##`, a spreadsheet as a table, a deck as a
 * section per slide. And every section heading is provenance — "Page 4",
 * "Slide 7", "Sheet: Q3" — so a passage retrieved months later still says
 * where in the file it came from.
 *
 * ─── Deterministic first ───────────────────────────────────────────────────
 * Text, PDFs with a text layer, Office files and spreadsheets are read by
 * parsing, which is exact and free. Only what has no text to parse — a photo,
 * a scan — goes to the model, and the result says which path was taken, so a
 * reader knows whether they are looking at the file's own words or a
 * transcription of them.
 */
import { unzipSync, strFromU8 } from 'fflate';

export const MAX_MARKDOWN_CHARS = 400_000;   // ~100 dense pages; the rest is noted, not silently lost
const SHEET_ROW_LIMIT = 400;

/* ── format detection ─────────────────────────────────────────────────────── */

const EXT_FORMAT = {
  pdf: 'pdf',
  docx: 'docx', docm: 'docx', dotx: 'docx',
  pptx: 'pptx', pptm: 'pptx', potx: 'pptx',
  xlsx: 'sheet', xlsm: 'sheet', xls: 'sheet', ods: 'sheet', csv: 'sheet', tsv: 'sheet',
  odt: 'odf', odp: 'odf',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', heic: 'image', heif: 'image',
  html: 'html', htm: 'html',
  rtf: 'rtf',
  md: 'markdown', markdown: 'markdown',
  txt: 'text', log: 'text', json: 'text', xml: 'text', yaml: 'text', yml: 'text', ini: 'text',
  js: 'code', jsx: 'code', ts: 'code', tsx: 'code', py: 'code', java: 'code', go: 'code', rb: 'code',
  php: 'code', cs: 'code', c: 'code', h: 'code', cpp: 'code', sql: 'code', sh: 'code', css: 'code',
};

export function extOf(fileName) {
  const m = String(fileName || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return m ? m[1] : '';
}

/** Which reader a file needs. Extension first — browsers report office MIME types unreliably. */
export function formatOf(fileName, mimeType = '') {
  const byExt = EXT_FORMAT[extOf(fileName)];
  if (byExt) return byExt;
  const mt = String(mimeType).toLowerCase();
  if (mt === 'application/pdf') return 'pdf';
  if (mt.startsWith('image/')) return 'image';
  if (mt === 'text/html') return 'html';
  if (mt === 'text/markdown') return 'markdown';
  if (mt.startsWith('text/') || mt === 'application/json') return 'text';
  return 'unsupported';
}

/* ── small helpers ────────────────────────────────────────────────────────── */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeXml(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** Collapses the whitespace PDF and XML text arrive with, keeping paragraph breaks. */
export function tidy(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cell(v) {
  return String(v ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
}

/** Rows (first row = header) to a Markdown table. */
export function toTable(rows) {
  const clean = rows.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (!clean.length) return '';
  const width = Math.max(...clean.map((r) => r.length));
  const pad = (r) => Array.from({ length: width }, (_, i) => cell(r[i]));
  const [head, ...body] = clean;
  return [
    `| ${pad(head).join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...body.map((r) => `| ${pad(r).join(' | ')} |`),
  ].join('\n');
}

function textOf(buffer) {
  return new TextDecoder('utf-8', { fatal: false }).decode(buffer).replace(/^\uFEFF/, '');
}

/* ── the readers ──────────────────────────────────────────────────────────── */

async function readPdf(buffer) {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text]).map(tidy);
  const chars = pages.reduce((a, p) => a + p.length, 0);
  // A text layer this thin is a scan with, at most, a stray header on it.
  const scanned = chars < Math.max(40, 25 * totalPages);
  const md = pages
    .map((p, i) => (p ? `## Page ${i + 1}\n\n${p}` : ''))
    .filter(Boolean).join('\n\n');
  return { md, pages: totalPages, scanned };
}

/** word/document.xml → Markdown: headings, paragraphs, lists and tables, in order. */
export function docxToMarkdown(xml) {
  const out = [];
  const para = (p) => {
    const style = (p.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
    const text = decodeXml((p.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>/g) || [])
      .map((t) => (t === '<w:tab/>' ? '\t' : t === '<w:br/>' ? '\n' : t.replace(/<[^>]+>/g, '')))
      .join('')).trim();
    if (!text) return '';
    const h = style.match(/^(?:Heading|heading)(\d)$/) || (style === 'Title' ? [null, '1'] : null);
    if (h) return `${'#'.repeat(Math.min(Number(h[1]) + 1, 6))} ${text}`;
    if (/<w:numPr>/.test(p) || /List/i.test(style)) return `- ${text}`;
    return text;
  };
  const body = xml.replace(/^[\s\S]*?<w:body>/, '').replace(/<w:sectPr[\s\S]*$/, '');
  // Tables first, as whole units, so their paragraphs are not read twice.
  const parts = body.split(/(<w:tbl>[\s\S]*?<\/w:tbl>)/);
  for (const part of parts) {
    if (part.startsWith('<w:tbl>')) {
      const rows = (part.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []).map((tr) =>
        (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map((tc) =>
          (tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(para).filter(Boolean).join(' ')));
      const table = toTable(rows);
      if (table) out.push(table);
    } else {
      for (const p of part.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []) {
        const line = para(p);
        if (line) out.push(line);
      }
    }
  }
  return out.join('\n\n');
}

function readDocx(buffer) {
  const zip = unzipSync(new Uint8Array(buffer), { filter: (f) => f.name === 'word/document.xml' });
  const xml = zip['word/document.xml'];
  if (!xml) throw new Error('Not a Word document (word/document.xml missing)');
  return { md: tidyMarkdown(docxToMarkdown(strFromU8(xml))) };
}

function slideText(xml) {
  return (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) || [])
    .map((p) => decodeXml((p.match(/<a:t>[^<]*<\/a:t>/g) || []).map((t) => t.slice(5, -6)).join('')).trim())
    .filter(Boolean);
}

function readPptx(buffer) {
  const zip = unzipSync(new Uint8Array(buffer), {
    filter: (f) => /^ppt\/(slides|notesSlides)\/(slide|notesSlide)\d+\.xml$/.test(f.name),
  });
  const num = (n) => Number(n.match(/(\d+)\.xml$/)[1]);
  const slides = Object.keys(zip).filter((n) => n.startsWith('ppt/slides/')).sort((a, b) => num(a) - num(b));
  const sections = slides.map((name) => {
    const n = num(name);
    const lines = slideText(strFromU8(zip[name]));
    const notesXml = zip[`ppt/notesSlides/notesSlide${n}.xml`];
    // Notes carry the slide number as a field; drop the lone digit it leaves.
    const notes = notesXml ? slideText(strFromU8(notesXml)).filter((l) => !/^\d+$/.test(l)) : [];
    const [title, ...rest] = lines;
    let s = `## Slide ${n}${title ? `: ${title}` : ''}`;
    if (rest.length) s += `\n\n${rest.map((l) => `- ${l}`).join('\n')}`;
    if (notes.length) s += `\n\n> Speaker notes: ${notes.join(' ')}`;
    return s;
  });
  return { md: sections.join('\n\n'), pages: slides.length };
}

async function readSheet(buffer, ext) {
  const XLSX = (await import('xlsx')).default ?? (await import('xlsx'));
  const wb = ext === 'csv' || ext === 'tsv'
    ? XLSX.read(textOf(buffer), { type: 'string', FS: ext === 'tsv' ? '\t' : undefined })
    : XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const sections = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    const kept = rows.slice(0, SHEET_ROW_LIMIT + 1);
    const table = toTable(kept);
    if (!table) continue;
    const more = rows.length > kept.length
      ? `\n\n_${rows.length - kept.length} further row(s) not included; the sheet has ${rows.length - 1} data rows._`
      : '';
    sections.push(`## Sheet: ${name}\n\n${table}${more}`);
  }
  return { md: sections.join('\n\n'), pages: wb.SheetNames.length };
}

function readOdf(buffer) {
  const zip = unzipSync(new Uint8Array(buffer), { filter: (f) => f.name === 'content.xml' });
  const xml = zip['content.xml'];
  if (!xml) throw new Error('Not an OpenDocument file (content.xml missing)');
  const lines = (strFromU8(xml).match(/<text:(h|p)[^>]*>[\s\S]*?<\/text:\1>/g) || []).map((el) => {
    const t = decodeXml(el.replace(/<text:tab\/>/g, '\t').replace(/<[^>]+>/g, '')).trim();
    if (!t) return '';
    return el.startsWith('<text:h') ? `## ${t}` : t;
  }).filter(Boolean);
  return { md: lines.join('\n\n') };
}

export function htmlToMarkdown(html) {
  return tidy(decodeXml(String(html)
    .replace(/<(script|style|noscript|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n\n${'#'.repeat(Number(n))} ${t.replace(/<[^>]+>/g, '')}\n\n`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '')));
}

export function rtfToText(rtf) {
  return tidy(String(rtf)
    .replace(/\\par[d]?/g, '\n')
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, ''));
}

function tidyMarkdown(md) {
  return String(md || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ── the entry point ──────────────────────────────────────────────────────── */

/**
 * Reads a file into Markdown.
 *
 * `ocr(bytes, mimeType, hint)` is injected by the caller and returns Markdown;
 * it is only invoked for images and PDFs with no text layer. When it is absent
 * those files come back `unsupported` rather than failing — the file is still
 * stored, it just cannot be read.
 *
 * Returns { status, method, markdown, pages, error }. `status` is `ready`,
 * `partial` (read, but truncated), `unsupported`, or `failed`.
 */
export async function extractDocument({ buffer, fileName, mimeType, title }, { ocr } = {}) {
  const format = formatOf(fileName, mimeType);
  const ext = extOf(fileName);
  let body = '';
  let pages = null;
  let method = format;

  try {
    switch (format) {
      case 'pdf': {
        const r = await readPdf(buffer);
        pages = r.pages;
        if (r.scanned) {
          if (!ocr) return result('unsupported', 'pdf', '', pages, 'This PDF has no text layer (a scan) and AI reading is unavailable.');
          body = await ocr(buffer, 'application/pdf', 'a scanned PDF document; keep one "## Page N" heading per page');
          method = 'ai_ocr';
        } else {
          body = r.md;
          method = 'pdf_text';
        }
        break;
      }
      case 'docx':     ({ md: body } = readDocx(buffer)); break;
      case 'pptx':     ({ md: body, pages } = readPptx(buffer)); break;
      case 'sheet':    ({ md: body, pages } = await readSheet(buffer, ext)); break;
      case 'odf':      ({ md: body } = readOdf(buffer)); break;
      case 'html':     body = htmlToMarkdown(textOf(buffer)); break;
      case 'rtf':      body = rtfToText(textOf(buffer)); break;
      case 'markdown': body = tidyMarkdown(textOf(buffer)); break;
      case 'text':     body = tidy(textOf(buffer)); break;
      case 'code':     body = '```' + ext + '\n' + textOf(buffer).trimEnd() + '\n```'; break;
      case 'image': {
        if (!ocr) return result('unsupported', 'image', '', null, 'AI reading is unavailable, so the image was stored without its content.');
        body = await ocr(buffer, normaliseImageMime(mimeType, ext),
          'an image; transcribe any text, then describe what it shows (charts: the values; diagrams: the structure)');
        method = 'ai_vision';
        break;
      }
      default:
        return result('unsupported', null, '', null,
          `.${ext || 'unknown'} files are stored but cannot be read. Save it as PDF, DOCX, PPTX, XLSX or text to make it searchable.`);
    }
  } catch (err) {
    return result('failed', method, '', pages, err?.message || String(err));
  }

  body = tidyMarkdown(body);
  if (!body) {
    return result('failed', method, '', pages, 'No readable text was found in this file.');
  }

  let status = 'ready';
  let error = null;
  if (body.length > MAX_MARKDOWN_CHARS) {
    body = body.slice(0, MAX_MARKDOWN_CHARS).replace(/\n[^\n]*$/, '') +
      `\n\n_Extraction stopped at ${MAX_MARKDOWN_CHARS.toLocaleString('en')} characters; the rest of the file is not searchable._`;
    status = 'partial';
    error = 'The file is longer than the reading limit; only the first part is searchable.';
  }

  const header = `# ${title || fileName}\n\n` +
    `> Source file: ${fileName}` +
    (pages ? ` · ${pages} ${format === 'pptx' ? 'slide' : format === 'sheet' ? 'sheet' : 'page'}(s)` : '') +
    ` · read by ${METHOD_LABEL[method] || method}`;
  return result(status, method, `${header}\n\n${body}\n`, pages, error);
}

export const METHOD_LABEL = {
  pdf_text: 'the PDF text layer', ai_ocr: 'AI transcription of a scan', ai_vision: 'AI image reading',
  docx: 'Word parsing', pptx: 'slide parsing', sheet: 'spreadsheet parsing', odf: 'OpenDocument parsing',
  html: 'HTML parsing', rtf: 'RTF parsing', markdown: 'Markdown', text: 'plain text', code: 'plain text',
};

function result(status, method, markdown, pages, error) {
  return { status, method, markdown, pages: pages ?? null, error: error || null };
}

function normaliseImageMime(mimeType, ext) {
  if (mimeType?.startsWith('image/')) return mimeType;
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif' }[ext] || 'image/png';
}

/* ── passages ─────────────────────────────────────────────────────────────── */

/**
 * Cuts the Markdown into passages of about `target` characters.
 *
 * Boundaries are paragraphs, never mid-sentence, and a `##` heading always
 * starts a new passage — so a passage never straddles two pages or two slides,
 * and its `heading` is exactly where in the file it came from. A paragraph
 * longer than the limit on its own (a big table, a wall of text) is split on
 * lines, then hard-split as a last resort.
 */
export function chunkMarkdown(markdown, { target = 1400, max = 2200 } = {}) {
  const chunks = [];
  let heading = null;
  let buf = [];
  let size = 0;

  const flush = () => {
    const content = buf.join('\n\n').trim();
    if (content) chunks.push({ seq: chunks.length, heading, content });
    buf = [];
    size = 0;
  };

  const pieces = (para) => {
    if (para.length <= max) return [para];
    const out = [];
    let cur = '';
    for (const line of para.split('\n')) {
      if (line.length > max) {
        if (cur) { out.push(cur); cur = ''; }
        for (let i = 0; i < line.length; i += max) out.push(line.slice(i, i + max));
      } else if (cur.length + line.length + 1 > max) {
        out.push(cur);
        cur = line;
      } else {
        cur = cur ? `${cur}\n${line}` : line;
      }
    }
    if (cur) out.push(cur);
    return out;
  };

  for (const para of String(markdown || '').split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    // The document title and source line are metadata, carried on the row.
    if (/^# /.test(p) || /^> Source file:/.test(p)) continue;
    const h = p.match(/^#{2,6} (.+)$/);
    if (h && !p.includes('\n')) {
      flush();
      heading = h[1].trim().slice(0, 200);
      continue;
    }
    for (const piece of pieces(p)) {
      if (size && size + piece.length > target) flush();
      buf.push(piece);
      size += piece.length + 2;
    }
  }
  flush();
  return chunks;
}

/** A short lead for the brain node and the list: the first real prose, not headings or tables. */
export function leadSummary(markdown, max = 400) {
  const paras = String(markdown || '').split(/\n{2,}/).map((p) => p.trim())
    .filter((p) => p && !/^(#|>|\||```|_Extraction)/.test(p));
  const text = paras.join(' ').replace(/\s+/g, ' ').replace(/^- /, '').trim();
  if (text.length <= max) return text || null;
  return text.slice(0, max).replace(/\s+\S*$/, '') + '…';
}
