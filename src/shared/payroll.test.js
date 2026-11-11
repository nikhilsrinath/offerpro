import { describe, it, expect } from 'vitest';
import {
  monthlySalary, unpaidLeaveDays, salaryBreakdown, salaryPaidIn, payrollCategory, daysInMonth, monthName,
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
