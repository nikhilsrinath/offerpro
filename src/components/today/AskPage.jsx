import React from 'react';
import { ArrowRight, Bell, Wallet, CheckSquare, Search, MessageSquare } from 'lucide-react';
import Copilot from '../assistant/Copilot';
import { useAuth } from '../../context/AuthContext';
import { useOrg } from '../../context/OrgContext';
import { useHubData } from '../hub/useHubData';
import { headline } from '../hub/format';

/* ══════════════════════════════════════════════════════════════════════════
   Ask: EdgeAI as a page of its own. The conversation, its history and its
   action cards are the copilot's (the same chats the dock and the full-screen
   workspace show); what this page adds is the empty state: a composer in the
   middle, a few things to do with live counts on them, and questions worth
   asking about what is actually in the books.

   Nothing here decides what a message means. Every tile and chip either sends
   a plain sentence to the model or starts one in the box for the person to
   finish; the model reads it and chooses what to do.
   ══════════════════════════════════════════════════════════════════════════ */

const focusComposer = () => {
    const el = document.querySelector('.cp-page .cp-composer textarea');
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
};

function AskHero({ a, composer, name, hub }) {
    const overdue = hub.money.overdue || [];
    const tasks = hub.team.tasks;
    const busy = a.streaming;
    const start = (text) => { a.setDraft(text); setTimeout(focusComposer, 0); };

    const tiles = [
        {
            id: 'chase', icon: Bell, tone: overdue.length ? 'is-neg' : 'is-mut', title: 'Chase Payments',
            sub: overdue.length ? `${overdue.length} overdue · ${headline(hub.money.overdueValue)}` : 'Nothing overdue right now',
            run: () => a.send('Which invoices are overdue, and who should I chase first?'),
        },
        {
            id: 'money', icon: Wallet, tone: 'is-acc', title: 'Record Money',
            sub: 'Money in or out, into the ledger',
            run: () => start('Record '),
        },
        {
            id: 'task', icon: CheckSquare, tone: tasks.overdue ? 'is-neg' : 'is-acc', title: 'Create a Task',
            sub: tasks.open ? `${tasks.open} open · ${tasks.overdue} overdue` : 'Assign it and set a due date',
            run: () => start('Create a task to '),
        },
        {
            id: 'find', icon: Search, tone: 'is-mut', title: 'Find a Document',
            sub: 'Contracts, letters, invoices',
            run: () => start('Find '),
        },
    ];

    const questions = [
        overdue.length ? 'How much money are we owed, and by whom?' : null,
        'Which projects are at risk?',
        tasks.overdue ? 'Which tasks are overdue, and who owns them?' : null,
        'How much runway do we have?',
        'Summarise this week',
        'Who is over capacity?',
    ].filter(Boolean).slice(0, 5);

    const recent = a.chats
        .filter((c) => c.messages.length && c.id !== a.activeId)
        .sort((x, y) => (y.at || 0) - (x.at || 0))
        .slice(0, 3);

    return (
        <div className="ask-hero eo-scroll">
            <div className="ask-hero-inner">
                <div className="ask-head">
                    <div className="cp-big-orb" aria-hidden="true" />
                    <h2>What do you need, {name}?</h2>
                    <p>Ask about your company, or tell EdgeAI what to do. Answers come from your live records, and nothing is changed until you confirm it.</p>
                </div>

                {composer}
                <div className="ask-note">
                    <span className="ask-live"><i aria-hidden="true" />Company data connected</span>
                    <span aria-hidden="true">·</span>
                    <span>Enter to send · Shift + Enter for a new line</span>
                </div>

                <h3 className="ask-label">Do Something</h3>
                <div className="ask-tiles">
                    {tiles.map((x) => {
                        const Icon = x.icon;
                        return (
                            <button key={x.id} type="button" className="ask-tile" onClick={x.run} disabled={busy}>
                                <span className={`ask-tile-ico ${x.tone}`} aria-hidden="true"><Icon size={16} strokeWidth={2} /></span>
                                <span><span className="ask-tile-t">{x.title}</span><span className="ask-tile-s">{x.sub}</span></span>
                            </button>
                        );
                    })}
                </div>

                <h3 className="ask-label">Or Ask</h3>
                <div className="ask-asks" role="group" aria-label="Suggested questions">
                    {questions.map((q) => (
                        <button key={q} type="button" className="ask-ask" onClick={() => a.send(q)} disabled={busy}>
                            <ArrowRight size={14} strokeWidth={2.2} aria-hidden="true" />{q}
                        </button>
                    ))}
                </div>

                {recent.length > 0 && (
                    <>
                        <h3 className="ask-label">Continue a Recent Chat</h3>
                        <div className="cp-recent">
                            {recent.map((c) => (
                                <button key={c.id} type="button" onClick={() => a.pickChat(c.id)}>
                                    <MessageSquare size={14} strokeWidth={1.8} aria-hidden="true" style={{ flex: 'none' }} />
                                    <span className="cp-t">{c.title}</span>
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default function AskPage({ theme = 'dark' }) {
    const { user } = useAuth();
    const { activeOrg } = useOrg();
    const hub = useHubData(activeOrg, '12M', { lite: true });
    const raw = (user?.email || 'there').split('@')[0];
    const name = raw.charAt(0).toUpperCase() + raw.slice(1);

    return (
        <Copilot
            variant="page" theme={theme}
            welcome={({ a, composer }) => <AskHero a={a} composer={composer} name={name} hub={hub} />}
        />
    );
}
