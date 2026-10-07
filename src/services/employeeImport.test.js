import { describe, it, expect } from 'vitest';
import { findDuplicates } from './employeeImport';

const registry = [
    { id: 'e1', studentName: 'Rahul Sharma', email: 'rahul@example.com', employee_code: 'EMP100' },
    { id: 'x1', studentName: 'Old Hand', email: 'old@example.com', employee_code: 'EMP001', exited_at: '2026-01-01' },
];
const row = (o) => ({ first_name: 'A', last_name: 'B', email: 'a@x.com', employee_id: '', _key: 'k' + Math.random(), ...o });

describe('findDuplicates', () => {
    it('stops a row whose email belongs to a current employee', () => {
        const [a] = findDuplicates([row({ email: 'RAHUL@example.com' })], registry);
        expect(a.errors[0]).toMatch(/email is already in the registry/);
        expect(a.rejoin).toBeNull();
    });
    it('lets an ex-employee rejoin on their own record, by email or by their old id', () => {
        const [a] = findDuplicates([row({ first_name: 'Old', last_name: 'Hand', email: 'old@example.com' })], registry);
        expect(a).toEqual({ errors: [], warning: '', rejoin: registry[1] });
        const [b] = findDuplicates([row({ email: 'OLD@example.com', employee_id: 'emp001' })], registry);
        expect(b.rejoin).toBe(registry[1]);
        const [c] = findDuplicates([row({ email: 'new@example.com', employee_id: 'EMP001' })], registry);
        expect(c.rejoin).toBe(registry[1]);
    });
    it('stops a rejoin whose id is not the one they left with, or that points at two people', () => {
        const [a] = findDuplicates([row({ email: 'old@example.com', employee_id: 'EMP555' })], registry);
        expect(a.errors[0]).toMatch(/left with employee id EMP001/);
        const [b] = findDuplicates([row({ email: 'old@example.com', employee_id: 'EMP100' })], registry);
        expect(b.errors[0]).toMatch(/employee id is already used by Rahul Sharma/);
        const two = [...registry, { id: 'x2', studentName: 'Gone Too', email: 'gone@example.com', employee_code: 'EMP002', exited_at: '2026-02-01' }];
        const [c] = findDuplicates([row({ email: 'old@example.com', employee_id: 'EMP002' })], two);
        expect(c.errors[0]).toMatch(/belongs to Old Hand .* but employee id belongs to Gone Too/);
    });
    it('brings an ex-employee back only once per file', () => {
        const [a, b] = findDuplicates([row({ email: 'old@example.com' }), row({ email: 'x@example.com', employee_id: 'EMP001' })], registry);
        expect(a.rejoin).toBe(registry[1]);
        expect(b.errors[0]).toMatch(/already brought back/);
    });
    it('stops a row whose employee id is taken', () => {
        const [a] = findDuplicates([row({ employee_id: 'emp100' })], registry);
        expect(a.errors[0]).toMatch(/employee id/);
    });
    it('only warns about a shared name, and Ignore lets it through', () => {
        const r = row({ first_name: 'Rahul', last_name: 'Sharma', email: 'other@example.com' });
        expect(findDuplicates([r], registry)[0]).toEqual({ errors: [], warning: 'same name as someone in the registry', rejoin: null });
        expect(findDuplicates([r], registry, new Set([r._key]))[0]).toEqual({ errors: [], warning: '', rejoin: null });
    });
    it('checks the rows against each other', () => {
        const [a, b] = findDuplicates([row({ email: 'n@x.com', employee_id: 'E9' }), row({ email: 'n@x.com', employee_id: 'E9' })], []);
        expect(a.errors).toEqual([]);
        expect(b.errors).toHaveLength(2);
    });
    it('passes a new person', () => {
        expect(findDuplicates([row({})], registry)[0]).toEqual({ errors: [], warning: '', rejoin: null });
    });
});
