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
    const { data, error } = await supabase
      .from('announcements').select(SELECT).eq('org_id', orgId)
      .order('is_pinned', { ascending: false })
      .order('published_at', { ascending: false });
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
