import { Inbox, Landmark, FileCheck2 } from 'lucide-react';
import googleCalendar from '../../assets/connectors/google-calendar.svg';
import googleDrive from '../../assets/connectors/google-drive.svg';
import googleSheets from '../../assets/connectors/google-sheets.svg';
import googleDocs from '../../assets/connectors/google-docs.svg';
import gmail from '../../assets/connectors/gmail.svg';
import outlook from '../../assets/connectors/outlook.svg';
import onedrive from '../../assets/connectors/onedrive.svg';
import sharepoint from '../../assets/connectors/sharepoint.svg';
import teams from '../../assets/connectors/teams.svg';
import notion from '../../assets/connectors/notion.svg';
import apollo from '../../assets/connectors/apollo.png';
import whatsapp from '../../assets/connectors/whatsapp.svg';
import razorpay from '../../assets/connectors/razorpay.svg';
import tally from '../../assets/connectors/tally.png';

/* ══════════════════════════════════════════════════════════════════════════
   The services Opstead can connect to, shown on AI → Connectors.

   A connector has a brand `logo` (the service's own mark, from
   assets/connectors/; `wide` for a wordmark) or, when it is not a brand, a
   lucide `icon`, and `cta` when its button is not "Connect". `status`
   is 'soon' until its sign-in and sync exist: the card still opens its guide
   (connectorGuides.js), but Connect stays disabled. 'live' connectors have a
   working Connection section in their panel (ConnectorsView.jsx). Groups
   render in the order of GROUPS.
   ══════════════════════════════════════════════════════════════════════════ */

export const GROUPS = [
    { id: 'google', label: 'Google Workspace' },
    { id: 'microsoft', label: 'Microsoft 365' },
    { id: 'knowledge', label: 'Knowledge' },
    { id: 'sales', label: 'Sales' },
    { id: 'india', label: 'Finance and Compliance' },
    { id: 'opstead', label: 'Built Into Opstead' },
];

export const CONNECTORS = [
    // Google Workspace
    { id: 'google_calendar', group: 'google', name: 'Google Calendar', logo: googleCalendar, status: 'soon',
        desc: 'Puts GST, TDS and project deadlines on your calendar and shows today’s meetings on Today.' },
    { id: 'google_drive', group: 'google', name: 'Google Drive', logo: googleDrive, status: 'soon',
        desc: 'Pick files to add to the Library and Neurals, or attach them to projects, clients and vendors.' },
    { id: 'google_sheets', group: 'google', name: 'Google Sheets', logo: googleSheets, status: 'soon',
        desc: 'Export ledgers and reports to a sheet, and import clients, vendors and employees from one.' },
    { id: 'google_docs', group: 'google', name: 'Google Docs', logo: googleDocs, status: 'soon',
        desc: 'Open agreements and quotations as editable Docs, and bring Docs into the Library.' },
    { id: 'gmail', group: 'google', name: 'Gmail', logo: gmail, status: 'soon',
        desc: 'Send invoices and payment reminders from your own address.' },

    // Microsoft 365: one Microsoft sign-in covers all four.
    { id: 'outlook', group: 'microsoft', name: 'Outlook', logo: outlook, status: 'soon',
        desc: 'Vendor invoices in your inbox become draft bills, and deadlines go on your Outlook calendar.' },
    { id: 'onedrive', group: 'microsoft', name: 'OneDrive', logo: onedrive, status: 'soon',
        desc: 'Pick files to add to the Library and Neurals, or attach them to records.' },
    { id: 'sharepoint', group: 'microsoft', name: 'SharePoint', logo: sharepoint, status: 'soon',
        desc: 'Bring company sites and document libraries into the Library.' },
    { id: 'teams', group: 'microsoft', name: 'Microsoft Teams', logo: teams, status: 'soon',
        desc: 'Posts agent alerts and deadline reminders to a channel.' },

    // Knowledge
    { id: 'notion', group: 'knowledge', name: 'Notion', logo: notion, status: 'soon',
        desc: 'Choose pages and wikis to add to the Library, so agents can answer from them.' },

    // Sales
    { id: 'apollo', group: 'sales', name: 'Apollo.io', logo: apollo, cta: 'Add API Key', status: 'live',
        desc: 'Fills in company details for clients, leads and vendors, finds decision makers, and feeds the Deal Intelligence Agent.' },

    // Finance and Compliance
    { id: 'whatsapp', group: 'india', name: 'WhatsApp Business', logo: whatsapp, status: 'soon',
        desc: 'Sends invoices, receipts and payment reminders to clients on WhatsApp.' },
    { id: 'bank_feeds', group: 'india', name: 'Bank Feeds', icon: Landmark, status: 'soon',
        desc: 'Reads bank statements through Account Aggregator and matches them to the General Ledger.' },
    { id: 'gst', group: 'india', name: 'GST Portal', icon: FileCheck2, status: 'soon',
        desc: 'Checks GSTINs, and matches GSTR-2B against your purchase bills.' },
    { id: 'tally', group: 'india', name: 'Tally', logo: tally, wide: true, cta: 'Set Up', status: 'soon',
        desc: 'Sends Opstead’s vouchers to TallyPrime for your accountant.' },
    { id: 'razorpay', group: 'india', name: 'Razorpay', logo: razorpay, status: 'soon',
        desc: 'Adds a pay link to client invoices and records the receipt when the client pays.' },

    // Built into Opstead
    { id: 'bills_inbox', group: 'opstead', name: 'Bills Inbox', icon: Inbox, cta: 'Turn On', status: 'soon',
        desc: 'A forwarding address for your company. Invoices sent to it become draft bills.' },
];
