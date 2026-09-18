import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, X, Mic, Square, Copy, Check, RotateCcw, ArrowUp, MessageSquare, AudioLines } from 'lucide-react';
import { makeTokens, MONO } from '../../theme/edge';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { callCofounderAI } from '../../services/cofounderAI';
import Orb from './Orb';
import { MOBILE_NAV_H } from '../shell/MobileNav';

/* ══════════════════════════════════════════════════════════════════════════
   AI Assistant — a round launcher bottom-right, and a panel with two modes.

   Voice: live speech-to-text. The orb listens to the microphone level and the
   transcript streams in as it is recognised: committed words in full ink,
   words still being decided in faint ink, replaced in place.
   Text: a chat over the Co-founder AI stream, fed the same EdgeOS context the
   old side panel used. A voice transcript can be handed to it in one click.

   Mounted once at the app root so the conversation survives navigation.
   ══════════════════════════════════════════════════════════════════════════ */

const SUGGESTIONS = [
    'How is revenue trending this quarter?',
    'Which invoices are still unpaid?',
    'Summarise our top customers',
];

const mmss = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

function useIsNarrow() {
    const [n, setN] = useState(() => typeof window !== 'undefined' && window.innerWidth < 600);
    useEffect(() => {
        const fn = () => setN(window.innerWidth < 600);
        window.addEventListener('resize', fn);
        return () => window.removeEventListener('resize', fn);
    }, []);
    return n;
}

// Matches the width below which the shell swaps its rail for the bottom bar.
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
    const narrow = useIsNarrow();
    const phone = useIsPhone();
    // On phones the launcher floats just above the bottom bar instead of on it.
    const fabBottom = phone ? `calc(${MOBILE_NAV_H + 14}px + env(safe-area-inset-bottom))` : 20;
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState('voice');

    const speech = useSpeechRecognition();
    const { stop: stopSpeech, listening } = speech;

    // text chat
    const [messages, setMessages] = useState([]);   // { id, role, content, error? }
    const [draft, setDraft] = useState('');
    const [streaming, setStreaming] = useState(false);

    // The mic never outlives the voice view.
    useEffect(() => {
        if ((!open || mode !== 'voice') && listening) stopSpeech();
    }, [open, mode, listening, stopSpeech]);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open]);

    const send = useCallback((text) => {
        const content = (text ?? draft).trim();
        if (!content || streaming) return;
        const history = messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
        const replyId = Date.now() + 1;
        setMessages((ms) => [...ms, { id: Date.now(), role: 'user', content }, { id: replyId, role: 'assistant', content: '' }]);
        setDraft('');
        setStreaming(true);
        const patch = (fields) => setMessages((ms) => ms.map((m) => (m.id === replyId ? { ...m, ...fields } : m)));
        callCofounderAI(content, history, edgeContext || {}, {
            onToken: (_tok, full) => patch({ content: full }),
            onComplete: (full) => { patch({ content: full }); setStreaming(false); },
            onError: (err) => { patch({ content: err || 'Something went wrong.', error: true }); setStreaming(false); },
        }).catch((err) => { patch({ content: err?.message || 'Something went wrong.', error: true }); setStreaming(false); });
    }, [draft, streaming, messages, edgeContext]);

    const toChat = () => {
        const text = speech.finalText + (speech.interim ? ' ' + speech.interim : '');
        stopSpeech();
        setDraft(text.trim());
        setMode('text');
    };

    return (
        <>
            {/* ── launcher ─────────────────────────────────────────────── */}
            {!(open && narrow) && (
                <button
                    type="button" onClick={() => setOpen((v) => !v)}
                    aria-label={open ? 'Close AI Assistant' : 'Open AI Assistant'} aria-expanded={open}
                    className="ai-fab"
                    style={{
                        position: 'fixed', right: 16, bottom: fabBottom, zIndex: 170,
                        width: 48, height: 48, borderRadius: '50%', padding: 0,
                        display: 'grid', placeItems: 'center', cursor: 'pointer',
                        background: open ? t.selBg : t.panel, color: open ? t.selText : t.text,
                        border: '1px solid ' + t.lineStrong, boxShadow: t.shadow,
                        transition: 'transform .2s cubic-bezier(.16,1,.3,1), background .2s, color .2s',
                    }}
                >
                    <span style={{ display: 'grid', placeItems: 'center', transition: 'transform .25s', transform: open ? 'rotate(90deg)' : 'none' }}>
                        {open ? <X size={18} strokeWidth={2} /> : <Sparkles size={18} strokeWidth={1.8} />}
                    </span>
                    {!open && <span className="ai-fab-ring" style={{ borderColor: t.lineStrong }} />}
                </button>
            )}

            {/* ── panel ────────────────────────────────────────────────── */}
            {open && (
                <div
                    role="dialog" aria-label="AI Assistant"
                    style={{
                        position: 'fixed', zIndex: 169,
                        ...(narrow
                            ? { inset: 0, borderRadius: 0 }
                            : { right: 20, bottom: phone ? `calc(${MOBILE_NAV_H + 74}px + env(safe-area-inset-bottom))` : 80, width: 392, height: phone ? 'min(620px, calc(100vh - 170px))' : 'min(620px, calc(100vh - 110px))', borderRadius: 14 }),
                        background: t.panel, border: narrow ? 'none' : '1px solid ' + t.lineStrong,
                        boxShadow: t.shadow, overflow: 'hidden',
                        display: 'flex', flexDirection: 'column',
                        fontFamily: MONO, color: t.text, WebkitFontSmoothing: 'antialiased',
                        transformOrigin: 'bottom right', animation: 'aiIn .22s cubic-bezier(.16,1,.3,1)',
                    }}
                >
                    {/* header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 12px 10px 16px', flexShrink: 0 }}>
                        <span style={{
                            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                            background: listening ? t.down : streaming ? t.up : t.faint,
                        }} className={listening || streaming ? 'ai-pulse' : undefined} />
                        <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em' }}>AI Assistant</span>
                        <span style={{ fontSize: 9.5, color: t.faint }}>
                            {listening ? 'listening' : streaming ? 'thinking' : 'EdgeOS'}
                        </span>
                        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="ai-icon" style={iconBtn(t, { marginLeft: 'auto' })}>
                            <X size={14} />
                        </button>
                    </div>

                    {/* voice / text toggle */}
                    <div style={{ padding: '0 16px 12px', flexShrink: 0, borderBottom: '1px solid ' + t.line }}>
                        <div role="tablist" style={{
                            position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr',
                            background: t.panelAlt, border: '1px solid ' + t.line, borderRadius: 8, padding: 2,
                        }}>
                            <span style={{
                                position: 'absolute', top: 2, bottom: 2, left: 2, width: 'calc(50% - 2px)',
                                background: t.selBg, borderRadius: 6,
                                transform: mode === 'text' ? 'translateX(100%)' : 'none',
                                transition: 'transform .25s cubic-bezier(.16,1,.3,1)',
                            }} />
                            {[['voice', 'Voice', AudioLines], ['text', 'Text', MessageSquare]].map(([id, label, Icon]) => (
                                <button
                                    key={id} type="button" role="tab" aria-selected={mode === id}
                                    onClick={() => setMode(id)}
                                    style={{
                                        position: 'relative', zIndex: 1, height: 28, border: 'none', background: 'transparent',
                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                        fontFamily: MONO, fontSize: 11, cursor: 'pointer',
                                        color: mode === id ? t.selText : t.faint, transition: 'color .2s',
                                    }}
                                ><Icon size={12} />{label}</button>
                            ))}
                        </div>
                    </div>

                    {mode === 'voice'
                        ? <VoiceView t={t} theme={theme} speech={speech} onToChat={toChat} />
                        : <TextView t={t} theme={theme} messages={messages} draft={draft} setDraft={setDraft}
                                    send={send} streaming={streaming} onClear={() => setMessages([])} />}
                </div>
            )}

            <style>{`
                @keyframes aiIn { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: none; } }
                @keyframes aiRing { 0% { transform: scale(1); opacity: .55; } 100% { transform: scale(1.45); opacity: 0; } }
                @keyframes aiPulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
                @keyframes aiCaret { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
                @keyframes aiDot { 0%,80%,100% { opacity: .25; } 40% { opacity: 1; } }
                .ai-fab:hover { transform: translateY(-2px) scale(1.04); }
                .ai-fab-ring { position: absolute; inset: -1px; border-radius: 50%; border: 1px solid; animation: aiRing 2.6s ease-out infinite; pointer-events: none; }
                .ai-pulse { animation: aiPulse 1.2s ease-in-out infinite; }
                .ai-icon:hover { color: ${t.text} !important; border-color: ${t.lineStrong} !important; }
                .ai-chip:hover { border-color: ${t.lineStrong} !important; color: ${t.text} !important; }
                .ai-scroll::-webkit-scrollbar { width: 8px; }
                .ai-scroll::-webkit-scrollbar-thumb { background: ${t.lineStrong}; border-radius: 99px; border: 2px solid transparent; background-clip: content-box; }
                .ai-input::placeholder { color: ${t.faint}; }
                @media (prefers-reduced-motion: reduce) { .ai-fab-ring { animation: none; } }
            `}</style>
        </>
    );
}

/* ── Voice ──────────────────────────────────────────────────────────────── */

function VoiceView({ t, theme, speech, onToChat }) {
    const { supported, listening, finalText, interim, error, levelRef, start, stop, reset } = speech;
    const [elapsed, setElapsed] = useState(0);
    const [copied, setCopied] = useState(false);
    const scrollRef = useRef(null);

    useEffect(() => {
        if (!listening) return undefined;
        const t0 = Date.now();
        const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
        return () => clearInterval(id);
    }, [listening]);

    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [finalText, interim]);

    const toggle = () => {
        if (listening) { stop(); return; }
        setElapsed(0);
        start();
    };
    const text = (finalText + (interim ? ' ' + interim : '')).trim();
    const words = text ? text.split(/\s+/).length : 0;

    const copy = async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* ignore */ }
    };

    return (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {/* orb */}
            <div style={{
                position: 'relative', flexShrink: 0, display: 'grid', placeItems: 'center', padding: '6px 0 0',
                background: `radial-gradient(60% 70% at 50% 45%, ${t.panelAlt} 0%, ${t.panel} 70%)`,
            }}>
                <button
                    type="button" onClick={supported ? toggle : undefined}
                    aria-label={listening ? 'Stop listening' : 'Start listening'}
                    style={{ border: 'none', background: 'transparent', padding: 0, cursor: supported ? 'pointer' : 'default', borderRadius: '50%' }}
                >
                    <Orb size={200} levelRef={levelRef} dark={theme === 'dark'} active={listening} />
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 9.5, letterSpacing: '0.08em', color: t.faint, marginTop: -8, paddingBottom: 12 }}>
                    {listening ? (
                        <>
                            <span className="ai-pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: t.down }} />
                            <span style={{ color: t.text }}>LISTENING</span>
                            <span>{mmss(elapsed)}</span>
                        </>
                    ) : supported ? (
                        <span>TAP THE ORB TO SPEAK</span>
                    ) : (
                        <span>VOICE NOT SUPPORTED HERE</span>
                    )}
                </div>
            </div>

            {/* transcript */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderTop: '1px solid ' + t.line }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px 0', fontSize: 9, color: t.faint, letterSpacing: '0.08em' }}>
                    <span>TRANSCRIPT</span>
                    <span style={{ marginLeft: 'auto', letterSpacing: 0 }}>{words} {words === 1 ? 'word' : 'words'}</span>
                </div>
                <div ref={scrollRef} className="ai-scroll" aria-live="polite" style={{
                    flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 16px 12px',
                    fontSize: 13.5, lineHeight: 1.65, letterSpacing: '-0.01em', wordBreak: 'break-word',
                }}>
                    {error ? (
                        <div style={{ fontSize: 11, color: t.down, lineHeight: 1.5 }}>{error}</div>
                    ) : !supported ? (
                        <div style={{ fontSize: 11, color: t.faint, lineHeight: 1.6 }}>
                            This browser has no speech recognition. Voice works in Chrome, Edge and Safari.
                        </div>
                    ) : !text ? (
                        <div style={{ fontSize: 11, color: t.faint, lineHeight: 1.6 }}>
                            {listening ? 'Go ahead, I’m listening…' : 'Your words will appear here as you speak.'}
                        </div>
                    ) : null}
                    {text && (
                        <p style={{ margin: 0 }}>
                            <span style={{ color: t.text }}>{finalText}</span>
                            {interim && <span style={{ color: t.faint }}>{finalText ? ' ' : ''}{interim}</span>}
                            {listening && (
                                <span style={{
                                    display: 'inline-block', width: 7, height: 15, marginLeft: 3, verticalAlign: '-2px',
                                    background: t.text, animation: 'aiCaret 1s steps(1) infinite',
                                }} />
                            )}
                        </p>
                    )}
                </div>
            </div>

            {/* controls */}
            <div style={{
                display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center',
                padding: '10px 16px 14px', borderTop: '1px solid ' + t.line, flexShrink: 0,
            }}>
                <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={reset} disabled={!text} title="Clear" aria-label="Clear transcript" className="ai-icon" style={iconBtn(t, { opacity: text ? 1 : 0.4 })}>
                        <RotateCcw size={13} />
                    </button>
                    <button type="button" onClick={copy} disabled={!text} title="Copy" aria-label="Copy transcript" className="ai-icon" style={iconBtn(t, { opacity: text ? 1 : 0.4 })}>
                        {copied ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                </div>

                <button
                    type="button" onClick={toggle} disabled={!supported}
                    aria-label={listening ? 'Stop listening' : 'Start listening'}
                    style={{
                        width: 50, height: 50, borderRadius: '50%', padding: 0, display: 'grid', placeItems: 'center',
                        border: '1px solid ' + (listening ? t.text : t.lineStrong),
                        background: listening ? t.text : t.selBg, color: listening ? t.panel : t.selText,
                        cursor: supported ? 'pointer' : 'not-allowed', opacity: supported ? 1 : 0.4,
                        boxShadow: listening ? '0 0 0 6px ' + (t.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(14,16,17,0.10)') : 'none',
                        transition: 'background .2s, border-color .2s, box-shadow .2s',
                    }}
                >
                    {listening ? <Square size={15} fill="currentColor" /> : <Mic size={18} />}
                </button>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={onToChat} disabled={!text} className="ai-chip" style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 9px',
                        fontFamily: MONO, fontSize: 10.5, borderRadius: 7, cursor: text ? 'pointer' : 'default',
                        border: '1px solid ' + t.line, background: 'transparent', color: t.dim, opacity: text ? 1 : 0.4,
                    }}>Ask AI <ArrowUp size={11} style={{ transform: 'rotate(45deg)' }} /></button>
                </div>
            </div>
        </div>
    );
}

/* ── Text ───────────────────────────────────────────────────────────────── */

function TextView({ t, theme, messages, draft, setDraft, send, streaming, onClear }) {
    const scrollRef = useRef(null);
    const inputRef = useRef(null);
    const idleLevel = useRef(0);

    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages]);

    useEffect(() => { inputRef.current?.focus(); }, []);

    // grow the input with its content, up to five lines
    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 110) + 'px';
    }, [draft]);

    return (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div ref={scrollRef} className="ai-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px' }}>
                {messages.length === 0 ? (
                    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                        <Orb size={120} levelRef={idleLevel} dark={theme === 'dark'} />
                        <div style={{ fontSize: 13, marginTop: 4 }}>What do you want to know?</div>
                        <div style={{ fontSize: 10.5, color: t.faint, marginTop: 4, marginBottom: 16 }}>Revenue, invoices, customers, your team.</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                            {SUGGESTIONS.map((s) => (
                                <button key={s} type="button" onClick={() => send(s)} className="ai-chip" style={{
                                    textAlign: 'left', padding: '8px 11px', fontFamily: MONO, fontSize: 11,
                                    border: '1px solid ' + t.line, borderRadius: 8, background: 'transparent',
                                    color: t.dim, cursor: 'pointer', transition: 'border-color .15s, color .15s',
                                }}>{s}</button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {messages.map((m) => (
                            m.role === 'user' ? (
                                <div key={m.id} style={{
                                    alignSelf: 'flex-end', maxWidth: '85%', padding: '8px 11px', borderRadius: '10px 10px 3px 10px',
                                    background: t.selBg, color: t.selText, fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                }}>{m.content}</div>
                            ) : (
                                <div key={m.id} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                                    <span style={{
                                        width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                                        background: 'radial-gradient(circle at 35% 30%, ' + t.panel + ' 0%, ' + t.scale[3] + ' 45%, ' + t.text + ' 100%)',
                                        border: '1px solid ' + t.lineStrong,
                                    }} />
                                    <div style={{
                                        flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                        color: m.error ? t.down : t.text,
                                    }}>
                                        {m.content || (
                                            <span style={{ display: 'inline-flex', gap: 3 }}>
                                                {[0, 1, 2].map((i) => (
                                                    <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: t.dim, animation: `aiDot 1.2s ${i * 0.15}s infinite` }} />
                                                ))}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )
                        ))}
                    </div>
                )}
            </div>

            <div style={{ padding: '10px 12px 12px', borderTop: '1px solid ' + t.line, flexShrink: 0 }}>
                <div style={{
                    display: 'flex', alignItems: 'flex-end', gap: 8, padding: '6px 6px 6px 11px',
                    border: '1px solid ' + t.lineStrong, borderRadius: 10, background: t.panelAlt,
                }}>
                    <textarea
                        ref={inputRef} rows={1} value={draft} className="ai-input"
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                        placeholder="Ask anything…"
                        style={{
                            flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'transparent',
                            fontFamily: MONO, fontSize: 12, lineHeight: 1.5, color: t.text, padding: '4px 0', maxHeight: 110,
                        }}
                    />
                    <button type="button" onClick={() => send()} disabled={!draft.trim() || streaming} aria-label="Send" style={{
                        width: 28, height: 28, borderRadius: 7, padding: 0, display: 'grid', placeItems: 'center', flexShrink: 0,
                        border: 'none', background: draft.trim() && !streaming ? t.text : t.raised,
                        color: draft.trim() && !streaming ? t.panel : t.faint,
                        cursor: draft.trim() && !streaming ? 'pointer' : 'default', transition: 'background .15s',
                    }}><ArrowUp size={14} /></button>
                </div>
                <div style={{ display: 'flex', fontSize: 9, color: t.faint, marginTop: 6, padding: '0 2px' }}>
                    <span>Enter to send · Shift+Enter for a new line</span>
                    {messages.length > 0 && !streaming && (
                        <button type="button" onClick={onClear} style={{
                            marginLeft: 'auto', border: 'none', background: 'transparent', padding: 0,
                            fontFamily: MONO, fontSize: 9, color: t.faint, cursor: 'pointer',
                        }}>clear chat</button>
                    )}
                </div>
            </div>
        </div>
    );
}

const iconBtn = (t, extra) => ({
    width: 28, height: 28, display: 'grid', placeItems: 'center', padding: 0,
    border: '1px solid ' + t.line, borderRadius: 7, background: 'transparent',
    color: t.dim, cursor: 'pointer', transition: 'color .15s, border-color .15s',
    ...extra,
});
