// Salary: what an employee is paid per month, the month a payment is for, and
// the calculation behind the Pay button. Pure, so it is tested on its own.
//
// A salary payment is an ordinary General Ledger debit (expenses): category
// `salaries` (interns: `intern_stipend`), `employee_id` the person, `amount`
// the net cash that went out, `tds_amount` what was withheld (0103), and
// `pay_period` the first day of the month it pays for (0109).

export const PAYROLL_CATEGORIES = ['salaries', 'Salaries', 'intern_stipend'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');

export const isIntern = (emp) => emp?.offerType === 'internship' || emp?.offerType === 'intern';

/** The ledger category a salary for this person is booked under. */
export const payrollCategory = (emp) => (isIntern(emp) ? 'intern_stipend' : 'salaries');

/** True once the viewer may see this person's pay (compensation is admin-only). */
export const hasSalary = (emp) => emp?.salary != null && emp.salary !== '';

/** Pay for one month. Yearly ÷ 12, Weekly × 52 ÷ 12; One-time is the amount itself. */
export function monthlySalary(emp) {
  if (!hasSalary(emp)) return null;
  if (emp.isPaid === false || emp.isPaid === 'false') return 0;
  const amount = Number(emp.salary) || 0;
  switch (emp.paymentFrequency) {
    case 'Yearly': return round2(amount / 12);
    case 'Weekly': return round2((amount * 52) / 12);
    default: return round2(amount);
  }
}

/** One person's pay revisions (0121), oldest first. */
export const revisionsOf = (revisions, employeeId) => (revisions || [])
  .filter((r) => r.employee_id === employeeId && r.effective_from)
  .sort((a, b) => String(a.effective_from).localeCompare(String(b.effective_from)));

/**
 * The revision in effect on a day ('YYYY-MM-DD'): the latest one from that day
 * or before. `list` is one person's revisions, oldest first. Null before the
 * first one.
 */
export function revisionOn(list, day) {
  let found = null;
  for (const r of list || []) {
    if (String(r.effective_from) <= day) found = r;
    else break;
  }
  return found;
}

/**
 * Pay for one month ('YYYY-MM') by their pay history: the latest revision
 * that took effect by the month's end, so the month someone joined or was
 * revised in is at the new rate. Before any revision, or with none, their pay
 * now (monthlySalary).
 */
export function salaryForMonth(emp, monthKey, list) {
  if (!hasSalary(emp) && !(list || []).length) return null;
  if (emp?.isPaid === false || emp?.isPaid === 'false') return 0;
  const r = monthKey ? revisionOn(list, `${monthKey}-${pad(daysInMonth(monthKey))}`) : null;
  return r ? monthlySalary({ ...emp, salary: r.amount }) : monthlySalary(emp);
}

/** Every month from the one they joined in to this one, newest first ('YYYY-MM'). */
export function monthsSince(startDate, today = new Date(), fallback = 12) {
  const now = monthKeyOf(today);
  const from = startDate ? monthKeyOf(startDate) : null;
  const out = [];
  let [y, m] = now.split('-').map(Number);
  for (let i = 0; i < 600; i += 1) {
    const k = `${y}-${pad(m)}`;
    if (from ? k < from : i >= fallback) break;
    out.push(k);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out.length ? out : [now];
}

/** 'YYYY-MM' of a date (string or Date). */
export function monthKeyOf(d = new Date()) {
  if (typeof d === 'string') return d.slice(0, 7);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** The value stored in expenses.pay_period: the month's first day. */
export const payPeriodOf = (monthKey) => `${monthKey}-01`;

export function daysInMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthName(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const dayNum = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;

/**
 * Approved leave of an unpaid type that falls in the month. A request that
 * runs across months counts its share: its days × the part of its span that
 * lies in this month. Rounded to the half day.
 */
export function unpaidLeaveDays(requests, types, monthKey) {
  const unpaid = new Set((types || []).filter((ty) => ty.is_paid === false).map((ty) => ty.id));
  const first = dayNum(`${monthKey}-01`);
  const last = first + daysInMonth(monthKey) - 1;
  let total = 0;
  for (const r of requests || []) {
    if (r.status !== 'approved' || !unpaid.has(r.leave_type_id) || !r.start_date || !r.end_date) continue;
    const s = dayNum(r.start_date);
    const e = dayNum(r.end_date);
    const overlap = Math.min(e, last) - Math.max(s, first) + 1;
    if (overlap <= 0) continue;
    const span = e - s + 1;
    total += (Number(r.days) || 0) * (overlap / span);
  }
  return Math.round(total * 2) / 2;
}

/**
 * The payslip sum. Unpaid leave is charged at the calendar-day rate
 * (monthly ÷ days in the month). Net is the cash that goes out; never below 0.
 */
export function salaryBreakdown({ gross, monthKey, lopDays = 0, bonus = 0, deduction = 0, tds = 0 }) {
  const g = round2(gross);
  const dailyRate = monthKey ? round2(g / daysInMonth(monthKey)) : 0;
  const lop = round2(Math.min(g, dailyRate * (Number(lopDays) || 0)));
  const b = round2(bonus);
  const d = round2(deduction);
  const t = round2(tds);
  const net = round2(Math.max(0, g - lop + b - d - t));
  return { gross: g, dailyRate, lop, bonus: b, deduction: d, tds: t, net };
}

/** The month a ledger entry pays salary for: pay_period, else the month it was paid in. */
export const entryPayMonth = (e) => monthKeyOf(e.pay_period || e.incurred_on || e.date || '');

/** Salary entries per employee for one month: { [employeeId]: entry[] }. */
export function salaryPaidIn(expenses, monthKey) {
  const out = {};
  for (const e of expenses || []) {
    if (!e.employee_id || !PAYROLL_CATEGORIES.includes(e.category)) continue;
    if (entryPayMonth(e) !== monthKey) continue;
    (out[e.employee_id] ||= []).push(e);
  }
  return out;
}
