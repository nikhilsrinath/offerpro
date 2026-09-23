import dns from 'node:dns/promises';
import net from 'node:net';
import * as XLSX from 'xlsx';
import { requireUser, requireOrgRole, sendError, methodIs, readJsonBody, HttpError } from './_lib/auth.js';

/**
 * POST /api/sheet-import   { org_id, url }
 * Headers: Authorization: Bearer <supabase access token>
 *
 * Fetches a spreadsheet by link and returns its first sheet as JSON rows, so the
 * CRM can turn them into leads. The fetch happens here rather than in the
 * browser because Google/OneDrive/Dropbox download links do not send CORS
 * headers. Parsing happens here too: rows are far smaller than the workbook, and
 * a base64 workbook would run into the serverless response-size limit.
 *
 * Because this makes the server fetch a caller-supplied URL, it only follows
 * https links that resolve to public addresses — otherwise it is a proxy into
 * whatever network the function runs in.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15000;

/** Rewrites share links into direct-download links for the common hosts. */
export function toDownloadUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw new HttpError(400, 'That is not a valid URL'); }

  // Google Sheets: /spreadsheets/d/<id>/edit#gid=<gid>  →  /export?format=xlsx
  const gs = u.hostname === 'docs.google.com' && u.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
  if (gs && gs[1] !== 'e') {
    const gid = u.searchParams.get('gid') || (u.hash.match(/gid=(\d+)/) || [])[1];
    const out = new URL(`https://docs.google.com/spreadsheets/d/${gs[1]}/export`);
    out.searchParams.set('format', 'xlsx');
    if (gid) out.searchParams.set('gid', gid);
    return out.toString();
  }
  // Published-to-web Google Sheets: /spreadsheets/d/e/<id>/pubhtml  →  pub?output=xlsx
  if (gs) {
    u.pathname = u.pathname.replace(/\/pub(html)?$/, '/pub');
    u.searchParams.set('output', 'xlsx');
    return u.toString();
  }
  // Dropbox share links download with dl=1.
  if (/(^|\.)dropbox\.com$/.test(u.hostname)) {
    u.searchParams.set('dl', '1');
    return u.toString();
  }
  // OneDrive / SharePoint share links download with download=1.
  if (/(^|\.)(sharepoint\.com|onedrive\.live\.com|1drv\.ms)$/.test(u.hostname)) {
    u.searchParams.set('download', '1');
    return u.toString();
  }
  return u.toString();
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

async function assertPublicHttps(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new HttpError(400, 'Only https links are supported');
  const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new HttpError(400, `Could not resolve ${u.hostname}`);
  if (addrs.some(a => isPrivateAddress(a.address))) throw new HttpError(400, 'That address is not allowed');
}

export async function fetchSheet(url) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHttps(current);
    const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      throw new HttpError(400, 'The sheet could not be opened. Make sure it is shared as "Anyone with the link can view".');
    }
    if (!res.ok) throw new HttpError(502, `The sheet host responded with ${res.status}`);

    const type = res.headers.get('content-type') || '';
    if (type.includes('text/html')) {
      throw new HttpError(400, 'The link opened a web page, not a spreadsheet. Make sure it is shared as "Anyone with the link can view".');
    }
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new HttpError(413, 'The spreadsheet is larger than 10 MB');

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new HttpError(413, 'The spreadsheet is larger than 10 MB');
    return buf;
  }
  throw new HttpError(400, 'Too many redirects');
}

export default async function handler(req, res) {
  if (!methodIs(req, res, 'POST')) return;
  try {
    const user = await requireUser(req);
    const body = await readJsonBody(req);
    await requireOrgRole(user.id, body.org_id, 'member');
    if (!body.url) throw new HttpError(400, 'Missing url');

    const buf = await fetchSheet(toDownloadUrl(body.url));

    let workbook;
    try {
      workbook = XLSX.read(buf, { type: 'buffer' });
    } catch {
      throw new HttpError(400, 'The file could not be read as a spreadsheet (xlsx, xls or csv)');
    }
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new HttpError(400, 'The spreadsheet has no sheets');
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false });

    return res.status(200).json({
      success: true,
      sheet: sheetName,
      total: rows.length,
      truncated: rows.length > MAX_ROWS,
      rows: rows.slice(0, MAX_ROWS),
    });
  } catch (err) {
    const out = err?.name === 'TimeoutError' ? new HttpError(504, 'The sheet took too long to download') : err;
    return sendError(res, out, 'sheet-import');
  }
}
