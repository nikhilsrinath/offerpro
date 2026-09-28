// announcementService.js — broadcasts to the whole team or one department.
//
// `department_id: null` means everyone. The audience is decided by RLS
// (0029 §6 announcements_self_select), not by a filter here: an announcement
// aimed at Engineering is invisible to Sales even if someone asks for it by id.
//
// Read state is per user, mirroring notification_reads (0001) — one person
// opening a notice must not clear the badge for the rest of the team.

import { supabase } from '../lib/supabase';

const SELECT = `id, org_id, title, body, department_id, is_pinned,
                published_at, expires_at, created_by, created_at`;
// 0073: a project's own announcements, with a priority and attachments.
const PROJECT_SELECT = `${SELECT}, updated_at, project_id, priority, attachments`;

export const ANNOUNCEMENT_BUCKET = 'announcements';
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_COUNT = 10;
export const PRIORITIES = [
  { id: 'normal', label: 'Normal', tone: 'mute' },
  { id: 'important', label: 'Important', tone: 'neutral' },
  { id: 'urgent', label: 'Urgent', tone: 'down' },
];

/** True when the database has not had 0073 applied: the new columns are unknown. */
export const missingProjectColumns = (error) => /project_id|priority|attachments/.test(error?.message || '')
  && /column|schema cache/.test(error?.message || '');

/** Live = published, and not past its expiry. */
function isLive(a, now = Date.now()) {
  if (a.published_at && new Date(a.published_at).getTime() > now) return false;
  if (a.expires_at && new Date(a.expires_at).getTime() < now) return false;
  return true;
}

export const announcementService = {
  /**
   * Pinned first, then newest. `includeExpired` is for the admin history page;
   * the board and the portal show live notices only.
   */
  async list(orgId, { includeExpired = false } = {}) {
    if (!orgId) return [];
    const query = (orgOnly) => {
      let q = supabase.from('announcements').select(SELECT).eq('org_id', orgId);
      // A project's announcements belong on that project's page, not the board.
      if (orgOnly) q = q.is('project_id', null);
      return q.order('is_pinned', { ascending: false }).order('published_at', { ascending: false });
    };
    let { data, error } = await query(true);
    // Before 0073 there is no project_id, and every announcement is the org's.
    if (error && missingProjectColumns(error)) ({ data, error } = await query(false));
    if (error) throw error;
    const rows = data || [];
    return includeExpired ? rows : rows.filter((a) => isLive(a));
  },

  async publish(orgId, { id, title, body, departmentId = null, isPinned = false, expiresAt = null }) {
    const { data: { user } } = await supabase.auth.getUser();
    const row = {
      org_id: orgId,
      title: title?.trim(),
      body: body?.trim(),
      department_id: departmentId || null,
      is_pinned: !!isPinned,
      expires_at: expiresAt || null,
    };
    if (!row.title) throw new Error('Give the announcement a title.');
    if (!row.body) throw new Error('An announcement needs something to say.');

    const q = id
      ? supabase.from('announcements').update(row).eq('id', id)
      : supabase.from('announcements').insert({ ...row, created_by: user?.id || null });
    const { data, error } = await q.select(SELECT).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('You do not have permission to publish announcements.');
    return data;
  },

  async remove(id) {
    const { error } = await supabase.from('announcements').delete().eq('id', id);
    if (error) throw error;
  },

  // ── One project's feed (0073) ──────────────────────────────────────────────

  /** Every announcement on the project, pinned first, then newest. */
  async listForProject(orgId, projectId) {
    if (!orgId || !projectId) return [];
    const { data, error } = await supabase
      .from('announcements').select(PROJECT_SELECT)
      .eq('org_id', orgId).eq('project_id', projectId)
      .order('is_pinned', { ascending: false })
      .order('published_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((a) => ({ ...a, attachments: Array.isArray(a.attachments) ? a.attachments : [] }));
  },

  /**
   * Create or update a project announcement. New files are uploaded first and
   * appended to `keep` (the attachments already on it that stay); files taken
   * off an existing notice are deleted from storage after the row saves.
   */
  async publishForProject(orgId, projectId, {
    id, title, body, priority = 'normal', isPinned = false, expiresAt = null,
    keep = [], files = [], dropped = [],
  }) {
    if (!title?.trim()) throw new Error('Give the announcement a title.');
    if (!body?.trim()) throw new Error('An announcement needs something to say.');
    if (keep.length + files.length > ATTACHMENT_MAX_COUNT) {
      throw new Error(`At most ${ATTACHMENT_MAX_COUNT} attachments.`);
    }
    const big = files.find((f) => f.size > ATTACHMENT_MAX_BYTES);
    if (big) throw new Error(`${big.name} is over 10 MB.`);
    const { data: { user } } = await supabase.auth.getUser();

    const uploaded = [];
    try {
      for (const file of files) {
        const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
        const path = `${orgId}/${projectId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from(ANNOUNCEMENT_BUCKET).upload(path, file, {
          contentType: file.type || 'application/octet-stream', upsert: false,
        });
        if (error) throw error;
        uploaded.push({ path, name: file.name.slice(0, 200), size: file.size, type: file.type || '' });
      }

      const row = {
        org_id: orgId,
        project_id: projectId,
        title: title.trim(),
        body: body.trim(),
        priority: PRIORITIES.some((p) => p.id === priority) ? priority : 'normal',
        is_pinned: !!isPinned,
        expires_at: expiresAt || null,
        attachments: [...keep, ...uploaded],
      };
      const q = id
        ? supabase.from('announcements').update(row).eq('id', id)
        : supabase.from('announcements').insert({ ...row, created_by: user?.id || null });
      const { data, error } = await q.select(PROJECT_SELECT).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('You do not have permission to publish announcements.');

      if (dropped.length) {
        await supabase.storage.from(ANNOUNCEMENT_BUCKET).remove(dropped.map((a) => a.path)).catch(() => {});
      }
      return data;
    } catch (err) {
      // Nothing points at files from a save that failed: take them back out.
      if (uploaded.length) {
        await supabase.storage.from(ANNOUNCEMENT_BUCKET).remove(uploaded.map((a) => a.path)).catch(() => {});
      }
      throw err;
    }
  },

  /** Only the pin changes — the rest of the notice is left as it is. */
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
