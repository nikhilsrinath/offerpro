/* ══════════════════════════════════════════════════════════════════════════
   What each connector's panel says: how Opstead will use the service, how to
   set it up, how to get the most from it, and exactly what it can see.

   Keyed by the catalog id (connectorCatalog.js). Every guide has:
     summary   one paragraph, the connector in plain words
     uses      [{ title, text }]  what it does inside Opstead
     setup     [string]           the steps, in order
     tips      [string]           how to use it well
     access    { reads, writes, never }  what Opstead may and may not touch
     who       who in the company can connect it

   These describe the connector as designed. Keep them true to what gets
   built: a promise here is a promise to the customer.
   ══════════════════════════════════════════════════════════════════════════ */

const ADMIN = 'An owner or admin connects it once for the whole company. Anyone can see that it is connected.';

export const GUIDES = {
    google_calendar: {
        summary: 'Your deadlines and meetings, in the calendar you already check every day. Opstead writes its due dates into a calendar of its own and reads today’s meetings back, so nothing important lives in only one place.',
        uses: [
            { title: 'Deadlines on your calendar', text: 'GST, TDS and other filing dates from the Compliance and Deadline Agent, plus project milestones, appear on a separate “Opstead” calendar with reminders.' },
            { title: 'Stays in step', text: 'Move a milestone in Opstead and the calendar event moves too. Finish a task and its event is marked done. Nothing is duplicated.' },
            { title: 'Today’s meetings on Today', text: 'The Today page lists your meetings next to money and tasks, and shows which client or project each meeting is with.' },
            { title: 'Smarter agents', text: 'The Deal Intelligence Agent can see when you last met a lead, and flag deals nobody has met in weeks.' },
        ],
        setup: [
            'Open this connector and click Connect.',
            'Sign in with the Google account whose calendar you use, and allow access.',
            'Choose what to turn on: deadlines to calendar, meetings on Today, or both.',
            'Opstead creates the “Opstead” calendar and fills it within a minute.',
        ],
        tips: [
            'Connect the account of the person who files returns or runs projects, so reminders reach the right phone.',
            'Share the “Opstead” calendar inside Google with your accountant or project leads.',
            'Add client contacts’ email addresses in Opstead, so meetings are matched to the right client.',
        ],
        access: {
            reads: ['Today’s events on your main calendar: title, time and attendees'],
            writes: ['Events on the “Opstead” calendar only'],
            never: ['Edits or deletes your own events', 'Reads event notes or attachments'],
        },
        who: ADMIN,
    },

    google_drive: {
        summary: 'Bring the documents your company already keeps in Drive into Opstead, without uploading them again. You choose each file or folder; Opstead never sees the rest of your Drive.',
        uses: [
            { title: 'Feed the Library and Neurals', text: 'Contracts, SOPs and policies you pick are added to the Library, so the Internal Knowledge Agent and EdgeAI can answer from them.' },
            { title: 'Attach to records', text: 'Link a Drive file to a project, client or vendor. It opens from Opstead and stays in Drive.' },
            { title: 'Keeps up to date', text: 'When a picked file changes in Drive, Opstead reads the new version the next day.' },
        ],
        setup: [
            'Click Connect and sign in with Google.',
            'Use Google’s file picker to choose files or folders.',
            'Pick where each goes: a Library register, or a project, client or vendor.',
        ],
        tips: [
            'Keep one “Company Policies” folder and pick that, so new policies join the Library on their own.',
            'Pick final versions only. Drafts make the agents’ answers less certain.',
        ],
        access: {
            reads: ['Only the files and folders you pick'],
            writes: ['Nothing'],
            never: ['Browses the rest of your Drive', 'Deletes or moves your files'],
        },
        who: 'Anyone who can add to the Library can pick files. An owner or admin connects the account.',
    },

    google_sheets: {
        summary: 'Get Opstead data into a spreadsheet for your accountant, and bring lists from a spreadsheet into Opstead when you start.',
        uses: [
            { title: 'Export that stays fresh', text: 'Send a ledger, outstanding invoices or a report to a Google Sheet. It refreshes every day, so the sheet you shared is never stale.' },
            { title: 'Import from a sheet', text: 'Bring in clients, vendors, products or employees from a sheet. You match the columns once and check the rows before anything is saved.' },
        ],
        setup: [
            'Click Connect and sign in with Google.',
            'On a ledger or report, choose Export to Google Sheets.',
            'To import, open Clients, Vendors or Employees and choose Import from Google Sheets.',
        ],
        tips: [
            'Give your accountant view access to the exported sheet instead of emailing files every month.',
            'Clean up duplicates in the sheet before importing. Opstead also warns you about likely duplicates.',
        ],
        access: {
            reads: ['Only sheets you choose to import from'],
            writes: ['Only sheets Opstead creates for exports'],
            never: ['Opens your other spreadsheets'],
        },
        who: ADMIN,
    },

    google_docs: {
        summary: 'Turn the agreements and quotations you make in Opstead into Google Docs that clients can read and comment on.',
        uses: [
            { title: 'Editable agreements', text: 'Open an NDA, MoU or quotation from Templates as a Google Doc, with your letterhead, ready to share.' },
            { title: 'Docs into the Library', text: 'Pick Docs such as SOPs or handbooks to add to the Library and Neurals.' },
        ],
        setup: [
            'Click Connect and sign in with Google.',
            'On an agreement or quotation, choose Open in Google Docs.',
        ],
        tips: [
            'Share with the client as Commenter, so changes come back as suggestions you can accept.',
            'Once signed, upload the final PDF back to the record so Opstead keeps the official copy.',
        ],
        access: {
            reads: ['Only Docs you pick or Opstead created'],
            writes: ['Only Docs Opstead creates'],
            never: ['Opens your other documents'],
        },
        who: ADMIN,
    },

    gmail: {
        summary: 'Send invoices, receipts and payment reminders from your own Gmail address, so clients see mail from you rather than from a system.',
        uses: [
            { title: 'Invoices from your address', text: 'Invoices, receipts and statements go out from your Gmail and appear in your Sent folder.' },
            { title: 'Payment reminders', text: 'Overdue reminders are sent from you, with the invoice attached and the amount due filled in.' },
            { title: 'Vendor bills', text: 'To turn vendor invoices into draft bills, forward them to the Bills Inbox. Reading your inbox directly comes later.' },
        ],
        setup: [
            'Click Connect and sign in with the Gmail or Google Workspace account you send from.',
            'Allow Opstead to send mail.',
            'Send a test invoice to yourself to check how it looks.',
        ],
        tips: [
            'Use a shared address such as accounts@yourcompany.com, so replies don’t depend on one person.',
            'Set a Gmail filter to forward vendor invoices to your Bills Inbox address.',
        ],
        access: {
            reads: ['Nothing in your inbox'],
            writes: ['Emails you send from Opstead'],
            never: ['Reads, deletes or labels your mail'],
        },
        who: ADMIN,
    },

    outlook: {
        summary: 'For companies on Microsoft 365: your Outlook mail and calendar, working with Opstead. One Microsoft sign-in also covers OneDrive, SharePoint and Teams.',
        uses: [
            { title: 'Vendor invoices become draft bills', text: 'Invoices arriving in a mailbox you choose are read and turned into draft bills, waiting for your approval.' },
            { title: 'Send from your address', text: 'Invoices and reminders go out from your Outlook address.' },
            { title: 'Deadlines on your calendar', text: 'Filing dates and milestones appear on an “Opstead” calendar in Outlook, and today’s meetings show on Today.' },
        ],
        setup: [
            'Click Connect and sign in with your Microsoft work account.',
            'Allow access. If your IT team controls apps, they approve Opstead once for the company.',
            'Choose the mailbox for vendor invoices, for example accounts@.',
        ],
        tips: [
            'Use a shared mailbox for invoices, so bills don’t stop when someone is on leave.',
            'Nothing is posted to your ledger until you approve the draft bill.',
        ],
        access: {
            reads: ['Invoices in the mailbox you choose', 'Today’s calendar events'],
            writes: ['Emails you send from Opstead', 'Events on the “Opstead” calendar'],
            never: ['Deletes or moves your mail', 'Edits your own events'],
        },
        who: ADMIN,
    },

    onedrive: {
        summary: 'Bring the files you keep in OneDrive into Opstead, without uploading them again.',
        uses: [
            { title: 'Feed the Library and Neurals', text: 'Policies, contracts and SOPs you pick are added to the Library, so agents can answer from them.' },
            { title: 'Attach to records', text: 'Link OneDrive files to projects, clients and vendors.' },
        ],
        setup: [
            'Click Connect and sign in with Microsoft (or use the sign-in from Outlook).',
            'Pick the files or folders to bring in.',
        ],
        tips: ['Pick a folder rather than single files, so new documents arrive on their own.'],
        access: {
            reads: ['Only the files and folders you pick'],
            writes: ['Nothing'],
            never: ['Browses the rest of your OneDrive', 'Deletes or moves files'],
        },
        who: ADMIN,
    },

    sharepoint: {
        summary: 'Bring your company’s SharePoint sites and document libraries into the Opstead Library.',
        uses: [
            { title: 'Company knowledge in one place', text: 'HR policies, process documents and handbooks on SharePoint are added to the Library and Neurals.' },
            { title: 'Answers with sources', text: 'When EdgeAI answers from a SharePoint document, it names the document it used.' },
        ],
        setup: [
            'Click Connect and sign in with Microsoft.',
            'Choose the sites and document libraries to include.',
        ],
        tips: ['Start with one well-kept site, such as HR or Operations, and add more later.'],
        access: {
            reads: ['Only the sites and libraries you choose'],
            writes: ['Nothing'],
            never: ['Changes your SharePoint content or permissions'],
        },
        who: ADMIN,
    },

    teams: {
        summary: 'Get Opstead’s alerts where your team already talks, instead of one more place to check.',
        uses: [
            { title: 'Agent alerts in a channel', text: 'Deadline warnings, overdue payments and operations alerts are posted to the Teams channel you choose.' },
            { title: 'Daily summary', text: 'A short morning summary of what needs attention today.' },
        ],
        setup: [
            'Click Connect and sign in with Microsoft.',
            'Choose a team and channel, for example Finance.',
            'Pick which alerts to send there.',
        ],
        tips: ['Send finance alerts and project alerts to different channels, so each team sees only its own.'],
        access: {
            reads: ['The list of your teams and channels'],
            writes: ['Messages in the channels you choose'],
            never: ['Reads your chats or channel messages'],
        },
        who: ADMIN,
    },

    notion: {
        summary: 'If your company keeps its wiki, SOPs or meeting notes in Notion, bring them into Opstead so the agents can use them.',
        uses: [
            { title: 'Wiki into the Library', text: 'The Notion pages you share are added to the Library and Neurals.' },
            { title: 'Grounded answers', text: 'Ask EdgeAI “what is our leave policy?” and it answers from your Notion page, with a link to it.' },
            { title: 'Stays current', text: 'Edited pages are read again each day.' },
        ],
        setup: [
            'Click Connect and sign in to Notion.',
            'In Notion’s screen, tick the pages to share with Opstead. Sub-pages come along.',
            'Choose which Library register they go into.',
        ],
        tips: [
            'Share a top-level “Company Wiki” page rather than single pages.',
            'Leave out personal or draft pages. Only what you tick is shared.',
        ],
        access: {
            reads: ['Only the pages you tick in Notion, and their sub-pages'],
            writes: ['Nothing'],
            never: ['Sees pages you did not share', 'Edits your Notion workspace'],
        },
        who: ADMIN,
    },

    apollo: {
        summary: 'For teams that use Apollo.io: fuller client, lead and vendor records, the right people to talk to, and better deal insight, without copying data across.',
        uses: [
            { title: 'Fill in company details', text: 'On a client, lead or vendor form, Fill From Apollo adds the website, industry, address and country, and keeps the company’s size, headcount growth, revenue and LinkedIn with the record. Only blank fields are filled.' },
            { title: 'Find the right people', text: 'On a client’s page or a CRM lead, Find People lists the owners, founders, directors and heads there. Add as Contact saves one to Contact Persons with their work email.' },
            { title: 'Better deal insight', text: 'The Deal Intelligence Agent ranks a lead higher when Apollo shows the company hiring fast: 10% more people in six months.' },
            { title: 'Automatic, if you want', text: 'Turn on automatic fill-in and every new client or lead with a website or business email is looked up once, as it is added.' },
        ],
        setup: [
            'In Apollo, open Settings → Integrations → API Keys and create a key. Turn on Organization Enrichment, Organization Search, People API Search and People Enrichment for it, or make it a master key.',
            'Paste the key here and click Add API Key. Opstead checks it with Apollo, stores it encrypted and never shows it again.',
            'Choose whether new clients and leads are filled in automatically or only when someone asks.',
        ],
        tips: [
            'Looking up a company uses 1 Apollo credit, and so does adding a person as a contact. Finding people is free. The panel shows the credits used in the last 30 days.',
            'Choose “Only When Someone Asks” to control spending. Automatic fill-in never looks the same company up twice.',
            'A business email works as well as a website. Gmail, Yahoo and other personal addresses are skipped, because they say nothing about the company.',
            'Click Refresh on a client’s Company Details to update its size and growth before an important pitch.',
        ],
        access: {
            reads: ['Company details for the websites, email domains or names you look up', 'Names, titles and work emails of the people you add'],
            writes: ['Nothing in Apollo', 'Company details and contact persons on your clients and vendors, only blank fields'],
            never: ['Sends invoices, ledgers, notes or your client list to Apollo', 'Looks up a company nobody asked about, unless automatic fill-in is on'],
        },
        who: 'An owner or admin connects it once for the whole company and chooses when it runs. Members can look companies up; viewers can only see the details.',
    },

    whatsapp: {
        summary: 'Most clients in India answer WhatsApp faster than email. Send invoices, receipts and reminders where they will actually be read.',
        uses: [
            { title: 'Invoices on WhatsApp', text: 'Send the invoice PDF and its amount to the client’s number with one click.' },
            { title: 'Payment reminders', text: 'Polite, pre-approved reminder messages for overdue invoices, sent by you or on a schedule.' },
            { title: 'Receipts', text: 'When you record a receipt, the client gets a thank-you with the receipt attached.' },
        ],
        setup: [
            'You need a WhatsApp Business account with a number not used in the WhatsApp phone app.',
            'Click Connect and sign in with Facebook to link your business account.',
            'Meta approves the message templates Opstead uses. This usually takes a day.',
        ],
        tips: [
            'Use a dedicated company number, not someone’s personal phone.',
            'WhatsApp only allows approved templates when the client has not messaged you in 24 hours, so reminders always use those.',
            'Meta charges a small fee per conversation, billed to your business account.',
        ],
        access: {
            reads: ['Delivery and read status of messages Opstead sends'],
            writes: ['Messages you send from Opstead'],
            never: ['Reads your other WhatsApp chats'],
        },
        who: ADMIN,
    },

    bank_feeds: {
        summary: 'See your bank transactions in Opstead and match them to invoices and payments, through India’s RBI-regulated Account Aggregator system.',
        uses: [
            { title: 'Bank reconciliation', text: 'Each bank entry is matched to a ledger entry. Anything unmatched is flagged, so your books equal your bank.' },
            { title: 'Receipts found for you', text: 'A client payment in the bank is matched to its open invoice, and Opstead suggests Mark Paid.' },
            { title: 'Vendor payments checked', text: 'Debits are matched to the vendor payments you recorded, so missing entries surface quickly.' },
        ],
        setup: [
            'Click Connect and choose your bank.',
            'Approve the consent in an Account Aggregator app (such as OneMoney or Finvu) with your mobile number and OTP.',
            'Choose how long the consent lasts. You can revoke it anytime from the same app.',
        ],
        tips: [
            'Connect your main current account first. Add others once matching looks right.',
            'Review unmatched entries weekly. It takes minutes, instead of a day at month end.',
        ],
        access: {
            reads: ['Statements and balances for the accounts you consent to'],
            writes: ['Nothing'],
            never: ['Moves money or makes payments', 'Sees your bank password or login'],
        },
        who: 'Only an owner can connect bank accounts.',
    },

    gst: {
        summary: 'Stay on the right side of GST without the spreadsheet work: check GSTINs, and catch input tax credit mismatches before you file.',
        uses: [
            { title: 'Check a GSTIN', text: 'Type a GSTIN when adding a client or vendor and Opstead fills in the legal name, address and whether it is active.' },
            { title: 'GSTR-2B against your bills', text: 'Your purchase bills are compared with GSTR-2B every month, showing bills a vendor has not filed and credits you might lose.' },
            { title: 'Smarter deadline alerts', text: 'The Compliance and Deadline Agent can tell what you have and haven’t filed.' },
        ],
        setup: [
            'On the GST portal, turn on API access under My Profile → Manage API Access.',
            'Click Connect here, enter your GSTIN and username, and confirm with the OTP the portal sends.',
            'The portal asks for an OTP again every few days. Opstead reminds you when it does.',
        ],
        tips: [
            'Run the 2B check before the 20th, so you have time to follow up with vendors.',
            'GSTIN check works without connecting. Connect only for the 2B comparison.',
        ],
        access: {
            reads: ['GSTIN details', 'Your GSTR-2B and filing status'],
            writes: ['Nothing. Opstead does not file returns for you.'],
            never: ['Stores your GST portal password'],
        },
        who: 'An owner or admin connects it, with the OTP from the GST-registered mobile number.',
    },

    tally: {
        summary: 'Keep your accountant in TallyPrime while you run the business in Opstead. No double entry.',
        uses: [
            { title: 'Vouchers to Tally', text: 'Sales, purchases, receipts and payments are sent to TallyPrime as vouchers, with ledgers and GST details.' },
            { title: 'Ledger mapping', text: 'Map Opstead’s clients, vendors and categories to your Tally ledgers once. Opstead remembers the mapping.' },
        ],
        setup: [
            'Map Opstead accounts to your Tally ledgers.',
            'Choose a period and download the Tally import file.',
            'In TallyPrime, import it under Import → Transactions. A direct sync will follow later.',
        ],
        tips: [
            'Send the file every month on a fixed date, after you finish reconciling.',
            'Let your accountant check the ledger mapping the first time.',
        ],
        access: {
            reads: ['Nothing from Tally'],
            writes: ['Only the import file you download'],
            never: ['Changes anything in Tally without you importing it'],
        },
        who: ADMIN,
    },

    razorpay: {
        summary: 'Get paid faster: every client invoice can carry a link to pay by UPI, card or net banking, and the receipt records itself.',
        uses: [
            { title: 'Pay link on invoices', text: 'A Razorpay link is added to the invoice, the email and the client portal. You choose which invoices get one.' },
            { title: 'Receipts record themselves', text: 'When the client pays, Opstead records the receipt against that invoice and marks it paid.' },
            { title: 'Fees stay visible', text: 'Razorpay’s fee is recorded separately, so your ledger matches what reaches your bank.' },
        ],
        setup: [
            'Click Connect and sign in to your Razorpay account.',
            'Choose which invoices get a pay link: all, or only the ones you pick.',
            'Send yourself a test invoice and pay a small amount to check it.',
        ],
        tips: [
            'Razorpay charges a fee per payment. For large B2B invoices, keep bank transfer as an option too.',
            'Payments are still made to your Razorpay account. Opstead never holds the money.',
        ],
        access: {
            reads: ['Payment status for links Opstead creates'],
            writes: ['Payment links for your invoices'],
            never: ['Issues refunds or moves your settlements'],
        },
        who: 'Only an owner can connect Razorpay.',
    },

    bills_inbox: {
        summary: 'Your company gets its own email address. Forward vendor invoices to it and each one becomes a draft bill. Works with any email provider.',
        uses: [
            { title: 'Invoices become draft bills', text: 'Opstead reads the PDF or image, fills in vendor, date, amounts and GST, and waits for you to approve.' },
            { title: 'Works with any email', text: 'Gmail, Outlook, Zoho, or vendors who send to it directly.' },
            { title: 'The file is kept', text: 'The original invoice is attached to the bill, so audits are easy.' },
        ],
        setup: [
            'Turn it on to get your company’s address.',
            'Forward an invoice to it, or ask vendors to copy it on their invoices.',
            'Review the draft in Purchase Bills and approve it.',
        ],
        tips: [
            'Set an automatic forwarding rule in your email for messages with “invoice” in them.',
            'Only senders you allow are accepted, so spam never becomes a bill.',
        ],
        access: {
            reads: ['Emails sent to your Bills Inbox address'],
            writes: ['Draft bills, for you to approve'],
            never: ['Posts anything to the ledger without your approval'],
        },
        who: ADMIN,
    },
};
