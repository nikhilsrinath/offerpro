/* ══════════════════════════════════════════════════════════════════════════
   Help & Support: the words. How Opstead is organised, the first steps, the
   page tips grouped as the menu groups them, and the common questions.
   Copy only: no React here.
   ══════════════════════════════════════════════════════════════════════════ */

export const SUPPORT_EMAIL = 'info@agentrive.com';

/** Each module in the left menu, in a sentence or two. Keyed by modules.js ids. */
export const MODULE_HELP = {
    overall: 'Dashboards for the whole company over any period: projects, money, sales, team, documents and usage. Add the widgets you care about.',
    today: 'What needs you today, worked out from your own records: work due, money to collect and things waiting on you.',
    workspace: 'Your own calendar, to-dos and private notes. Nobody else sees them.',
    ai: 'Ask questions about your company in plain words, set up agents that watch for problems, connect your other tools, and see how everything links.',
    projects: 'Every piece of work you deliver. Each project has its own clients, vendors, plan, team, social media, money and documents.',
    clients: 'Everything with your customers across all projects: the ledger, quotations and invoices, the client directory, the sales pipeline and your products.',
    vendors: 'Everything you buy: vendor bills, payments and the vendor directory.',
    team: 'Your people: the employee registry, attendance and leave, the org chart, announcements and recruitment.',
    finance: 'The state of your money: every financial document by stage, GST collected and paid, and profit and loss.',
    documents: 'The document library the AI reads from, offer letters, certificates, agreement templates and every record you have issued.',
};

/** First steps for a new company, each with where to do it. */
export const GETTING_STARTED = [
    { title: 'Complete your company profile', body: 'Your name, address, GSTIN, bank details, logo and signature appear on every document you issue.', to: '/profile', cta: 'Open Company Profile' },
    { title: 'Add your team', body: 'Add employees one by one or with Bulk Import, and invite them so they get their own portal for attendance and leave.', to: '/company/employees/registry', cta: 'Open Employees' },
    { title: 'Add clients and vendors', body: 'Save each client and vendor once; their details then fill in on quotations, invoices and bills.', to: '/clients/client-directory', cta: 'Open Client Directory' },
    { title: 'Create your first project', body: 'Pick the client, the team and the budget. The project gets its own pages for planning, money and documents.', to: '/projects/new', cta: 'New Project' },
    { title: 'Bill and track money', body: 'Send quotations and invoices, record payments and bills, and watch the ledgers and Profit & Loss update.', to: '/clients/billing/quotations', cta: 'Open Billing' },
    { title: 'Ask OpsteadAI', body: 'Ask anything about your company, for example “Which invoices are overdue?”. Upload policies and contracts to the Document Library so it can answer from them too.', to: '/ai/ask', cta: 'Open AI' },
];

/** The page tips, grouped the way the left menu groups the pages. Keys are pageGuides.js keys. */
export const GUIDE_GROUPS = [
    { label: 'Start here', keys: ['dashboard', 'today', 'calendar', 'my-tasks', 'notes'] },
    { label: 'AI', keys: ['ai/ask', 'ai/agents', 'ai/connectors', 'ai/neurals'] },
    { label: 'Projects', keys: ['projects', 'kanban-chart', 'portfolio', 'timesheets', 'tasks'] },
    { label: 'Inside a project', keys: [
        'project:client-general', 'project:billing', 'project:clients', 'project:crm', 'project:comms', 'project:payments',
        'project:vendor-general', 'project:vendors',
        'project:pm', 'project:wbs', 'project:tasks', 'project:gantt', 'project:whiteboard', 'project:products',
        'project:team', 'project:raci', 'project:attendance', 'project:announcements',
        'project:social', 'project:social-calendar', 'project:social-analytics', 'project:social-competitors', 'project:social-campaigns', 'project:social-launches',
        'project:finance', 'project:tax', 'project:pl', 'project:documents', 'project:templates',
    ] },
    { label: 'Clients', keys: ['client-general-ledger', 'billing', 'recurring', 'client-directory', 'crm', 'products-directory'] },
    { label: 'Vendors', keys: ['vendor-general-ledger', 'vendor-directory'] },
    { label: 'Company', keys: ['employees', 'ex-employees', 'attendance', 'leave', 'company-hierarchy', 'announcements', 'recruitment-tracker'] },
    { label: 'Financials', keys: ['finance-status', 'general-ledger', 'profit-loss', 'tax-summary'] },
    { label: 'Documents', keys: ['document-library', 'offer-letters', 'certificates', 'templates', 'records', 'profile'] },
];

/** Common questions, by topic. */
export const FAQS = [
    { topic: 'Getting started', items: [
        { q: 'Where do I start?', a: 'Complete your Company Profile first: every invoice, letter and certificate prints its details. Then add your team, your clients and your first project. The Overview tab here lists these steps with links.' },
        { q: 'What is the difference between a project and the Clients or Vendors menus?', a: 'Inside a project you see only that project’s clients, vendors, invoices and bills. The Clients and Vendors menus show the same things across every project, for the whole company.' },
        { q: 'Can I import data I already have?', a: 'Yes. Employees can be added in bulk from a spreadsheet with Bulk Import, and offer letters and certificates can be issued in batches from a CSV file. Clients, vendors and products are added once and reused everywhere.' },
        { q: 'The page tips have gone. How do I see them again?', a: 'Each tip shows for your first few visits to a page and then steps aside. To bring them all back, open the account menu at the top right and choose Show page tips again. Every tip is also listed under Page Guides here.' },
    ] },
    { topic: 'Billing and money', items: [
        { q: 'How do quotations, proformas and invoices relate?', a: 'Start with a quotation. When the client accepts, convert it to a proforma (to collect an advance) or straight to an invoice. Payments recorded against an invoice update the ledgers, the outstanding amount and the project’s margin.' },
        { q: 'How is GST worked out?', a: 'GST is calculated on each line from the tax rate of the product or service and the place of supply, split into CGST and SGST or charged as IGST. The Tax Summary shows GST collected against GST paid for filing. Always reconcile with your accountant before you file.' },
        { q: 'How do I record money I received or paid?', a: 'In Clients › General Ledger use Record Receipt for money in; one receipt can settle several invoices. In Vendors › General Ledger use Record Payment for money paid against a vendor bill.' },
        { q: 'Why does a project show a negative margin?', a: 'Net margin is invoiced revenue less direct costs and labour. A project with costs but no invoices yet, such as an internal project, shows a negative margin until it bills.' },
    ] },
    { topic: 'People and access', items: [
        { q: 'Who can see what?', a: 'Every person has a role, and the role decides which pages and figures they can open. Financial figures are visible only to roles allowed to see them. Each company’s data is kept completely separate from every other company’s.' },
        { q: 'Can my employees sign in?', a: 'Yes. Invite them from the Employee Registry. They get My Portal, where they see their own attendance, apply for leave and read announcements, without access to the rest of the company.' },
    ] },
    { topic: 'AI and documents', items: [
        { q: 'What does OpsteadAI use to answer?', a: 'Your own company’s records in Opstead, and the documents you upload to the Document Library. It does not answer from other companies’ data.' },
        { q: 'Can the AI change things on its own?', a: 'No. When you ask it to do something, such as draft a quotation or create a task, it prepares the change and asks you to approve it before anything is saved.' },
        { q: 'What can I upload to the Document Library?', a: 'Any file up to 25 MB. The AI reads the text inside documents such as PDFs and Word files, and each document shows whether it could be read. A scanned image without a text layer may not be readable.' },
    ] },
    { topic: 'Account and plans', items: [
        { q: 'How do I change my plan?', a: 'Open Plans & billing from the card at the bottom of the left menu, or from the account menu at the top right.' },
        { q: 'Does Opstead work on a phone?', a: 'Yes. Open it in your phone’s browser; the menu moves to a bar at the bottom. You can also add it to your home screen to open it like an app.' },
        { q: 'Something is not working. What should I send you?', a: 'Use the Contact Us tab. Tell us what you were doing, what you expected and what happened instead; a screenshot helps. We read every message.' },
    ] },
];
