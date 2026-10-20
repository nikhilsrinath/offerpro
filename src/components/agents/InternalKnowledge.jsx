import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, RefreshCw, Sparkles, FileText, FileWarning, Info, Lock, FolderOpen } from 'lucide-react';
import { useAssistant } from '../assistant/assistantStore';
import { AgentChat } from '../assistant/Copilot';
import { KNOWLEDGE_AGENT, useLibraryStatus } from './knowledgeAgent';
import { READ_STATES, libraryDocHref } from '../../shared/libraryReadability';
import { collectionOf, categoryLabel } from '../../services/libraryService';
import AgentCard from './AgentCard';
import './agents.css';

/* ══════════════════════════════════════════════════════════════════════════
   Internal Knowledge: the third agent.

   The left column is what the agent can read: the Document Library as this
   person sees it, which files are searchable and which are not (and why).
   The right column is EdgeAI in this agent's own chat, which is read-only
   (api/_lib/agent/context.js): it searches the library's passages
   (api/_lib/knowledge.js), answers from them, and cites the document and
   page or section of each claim. Nothing on this page reads a file's
   content; the list only.
   ══════════════════════════════════════════════════════════════════════════ */

const PROMPTS = [
    'What does our leave policy say?',
    'What are the payment terms in our vendor contracts?',
    'Find the document that explains our onboarding process.',
    'What are the important deadlines mentioned in our contracts?',
];

const LIBRARY = '/documents/document-library';

const fmtDay = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/* ── the card on the Agents grid ──────────────────────────────────────────── */

export function InternalKnowledgeCard({ onOpen, auto }) {
    const s = useLibraryStatus();
    return (
        <AgentCard agent={KNOWLEDGE_AGENT} auto={auto} onOpen={onOpen}>
            {!s.canView ? <span className="ag-muted">No library access</span>
                : s.loading && !s.docs ? <span className="ag-muted">Reading…</span>
                    : s.error || !s.total ? <span className="ag-muted">{s.error ? 'Open to ask' : 'No documents yet'}</span>
                        : <span className="ag-badge is-pos">{s.readable.length} searchable</span>}
        </AgentCard>
    );
}

/* ── the agent's page ─────────────────────────────────────────────────────── */

export default function InternalKnowledge({ onBack, theme = 'dark' }) {
    const s = useLibraryStatus();
    const navigate = useNavigate();
    const a = useAssistant();
    const Icon = KNOWLEDGE_AGENT.icon;

    const ask = (text) => {
        if (a.streaming) return;
        const chatId = a.openAgentChat(KNOWLEDGE_AGENT.id, KNOWLEDGE_AGENT.name);
        a.send(text, { chatId });
    };

    const partial = s.readable.filter((d) => d.read.state === 'partial').length;
    const recent = s.readable.slice(0, 6);

    return (
        <div className="ag-detail">
            <div className="ag-main eo-scroll">
                <div className="ag-dhead">
                    <button type="button" className="ag-back" onClick={onBack} aria-label="Back to agents" title="Back to agents">
                        <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <span className="ag-ico" aria-hidden="true"><Icon size={18} strokeWidth={1.9} /></span>
                    <div className="ag-dtitle">
                        <h2>{KNOWLEDGE_AGENT.name}</h2>
                        <span className="ag-sched">Answers from your Document Library · Read-only, nothing is changed</span>
                    </div>
                    <div className="ag-dactions">
                        <button type="button" className="ag-btn" onClick={() => navigate(LIBRARY)}>
                            <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />Open Library
                        </button>
                        <button type="button" className="ag-btn" onClick={s.reload} disabled={s.loading || !s.canView}>
                            <RefreshCw size={14} strokeWidth={2} aria-hidden="true" className={s.loading ? 'ag-spin' : ''} />Refresh
                        </button>
                    </div>
                </div>

                {!s.canView ? (
                    <div className="ag-empty bi-locked">
                        <Lock size={20} strokeWidth={1.8} aria-hidden="true" />
                        <p>Your role cannot view the Document Library, so this agent has nothing it may read for you. Ask an admin for access.</p>
                    </div>
                ) : (
                    <>
                        {s.error && <div className="ag-flash is-neg" role="alert"><span>{s.error}</span></div>}
                        {!s.docs && s.loading && <div className="ag-skel" style={{ height: 120 }} aria-hidden="true" />}

                        {s.docs && (
                            <>
                                <section className="ag-brief">
                                    <div className="ag-brief-text">
                                        <h3>
                                            {s.total === 0 ? 'No documents yet'
                                                : `${s.readable.length} of ${s.total} document${s.total === 1 ? '' : 's'} can be searched`}
                                        </h3>
                                        <p>
                                            {s.total === 0
                                                ? 'Upload policies, contracts, proposals or meeting notes to the Document Library. Once they are read, ask about them here.'
                                                : 'Ask in your own words. Answers come only from what these documents say, with the document and page or section of each point. When the documents do not answer it, the agent says so.'}
                                        </p>
                                    </div>
                                    {s.total > 0 ? (
                                        <button type="button" className="ag-btn is-ai" disabled={a.streaming}
                                            onClick={() => ask('What is in our document library? Group the documents by what they cover and tell me which ones could not be read.')}>
                                            <Sparkles size={14} strokeWidth={2} aria-hidden="true" />What's In It
                                        </button>
                                    ) : (
                                        <button type="button" className="ag-btn is-primary" onClick={() => navigate(LIBRARY)}>Add Documents</button>
                                    )}
                                </section>

                                {s.total > 0 && (
                                    <div className="ag-stats">
                                        <Stat label="Documents" value={s.total} />
                                        <Stat label="Searchable" value={s.readable.length} />
                                        <Stat label="Partly Read" value={partial} tone={partial ? 'warn' : ''} />
                                        <Stat label="Cannot Be Read" value={s.unreadable.length} tone={s.unreadable.length ? 'neg' : ''} />
                                    </div>
                                )}

                                {s.unreadable.length > 0 && (
                                    <section className="ag-sec">
                                        <header className="ag-sec-h">
                                            Cannot Be Read<span className="ag-sec-hint">Not searched, so the agent cannot answer from them</span>
                                        </header>
                                        {s.unreadable.slice(0, 8).map((d) => (
                                            <div key={d.id} className="ag-item">
                                                <span className="ag-item-ico is-high" aria-hidden="true"><FileWarning size={15} strokeWidth={2} /></span>
                                                <div className="ag-item-main">
                                                    <button type="button" className="ag-item-t" onClick={() => navigate(libraryDocHref(d))}>{d.title}</button>
                                                    <div className="ag-item-m">{READ_STATES[d.read.state]} · {d.file_name}</div>
                                                    <div className="ag-item-a">{d.read.note}</div>
                                                </div>
                                            </div>
                                        ))}
                                        {s.unreadable.length > 8 && <p className="ag-runs-none">and {s.unreadable.length - 8} more in the library.</p>}
                                    </section>
                                )}

                                {recent.length > 0 && (
                                    <section className="ag-sec">
                                        <header className="ag-sec-h">
                                            Recently Added<span className="ag-sec-hint">Searchable</span>
                                            <button type="button" className="ag-link" onClick={() => navigate(LIBRARY)}>All Documents</button>
                                        </header>
                                        {recent.map((d) => (
                                            <div key={d.id} className="ag-item">
                                                <span className="ag-item-ico" aria-hidden="true"><FileText size={15} strokeWidth={2} /></span>
                                                <div className="ag-item-main">
                                                    <button type="button" className="ag-item-t" onClick={() => navigate(libraryDocHref(d))}>{d.title}</button>
                                                    <div className="ag-item-m">
                                                        {collectionOf(d.collection).short} · {categoryLabel(d.category)}
                                                        {d.page_count ? ` · ${d.page_count} page${d.page_count === 1 ? '' : 's'}` : ''} · added {fmtDay(d.created_at)}
                                                        {d.read.state === 'partial' ? ' · partly read' : ''}
                                                    </div>
                                                </div>
                                                <div className="ag-item-side">
                                                    <button type="button" className="ag-mini" disabled={a.streaming} title="Ask the agent to summarise it"
                                                        onClick={() => ask(`Summarise "${d.title}": its key points, any commitments, amounts and dates it states, each with where it says so.`)}>
                                                        <Sparkles size={13} strokeWidth={2} aria-hidden="true" />Summarise
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </section>
                                )}

                                <details className="bi-about">
                                    <summary><Info size={14} strokeWidth={2} aria-hidden="true" />How Answers Are Found</summary>
                                    <ul>
                                        <li>The agent searches the text EdgeOS read out of each file when it was uploaded, and answers only from the passages it finds. It never answers a question about your company from general knowledge.</li>
                                        <li>Every point names the document and the page, slide or section it came from. Quotations are checked against the retrieved text, and one that does not match is flagged under the answer.</li>
                                        <li>The search matches words, not meaning, so the agent also tries other wordings. If it still finds nothing, it says your documents do not answer the question.</li>
                                        <li>The "added" date is when a file was uploaded, not when it was signed or took effect. EdgeOS keeps no version history for library files, so when two documents look like versions of one, the agent shows both and says which is which.</li>
                                        <li className="is-limit">Documents listed under Cannot Be Read are not searched. Re-read or replace them in the Document Library.</li>
                                        <li className="is-limit">It only reads documents your role can see, and it cannot create, change, send or approve anything.</li>
                                    </ul>
                                </details>
                            </>
                        )}
                    </>
                )}
            </div>

            <AgentChat
                agent={KNOWLEDGE_AGENT.id} title={KNOWLEDGE_AGENT.name} theme={theme}
                intro="Ask what your company's documents say: policies, contracts, proposals, procedures, meeting notes. Every answer names the document and page it comes from, and this chat never changes anything."
                prompts={PROMPTS} placeholder="Ask about a policy, contract, proposal…"
            />
        </div>
    );
}

function Stat({ label, value, tone = '' }) {
    return (
        <div className="ag-stat" style={{ cursor: 'default' }}>
            <span className={`ag-stat-v${tone ? ` is-${tone}` : ''}`}>{value}</span>
            <span className="ag-stat-l">{label}</span>
        </div>
    );
}
