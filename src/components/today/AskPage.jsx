import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bell, FolderKanban, CheckSquare, Search, Plug } from 'lucide-react';
import Copilot from '../assistant/Copilot';
import { useAssistant } from '../assistant/assistantStore';
import { useOrg } from '../../context/OrgContext';
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
import { useAutomation } from '../agents/automation';
import '../agents/agents.css';
import EdgeBrain from '../brain/EdgeBrain';
import * as brain from '../../services/brainService';
import NeuralsActivation from './NeuralsActivation';

/* ══════════════════════════════════════════════════════════════════════════
   AI: EdgeAI as a page of its own, in four parts behind one switch.

   · Ask         the copilot's conversation, history and action cards (the
                 same chats the dock and the full-screen workspace show). Its
                 empty state is a greeting, the composer and a few starters.
   · Agents      the agents that work for the company, added one at a time.
                 The first is Compliance and Deadline Agent (components/agents/). An agent
                 opens on its own page: ?agent=<id>, so a notification can
                 link straight to it.
   · Connectors  outside services EdgeAI can read from. Empty for now.
   · Neurals     the company brain (components/brain/): the knowledge graph
                 EdgeAI reasons over, with its dock, inside the pane's width.

   Until the company has Neurals the page is only NeuralsActivation: the
   switch and the chat history stay hidden, and every tab opens once it is
   built (see useNeuralsGate).

   Nothing here decides what a message means. Every chip either sends a plain
   sentence to the model or starts one in the box for the person to finish;
   the model reads it and chooses what to do.
   ══════════════════════════════════════════════════════════════════════════ */

const VIEWS = [
    { id: 'ask', label: 'Ask' },
    { id: 'agents', label: 'Agents' },
    { id: 'connectors', label: 'Connectors' },
    { id: 'neurals', label: 'Neurals' },
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

/* The graph needs a height to fill, so the pane is a column whose frame takes
   what is left under the title, at the same width as Agents and Connectors. */
function NeuralsView() {
    return (
        <div className="ask-pane ask-neurals eo-scroll">
            <div className="ask-pane-inner">
                <div className="ask-pane-head"><h2>Neurals</h2></div>
                <div className="ask-neurals-frame"><EdgeBrain /></div>
            </div>
        </div>
    );
}

const AGENTS = [DEADLINE_AGENT, BI_AGENT, KNOWLEDGE_AGENT, DEAL_AGENT, OPS_AGENT];

function AgentsView({ onOpen }) {
    // One status call for every card's "run automatically" switch.
    const auto = useAutomation();
    return (
        <div className="ask-pane eo-scroll">
            <div className="ask-pane-inner">
                <div className="ask-pane-head"><h2>Agents</h2><span className="ag-badge">{AGENTS.length}</span></div>
                {auto.error && <div className="ag-flash is-neg ag-auto-err" role="alert"><span>{auto.error}</span></div>}
                <div className="ag-grid">
                    <DeadlineWatchCard auto={auto} onOpen={() => onOpen(DEADLINE_AGENT.id)} />
                    <BusinessIntelCard auto={auto} onOpen={() => onOpen(BI_AGENT.id)} />
                    <InternalKnowledgeCard auto={auto} onOpen={() => onOpen(KNOWLEDGE_AGENT.id)} />
                    <DealIntelCard auto={auto} onOpen={() => onOpen(DEAL_AGENT.id)} />
                    <OperationsMonitorCard auto={auto} onOpen={() => onOpen(OPS_AGENT.id)} />
                </div>
            </div>
        </div>
    );
}

/* ── the Neurals gate ─────────────────────────────────────────────────────
   phase: 'checking' | 'idle' (no brain yet) | 'building' | 'done' (built in
   this visit, celebrating) | 'open'. If the status cannot be read the page
   opens as before: a gate that fails shut would lock a company out of chat
   over a network blip. Orgs seen with a brain are remembered for the session
   so returning to the page does not re-check. */
const OPENED = new Set();
const MIN_BUILD_MS = 2600; // long enough for the animation to read
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

function useNeuralsGate(orgId) {
    const [gate, setGate] = useState(() => ({ phase: orgId && OPENED.has(orgId) ? 'open' : 'checking' }));
    const orgRef = useRef(orgId);
    orgRef.current = orgId;

    const countsOf = (res) => ({
        nodes: res?.visibleNodeCount || res?.state?.node_count || 0,
        edges: res?.state?.edge_count || 0,
    });

    // Waits out a build that someone else started, then celebrates it.
    const waitForBuild = useCallback(async (id) => {
        for (;;) {
            await sleep(3000);
            if (orgRef.current !== id) return;
            let res;
            try { res = await brain.getStatus(id); } catch { continue; }
            if (orgRef.current !== id) return;
            const st = res?.state?.status;
            if (st === 'building') continue;
            if (!st || st === 'absent') { setGate({ phase: 'idle', canBuild: !!res?.can?.build }); return; }
            OPENED.add(id);
            setGate({ phase: 'done', counts: countsOf(res) });
            return;
        }
    }, []);

    useEffect(() => {
        if (!orgId) { setGate({ phase: 'open' }); return; }
        if (OPENED.has(orgId)) { setGate({ phase: 'open' }); return; }
        setGate({ phase: 'checking' });
        brain.getStatus(orgId).then((res) => {
            if (orgRef.current !== orgId) return;
            const st = res?.state?.status;
            if (!st || st === 'absent') setGate({ phase: 'idle', canBuild: !!res?.can?.build });
            else if (st === 'building') { setGate({ phase: 'building' }); waitForBuild(orgId); }
            else { OPENED.add(orgId); setGate({ phase: 'open' }); }
        }).catch(() => {
            if (orgRef.current === orgId) setGate({ phase: 'open' });
        });
    }, [orgId, waitForBuild]);

    const activate = useCallback(async () => {
        const id = orgId;
        setGate({ phase: 'building' });
        const started = Date.now();
        try {
            const res = await brain.buildBrain(id);
            if (res?.skipped) { waitForBuild(id); return; }
            const status = await brain.getStatus(id).catch(() => null);
            await sleep(Math.max(0, MIN_BUILD_MS - (Date.now() - started)));
            if (orgRef.current !== id) return;
            OPENED.add(id);
            setGate({ phase: 'done', counts: status ? countsOf(status) : null });
        } catch (e) {
            if (orgRef.current !== id) return;
            setGate({ phase: 'idle', canBuild: true, error: e.message || 'Activation did not complete. Try again.' });
        }
    }, [orgId, waitForBuild]);

    const finish = useCallback(() => setGate({ phase: 'open' }), []);
    return { ...gate, activate, finish };
}

export default function AskPage({ theme = 'dark' }) {
    const { activeOrg } = useOrg();
    const a = useAssistant();
    const [params, setParams] = useSearchParams();
    const agent = AGENTS.some((x) => x.id === params.get('agent')) ? params.get('agent') : null;
    const view = agent ? 'agents' : (VIEWS.some((v) => v.id === params.get('view')) ? params.get('view') : 'ask');
    // The company, never a name pulled from the sign-in email.
    const name = activeOrg?.company_name || activeOrg?.name || 'there';
    const gate = useNeuralsGate(activeOrg?.id);

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
                        : view === 'neurals'
                            ? <NeuralsView />
                            : null;

    if (gate.phase !== 'open') {
        const activation = gate.phase === 'checking'
            ? <div className="ask-pane" aria-busy="true" />
            : (
                <NeuralsActivation
                    phase={gate.phase} canBuild={!!gate.canBuild} error={gate.error}
                    counts={gate.counts} onActivate={gate.activate} onContinue={gate.finish}
                />
            );
        return <Copilot variant="page" theme={theme} pane={activation} />;
    }

    return (
        <Copilot
            variant="page" theme={theme} switcher={switcher} pane={pane}
            welcome={({ a: ai, composer }) => <AskHero a={ai} composer={composer} name={name} />}
        />
    );
}
