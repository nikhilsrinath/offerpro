// A fictional company's brain for the landing page: the same node/edge shape
// brainService.getGraph returns (kind, label, src_id/dst_id/rel), built
// deterministically so the graph lays out the same way on every visit.

const CLIENTS = ['Harbor Developers', 'Larkspur Hotels', 'Verdant Foods', 'Orbit Fintech', 'Pinecrest Bank', 'Meadow Schools',
    'Cobalt Labs', 'Tidewater Spa', 'Quarry Coffee', 'Northgate Clinics', 'Saffron Retail', 'Bluefin Logistics'];
const VENDORS = ['Arcline Prints', 'Stoneworks Supply', 'Lumen Lighting', 'Fabrica Textiles', 'Crestline Steel', 'Paperleaf Studio', 'Volt Electricals'];
const PRODUCTS = ['Interior Design', 'Brand Identity', 'Packaging Design', 'Site Supervision', '3D Visualisation', 'Signage', 'Retainer'];
const DEPTS = ['Design', 'Projects', 'Finance', 'Operations'];
const PEOPLE = ['Aarav Rao', 'Meera Kapoor', 'Sahil Pillai', 'Devika Nair', 'Nikhil Joshi', 'Riya Thomas', 'Kabir Shah', 'Ananya Iyer',
    'Farhan Ali', 'Ishita Menon', 'Vikram Sethi', 'Tara Bose', 'Arjun Reddy', 'Neha Kulkarni', 'Rohan Das', 'Pooja Gupta'];
const TASKS = ['Site measurements', 'Moodboard round two', 'Lighting plan', 'Vendor quotes', 'Packaging dieline', 'Client walkthrough',
    'Brand guidelines', 'Signage drawings', 'BOQ review', 'Handover pack', 'Material samples', 'Render revisions',
    'Kick-off notes', 'Snag list', 'Logo variants', 'Store layout', 'Fit-out schedule', 'Colour study'];
const LIB = ['Employee Handbook', 'GST Filing Guide', 'Design Process', 'Site Safety Policy', 'Proposal Template', 'Brand Playbook'];

export function buildMockBrain() {
    const nodes = [];
    const edges = [];
    const add = (id, kind, label, state) => { nodes.push({ id, kind, label, ...(state ? { state } : {}) }); return id; };
    const link = (src_id, dst_id, rel) => edges.push({ id: `${src_id}>${dst_id}`, src_id, dst_id, rel });

    const org = add('org', 'organization', 'Kestrel Studio');
    add('plan', 'subscription', 'Growth plan'); link('plan', org, 'belongs_to');
    add('memory', 'memory', 'Company memory'); link('memory', org, 'about');

    const depts = DEPTS.map((d, i) => { const id = add(`dep${i}`, 'department', d); link(id, org, 'part_of'); return id; });
    const people = PEOPLE.map((p, i) => {
        const id = add(`emp${i}`, 'employee', p, 'active');
        link(id, depts[i % depts.length], 'belongs_to');
        if (i >= 4) link(id, `emp${i % 4}`, 'reports_to');
        return id;
    });

    const clients = CLIENTS.map((c, i) => { const id = add(`cli${i}`, 'client', c, i < 9 ? 'active' : 'lead'); link(id, org, 'belongs_to'); return id; });
    const products = PRODUCTS.map((p, i) => { const id = add(`prd${i}`, 'product', p); link(id, org, 'belongs_to'); return id; });

    let inv = 40;
    clients.slice(0, 10).forEach((c, ci) => {
        const count = 1 + (ci % 3);
        for (let k = 0; k < count; k++) {
            const paid = (ci + k) % 3 !== 0;
            const id = add(`inv${inv}`, 'financial_document', `INV-0${inv}`, paid ? 'paid' : 'sent');
            link(id, c, 'billed_to');
            link(id, products[(ci + k) % products.length], 'includes');
            if (paid) { const p = add(`pay${inv}`, 'payment', `Receipt RC-1${inv}`); link(p, id, 'pays'); }
            inv++;
        }
    });
    add('rec1', 'recurring_invoice', 'Retainer, Larkspur Hotels'); link('rec1', 'cli1', 'billed_to'); link('rec1', products[6], 'includes');

    const vendors = VENDORS.map((v, i) => { const id = add(`ven${i}`, 'vendor', v); link(id, org, 'belongs_to'); return id; });
    vendors.forEach((v, i) => {
        for (let k = 0; k < 1 + (i % 2); k++) {
            const id = add(`bill${i}${k}`, 'purchase_invoice', `BL-22${i}${k}`, k ? 'due' : 'paid');
            link(id, v, 'billed_by');
        }
    });
    ['Studio rent', 'Software', 'Travel', 'Site consumables', 'Internet'].forEach((e, i) => {
        const id = add(`exp${i}`, 'expense', e); link(id, org, 'belongs_to'); if (i > 1) link(id, people[i], 'requested_by');
    });

    ['Offer letter', 'Experience letter', 'Internship certificate', 'NDA', 'Appraisal letter'].forEach((r, i) => {
        const id = add(`hr${i}`, 'record', `${r}, ${PEOPLE[i * 3].split(' ')[0]}`); link(id, people[i * 3], 'issued_to');
    });
    LIB.forEach((l, i) => { const id = add(`lib${i}`, 'library_document', l); link(id, org, 'about'); if (i === 4) link(id, clients[3], 'about'); });

    TASKS.forEach((t, i) => {
        const id = add(`task${i}`, 'task', t, i % 4 === 0 ? 'done' : 'open');
        link(id, people[(i * 5) % people.length], 'assigned_to');
        link(id, clients[i % 8], 'about');
    });
    [2, 7, 11].forEach((p, i) => { const id = add(`leave${i}`, 'leave_request', `Leave, ${PEOPLE[p].split(' ')[0]}`); link(id, people[p], 'requested_by'); });
    ['Diwali holidays', 'New site safety rules', 'Quarterly review'].forEach((a, i) => {
        const id = add(`ann${i}`, 'announcement', a); link(id, depts[i % depts.length], 'targets');
    });

    return { nodes, edges };
}
