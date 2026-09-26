import { supabase } from '../lib/supabase';

/**
 * Roles and the per-organization permission matrix (0026/0027).
 *
 * The database is the authority: RLS reads role_permissions on every request,
 * and the non-negotiable guards (owner row fixed, only owner/admin grant
 * owner/admin, pay and banking owner/admin-only) are enforced there. This file
 * only reads and writes rows; a refused write comes back as an error to show.
 */

export const ACTIONS = ['view', 'create', 'edit', 'delete'];

/** Roles, resources and this org's matrix, in one round trip each. */
export async function loadPermissionMatrix(orgId) {
  const [roles, resources, matrix] = await Promise.all([
    supabase.from('roles').select('key, label, description, sort_order').order('sort_order'),
    supabase.from('permission_resources').select('key, label, category, description, actions, sort_order').order('sort_order'),
    supabase.from('role_permissions')
      .select('role, resource, can_view, can_create, can_edit, can_delete')
      .eq('org_id', orgId),
  ]);
  for (const r of [roles, resources, matrix]) if (r.error) throw r.error;

  const byKey = {};
  for (const row of matrix.data) byKey[`${row.role}:${row.resource}`] = row;
  return { roles: roles.data, resources: resources.data, matrix: byKey };
}

/**
 * Sets all four flags of one role's row in one statement, so the database only
 * ever validates the final, coherent state. Returns the updated row, or throws
 * with the database's reason.
 */
export async function setRolePermissions(orgId, role, resource, flags) {
  const { data, error } = await supabase
    .from('role_permissions')
    .update(toColumns(flags))
    .eq('org_id', orgId).eq('role', role).eq('resource', resource)
    .select('role, resource, can_view, can_create, can_edit, can_delete')
    .maybeSingle();
  if (error) throw error;
  // RLS filtered the row out: the caller may not edit the matrix.
  if (!data) throw new Error('You do not have permission to change this.');
  return data;
}

/* ── Per-person exceptions (0062) ─────────────────────────────────────────────
   A member_permissions row replaces the role's row for one resource, for one
   person. No row: they have exactly what their role has. */

const FLAG_COLS = 'resource, can_view, can_create, can_edit, can_delete';
const toColumns = (f) => ({ can_view: !!f.view, can_create: !!f.create, can_edit: !!f.edit, can_delete: !!f.delete });
export const toFlags = (row) => ({
  view: !!row?.can_view, create: !!row?.can_create, edit: !!row?.can_edit, delete: !!row?.can_delete,
});
export const sameFlags = (a, b) => ACTIONS.every((x) => !!a?.[x] === !!b?.[x]);

/**
 * The flags after flipping one action, kept coherent with the database's rule
 * that nothing is created, edited or deleted without being viewable.
 */
export function nextFlags(flags, resource, action, value) {
  const next = { ...flags, [action]: value };
  const hasView = resource.actions.includes('view');
  if (hasView && action === 'view' && !value) { next.create = false; next.edit = false; next.delete = false; }
  if (hasView && action !== 'view' && value) next.view = true;
  for (const a of ACTIONS) if (!resource.actions.includes(a)) next[a] = false;
  return next;
}

/** One person's exceptions, keyed by resource — or null when this database
    predates 0062 and cannot hold any. */
export async function loadMemberOverrides(membershipId) {
  const { data, error } = await supabase
    .from('member_permissions').select(FLAG_COLS).eq('membership_id', membershipId);
  if (error && (error.code === 'PGRST205' || error.code === '42P01')) return null;
  if (error) throw error;
  const out = {};
  for (const row of data || []) out[row.resource] = row;
  return out;
}

/** Writes one exception. Update first: the grant allows changing flags only,
    which an upsert (it rewrites every column it names) would trip over. */
export async function setMemberOverride(orgId, membershipId, resource, flags) {
  const cols = toColumns(flags);
  const upd = await supabase.from('member_permissions').update(cols)
    .eq('membership_id', membershipId).eq('resource', resource).select(FLAG_COLS).maybeSingle();
  if (upd.error) throw upd.error;
  if (upd.data) return upd.data;
  const ins = await supabase.from('member_permissions')
    .insert({ org_id: orgId, membership_id: membershipId, resource, ...cols }).select(FLAG_COLS).maybeSingle();
  if (ins.error) throw ins.error;
  if (!ins.data) throw new Error('You do not have permission to change this.');
  return ins.data;
}

/** Removes one exception, or all of a person's when `resource` is omitted. */
export async function clearMemberOverride(membershipId, resource) {
  let q = supabase.from('member_permissions').delete().eq('membership_id', membershipId);
  if (resource) q = q.eq('resource', resource);
  const { error } = await q;
  if (error) throw error;
}

/**
 * The caller's effective permissions — role plus their own exceptions — as
 * { resource: { view, create, edit, delete } }. Falls back to the role alone
 * where 0062 has not been applied yet, so a lagging database shows what it
 * still enforces instead of nothing.
 */
export async function loadMyPermissions(orgId, role) {
  const { data, error } = await supabase.rpc('my_permissions', { p_org: orgId });
  let rows = data;
  if (error) {
    if (!role) return {};
    const fb = await supabase.from('role_permissions').select(FLAG_COLS).eq('org_id', orgId).eq('role', role);
    if (fb.error) return {};
    rows = fb.data;
  }
  const perms = {};
  for (const r of rows || []) perms[r.resource] = toFlags(r);
  return perms;
}

/** The caller's own membership in the org (always visible to them). */
export async function getMyMembership(orgId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('memberships').select('id, role')
    .eq('org_id', orgId).eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  return data;
}

/** Members with their sign-in email (public.org_members). */
export async function listMembers(orgId) {
  const { data, error } = await supabase.rpc('org_members', { p_org: orgId });
  if (error) throw error;
  return data || [];
}

export async function setMemberRole(membershipId, role) {
  const { data, error } = await supabase
    .from('memberships').update({ role }).eq('id', membershipId).select('id, role').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('You do not have permission to change roles.');
  return data;
}

export async function listRoles() {
  const { data, error } = await supabase.from('roles').select('key, label, description').order('sort_order');
  if (error) throw error;
  return data || [];
}
