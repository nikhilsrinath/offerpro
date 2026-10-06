import { describe, it, expect } from 'vitest';
import { findDuplicates } from './employeeImport';

const registry = [
    { studentName: 'Rahul Sharma', email: 'rahul@example.com', employee_code: 'EMP100' },
    { studentName: 'Old Hand', email: 'old@example.com', employee_code: 'EMP001', exited_at: '2026-01-01' },
];
const row = (o) => ({ first_name: 'A', last_name: 'B', email: 'a@x.com', employee_id: '', _key: 'k' + Math.random(), ...o });

describe('findDuplicates', () => {
    it('stops a row whose email is already in the registry, ex-employees included', () => {
        const [a, b] = findDuplicates([row({ email: 'RAHUL@example.com' }), row({ email: 'old@example.com' })], registry);
        expect(a.errors[0]).toMatch(/email is already in the registry/);
        expect(b.errors[0]).toMatch(/ex-employee/);
    });
    it('stops a row whose employee id is taken', () => {
        const [a] = findDuplicates([row({ employee_id: 'emp100' })], registry);
        expect(a.errors[0]).toMatch(/employee id/);
    });
    it('only warns about a shared name, and Ignore lets it through', () => {
        const r = row({ first_name: 'Rahul', last_name: 'Sharma', email: 'other@example.com' });
        expect(findDuplicates([r], registry)[0]).toEqual({ errors: [], warning: 'same name as someone in the registry' });
        expect(findDuplicates([r], registry, new Set([r._key]))[0]).toEqual({ errors: [], warning: '' });
    });
    it('checks the rows against each other', () => {
        const [a, b] = findDuplicates([row({ email: 'n@x.com', employee_id: 'E9' }), row({ email: 'n@x.com', employee_id: 'E9' })], []);
        expect(a.errors).toEqual([]);
        expect(b.errors).toHaveLength(2);
    });
    it('passes a new person', () => {
        expect(findDuplicates([row({})], registry)[0]).toEqual({ errors: [], warning: '' });
    });
});
