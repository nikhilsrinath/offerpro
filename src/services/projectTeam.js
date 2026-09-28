// projectTeam.js — the rules behind a project's Team Management pages that
// are worth testing on their own: who counts as on the team, what makes a
// RACI row valid, and what one person's day on the attendance grid shows.
//
// Nothing here reads or writes the database; the pages pass rows in.

import { memberActive } from './projectAnalytics';
import { ATTENDANCE_STATUSES } from './attendanceService';

// ─── Team ────────────────────────────────────────────────────────────────────

/** Local YYYY-MM-DD. */
export function isoDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * One person per employee on the project, from their memberships: the one
 * live today if there is one, else the latest. `status` is 'active' (live
 * today, not ending), 'leaving' (live today, with an end date), 'upcoming'
 * (starts later) or 'inactive' (ended).
 */
export function projectPeople(members, projectId, empById, today = isoDay()) {
  const byEmp = new Map();
  for (const m of members) {
    if (m.project_id !== projectId) continue;
    const prev = byEmp.get(m.employee_id);
    const live = memberActive(m, today);
    const better = !prev
      || (live && !prev.live)
      || (live === prev.live && String(m.start_date) > String(prev.membership.start_date));
    if (better) byEmp.set(m.employee_id, { membership: m, live });
  }
  return [...byEmp.values()].map(({ membership: m, live }) => {
    const status = live
      ? (m.end_date ? 'leaving' : 'active')
      : (m.start_date && String(m.start_date).slice(0, 10) > today ? 'upcoming' : 'inactive');
    const emp = empById.get(m.employee_id) || null;
    return {
      id: m.employee_id, membership: m, employee: emp, status,
      name: emp?.name || emp?.full_name || 'Former employee',
      email: emp?.email || '', designation: emp?.role || '', department: emp?.department || '',
      added: m.start_date,
    };
  });
}

export const PERSON_STATUS = {
  active: { label: 'Active', tone: 'up' },
  leaving: { label: 'Leaving', tone: 'neutral' },
  upcoming: { label: 'Starts later', tone: 'neutral' },
  inactive: { label: 'Inactive', tone: 'mute' },
};
export const isCurrent = (p) => p.status === 'active' || p.status === 'leaving';

// ─── RACI ────────────────────────────────────────────────────────────────────

export const RACI_ROLES = [
  { id: 'R', label: 'Responsible', color: '#3b82f6', desc: 'Does the work. At least one per row.' },
  { id: 'A', label: 'Accountable', color: '#8b5cf6', desc: 'Owns the outcome and signs it off. Exactly one per row.' },
  { id: 'C', label: 'Consulted', color: '#f59e0b', desc: 'Asked for input before the work is done — two-way.' },
  { id: 'I', label: 'Informed', color: '#14b8a6', desc: 'Kept up to date on progress — one-way.' },
];
export const RACI_BY_ID = Object.fromEntries(RACI_ROLES.map((r) => [r.id, r]));

export const RACI_KINDS = [
  { id: 'task', label: 'Task' },
  { id: 'deliverable', label: 'Deliverable' },
  { id: 'milestone', label: 'Milestone' },
];

/**
 * What is wrong with one row, given its letters (an array of 'R'|'A'|'C'|'I').
 * Empty when the row has exactly one A and at least one R.
 */
export function raciProblems(letters) {
  const a = letters.filter((x) => x === 'A').length;
  const r = letters.filter((x) => x === 'R').length;
  const out = [];
  if (a === 0) out.push('No one is Accountable');
  if (a > 1) out.push(`${a} people are Accountable — keep one`);
  if (r === 0) out.push('No one is Responsible');
  return out;
}

/** Map item_id → Map(employee_id → assignment). */
export function raciCells(assignments) {
  const cells = new Map();
  for (const a of assignments) {
    if (!cells.has(a.item_id)) cells.set(a.item_id, new Map());
    cells.get(a.item_id).set(a.employee_id, a);
  }
  return cells;
}

/** The matrix as rows of plain values, for CSV and Excel. */
export function raciTable(items, people, cells) {
  const header = ['Row', 'Type', ...people.map((p) => p.name), 'Check'];
  const rows = items.map((it) => {
    const row = cells.get(it.id) || new Map();
    const letters = people.map((p) => row.get(p.id)?.role || '');
    const problems = raciProblems([...row.values()].map((x) => x.role));
    return [it.title, RACI_KINDS.find((k) => k.id === it.kind)?.label || it.kind, ...letters, problems.join('; ') || 'OK'];
  });
  return { header, rows };
}

/**
 * The reporting structure among the project's people: each person sits under
 * the nearest manager up their reports_to chain who is also on the project.
 * Returns the roots, each { person, children }.
 */
export function reportingTree(people, empById) {
  const onTeam = new Set(people.map((p) => p.id));
  const parent = new Map();
  for (const p of people) {
    let up = empById.get(p.id)?.reports_to || null;
    const seen = new Set([p.id]);
    while (up && !onTeam.has(up) && !seen.has(up)) {
      seen.add(up);
      up = empById.get(up)?.reports_to || null;
    }
    parent.set(p.id, up && onTeam.has(up) && up !== p.id ? up : null);
  }
  // A reporting loop (x → y → x) would make a tree with no top. Walk up from
  // each person, in name order; one who comes back round to themselves
  // becomes a top instead, which breaks the loop for everyone in it.
  const ordered = [...people].sort((a, b) => a.name.localeCompare(b.name));
  for (const p of ordered) {
    const seen = new Set([p.id]);
    for (let up = parent.get(p.id); up; up = parent.get(up)) {
      if (up === p.id || seen.has(up)) {
        if (up === p.id) parent.set(p.id, null);
        break;
      }
      seen.add(up);
    }
  }
  const nodes = new Map(people.map((p) => [p.id, { person: p, children: [] }]));
  const roots = [];
  for (const p of people) {
    const up = parent.get(p.id);
    if (up) nodes.get(up).children.push(nodes.get(p.id));
    else roots.push(nodes.get(p.id));
  }
  const byName = (a, b) => a.person.name.localeCompare(b.person.name);
  const sortDeep = (list) => { list.sort(byName); list.forEach((n) => sortDeep(n.children)); };
  sortDeep(roots);
  return roots;
}

// ─── Attendance ──────────────────────────────────────────────────────────────

// The letter each status shows in a grid cell, so the grid reads without colour.
const SHORT = { present: 'P', remote: 'R', half_day: 'H', leave: 'L', absent: 'A', holiday: 'Ho' };

export const DAY_STATUSES = [
  ...ATTENDANCE_STATUSES.map((s) => ({ ...s, short: SHORT[s.key] || s.label[0] })),
  { key: 'weekend', label: 'Weekend', color: '#64748b', short: 'W' },
];
export const DAY_BY_KEY = Object.fromEntries(DAY_STATUSES.map((s) => [s.key, s]));

/** Every YYYY-MM-DD from `from` to `to`, inclusive. */
export function daysBetween(from, to, cap = 93) {
  if (!from || !to || to < from) return [];
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < cap) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export const isWeekend = (day) => {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
};

/**
 * What one person's day shows. A marked day wins; an approved leave covering
 * an unmarked day shows as leave (half day when it was one); an unmarked
 * Saturday or Sunday is a weekend; anything else is unmarked (null).
 *
 * @param row      their attendance_days row for the day, or undefined
 * @param leaves   their approved leave requests
 * @returns {{ key, leaveType?, marked } | null}
 */
export function dayCell(day, row, leaves) {
  const leave = leaves.find((l) => l.start_date <= day && l.end_date >= day);
  if (row) {
    return {
      key: row.status, marked: true, row,
      leaveType: row.status === 'leave' || row.status === 'half_day' ? leave?.leave_type_id || null : null,
    };
  }
  if (leave) return { key: leave.half_day ? 'half_day' : 'leave', marked: false, leaveType: leave.leave_type_id };
  if (isWeekend(day)) return { key: 'weekend', marked: false };
  return null;
}

/**
 * One person's totals over the days shown. Leave counts approved leave on
 * working days (a half day as 0.5) whether or not the sheet was marked.
 */
export function summarisePerson(cells) {
  const out = { present: 0, absent: 0, leave: 0, unmarked: 0, workdays: 0 };
  for (const { day, cell } of cells) {
    if (cell?.key === 'weekend' || cell?.key === 'holiday') continue;
    if (!cell && isWeekend(day)) continue;
    out.workdays += 1;
    if (!cell) { out.unmarked += 1; continue; }
    if (cell.key === 'present' || cell.key === 'remote') out.present += 1;
    else if (cell.key === 'half_day') { out.present += 0.5; out.leave += 0.5; }
    else if (cell.key === 'leave') out.leave += 1;
    else if (cell.key === 'absent') out.absent += 1;
  }
  return out;
}
