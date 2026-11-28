/* The AI page's four parts. App.jsx shows them as the page heading's tabs,
   like every module's; AskPage shows the part the path names. An agent's
   own page (/ai/agents/<name>) lights Agents. */

export const AI_VIEWS = [
    { id: 'ask', label: 'Ask' },
    { id: 'agents', label: 'Agents' },
    { id: 'connectors', label: 'Connectors' },
    { id: 'neurals', label: 'Neurals' },
];

export function aiTabs(pathname) {
    const sub = pathname.split('/')[2] || 'ask';
    return AI_VIEWS.map((v) => ({ id: 'ai-' + v.id, label: v.label, to: '/ai/' + v.id, active: v.id === sub }));
}
