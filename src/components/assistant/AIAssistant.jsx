import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, X, Mic, Square, ArrowUp, PenSquare, PanelLeft, Phone, Trash2 } from 'lucide-react';
import { makeTokens, MONO } from '../../theme/edge';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { callCofounderAI } from '../../services/cofounderAI';
import { getContext as getBrainContext } from '../../services/brainService';
import Orb from './Orb';
import Markdown from './Markdown';
import { MOBILE_NAV_H } from '../shell/MobileNav';

/* ══════════════════════════════════════════════════════════════════════════
   AI Assistant — a round launcher bottom-right, and a full-screen workspace.

   Text is the whole surface: a rail of recent conversations on the left, one
   centred column of messages, one composer. Voice is no longer a mode you
   switch into — it is two controls inside that composer: the mic dictates
   into the draft, and the round accent button opens a voice call over the
   same conversation. The old Voice/Text tab pair made speech a place you had
   to leave the chat to reach, which is backwards for a chat.

   Conversations live in localStorage, so the rail survives a reload and not
   just a navigation. Mounted once at the app root.
   ══════════════════════════════════════════════════════════════════════════ */

const SUGGESTIONS = [
    'How is revenue trending this quarter?',
    'Which invoices are still unpaid?',
    'Summarise our top customers',
];

// The one saturated colour in the product, reserved for the voice call button
// so it reads as a live action rather than another grey control.
const ACCENT = '#2f6df6';

const STORE_KEY = 'edgeos.ai.chats';
const SIDEBAR_W = 252;

const newChat = () => ({ id: 'c' + Date.now(), title: 'New chat', messages: [], at: Date.now() });

/** First user line, trimmed to something that fits the rail. */
const titleFor = (text) => {
    const one = text.replace(/\s+/g, ' ').trim();
    return one.length > 34 ? one.slice(0, 34).trimEnd() + '…' : one || 'New chat';
};

function loadChats() {
    try {
        const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
        if (Array.isArray(raw) && raw.length) return raw;
    } catch {
        // A corrupt or unreadable store is not worth a broken assistant.
    }
    return [newChat()];
}

function useIsPhone() {
    const [p, setP] = useState(() => typeof window !== 'undefined' && window.innerWidth < 760);
    useEffect(() => {
        const fn = () => setP(window.innerWidth < 760);
        window.addEventListener('resize', fn);
        return () => window.removeEventListener('resize', fn);
    }, []);
    return p;
}

export default function AIAssistant({ theme = 'dark', edgeContext }) {
    const t = makeTokens(theme === 'dark');
    const phone = useIsPhone();
    const fabBottom = phone ? `calc(${MOBILE_NAV_H + 14}px + env(safe-area-inset-bottom))` : 20;

    const [open, setOpen] = useState(false);
    const [chats, setChats] = useState(loadChats);
    const [activeId, setActiveId] = useState(() => chats[0].id);
    const [railOpen, setRailOpen] = useState(!phone);
    const [draft, setDraft] = useState('');
    const [streaming, setStreaming] = useState(false);
    const [callOpen, setCallOpen] = useState(false);

    const speech = useSpeechRecognition();
    const { stop: stopSpeech, listening } = speech;

    const active = useMemo(() => chats.find((c) => c.id === activeId) || chats[0], [chats, activeId]);
    const messages = useMemo(() => active?.messages || [], [active]);

    useEffect(() => {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(chats.slice(0, 40))); } catch { /* quota */ }
    }, [chats]);

    // The mic never outlives the surface that owns it.
    useEffect(() => {
        if (!open && listening) stopSpeech();
    }, [open, listening, stopSpeech]);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            if (callOpen) setCallOpen(false);
            else setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, callOpen]);

    // The page behind a full-screen surface should not scroll with it.
    useEffect(() => {
        if (!open) return undefined;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [open]);

    const patchChat = useCallback((id, fn) => {
        setChats((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
    }, []);

    const send = useCallback((text) => {
        const content = (text ?? draft).trim();
        if (!content || streaming) return;

        const chatId = active.id;
        const history = messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
        const replyId = Date.now() + 1;

        patchChat(chatId, (c) => ({
            ...c,
            at: Date.now(),
            title: c.messages.length ? c.title : titleFor(content),
            messages: [...c.messages, { id: Date.now(), role: 'user', content }, { id: replyId, role: 'assistant', content: '' }],
        }));
        setDraft('');
        setStreaming(true);

        const patch = (fields) => patchChat(chatId, (c) => ({
            ...c,
            messages: c.messages.map((m) => (m.id === replyId ? { ...m, ...fields } : m)),
        }));

        // The company's facts come from EdgeBrain; the panel keeps its own
        // streaming and conversation. Until now this call passed no company
        // data at all beyond a handful of summary figures, which is why the
        // assistant could not answer anything specific about the business.
        //
        // getContext never throws: if there is no brain yet, it returns nothing
        // and the assistant answers exactly as it did before.
        (async () => {
            const brain = await getBrainContext(edgeContext?.orgId, content);
            return callCofounderAI(content, history, edgeContext || {}, {
                onToken: (_tok, full) => patch({ content: full }),
                onComplete: (full) => { patch({ content: full }); setStreaming(false); },
                onError: (err) => { patch({ content: err || 'Something went wrong.', error: true }); setStreaming(false); },
            }, null, brain.context || undefined);
        })().catch((err) => {
            patch({ content: err?.message || 'Something went wrong.', error: true });
            setStreaming(false);
        });
    }, [draft, streaming, messages, edgeContext, active, patchChat]);

    const startChat = () => {
        // An untouched blank chat is not worth a second row in the rail.
        setChats((cs) => {
            const blank = cs.find((c) => !c.messages.length);
            if (blank) { setActiveId(blank.id); return cs; }
            const c = newChat();
            setActiveId(c.id);
            return [c, ...cs];
        });
        setDraft('');
        if (phone) setRailOpen(false);
    };

    const removeChat = (id) => {
        setChats((cs) => {
            const rest = cs.filter((c) => c.id !== id);
            const next = rest.length ? rest : [newChat()];
            if (id === activeId) setActiveId(next[0].id);
            return next;
        });
    };

    const endCall = (transcript) => {
        setCallOpen(false);
        stopSpeech();
        const text = (transcript || '').trim();
        if (text) send(text);
    };

    return (
        <>
            {/* ── launcher ─────────────────────────────────────────────── */}
            {!open && (
                <button
                    type="button" onClick={() => setOpen(true)}
                    aria-label="Open AI Assistant" aria-expanded={false}
                    className="ai-fab"
                    style={{
                        position: 'fixed', right: 16, bottom: fabBottom, zIndex: 170,
                        width: 48, height: 48, borderRadius: '50%', padding: 0,
                        display: 'grid', placeItems: 'center', cursor: 'pointer',
                        background: t.panel, color: t.text,
                        border: '1px solid ' + t.lineStrong, boxShadow: t.shadow,
                        transition: 'transform .2s cubic-bezier(.16,1,.3,1)',
                    }}
                >
                    <Sparkles size={18} strokeWidth={1.8} />
                    <span className="ai-fab-ring" style={{ borderColor: t.lineStrong }} />
                </button>
            )}

            {/* ── workspace ────────────────────────────────────────────── */}
            {open && (
                <div
                    role="dialog" aria-modal="true" aria-label="AI Assistant"
                    style={{
                        position: 'fixed', inset: 0, zIndex: 200, display: 'flex',
                        background: t.panel, color: t.text, fontFamily: MONO,
                        WebkitFontSmoothing: 'antialiased', animation: 'aiIn .18s ease-out',
                    }}
                >
                    <Rail
                        t={t} phone={phone} open={railOpen} chats={chats} activeId={active.id}
                        onPick={(id) => { setActiveId(id); if (phone) setRailOpen(false); }}
                        onNew={startChat} onRemove={removeChat} onClose={() => setRailOpen(false)}
                    />

                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <TopBar
                            t={t} railOpen={railOpen} onRail={() => setRailOpen((v) => !v)}
                            onClose={() => { setCallOpen(false); stopSpeech(); setOpen(false); }}
                        />

                        {messages.length === 0 ? (
                            <Welcome t={t} onPick={send}>
                                <Composer
                                    t={t} draft={draft} setDraft={setDraft} send={send} streaming={streaming}
                                    speech={speech} onCall={() => setCallOpen(true)} autoFocus
                                />
                            </Welcome>
                        ) : (
                            <>
                                <Thread t={t} messages={messages} streaming={streaming} />
                                <div style={{ flexShrink: 0, padding: '0 16px 14px' }}>
                                    <div style={{ maxWidth: 760, margin: '0 auto' }}>
                                        <Composer
                                            t={t} draft={draft} setDraft={setDraft} send={send} streaming={streaming}
                                            speech={speech} onCall={() => setCallOpen(true)} autoFocus
                                        />
                                        <div style={{ fontSize: 9, color: t.faint, textAlign: 'center', marginTop: 7 }}>
                                            Answers use your live EdgeOS data. Check anything you act on.
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {callOpen && (
                        <VoiceCall t={t} theme={theme} speech={speech} onEnd={endCall} onCancel={() => { stopSpeech(); setCallOpen(false); }} />
                    )}
                </div>
            )}

            <style>{`
                @keyframes aiIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes aiRing { 0% { transform: scale(1); opacity: .55; } 100% { transform: scale(1.45); opacity: 0; } }
                @keyframes aiCaret { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
                @keyframes aiDot { 0%,80%,100% { opacity: .25; } 40% { opacity: 1; } }
                @keyframes aiSpin { to { transform: rotate(360deg); } }
                .ai-fab:hover { transform: translateY(-2px) scale(1.04); }
                .ai-fab-ring { position: absolute; inset: -1px; border-radius: 50%; border: 1px solid; animation: aiRing 2.6s ease-out infinite; pointer-events: none; }
                .ai-icon:hover { color: ${t.text} !important; background: ${t.raised} !important; }
                .ai-chip:hover { border-color: ${t.lineStrong} !important; color: ${t.text} !important; }
                .ai-row:hover { background: ${t.panelAlt} !important; }
                .ai-row:hover .ai-row-del { opacity: 1; }
                .ai-scroll::-webkit-scrollbar { width: 9px; }
                .ai-scroll::-webkit-scrollbar-thumb { background: ${t.lineStrong}; border-radius: 99px; border: 3px solid transparent; background-clip: content-box; }
                .ai-input::placeholder { color: ${t.faint}; }
                @media (prefers-reduced-motion: reduce) { .ai-fab-ring, .ai-spin { animation: none; } }
            `}</style>
        </>
    );
}

/* ── rail ───────────────────────────────────────────────────────────────── */

function Rail({ t, phone, open, chats, activeId, onPick, onNew, onRemove, onClose }) {
    if (!open) return null;

    const panel = (
        <aside
            aria-label="Recent chats"
            style={{
                width: SIDEBAR_W, flexShrink: 0, display: 'flex', flexDirection: 'column',
                background: t.panelAlt, borderRight: '1px solid ' + t.line,
                ...(phone ? { position: 'fixed', inset: '0 auto 0 0', zIndex: 2, boxShadow: t.shadow } : null),
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 12px 10px 16px' }}>
                <Sparkles size={15} strokeWidth={1.8} />
                <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.01em' }}>EdgeOS AI</span>
                {phone && (
                    <button type="button" onClick={onClose} aria-label="Close chats" className="ai-icon" style={iconBtn(t, { marginLeft: 'auto' })}>
                        <X size={14} />
                    </button>
                )}
            </div>

            <div style={{ padding: '0 10px 10px' }}>
                <button type="button" onClick={onNew} className="ai-row" style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 9, height: 34, padding: '0 10px',
                    border: 'none', borderRadius: 8, background: 'transparent', color: t.text,
                    fontFamily: MONO, fontSize: 12, cursor: 'pointer', textAlign: 'left',
                }}>
                    <PenSquare size={14} strokeWidth={1.8} /> New chat
                </button>
            </div>

            <div style={{ fontSize: 9.5, color: t.faint, padding: '4px 16px 6px', letterSpacing: '0.04em' }}>RECENTS</div>

            <div className="ai-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 12px' }}>
                {chats.map((c) => (
                    <div key={c.id} className="ai-row" style={{
                        display: 'flex', alignItems: 'center', borderRadius: 8, marginBottom: 1,
                        background: c.id === activeId ? t.raised : 'transparent',
                    }}>
                        <button
                            type="button" onClick={() => onPick(c.id)} aria-current={c.id === activeId}
                            style={{
                                flex: 1, minWidth: 0, textAlign: 'left', height: 32, padding: '0 4px 0 10px',
                                border: 'none', background: 'transparent', cursor: 'pointer',
                                fontFamily: MONO, fontSize: 11.5, color: c.id === activeId ? t.text : t.dim,
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}
                        >{c.title}</button>
                        <button
                            type="button" onClick={() => onRemove(c.id)} aria-label={`Delete ${c.title}`}
                            className="ai-row-del"
                            style={{
                                width: 26, height: 26, marginRight: 4, display: 'grid', placeItems: 'center', flexShrink: 0,
                                border: 'none', borderRadius: 6, background: 'transparent', color: t.faint,
                                cursor: 'pointer', opacity: 0, transition: 'opacity .15s',
                            }}
                        ><Trash2 size={12} /></button>
                    </div>
                ))}
            </div>
        </aside>
    );

    if (!phone) return panel;
    return (
        <>
            <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(0,0,0,0.45)' }} />
            {panel}
        </>
    );
}

/* ── top bar ────────────────────────────────────────────────────────────── */

function TopBar({ t, railOpen, onRail, onClose }) {
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', flexShrink: 0,
        }}>
            <button type="button" onClick={onRail} aria-label={railOpen ? 'Hide chats' : 'Show chats'} className="ai-icon" style={iconBtn(t)}>
                <PanelLeft size={15} />
            </button>

            {/* Chat / Work — Work is announced, not enabled. */}
            <div role="tablist" aria-label="Assistant scope" style={{
                margin: '0 auto', display: 'flex', gap: 2, padding: 3,
                background: t.panelAlt, border: '1px solid ' + t.line, borderRadius: 999,
            }}>
                <span role="tab" aria-selected="true" style={{
                    height: 26, padding: '0 16px', display: 'inline-flex', alignItems: 'center',
                    borderRadius: 999, background: t.panel, border: '1px solid ' + t.line,
                    fontSize: 11.5, color: t.text,
                }}>Chat</span>
                <button
                    type="button" role="tab" aria-selected="false" disabled
                    title="Work — coming soon"
                    style={{
                        height: 26, padding: '0 14px', display: 'inline-flex', alignItems: 'center', gap: 6,
                        border: 'none', background: 'transparent', borderRadius: 999,
                        fontFamily: MONO, fontSize: 11.5, color: t.faint, cursor: 'not-allowed',
                    }}
                >
                    Work
                    <span style={{
                        fontSize: 8.5, letterSpacing: '0.04em', padding: '2px 5px', borderRadius: 4,
                        border: '1px solid ' + t.line, color: t.ghost,
                    }}>SOON</span>
                </button>
            </div>

            <button type="button" onClick={onClose} aria-label="Close assistant" className="ai-icon" style={iconBtn(t)}>
                <X size={15} />
            </button>
        </div>
    );
}

/* ── empty state ────────────────────────────────────────────────────────── */

function Welcome({ t, onPick, children }) {
    return (
        <div style={{
            flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', padding: '0 16px 40px',
        }} className="ai-scroll">
            <div style={{ width: '100%', maxWidth: 760 }}>
                <h1 style={{
                    margin: '0 0 22px', textAlign: 'center', fontSize: 23, fontWeight: 500,
                    letterSpacing: '-0.02em', color: t.text,
                }}>What’s on the agenda today?</h1>
                {children}
                <div style={{ display: 'grid', gap: 2, marginTop: 18, justifyItems: 'center' }}>
                    {SUGGESTIONS.map((s) => (
                        <button key={s} type="button" onClick={() => onPick(s)} className="ai-chip" style={{
                            padding: '9px 14px', border: '1px solid transparent', borderRadius: 999,
                            background: 'transparent', color: t.dim, fontFamily: MONO, fontSize: 11.5, cursor: 'pointer',
                        }}>{s}</button>
                    ))}
                </div>
            </div>
        </div>
    );
}

/* ── thread ─────────────────────────────────────────────────────────────── */

function Thread({ t, messages, streaming }) {
    const scrollRef = useRef(null);

    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages, streaming]);

    return (
        <div ref={scrollRef} className="ai-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 16px 20px' }}>
            <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 26 }}>
                {messages.map((m) => (
                    m.role === 'user' ? (
                        <div key={m.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <div style={{
                                maxWidth: '78%', padding: '10px 15px', borderRadius: 18,
                                background: t.raised, color: t.text, fontSize: 13, lineHeight: 1.6,
                                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            }}>{m.content}</div>
                        </div>
                    ) : (
                        <div key={m.id} style={{
                            fontSize: 13.5, lineHeight: 1.7, wordBreak: 'break-word',
                            color: m.error ? t.down : t.text, padding: '0 2px',
                        }}>
                            {m.content ? <Markdown text={m.content} t={t} /> : (
                                <span style={{ display: 'inline-flex', gap: 4 }}>
                                    {[0, 1, 2].map((i) => (
                                        <span key={i} style={{
                                            width: 5, height: 5, borderRadius: '50%', background: t.dim,
                                            animation: `aiDot 1.2s ${i * 0.15}s infinite`,
                                        }} />
                                    ))}
                                </span>
                            )}
                        </div>
                    )
                ))}
            </div>
        </div>
    );
}

/* ── composer ───────────────────────────────────────────────────────────── */

function Composer({ t, draft, setDraft, send, streaming, speech, onCall, autoFocus }) {
    const inputRef = useRef(null);
    const { supported, listening, finalText, interim, start, stop } = speech;
    // What the mic has heard this dictation, kept apart from what was typed
    // before it started so stopping does not eat the typed part.
    const baseRef = useRef('');

    useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 168) + 'px';
    }, [draft]);

    // Dictation writes straight into the draft, so the user edits what was
    // heard instead of accepting or discarding a separate transcript.
    useEffect(() => {
        if (!listening) return;
        const heard = (finalText + (interim ? ' ' + interim : '')).trim();
        setDraft((baseRef.current ? baseRef.current + ' ' : '') + heard);
    }, [listening, finalText, interim, setDraft]);

    const toggleMic = () => {
        if (listening) { stop(); return; }
        baseRef.current = draft.trim();
        start();
    };

    const canSend = Boolean(draft.trim()) && !streaming;

    return (
        <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 8, padding: '8px 8px 8px 16px',
            border: '1px solid ' + t.lineStrong, borderRadius: 26, background: t.panelAlt,
            boxShadow: t.isDark ? 'none' : '0 1px 2px rgba(16,24,40,0.04)',
        }}>
            <textarea
                ref={inputRef} rows={1} value={draft} className="ai-input"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={listening ? 'Listening…' : 'Ask anything'}
                aria-label="Message the assistant"
                style={{
                    flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'transparent',
                    fontFamily: MONO, fontSize: 13, lineHeight: 1.55, color: t.text,
                    padding: '8px 0', maxHeight: 168,
                }}
            />

            <button
                type="button" onClick={toggleMic} disabled={!supported}
                aria-label={listening ? 'Stop dictation' : 'Dictate'} aria-pressed={listening}
                title={supported ? 'Dictate' : 'Speech recognition is not available in this browser'}
                className="ai-icon"
                style={{
                    width: 34, height: 34, flexShrink: 0, display: 'grid', placeItems: 'center', padding: 0,
                    border: 'none', borderRadius: '50%', background: listening ? t.raised : 'transparent',
                    color: listening ? t.text : t.dim, cursor: supported ? 'pointer' : 'not-allowed',
                    opacity: supported ? 1 : 0.4, transition: 'background .15s, color .15s',
                }}
            >{listening ? <Square size={13} fill="currentColor" /> : <Mic size={16} strokeWidth={1.8} />}</button>

            {/* One round button: it sends when there is something to send, spins
                while the answer streams, and otherwise starts a voice call. */}
            {streaming ? (
                <span aria-label="Generating answer" role="status" style={{
                    width: 34, height: 34, flexShrink: 0, display: 'grid', placeItems: 'center',
                    borderRadius: '50%', background: t.raised,
                }}>
                    <span className="ai-spin" style={{
                        width: 15, height: 15, borderRadius: '50%',
                        border: '2px solid ' + t.lineStrong, borderTopColor: t.text,
                        animation: 'aiSpin .7s linear infinite',
                    }} />
                </span>
            ) : canSend ? (
                <button
                    type="button" onClick={() => send()} aria-label="Send"
                    style={{
                        width: 34, height: 34, flexShrink: 0, display: 'grid', placeItems: 'center', padding: 0,
                        border: 'none', borderRadius: '50%', background: t.text, color: t.panel, cursor: 'pointer',
                    }}
                ><ArrowUp size={16} strokeWidth={2.2} /></button>
            ) : (
                <button
                    type="button" onClick={onCall} aria-label="Start voice call" title="Voice call"
                    style={{
                        width: 34, height: 34, flexShrink: 0, display: 'grid', placeItems: 'center', padding: 0,
                        border: 'none', borderRadius: '50%', background: ACCENT, color: '#fff', cursor: 'pointer',
                    }}
                ><Phone size={15} strokeWidth={2} /></button>
            )}
        </div>
    );
}

/* ── voice call ─────────────────────────────────────────────────────────── */

function VoiceCall({ t, theme, speech, onEnd, onCancel }) {
    const { supported, listening, finalText, interim, error, levelRef, start, stop } = speech;
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        if (supported) start();
        return () => stop();
        // Starts once with the call; the buttons drive it from then on.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const t0 = Date.now();
        const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
        return () => clearInterval(id);
    }, []);

    const text = (finalText + (interim ? ' ' + interim : '')).trim();
    const mmss = String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0');

    return (
        <div role="dialog" aria-label="Voice call" style={{
            position: 'absolute', inset: 0, zIndex: 3, background: t.panel,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, padding: 24,
        }}>
            <Orb size={168} levelRef={levelRef} dark={theme === 'dark'} />

            <div style={{ fontFamily: MONO, fontSize: 11, color: t.faint }}>
                {error ? 'Microphone unavailable' : !supported ? 'Voice needs Chrome, Edge or Safari' : listening ? `listening · ${mmss}` : 'paused'}
            </div>

            <div className="ai-scroll" style={{
                width: '100%', maxWidth: 620, maxHeight: 180, overflowY: 'auto', textAlign: 'center',
                fontSize: 15, lineHeight: 1.65, color: t.text,
            }}>
                {text ? (
                    <p style={{ margin: 0 }}>
                        <span>{finalText}</span>
                        {interim && <span style={{ color: t.faint }}>{finalText ? ' ' : ''}{interim}</span>}
                    </p>
                ) : (
                    <span style={{ color: t.faint, fontSize: 12.5 }}>Say what you need — it goes to the chat when you hang up.</span>
                )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button type="button" onClick={onCancel} aria-label="Cancel call" className="ai-chip" style={{
                    height: 40, padding: '0 16px', borderRadius: 999, border: '1px solid ' + t.line,
                    background: 'transparent', color: t.dim, fontFamily: MONO, fontSize: 12, cursor: 'pointer',
                }}>Cancel</button>

                <button type="button" onClick={() => onEnd(text)} disabled={!text} aria-label="End call and send" style={{
                    height: 40, padding: '0 20px', borderRadius: 999, border: 'none',
                    background: text ? ACCENT : t.raised, color: text ? '#fff' : t.faint,
                    fontFamily: MONO, fontSize: 12, cursor: text ? 'pointer' : 'default',
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                }}>
                    <Phone size={14} style={{ transform: 'rotate(135deg)' }} /> Hang up &amp; send
                </button>
            </div>
        </div>
    );
}

const iconBtn = (t, extra) => ({
    width: 30, height: 30, display: 'grid', placeItems: 'center', padding: 0,
    border: 'none', borderRadius: 8, background: 'transparent',
    color: t.dim, cursor: 'pointer', transition: 'color .15s, background .15s',
    ...extra,
});
