// portalAccessService.js — giving an employee their way in.
//
// Two routes, both ending at the same place (a membership row plus
// employees.user_id):
//
//   invite   an admin clicks "Give portal access" on someone. One call raises
//            the invitation and one sends the mail, through the org's own Gmail
//            — the same pipeline offer letters already go out on, so there is
//            no Supabase SMTP to configure before onboarding a group.
//   join     the org shares a code. Staff let themselves in, but only into an
//            employee record an admin already created at their address.
//
// Every rule lives in 0030's functions; this file calls them and writes the
// email. Nothing here decides who may do what.

import { supabase } from '../lib/supabase';
import { emailService } from './emailService';

/** Where an invitation or a code is redeemed. */
export function joinUrl({ token, code } = {}) {
  const base = `${window.location.origin}/join`;
  if (token) return `${base}?t=${encodeURIComponent(token)}`;
  if (code) return `${base}?c=${encodeURIComponent(code)}`;
  return base;
}

function inviteEmail({ employeeName, companyName, link }) {
  const firstName = String(employeeName || '').trim().split(/\s+/)[0] || 'there';
  const safeCompany = companyName || 'your organization';
  const text =
    `Hi ${firstName},\n\n` +
    `${safeCompany} has set up your employee portal. You can check in and out, ` +
    `see your attendance, apply for leave and read team announcements there.\n\n` +
    `Open it here:\n${link}\n\n` +
    `Sign in with Google, or set a password — whichever you prefer. ` +
    `The link works for 14 days.\n\n` +
    `— ${safeCompany}`;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                max-width:520px;margin:0 auto;padding:32px 24px;color:#18181b;line-height:1.6">
      <p style="margin:0 0 18px">Hi ${escapeHtml(firstName)},</p>
      <p style="margin:0 0 18px">
        <strong>${escapeHtml(safeCompany)}</strong> has set up your employee portal. You can check in
        and out, see your attendance, apply for leave and read team announcements there.
      </p>
      <p style="margin:0 0 26px">
        <a href="${escapeHtml(link)}"
           style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;
                  padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px">
          Open my portal
        </a>
      </p>
      <p style="margin:0 0 18px;color:#52525b;font-size:14px">
        Sign in with Google, or set a password — whichever you prefer. The link works for 14 days.
      </p>
      <p style="margin:0;color:#a1a1aa;font-size:12px;word-break:break-all">
        If the button does not work, paste this into your browser:<br>${escapeHtml(link)}
      </p>
    </div>`;

  return { text, html };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export const portalAccessService = {
  // ── Credentials (the way in) ───────────────────────────────────────────────

  /**
   * Creates the login for an employee and returns the credentials once.
   *
   * The password exists in this app's memory for as long as the admin has the
   * dialog open, and nowhere else — not in the database, not in the audit log,
   * not in an email. If they close it without copying, the answer is a reset,
   * which is one click.
   *
   * @returns {Promise<{email: string, password: string|null, outcome: 'created'|'linked'|'exists'}>}
   */
  async createLogin(employeeId) {
    const { data, error } = await supabase.rpc('create_portal_login', { p_employee: employeeId });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Could not create the login.');
    return row;
  },

  /** A fresh password for someone who lost theirs. @returns the new password. */
  async resetPassword(employeeId) {
    const { data, error } = await supabase.rpc('reset_portal_password', { p_employee: employeeId });
    if (error) throw new Error(error.message);
    return data;
  },

  /** Takes the login away without ending the employment. */
  async revokeLogin(employeeId) {
    const { error } = await supabase.rpc('revoke_portal_login', { p_employee: employeeId });
    if (error) throw new Error(error.message);
  },

  /** Creates logins across a selection. Never rejects; reports per person. */
  async createLoginMany(employeeIds, { employeesById = {}, onProgress } = {}) {
    const made = [];
    const failed = [];
    for (let i = 0; i < employeeIds.length; i += 1) {
      const id = employeeIds[i];
      const name = employeesById[id]?.name || employeesById[id]?.full_name || 'Employee';
      try {
        const row = await portalAccessService.createLogin(id);
        made.push({ id, name, ...row });
      } catch (err) {
        failed.push({ id, name, reason: err.message });
      }
      onProgress?.(i + 1, employeeIds.length);
    }
    return { made, failed };
  },

  // ── Inviting (kept for links already in flight) ────────────────────────────

  /**
   * Raises the invitation and mails it. Returns the link either way, so an
   * admin can still copy it into WhatsApp when the org has no Gmail connected
   * — a failed send must not cost them the invitation they just created.
   *
   * @returns {Promise<{link: string, email: string, sent: boolean, sendError?: string}>}
   */
  async invite(employeeId, { orgProfile } = {}) {
    const { data, error } = await supabase
      .rpc('invite_employee_to_portal', { p_employee: employeeId });
    if (error) throw new Error(error.message);

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.token) throw new Error('Could not create the invitation.');

    const link = joinUrl({ token: row.token });
    const companyName = orgProfile?.company_name || orgProfile?.name || '';
    const { text, html } = inviteEmail({ employeeName: row.full_name, companyName, link });

    // sendEmail resolves with {success, message} rather than throwing, so a
    // failed send is read, not caught.
    const res = await emailService.sendEmail({
      to: row.email,
      subject: `Your employee portal at ${companyName || 'work'}`,
      text,
      html,
      orgProfile,
    });
    return {
      link, email: row.email,
      sent: !!res?.success,
      sendError: res?.success ? undefined : (res?.message || 'Could not send the email.'),
    };
  },

  /**
   * The same thing across a selection. Sequential rather than parallel: these
   * go through one Gmail account with a per-org rate limit (0024), and forty
   * simultaneous sends would trip it and lose most of them.
   *
   * Never rejects — one bad address must not abandon the other thirty-nine.
   * @returns {Promise<{ok: string[], failed: {id, name, reason}[], unsent: number}>}
   */
  async inviteMany(employeeIds, { orgProfile, employeesById = {}, onProgress } = {}) {
    const ok = [];
    const failed = [];
    let unsent = 0;

    for (let i = 0; i < employeeIds.length; i += 1) {
      const id = employeeIds[i];
      const name = employeesById[id]?.name || employeesById[id]?.full_name || 'Employee';
      try {
        const res = await portalAccessService.invite(id, { orgProfile });
        ok.push(id);
        if (!res.sent) unsent += 1;
      } catch (err) {
        failed.push({ id, name, reason: err.message });
      }
      onProgress?.(i + 1, employeeIds.length);
    }
    return { ok, failed, unsent };
  },

  /** `none` | `invited` | `active` | `revoked`, keyed by employee id. */
  async states(orgId) {
    if (!orgId) return {};
    const { data, error } = await supabase.rpc('employee_portal_state', { p_org: orgId });
    if (error) throw new Error(error.message);
    return Object.fromEntries((data || []).map((r) => [r.employee_id, r]));
  },

  // ── The join code ──────────────────────────────────────────────────────────

  /** The org's own code. Readable by any member; only an admin may change it. */
  async getJoinCode(orgId) {
    const { data, error } = await supabase
      .from('organizations')
      .select('portal_join_code, portal_join_enabled, portal_join_expires_at')
      .eq('id', orgId).maybeSingle();
    if (error) throw new Error(error.message);
    return data || null;
  },

  /** Issues a fresh code; the previous one stops working immediately. */
  async rotateJoinCode(orgId, enabled = true) {
    const { data, error } = await supabase
      .rpc('rotate_portal_join_code', { p_org: orgId, p_enabled: enabled });
    if (error) throw new Error(error.message);
    return data;
  },

  async setJoinEnabled(orgId, enabled) {
    const { error } = await supabase
      .from('organizations').update({ portal_join_enabled: enabled }).eq('id', orgId);
    if (error) throw new Error(error.message);
  },

  // ── Redeeming, from the /join page ─────────────────────────────────────────

  /** What to show before anyone signs in. Never throws — a bad link is content. */
  async previewInvite(token) {
    const { data, error } = await supabase.rpc('portal_invite_preview', { p_token: token });
    if (error) return { problem: 'This link is not valid.' };
    const row = Array.isArray(data) ? data[0] : data;
    return row || { problem: 'This link is not valid.' };
  },

  /** The organization's name, or null. A wrong code and a disabled one look alike. */
  async previewCode(code) {
    const { data, error } = await supabase.rpc('portal_join_preview', { p_code: code });
    if (error) return null;
    return data || null;
  },

  /** @returns the org id joined. */
  async acceptInvite(token) {
    const { data, error } = await supabase.rpc('accept_invitation', { p_token: token });
    if (error) throw new Error(humanise(error.message));
    return data;
  },

  /** @returns the org id joined. */
  async claimWithCode(code) {
    const { data, error } = await supabase.rpc('claim_portal_seat', { p_code: code });
    if (error) throw new Error(humanise(error.message));
    return data;
  },
};

// The database raises for a machine; these are the three a person actually hits.
function humanise(message) {
  const m = String(message || '');
  if (/different email address/i.test(m)) {
    return 'This invitation was sent to a different address. Sign in with the email your employer used.';
  }
  if (/already used/i.test(m)) return 'This invitation has already been used. Try signing in instead.';
  if (/expired/i.test(m)) return 'This invitation has expired. Ask for a new one.';
  return m;
}
