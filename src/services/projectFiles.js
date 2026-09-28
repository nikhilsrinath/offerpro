// projectFiles.js — the writes behind a project's Client, Vendor and Documents
// pages that are more than one orgStore call: files in the `project-files`
// bucket with their versions, folder deletes, client and vendor profiles, and
// building a PDF or Word file from a template.
//
// Every file a project holds is a project_files row (0074), whether it was
// uploaded to Project Documents or attached to a communication, approval,
// invoice, payment or vendor — so Project Documents is the one place they all
// show. Uploading a file whose name already exists in the same place adds a
// version to it instead of a second file.

import { zipSync, strToU8 } from 'fflate';
import { supabase } from '../lib/supabase';
import { orgStore } from './orgStore';
import { htmlToBlocks, blocksToDocxXml, DOCX_PARTS } from './projectWorkspace';

export const PROJECT_BUCKET = 'project-files';
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const extOf = (name) => (String(name).split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'bin';

/** A database or storage refusal, in words. */
export function fileError(e, fallback = 'That did not work. Try again.') {
  const m = e?.message || String(e || '');
  if (/FOLDER_CYCLE/.test(m)) return 'A folder cannot go inside itself.';
  if (/PROJECT_LINK_MISMATCH/.test(m)) return 'That belongs to a different project.';
  if (/project_folders_name_idx|duplicate key/.test(m)) return 'Something with that name is already there.';
  if (/Payload too large|exceeded the maximum/i.test(m)) return 'That file is too large (50 MB at most).';
  if (/row-level security|permission denied|42501|Unauthorized/i.test(m)) return 'You do not have permission to do that.';
  if (/project_files|project_folders|project_templates|client_|project_clients|project_vendors|vendor_bank|contacts|industry/.test(m)
      && /relation|column|schema cache|does not exist/.test(m)) {
    return 'This is not set up on this workspace yet (database migration 0074).';
  }
  return m || fallback;
}
export const needs0074 = (e) => /0074/.test(fileError(e));

// ─── Storage ─────────────────────────────────────────────────────────────────

export async function putObject(folder, file) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is over 50 MB.`);
  const path = `${orgStore.getOrgId()}/${folder}/${crypto.randomUUID()}.${extOf(file.name)}`;
  const { error } = await supabase.storage.from(PROJECT_BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream', upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function removeObjects(paths) {
  const list = [...new Set(paths.filter(Boolean))];
  if (list.length) await supabase.storage.from(PROJECT_BUCKET).remove(list).catch(() => {});
}

export async function signedUrl(path, { download } = {}) {
  const { data, error } = await supabase.storage.from(PROJECT_BUCKET)
    .createSignedUrl(path, 600, download ? { download } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

/** Opens a stored file in a new tab (opened first, so a popup blocker allows it). */
export async function openObject(path, { download } = {}) {
  const w = window.open('', '_blank');
  try {
    const url = await signedUrl(path, { download });
    if (w) { w.opener = null; w.location.href = url; } else window.location.assign(url);
  } catch (e) {
    w?.close();
    throw e;
  }
}

// ─── Project files ───────────────────────────────────────────────────────────

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Stores `file` on the project. Where a file of the same name already sits
 * in the same folder (or on the same linked item), it becomes that file's
 * next version; otherwise a new file row is made. Returns the file row.
 */
export async function uploadProjectFile(projectId, file, {
  folderId = null, linkType = null, linkId = null, tags = [], name = file.name, note = null,
} = {}) {
  const existing = orgStore.getSectionAsList('project_files').find((f) => f.project_id === projectId
    && sameName(f.name, name)
    && (linkType ? f.link_type === linkType && f.link_id === linkId : !f.link_type && (f.folder_id || null) === (folderId || null)));
  const path = await putObject(projectId, file);
  try {
    if (existing) {
      const version = (existing.version || 1) + 1;
      await orgStore.addItem('project_file_versions', {
        project_id: projectId, file_id: existing.id, version, storage_path: path,
        size_bytes: file.size, mime_type: file.type, note,
      });
      await orgStore.updateItem('project_files', existing.id, {
        version, storage_path: path, size_bytes: file.size, mime_type: file.type,
      });
      return { ...existing, version, storage_path: path, _newVersion: true };
    }
    const row = await orgStore.addItem('project_files', {
      project_id: projectId, folder_id: linkType ? null : folderId, name, tags,
      link_type: linkType, link_id: linkId, version: 1, storage_path: path,
      size_bytes: file.size, mime_type: file.type,
    });
    await orgStore.addItem('project_file_versions', {
      project_id: projectId, file_id: row.id, version: 1, storage_path: path,
      size_bytes: file.size, mime_type: file.type, note,
    });
    return row;
  } catch (e) {
    await removeObjects([path]);
    throw e;
  }
}

/** Makes an old version current again, as a new version (history is never rewritten). */
export async function restoreVersion(file, old) {
  const version = (file.version || 1) + 1;
  await orgStore.addItem('project_file_versions', {
    project_id: file.project_id, file_id: file.id, version, storage_path: old.storage_path,
    size_bytes: old.size_bytes, mime_type: old.mime_type, note: `Restored from version ${old.version}`,
  });
  await orgStore.updateItem('project_files', file.id, {
    version, storage_path: old.storage_path, size_bytes: old.size_bytes, mime_type: old.mime_type,
  });
}

const versionsOf = (fileIds) => {
  const ids = new Set(fileIds);
  return orgStore.getSectionAsList('project_file_versions').filter((v) => ids.has(v.file_id));
};

/** Deletes files, their versions and the stored objects behind them. */
export async function deleteProjectFiles(files) {
  if (!files.length) return;
  const paths = [...files.map((f) => f.storage_path), ...versionsOf(files.map((f) => f.id)).map((v) => v.storage_path)];
  for (const f of files) await orgStore.removeItem('project_files', f.id);
  await orgStore.refreshSection('project_file_versions').catch(() => {});
  await removeObjects(paths);
}

/** Deletes a folder, everything under it, and their stored objects. */
export async function deleteFolder(folder, subtreeIds) {
  const files = orgStore.getSectionAsList('project_files').filter((f) => subtreeIds.has(f.folder_id));
  const paths = [...files.map((f) => f.storage_path), ...versionsOf(files.map((f) => f.id)).map((v) => v.storage_path)];
  await orgStore.removeItem('project_folders', folder.id);   // the rows below go with it (on delete cascade)
  await Promise.all(['project_folders', 'project_files', 'project_file_versions']
    .map((s) => orgStore.refreshSection(s).catch(() => {})));
  await removeObjects(paths);
}

/** The files attached to one item (a communication, approval, invoice…). */
export const attachmentsOf = (projectId, linkType, linkId) => orgStore.getSectionAsList('project_files')
  .filter((f) => f.project_id === projectId && f.link_type === linkType && f.link_id === linkId);

// ─── Client and vendor profiles ──────────────────────────────────────────────
// Written column by column rather than through updateItem, which round-trips
// the whole cached client — and the cached client cannot carry its `extra`
// blob back intact.

const CLIENT_COLUMNS = ['name', 'email', 'phone', 'address', 'gstin', 'status', 'person_name', 'industry', 'website',
    'logo_path', 'contact_designation', 'alt_contact', 'client_since', 'contacts'];
const VENDOR_COLUMNS = ['company_name', 'contact_name', 'email', 'phone', 'address', 'gstin', 'category', 'notes',
    'logo_path', 'website', 'contacts', 'contract_start', 'contract_end', 'contract_value', 'status'];

const blank = (v) => (v === '' || v === undefined ? null : v);
const pick = (obj, cols) => Object.fromEntries(cols.filter((c) => obj[c] !== undefined).map((c) => [c, blank(obj[c])]));

export async function saveClient(id, patch) {
  const row = pick(patch, CLIENT_COLUMNS);
  if (row.gstin) row.gstin = String(row.gstin).trim().toUpperCase();
  if (!row.contacts) delete row.contacts;
  const q = id
    ? supabase.from('clients').update(row).eq('id', id)
    : supabase.from('clients').insert({ ...row, org_id: orgStore.getOrgId(), source: 'manual', status: row.status || 'active' });
  const { data, error } = await q.select('id').single();
  if (error) throw error;
  await orgStore.refreshSection('customers');
  return data.id;
}

export async function saveVendor(id, patch) {
  const row = pick(patch, VENDOR_COLUMNS);
  if (row.gstin) row.gstin = String(row.gstin).trim().toUpperCase();
  if (!row.contacts) delete row.contacts;
  const q = id
    ? supabase.from('vendors').update(row).eq('id', id)
    : supabase.from('vendors').insert({ ...row, org_id: orgStore.getOrgId() });
  const { data, error } = await q.select('id').single();
  if (error) throw error;
  await orgStore.refreshSection('vendors');
  return data.id;
}

/** Logos live at {org}/clients|vendors/…; the old one is removed once the new one is saved. */
export async function uploadLogo(kind, file) {
  if (!/^image\//.test(file.type)) throw new Error('A logo has to be an image.');
  if (file.size > 2 * 1024 * 1024) throw new Error('A logo can be 2 MB at most.');
  return putObject(kind, file);
}

// ─── Building documents from a template ──────────────────────────────────────

export function docxBlob(html) {
  const zip = zipSync({
    '[Content_Types].xml': strToU8(DOCX_PARTS['[Content_Types].xml']),
    '_rels/.rels': strToU8(DOCX_PARTS['_rels/.rels']),
    'word/document.xml': strToU8(blocksToDocxXml(htmlToBlocks(html))),
  });
  return new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/** A text PDF laid out from the template's blocks: headings, paragraphs and lists, with bold, italic and underline. */
export async function pdfBlob(html, { title = '' } = {}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 56;
  let y = M;
  if (title) doc.setProperties({ title });
  const SIZES = { h1: 20, h2: 16, h3: 13.5, p: 11, li: 11, quote: 11 };

  for (const block of htmlToBlocks(html)) {
    const size = SIZES[block.type] || 11;
    const lh = size * 1.45;
    const indent = block.type === 'li' ? 16 + 14 * block.depth : block.type === 'quote' ? 18 : 0;
    const heading = /^h/.test(block.type);
    if (heading) y += size * 0.4;
    // Words with their style, so a line can mix bold and plain text.
    const words = [];
    if (block.type === 'li') words.push({ text: block.list === 'ol' ? `${block.index}.` : '•', b: false, i: false, u: false, bullet: true });
    for (const r of block.runs) {
      r.text.split(/(\n| )/).forEach((part) => {
        if (part === '\n') words.push({ br: true });
        else if (part && part !== ' ') words.push({ text: part, b: r.b || heading, i: r.i || block.type === 'quote', u: r.u });
      });
    }
    let x = M + indent;
    const newLine = () => {
      x = M + indent; y += lh;
      if (y > H - M) { doc.addPage(); y = M; }
    };
    if (y + lh > H - M) { doc.addPage(); y = M; }
    for (const w of words) {
      if (w.br) { newLine(); continue; }
      doc.setFont('helvetica', w.b && w.i ? 'bolditalic' : w.b ? 'bold' : w.i ? 'italic' : 'normal');
      doc.setFontSize(size);
      if (w.bullet) { doc.text(w.text, M + indent - 14, y + size); continue; }
      const width = doc.getTextWidth(w.text);
      const space = doc.getTextWidth(' ');
      if (x > M + indent && x + width > W - M) newLine();
      doc.text(w.text, x, y + size);
      if (w.u) doc.line(x, y + size + 1.5, x + width, y + size + 1.5);
      x += width + space;
    }
    y += lh + (heading ? size * 0.3 : 6);
  }
  return doc.output('blob');
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
