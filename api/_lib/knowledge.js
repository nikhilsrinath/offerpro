import { supabaseAdmin } from './supabaseAdmin.js';
import { queryTerms } from './brainRetrieval.js';
import { formatDate } from '../../src/shared/dates.js';
import { readability, libraryDocHref } from '../../src/shared/libraryReadability.js';

/**
 * Internal Knowledge: answering from the company's own documents.
 *
 * Not a second retrieval system. The Document Library (0063/0069) already
 * reads every upload into Markdown and cuts it into passages
 * (library_chunks), each with the heading it sits under ("Page 4",
 * "Slide 7", a section title) and a full-text index, ranked by the
 * library_search() function. This file puts that pipeline behind three
 * read-only agent tools (agent/tools/knowledge.js) and adds what an agent
 * answering from documents needs on top of it: a budget, a relevance floor,
 * an honest account of which documents could not be read, hints about
 * possible versions of one document, and a check of quotations against the
 * text the model was actually shown.
 *
 * ─── Who sees what ─────────────────────────────────────────────────────────
 * Every row the model is given is read through the caller's OWN client
 * (ctx.db carries their token), filtered by the session's org on top, so RLS
 * and the role matrix (`library_documents: view`) decide. The one exception
 * is ranking: library_search() is granted to the service role alone (0063),
 * so it is called with the service role, for the SESSION's org (ctx.orgId,
 * never a value from the request or the model), and only its chunk ids and
 * ranks are used. The text behind those ids is then re-read through the
 * caller's client, and anything RLS does not return is dropped. A storage
 * path or a URL is never read here: the file in the bucket is not touched,
 * only the text the library extracted from it.
 *
 * Read-only: nothing here writes.
 */

export const AGENT_ID = 'internal_knowledge';

export const CATALOGUE_CAP = 1000;
/** One passage, as the model sees it. A library chunk is ~1,400–2,200 characters. */
export const PASSAGE_CHARS = 2200;
/** All passages from one search, in characters (~4k tokens). */
export const SEARCH_BUDGET = 16000;
/** One read_document call, in characters (~6k tokens). */
export const READ_BUDGET = 24000;
export const MAX_PASSAGES = 10;
const RANK_POOL = 40;
const TIMEOUT_MS = 8000;

export const REGISTERS = {
  general: 'General Documents',
  opa: 'Organisational Process Assets',
  lessons: 'Lessons Learned Register',
};
/** Where the document opens in the app (the library's viewer, by id). */
export const docHref = libraryDocHref;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A failure the tools report in words instead of throwing. */
export class KnowledgeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function withTimeout(p, ms = TIMEOUT_MS) {
  let timer;
  const late = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new KnowledgeError('timeout', 'The document library took too long to answer.')), ms);
  });
  return Promise.race([Promise.resolve(p), late]).finally(() => clearTimeout(timer));
}

const day = (ts, tz) => {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  try { return d.toLocaleDateString('en-CA', { timeZone: tz || 'UTC' }); } catch { return d.toISOString().slice(0, 10); }
};
const dateText = (ts, tz) => { const d = day(ts, tz); return d ? formatDate(d) : null; };

/* ── what can be read ─────────────────────────────────────────────────────── */

export { readability };

/** The document, as a tool hands it to the model. */
export function docCard(d, tz) {
  const r = readability(d);
  return {
    title: d.title,
    file: d.file_name,
    register: REGISTERS[d.collection] || REGISTERS.general,
    category: d.category || null,
    ...(d.tags?.length ? { tags: d.tags.join(', ') } : {}),
    ...(d.description ? { description: String(d.description).slice(0, 300) } : {}),
    pages: d.page_count ?? null,
    passages: Number(d.chunk_count) || 0,
    readable: r.readable,
    ...(r.note ? { status_note: r.note } : {}),
    uploaded: dateText(d.created_at, tz),
    details_changed: dateText(d.updated_at, tz),
    document_id: d.id,
  };
}

/* ── the catalogue ────────────────────────────────────────────────────────── */

const DOC_COLS = 'id, title, file_name, description, category, tags, mime_type, extraction_status, page_count, chunk_count, created_at, updated_at, extracted_at';

/**
 * Every document the caller may see in this org, newest change first,
 * without content. Read once per request (ctx.cache).
 */
export function catalogue(ctx) {
  const key = `knowledge:catalogue:${ctx.orgId}`;
  if (ctx.cache?.has(key)) return ctx.cache.get(key);
  const p = (async () => {
    const run = (cols) => withTimeout(ctx.db.from('library_documents')
      .select(cols, { count: 'exact' })
      .eq('org_id', ctx.orgId)
      .order('updated_at', { ascending: false })
      .limit(CATALOGUE_CAP));
    let res = await run(`${DOC_COLS}, collection`);
    // Before 0069 there is no register column: every document is General.
    if (res.error && /collection/.test(res.error.message || '')) res = await run(DOC_COLS);
    if (res.error) throw new KnowledgeError('failed', 'The document library could not be read just now.');
    const docs = (res.data || []).map((d) => ({ ...d, collection: d.collection || 'general' }));
    const total = Number.isFinite(res.count) ? res.count : docs.length;
    return { docs, total, capped: total > docs.length, byId: new Map(docs.map((d) => [d.id, d])) };
  })();
  ctx.cache?.set(key, p);
  p.catch(() => ctx.cache?.delete(key));
  return p;
}

export function libraryCounts(cat) {
  let readable = 0;
  const notReadable = {};
  for (const d of cat.docs) {
    const r = readability(d);
    if (r.readable) readable += 1;
    else notReadable[r.state] = (notReadable[r.state] || 0) + 1;
  }
  return {
    documents_you_can_see: cat.total,
    readable,
    not_readable: notReadable,
    ...(cat.capped ? { note: `Only the ${cat.docs.length} most recently changed documents were checked.` } : {}),
  };
}

/* ── finding a document by what the user called it ──────────────────────── */

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\.[a-z0-9]{1,6}$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * One document from a title, a file name, part of either, or its id.
 *
 * Returns { status: 'one', doc } | { status: 'many', candidates } |
 * { status: 'none' }. An id is looked up through the caller's own client and
 * this org, so another org's id, or one this role may not see, is simply not
 * found: indistinguishable from an id that never existed, which is the point.
 * A storage path or a URL is matched as text against titles and file names
 * only; it is never fetched.
 */
export async function findDocument(ctx, ref) {
  const said = String(ref || '').trim().slice(0, 300);
  if (!said) return { status: 'none' };
  const cat = await catalogue(ctx);
  if (UUID.test(said)) {
    const known = cat.byId.get(said);
    if (known) return { status: 'one', doc: known };
    if (!cat.capped) return { status: 'none' };
    const { data } = await withTimeout(ctx.db.from('library_documents').select(`${DOC_COLS}, collection`)
      .eq('org_id', ctx.orgId).eq('id', said).maybeSingle());
    return data ? { status: 'one', doc: { ...data, collection: data.collection || 'general' } } : { status: 'none' };
  }
  // The last part of a path or URL is all that could name a document.
  const want = norm(said.includes('/') ? said.split(/[/?#]/).filter(Boolean).pop() : said);
  if (!want) return { status: 'none' };
  const exact = cat.docs.filter((d) => norm(d.title) === want || norm(d.file_name) === want);
  if (exact.length === 1) return { status: 'one', doc: exact[0] };
  const words = want.split(' ').filter((w) => w.length > 1);
  const pool = exact.length ? exact : cat.docs.filter((d) => {
    const hay = `${norm(d.title)} ${norm(d.file_name)}`;
    return hay.includes(want) || (words.length && words.every((w) => hay.includes(w)));
  });
  if (pool.length === 1) return { status: 'one', doc: pool[0] };
  if (pool.length > 1) return { status: 'many', candidates: pool.slice(0, 6) };
  return { status: 'none' };
}

/* ── possible versions of one document ───────────────────────────────────── */

const VERSION_MARK = /\b(v(?:er(?:sion)?)?\s?\d+(?:\.\d+)*|rev(?:ision)?\s?\d+|final|draft|old|new|latest|updated|revised|signed|executed|copy|amended|current|superseded)\b/gi;
const DATE_MARK = /\b(\d{4}[-_./]\d{1,2}(?:[-_./]\d{1,2})?|\d{1,2}[-_./]\d{1,2}[-_./]\d{2,4}|(?:19|20)\d{2}|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|q[1-4]|fy\s?\d{2,4})\b/gi;

/** A document's name with version words, dates and copy numbers taken out. */
export function titleKey(title) {
  return norm(title)
    .replace(VERSION_MARK, ' ').replace(DATE_MARK, ' ').replace(/\b\d{1,2}\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** What a title itself claims about its version ("v2", "final", "2025"). Reported as the title's words, not as fact. */
export function titleMarks(title) {
  const t = String(title || '').replace(/\.[a-z0-9]{1,6}$/i, '');
  return [...new Set([...(t.match(VERSION_MARK) || []), ...(t.match(DATE_MARK) || [])].map((m) => m.toLowerCase()))];
}

/**
 * Documents whose names differ only by version words or dates ("Leave Policy
 * v1", "Leave Policy 2025 final"): possibly versions of one document. Only a
 * hint. Opstead keeps no version history for library files, so which one is
 * in force is something the documents themselves, or a person, must say.
 */
export function versionGroups(docs, { involving = null, tz } = {}) {
  const groups = new Map();
  for (const d of docs) {
    const k = titleKey(d.title) || titleKey(d.file_name);
    if (k.length < 3) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d);
  }
  const out = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    if (involving && !list.some((d) => involving.has(d.id))) continue;
    out.push(list
      .slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .slice(0, 6)
      .map((d) => ({ title: d.title, uploaded: dateText(d.created_at, tz), title_says: titleMarks(d.title).join(', ') || null, document_id: d.id })));
  }
  return out.slice(0, 5);
}

/* ── searching passages ───────────────────────────────────────────────────── */

const stem = (t) => (t.length >= 6 ? t.slice(0, -2) : t);

// Words queryTerms() keeps that say nothing about a document's subject, and
// whose stems would match everywhere ("within" is stemmed to "with").
const FILLER = new Set(['within', 'under', 'over', 'after', 'before', 'upon', 'into', 'onto', 'each', 'every', 'other', 'also', 'such', 'may', 'must', 'shall', 'per', 'say', 'says', 'said', 'mention', 'mentions', 'document', 'documents', 'doc', 'docs', 'file', 'files']);

/** The searchable stems of one phrase, the way libraryQuery() in brainRetrieval builds them. */
export function stemsOf(text) {
  const words = queryTerms(text).map((t) => t.replace(/[^\p{L}\p{N}]/gu, '')).filter((t) => t.length >= 2 && !FILLER.has(t));
  return [...new Set(words.map(stem))];
}

/** A to_tsquery() string: prefix matches, OR'd. Only letters and digits survive, so nothing needs escaping. */
export const toTsQuery = (stems) => stems.map((t) => `${t}:*`).join(' | ');

const wordsOf = (text) => new Set(String(text || '').toLowerCase().normalize('NFKD').match(/[\p{L}\p{N}]+/gu) || []);

/** How many of `stems` appear in `text` as the start of a word. */
export function termHits(text, stems) {
  const words = [...wordsOf(text)];
  let n = 0;
  for (const s of stems) if (words.some((w) => w.startsWith(s))) n += 1;
  return n;
}

/** The ranking pass, on library_search() (0063/0069). Ids and ranks only; the text is re-read under RLS. */
async function rankWithIndex(ctx, tsq) {
  const { data, error } = await withTimeout(supabaseAdmin()
    .rpc('library_search', { p_org: ctx.orgId, p_query: tsq, p_limit: RANK_POOL }));
  if (error) throw error;
  return (data || []).map((h) => ({ id: h.chunk_id, document_id: h.document_id, rank: Number(h.rank) || 0 }));
}

/** The same search without the ranking function, through the caller's client, ranked here by term matches. */
export async function rankWithoutIndex(ctx, tsq, stems) {
  const { data, error } = await withTimeout(ctx.db.from('library_chunks')
    .select('id, document_id, seq, heading, content')
    .eq('org_id', ctx.orgId)
    .textSearch('search_text', tsq, { config: 'simple' })
    .limit(200));
  if (error) throw error;
  return (data || [])
    .map((c) => ({ id: c.id, document_id: c.document_id, rank: termHits(`${c.heading || ''} ${c.content}`, stems) }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, RANK_POOL);
}

/** Trims a passage at a word boundary and says so. */
export function clip(text, max = PASSAGE_CHARS) {
  const s = String(text || '').trim();
  if (s.length <= max) return { text: s, clipped: false };
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return { text: `${cut.slice(0, at > max * 0.8 ? at : max)} …`, clipped: true };
}

/** How well a passage matches: the best share of any one phrasing's words it contains. */
const strength = (best, hits) => {
  if (best >= 0.5) return 'strong';
  if (best >= 0.25 || hits >= 2) return 'partial';
  return 'weak';
};

/**
 * Passages for a question, best first, within budget.
 *
 *   phrases   the question and any other wordings of it (synonyms, the term
 *             a policy would use): the index matches words, not meaning
 *   docIds    only these documents (already resolved and visible)
 *   register  only this register
 *
 * Returns { passages, documents, stems, searched, weakOnly } or throws
 * KnowledgeError when neither search path could run.
 */
export async function searchPassages(ctx, { phrases, docIds = null, register = null, limit = 6 } = {}) {
  const perPhrase = phrases.map(stemsOf).filter((s) => s.length);
  const stems = [...new Set(perPhrase.flat())].slice(0, 24);
  if (!stems.length) return { passages: [], documents: [], stems, searched: false };
  const tsq = toTsQuery(stems);

  const cat = await catalogue(ctx);
  let ranked;
  try {
    // ctx.rankPassages: the offline eval (scripts/eval-agent.js) ranks without
    // the database function. Only server code builds ctx; a request cannot set it.
    ranked = await (ctx.rankPassages || rankWithIndex)(ctx, tsq, stems);
  } catch (err) {
    if (err?.code === 'timeout') throw err;
    try {
      ranked = await rankWithoutIndex(ctx, tsq, stems);
    } catch (e2) {
      if (e2?.code === 'timeout') throw e2;
      throw new KnowledgeError('failed', 'The document search could not run just now.');
    }
  }
  if (!ranked.length) return { passages: [], documents: [], stems, searched: true };

  // The text, through the caller's own client: RLS has the last word on what
  // is read, whatever the ranking pass returned.
  const ids = ranked.map((h) => h.id);
  const { data: rows, error } = await withTimeout(ctx.db.from('library_chunks')
    .select('id, document_id, seq, heading, content')
    .eq('org_id', ctx.orgId)
    .in('id', ids));
  if (error) throw new KnowledgeError('failed', 'The matching passages could not be read just now.');
  const byId = new Map((rows || []).map((r) => [r.id, r]));

  const wanted = docIds ? new Set(docIds) : null;
  const scored = [];
  for (const h of ranked) {
    const c = byId.get(h.id);
    const d = c && cat.byId.get(c.document_id);
    if (!c || !d) continue;                          // not visible to this caller
    if (wanted && !wanted.has(d.id)) continue;
    if (register && d.collection !== register) continue;
    const text = `${c.heading || ''} ${c.content}`;
    const best = Math.max(...perPhrase.map((s) => termHits(text, s) / s.length));
    const hits = termHits(text, stems);
    if (!hits) continue;
    scored.push({ c, d, rank: h.rank, hits, best });
  }
  if (!scored.length) return { passages: [], documents: [], stems, searched: true };

  // Relevance floor: a passage that shares one stray word with the question,
  // well below the best match, is noise that would only invite the model to
  // stretch it. The best match itself is always kept (and marked weak when it
  // is), so a thin result is shown as thin rather than as nothing.
  const top = Math.max(...scored.map((s) => s.rank));
  const kept = scored.filter((s, i) => i === 0 || s.best >= 0.5 || (s.hits >= 2 && s.rank >= top * 0.34));

  const max = Math.min(MAX_PASSAGES, Math.max(1, Number(limit) || 6));
  const passages = [];
  let used = 0;
  for (const s of kept) {
    if (passages.length >= max) break;
    const { text, clipped } = clip(s.c.content);
    if (passages.length && used + text.length > SEARCH_BUDGET) break;
    used += text.length;
    passages.push({
      ref: `S${passages.length + 1}`,
      document: s.d.title,
      file: s.d.file_name,
      register: REGISTERS[s.d.collection] || REGISTERS.general,
      where: s.c.heading || null,
      passage: `${s.c.seq + 1} of ${Number(s.d.chunk_count) || '?'}`,
      match: strength(s.best, s.hits),
      ...(clipped ? { clipped: true } : {}),
      text,
      document_id: s.d.id,
      _doc: s.d,
    });
  }
  remember(ctx, passages.map((p) => p.text), passages.map((p) => p.document));
  const documents = [...new Map(passages.map((p) => [p._doc.id, p._doc])).values()];
  return {
    passages: passages.map(({ _doc, ...p }) => p),
    documents,
    stems,
    searched: true,
    weakOnly: passages.length > 0 && passages.every((p) => p.match === 'weak'),
  };
}

/* ── reading one document in order ────────────────────────────────────────── */

/**
 * A document's passages in order from `from` (1-based), within budget, for
 * summaries, comparisons and "what does this contract say about…". Says
 * whether what was returned is the whole document, which is the only basis
 * on which "the document does not mention X" may be said.
 */
export async function readPassages(ctx, doc, { from = 1, maxChars = READ_BUDGET } = {}) {
  const total = Number(doc.chunk_count) || 0;
  const start = Math.max(1, Math.min(Number(from) || 1, Math.max(total, 1)));
  const { data, error } = await withTimeout(ctx.db.from('library_chunks')
    .select('id, document_id, seq, heading, content')
    .eq('org_id', ctx.orgId)
    .eq('document_id', doc.id)
    .gte('seq', start - 1)
    .order('seq', { ascending: true })
    .limit(60));
  if (error) throw new KnowledgeError('failed', 'This document\'s text could not be read just now.');
  const rows = (data || []).slice().sort((a, b) => a.seq - b.seq);

  const out = [];
  let used = 0;
  for (const c of rows) {
    const { text, clipped } = clip(c.content, PASSAGE_CHARS);
    if (out.length && used + text.length > Math.min(maxChars, READ_BUDGET)) break;
    used += text.length;
    out.push({ passage: c.seq + 1, where: c.heading || null, ...(clipped ? { clipped: true } : {}), text });
  }
  remember(ctx, out.map((p) => p.text), [doc.title]);
  const last = out.length ? out[out.length - 1].passage : start - 1;
  const r = readability(doc);
  const wholeDoc = start === 1 && out.length > 0 && last >= total && !out.some((p) => p.clipped);
  return {
    passages: out,
    showing: out.length ? `passages ${out[0].passage}–${last} of ${total}` : `no passages from ${start}`,
    next_from: last < total ? last + 1 : null,
    complete: wholeDoc && r.state === 'ready',
  };
}

/* ── checking quotations ─────────────────────────────────────────────────── */

/** Everything the model was shown this request, so a quotation can be checked against it. */
function remember(ctx, texts, titles = []) {
  if (!ctx.cache) return;
  const seen = ctx.cache.get('knowledge:seen') || [];
  ctx.cache.set('knowledge:seen', [...seen, ...texts, ...titles]);
}

const flat = (s) => String(s || '').toLowerCase().normalize('NFKD')
  .replace(/[‘’‚′`]/g, "'").replace(/[“”„″]/g, '"')
  .replace(/[‐-―−]/g, '-')
  .replace(/[*_]/g, '').replace(/↵/g, ' ')
  .replace(/\s+/g, ' ').trim();

/** Quoted spans in an answer that do not appear word for word in what was retrieved. */
export function unmatchedQuotes(answer, corpus) {
  const hay = flat(corpus.join('\n'));
  const out = [];
  for (const m of String(answer || '').matchAll(/["“]([^"“”\n]{12,800})["”]/g)) {
    const pieces = m[1].split(/\s*(?:…|\.\.\.)\s*/).map(flat).filter((p) => p.length >= 8);
    if (!pieces.length) continue;
    if (pieces.some((p) => !hay.includes(p.replace(/^[.,;:]+|[.,;:]+$/g, '')))) out.push(m[1]);
  }
  return out;
}

/**
 * The last word on an answer built from documents: a quotation that is not in
 * the retrieved text is flagged under the answer rather than left to pass as
 * the document's words. Applied only when a knowledge tool ran this request.
 */
export function reviewAnswer(ctx, text, { userMessage = '' } = {}) {
  const seen = ctx?.cache?.get('knowledge:seen');
  if (!seen || !text) return text;
  const bad = unmatchedQuotes(text, [...seen, userMessage]);
  if (!bad.length) return text;
  const first = bad[0].length > 70 ? `${bad[0].slice(0, 70)}…` : bad[0];
  return `${text}\n\n_Check before relying on it: the quotation "${first}"${bad.length > 1 ? ` and ${bad.length - 1} other${bad.length > 2 ? 's' : ''}` : ''} could not be matched word for word to the document text that was retrieved. Open the source to confirm the exact wording._`;
}
