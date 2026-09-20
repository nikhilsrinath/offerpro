import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Sparkles, X, Mic, Square, ArrowUp, PenSquare, PanelLeft, Phone, Trash2,
    Pencil, MoreHorizontal, Share2, Pin, PinOff,
} from 'lucide-react';
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
// The menu's own size, needed before it renders so it can be placed without
// first painting off-screen and jumping.
const MENU_W = 178;
const MENU_H = 170;

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
    // A one-line, self-clearing status for actions with no visible result of
    // their own — copying a transcript being the one that needs it.
    const [note, setNote] = useState('');

    const speech = useSpeechRecognition();
    const { stop: stopSpeech, listening } = speech;

    const active = useMemo(() => chats.find((c) => c.id === activeId) || chats[0], [chats, activeId]);
    const messages = useMemo(() => active?.messages || [], [active]);

    useEffect(() => {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(chats.slice(0, 40))); } catch { /* quota */ }
    }, [chats]);

    useEffect(() => {
        if (!note) return undefined;
        const id = setTimeout(() => setNote(''), 2600);
        return () => clearTimeout(id);
    }, [note]);

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
            // A name the person typed is never replaced by one derived here.
            title: (c.titled || c.messages.length) ? c.title : titleFor(content),
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

    /**
     * A name the person chose, which outranks the one derived from their first
     * message. `titled` is what send() checks: without it, naming a chat before
     * saying anything would have the first message immediately overwrite the
     * name, which reads as the rename silently failing.
     */
    const renameChat = (id, title) => {
        const clean = title.replace(/\s+/g, ' ').trim().slice(0, 60);
        // An empty name is a cancelled rename, not a nameless chat.
        if (!clean) return;
        patchChat(id, (c) => ({ ...c, title: clean, titled: true }));
    };

    const togglePin = (id) => patchChat(id, (c) => ({ ...c, pinned: !c.pinned }));

    /**
     * Share: the system share sheet where there is one, the clipboard where
     * there is not.
     *
     * Not a link. These chats live in this browser's localStorage and have no
     * server-side existence, so there is no URL that would open this
     * conversation for anybody else — a "share link" here would be a promise
     * the product cannot keep. Handing over the transcript is the honest
     * version of the same intent, and it is what the person actually wanted to
     * send.
     */
    const shareChat = async (chat) => {
        const text = (chat.messages || [])
            .filter((m) => !m.error && m.content)
            .map((m) => `${m.role === 'user' ? 'You' : 'EdgeOS AI'}: ${m.content}`)
            .join('\n\n');
        if (!text) { setNote('That chat is empty — nothing to share yet.'); return; }
        const payload = `${chat.title}\n\n${text}`;
        try {
            if (navigator.share) {
                await navigator.share({ title: chat.title, text: payload });
                return;
            }
            await navigator.clipboard.writeText(payload);
            setNote('Conversation copied to your clipboard.');
        } catch {
            // AbortError is the person dismissing the share sheet, which is not
            // a failure. Anything else usually means the clipboard was refused.
            if (!navigator.share) setNote('Could not copy this conversation.');
        }
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
                        onNew={startChat} onRemove={removeChat} onRename={renameChat}
                        onPin={togglePin} onShare={shareChat}
                        onClose={() => setRailOpen(false)}
                    />

                    {/* Copying a transcript changes nothing on screen, so it
                        needs saying. role=status announces it without stealing
                        focus from wherever the person already is. */}
                    {note && (
                        <div role="status" style={{
                            position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)',
                            zIndex: 330, padding: '8px 14px', borderRadius: 999,
                            background: t.raised, color: t.text, border: '1px solid ' + t.line,
                            boxShadow: t.shadow, fontSize: 11, fontFamily: MONO,
                        }}>{note}</div>
                    )}

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
                /* focus-within as well as hover: the buttons are in the tab
                   order, and a control you can focus but cannot see is worse
                   than one that is simply absent. */
                /* The hidden/revealed state lives entirely here, never as an
                   inline style. An inline opacity:0 outranks any rule in this
                   sheet that does not shout !important, so a button styled
                   hidden in JSX stays hidden on hover — which is exactly how
                   the row actions ended up unreachable by mouse. */
                .ai-row-act { opacity: 0; transition: opacity .15s; }
                .ai-row:hover .ai-row-act,
                .ai-row:focus-within .ai-row-act,
                .ai-row-act.is-shown { opacity: 1; }
                .ai-row-act:hover { color: ${t.text} !important; background: ${t.raised} !important; }
                .ai-scroll::-webkit-scrollbar { width: 9px; }
                .ai-scroll::-webkit-scrollbar-thumb { background: ${t.lineStrong}; border-radius: 99px; border: 3px solid transparent; background-clip: content-box; }
                .ai-input::placeholder { color: ${t.faint}; }
                @media (prefers-reduced-motion: reduce) { .ai-fab-ring, .ai-spin { animation: none; } }
            `}</style>
        </>
    );
}

/* ── rail ───────────────────────────────────────────────────────────────── */

/**
 * The per-chat actions, in a popup anchored to the row's ⋯ button.
 *
 * Positioned `fixed` from the button's own rect rather than absolutely inside
 * the row: the list of chats is a scroll container, and a menu positioned
 * within it is clipped by its overflow the moment it is taller than the row it
 * belongs to. Fixed escapes that, at the cost of having to close on scroll —
 * which is the behaviour people expect from an anchored menu anyway.
 */
function ChatMenu({ t, chat, at, onClose, onShare, onRename, onPin, onDelete }) {
    const ref = useRef(null);

    useEffect(() => {
        ref.current?.querySelector('button')?.focus();
    }, []);

    useEffect(() => {
        const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            // Same collision as the rename field: Escape here means "close the
            // menu", not "close the assistant", so it must not reach document.
            e.stopPropagation();
            onClose();
        };
        // Capture, so a scroll anywhere — including the rail's own list —
        // dismisses a menu that would otherwise hang detached from its row.
        const onScroll = () => onClose();
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey, true);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onScroll);
        };
    }, [onClose]);

    const run = (fn) => () => { onClose(); fn(); };

    const item = (danger) => ({
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        height: 32, padding: '0 12px', border: 'none', borderRadius: 7,
        background: 'transparent', cursor: 'pointer', textAlign: 'left',
        fontFamily: MONO, fontSize: 11.5, color: danger ? t.danger || '#e5484d' : t.text,
    });

    return (
        <div
            ref={ref} role="menu" aria-label={`Actions for ${chat.title}`}
            style={{
                position: 'fixed', top: at.y, left: at.x, zIndex: 320, width: MENU_W,
                padding: 6, borderRadius: 12, background: t.panel,
                border: '1px solid ' + t.line, boxShadow: t.shadow,
            }}
        >
            <button type="button" role="menuitem" className="ai-row" style={item()} onClick={run(() => onShare(chat))}>
                <Share2 size={13} strokeWidth={1.8} /> Share
            </button>
            <button type="button" role="menuitem" className="ai-row" style={item()} onClick={run(() => onRename(chat.id))}>
                <Pencil size={13} strokeWidth={1.8} /> Rename
            </button>
            <button type="button" role="menuitem" className="ai-row" style={item()} onClick={run(() => onPin(chat.id))}>
                {chat.pinned
                    ? <><PinOff size={13} strokeWidth={1.8} /> Unpin chat</>
                    : <><Pin size={13} strokeWidth={1.8} /> Pin chat</>}
            </button>
            <div style={{ height: 1, background: t.line, margin: '5px 8px' }} />
            <button type="button" role="menuitem" className="ai-row" style={item(true)} onClick={run(() => onDelete(chat.id))}>
                <Trash2 size={13} strokeWidth={1.8} /> Delete
            </button>
        </div>
    );
}

/**
 * One chat in the rail.
 *
 * Its three appearances — normal, being renamed, confirming a delete — are
 * driven by the rail rather than by state of its own, because the menu that
 * triggers two of them is the rail's. One owner means one open menu, one row
 * being renamed, and no way for a row to be in two states at once.
 *
 * Deleting asks first. A chat lives in localStorage and nowhere else, so there
 * is no undo and nothing to restore it from. The confirm is inline rather than
 * window.confirm: a browser modal blocks the whole surface, and this one can
 * have a voice call running in it.
 */
function ChatRow({ t, chat, active, phone, renaming, confirming, onPick, onRename, onRemove, onStartRename, onCancel, onMenu, menuOpen }) {
    const inputRef = useRef(null);

    // Uncontrolled, seeded from the title it is editing. A controlled draft
    // would need resetting from props every time the field opens, which is a
    // setState inside an effect — a cascading render to solve a problem the
    // DOM already solves.
    useEffect(() => {
        if (!renaming) return;
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [renaming]);

    const commit = () => onRename(chat.id, inputRef.current?.value ?? '');

    const rowStyle = {
        display: 'flex', alignItems: 'center', borderRadius: 8, marginBottom: 1,
        background: active ? t.raised : 'transparent',
    };

    if (renaming) {
        return (
            <div style={rowStyle}>
                <input
                    ref={inputRef} defaultValue={chat.title} aria-label="Chat name" maxLength={60}
                    // Committing on blur means clicking away saves rather than
                    // discards — the same thing every rename-in-place does.
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commit(); }
                        if (e.key !== 'Escape') return;
                        // The workspace closes on Escape from a listener on
                        // document. Without stopping the event here, cancelling
                        // a rename would also shut the whole assistant — one
                        // key, two meanings, and the wrong one wins.
                        e.preventDefault();
                        e.stopPropagation();
                        onCancel();
                    }}
                    className="ai-input"
                    style={{
                        flex: 1, minWidth: 0, height: 32, padding: '0 8px', margin: '0 4px',
                        borderRadius: 6, border: '1px solid ' + t.lineStrong,
                        background: t.panel, color: t.text, fontFamily: MONO, fontSize: 11.5,
                    }}
                />
            </div>
        );
    }

    if (confirming) {
        return (
            <div style={{ ...rowStyle, gap: 6, padding: '0 6px 0 10px', height: 32 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: t.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    Delete permanently?
                </span>
                <button
                    type="button" onClick={() => onRemove(chat.id)}
                    aria-label={`Confirm deleting ${chat.title}`}
                    style={{
                        border: 'none', borderRadius: 6, padding: '4px 7px', cursor: 'pointer',
                        background: t.raised, color: t.danger || '#e5484d', fontFamily: MONO, fontSize: 10.5,
                    }}
                >Delete</button>
                <button
                    type="button" onClick={onCancel} aria-label="Keep this chat"
                    style={{
                        border: 'none', borderRadius: 6, padding: '4px 7px', cursor: 'pointer',
                        background: 'transparent', color: t.dim, fontFamily: MONO, fontSize: 10.5,
                    }}
                >Cancel</button>
            </div>
        );
    }

    // Hover cannot be the only way to reach an action on a touch screen, so on
    // a phone the button is simply always there — as it is while its own menu
    // is open, which would otherwise leave the menu anchored to nothing.
    const showAct = phone || menuOpen;

    return (
        <div className="ai-row" style={rowStyle}>
            <button
                type="button" onClick={() => onPick(chat.id)} aria-current={active}
                onDoubleClick={() => onStartRename(chat.id)}
                title={chat.title}
                style={{
                    flex: 1, minWidth: 0, textAlign: 'left', height: 32, padding: '0 4px 0 10px',
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    fontFamily: MONO, fontSize: 11.5, color: active ? t.text : t.dim,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
            >{chat.title}</button>
            {chat.pinned && (
                // Always visible, unlike the ⋯: it is not a control here, it is
                // the reason this row is sitting up in the pinned group.
                <Pin aria-hidden="true" size={11} strokeWidth={1.8} style={{ color: t.faint, flexShrink: 0 }} />
            )}
            <button
                type="button"
                onClick={(e) => onMenu(chat.id, e.currentTarget.getBoundingClientRect())}
                aria-label={`Actions for ${chat.title}`}
                aria-haspopup="menu" aria-expanded={menuOpen}
                className={`ai-row-act${showAct ? ' is-shown' : ''}`}
                style={{
                    width: 26, height: 26, marginRight: 4, display: 'grid', placeItems: 'center',
                    flexShrink: 0, border: 'none', borderRadius: 6, background: 'transparent',
                    color: t.faint, cursor: 'pointer',
                }}
            ><MoreHorizontal size={14} /></button>
        </div>
    );
}

function Rail({ t, phone, open, chats, activeId, onPick, onNew, onRemove, onRename, onPin, onShare, onClose }) {
    // Every transient row state lives here, so opening one menu closes another
    // and a row cannot be renaming and confirming a delete at the same time.
    const [menu, setMenu] = useState(null);      // { id, x, y }
    const [renamingId, setRenamingId] = useState(null);
    const [confirmId, setConfirmId] = useState(null);

    const clear = useCallback(() => { setRenamingId(null); setConfirmId(null); }, []);

    const openMenu = useCallback((id, rect) => {
        // To the right of the rail, like the row it belongs to — unless that
        // would run off the viewport, in which case it flips to the other side.
        // Clamped vertically so the last chat in a long list still gets a menu
        // that is fully on screen.
        const x = rect.right + 8 + MENU_W > window.innerWidth
            ? Math.max(8, rect.left - MENU_W - 8)
            : rect.right + 8;
        const y = Math.max(8, Math.min(rect.top, window.innerHeight - MENU_H - 8));
        clear();
        setMenu({ id, x, y });
    }, [clear]);

    // Pinned first, and within each group the most recently used first. The
    // rail is a list of things to come back to; a pin says "this one, always".
    const pinned = chats.filter((c) => c.pinned);
    const recents = chats.filter((c) => !c.pinned);
    const menuChat = menu ? chats.find((c) => c.id === menu.id) : null;

    if (!open) return null;

    const rowsFor = (list) => list.map((c) => (
        <ChatRow
            key={c.id} t={t} chat={c} phone={phone} active={c.id === activeId}
            renaming={renamingId === c.id} confirming={confirmId === c.id}
            menuOpen={menu?.id === c.id}
            onPick={(id) => { clear(); onPick(id); }}
            onRename={(id, title) => { onRename(id, title); setRenamingId(null); }}
            onRemove={(id) => { setConfirmId(null); onRemove(id); }}
            onStartRename={(id) => { setConfirmId(null); setRenamingId(id); }}
            onCancel={clear}
            onMenu={openMenu}
        />
    ));

    const groupLabel = (text) => (
        <div style={{ fontSize: 9.5, color: t.faint, padding: '4px 16px 6px', letterSpacing: '0.04em' }}>{text}</div>
    );

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

            <div className="ai-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 12px' }}>
                {/* The headings sit inside the scroller so a long pinned list
                    does not push the recents out of reach. */}
                {pinned.length > 0 && groupLabel('PINNED')}
                {rowsFor(pinned)}
                {recents.length > 0 && groupLabel('RECENTS')}
                {rowsFor(recents)}
            </div>
        </aside>
    );

    // Rendered as a sibling of the rail, not inside the scrolling list, so it is
    // never clipped by it.
    const popup = menuChat && (
        <ChatMenu
            t={t} chat={menuChat} at={menu}
            onClose={() => setMenu(null)}
            onShare={onShare}
            onRename={(id) => setRenamingId(id)}
            onPin={onPin}
            onDelete={(id) => setConfirmId(id)}
        />
    );

    if (!phone) return <>{panel}{popup}</>;
    return (
        <>
            <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(0,0,0,0.45)' }} />
            {panel}
            {popup}
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
