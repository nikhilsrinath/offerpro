import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bell, FolderKanban, CheckSquare, Search, Plug } from 'lucide-react';
import Copilot from '../assistant/Copilot';
import { useAssistant } from '../assistant/assistantStore';
import { useAuth } from '../../context/AuthContext';
import DeadlineWatch, { DeadlineWatchCard } from '../agents/DeadlineWatch';
import { DEADLINE_AGENT } from '../agents/deadlineAgent';
import BusinessIntel, { BusinessIntelCard } from '../agents/BusinessIntel';
import { BI_AGENT } from '../agents/bizAgent';
import InternalKnowledge, { InternalKnowledgeCard } from '../agents/InternalKnowledge';
import { KNOWLEDGE_AGENT } from '../agents/knowledgeAgent';
import DealIntel, { DealIntelCard } from '../agents/DealIntel';
import { DEAL_AGENT } from '../agents/dealAgent';
import OperationsMonitor, { OperationsMonitorCard } from '../agents/OperationsMonitor';
import { OPS_AGENT } from '../agents/opsAgent';
import '../agents/agents.css';

/* ══════════════════════════════════════════════════════════════════════════
   Ask: EdgeAI as a page of its own, in three parts behind one switch.

   · Ask         the copilot's conversation, history and action cards (the
                 same chats the dock and the full-screen workspace show). Its
                 empty state is a greeting, the composer and a few starters.
   · Agents      the agents that work for the company, added one at a time.
                 The first is Compliance and Deadline Agent (components/agents/). An agent
                 opens on its own page: ?agent=<id>, so a notification can
                 link straight to it.
   · Connectors  outside services EdgeAI can read from. Empty for now.

   Nothing here decides what a message means. Every chip either sends a plain
   sentence to the model or starts one in the box for the person to finish;
   the model reads it and chooses what to do.
   ══════════════════════════════════════════════════════════════════════════ */

const VIEWS = [
    { id: 'ask', label: 'Ask' },
    { id: 'agents', label: 'Agents' },
    { id: 'connectors', label: 'Connectors' },
];

const focusComposer = () => {
    const el = document.querySelector('.cp-page .cp-composer textarea');
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
};

function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
}

function AskHero({ a, composer, name }) {
    const busy = a.streaming;
    const start = (text) => { a.setDraft(text); setTimeout(focusComposer, 0); };

    const chips = [
        { id: 'chase', icon: Bell, label: 'Chase Payments', run: () => a.send('Which invoices are overdue, and who should I chase first?') },
        { id: 'projects', icon: FolderKanban, label: 'Project Status', run: () => a.send('Which projects are falling behind?') },
        { id: 'task', icon: CheckSquare, label: 'Create a Task', run: () => start('Create a task to ') },
        { id: 'find', icon: Search, label: 'Find a Document', run: () => start('Find ') },
    ];

    return (
        <div className="ask-hero eo-scroll">
            <div className="ask-hero-inner">
                <h2 className="ask-greet">{greeting()}, {name}</h2>
                {composer}
                <div className="ask-chips" role="group" aria-label="Quick starts">
                    {chips.map((c) => {
                        const Icon = c.icon;
                        return (
                            <button key={c.id} type="button" className="ask-chip" onClick={c.run} disabled={busy}>
                                <Icon size={15} strokeWidth={2} aria-hidden="true" />{c.label}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function EmptyView({ icon: Icon, title, text }) {
    return (
        <div className="ask-pane eo-scroll">
            <div className="ask-pane-inner">
                <div className="ask-pane-head"><h2>{title}</h2></div>
                <div className="ask-empty">
                    <span className="ask-empty-ico" aria-hidden="true"><Icon size={20} strokeWidth={1.8} /></span>
                    <p>{text}</p>
                </div>
            </div>
        </div>
    );
}

const AGENTS = [DEADLINE_AGENT, BI_AGENT, KNOWLEDGE_AGENT, DEAL_AGENT, OPS_AGENT];

function AgentsView({ onOpen }) {
    return (
        <div className="ask-pane eo-scroll">
            <div className="ask-pane-inner">
                <div className="ask-pane-head"><h2>Agents</h2><span className="ag-badge">{AGENTS.length}</span></div>
                <div className="ag-grid">
                    <DeadlineWatchCard onOpen={() => onOpen(DEADLINE_AGENT.id)} />
                    <BusinessIntelCard onOpen={() => onOpen(BI_AGENT.id)} />
                    <InternalKnowledgeCard onOpen={() => onOpen(KNOWLEDGE_AGENT.id)} />
                    <DealIntelCard onOpen={() => onOpen(DEAL_AGENT.id)} />
                    <OperationsMonitorCard onOpen={() => onOpen(OPS_AGENT.id)} />
                </div>
            </div>
        </div>
    );
}

export default function AskPage({ theme = 'dark' }) {
    const { user } = useAuth();
    const a = useAssistant();
    const [params, setParams] = useSearchParams();
    const agent = AGENTS.some((x) => x.id === params.get('agent')) ? params.get('agent') : null;
    const view = agent ? 'agents' : (VIEWS.some((v) => v.id === params.get('view')) ? params.get('view') : 'ask');
    const raw = (user?.email || 'there').split('@')[0];
    const name = raw.charAt(0).toUpperCase() + raw.slice(1);

    const go = (next, agentId = null) => {
        // Back on Ask, an agent's conversation gives way to an ordinary chat.
        if (next === 'ask' && a.active.agent) a.startChat();
        const p = {};
        if (agentId) p.agent = agentId;
        else if (next !== 'ask') p.view = next;
        setParams(p);
    };

    const switcher = (
        <div className="cp-tabs ask-switch" role="tablist" aria-label="Section">
            {VIEWS.map((v) => (
                <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => go(v.id)}>
                    {v.label}
                </button>
            ))}
        </div>
    );

    const pane = agent === DEADLINE_AGENT.id
        ? <DeadlineWatch theme={theme} onBack={() => go('agents')} />
        : agent === BI_AGENT.id
            ? <BusinessIntel theme={theme} onBack={() => go('agents')} />
            : agent === KNOWLEDGE_AGENT.id
                ? <InternalKnowledge theme={theme} onBack={() => go('agents')} />
                : agent === DEAL_AGENT.id
                    ? <DealIntel theme={theme} onBack={() => go('agents')} />
                    : agent === OPS_AGENT.id
                    ? <OperationsMonitor theme={theme} onBack={() => go('agents')} />
                    : view === 'agents'
                    ? <AgentsView onOpen={(id) => go('agents', id)} />
                    : view === 'connectors'
                        ? <EmptyView icon={Plug} title="Connectors" text="No connectors yet. Connected services will appear here." />
                        : null;

    return (
        <Copilot
            variant="page" theme={theme} switcher={switcher} pane={pane}
            welcome={({ a: ai, composer }) => <AskHero a={ai} composer={composer} name={name} />}
        />
    );
}
