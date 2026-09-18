// storageService.js — Thin wrapper around orgStore
// Same exported API as before. All data now under organizations/{orgId}/.
import { orgStore } from './orgStore';

export const storageService = {
  getAll: async (orgId, type) => {
    if (!orgId) return [];
    try {
      const records = orgStore.getSectionAsList('records');
      const filtered = type ? records.filter(r => r.type === type) : records;
      return filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } catch (err) {
      console.warn("Error fetching records:", err);
      return [];
    }
  },

  getRecords: async (orgId) => {
    const data = await storageService.getAll(orgId);
    return { data };
  },

  // `options` promotes the columns `records` indexes on: status (default
  // 'draft'), employee_id, and the recipient fields derived from the form.
  save: async (recordData, type, orgId, userId, options = {}) => {
    if (!orgId) throw new Error('Organization ID is required');

    const title = type === 'offer'
      ? recordData.studentName
      : type === 'certificate'
        ? recordData.recipientName
        : type === 'nda'
          ? `${recordData.disclosingPartyName || ''} & ${recordData.receivingPartyName || ''}`
          : type === 'mou'
            ? `${recordData.firstPartyName || ''} & ${recordData.secondPartyName || ''}`
            : `Inv: ${recordData.clientName} (${recordData.invoiceNumber})`;

    const record = await orgStore.addItem('records', {
      data: recordData,
      title,
      type,
      user_id: userId || null,
      ...options,
    });
    return record;
  },

  delete: async (id, orgId) => {
    if (!orgId) throw new Error('Organization ID is required');
    // Awaited so a rejected write reaches the caller. Unawaited, orgStore had
    // already updated its cache and localStorage, so a failure showed up as a
    // successful delete that came back on the next reload.
    await orgStore.removeItem('records', id);
  },

  // Employees registry
  getEmployees: async (orgId) => {
    if (!orgId) return [];
    try {
      const employees = orgStore.getSectionAsList('employees');
      return employees.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } catch (err) {
      console.warn("Error fetching employees:", err);
      return [];
    }
  },

  saveEmployee: async (empData, orgId) => {
    if (!orgId) throw new Error('Organization ID is required');
    const employee = await orgStore.addItem('employees', empData);
    return employee;
  },

  // Archives rather than deletes: the row stays so tasks and documents keep
  // their foreign key. `reason` fills employees.exit_reason, which had no
  // writer at all, so every archived employee left without a recorded reason.
  deleteEmployee: async (id, orgId, reason) => {
    if (!orgId) throw new Error('Organization ID is required');
    await orgStore.removeItem('employees', id, { reason });
  },

  updateEmployee: async (id, updates, orgId) => {
    if (!orgId) throw new Error('Organization ID is required');
    await orgStore.updateItem('employees', id, updates);
  },

  // Department master list
  getDepartments: async (orgId) => {
    if (!orgId) return [];
    try {
      const depts = orgStore.getSectionAsList('departments');
      return depts.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } catch (err) {
      console.warn('Error fetching departments:', err);
      return [];
    }
  },

  saveDepartment: async (deptData, orgId) => {
    if (!orgId) throw new Error('Organization ID is required');
    if (deptData.id) {
      await orgStore.setItem('departments', deptData.id, deptData);
      return deptData;
    }
    const dept = await orgStore.addItem('departments', deptData);
    return dept;
  },

  deleteDepartment: async (id, orgId) => {
    if (!orgId) throw new Error('Organization ID is required');
    await orgStore.removeItem('departments', id);
  },

  // Ex-employees archive
  getExEmployees: async (orgId) => {
    if (!orgId) return [];
    try {
      const list = orgStore.getSectionAsList('ex_employees');
      return list.sort((a, b) => new Date(b.terminated_at || 0) - new Date(a.terminated_at || 0));
    } catch (err) {
      console.warn('Error fetching ex-employees:', err);
      return [];
    }
  },

  saveExEmployee: async (empData, orgId) => {
    if (!orgId) throw new Error('Organization ID is required');
    await orgStore.setItem('ex_employees', empData.id, empData);
    return empData;
  },

  exportToCSV: (records) => {
    if (!records || records.length === 0) return;

    const headers = ['Type', 'Title', 'Date Created'];
    const rows = records.map(r => [
      r.type.toUpperCase(),
      r.title,
      new Date(r.created_at).toLocaleDateString()
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `business_records_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};
