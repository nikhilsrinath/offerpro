import { describe, it, expect } from 'vitest';
import {
  monthlySalary, unpaidLeaveDays, salaryBreakdown, salaryPaidIn, payrollCategory, daysInMonth, monthName,
  revisionsOf, revisionOn, salaryForMonth, monthsSince,
} from './payroll.js';

describe('monthlySalary', () => {
  it('converts frequencies to a month', () => {
    expect(monthlySalary({ salary: 45000, paymentFrequency: 'Monthly' })).toBe(45000);
    expect(monthlySalary({ salary: 600000, paymentFrequency: 'Yearly' })).toBe(50000);
    expect(monthlySalary({ salary: 1000, paymentFrequency: 'Weekly' })).toBe(4333.33);
    expect(monthlySalary({ salary: 9000, paymentFrequency: 'One-time' })).toBe(9000);
  });
  it('is null when pay is hidden and 0 when unpaid', () => {
    expect(monthlySalary({})).toBeNull();
    expect(monthlySalary({ salary: 100, isPaid: false })).toBe(0);
  });
});

describe('unpaidLeaveDays', () => {
  const types = [{ id: 'lop', is_paid: false }, { id: 'cl', is_paid: true }];
  it('counts only approved unpaid leave in the month', () => {
    const reqs = [
      { status: 'approved', leave_type_id: 'lop', start_date: '2026-11-03', end_date: '2026-11-04', days: 2 },
      { status: 'approved', leave_type_id: 'cl', start_date: '2026-11-05', end_date: '2026-11-05', days: 1 },
      { status: 'pending', leave_type_id: 'lop', start_date: '2026-11-10', end_date: '2026-11-10', days: 1 },
      { status: 'approved', leave_type_id: 'lop', start_date: '2026-11-12', end_date: '2026-11-12', days: 0.5 },
    ];
    expect(unpaidLeaveDays(reqs, types, '2026-11')).toBe(2.5);
  });
  it('splits a request that crosses months', () => {
    const reqs = [{ status: 'approved', leave_type_id: 'lop', start_date: '2026-10-30', end_date: '2026-11-02', days: 4 }];
    expect(unpaidLeaveDays(reqs, types, '2026-10')).toBe(2);
    expect(unpaidLeaveDays(reqs, types, '2026-11')).toBe(2);
  });
});

describe('salaryBreakdown', () => {
  it('nets gross, unpaid leave, bonus, deduction and TDS', () => {
    const b = salaryBreakdown({ gross: 30000, monthKey: '2026-11', lopDays: 2, bonus: 1000, deduction: 500, tds: 3000 });
    expect(b.dailyRate).toBe(1000);
    expect(b.lop).toBe(2000);
    expect(b.net).toBe(25500);
  });
  it('never goes below zero', () => {
    expect(salaryBreakdown({ gross: 1000, monthKey: '2026-11', tds: 5000 }).net).toBe(0);
  });
});

describe('salaryPaidIn', () => {
  it('groups salary entries by employee for the month, by pay_period first', () => {
    const list = [
      { employee_id: 'a', category: 'salaries', pay_period: '2026-10-01', incurred_on: '2026-11-02' },
      { employee_id: 'a', category: 'salaries', incurred_on: '2026-11-05' },
      { employee_id: 'b', category: 'rent', incurred_on: '2026-11-05' },
      { employee_id: 'c', category: 'intern_stipend', incurred_on: '2026-11-30' },
    ];
    const m = salaryPaidIn(list, '2026-11');
    expect(Object.keys(m).sort()).toEqual(['a', 'c']);
    expect(m.a).toHaveLength(1);
  });
});

it('helpers', () => {
  expect(payrollCategory({ offerType: 'internship' })).toBe('intern_stipend');
  expect(payrollCategory({ offerType: 'fulltime' })).toBe('salaries');
  expect(daysInMonth('2026-02')).toBe(28);
  expect(monthName('2026-11')).toMatch(/November 2026/);
});

describe('pay history (0121)', () => {
  // Pinto: joined 20 Dec 2023 at 15,000, revised up, then down, then up.
  const all = [
    { employee_id: 'p', effective_from: '2024-07-01', amount: 18000 },
    { employee_id: 'p', effective_from: '2023-12-20', amount: 15000 },
    { employee_id: 'p', effective_from: '2025-02-01', amount: 16000 },
    { employee_id: 'x', effective_from: '2020-01-01', amount: 99999 },
  ];
  const emp = { id: 'p', salary: 16000, paymentFrequency: 'Monthly' };
  const list = revisionsOf(all, 'p');

  it('keeps one person, oldest first', () => {
    expect(list.map((r) => r.amount)).toEqual([15000, 18000, 16000]);
  });
  it('finds the revision in effect on a day', () => {
    expect(revisionOn(list, '2023-12-19')).toBeNull();
    expect(revisionOn(list, '2023-12-20').amount).toBe(15000);
    expect(revisionOn(list, '2024-06-30').amount).toBe(15000);
    expect(revisionOn(list, '2024-07-01').amount).toBe(18000);
    expect(revisionOn(list, '2026-11-28').amount).toBe(16000);
  });
  it('pays a month at the rate in effect by its end', () => {
    expect(salaryForMonth(emp, '2023-12', list)).toBe(15000);
    expect(salaryForMonth(emp, '2024-06', list)).toBe(15000);
    expect(salaryForMonth(emp, '2024-07', list)).toBe(18000);
    expect(salaryForMonth(emp, '2025-03', list)).toBe(16000);
  });
  it('falls back to the pay now without history, and before it', () => {
    expect(salaryForMonth(emp, '2024-07', [])).toBe(16000);
    expect(salaryForMonth(emp, '2023-11', list)).toBe(16000);
    expect(salaryForMonth({ ...emp, isPaid: false }, '2024-07', list)).toBe(0);
    expect(salaryForMonth({ ...emp, salary: 120000, paymentFrequency: 'Yearly' }, '2024-07', [{ ...list[1], amount: 240000 }])).toBe(20000);
  });
  it('lists the months from joining to now', () => {
    const months = monthsSince('2023-12-20', new Date(2026, 10, 28));
    expect(months[0]).toBe('2026-11');
    expect(months[months.length - 1]).toBe('2023-12');
    expect(months).toHaveLength(36);
    expect(monthsSince(null, new Date(2026, 10, 28))).toHaveLength(12);
    expect(monthsSince('2027-01-01', new Date(2026, 10, 28))).toEqual(['2026-11']);
  });
});
