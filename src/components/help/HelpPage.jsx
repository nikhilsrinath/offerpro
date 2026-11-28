import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Copy, Check, Mail, Lightbulb, ChevronDown, Send } from 'lucide-react';
import { Panel, Btn, Search, Field, Input, Select, Textarea, Empty } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useAuth } from '../../context/AuthContext';
import { useOrg } from '../../context/OrgContext';
import { useToast } from '../shared/Toast';
import { MODULES, RAIL_IDS } from '../shell/modules';
import { GUIDES } from '../guide/pageGuides';
import { resetGuides } from '../guide/guideState';
import { SUPPORT_EMAIL, MODULE_HELP, GETTING_STARTED, GUIDE_GROUPS, FAQS } from './helpContent';
import { partOf } from './helpTabs';

/* ══════════════════════════════════════════════════════════════════════════
   Help & Support (/help): how Opstead is organised and where to start, every
   page tip in one place, common questions, and a way to reach Agentrive.
   The contact form posts to Web3Forms with the public access key in
   VITE_WEB3FORMS_KEY; without one it says so and offers the email address.
   ══════════════════════════════════════════════════════════════════════════ */


// A heading row wears the selected tab's light-blue fill and navy text.
const headBar = (t) => ({ background: t.soft, color: t.softText });

/** A section box: its heading on the tab's light-blue fill on the left, a note on the right, on one line. */
function HelpPanel({ title, note, children }) {
    const t = useT();
    return (
        <section style={{ border: '1px solid ' + t.line, borderRadius: 12, background: t.card, overflow: 'clip', minWidth: 0 }}>
            <header style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px',
                borderBottom: '1px solid ' + t.line, ...headBar(t),
            }}>
                <h2 style={{ margin: 0, flex: '1 1 auto', fontSize: 14, fontWeight: 600, color: 'inherit', lineHeight: 1.3 }}>{title}</h2>
                {note && <span style={{ fontSize: 12, color: 'inherit', opacity: 0.75, lineHeight: 1.3, whiteSpace: 'nowrap' }}>{note}</span>}
            </header>
            {children}
        </section>
    );
}

export default function HelpPage() {
    const location = useLocation();
    const part = partOf(location.pathname);
    return (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr)' }}>
            {part === 'overview' && <Overview />}
            {part === 'guides' && <Guides />}
            {part === 'faqs' && <Faqs />}
            {part === 'contact' && <Contact />}
        </div>
    );
}

/* ── Overview ─────────────────────────────────────────────────────────────── */

function Overview() {
    const t = useT();
    const toast = useToast();
    const modules = RAIL_IDS.map((id) => MODULES.find((m) => m.id === id)).filter(Boolean);
    return (
        <>
            <HelpPanel title="Getting Started" note="Six steps to set up your company">
                <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {GETTING_STARTED.map((s, i) => (
                        <li key={s.title} style={{
                            display: 'flex', gap: 14, alignItems: 'flex-start', padding: '14px 16px',
                            borderTop: i ? '1px solid ' + t.line : 'none', flexWrap: 'wrap',
                        }}>
                            <span aria-hidden="true" style={{
                                width: 26, height: 26, borderRadius: 99, flexShrink: 0, display: 'grid', placeItems: 'center',
                                fontSize: 12, fontWeight: 700, color: t.accent, background: t.accentSoft,
                            }}>{i + 1}</span>
                            <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                                <div style={{ fontSize: 13.5, fontWeight: 600, color: t.text }}>{s.title}</div>
                                <p style={{ margin: '2px 0 0', fontSize: 12.5, color: t.dim, lineHeight: 1.55 }}>{s.body}</p>
                            </div>
                            <Link to={s.to} className="edge-btn" style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 7,
                                border: '1px solid ' + t.line, background: t.card, color: t.text, fontSize: 12.5, fontWeight: 500,
                                textDecoration: 'none', whiteSpace: 'nowrap', alignSelf: 'center',
                            }}>{s.cta} <ArrowRight size={13} aria-hidden="true" /></Link>
                        </li>
                    ))}
                </ol>
            </HelpPanel>

            <HelpPanel title="How Opstead Is Organised" note="The left menu, part by part">
                <div style={{ display: 'grid', gap: 12, padding: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))' }}>
                    {modules.map((m) => {
                        const Icon = m.icon;
                        return (
                            <Link key={m.id} to={'/' + m.defaultPage} className="help-module" style={{
                                display: 'flex', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 10,
                                border: '1px solid ' + t.line, background: t.card, color: t.text, textDecoration: 'none', minWidth: 0,
                            }}>
                                <span aria-hidden="true" style={{
                                    width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: 'grid', placeItems: 'center',
                                    background: t.panelAlt, color: t.dim, border: '1px solid ' + t.line,
                                }}><Icon size={16} strokeWidth={1.8} /></span>
                                <span style={{ minWidth: 0 }}>
                                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{m.label}</span>
                                    <span style={{ display: 'block', fontSize: 12.5, color: t.dim, lineHeight: 1.55, marginTop: 2 }}>{MODULE_HELP[m.id] || m.desc}</span>
                                </span>
                            </Link>
                        );
                    })}
                </div>
            </HelpPanel>

            <HelpPanel title="Page Tips">
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px' }}>
                    <Lightbulb size={16} aria-hidden="true" style={{ color: t.accent, flexShrink: 0 }} />
                    <span style={{ flex: '1 1 300px', fontSize: 12.5, color: t.dim, lineHeight: 1.55 }}>
                        Each page shows a short tip for your first few visits. Every tip is also under Page Guides.
                    </span>
                    <Btn onClick={() => { resetGuides(); toast('Page tips will show again', 'success'); }}>Show page tips again</Btn>
                </div>
            </HelpPanel>
        </>
    );
}

/* ── Page guides ──────────────────────────────────────────────────────────── */

/** A group (Projects, Billing and money…) whose heading opens and closes it. */
function Section({ title, count, open, onToggle, children }) {
    const t = useT();
    return (
        <section style={{ border: '1px solid ' + t.line, borderRadius: 12, background: t.card, overflow: 'clip' }}>
            <button type="button" aria-expanded={open} onClick={onToggle} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', textAlign: 'left',
                border: 'none', cursor: 'pointer', font: 'inherit', ...headBar(t),
            }}>
                <ChevronDown size={16} aria-hidden="true" style={{ color: 'inherit', flexShrink: 0, transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}>{title}</span>
                <span style={{ fontSize: 12, opacity: 0.75, whiteSpace: 'nowrap' }}>{count}</span>
            </button>
            {open && <div>{children}</div>}
        </section>
    );
}

/** Which groups are open: all shut at first, every match open while searching. */
function useSections() {
    const [open, setOpen] = useState(() => new Set());
    const toggle = (k) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    return { open, toggle, setOpen };
}

function ExpandAll({ keys, sections }) {
    const t = useT();
    const all = keys.length > 0 && keys.every((k) => sections.open.has(k));
    return (
        <button type="button" onClick={() => sections.setOpen(all ? new Set() : new Set(keys))} style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', fontSize: 12.5,
            color: t.dim, textDecoration: 'underline', textUnderlineOffset: 3, whiteSpace: 'nowrap',
        }}>{all ? 'Collapse all' : 'Expand all'}</button>
    );
}

function Expand({ title, children, meta }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    return (
        <div style={{ borderTop: '1px solid ' + t.line }}>
            <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', textAlign: 'left',
                background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', color: t.text,
            }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 500 }}>{title}</span>
                {meta && <span style={{ fontSize: 12, color: t.faint }}>{meta}</span>}
                <ChevronDown size={15} aria-hidden="true" style={{ color: t.faint, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }} />
            </button>
            {open && <div style={{ padding: '0 16px 14px' }}>{children}</div>}
        </div>
    );
}

function Guides() {
    const t = useT();
    const [query, setQuery] = useState('');
    const q = query.trim().toLowerCase();
    const groups = useMemo(() => GUIDE_GROUPS.map((g) => ({
        ...g,
        keys: g.keys.filter((k) => GUIDES[k] && (!q || [GUIDES[k].title, GUIDES[k].body, ...(GUIDES[k].steps || [])].join(' ').toLowerCase().includes(q))),
    })).filter((g) => g.keys.length), [q]);
    const sections = useSections();
    return (
        <>
            <div className="prod-toolbar edge-table-bar">
                <Search value={query} onChange={setQuery} placeholder="Search the page guides…" width={320} />
                <div style={{ flex: '1 0 0' }} />
                {!q && <ExpandAll keys={groups.map((g) => g.label)} sections={sections} />}
            </div>
            {groups.length === 0 ? <Panel><Empty>No page guide matches “{query}”.</Empty></Panel> : groups.map((g) => (
                <Section key={g.label} title={g.label} count={`${g.keys.length} page${g.keys.length === 1 ? '' : 's'}`}
                    open={!!q || sections.open.has(g.label)} onToggle={() => sections.toggle(g.label)}>
                    <div>
                        {g.keys.map((k) => {
                            const guide = GUIDES[k];
                            return (
                                <Expand key={k} title={guide.title}>
                                    <p style={{ margin: 0, fontSize: 12.5, color: t.dim, lineHeight: 1.6, maxWidth: 900 }}>{guide.body}</p>
                                    {guide.steps?.length > 0 && (
                                        <ol style={{ margin: '8px 0 0', paddingLeft: 20, display: 'grid', gap: 4, fontSize: 12.5, color: t.text, lineHeight: 1.55 }}>
                                            {guide.steps.map((s, i) => <li key={i}>{s}</li>)}
                                        </ol>
                                    )}
                                </Expand>
                            );
                        })}
                    </div>
                </Section>
            ))}
        </>
    );
}

/* ── FAQs ─────────────────────────────────────────────────────────────────── */

function Faqs() {
    const t = useT();
    const [query, setQuery] = useState('');
    const q = query.trim().toLowerCase();
    const topics = FAQS.map((g) => ({ ...g, items: g.items.filter((x) => !q || (x.q + ' ' + x.a).toLowerCase().includes(q)) }))
        .filter((g) => g.items.length);
    const sections = useSections();
    return (
        <>
            <div className="prod-toolbar edge-table-bar">
                <Search value={query} onChange={setQuery} placeholder="Search the questions…" width={320} />
                <div style={{ flex: '1 0 0' }} />
                {!q && <ExpandAll keys={topics.map((g) => g.topic)} sections={sections} />}
            </div>
            {topics.length === 0 ? (
                <Panel><Empty action={<Link to="/help/contact">Ask us instead</Link>}>No question matches “{query}”.</Empty></Panel>
            ) : topics.map((g) => (
                <Section key={g.topic} title={g.topic} count={`${g.items.length} question${g.items.length === 1 ? '' : 's'}`}
                    open={!!q || sections.open.has(g.topic)} onToggle={() => sections.toggle(g.topic)}>
                    <div>
                        {g.items.map((x) => (
                            <Expand key={x.q} title={x.q}>
                                <p style={{ margin: 0, fontSize: 12.5, color: t.dim, lineHeight: 1.65, maxWidth: 900 }}>{x.a}</p>
                            </Expand>
                        ))}
                    </div>
                </Section>
            ))}
            {topics.length > 0 && (
                <p style={{ margin: '4px 2px 0', fontSize: 12.5, color: t.dim }}>
                    Not here? <Link to="/help/contact" style={{ color: t.text, fontWeight: 500 }}>Contact us</Link> and we will help.
                </p>
            )}
        </>
    );
}

/* ── Contact ──────────────────────────────────────────────────────────────── */

const TOPICS = ['A question', 'Something is not working', 'An idea or a feature request', 'Plans and billing', 'Something else'];
const WEB3FORMS_KEY = import.meta.env.VITE_WEB3FORMS_KEY || '';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Contact() {
    const t = useT();
    const { user } = useAuth();
    const { activeOrg } = useOrg();
    const company = activeOrg?.company_name || activeOrg?.name || '';
    const [form, setForm] = useState({
        name: user?.user_metadata?.full_name || user?.user_metadata?.name || '',
        email: user?.email || '', topic: TOPICS[0], message: '', botcheck: false,
    });
    const [state, setState] = useState('idle');   // idle | sending | sent
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const send = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) { setError('Please tell us your name.'); return; }
        if (!EMAIL_RE.test(form.email.trim())) { setError('Please enter an email address we can reply to.'); return; }
        if (form.message.trim().length < 10) { setError('Please write a little more about what you need.'); return; }
        if (form.botcheck) return;
        setState('sending'); setError('');
        try {
            const res = await fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    access_key: WEB3FORMS_KEY,
                    subject: `Opstead support: ${form.topic}${company ? ` (${company})` : ''}`,
                    from_name: 'Opstead app',
                    name: form.name.trim(),
                    email: form.email.trim(),
                    replyto: form.email.trim(),
                    company,
                    topic: form.topic,
                    message: form.message.trim(),
                }),
            });
            const out = await res.json().catch(() => ({}));
            if (!res.ok || !out.success) throw new Error(out.message || 'The message did not go through.');
            setState('sent');
        } catch (err) {
            setState('idle');
            setError(`${err.message || 'The message did not go through.'} Please try again, or email us at ${SUPPORT_EMAIL}.`);
        }
    };
    const copy = async () => {
        try { await navigator.clipboard.writeText(SUPPORT_EMAIL); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* the address stays selectable */ }
    };

    return (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', alignItems: 'start' }}>
            <HelpPanel title="Send Us a Message" note="We reply by email">
                {state === 'sent' ? (
                    <div style={{ padding: 20, display: 'grid', gap: 8, justifyItems: 'start' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, fontWeight: 600, color: t.text }}>
                            <Check size={16} aria-hidden="true" style={{ color: t.up }} /> Message sent
                        </div>
                        <p style={{ margin: 0, fontSize: 12.5, color: t.dim, lineHeight: 1.6 }}>
                            Thank you. We will reply to {form.email.trim()}.
                        </p>
                        <Btn onClick={() => { setForm((f) => ({ ...f, message: '' })); setState('idle'); }}>Send another message</Btn>
                    </div>
                ) : (
                    <form onSubmit={send} noValidate style={{ padding: 16, display: 'grid', gap: 12 }}>
                        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))' }}>
                            <Field required label="Your name"><Input id="help-name" value={form.name} onChange={set('name')} autoComplete="name" /></Field>
                            <Field required label="Email"><Input id="help-email" type="email" value={form.email} onChange={set('email')} autoComplete="email" /></Field>
                        </div>
                        <Field label="What is it about?">
                            <Select id="help-topic" value={form.topic} onChange={set('topic')}>
                                {TOPICS.map((x) => <option key={x} value={x}>{x}</option>)}
                            </Select>
                        </Field>
                        <Field required label="Message" hint="What were you doing, what did you expect, and what happened instead?">
                            <Textarea id="help-message" rows={6} value={form.message} onChange={set('message')} />
                        </Field>
                        {/* A field people never see; a bot that fills it is ignored. */}
                        <input type="checkbox" name="botcheck" tabIndex={-1} aria-hidden="true" style={{ display: 'none' }}
                            checked={form.botcheck} onChange={(e) => setForm((f) => ({ ...f, botcheck: e.target.checked }))} />
                        {error && <div role="alert" style={{ fontSize: 12.5, color: t.down, lineHeight: 1.5 }}>{error}</div>}
                        {!WEB3FORMS_KEY && (
                            <div role="note" style={{ fontSize: 12.5, color: t.dim, lineHeight: 1.5 }}>
                                The contact form is being set up. Until then, please email us at {SUPPORT_EMAIL}.
                            </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Btn primary type="submit" disabled={state === 'sending' || !WEB3FORMS_KEY}>
                                <Send size={13} aria-hidden="true" /> {state === 'sending' ? 'Sending…' : 'Send message'}
                            </Btn>
                        </div>
                    </form>
                )}
            </HelpPanel>

            <HelpPanel title="Email Us">
                <div style={{ padding: 16, display: 'grid', gap: 12 }}>
                    <p style={{ margin: 0, fontSize: 12.5, color: t.dim, lineHeight: 1.6 }}>
                        Prefer email? Write to the Agentrive team directly. Include your company name so we can find your account.
                    </p>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9,
                        border: '1px solid ' + t.line, background: t.panelAlt, flexWrap: 'wrap',
                    }}>
                        <Mail size={16} aria-hidden="true" style={{ color: t.dim, flexShrink: 0 }} />
                        <span style={{ flex: '1 1 160px', fontSize: 14, fontWeight: 600, color: t.text, userSelect: 'all', overflowWrap: 'anywhere' }}>{SUPPORT_EMAIL}</span>
                        <Btn size="sm" onClick={copy}>{copied ? <><Check size={13} aria-hidden="true" /> Copied</> : <><Copy size={13} aria-hidden="true" /> Copy</>}</Btn>
                    </div>
                    <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Opstead support' + (company ? ` (${company})` : ''))}`}
                        style={{ fontSize: 12.5, color: t.dim }}>Open in my email app</a>
                </div>
            </HelpPanel>
        </div>
    );
}
