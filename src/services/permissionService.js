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

/** Flips one flag. Returns the updated row, or throws with the database's reason. */
export async function setPermission(orgId, role, resource, action, value) {
  const { data, error } = await supabase
    .from('role_permissions')
    .update({ [`can_${action}`]: value })
    .eq('org_id', orgId).eq('role', role).eq('resource', resource)
    .select('role, resource, can_view, can_create, can_edit, can_delete')
    .maybeSingle();
  if (error) throw error;
  // RLS filtered the row out: the caller may not edit the matrix.
  if (!data) throw new Error('You do not have permission to change this.');
  return data;
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
