import { Inbox, Landmark, FileCheck2, Mic, TrendingUp } from 'lucide-react';
import googleCalendar from '../../assets/connectors/google-calendar.svg';
import googleMeet from '../../assets/connectors/google-meet.svg';
// Brand marks from Simple Icons (CC0 icon data), in each brand's colour.
import slack from '../../assets/connectors/slack.svg';
import zoom from '../../assets/connectors/zoom.svg';
import calendly from '../../assets/connectors/calendly.svg';
import miro from '../../assets/connectors/miro.svg';
import canva from '../../assets/connectors/canva.svg';
import adobe from '../../assets/connectors/adobe.svg';
import mailchimp from '../../assets/connectors/mailchimp.svg';
import semrush from '../../assets/connectors/semrush.svg';
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
    { id: 'communication', label: 'Communication & Scheduling' },
    { id: 'design', label: 'Design & Collaboration' },
    { id: 'marketing', label: 'Marketing & SEO' },
    { id: 'knowledge', label: 'Knowledge' },
    { id: 'sales', label: 'Sales' },
    { id: 'india', label: 'Finance and Compliance' },
    { id: 'opstead', label: 'Built Into Opstead' },
];

export const CONNECTORS = [
    // Google Workspace: Gmail first.
    { id: 'gmail', group: 'google', name: 'Gmail', logo: gmail, status: 'soon',
        desc: 'Send invoices and payment reminders from your own address.' },
    { id: 'google_calendar', group: 'google', name: 'Google Calendar', logo: googleCalendar, status: 'soon',
        desc: 'Puts GST, TDS and project deadlines on your calendar and shows today’s meetings on Today.' },
    { id: 'google_meet', group: 'google', name: 'Google Meet', logo: googleMeet, status: 'soon',
        desc: 'Adds Meet links to events, and shows client meetings on the client and project.' },
    { id: 'google_drive', group: 'google', name: 'Google Drive', logo: googleDrive, status: 'soon',
        desc: 'Pick files to add to the Library and Neurals, or attach them to projects, clients and vendors.' },
    { id: 'google_sheets', group: 'google', name: 'Google Sheets', logo: googleSheets, status: 'soon',
        desc: 'Export ledgers and reports to a sheet, and import clients, vendors and employees from one.' },
    { id: 'google_docs', group: 'google', name: 'Google Docs', logo: googleDocs, status: 'soon',
        desc: 'Open agreements and quotations as editable Docs, and bring Docs into the Library.' },

    // Microsoft 365: one Microsoft sign-in covers all four.
    { id: 'outlook', group: 'microsoft', name: 'Outlook', logo: outlook, status: 'soon',
        desc: 'Vendor invoices in your inbox become draft bills, and deadlines go on your Outlook calendar.' },
    { id: 'onedrive', group: 'microsoft', name: 'OneDrive', logo: onedrive, status: 'soon',
        desc: 'Pick files to add to the Library and Neurals, or attach them to records.' },
    { id: 'sharepoint', group: 'microsoft', name: 'SharePoint', logo: sharepoint, status: 'soon',
        desc: 'Bring company sites and document libraries into the Library.' },
    { id: 'teams', group: 'microsoft', name: 'Microsoft Teams', logo: teams, status: 'soon',
        desc: 'Posts agent alerts and deadline reminders to a channel.' },

    // Communication & Scheduling
    { id: 'slack', group: 'communication', name: 'Slack', logo: slack, status: 'soon',
        desc: 'Posts agent alerts, deadline reminders and approvals to the channels you choose.' },
    { id: 'zoom', group: 'communication', name: 'Zoom', logo: zoom, status: 'soon',
        desc: 'Adds Zoom links to events, and shows client meetings on the client and project.' },
    { id: 'calendly', group: 'communication', name: 'Calendly', logo: calendly, status: 'soon',
        desc: 'Meetings booked on your Calendly links show on the client or lead, and on your calendar.' },
    { id: 'wispr_flow', group: 'communication', name: 'Wispr Flow', icon: Mic, cta: 'Set Up', status: 'soon',
        desc: 'Dictate notes, tasks and questions to OpsteadAI by voice, in any text box.' },

    // Design & Collaboration
    { id: 'miro', group: 'design', name: 'Miro', logo: miro, status: 'soon',
        desc: 'Links Miro boards to projects, and turns the sticky notes you pick into tasks.' },
    { id: 'canva', group: 'design', name: 'Canva', logo: canva, status: 'soon',
        desc: 'Links proposals and decks to clients and projects, with your brand details filled in.' },
    { id: 'adobe', group: 'design', name: 'Adobe', logo: adobe, status: 'soon',
        desc: 'Sends agreements for signature with Adobe Acrobat Sign, and files the signed copy.' },

    // Marketing & SEO
    { id: 'mailchimp', group: 'marketing', name: 'Intuit Mailchimp', logo: mailchimp, status: 'soon',
        desc: 'Keeps a Mailchimp audience of the clients and leads you choose, and shows who opened your campaigns.' },
    { id: 'semrush', group: 'marketing', name: 'Semrush', logo: semrush, cta: 'Add API Key', status: 'soon',
        desc: 'Search traffic and keyword positions for your clients’ websites, for reports.' },
    { id: 'ahrefs', group: 'marketing', name: 'Ahrefs', icon: TrendingUp, cta: 'Add API Key', status: 'soon',
        desc: 'Backlinks and search figures for your clients’ websites, for reports.' },

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
