// The landing page's AI section: Neurals, the company brain. Shows the app's
// own knowledge graph (brain/KnowledgeGraph) over a fictional company's data
// (brainMock.js); the domain chips highlight one part of the brain at a time.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Building2, Users, Handshake, Wallet, Package, Receipt, FileText, FolderKanban,
    Power, Share2, Sparkles, Globe, UserRound, MousePointerClick, Play, Network,
} from 'lucide-react';
import KnowledgeGraph from '../../brain/KnowledgeGraph';
import { EdgeThemeContext } from '../../../theme/EdgeTheme';
import { DOMAINS, domainOf, kindLabel } from '../../../services/brainService';
import { AiAnswer } from './ProductScreens';
import { AGENTS } from './landingData';
import { buildMockBrain } from './brainMock';

const ABOUT = {
    organization: { icon: Building2, learns: 'The company itself, its plan, and the memory Opstead keeps about how you work.' },
    people: { icon: Users, learns: 'Departments, people and who reports to whom.' },
    clients: { icon: Handshake, learns: 'Every client and lead, and everything tied to them.' },
    finance: { icon: Wallet, learns: 'Invoices, receipts and retainers, with who paid what and when.' },
    products: { icon: Package, learns: 'The products and services you sell, and which invoices include them.' },
    spend: { icon: Receipt, learns: 'Vendors, their bills and your expenses.' },
    documents: { icon: FileText, learns: 'HR letters, agreements and your document library.' },
    operations: { icon: FolderKanban, learns: 'Tasks, leave and announcements, and who they belong to.' },
};

const WHOLE = { icon: Network, learns: 'Everything Opstead knows about the company, every record linked to the ones it touches.' };

const FLOW = [
    { icon: Power, title: 'Activate Once', body: 'Neurals reads every part of your company in one pass. No setup, no tagging.' },
    { icon: Share2, title: 'It Links Everything', body: 'Each client is tied to its invoices, payments, tasks and people, so context travels with the question.' },
    { icon: Sparkles, title: 'AI Thinks With It', body: 'Answers and agents start from this map and cite the records they used. If the data is not there, it says so.' },
];

const reduced = () => typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function NeuralsSection() {
    const brain = useMemo(() => buildMockBrain(), []);
    const counts = useMemo(() => {
        const out = {};
        brain.nodes.forEach((n) => { const d = domainOf(n.kind); out[d] = (out[d] || 0) + 1; });
        return out;
    }, [brain]);

    // -1 is the whole brain; 0..7 are the domains, toured in order.
    const [i, setI] = useState(-1);
    const [auto, setAuto] = useState(() => !reduced());
    const [picked, setPicked] = useState(null);
    const graphRef = useRef(null);
    const sectionRef = useRef(null);
    const [inView, setInView] = useState(false);

    useEffect(() => {
        const el = sectionRef.current;
        if (!el || typeof IntersectionObserver === 'undefined') { setInView(true); return undefined; }
        const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.25 });
        io.observe(el);
        return () => io.disconnect();
    }, []);

    // The tour: hold each stop long enough for the camera to land and be read.
    useEffect(() => {
        if (!auto || picked || !inView) return undefined;
        const id = setTimeout(() => setI((n) => (n + 2) % (DOMAINS.length + 1) - 1), i === -1 ? 4200 : 3600);
        return () => clearTimeout(id);
    }, [auto, picked, i, inView]);

    // Move the camera to the current stop. Waits a beat on first load so the
    // layout has settled before the first glide.
    useEffect(() => {
        if (picked) return undefined;
        const go = () => {
            const g = graphRef.current;
            if (!g) return;
            if (i === -1) g.fit();
            else g.focusWhere((n) => domainOf(n.kind) === DOMAINS[i].id, 1.5);
        };
        const id = setTimeout(go, 60);
        return () => clearTimeout(id);
    }, [i, picked]);

    const domain = i === -1 ? null : DOMAINS[i];
    const match = useMemo(() => (picked || !domain ? null : (n) => domainOf(n.kind) === domain.id), [domain, picked]);
    const links = picked ? brain.edges.filter((e) => e.src_id === picked.id || e.dst_id === picked.id).length : 0;
    const about = picked ? ABOUT[domainOf(picked.kind)] : domain ? ABOUT[domain.id] : WHOLE;
    const CardIcon = about.icon;
    const stop = () => setAuto(false);
    const goTo = (k) => { stop(); setPicked(null); setI(k); };

    return (
        <section className="op-ai" id="ai" ref={sectionRef}>
            <div className="op-wrap">
                <div className="op-section-head op-ai-head">
                    <h2>Meet Neurals, The Brain<br />Behind Opstead AI</h2>
                    <p>Neurals turns your company's records into one connected map. Opstead AI thinks with it, so every answer starts from what actually happened.</p>
                </div>

                <div className="op-neurals">
                    <div className="op-brain-col">
                        <div className="op-graph" onPointerDown={stop}>
                            <EdgeThemeContext.Provider value="dark">
                                <KnowledgeGraph
                                    ref={graphRef} bare wheelZoom={false} camEase={0.045}
                                    nodes={brain.nodes} edges={brain.edges}
                                    matchFn={match} selectedId={picked?.id || null}
                                    onSelect={(n) => { stop(); setPicked(n); }}
                                    onClear={() => setPicked(null)}
                                />
                            </EdgeThemeContext.Provider>
                            <span className="op-graph-stats">{brain.nodes.length} records, {brain.edges.length} links</span>
                            {auto ? (
                                <span className="op-graph-hint"><MousePointerClick size={12} /> Drag to explore, click a node</span>
                            ) : (
                                <button type="button" className="op-graph-hint op-graph-resume" onPointerDown={(e) => e.stopPropagation()} onClick={() => { setPicked(null); setAuto(true); }}>
                                    <Play size={11} /> Resume Tour
                                </button>
                            )}
                        </div>
                        <div className="op-domains" role="group" aria-label="Parts of the brain">
                            {[{ id: 'all', label: 'Whole Brain' }, ...DOMAINS].map((d, idx) => {
                                const k = idx - 1;
                                const Icon = k === -1 ? WHOLE.icon : ABOUT[d.id].icon;
                                const on = !picked && k === i;
                                return (
                                    <button
                                        key={d.id} type="button" aria-pressed={on}
                                        className={`op-domain ${on ? 'is-active' : ''}`}
                                        onClick={() => goTo(k)}
                                    >
                                        <Icon size={13} /> {d.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="op-neurals-copy">
                        <div className="op-domain-card" aria-live="polite">
                            <span className="op-domain-icon"><CardIcon size={18} /></span>
                            {picked ? (
                                <div>
                                    <h3>{picked.label}</h3>
                                    <p>{kindLabel(picked.kind)}{picked.state ? `, ${picked.state}` : ''}. Linked to {links} other record{links === 1 ? '' : 's'} in the brain.</p>
                                </div>
                            ) : (
                                <div>
                                    <h3>{domain ? domain.label : 'Whole Brain'} <small>{domain ? counts[domain.id] || 0 : brain.nodes.length} records</small></h3>
                                    <p>{about.learns}</p>
                                </div>
                            )}
                        </div>
                        <ol className="op-flow">
                            {FLOW.map(({ icon: Icon, title, body }, k) => (
                                <li key={title}>
                                    <span className="op-flow-no">{k + 1}</span>
                                    <div><h4><Icon size={14} /> {title}</h4><p>{body}</p></div>
                                </li>
                            ))}
                        </ol>
                    </div>
                </div>

                <div className="op-powers">
                    <article className="op-power">
                        <h3>Ask</h3>
                        <p>Questions in plain words, answered with the numbers and the records behind them.</p>
                        <div className="op-power-ui op-ai-chat" aria-hidden="true"><AiAnswer /></div>
                    </article>
                    <article className="op-power">
                        <h3>Agents</h3>
                        <p>Five agents watch deadlines, cash, deals, knowledge and operations on a schedule you set.</p>
                        <div className="op-power-ui op-ai-agents" aria-hidden="true">
                            {AGENTS.map(({ name, freq, icon: Icon, on }) => (
                                <div key={name} className="op-agent">
                                    <span className="op-agent-icon"><Icon size={13} /></span>
                                    <span><b>{name}</b><small>{freq}</small></span>
                                    <span className={`opm-switch ${on ? 'is-on' : ''}`}><i /></span>
                                </div>
                            ))}
                        </div>
                    </article>
                    <article className="op-power">
                        <h3>Connectors</h3>
                        <p>Bring outside context in. Fill a new client from Apollo.io with company details and decision makers.</p>
                        <div className="op-power-ui op-connector" aria-hidden="true">
                            <div className="op-conn-head">
                                <span className="op-conn-logo"><Building2 size={15} /></span>
                                <span><b>Orbit Fintech</b><small>Financial services, Bengaluru</small></span>
                                <span className="op-conn-live">Live</span>
                            </div>
                            <div className="op-conn-facts">
                                <span><small>Employees</small><b>120</b></span>
                                <span><small>Founded</small><b>2017</b></span>
                                <span><small>Website</small><b><Globe size={10} /> orbitfin.in</b></span>
                            </div>
                            <div className="op-conn-people">
                                {[['Kavya Menon', 'Chief Operating Officer'], ['Rohan Iyer', 'Head of Finance']].map(([n, r]) => (
                                    <div key={n}><span className="op-conn-avatar"><UserRound size={12} /></span><span><b>{n}</b><small>{r}</small></span></div>
                                ))}
                            </div>
                        </div>
                    </article>
                </div>
            </div>
        </section>
    );
}
