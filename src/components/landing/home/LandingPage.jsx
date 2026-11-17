// The public home page at "/". Product screens are static replicas from
// ProductScreens.jsx; nothing here reads tenant data.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Menu, X, Check, Receipt, Landmark, FileSignature, FileText, Award, ScrollText,
    CalendarDays, Sun, ArrowRight, Wallet, Users, Sparkles, Plus, Upload, Globe,
    PieChart, FolderKanban, Handshake,
} from 'lucide-react';
import {
    Scaled, AppWindow, Chip, Avatar,
    DashboardScreen, ProjectsScreen, CrmScreen, FinancialsScreen, AiScreen,
} from './ProductScreens';
import { money } from './landingData';
import NeuralsSection from './NeuralsSection';
import { WhyStory, StepsStory } from './ScrollStory';
import './landing.css';

const NAV = [
    { href: '#product', label: 'Product' },
    { href: '#features', label: 'Features' },
    { href: '#ai', label: 'AI' },
    { href: '#why', label: 'Why Opstead' },
    { href: '/pricing', label: 'Pricing' },
];

const SCREENS = [
    { id: 'dashboard', label: 'Dashboard', icon: PieChart, Component: DashboardScreen },
    { id: 'projects', label: 'Projects', icon: FolderKanban, Component: ProjectsScreen },
    { id: 'crm', label: 'CRM', icon: Handshake, Component: CrmScreen },
    { id: 'financials', label: 'Financials', icon: Wallet, Component: FinancialsScreen },
    { id: 'ai', label: 'AI', icon: Sparkles, Component: AiScreen },
];

const reducedMotion = () => typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ─────────────── Hero product tour ─────────────── */

function ProductTour() {
    const [active, setActive] = useState(0);
    const [auto, setAuto] = useState(() => !reducedMotion());
    const Screen = SCREENS[active].Component;
    const pick = (i) => { setAuto(false); setActive(i); };
    return (
        <div className="op-tour" id="product">
            <div className="op-tour-tabs" role="tablist" aria-label="Opstead screens">
                {SCREENS.map(({ id, label, icon: Icon }, i) => (
                    <button
                        key={id} type="button" role="tab" aria-selected={i === active}
                        className={`op-tour-tab ${i === active ? 'is-active' : ''}`}
                        onClick={() => pick(i)}
                    >
                        <Icon size={15} /> {label}
                        {i === active && auto && (
                            <span
                                className="op-tour-timer"
                                onAnimationEnd={() => setActive((a) => (a + 1) % SCREENS.length)}
                            />
                        )}
                    </button>
                ))}
            </div>
            <div className="op-tour-stage">
                <Scaled width={1120} className="op-tour-window">
                    <div key={SCREENS[active].id} className="op-screen-in"><Screen /></div>
                </Scaled>
            </div>
        </div>
    );
}

/* ─────────────── Feature mini UIs ─────────────── */

function InvoicesMini() {
    const rows = [
        ['INV-044', 'Larkspur Hotels', 236000, 'Paid'],
        ['INV-043', 'Harbor Developers', 412500, 'Paid'],
        ['INV-042', 'Larkspur Hotels', 184000, 'Sent'],
        ['INV-041', 'Verdant Foods', 95000, 'Sent'],
    ];
    return (
        <div className="op-mini op-mini-invoices">
            <div className="op-mini-head"><b>Client Invoices</b><span className="opm-btn opm-btn-dark"><Plus size={11} /> Create Invoice</span></div>
            {rows.map(([no, who, amt, st]) => (
                <div key={no} className="op-inv-row">
                    <span className="opm-code">{no}</span><b>{who}</b>
                    <span className="num">{money(amt)}</span>
                    <Chip tone={st === 'Paid' ? 'green' : 'blue'}>{st}</Chip>
                </div>
            ))}
        </div>
    );
}

function BillMini() {
    return (
        <div className="op-mini op-mini-bill">
            <div className="op-mini-head"><b>Arcline Prints</b><Chip tone="soft">Vendor</Chip></div>
            <div className="op-bill">
                <span><small>Bill BL-2219</small><b>{money(104300)}</b></span>
                <div className="op-bill-bar"><i style={{ width: '60%' }} /></div>
                <small>{money(62580)} paid, {money(41720)} due</small>
            </div>
            <div className="op-bill-lines">
                <span><Upload size={12} /> Bill uploaded with GST and round off</span>
                <span><Landmark size={12} /> Payments settle oldest bills first</span>
            </div>
        </div>
    );
}

function PayrollMini() {
    const rows = [['AR', 'Aarav Rao', 'Design Lead', 95000, true], ['MK', 'Meera Kapoor', 'Architect', 82000, true], ['SP', 'Sahil Pillai', 'Site Engineer', 64000, false]];
    return (
        <div className="op-mini">
            <div className="op-mini-head"><b>Salaries, November</b></div>
            {rows.map(([i, name, role, sal, paid]) => (
                <div key={i} className="op-pay-row">
                    <Avatar who={i} size={26} />
                    <span><b>{name}</b><small>{role}</small></span>
                    <span className="num">{money(sal)}</span>
                    {paid ? <Chip tone="green">Paid</Chip> : <span className="opm-btn opm-btn-dark">Pay</span>}
                </div>
            ))}
        </div>
    );
}

function TodayMini() {
    return (
        <div className="op-mini op-mini-today">
            <div className="op-mini-head"><b><Sun size={14} /> Good Morning, Aarav</b><small>Monday, 16 November</small></div>
            <div className="op-today-grid">
                <div className="opm-stat"><span>Cash In This Week</span><b>{money(743500)}</b></div>
                <div className="opm-stat"><span>Tasks Due Today</span><b>6</b></div>
                <div className="opm-stat"><span>Deals To Follow Up</span><b>3</b></div>
            </div>
            <ul className="opm-list">
                <li><Receipt size={14} className="t-blue" /><span><b>Send reminder for INV-031</b><small>Pinecrest Bank, 47 days open</small></span></li>
                <li><CalendarDays size={14} className="t-teal" /><span><b>Client walkthrough at 3:00 PM</b><small>Harbor Residences, site office</small></span></li>
            </ul>
        </div>
    );
}

function DocumentsMini() {
    const docs = [
        { icon: FileSignature, name: 'Offer Letter', sub: 'Signed by Meera Kapoor', tone: 'green', active: true },
        { icon: ScrollText, name: 'Non-Disclosure Agreement', sub: 'Sent to Orbit Fintech', tone: 'blue' },
        { icon: FileText, name: 'Quotation QT-018', sub: 'Draft for Quarry Coffee', tone: 'amber' },
        { icon: Award, name: 'Internship Certificate', sub: 'Issued to Riya Thomas', tone: 'teal' },
    ];
    return (
        <div className="op-mini op-docs">
            <div className="op-docs-list">
                <div className="op-mini-head"><b>Document Library</b></div>
                {docs.map(({ icon: Icon, name, sub, tone, active }) => (
                    <div key={name} className={`op-doc-row ${active ? 'is-active' : ''}`}>
                        <span className="op-doc-icon"><Icon size={13} /></span>
                        <span className="op-doc-meta"><b>{name}</b><small>{sub}</small></span>
                        <i className={`op-doc-dot op-doc-dot-${tone}`} />
                    </div>
                ))}
            </div>
            <div className="op-page">
                <div className="op-page-head">
                    <span className="opm-org-mark">K</span>
                    <span><b>Kestrel Studio</b><small>12 Lavelle Road, Bengaluru 560001</small></span>
                    <small className="op-page-ref">KS/HR/2026/014</small>
                </div>
                <b className="op-page-title">Offer Of Employment</b>
                <p className="op-page-to">Dear Meera Kapoor,</p>
                <span className="op-page-line" /><span className="op-page-line" /><span className="op-page-line short" />
                <div className="op-page-terms">
                    <span><small>Role</small><b>Architect</b></span>
                    <span><small>Start Date</small><b>01 Dec 2026</b></span>
                    <span><small>Annual CTC</small><b>{money(984000)}</b></span>
                </div>
                <div className="op-page-sign">
                    <span><i className="op-sig">A. Rao</i><small>Aarav Rao, Director</small></span>
                    <span className="op-page-signed"><Check size={11} /> Signed 12 Nov 2026</span>
                </div>
            </div>
        </div>
    );
}

function CalendarMini() {
    const days = Array.from({ length: 30 }, (_, i) => i + 1);
    const marks = { 4: 'teal', 11: 'navy', 16: 'red', 19: 'teal', 20: 'amber', 26: 'navy' };
    return (
        <div className="op-mini op-cal">
            <div className="op-mini-head"><b>November 2026</b><small>My Tasks, Notes</small></div>
            <div className="op-cal-grid">
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="op-cal-dow">{d}</span>)}
                {Array.from({ length: 6 }, (_, i) => <span key={`b${i}`} />)}
                {days.map((d) => (
                    <span key={d} className={`op-cal-day ${d === 16 ? 'is-today' : ''}`}>
                        {d}{marks[d] && d !== 16 && <i className={`op-dot op-dot-${marks[d]}`} />}
                    </span>
                ))}
            </div>
        </div>
    );
}

const FEATURES = [
    { title: 'Clients And Billing', body: 'GST invoices, quotations and receipts. A receipt settles the oldest invoices first, so balances are never worked out by hand.', Mini: InvoicesMini, span: 2 },
    { title: 'Vendors And Bills', body: 'Upload a bill, record a payment, and see what each vendor is owed across every project.', Mini: BillMini },
    { title: 'People And Payroll', body: 'Employee registry, attendance and one-click salary pay that posts straight to the ledger.', Mini: PayrollMini },
    { title: 'Today', body: 'One page each morning with the cash, tasks, deadlines and deals that need you.', Mini: TodayMini, span: 2 },
    { title: 'Documents', body: 'Offer letters, NDAs, MoUs, quotations and certificates on your letterhead, ready to sign.', Mini: DocumentsMini, span: 2 },
    { title: 'Workspace', body: 'A private calendar, task list and notes for every person on the team.', Mini: CalendarMini },
];

/* ─────────────── Steps ─────────────── */

function CompanyStep() {
    return (
        <AppWindow active="company" path="settings/company-profile" railCollapsed>
            <div className="opm-head"><div><h4>Company Profile</h4><p>Used on invoices, letters and reports</p></div></div>
            <div className="op-form">
                {[['Company Name', 'Kestrel Studio'], ['Country', 'India'], ['State', 'Karnataka'], ['Currency', 'INR, Indian Rupee'], ['GSTIN', '29ABCDE1234F1Z5']].map(([k, v]) => (
                    <div key={k} className="op-form-row"><span>{k}</span><span className="op-input">{v}</span></div>
                ))}
                <div className="op-form-row"><span>Logo</span><span className="op-upload"><span className="opm-org-mark">K</span> kestrel-logo.png</span></div>
            </div>
        </AppWindow>
    );
}

function PeopleStep() {
    const rows = [['Harbor Developers', 'Real estate', 'Client', 3], ['Larkspur Hotels', 'Hospitality', 'Client', 2], ['Arcline Prints', 'Printing', 'Vendor', 4], ['Stoneworks Supply', 'Materials', 'Vendor', 1]];
    return (
        <AppWindow active="clients" path="clients/directory" railCollapsed>
            <div className="opm-head"><div><h4>Directory</h4><p>Clients and vendors, linked to projects</p></div><div className="opm-head-actions"><span className="opm-btn opm-btn-dark"><Plus size={12} /> Add Client</span></div></div>
            <div className="opm-table">
                <div className="opm-tr opm-th op-dir"><span>Name</span><span>Industry</span><span>Type</span><span className="r">Projects</span></div>
                {rows.map(([n, ind, t, p]) => (
                    <div key={n} className="opm-tr op-dir"><span><b>{n}</b></span><span className="muted">{ind}</span><span><Chip tone={t === 'Client' ? 'teal' : 'soft'}>{t}</Chip></span><span className="r">{p}</span></div>
                ))}
            </div>
        </AppWindow>
    );
}

function TodayStep() {
    return (
        <AppWindow active="today" path="today" railCollapsed>
            <TodayMini />
        </AppWindow>
    );
}

const STEPS = [
    { title: 'Set Up Your Company', body: 'Add your name, logo, country and currency. Invoices, letters and tax fields follow from there.', Screen: CompanyStep },
    { title: 'Bring In Your Clients, Vendors And Team', body: 'Add them once in the directory and link them to projects. Roles decide who sees what.', Screen: PeopleStep },
    { title: 'Run The Day From Today', body: 'Open Opstead each morning to the cash, tasks and deadlines that need you, then act on them in place.', Screen: TodayStep },
];

/* ─────────────── Page ─────────────── */

const FAQ = [
    ['Is Opstead ready for GST and TDS?', 'Yes. Invoices and bills carry GST per line, people and labour payments carry TDS, and the tax view adds them up for filing.'],
    ['Can we bill in our own currency?', 'Each company sets its country, state and currency in the profile, and every figure across the app uses it.'],
    ['Who on the team can see what?', 'Owners and admins decide per role. Employees get their own portal for tasks, attendance and documents, without the books.'],
    ['Where do AI answers come from?', 'Only from your own records. Each answer says what it read, such as how many invoices and receipts, so you can check it.'],
    ['Can clients see their invoices?', 'Yes. Share a portal link and the client sees their invoices and documents, nothing else.'],
];

export default function LandingPage({ onEnter }) {
    const navigate = useNavigate();
    const [menuOpen, setMenuOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const signIn = () => (onEnter ? onEnter() : navigate('/login'));
    const getStarted = () => navigate('/signup');

    useEffect(() => {
        const root = document.documentElement;
        const prev = root.getAttribute('data-theme');
        root.setAttribute('data-theme', 'light');
        const onScroll = () => setScrolled(window.scrollY > 24);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            window.removeEventListener('scroll', onScroll);
            root.setAttribute('data-theme', prev || 'light');
        };
    }, []);

    return (
        <div className="op-landing">
            <header className={`op-nav ${scrolled ? 'is-scrolled' : ''}`}>
                <div className="op-nav-inner">
                    <a href="/" className="op-logo" aria-label="Opstead home"><img src="/opstead-logo.png" alt="Opstead" /></a>
                    <nav className="op-nav-links" aria-label="Main">
                        {NAV.map((n) => <a key={n.href} href={n.href}>{n.label}</a>)}
                    </nav>
                    <div className="op-nav-actions">
                        <button type="button" className="op-btn op-btn-text" onClick={signIn}>Sign In</button>
                        <button type="button" className="op-btn op-btn-ink" onClick={getStarted}>Get Started</button>
                        <button type="button" className="op-menu-btn" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
                            {menuOpen ? <X size={20} /> : <Menu size={20} />}
                        </button>
                    </div>
                </div>
                {menuOpen && (
                    <div className="op-mobile-menu">
                        {NAV.map((n) => <a key={n.href} href={n.href} onClick={() => setMenuOpen(false)}>{n.label}</a>)}
                        <button type="button" className="op-btn op-btn-outline" onClick={signIn}>Sign In</button>
                    </div>
                )}
            </header>

            <section className="op-hero">
                <div className="op-sky" aria-hidden="true"><i className="c1" /><i className="c2" /><i className="c3" /><i className="c4" /></div>
                <div className="op-wrap op-hero-copy">
                    <h1>An Agentic Operating System<br />For Businesses</h1>
                    <p>Projects, clients, ledgers, payroll and documents in one workspace, with AI that answers from your own books.</p>
                    <div className="op-hero-ctas">
                        <button type="button" className="op-btn op-btn-red op-btn-lg" onClick={getStarted}>Start Free</button>
                        <a href="#product" className="op-btn op-btn-outline op-btn-lg">Tour The Product</a>
                    </div>
                </div>
                <div className="op-wrap op-wrap-wide"><ProductTour /></div>
            </section>

            <section className="op-band">
                <div className="op-wrap op-band-inner">
                    <p>Built for teams that bill by the project.</p>
                    <ul>
                        {['Design Studios', 'Architects', 'Consultancies', 'Agencies', 'Engineering Firms'].map((t) => <li key={t}>{t}</li>)}
                    </ul>
                </div>
            </section>

            <section className="op-section" id="features">
                <div className="op-wrap">
                    <div className="op-section-head">
                        <h2>Everything Your Company Runs On,<br />Already Connected</h2>
                        <p>Record a payment once. It lands in the project, the client ledger, your P&amp;L and your GST report.</p>
                    </div>
                    <div className="op-bento">
                        {FEATURES.map(({ title, body, Mini, span }) => (
                            <article key={title} className={`op-feature ${span === 2 ? 'span-2' : ''}`}>
                                <div className="op-feature-copy"><h3>{title}</h3><p>{body}</p></div>
                                <div className="op-feature-ui" aria-hidden="true"><Mini /></div>
                            </article>
                        ))}
                    </div>
                </div>
            </section>

            <NeuralsSection />

            <WhyStory />

            <StepsStory steps={STEPS} />

            <section className="op-section" id="faq">
                <div className="op-wrap op-faq-grid">
                    <div className="op-section-head op-left">
                        <h2>Questions Teams Ask First</h2>
                        <p>Something else on your mind? <a href="/support">Talk to us</a>.</p>
                    </div>
                    <div className="op-faq">
                        {FAQ.map(([q, a], i) => (
                            <details key={q} open={i === 0}>
                                <summary>{q}<Plus size={18} /></summary>
                                <p>{a}</p>
                            </details>
                        ))}
                    </div>
                </div>
            </section>

            <section className="op-cta">
                <div className="op-wrap op-cta-inner">
                    <div>
                        <h2>Bring Your Whole Company<br />Into One Place</h2>
                        <p>Create a workspace, invite your team, and send your first invoice today.</p>
                    </div>
                    <div className="op-cta-actions">
                        <button type="button" className="op-btn op-btn-red op-btn-lg" onClick={getStarted}>Create Your Workspace <ArrowRight size={16} /></button>
                        <button type="button" className="op-btn op-btn-ghost-light op-btn-lg" onClick={signIn}>Sign In</button>
                    </div>
                    <div className="op-cta-icons" aria-hidden="true">
                        {[Wallet, Users, Receipt, FileText, Sparkles, Globe].map((Icon, i) => <span key={i}><Icon size={18} /></span>)}
                    </div>
                </div>
            </section>

            <footer className="op-footer">
                <div className="op-wrap op-footer-grid">
                    <div className="op-footer-brand">
                        <img src="/opstead-logo-white.png" alt="Opstead" />
                        <p>One workspace for projects, clients, money and people.</p>
                    </div>
                    <div><h4>Product</h4><a href="/invoicing">Invoicing</a><a href="/offer-letters">Offer Letters</a><a href="/legal-documents">Legal Documents</a><a href="/certificates">Certificates</a><a href="/ai-cofounder">AI</a><a href="/pricing">Pricing</a></div>
                    <div><h4>Resources</h4><a href="/documentation">Documentation</a><a href="/changelog">Changelog</a><a href="/support">Support</a></div>
                    <div><h4>Company</h4><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/security">Security</a></div>
                </div>
                <div className="op-wrap op-footer-base"><span>© 2026 Opstead</span></div>
            </footer>
        </div>
    );
}
