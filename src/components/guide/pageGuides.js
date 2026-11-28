/* ══════════════════════════════════════════════════════════════════════════
   The page tips: one short card per page, for people new to Opstead.

   Keyed by the page id App.jsx works out from the path (pageOf), or, inside
   a project, `project:<section id>` (ProjectDetail's TABS). Each card says
   what the page is for in a sentence or two, then up to three steps.
   `guideKey` folds pages that share one card (the Billing tabs, the
   dashboards) onto it. Copy only: no React here.
   ══════════════════════════════════════════════════════════════════════════ */

export const GUIDES = {
    // ── Hub ──────────────────────────────────────────────────────────────────
    dashboard: {
        title: 'Welcome to Opstead',
        body: 'Opstead runs your company in one place: projects, clients, vendors, your team, money and documents. This dashboard shows how it is all doing for the period you pick.',
        steps: [
            'Use the tabs to switch between Overview, Projects, Finance, Sales, Team and Documents.',
            'Add widgets you care about with Add Widget; drag them with Arrange.',
            'Stuck anywhere? Help & Support, at the bottom of the left menu, explains every page and how to reach us.',
        ],
    },
    today: {
        title: 'Your day at a glance',
        body: 'What needs you today, worked out from your own records: work that is due, money to collect and things waiting on you.',
        steps: ['Start at the top; the most pressing items come first.', 'Each line opens the record it is about, so you can act on it there.', 'Come back here each morning to plan the day.'],
    },
    calendar: {
        title: 'Calendar',
        body: 'Your own events alongside company dates: leave, deadlines, milestones and invoice due dates.',
        steps: ['Click a day or a time to add an event.', 'Switch calendars on or off in the side panel.', 'Use Day, Week and Month to change the view.'],
    },
    'my-tasks': {
        title: 'My Tasks',
        body: 'Your private to-dos together with the project tasks assigned to you, in one list.',
        steps: ['Add a quick task with the box at the top.', 'Star what matters most; it rises to the top.', 'Tick a task when it is done.'],
    },
    notes: {
        title: 'Notes',
        body: 'Private notes, checklists and reminders. Only you can see them.',
        steps: ['Start a note with New Note.', 'Turn lines into a checklist to tick off.', 'Pin the notes you come back to.'],
    },
    'ai/ask': {
        title: 'Ask OpsteadAI',
        body: 'Ask questions about your company in plain words: revenue, overdue invoices, who is on leave, how a project is doing. Answers come from your own data and documents.',
        steps: ['Type a question, for example “Which invoices are overdue?”.', 'Ask it to do something, like draft a quotation; you approve before anything changes.', 'Follow the source links under an answer to see where it came from.'],
    },
    'ai/agents': {
        title: 'Agents',
        body: 'Agents watch your business in the background and tell you when something needs attention, such as deadlines at risk or unpaid invoices.',
        steps: ['Switch on the agents you want.', 'Each one says what it looks for.', 'Their alerts arrive in your notifications.'],
    },
    'ai/connectors': {
        title: 'Connectors',
        body: 'Connect the tools you already use, such as Google Workspace, Microsoft 365, Slack or your bank, so Opstead can work with them.',
        steps: ['Pick a category to see the tools in it.', 'Each card says what the connection will do.', 'Tools marked Built Into Opstead work today; the rest are coming soon.'],
    },
    'ai/neurals': {
        title: 'Neurals',
        body: 'A map of how your clients, projects, people and money connect, which OpsteadAI uses to answer questions.',
        steps: ['Click a point to see what it links to.', 'Follow the links to see how a client, project and people connect.', 'The more you record in Opstead, the richer the map.'],
    },

    // ── Projects ─────────────────────────────────────────────────────────────
    projects: {
        title: 'Projects',
        body: 'Every piece of work you deliver, for a client or for yourselves, with its status, health and margin.',
        steps: ['Start one with New Project: the client, the team, the budget and the plan.', 'Open a project to run it: its own clients, vendors, planning, team, money and documents.', 'Pin the projects you work on daily; they appear in the left menu.'],
    },
    'kanban-chart': {
        title: 'Kanban Chart',
        body: 'All projects as cards grouped by status, so you can see what is planned, active, on hold or done.',
        steps: ['Each column is a status: planned, active, on hold, completed.', 'Open a card to go to the project.', 'Change a project’s status from the project itself.'],
    },
    portfolio: {
        title: 'Portfolio',
        body: 'How all your projects compare: health, margin, billing and how busy each person is across them.',
        steps: ['Sort by margin or health to find the projects that need attention.', 'Check team load before adding people to new work.', 'Export the table for reviews.'],
    },
    timesheets: {
        title: 'Timesheets',
        body: 'Hours worked, by person and by project. Approved hours feed project costs and billing.',
        steps: ['Fill in your week in the Week view.', 'Managers approve or reject hours under Approvals.', 'Approved, billable hours can be invoiced from the project.'],
    },
    tasks: {
        title: 'Tasks',
        body: 'Work assigned across projects, with owners and due dates.',
        steps: ['Create a task and assign it to a person and a project.', 'Move it across the board as work progresses.', 'Filter by person to see someone’s workload.'],
    },

    // ── Clients ──────────────────────────────────────────────────────────────
    'client-general-ledger': {
        title: 'Client General Ledger',
        body: 'Every invoice and payment with your clients in one running ledger, with what is still outstanding.',
        steps: ['Record a payment you received with Record Receipt.', 'Upload or create an invoice with Create/Upload Client Invoice.', 'Click the Outstanding tile to see only what is owed.'],
    },
    billing: {
        title: 'Billing',
        body: 'Quotations, proforma invoices and invoices, from the first quote to the final payment.',
        steps: ['Start with a Quotation; convert it to a Proforma or an Invoice when accepted.', 'Send it by email or download the PDF.', 'Mark payments as they come in; the ledger updates by itself.'],
    },
    recurring: {
        title: 'Recurring Invoices',
        body: 'Invoices that go out on a schedule, such as monthly retainers or subscriptions.',
        steps: ['Create one with the client, the amount and how often it repeats.', 'Opstead raises each invoice on its date.', 'Pause or end a schedule at any time.'],
    },
    'client-directory': {
        title: 'Client Directory',
        body: 'Every client’s details in one place: contacts, tax IDs, payment terms and their invoice history.',
        steps: ['Add a client with Add Client; their GSTIN fills in the tax details.', 'Open a client to see their projects, invoices and payments.', 'Use Columns to choose what the list shows.'],
    },
    crm: {
        title: 'CRM',
        body: 'Your sales pipeline: each deal from first contact to won or lost, with its value and next step.',
        steps: ['Add a deal with New Deal.', 'Move it through the stages as the conversation progresses.', 'When a deal is won, turn it into a project in one click.'],
    },
    'products-directory': {
        title: 'Business Directory',
        body: 'The products and services you sell, with prices and tax rates, and what each has earned.',
        steps: ['Add each product or service once.', 'Pick them on quotations and invoices instead of typing lines.', 'See which ones sell best under Performance.'],
    },

    // ── Vendors ──────────────────────────────────────────────────────────────
    'vendor-general-ledger': {
        title: 'Vendor General Ledger',
        body: 'Everything you buy: vendor bills, the payments you make and what you still owe.',
        steps: ['Upload a bill with Upload Vendor Invoice; Opstead reads the details.', 'Record a payment against one or more bills with Record Payment.', 'Watch the Payable tile for what is due.'],
    },
    'vendor-directory': {
        title: 'Vendor Directory',
        body: 'Your suppliers and contractors with their contacts, tax details, bank details and terms.',
        steps: ['Add a vendor with Add Vendor.', 'Keep their bank details here for payments.', 'Open a vendor to see their bills and payments.'],
    },

    // ── Company ──────────────────────────────────────────────────────────────
    employees: {
        title: 'Employee Registry',
        body: 'Everyone in your company, with their role, department, pay and onboarding.',
        steps: ['Add a person with Add Employee, or many at once with Bulk Import.', 'Invite them to sign in so they get their own portal.', 'Move leavers to Ex-Employees; their history is kept.'],
    },
    'ex-employees': {
        title: 'Ex-Employees',
        body: 'People who have left, with their records kept for reference and documents.',
        steps: ['Open a person to see their history.', 'Use Rejoin if someone comes back.', 'Their past documents stay in Records.'],
    },
    attendance: {
        title: 'Attendance',
        body: 'Who is present, absent, remote or on leave, day by day and month by month.',
        steps: ['Mark the day in the Daily Sheet, or Mark All Present.', 'See the month at a glance in the Monthly Sheet.', 'Approve leave requests under Leave.'],
    },
    leave: {
        title: 'Leave',
        body: 'Leave requests, balances and the yearly quota for each type of leave.',
        steps: ['Approve or reject requests waiting for you.', 'Set leave types and quotas once.', 'Check anyone’s balance before approving.'],
    },
    'company-hierarchy': {
        title: 'Hierarchy',
        body: 'Your org chart: who reports to whom, across departments.',
        steps: ['Drag a person under their manager.', 'Click a person to see their team.', 'Keep it current; approvals follow these reporting lines.'],
    },
    announcements: {
        title: 'Announcements',
        body: 'Messages to the whole company, a department, or chosen people, now or at a set time.',
        steps: ['Write one with New Announcement.', 'Choose who it goes to and when.', 'Pin important notices so they stay on top.'],
    },
    'recruitment-tracker': {
        title: 'Recruitment Tracker',
        body: 'Every offer letter you have sent and whether the candidate accepted.',
        steps: ['Send offers from Documents › Offer Letters.', 'Track each candidate’s reply here.', 'Follow up on offers still waiting.'],
    },

    // ── Financials ───────────────────────────────────────────────────────────
    'finance-status': {
        title: 'Finance Status',
        body: 'Every quotation, invoice and bill through its lifecycle, so nothing is forgotten.',
        steps: ['See what is drafted, sent, overdue or paid.', 'Open a document to take the next step on it.', 'Chase overdue invoices first.'],
    },
    'general-ledger': {
        title: 'General Ledger',
        body: 'Every credit and debit across the company: income, expenses, invoices, bills and payments.',
        steps: ['Record income or an expense directly.', 'Filter by project, party or period.', 'Export for your accountant.'],
    },
    'profit-loss': {
        title: 'Profit & Loss',
        body: 'Income, expenses and net profit for any period.',
        steps: ['Pick the period at the top.', 'Click a line to see the entries behind it.', 'Compare months to see the trend.'],
    },
    'tax-summary': {
        title: 'Tax Summary',
        body: 'GST you collected on sales against GST you paid on purchases, for filing.',
        steps: ['Pick the month or quarter you are filing.', 'Check the net amount payable.', 'Export the CSV for your accountant or the GST portal.'],
    },
    revenue: {
        title: 'Billing & Revenue',
        body: 'Revenue, expenses and profitability over time.',
        steps: ['Pick a period.', 'See which clients bring in the most.', 'Spot months where costs ran ahead of income.'],
    },

    // ── Documents ────────────────────────────────────────────────────────────
    'document-library': {
        title: 'Document Library',
        body: 'Company documents that OpsteadAI can read and answer from: policies, contracts, process assets and lessons learned. Project Documents lists the files kept on every project.',
        steps: ['Upload files, or drag them onto the page.', 'Use the tabs to keep each kind of document in its place.', 'Ask the AI about anything inside them.'],
    },
    'offer-letters': {
        title: 'Offer Letters',
        body: 'Create and send offer letters on your letterhead, one at a time or in bulk from a CSV.',
        steps: ['Choose Internship, Full-Time or Collaboration.', 'Fill in the details; the preview updates live.', 'Finalize & Download, or send; replies show in the Recruitment Tracker.'],
    },
    certificates: {
        title: 'Certificates',
        body: 'Design and issue certificates, one at a time or for a whole batch from a CSV.',
        steps: ['Pick a design and click any text on it to edit.', 'Add your logo and signature.', 'Issue it; find it again later under Records.'],
    },
    templates: {
        title: 'Templates',
        body: 'Ready agreements on your letterhead: NDAs, MoUs, partnership agreements and your own templates.',
        steps: ['Pick a template to start.', 'Fill in the parties and terms.', 'Download it, or save it to Records.'],
    },
    records: {
        title: 'Records',
        body: 'Every document Opstead has issued, searchable and ready to download again.',
        steps: ['Search by name, number or type.', 'Open a record to view or download it.', 'Use it as the history of everything you sent.'],
    },
    profile: {
        title: 'Company Profile',
        body: 'The details printed on every document you issue: name, address, tax IDs, bank details, logo and signature.',
        steps: ['Fill in each tab; the header shows what is still missing.', 'Upload your logo and signature under Corporate Identity.', 'Every new invoice and letter picks these up.'],
    },

    // ── Inside a project ─────────────────────────────────────────────────────
    'project:client-general': {
        title: 'Client General Ledger (project)',
        body: 'The money between this project and its clients: invoices raised, payments received and what is still due.',
        steps: ['Record a receipt or add an invoice for this project.', 'The tiles show invoiced, received and outstanding.', 'Each entry links to the document behind it.'],
    },
    'project:billing': {
        title: 'Billing (project)',
        body: 'Quotations, proformas and invoices for this project only.',
        steps: ['Create a quotation for the work.', 'Convert it to an invoice when a milestone is done.', 'Payments update the project’s margin.'],
    },
    'project:clients': {
        title: 'Client Directory (project)',
        body: 'The clients this project is for, with their contacts and terms.',
        steps: ['Add the client, or link an existing one.', 'Open a client for contacts and documents.', 'Use Columns to choose what you see.'],
    },
    'project:crm': {
        title: 'CRM (project)',
        body: 'Deals linked to this project, such as add-ons or follow-on work.',
        steps: ['Add a deal for new work with this client.', 'Move it through the stages.', 'Won deals add to the project’s value.'],
    },
    'project:comms': {
        title: 'Client’s Communication',
        body: 'Calls, emails and meetings with the client, and the items they need to approve.',
        steps: ['Log each conversation with its outcome.', 'Send designs or documents for approval.', 'Track what is approved, pending or rejected.'],
    },
    'project:payments': {
        title: 'Payment Status & Pendings',
        body: 'What the client has paid on this project and what is still pending.',
        steps: ['Check pending amounts before the next invoice.', 'Open an invoice to record a payment.', 'Follow up on anything overdue.'],
    },
    'project:vendor-general': {
        title: 'Vendor General Ledger (project)',
        body: 'Bills from vendors for this project, what you have paid and what you owe.',
        steps: ['Upload a vendor bill for this project.', 'Record payments against it.', 'Vendor costs count against the project’s margin.'],
    },
    'project:vendors': {
        title: 'Vendor Directory (project)',
        body: 'The suppliers and contractors working on this project.',
        steps: ['Add a vendor or link an existing one.', 'Keep their contract dates and value here.', 'Use Columns to choose what you see.'],
    },
    'project:pm': {
        title: 'Planning Overview',
        body: 'The plan for this project at a glance: deliverables, progress and what is late.',
        steps: ['Build the plan in Tasks (WBS) first.', 'Track progress here.', 'Use Gantt to see the timeline.'],
    },
    'project:wbs': {
        title: 'Tasks (WBS)',
        body: 'The work breakdown: deliverables, then the tasks under each, with owners and dates.',
        steps: ['Start from a ready breakdown or add deliverables yourself.', 'Add tasks under each deliverable.', 'Set who is responsible and the dates.'],
    },
    'project:tasks': {
        title: 'Kanban Board',
        body: 'This project’s tasks as cards, moving from to-do to done.',
        steps: ['Create a task with New Task.', 'Drag cards across columns as work moves.', 'Filter by person to see their work.'],
    },
    'project:gantt': {
        title: 'Gantt Chart',
        body: 'The project’s tasks on a timeline, with dependencies.',
        steps: ['See every task on the timeline, by deliverable.', 'Change dates in Tasks (WBS); the chart follows.', 'Watch for tasks running past the deadline.'],
    },
    'project:whiteboard': {
        title: 'Whiteboard',
        body: 'A shared board for ideas, flows and sketches. Everyone on the project can draw on it.',
        steps: ['Add sticky notes, shapes, arrows and text.', 'Drag to move; scroll to zoom.', 'It saves as you go.'],
    },
    'project:products': {
        title: 'SKU',
        body: 'The products and services this project sells.',
        steps: ['Add each product or service.', 'Use them on this project’s quotations and invoices.', 'See what each has sold.'],
    },
    'project:team': {
        title: 'Team Members',
        body: 'The people working on this project, their role and how much of their time it takes.',
        steps: ['Add a person with Add a Person.', 'Set their project role and time share.', 'A red “booked” tag means they are over 100% across projects.'],
    },
    'project:raci': {
        title: 'Team Hierarchy',
        body: 'Who is Responsible, Accountable, Consulted and Informed for each deliverable (RACI).',
        steps: ['Add the rows you want to assign.', 'Give each person a letter on each row.', 'Every row needs one Accountable person.'],
    },
    'project:attendance': {
        title: 'Attendance (project)',
        body: 'Attendance and leave for the people on this project.',
        steps: ['Mark the day for the team.', 'See the month in the Monthly Sheet.', 'Handle leave requests in Leave.'],
    },
    'project:announcements': {
        title: 'Announcements (project)',
        body: 'Messages for the people on this project.',
        steps: ['Write one with New Announcement.', 'Send it to everyone on the project or chosen people.', 'Schedule it for later if needed.'],
    },
    'project:social': {
        title: 'Social',
        body: 'This project’s social media in one place: the content calendar, campaigns, launches, competitors and audience numbers.',
        steps: ['Plan posts in the Content Calendar.', 'Group posts and spend into Campaigns.', 'Add each month’s numbers under Analytics to see the trend.'],
    },
    'project:social-calendar': {
        title: 'Content Calendar',
        body: 'Every post for every platform on one calendar, from idea to published.',
        steps: ['Click a day to add a post, or Add Idea for something without a date.', 'Move a post through review and client approval.', 'Filter by platform to see one channel.'],
    },
    'project:social-analytics': {
        title: 'Analytics',
        body: 'Followers, reach and engagement for each platform, month by month.',
        steps: ['Add this month’s figures from each platform’s insights.', 'The tiles compare with last month.', 'Use the trend to plan next month’s content.'],
    },
    'project:social-competitors': {
        title: 'Competitors',
        body: 'The accounts you measure yourself against, with their numbers over time.',
        steps: ['Add a competitor and their handles.', 'Note their numbers now and then.', 'Compare them with yours, platform by platform.'],
    },
    'project:social-campaigns': {
        title: 'Campaigns',
        body: 'Social, email, WhatsApp, offline and influencer campaigns, each with a budget and results.',
        steps: ['Plan a campaign with its goal, dates and budget.', 'Link posts to it in the calendar.', 'Update spend and leads to see the cost per lead.'],
    },
    'project:social-launches': {
        title: 'Launches',
        body: 'Taking a product or service to market: audience, message, price and a readiness checklist.',
        steps: ['Create a launch and pick the SKU.', 'Tick off the checklist as things get ready.', 'Write the review after launch day.'],
    },
    'project:finance': {
        title: 'Financial Status',
        body: 'How the project is doing on money: contract, billed, collected, costs and margin.',
        steps: ['Check margin against the budget.', 'See open invoices and chase them.', 'Click a figure to see what makes it up.'],
    },
    'project:tax': {
        title: 'Tax Summary (project)',
        body: 'GST collected and paid on this project.',
        steps: ['Pick the period.', 'Check output and input GST.', 'Export for your accountant.'],
    },
    'project:pl': {
        title: 'Profit & Loss (project)',
        body: 'Income, costs and profit for this project.',
        steps: ['Pick the period.', 'Click a line for the entries behind it.', 'Compare with the budget set when the project began.'],
    },
    'project:documents': {
        title: 'Project Documents',
        body: 'Files for this project, in folders, with versions kept.',
        steps: ['Upload files or whole folders, or drag them in.', 'Organise them into folders.', 'Upload a file with the same name to save a new version.'],
    },
    'project:templates': {
        title: 'Templates (project)',
        body: 'Agreements and letters for this project on your letterhead.',
        steps: ['Pick a ready template, such as an NDA.', 'Fill in the parties.', 'Save the result to Project Documents.'],
    },
};

/** The card for a page id, folding pages that share one card. */
export function guideKey(id) {
    if (!id) return null;
    if (id.startsWith('dashboard')) return 'dashboard';
    if (['invoices', 'quotations', 'proforma'].includes(id)) return 'billing';
    return GUIDES[id] ? id : null;
}
