// announcementService.js: broadcasts to the whole team, one department, a
// project's people, or members picked by name.
//
// Who reads a notice is decided by RLS (0029 §6, 0073, 0111
// announcements_self_select), not by a filter here: an announcement aimed at
// Engineering, or at three people, is invisible to everyone else even if they
// ask for it by id. A notice with a send date in the future reaches nobody
// but its author and whoever may read every announcement until that time.
//
// Read state is per user, mirroring notification_reads (0001), one person
// opening a notice must not clear the badge for the rest of the team.

import { supabase } from '../lib/supabase';

const SELECT = `id, org_id, title, body, department_id, is_pinned,
                published_at, expires_at, created_by, created_at`;
// 0073: a project's own announcements, with a priority and attachments.
const SELECT_0073 = `${SELECT}, updated_at, project_id, priority, attachments`;
// 0111: members picked by name.
const SELECT_0111 = `${SELECT_0073}, audience_employee_ids`;

export const ANNOUNCEMENT_BUCKET = 'announcements';
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_COUNT = 10;
/** An attachment's size, for its row. */
export const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round((b || 0) / 1024))} KB`);
export const PRIORITIES = [
  { id: 'normal', label: 'Normal', tone: 'mute' },
  { id: 'important', label: 'Important', tone: 'neutral' },
  { id: 'urgent', label: 'Urgent', tone: 'down' },
];

/** True when the database has not had 0073 applied: the new columns are unknown. */
export const missingProjectColumns = (error) => /project_id|priority|attachments/.test(error?.message || '')
  && /column|schema cache/.test(error?.message || '');
/** True when the database has not had 0111 applied. */
const missingAudience = (error) => /audience_employee_ids/.test(error?.message || '')
  && /column|schema cache/.test(error?.message || '');
const missingColumn = (error) => missingAudience(error) || missingProjectColumns(error);

/** The members picked by name; none means everyone the notice would reach. */
export const audienceOf = (a) => (Array.isArray(a?.audience_employee_ids) ? a.audience_employee_ids : []);

/** Scheduled: its send date is still to come. */
export const isScheduled = (a, now = Date.now()) => !!a?.published_at && new Date(a.published_at).getTime() > now;
export const isExpired = (a, now = Date.now()) => !!a?.expires_at && new Date(a.expires_at).getTime() < now;

/** Live = sent, and not past its expiry. */
function isLive(a, now = Date.now()) {
  return !isScheduled(a, now) && !isExpired(a, now);
}

const tidy = (a) => ({
  ...a,
  attachments: Array.isArray(a.attachments) ? a.attachments : [],
  audience_employee_ids: audienceOf(a),
});

/** Runs `build(select)` with the newest column list the database knows, falling back a step at a time. */
async function withColumns(selects, build) {
  let last;
  for (const sel of selects) {
    const res = await build(sel);
    if (!res.error) return res;
    last = res;
    if (!missingColumn(res.error)) break;
  }
  return last;
}

/**
 * The send date and expiry as stored. A send date that is now or already
 * past is "now": the notice goes out at once. A day-only expiry runs to the
 * end of that day.
 */
function datesOf({ sendAt, expiresAt }, editing) {
  const send = sendAt ? new Date(sendAt) : null;
  const sendIso = send && !Number.isNaN(send.getTime()) && send.getTime() > Date.now() ? send.toISOString() : null;
  const expiry = expiresAt
    ? new Date(/T/.test(expiresAt) ? expiresAt : `${expiresAt}T23:59:59`)
    : null;
  const expiryIso = expiry && !Number.isNaN(expiry.getTime()) ? expiry.toISOString() : null;
  // A new notice cannot expire before it goes out; an old one being edited may already have.
  if (expiryIso && sendIso && new Date(expiryIso) <= new Date(sendIso)) {
    throw new Error('The expire date has to be after the send date.');
  }
  if (expiryIso && !sendIso && !editing && new Date(expiryIso).getTime() < Date.now()) {
    throw new Error('The expire date has already passed.');
  }
  return { sendIso, expiryIso };
}

async function uploadAll(orgId, folder, files) {
  const uploaded = [];
  for (const file of files) {
    const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
    const path = `${orgId}/${folder}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(ANNOUNCEMENT_BUCKET).upload(path, file, {
      contentType: file.type || 'application/octet-stream', upsert: false,
    });
    if (error) {
      if (uploaded.length) await supabase.storage.from(ANNOUNCEMENT_BUCKET).remove(uploaded.map((a) => a.path)).catch(() => {});
      throw error;
    }
    uploaded.push({ path, name: file.name.slice(0, 200), size: file.size, type: file.type || '' });
  }
  return uploaded;
}

/**
 * Saves one announcement, company or project. New files are uploaded first
 * and appended to `keep` (the attachments already on it that stay); files
 * taken off are deleted from storage once the row saves. Columns from a
 * migration not yet applied are only sent when they hold something, so an
 * ordinary notice still saves on an older database.
 */
async function save(orgId, base, {
  id, sendAt = null, expiresAt = null, audience = [], hadAudience = false,
  keep = [], files = [], dropped = [], folder,
}) {
  if (!base.title) throw new Error('Give the announcement a title.');
  if (!base.body) throw new Error('An announcement needs something to say.');
  if (keep.length + files.length > ATTACHMENT_MAX_COUNT) throw new Error(`At most ${ATTACHMENT_MAX_COUNT} attachments.`);
  const big = files.find((f) => f.size > ATTACHMENT_MAX_BYTES);
  if (big) throw new Error(`${big.name} is over 10 MB.`);
  const { sendIso, expiryIso } = datesOf({ sendAt, expiresAt }, !!id);
  const { data: { user } } = await supabase.auth.getUser();

  const uploaded = await uploadAll(orgId, folder, files);
  try {
    const row = { ...base, org_id: orgId, expires_at: expiryIso };
    // Sent now: a new notice takes the database's now(); an edited one that
    // was scheduled goes out now (below); one already out keeps its date.
    if (sendIso) row.published_at = sendIso;
    if (keep.length || uploaded.length || dropped.length) row.attachments = [...keep, ...uploaded];
    if (audience.length || hadAudience) {
      row.audience_employee_ids = audience;
      if (audience.length) row.department_id = null;
    }

    const write = (sel) => (id
      ? supabase.from('announcements').update(row).eq('id', id)
      : supabase.from('announcements').insert({ ...row, created_by: user?.id || null })).select(sel).maybeSingle();
    const selects = [SELECT_0111, SELECT_0073, SELECT].filter((s) => s !== SELECT || (!row.attachments && !base.project_id));
    // An edit of one already out keeps its send date: only a scheduled one is moved.
    if (id && !sendIso) {
      const { data: now } = await supabase.from('announcements').select('published_at').eq('id', id).maybeSingle();
      if (now?.published_at && new Date(now.published_at).getTime() > Date.now()) row.published_at = new Date().toISOString();
    }
    const { data, error } = await withColumns(selects, write);
    if (error) {
      if (missingAudience(error)) throw new Error('Choosing members needs the latest database update (0111). Send it to everyone for now.');
      throw error;
    }
    if (!data) throw new Error('You do not have permission to publish announcements.');
    if (dropped.length) {
      await supabase.storage.from(ANNOUNCEMENT_BUCKET).remove(dropped.map((a) => a.path)).catch(() => {});
    }
    return tidy(data);
  } catch (err) {
    // Nothing points at files from a save that failed: take them back out.
    if (uploaded.length) {
      await supabase.storage.from(ANNOUNCEMENT_BUCKET).remove(uploaded.map((a) => a.path)).catch(() => {});
    }
    throw err;
  }
}

export const announcementService = {
  /**
   * The organization's own notices, pinned first, then newest.
   * `includeExpired` (the admin pages) also returns expired and scheduled
   * ones; the board in the portal shows live notices only.
   */
  async list(orgId, { includeExpired = false } = {}) {
    if (!orgId) return [];
    const query = (sel) => {
      let q = supabase.from('announcements').select(sel).eq('org_id', orgId);
      // A project's announcements belong on that project's page, not the board.
      if (sel !== SELECT) q = q.is('project_id', null);
      return q.order('is_pinned', { ascending: false }).order('published_at', { ascending: false });
    };
    // Before 0073 there is no project_id, and every announcement is the org's.
    const { data, error } = await withColumns([SELECT_0111, SELECT_0073, SELECT], query);
    if (error) throw error;
    const rows = (data || []).map(tidy);
    return includeExpired ? rows : rows.filter((a) => isLive(a));
  },

  /** Create or update a company announcement (attachments under <org>/org/). */
  async publish(orgId, {
    id, title, body, departmentId = null, isPinned = false, sendAt = null, expiresAt = null,
    audience = [], hadAudience = false, keep = [], files = [], dropped = [],
  }) {
    return save(orgId, {
      title: title?.trim(), body: body?.trim(),
      department_id: audience.length ? null : departmentId || null,
      is_pinned: !!isPinned,
    }, { id, sendAt, expiresAt, audience, hadAudience, keep, files, dropped, folder: 'org' });
  },

  async remove(id) {
    const { error } = await supabase.from('announcements').delete().eq('id', id);
    if (error) throw error;
  },

  // ── One project's feed (0073) ──────────────────────────────────────────────

  /** Every announcement on the project, pinned first, then newest. */
  async listForProject(orgId, projectId) {
    if (!orgId || !projectId) return [];
    const { data, error } = await withColumns([SELECT_0111, SELECT_0073], (sel) => supabase
      .from('announcements').select(sel)
      .eq('org_id', orgId).eq('project_id', projectId)
      .order('is_pinned', { ascending: false })
      .order('published_at', { ascending: false }));
    if (error) throw error;
    return (data || []).map(tidy);
  },

  /** Create or update a project announcement (attachments under <org>/<project>/). */
  async publishForProject(orgId, projectId, {
    id, title, body, priority = 'normal', isPinned = false, sendAt = null, expiresAt = null,
    audience = [], hadAudience = false, keep = [], files = [], dropped = [],
  }) {
    return save(orgId, {
      project_id: projectId,
      title: title?.trim(), body: body?.trim(),
      priority: PRIORITIES.some((p) => p.id === priority) ? priority : 'normal',
      is_pinned: !!isPinned,
    }, { id, sendAt, expiresAt, audience, hadAudience, keep, files, dropped, folder: projectId });
  },

  /** Only the pin changes. The rest of the notice is left as it is. */
  async setPinned(id, isPinned) {
    const { data, error } = await supabase.from('announcements')
      .update({ is_pinned: !!isPinned }).eq('id', id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('You do not have permission to pin announcements.');
  },

  /** Deletes the row, then its files. */
  async removeWithFiles(announcement) {
    await announcementService.remove(announcement.id);
    const paths = (announcement.attachments || []).map((a) => a.path).filter(Boolean);
    if (paths.length) await supabase.storage.from(ANNOUNCEMENT_BUCKET).remove(paths).catch(() => {});
  },

  /** A short-lived link to one attachment. */
  async attachmentUrl(path) {
    const { data, error } = await supabase.storage.from(ANNOUNCEMENT_BUCKET).createSignedUrl(path, 300);
    if (error) throw error;
    return data.signedUrl;
  },

  /** The ids the current user has already opened. Not org-scoped: announcement_reads
   *  has no org_id, and the caller intersects these against one org's own list. */
  async readIds() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Set();
    const { data, error } = await supabase
      .from('announcement_reads').select('announcement_id').eq('user_id', user.id);
    if (error) throw error;
    return new Set((data || []).map((r) => r.announcement_id));
  },

  /** Idempotent: opening the same notice twice keeps the first timestamp. */
  async markRead(announcementId) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('announcement_reads')
      .upsert({ announcement_id: announcementId, user_id: user.id },
              { onConflict: 'announcement_id,user_id', ignoreDuplicates: true });
    if (error) throw error;
  },

  async unreadCount(orgId) {
    const [live, read] = await Promise.all([
      announcementService.list(orgId),
      announcementService.readIds(),
    ]);
    return live.filter((a) => !read.has(a.id)).length;
  },
};
