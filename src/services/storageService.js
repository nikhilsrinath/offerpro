import { ref, push, set, get, remove, update, query, orderByChild, equalTo } from 'firebase/database';
import { db } from '../lib/firebase';

export const storageService = {
  getAll: async (orgId, type) => {
    if (!orgId) return [];

    try {
      const recordsRef = ref(db, `records/${orgId}`);
      const snapshot = await get(recordsRef);

      if (!snapshot.exists()) return [];

      const records = [];
      snapshot.forEach((child) => {
        // Skip internal financial document store nodes
        if (child.key.startsWith('_fin_')) return;
        const data = child.val();
        if (!type || data.type === type) {
          records.push({ id: child.key, ...data });
        }
      });

      // Sort by created_at descending
      records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return records;
    } catch (err) {
      console.warn("Error fetching records:", err);
      return [];
    }
  },

  getRecords: async (orgId) => {
    const data = await storageService.getAll(orgId);
    return { data };
  },

  save: async (recordData, type, orgId, userId) => {
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

    const recordRef = push(ref(db, `records/${orgId}`));
    const record = {
      id: recordRef.key,
      data: recordData,
      title,
      type,
      user_id: userId || null,
      created_at: new Date().toISOString()
    };

    await set(recordRef, record);
    return record;
  },

  delete: async (id, orgId) => {
    if (!orgId) throw new Error('Organization ID is required');
    const recordRef = ref(db, `records/${orgId}/${id}`);
    await remove(recordRef);
  },

  // Employees registry
  getEmployees: async (orgId) => {
    if (!orgId) return [];
    try {
      const empRef = ref(db, `employees/${orgId}`);
      const snapshot = await get(empRef);
      if (!snapshot.exists()) return [];
      const employees = [];
      snapshot.forEach((child) => {
        employees.push({ id: child.key, ...child.val() });
      });
      return employees.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } catch (err) {
      console.warn("Error fetching employees:", err);
      return [];
    }
  },

  saveEmployee: async (empData, orgId) => {
    if (!orgId) throw new Error('Organization ID is required');
    const empRef = push(ref(db, `employees/${orgId}`));
    const employee = {
      id: empRef.key,
      ...empData,
      created_at: new Date().toISOString()
    };
    await set(empRef, employee);
    return employee;
  },

  deleteEmployee: async (id, orgId) => {
    if (!orgId) throw new Error('Organization ID is required');
    const empRef = ref(db, `employees/${orgId}/${id}`);
    await remove(empRef);
  },

  // Partial-update an existing employee (e.g. sync supervisorName from hierarchy)
  updateEmployee: async (id, updates, orgId) => {
    if (!orgId) throw new Error('Organization ID is required');
    await update(ref(db, `employees/${orgId}/${id}`), updates);
  },

  // Department master list
  getDepartments: async (orgId) => {
    if (!orgId) return [];
    try {
      const snap = await get(ref(db, `departments/${orgId}`));
      if (!snap.exists()) return [];
      const depts = [];
      snap.forEach(child => depts.push({ id: child.key, ...child.val() }));
      return depts.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } catch (err) {
      console.warn('Error fetching departments:', err);
      return [];
    }
  },

  saveDepartment: async (deptData, orgId) => {
    if (!orgId) throw new Error('Organization ID is required');
    if (deptData.id) {
      await set(ref(db, `departments/${orgId}/${deptData.id}`), deptData);
      return deptData;
    }
    const deptRef = push(ref(db, `departments/${orgId}`));
    const dept = { id: deptRef.key, ...deptData };
    await set(deptRef, dept);
    return dept;
  },

  deleteDepartment: async (id, orgId) => {
    if (!orgId) throw new Error('Organization ID is required');
    await remove(ref(db, `departments/${orgId}/${id}`));
  },

  // Ex-employees archive
  getExEmployees: async (orgId) => {
    if (!orgId) return [];
    try {
      const snap = await get(ref(db, `ex_employees/${orgId}`));
      if (!snap.exists()) return [];
      const list = [];
      snap.forEach(child => list.push({ id: child.key, ...child.val() }));
      return list.sort((a, b) => new Date(b.terminated_at || 0) - new Date(a.terminated_at || 0));
    } catch (err) {
      console.warn('Error fetching ex-employees:', err);
      return [];
    }
  },

  saveExEmployee: async (empData, orgId) => {
    if (!orgId) throw new Error('Organization ID is required');
    await set(ref(db, `ex_employees/${orgId}/${empData.id}`), empData);
    return empData;
  },

  exportToCSV: (records) => {
    if (!records || records.length === 0) return;

    const headers = [
      'Type', 'Title', 'Date Created'
    ];

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
