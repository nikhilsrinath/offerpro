/**
 * Employee AI Engine
 * Handles conversational create / edit / role-change / terminate flows
 * via the AI Co-founder panel — no AI tokens needed per step.
 */

// @ts-ignore
import { storageService } from './storageService';
import { orgStore } from './orgStore';

// ── Types ─────────────────────────────────────────────────────────────────────

export type EmployeeOpType = 'create' | 'edit' | 'roleChange' | 'terminate';

export interface EmployeeOperation {
  type: EmployeeOpType;
  step: number;          // index into getSteps(type)
  data: Record<string, string>;
  matchedEmployee?: any; // set for edit / roleChange / terminate
}

// ── Intent detection ──────────────────────────────────────────────────────────

export function detectEmployeeCreateIntent(message: string): boolean {
  const m = message.toLowerCase();
  return (
    (/\b(add|create|hire|onboard|new)\b/.test(m) &&
     /\b(employee|hire|staff|team\s+member|person|recruit)\b/.test(m)) ||
    /\bonboard\s+someone\b/.test(m) ||
    /\badd\s+someone\s+to\s+(the\s+)?team\b/.test(m)
  );
}

export function detectEmployeeEditIntent(message: string): boolean {
  const m = message.toLowerCase();
  return /\b(edit|update|change|modify|correct)\b.{0,30}(employee|staff)\b/.test(m) ||
    /\b(employee|staff).{0,30}(edit|update|change|modify)\b/.test(m);
}

export function detectRoleChangeIntent(message: string): boolean {
  const m = message.toLowerCase();
  return (
    /\b(promote|role\s*change|change\s*(the\s+)?role|new\s+role|transfer|move)\b/.test(m) ||
    /\b(change|update)\b.{0,15}\b(position|designation|title)\b/.test(m)
  ) && !detectEmployeeCreateIntent(m);
}

export function detectTerminateIntent(message: string): boolean {
  const m = message.toLowerCase();
  return /\b(terminate|fire|let\s+go|dismiss|offboard|end\s+employment|remove\s+(from\s+(the\s+)?team)?)\b/.test(m);
}

// ── Steps ─────────────────────────────────────────────────────────────────────

function getSteps(type: EmployeeOpType): string[] {
  switch (type) {
    case 'create':     return ['name', 'email', 'phone', 'role', 'department', 'empType', 'startDate', 'salary', 'confirm'];
    case 'edit':       return ['field', 'value', 'confirm'];
    case 'roleChange': return ['newRole', 'newDepartment', 'effectiveDate', 'confirm'];
    case 'terminate':  return ['lastDay', 'confirm'];
  }
}

// ── Prompt builder ────────────────────────────────────────────────────────────

export function getStepPrompt(op: EmployeeOperation): string {
  const steps = getSteps(op.type);
  const current = steps[op.step];
  const d = op.data;
  const firstName = d.name?.split(' ')[0] || 'them';

  if (op.type === 'create') {
    const map: Record<string, string> = {
      name:       'What is the employee\'s full name?',
      email:      `Got it! What is ${firstName}'s email address?`,
      phone:      `What is ${firstName}'s phone number?`,
      role:       `What role or position will ${firstName} hold?`,
      department: `Which department will ${firstName} be in? (e.g. Engineering, Sales, Marketing, Operations, HR)`,
      empType:    `Is this a Full-time position or an Internship?\n\n1. Full-time\n2. Internship`,
      startDate:  `What is ${firstName}'s start date? (e.g. 2026-05-01)`,
      salary:     `What is their salary or stipend? (e.g. ₹50,000 per month or ₹6,00,000 annual)`,
      confirm:    buildConfirmPrompt(d),
    };
    return map[current] ?? 'Please provide the next detail.';
  }

  if (op.type === 'edit') {
    const empName = getEmpName(op.matchedEmployee) || 'the employee';
    const map: Record<string, string> = {
      field:   `What would you like to update for ${empName}?\n\nOptions: name, email, phone, role, department, salary`,
      value:   `What is the new ${d.field} for ${empName}?`,
      confirm: `Update ${empName}'s ${d.field} to "${d.value}"?\n\n(yes / no)`,
    };
    return map[current] ?? 'Please provide the detail.';
  }

  if (op.type === 'roleChange') {
    const empName = getEmpName(op.matchedEmployee) || 'the employee';
    const currentDept = op.matchedEmployee?.department || 'their current department';
    const map: Record<string, string> = {
      newRole:       `What is ${empName}'s new role or title?`,
      newDepartment: `Which department? (press Enter or type "same" to keep: ${currentDept})`,
      effectiveDate: `What is the effective date of this change? (e.g. 2026-05-01)`,
      confirm:       `Change ${empName}'s role to **${d.newRole}** in **${d.newDepartment || currentDept}**, effective ${d.effectiveDate}?\n\n(yes / no)`,
    };
    return map[current] ?? 'Please provide the detail.';
  }

  if (op.type === 'terminate') {
    const empName = getEmpName(op.matchedEmployee) || 'the employee';
    const map: Record<string, string> = {
      lastDay: `What is ${empName}'s last working day? (e.g. 2026-04-30)`,
      confirm: `Terminate ${empName} with last day as **${d.lastDay}**?\n\nThey will be archived to Ex-Employees. (yes / no)`,
    };
    return map[current] ?? 'Please provide the detail.';
  }

  return 'Please provide the required information.';
}

function buildConfirmPrompt(d: Record<string, string>): string {
  return `Here's a summary of the new employee:\n\n• Name: ${d.name}\n• Email: ${d.email}\n• Phone: ${d.phone}\n• Role: ${d.role}\n• Department: ${d.department}\n• Type: ${d.empType === 'intern' ? 'Internship' : 'Full-time'}\n• Start Date: ${d.startDate}\n• Salary: ${d.salary}\n\nShall I add them to the team? (yes / no)`;
}

// ── Input processing ──────────────────────────────────────────────────────────

export interface ProcessResult {
  op: EmployeeOperation;
  done: boolean;
  confirmed: boolean;
  cancelled: boolean;
}

export function processEmployeeInput(op: EmployeeOperation, userInput: string): ProcessResult {
  const steps = getSteps(op.type);
  const current = steps[op.step];
  const raw = userInput.trim();

  if (/^(cancel|stop|abort|never\s*mind|quit|exit)\b/i.test(raw)) {
    return { op, done: true, confirmed: false, cancelled: true };
  }

  if (current === 'confirm') {
    const yes = /^(yes|y|yep|yeah|confirm|ok|okay|sure|do it|go|proceed|add|create)\b/i.test(raw);
    const no  = /^(no|n|nope|dont|don't|cancel|stop)\b/i.test(raw);
    if (yes) return { op: { ...op, step: op.step + 1 }, done: true, confirmed: true, cancelled: false };
    if (no)  return { op, done: true, confirmed: false, cancelled: true };
    // unclear — stay and re-ask
    return { op, done: false, confirmed: false, cancelled: false };
  }

  const newData = { ...op.data };

  if (op.type === 'create') {
    switch (current) {
      case 'name':       newData.name = raw; break;
      case 'email':      newData.email = raw.toLowerCase(); break;
      case 'phone':      newData.phone = raw; break;
      case 'role':       newData.role = raw; break;
      case 'department': newData.department = raw; break;
      case 'empType':
        newData.empType = /intern|internship|2/i.test(raw) ? 'intern' : 'fulltime';
        break;
      case 'startDate':  newData.startDate = parseDate(raw); break;
      case 'salary': {
        const { amount, frequency } = parseSalary(raw);
        newData.salary = raw;
        newData.salaryAmount = amount;
        newData.salaryFrequency = frequency;
        break;
      }
    }
  }

  if (op.type === 'edit') {
    switch (current) {
      case 'field': newData.field = raw.toLowerCase(); break;
      case 'value': newData.value = raw; break;
    }
  }

  if (op.type === 'roleChange') {
    switch (current) {
      case 'newRole': newData.newRole = raw; break;
      case 'newDepartment':
        newData.newDepartment = /^(same|enter|-|\.)\s*$/i.test(raw) ? (op.matchedEmployee?.department || '') : raw;
        break;
      case 'effectiveDate': newData.effectiveDate = parseDate(raw); break;
    }
  }

  if (op.type === 'terminate') {
    if (current === 'lastDay') newData.lastDay = parseDate(raw);
  }

  return {
    op: { ...op, step: op.step + 1, data: newData },
    done: false, confirmed: false, cancelled: false,
  };
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function executeEmployeeOperation(
  op: EmployeeOperation,
  orgId: string,
  activeOrg: any,
): Promise<{ success: boolean; message: string; employee?: any }> {
  try {
    if (op.type === 'create') {
      const d = op.data;
      const empData = {
        studentName: d.name,
        email: d.email,
        phone: d.phone,
        role: d.role,
        department: d.department,
        offerType: d.empType || 'fulltime',
        startDate: d.startDate,
        stipend: d.salaryAmount || d.salary || '',
        currency: 'INR',
        paymentFrequency: d.salaryFrequency || 'Monthly',
        status: 'active',
        companyName: activeOrg?.company_name || '',
        authorizedPersonName: activeOrg?.owner_full_name || '',
      };
      const employee = await storageService.saveEmployee(empData, orgId);
      return {
        success: true,
        message: `✓ ${d.name} added to the team as ${d.role} in ${d.department}${d.startDate ? `, starting ${d.startDate}` : ''}.`,
        employee,
      };
    }

    if (op.type === 'edit' && op.matchedEmployee) {
      const fieldMap: Record<string, string> = {
        name: 'studentName', email: 'email', phone: 'phone',
        role: 'role', department: 'department', salary: 'stipend',
      };
      const dbField = fieldMap[op.data.field] || op.data.field;
      await storageService.updateEmployee(op.matchedEmployee.id, { [dbField]: op.data.value }, orgId);
      return {
        success: true,
        message: `✓ Updated ${getEmpName(op.matchedEmployee)}'s ${op.data.field} to "${op.data.value}".`,
      };
    }

    if (op.type === 'roleChange' && op.matchedEmployee) {
      const updates: Record<string, string> = {
        role: op.data.newRole,
        department: op.data.newDepartment || op.matchedEmployee.department,
        roleChangeDate: op.data.effectiveDate,
      };
      await storageService.updateEmployee(op.matchedEmployee.id, updates, orgId);
      return {
        success: true,
        message: `✓ ${getEmpName(op.matchedEmployee)}'s role changed to **${updates.role}** in ${updates.department}, effective ${updates.roleChangeDate}.`,
      };
    }

    if (op.type === 'terminate' && op.matchedEmployee) {
      await storageService.updateEmployee(op.matchedEmployee.id, {
        status: 'terminated',
        termination_date: op.data.lastDay,
      }, orgId);
      return {
        success: true,
        message: `✓ ${getEmpName(op.matchedEmployee)} has been marked as terminated (last day: ${op.data.lastDay}). They'll be archived to Ex-Employees automatically.`,
      };
    }

    return { success: false, message: 'Operation could not be completed.' };
  } catch (err) {
    return { success: false, message: `Error: ${(err as Error).message}` };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getEmpName(emp: any): string {
  if (!emp) return '';
  return emp.studentName || emp.name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || '';
}

function parseDate(input: string): string {
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  // "1st May 2026" or "May 1, 2026"
  const m1 = trimmed.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})/i);
  const m2 = trimmed.match(/([a-z]+)\s+(\d{1,2})[,]?\s+(\d{4})/i);
  if (m1) {
    const mo = monthMap[m1[2].toLowerCase().slice(0, 3)];
    if (mo) return `${m1[3]}-${mo}-${m1[1].padStart(2, '0')}`;
  }
  if (m2) {
    const mo = monthMap[m2[1].toLowerCase().slice(0, 3)];
    if (mo) return `${m2[3]}-${mo}-${m2[2].padStart(2, '0')}`;
  }
  return trimmed;
}

function parseSalary(input: string): { amount: string; frequency: string } {
  const digits = input.replace(/[₹,\s]/g, '').match(/[\d.]+/)?.[0] || '';
  const frequency = /annual|year|pa|per\s+annum/i.test(input) ? 'Annual' : 'Monthly';
  return { amount: digits, frequency };
}
