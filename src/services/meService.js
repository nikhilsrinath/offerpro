// meService.js — "which employee am I?", and the link that makes that answerable.
//
// An employee record and a login are separate things (0029 §1): the record
// exists from the day someone is hired, the login arrives when an admin creates
// it (0031). `employees.user_id` is the join, and app.my_employee_id(org) is
// the same question asked from inside an RLS policy — so what this file returns
// and what the database will let the caller read are the same answer.

import { supabase } from '../lib/supabase';

const EMPLOYEE_SELECT = `id, org_id, full_name, email, phone, role, department_id,
                         employment_type, reports_to, supervisor_name, start_date,
                         user_id, photo_path, exited_at, access_revoked_at,
                         portal_must_change_password`;

export const meService = {
  /**
   * The caller's own employee record in this org, with the department name and
   * manager resolved. Null when they have a login but no record — an owner who
   * never added themselves, which is normal and must not throw.
   */
  async getMyEmployee(orgId) {
    if (!orgId) return null;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('employees').select(EMPLOYEE_SELECT)
      .eq('org_id', orgId).eq('user_id', user.id).is('exited_at', null)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const [dept, manager] = await Promise.all([
      data.department_id
        ? supabase.from('departments').select('id, name').eq('id', data.department_id).maybeSingle()
        : Promise.resolve({ data: null }),
      data.reports_to
        ? supabase.from('employees').select('id, full_name, email').eq('id', data.reports_to).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    return {
      ...data,
      department_name: dept.data?.name || '',
      manager: manager.data || null,
    };
  },

  /**
   * Changes the caller's own password and clears the "you are still using the
   * one your admin generated" flag. Two calls, in this order: if the flag were
   * cleared first and the password change then failed, the nag would be gone
   * while the generated password was still live.
   */
  async changeMyPassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
    await supabase.rpc('clear_password_change_flag');
  },

  /** The caller's role in this org — 'employee' is what routes them to /me. */
  async getMyRole(orgId) {
    if (!orgId) return null;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('memberships').select('role').eq('org_id', orgId).eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data?.role || null;
  },

  /**
   * Attaches a login to an employee record. Done by an admin from the Employees
   * screen after the person accepts their invitation — matching by email alone
   * would hand someone else's record to whoever registered that address first.
   *
   * @param userId the auth user id, taken from the member list (org_members).
   */
  async linkEmployeeToUser(employeeId, userId) {
    const { data, error } = await supabase
      .from('employees').update({ user_id: userId || null })
      .eq('id', employeeId).select('id, user_id').maybeSingle();
    if (error) {
      // The partial unique index on (org_id, user_id) is the real guard.
      if (error.code === '23505') throw new Error('That login is already linked to another employee.');
      throw error;
    }
    if (!data) throw new Error('You do not have permission to link this employee.');
    return data;
  },

  /** Employees with no login yet, for the link picker. */
  async listUnlinked(orgId) {
    const { data, error } = await supabase
      .from('employees').select('id, full_name, email, user_id')
      .eq('org_id', orgId).is('exited_at', null).order('full_name');
    if (error) throw error;
    return data || [];
  },
};
