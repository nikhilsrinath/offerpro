import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AssistantCtx } from './assistantStore';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { callCofounderAI } from '../../services/cofounderAI';
import { VOICE_INSTRUCTION } from '../../services/voice';
import { getContext as getBrainContext } from '../../services/brainService';
import { orgStore } from '../../services/orgStore';
import {
    detectCashIntent, startDraft, nextQuestion, applyAnswer, validateDraft, toEntry,
    baseAmount, isCancel, amountHints,
} from '../../services/cashIntent';
import { allocate, canAllocate } from '../../services/projectService';
import { isOpen } from '../../services/projectAnalytics';

// Open projects in the shape cashIntent.parseProject reads. Only offered to
// someone who could link money to them.
const cashProjects = () => {
    if (!canAllocate()) return [];
    const clients = Object.fromEntries(orgStore.getSectionAsList('customers').map((c) => [c.id, c.name]));
    return orgStore.getSectionAsList('projects').filter(isOpen)
        .map((p) => ({ id: p.id, code: p.code, name: p.name, client: clients[p.client_id] || '' }));
};
import { categoryLabel } from '../../services/financeCategories';

/* ══════════════════════════════════════════════════════════════════════════
   The assistant's state, held once for the whole app.

   Two surfaces show the same conversations: the panel docked into the hub,
   and the full-screen workspace every other page opens from the launcher.
   Keeping the chats here rather than in either surface is what lets a reply
   keep streaming while you move from one to the other, and what makes a chat
   started in the hub the same chat when you expand it.

   Conversations live in localStorage, so the history survives a reload and
   not just a navigation.
   ══════════════════════════════════════════════════════════════════════════ */

const STORE_KEY = 'edgeos.ai.chats';
const MAX_CHATS = 60;

const RUPEES = (v) => (Number(v) || 0).toLocaleString('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 2,
});

/** What the thread shows in place of a card that is no longer live. */
const recordedLine = (entry, direction) => `Recorded ${direction === 'in' ? 'money in' : 'money out'} · `
    + `${RUPEES(baseAmount(entry))} — ${entry.description} `
    + `(${categoryLabel(entry.category)}) on ${entry.date}.`;

let seq = 0;
const uid = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

const newChat = () => ({ id: uid('c'), title: 'New chat', messages: [], at: Date.now() });

/** First user line, trimmed to something that fits a history row. */
const titleFor = (text) => {
    const one = String(text || '').replace(/\s+/g, ' ').trim();
    return one.length > 44 ? one.slice(0, 44).trimEnd() + '…' : one || 'New chat';
};

function loadChats() {
    try {
        const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
        if (Array.isArray(raw) && raw.length) {
            // A reply that was mid-stream when the tab closed will never finish.
            // Left empty it would render as a typing indicator forever.
            return raw.map((c) => ({
                ...c,
                messages: (c.messages || []).map((m) => (
                    m.role === 'assistant' && !m.content && !m.kind
                        ? { ...m, content: 'This reply was interrupted.', error: true }
                        : m
                )),
            }));
        }
    } catch {
        // A corrupt or unreadable store is not worth a broken assistant.
    }
    return [newChat()];
}

export function AssistantProvider({ edgeContext, children }) {
    const [chats, setChats] = useState(loadChats);
    const [activeId, setActiveId] = useState(() => chats[0].id);
    const [draft, setDraft] = useState('');
    const [streaming, setStreaming] = useState(false);
    // The full-screen workspace. The hub's dock is always "open" while mounted.
    const [open, setOpen] = useState(false);
    // Which view a surface should show — asking from a hub widget flips an
    // open History list back to the conversation it just started.
    const [view, setView] = useState('chat');
    // How many docked panels are on screen. The launcher hides while one is,
    // since the assistant is already right there.
    const [docks, setDocks] = useState(0);
    // A one-line, self-clearing status for actions with no visible result of
    // their own — copying a transcript being the one that needs it.
    const [note, setNote] = useState('');

    /* Recording a cash entry, in two parts.
       `ask` is the question being answered right now — which slot, and which
       message asked it, so the chips render under that message and nowhere
       else. `card` is a filled draft waiting to be confirmed; it outlives the
       questioning, because the card stays usable while the conversation moves
       on around it. Neither is stored with the chat: a half-finished entry has
       no business surviving a reload where nothing can act on it. */
    const [ask, setAsk] = useState(null);
    const [card, setCard] = useState(null);

    const speech = useSpeechRecognition();

    // Read by callbacks that must see the latest chats without being rebuilt
    // on every keystroke of a streaming reply.
    const chatsRef = useRef(chats);
    useEffect(() => { chatsRef.current = chats; }, [chats]);

    const active = useMemo(() => chats.find((c) => c.id === activeId) || chats[0], [chats, activeId]);

    useEffect(() => {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(chats.slice(0, MAX_CHATS))); } catch { /* quota */ }
    }, [chats]);

    // Another tab wrote the history. Adopt it unless this tab is mid-reply,
    // where replacing the list would orphan the message being streamed into.
    useEffect(() => {
        const onStorage = (e) => {
            if (e.key !== STORE_KEY || streaming) return;
            try {
                const next = JSON.parse(e.newValue || '[]');
                if (Array.isArray(next) && next.length) setChats(next);
            } catch { /* ignore */ }
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [streaming]);

    useEffect(() => {
        if (!note) return undefined;
        const id = setTimeout(() => setNote(''), 2600);
        return () => clearTimeout(id);
    }, [note]);

    const patchChat = useCallback((id, fn) => {
        setChats((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
    }, []);

    /** Messages onto the end of a chat, naming the chat if this is its first. */
    const appendTo = useCallback((chatId, msgs, firstText) => {
        patchChat(chatId, (c) => ({
            ...c,
            at: Date.now(),
            // A name the person typed is never replaced by one derived here.
            title: (c.titled || c.messages.length) ? c.title : titleFor(firstText || msgs[0]?.content || ''),
            messages: [...c.messages, ...msgs],
        }));
    }, [patchChat]);

    /** Rewrites one message in place — a card turning into the line it leaves behind. */
    const patchMessage = useCallback((chatId, messageId, fields) => {
        patchChat(chatId, (c) => ({
            ...c,
            messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...fields } : m)),
        }));
    }, [patchChat]);

    /* ── recording a cash entry ───────────────────────────────────────────
       Deliberately never reaches the model. The questions come from
       cashIntent's slot machine and the write happens only on the card's own
       button, so what lands in the ledger is exactly what was on screen when
       it was pressed — and the whole exchange costs no AI quota. */

    const presentCash = useCallback((chatId, entry, leading, firstText) => {
        const q = nextQuestion(entry);
        const id = uid('m');

        if (q) {
            // The amount is usually already in the conversation — the figure
            // named a few lines up. Offering it back keeps this one
            // conversation rather than a wizard opened on top of one.
            const msgs = chatsRef.current.find((c) => c.id === chatId)?.messages || [];
            const fromThread = q.slot === 'amount'
                ? amountHints(msgs.filter((m) => !m.error).slice(-6).map((m) => m.content))
                : [];

            appendTo(chatId, [...leading, {
                id, role: 'assistant', kind: 'ask',
                content: q.text, hint: q.hint || null,
                choices: [...fromThread, ...(q.options || [])].slice(0, 8),
            }], firstText);
            setAsk({ chatId, draft: entry, slot: q.slot, messageId: id });
            return;
        }

        appendTo(chatId, [...leading, {
            id, role: 'assistant', kind: 'card',
            // Read when the card is no longer live — after a reload, or in a
            // shared transcript. A card nobody can act on must still say what
            // it was and that nothing was written.
            content: 'I put this entry together from what you said. It was not recorded.',
        }], firstText);
        setAsk(null);
        setCard({ chatId, messageId: id, draft: entry, saving: false, error: '', saved: null });
    }, [appendTo]);

    /** A tapped chip. `shown` goes into the thread, `value` gets parsed. */
    const answerCash = useCallback((value, shown) => {
        if (!ask) return;
        const res = applyAnswer(ask.draft, ask.slot, value);
        if (!res.draft) return;
        presentCash(ask.chatId, res.draft, [{ id: uid('m'), role: 'user', content: shown }]);
    }, [ask, presentCash]);

    /** Backing out of a half-finished entry, from the pill or from the sentence. */
    const dropAsk = useCallback((chatId, leading = []) => {
        appendTo(chatId, [...leading, {
            id: uid('m'), role: 'assistant',
            content: 'Left it there — nothing was recorded.',
        }]);
        setAsk(null);
    }, [appendTo]);

    /** The card's own button. Nothing else in the assistant writes to the ledger. */
    const saveCard = useCallback(async () => {
        if (!card || card.saving) return;
        const problems = validateDraft(card.draft);
        if (problems.length) { setCard((c) => ({ ...c, error: problems[0] })); return; }

        setCard((c) => ({ ...c, saving: true, error: '' }));
        try {
            const { section, data, allocation } = toEntry(card.draft);
            const saved = await orgStore.addItem(section, data);
            // The project link follows the entry. If it fails the entry stands,
            // and the card says so rather than pretending either way.
            if (allocation && saved?.id && canAllocate()) {
                try {
                    await allocate(allocation.source_type, saved.id, [{ project_id: allocation.project_id, amount: null }]);
                } catch (allocErr) {
                    setCard((c) => ({ ...c, saving: false, saved: c.draft, error: `Recorded, but not linked to the project: ${allocErr.message}` }));
                    return;
                }
            }
            setCard((c) => ({ ...c, saving: false, saved: c.draft }));
            patchMessage(card.chatId, card.messageId, {
                content: recordedLine(card.draft, card.draft.direction),
            });
        } catch (err) {
            // Reporting a save that did not happen is the one failure a ledger
            // cannot absorb, so the card stays as it was and says why.
            setCard((c) => ({ ...c, saving: false, error: err?.message || 'Could not record this entry.' }));
        }
    }, [card, patchMessage]);

    const cancelCard = useCallback(() => {
        if (!card) return;
        patchMessage(card.chatId, card.messageId, {
            content: 'Entry discarded — nothing was recorded.',
        });
        setCard(null);
    }, [card, patchMessage]);

    const editCard = useCallback((patch) => {
        setCard((c) => (c ? { ...c, draft: { ...c.draft, ...patch }, error: '' } : c));
    }, []);

    /** Streams the model's answer to `content` into message `replyId`. */
    const streamReply = useCallback((chatId, replyId, content, history, { voice = false } = {}) => {
        setStreaming(true);
        const patch = (fields) => patchChat(chatId, (c) => ({
            ...c,
            messages: c.messages.map((m) => (m.id === replyId ? { ...m, ...fields } : m)),
        }));

        // The company's facts come from EdgeBrain; getContext never throws, and
        // without a brain the assistant answers from the summary figures alone.
        (async () => {
            const brain = await getBrainContext(edgeContext?.orgId, content);
            // On a call the answer is heard, not read: asked for short and plain,
            // and capped so it starts speaking sooner. The chat keeps the question
            // as it was asked.
            return callCofounderAI(voice ? `${content}\n\n${VOICE_INSTRUCTION}` : content, history, edgeContext || {}, {
                onToken: (_tok, full) => patch({ content: full }),
                onComplete: (full) => { patch({ content: full }); setStreaming(false); },
                onError: (err) => { patch({ content: err || 'Something went wrong.', error: true }); setStreaming(false); },
            }, null, brain.context || undefined,
            undefined, undefined, undefined, undefined, voice ? 160 : undefined);
        })().catch((err) => {
            patch({ content: err?.message || 'Something went wrong.', error: true });
            setStreaming(false);
        });
    }, [edgeContext, patchChat]);

    /**
     * Send a message. `opts.chatId` targets a chat other than the active one —
     * used when a new chat has just been created in the same tick and is not
     * yet what `active` resolves to.
     */
    const send = useCallback((text, opts = {}) => {
        const content = String(text ?? draft).trim();
        if (!content || streaming) return;

        const chatId = opts.chatId || active.id;
        const chatNow = chatsRef.current.find((c) => c.id === chatId);
        const history = (chatNow?.messages || [])
            .filter((m) => !m.error && m.content)
            .map((m) => ({ role: m.role, content: m.content }));

        /* A pending question gets first refusal on the message — otherwise
           "4500", a perfectly good answer to "how much?", would reach the
           model as though it were a new topic. Only first refusal: a sentence
           that says to leave it, leaves it; one that answers, answers; and
           anything else goes to the model with the entry left parked. */
        if (ask && ask.chatId === chatId) {
            if (isCancel(content)) {
                setDraft('');
                dropAsk(chatId, [{ id: uid('m'), role: 'user', content }]);
                return;
            }
            const res = applyAnswer(ask.draft, ask.slot, content);
            if (res.draft) {
                setDraft('');
                presentCash(chatId, res.draft, [{ id: uid('m'), role: 'user', content }]);
                return;
            }
        }

        // "We spent 4,500 on office chairs yesterday" is an instruction, not a
        // question. detectCashIntent refuses anything phrased as a question.
        const intent = detectCashIntent(content);
        if (intent) {
            setDraft('');
            presentCash(chatId, startDraft(content, intent.direction, undefined, cashProjects()), [
                { id: uid('m'), role: 'user', content },
            ], content);
            return;
        }

        const replyId = uid('m');
        patchChat(chatId, (c) => ({
            ...c,
            at: Date.now(),
            title: (c.titled || c.messages.length) ? c.title : titleFor(content),
            messages: [...c.messages, { id: uid('m'), role: 'user', content }, { id: replyId, role: 'assistant', content: '' }],
        }));
        setDraft('');
        streamReply(chatId, replyId, content, history, { voice: !!opts.voice });
    }, [draft, streaming, active, patchChat, ask, dropAsk, presentCash, streamReply]);

    /**
     * Ask again. The answer is replaced and the conversation resumes from the
     * question that produced it: anything said after it is dropped, since it
     * answered an answer that no longer exists. The caller confirms that first.
     */
    const regenerate = useCallback((messageId) => {
        if (streaming) return;
        const chatId = activeId;
        const msgs = chatsRef.current.find((c) => c.id === chatId)?.messages || [];
        const at = msgs.findIndex((m) => m.id === messageId);
        const qAt = at - 1;
        if (at < 0 || msgs[qAt]?.role !== 'user') return;
        const question = msgs[qAt].content;

        // Cash entries never reached the model; asking again would give the
        // same scripted question, so only model answers are regenerated.
        if (msgs[at].kind) return;

        const history = msgs.slice(0, qAt)
            .filter((m) => !m.error && m.content)
            .map((m) => ({ role: m.role, content: m.content }));
        const replyId = uid('m');
        patchChat(chatId, (c) => ({
            ...c,
            at: Date.now(),
            messages: [...c.messages.slice(0, at), { id: replyId, role: 'assistant', content: '' }],
        }));
        if (card?.chatId === chatId && !msgs.slice(0, at).some((m) => m.id === card.messageId)) setCard(null);
        if (ask?.chatId === chatId && !msgs.slice(0, at).some((m) => m.id === ask.messageId)) setAsk(null);
        streamReply(chatId, replyId, question, history);
    }, [streaming, activeId, patchChat, card, ask, streamReply]);

    /** Opens a blank chat, reusing an untouched one rather than stacking empties. */
    const startChat = useCallback(() => {
        const blank = chatsRef.current.find((c) => !c.messages.length);
        if (blank) {
            setActiveId(blank.id);
        } else {
            const c = newChat();
            setChats((cs) => [c, ...cs]);
            setActiveId(c.id);
        }
        setDraft('');
        setView('chat');
    }, []);

    /** A question from elsewhere on the page, asked in a fresh chat. */
    const askNew = useCallback((text) => {
        const content = String(text || '').trim();
        if (!content || streaming) return false;
        const current = chatsRef.current.find((c) => c.id === activeId);
        let chatId = current?.id;
        // Continue in the open chat only if it is still empty.
        if (!current || current.messages.length) {
            const blank = chatsRef.current.find((c) => !c.messages.length);
            if (blank) chatId = blank.id;
            else {
                const c = newChat();
                setChats((cs) => [c, ...cs]);
                chatId = c.id;
            }
        }
        setActiveId(chatId);
        setView('chat');
        send(content, { chatId });
        return true;
    }, [streaming, activeId, send]);

    const pickChat = useCallback((id) => {
        setActiveId(id);
        setDraft('');
        setView('chat');
    }, []);

    const removeChat = useCallback((id) => {
        setChats((cs) => {
            const rest = cs.filter((c) => c.id !== id);
            const next = rest.length ? rest : [newChat()];
            if (id === activeId) setActiveId(next[0].id);
            return next;
        });
        if (card?.chatId === id) setCard(null);
        if (ask?.chatId === id) setAsk(null);
    }, [activeId, card, ask]);

    /** Deletes every chat except those pinned. */
    const clearHistory = useCallback(() => {
        setChats((cs) => {
            const kept = cs.filter((c) => c.pinned);
            const next = kept.length ? kept : [newChat()];
            if (!next.some((c) => c.id === activeId)) setActiveId(next[0].id);
            return next;
        });
        setCard(null);
        setAsk(null);
    }, [activeId]);

    /**
     * A name the person chose outranks one derived from their first message.
     * `titled` is what send() checks, so naming an empty chat sticks.
     */
    const renameChat = useCallback((id, title) => {
        const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        if (!clean) return;
        patchChat(id, (c) => ({ ...c, title: clean, titled: true }));
    }, [patchChat]);

    const togglePin = useCallback((id) => patchChat(id, (c) => ({ ...c, pinned: !c.pinned })), [patchChat]);

    /**
     * Share: the system share sheet where there is one, the clipboard where
     * there is not. Not a link — these chats live in this browser only, so a
     * URL would be a promise the product cannot keep.
     */
    const shareChat = useCallback(async (chat) => {
        const text = (chat.messages || [])
            .filter((m) => !m.error && m.content)
            .map((m) => `${m.role === 'user' ? 'You' : 'EdgeAI'}: ${m.content}`)
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
            // AbortError is the share sheet being dismissed, which is not a failure.
            if (!navigator.share) setNote('Could not copy this conversation.');
        }
    }, []);

    const registerDock = useCallback(() => {
        setDocks((n) => n + 1);
        return () => setDocks((n) => Math.max(0, n - 1));
    }, []);

    const value = useMemo(() => ({
        chats, active, activeId: active.id, messages: active.messages,
        draft, setDraft, streaming, send, askNew, regenerate,
        startChat, pickChat, removeChat, clearHistory, renameChat, togglePin, shareChat,
        ask, card, answerCash, dropAsk, saveCard, cancelCard, editCard,
        open, setOpen, view, setView, docked: docks > 0, registerDock,
        note, setNote, speech,
    }), [
        chats, active, draft, streaming, send, askNew, regenerate,
        startChat, pickChat, removeChat, clearHistory, renameChat, togglePin, shareChat,
        ask, card, answerCash, dropAsk, saveCard, cancelCard, editCard,
        open, view, docks, registerDock, note, speech,
    ]);

    return <AssistantCtx.Provider value={value}>{children}</AssistantCtx.Provider>;
}
