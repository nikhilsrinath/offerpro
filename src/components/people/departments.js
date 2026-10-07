import { DEPT_PALETTE } from '../TeamHierarchy';

export function deptColor(name, departments) {
    if (!name) return null;
    const fb = departments.find((d) => d.name === name);
    if (fb?.color) return fb.color;
    const h = [...name].reduce((a, c) => c.charCodeAt(0) + ((a << 5) - a), 0);
    return DEPT_PALETTE[Math.abs(h) % DEPT_PALETTE.length];
}

// Every department that is saved or still named on someone's record.
export function departmentRows(employees, departments) {
    const names = [...new Set([
        ...employees.map((e) => e.department).filter(Boolean),
        ...departments.map((d) => d.name),
    ])].sort();
    return names.map((name) => ({
        name,
        color: deptColor(name, departments),
        count: employees.filter((e) => e.department === name).length,
        id: departments.find((d) => d.name === name)?.id || null,
    }));
}
