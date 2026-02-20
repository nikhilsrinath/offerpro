const STORAGE_KEY = 'intern_records';

export const storageService = {
  getAll: () => {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  },

  save: (record) => {
    const records = storageService.getAll();
    const newRecord = {
      ...record,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    records.unshift(newRecord);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    return newRecord;
  },

  delete: (id) => {
    const records = storageService.getAll();
    const filtered = records.filter(r => r.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  },

  exportToCSV: () => {
    const records = storageService.getAll();
    if (records.length === 0) return;

    const headers = [
      'Intern Name', 'Role', 'Department', 'Start Date', 'End Date', 
      'Paid / Unpaid', 'Stipend Amount', 'Supervisor', 'Company Name', 'Date Created'
    ];

    const rows = records.map(r => [
      r.studentName,
      r.role,
      r.department,
      r.startDate,
      r.endDate,
      r.isPaid ? 'Paid' : 'Unpaid',
      r.stipend || 'N/A',
      r.supervisorName,
      r.companyName,
      new Date(r.createdAt).toLocaleDateString()
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `intern_records_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};
