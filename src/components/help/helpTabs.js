/* Help & Support's four parts, and which one a path is on. App.jsx shows them
   as the page heading's tabs; HelpPage shows the part the path names. */

export const PARTS = [
    { id: 'overview', label: 'Overview' },
    { id: 'guides', label: 'Page Guides' },
    { id: 'faqs', label: 'FAQs' },
    { id: 'contact', label: 'Contact Us' },
];
export const partOf = (pathname) => {
    const p = pathname.split('/')[2] || 'overview';
    return PARTS.some((x) => x.id === p) ? p : 'overview';
};

/** The four parts as the page heading's tabs (App.jsx hands them to ModuleShell),
    so they sit under the heading, fixed, like every other module's. */
export function helpTabs(pathname) {
    const part = partOf(pathname);
    return PARTS.map((x) => ({
        id: 'help-' + x.id, label: x.label, to: x.id === 'overview' ? '/help' : '/help/' + x.id, active: x.id === part,
    }));
}
