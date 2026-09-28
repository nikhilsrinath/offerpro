import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate';
import {
    isEmail, isPhone, isUrl, isGstin, isIfsc, isSwift, validate, contactErrors,
    invoiceState, paymentTotals, placeholderValues, fillPlaceholders, findPlaceholders,
    sanitizeHtml, htmlToBlocks, htmlToText, blocksToDocxXml, DOCX_PARTS,
    fileKind, canPreview, fmtBytes, folderPath, folderSubtree,
} from './projectWorkspace';

describe('validation', () => {
    it('checks emails, phones, websites and tax/bank codes', () => {
        expect(isEmail('a@b.co')).toBe(true);
        expect(isEmail('a@b')).toBe(false);
        expect(isPhone('+91 98765 43210')).toBe(true);
        expect(isPhone('(022) 2345-6789')).toBe(true);
        expect(isPhone('12345')).toBe(false);
        expect(isPhone('98765abc10')).toBe(false);
        expect(isUrl('example.com')).toBe(true);
        expect(isUrl('https://a.example.co.in/x')).toBe(true);
        expect(isUrl('not a site')).toBe(false);
        expect(isGstin('29abcde1234f1z5')).toBe(true);
        expect(isGstin('29ABCDE1234F1Y5')).toBe(false);
        expect(isIfsc('HDFC0001234')).toBe(true);
        expect(isIfsc('HDFC1001234')).toBe(false);
        expect(isSwift('HDFCINBB')).toBe(true);
        expect(isSwift('HDFCINBBXXX')).toBe(true);
        expect(isSwift('HDFC')).toBe(false);
    });
    it('reports the first failing rule per field, and skips empty optional fields', () => {
        const rules = {
            name: [{ required: true, message: 'Name.' }],
            email: [{ test: isEmail, message: 'Email.' }],
            end: [{ test: (v, f) => v >= f.start, message: 'End after start.' }],
        };
        expect(validate({ name: ' ', email: '', start: '2026-02-01', end: '2026-01-01' }, rules))
            .toEqual({ name: 'Name.', end: 'End after start.' });
        expect(validate({ name: 'X', email: 'x@y.io', start: '', end: '' }, rules)).toEqual({});
    });
    it('wants a name on every contact and exactly one primary', () => {
        expect(contactErrors([])).toEqual([]);
        expect(contactErrors([{ name: 'A', primary: true }, { name: 'B' }])).toEqual([]);
        expect(contactErrors([{ name: '', email: 'bad', primary: false }])).toEqual([
            'Contact 1 needs a name.', 'Contact 1: that email does not look right.', 'Mark exactly one contact as primary.',
        ]);
    });
});

describe('invoiceState', () => {
    const today = '2026-09-29';
    it('marks a balance after the due date overdue, automatically', () => {
        const s = invoiceState({ grand_total: 1000, amount_paid: 400, due_date: '2026-09-20' }, { today });
        expect(s).toMatchObject({ status: 'overdue', balance: 600, paid: 400, daysLate: 9, dueSoon: false });
    });
    it('knows paid, partial, pending and due-soon', () => {
        expect(invoiceState({ grand_total: 1000, amount_paid: 1000, due_date: '2026-01-01' }, { today }).status).toBe('paid');
        expect(invoiceState({ grand_total: 1000, amount_paid: 1, due_date: '2026-12-01' }, { today }).status).toBe('partial');
        const soon = invoiceState({ grand_total: 1000, amount_paid: 0, due_date: '2026-10-03' }, { today });
        expect(soon).toMatchObject({ status: 'pending', dueSoon: true });
        expect(invoiceState({ grand_total: 500, amount_paid: 0 }, { today })).toMatchObject({ status: 'pending', due: null, dueSoon: false });
    });
    it('scales to the project share', () => {
        expect(invoiceState({ grand_total: 1000, amount_paid: 500, due_date: '2026-12-01' }, { share: 0.4, today }))
            .toMatchObject({ total: 400, paid: 200, balance: 200 });
    });
    it('totals value, received, pending and overdue', () => {
        const states = [
            invoiceState({ grand_total: 1000, amount_paid: 1000 }, { today }),
            invoiceState({ grand_total: 500, amount_paid: 100, due_date: '2026-09-01' }, { today }),
        ];
        expect(paymentTotals(3000, states)).toEqual({ value: 3000, invoiced: 1500, received: 1100, pending: 1900, overdue: 400 });
        expect(paymentTotals(0, states).value).toBe(1500);
    });
});

describe('placeholders', () => {
    const values = placeholderValues({
        project: { name: 'Site', code: 'PRJ-1', start_date: '2026-01-05', contract_value: 150000, currency: 'INR' },
        client: { name: 'Acme <Ltd>', email: 'x@acme.io', contacts: [{ name: 'Ravi', primary: true, email: 'ravi@acme.io' }] },
        vendor: null, manager: 'Asha', company: 'EdgeCo', today: '2026-09-29',
    });
    it('fills from the project, the client and its primary contact', () => {
        expect(values).toMatchObject({ client_name: 'Acme <Ltd>', client_contact: 'Ravi', client_email: 'ravi@acme.io', project_code: 'PRJ-1', project_manager: 'Asha' });
        expect(values.date).toBe('29 September 2026');
        expect(values.amount).toMatch(/1,50,000/);
    });
    it('escapes what it fills and leaves unknown or empty ones visible', () => {
        const out = fillPlaceholders('<p>{{client_name}} / {{ vendor_name }} / {{nope}}</p>', values);
        expect(out).toBe('<p>Acme &lt;Ltd&gt; / {{ vendor_name }} / {{nope}}</p>');
        expect(findPlaceholders(out)).toEqual(['vendor_name', 'nope']);
    });
});

describe('template HTML', () => {
    it('keeps only formatting tags, without attributes, and drops scripts', () => {
        const dirty = '<h1 onclick="x()">Hi</h1><script>alert(1)</script><p style="color:red">a <b>b</b> <a href="javascript:x">c</a><img src=x onerror=y></p><!-- c -->';
        expect(sanitizeHtml(dirty)).toBe('<h1>Hi</h1><p>a <b>b</b> c</p>');
    });
    it('reads headings, paragraphs, lists and inline styles into blocks', () => {
        const blocks = htmlToBlocks('<h2>Scope</h2><p>One <b>bold</b><br>two</p><ol><li>first</li><li><i>second</i></li></ol><ul><li>dot</li></ul>');
        expect(blocks.map((b) => b.type)).toEqual(['h2', 'p', 'li', 'li', 'li']);
        expect(blocks[1].runs).toEqual([
            { text: 'One ', b: false, i: false, u: false }, { text: 'bold', b: true, i: false, u: false },
            { text: '\ntwo', b: false, i: false, u: false },
        ]);
        expect(blocks[2]).toMatchObject({ list: 'ol', index: 1 });
        expect(blocks[3]).toMatchObject({ list: 'ol', index: 2, runs: [{ text: 'second', i: true }] });
        expect(blocks[4]).toMatchObject({ list: 'ul' });
        expect(htmlToText('<p>a</p><div>b &amp; c</div>')).toBe('a\nb & c');
    });
    it('builds a Word document that zips and reads back', () => {
        const xml = blocksToDocxXml(htmlToBlocks('<h1>Title & co</h1><ul><li>x</li></ul>'));
        expect(xml).toContain('<w:t xml:space="preserve">Title &amp; co</w:t>');
        expect(xml).toContain('• ');
        const zip = zipSync({ ...Object.fromEntries(Object.entries(DOCX_PARTS).map(([k, v]) => [k, strToU8(v)])), 'word/document.xml': strToU8(xml) });
        expect(strFromU8(unzipSync(zip)['word/document.xml'])).toBe(xml);
    });
});

describe('files and folders', () => {
    it('knows kinds and what can be previewed', () => {
        expect(fileKind('application/pdf', 'x')).toBe('pdf');
        expect(fileKind('', 'plan.DOCX')).toBe('doc');
        expect(fileKind('image/png', 'a.png')).toBe('image');
        expect(fileKind('', 'mystery.bin')).toBe('other');
        expect(canPreview('', 'a.pdf')).toBe(true);
        expect(canPreview('', 'a.docx')).toBe(false);
        expect(fmtBytes(1536)).toBe('2 KB');
        expect(fmtBytes(5 * 1048576)).toBe('5.0 MB');
    });
    it('walks folder paths and subtrees', () => {
        const folders = [
            { id: 'a', parent_id: null, name: 'A' }, { id: 'b', parent_id: 'a', name: 'B' },
            { id: 'c', parent_id: 'b', name: 'C' }, { id: 'd', parent_id: null, name: 'D' },
        ];
        expect(folderPath(folders, 'c').map((f) => f.name)).toEqual(['A', 'B', 'C']);
        expect([...folderSubtree(folders, 'a')].sort()).toEqual(['a', 'b', 'c']);
    });
});
