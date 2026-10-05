import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ addItem: vi.fn(), removeItem: vi.fn() }));
vi.mock('./orgStore', () => ({ orgStore: store }));

import {
    GENERAL, INTERNAL, splitChoice, vendorChoice, productChoice, inScope, choiceLabel,
    assignVendorProject, saveWithBelongsTo,
} from './belongsTo';

const links = [
    { id: 'l1', vendor_id: 'v1', project_id: 'p1' },
    { id: 'l2', vendor_id: 'v1', project_id: 'p2' },
];

beforeEach(() => { store.addItem.mockReset(); store.removeItem.mockReset(); });

describe('splitChoice', () => {
    it('turns a project id into project_id', () => {
        expect(splitChoice('p1')).toEqual({ belongs_to: GENERAL, project_id: 'p1' });
    });
    it('keeps internal and general off any project', () => {
        expect(splitChoice(INTERNAL)).toEqual({ belongs_to: INTERNAL, project_id: null });
        expect(splitChoice(GENERAL)).toEqual({ belongs_to: GENERAL, project_id: null });
        expect(splitChoice('')).toEqual({ belongs_to: GENERAL, project_id: null });
    });
});

describe('starting choice', () => {
    it('a vendor on a project starts on its first project', () => {
        expect(vendorChoice({ id: 'v1', belongs_to: INTERNAL }, links)).toBe('p1');
    });
    it('a vendor on no project starts on its belongs_to', () => {
        expect(vendorChoice({ id: 'v9', belongs_to: INTERNAL }, links)).toBe(INTERNAL);
        expect(vendorChoice({ id: 'v9' }, links)).toBe(GENERAL);
    });
    it('a product prefers its project over belongs_to', () => {
        expect(productChoice({ project_id: 'p2', belongs_to: INTERNAL })).toBe('p2');
        expect(productChoice({ belongs_to: INTERNAL })).toBe(INTERNAL);
        expect(productChoice({})).toBe(GENERAL);
    });
});

describe('inScope', () => {
    it('no scope is everything', () => expect(inScope('', ['p1'], GENERAL)).toBe(true));
    it('a project scope matches rows on that project', () => {
        expect(inScope('p2', ['p1', 'p2'], GENERAL)).toBe(true);
        expect(inScope('p3', ['p1'], GENERAL)).toBe(false);
    });
    it('general and internal only match rows on no project', () => {
        expect(inScope(INTERNAL, [], INTERNAL)).toBe(true);
        expect(inScope(INTERNAL, ['p1'], INTERNAL)).toBe(false);
        expect(inScope(GENERAL, [], undefined)).toBe(true);
        expect(inScope(GENERAL, [], INTERNAL)).toBe(false);
    });
});

it('choiceLabel names the project', () => {
    expect(choiceLabel('p1', [{ id: 'p1', code: 'P-1', name: 'Launch' }])).toBe('P-1 · Launch');
    expect(choiceLabel(INTERNAL)).toBe('Internal');
    expect(choiceLabel(GENERAL)).toBe('Others');
});

describe('assignVendorProject', () => {
    it('does nothing when unchanged', async () => {
        await assignVendorProject('v1', 'p1', 'p1', links);
        expect(store.addItem).not.toHaveBeenCalled();
        expect(store.removeItem).not.toHaveBeenCalled();
    });
    it('moves the link from one project to another', async () => {
        await assignVendorProject('v1', 'p3', 'p1', links);
        expect(store.removeItem).toHaveBeenCalledWith('project_vendors', 'l1');
        expect(store.addItem).toHaveBeenCalledWith('project_vendors', { project_id: 'p3', vendor_id: 'v1' });
    });
    it('takes a vendor off its project for internal', async () => {
        await assignVendorProject('v1', INTERNAL, 'p1', links);
        expect(store.removeItem).toHaveBeenCalledWith('project_vendors', 'l1');
        expect(store.addItem).not.toHaveBeenCalled();
    });
    it('does not duplicate an existing link', async () => {
        await assignVendorProject('v1', 'p2', GENERAL, links);
        expect(store.addItem).not.toHaveBeenCalled();
    });
});

describe('saveWithBelongsTo', () => {
    it('saves with the fields when the columns exist', async () => {
        const save = vi.fn(async (d) => d);
        const out = await saveWithBelongsTo(save, { name: 'A', belongs_to: INTERNAL, project_id: null });
        expect(out.skipped).toBe(false);
        expect(save).toHaveBeenCalledTimes(1);
    });
    it('retries without them before 0078', async () => {
        const save = vi.fn()
            .mockRejectedValueOnce({ code: 'PGRST204', message: "Could not find the 'belongs_to' column" })
            .mockResolvedValueOnce({ id: 'x' });
        const out = await saveWithBelongsTo(save, { name: 'A', belongs_to: INTERNAL, project_id: 'p1' });
        expect(out).toEqual({ result: { id: 'x' }, skipped: true });
        expect(save.mock.calls[1][0]).toEqual({ name: 'A', belongs_to: undefined, project_id: undefined });
    });
    it('rethrows any other error', async () => {
        const save = vi.fn().mockRejectedValue({ code: '23505', message: 'duplicate' });
        await expect(saveWithBelongsTo(save, { name: 'A' })).rejects.toEqual({ code: '23505', message: 'duplicate' });
    });
});
