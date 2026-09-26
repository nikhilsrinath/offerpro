import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, Pause, Play } from 'lucide-react';
import Orb from './Orb';
import {
    speakable, sentencesOf, pickVoice, tidyTranscript, fillerKind, pickFiller, MAX_SPOKEN_SENTENCES,
} from '../../services/voice';
import './voiceCall.css';

/* ══════════════════════════════════════════════════════════════════════════
   A voice call with EdgeAI — a conversation, not dictation.

     listening ─(you pause)→ thinking ─(first sentence)→ speaking ─(done)→ listening

   · Your turn ends ~1s after you stop talking. It does not wait for the
     recogniser's final pass: what it has heard by then is the question.
   · The answer is asked for short and plain (VOICE_INSTRUCTION) and spoken a
     sentence at a time AS IT STREAMS, so the voice starts before the answer
     has finished arriving.
   · The microphone is off while EdgeAI speaks, so it never transcribes its own
     voice. Tap the orb to cut in.
   · The wait is never dead air: if the answer has not started within half a
     second, EdgeAI says a short filler that suits the question ("Let me pull
     up the numbers."), and another if it runs long. Fillers are heard only.
   · At most MAX_SPOKEN_SENTENCES are read out; anything longer is in the chat.
   · Every exchange lands in the chat, so the call is also a transcript.
   ══════════════════════════════════════════════════════════════════════════ */

// Silence that ends your turn. Shorter once the recogniser has committed
// everything (no interim words pending), since then nothing more is coming.
const END_AFTER_FINAL_MS = 750;
const END_AFTER_INTERIM_MS = 1200;
// Characters per second a voice says at rate 1.05, for voices that report no
// word boundaries (Chrome's Google voices), so the words still light in time.
const CHARS_PER_SEC = 15.5;
const BARS = 29;
// When a filler is said if the answer has not begun: soon, then once more.
const FILLER_AFTER_MS = 450;
const STILL_AFTER_MS = 4500;

const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

export default function VoiceCall({ a, onClose }) {
    const { speech } = a;
    const { supported, finalText, interim, error, levelRef: micLevelRef, heardAtRef, start, stop, reset } = speech;

    const [phase, setPhaseState] = useState(supported ? 'listening' : 'unsupported');
    const phaseRef = useRef(phase);
    const setPhase = useCallback((p) => { phaseRef.current = p; setPhaseState(p); }, []);

    const [question, setQuestion] = useState('');          // what you asked this turn
    const [answer, setAnswer] = useState('');              // what EdgeAI is saying
    const [spokenTo, setSpokenTo] = useState(0);           // chars of `answer` already said
    const [trimmed, setTrimmed] = useState(false);         // more was answered than is read out
    const [elapsed, setElapsed] = useState(0);
    const [orbSize, setOrbSize] = useState(220);

    const rootRef = useRef(null);
    const textRef = useRef(null);
    const markRef = useRef(null);
    const barsRef = useRef([]);
    const levelRef = useRef(0);        // what the orb and the waveform show
    const pulseRef = useRef(0);        // a kick on each spoken word
    const fillingRef = useRef(false);  // a filler is being said
    const voiceRef = useRef(null);

    // The turn in flight: which messages existed before it, how far its answer
    // has been queued, and whether the answer is complete.
    const turnRef = useRef(null);
    const queueRef = useRef([]);
    const speakingRef = useRef(false);
    const genRef = useRef(0);          // bumped to orphan callbacks of a cancelled voice
    const pendingRef = useRef(null);   // a question waiting for the previous answer to finish streaming
    const messagesRef = useRef(a.messages);
    messagesRef.current = a.messages;

    const heard = tidyTranscript(`${finalText} ${interim}`);
    const heardRef = useRef('');
    heardRef.current = heard;
    const interimRef = useRef('');
    interimRef.current = interim;

    /* ── size the orb to the frame ── */
    useLayoutEffect(() => {
        const el = rootRef.current;
        if (!el) return undefined;
        const fit = () => {
            const w = el.clientWidth;
            const h = el.clientHeight;
            // Leaves room for a question and a three-sentence answer below it.
            setOrbSize(Math.round(Math.max(130, Math.min(260, w * 0.56, h * 0.27))));
        };
        fit();
        const ro = new ResizeObserver(fit);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    /* ── the voice ── */
    useEffect(() => {
        if (!canSpeak) return undefined;
        const load = () => { voiceRef.current = pickVoice(window.speechSynthesis.getVoices()); };
        load();
        window.speechSynthesis.addEventListener?.('voiceschanged', load);
        return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load);
    }, []);

    /* ── listening ── */
    const listen = useCallback(() => {
        if (!supported) return;
        reset();
        heardAtRef.current = Date.now();
        setQuestion('');
        setPhase('listening');
        start();
    }, [supported, reset, start, heardAtRef, setPhase]);

    const clearFillers = useCallback(() => {
        (turnRef.current?.timers || []).forEach(clearTimeout);
    }, []);

    const silenceVoice = useCallback(() => {
        clearFillers();
        genRef.current += 1;
        queueRef.current = [];
        speakingRef.current = false;
        fillingRef.current = false;
        if (canSpeak) window.speechSynthesis.cancel();
    }, [clearFillers]);

    // Start with the call; everything is torn down with it.
    useEffect(() => {
        if (supported) listen();
        const t0 = Date.now();
        const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
        return () => {
            clearInterval(id);
            silenceVoice();
            stop();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ── asking ── */
    const ask = useCallback((text) => {
        const turn = { known: new Set(messagesRef.current.map((m) => m.id)), queued: 0, done: false, timers: [] };
        turnRef.current = turn;
        setAnswer('');
        setSpokenTo(0);
        setTrimmed(false);
        // Fillers, only while nothing of the answer has been queued yet.
        const kind = fillerKind(text);
        const fill = (line) => () => {
            if (turnRef.current !== turn || turn.queued > 0 || speakingRef.current) return;
            sayFiller(line);
        };
        turn.timers.push(setTimeout(fill(pickFiller(kind)), FILLER_AFTER_MS));
        turn.timers.push(setTimeout(fill(pickFiller('still')), STILL_AFTER_MS));
        a.send(text, { voice: true });
    }, [a]); // eslint-disable-line react-hooks/exhaustive-deps -- sayFiller is defined below and stable

    const endTurn = useCallback((text) => {
        stop();
        setQuestion(text);
        setPhase('thinking');
        // The last answer may still be streaming after you cut in; the chat
        // takes one message at a time, so this one waits for it.
        if (a.streaming) pendingRef.current = text;
        else ask(text);
    }, [a.streaming, ask, stop, setPhase]);

    useEffect(() => {
        if (!a.streaming && pendingRef.current) {
            const text = pendingRef.current;
            pendingRef.current = null;
            ask(text);
        }
    }, [a.streaming, ask]);

    // Your turn ends when you stop talking.
    useEffect(() => {
        if (phase !== 'listening') return undefined;
        const id = setInterval(() => {
            const text = heardRef.current;
            if (!text) return;
            const wait = interimRef.current ? END_AFTER_INTERIM_MS : END_AFTER_FINAL_MS;
            if (Date.now() - heardAtRef.current > wait) endTurn(text);
        }, 120);
        return () => clearInterval(id);
    }, [phase, endTurn, heardAtRef]);

    /* ── speaking ── */
    const finishTurn = useCallback(() => {
        clearFillers();
        turnRef.current = null;
        if (phaseRef.current !== 'paused') listen();
    }, [listen, clearFillers]);

    const pump = useCallback(() => {
        if (speakingRef.current || phaseRef.current === 'paused') return;
        const next = queueRef.current.shift();
        if (!next) {
            if (turnRef.current?.done) finishTurn();
            return;
        }
        setPhase('speaking');
        if (!canSpeak) {
            // No voice in this browser: show the answer and move on.
            setSpokenTo((n) => Math.max(n, next.end));
            pump();
            return;
        }
        const gen = genRef.current;
        const u = new SpeechSynthesisUtterance(next.text);
        u.voice = voiceRef.current;
        u.lang = voiceRef.current?.lang || 'en-IN';
        u.rate = 1.05;
        speakingRef.current = true;

        let boundaries = false;
        const t0 = performance.now();
        const est = setInterval(() => {
            if (gen !== genRef.current) { clearInterval(est); return; }
            if (boundaries) return;
            const said = Math.min(next.text.length, ((performance.now() - t0) / 1000) * CHARS_PER_SEC);
            setSpokenTo((n) => Math.max(n, next.start + Math.round(said)));
        }, 90);

        u.onboundary = (e) => {
            if (gen !== genRef.current) return;
            boundaries = true;
            pulseRef.current = 1;
            const to = next.start + e.charIndex + (e.charLength || 0);
            setSpokenTo((n) => Math.max(n, Math.min(next.end, to)));
        };
        const done = () => {
            clearInterval(est);
            if (gen !== genRef.current) return;
            speakingRef.current = false;
            setSpokenTo((n) => Math.max(n, next.end));
            pump();
        };
        u.onend = done;
        u.onerror = done;
        window.speechSynthesis.speak(u);
    }, [finishTurn, setPhase]);

    // A filler holds the voice like a sentence does, so the answer waits for it
    // to finish rather than talking over it — they are short.
    function sayFiller(line) {
        if (!canSpeak || phaseRef.current !== 'thinking') return;
        const gen = genRef.current;
        const u = new SpeechSynthesisUtterance(line);
        u.voice = voiceRef.current;
        u.lang = voiceRef.current?.lang || 'en-IN';
        u.rate = 1.0;
        u.pitch = 0.98;
        speakingRef.current = true;
        fillingRef.current = true;
        const done = () => {
            if (gen !== genRef.current) return;
            speakingRef.current = false;
            fillingRef.current = false;
            pump();
        };
        u.onend = done;
        u.onerror = done;
        window.speechSynthesis.speak(u);
    }

    // The answer arrives in the chat; queue each sentence as it completes.
    useEffect(() => {
        const turn = turnRef.current;
        if (!turn) return;
        const reply = [...a.messages].reverse().find((m) => m.role === 'assistant' && !turn.known.has(m.id));
        if (!reply) return;
        // A cash question or card is complete the moment it appears.
        // A real boolean: sentencesOf() treats a missing `final` as true, and
        // `reply.error` is undefined on a normal reply — that read every partial
        // chunk aloud as though the answer were finished.
        const complete = Boolean(reply.kind || !a.streaming || reply.error);
        const text = speakable(reply.content || '');
        if (!text && complete) { finishTurn(); return; }
        // A call answer is a few sentences. Past that it is read in the chat.
        const all = sentencesOf(text, complete);
        const capped = all.length > MAX_SPOKEN_SENTENCES;
        const parts = all.slice(0, MAX_SPOKEN_SENTENCES);
        setAnswer(capped ? text.slice(0, parts[parts.length - 1].end) : text);
        setTrimmed(capped);
        if (parts.length > turn.queued) {
            clearFillers();
            queueRef.current.push(...parts.slice(turn.queued));
            turn.queued = parts.length;
        }
        if (complete || capped) turn.done = true;
        pump();
    }, [a.messages, a.streaming, pump, finishTurn, clearFillers]);

    /* ── controls ── */
    const cutIn = () => {
        if (phase !== 'speaking' && phase !== 'thinking') return;
        silenceVoice();
        turnRef.current = null;
        listen();
    };

    const togglePause = () => {
        if (phase === 'paused') { listen(); return; }
        silenceVoice();
        turnRef.current = null;
        pendingRef.current = null;
        stop();
        setPhase('paused');
    };

    // Focus moves into the call (not onto a button, which would wear a ring
    // nobody asked for); Tab reaches the controls from there.
    useEffect(() => { rootRef.current?.focus(); }, []);
    useEffect(() => {
        // Captured first and marked handled: Escape ends the call, not the
        // whole workspace behind it (AIAssistant closes on an unhandled one).
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    /* ── the level: your voice while listening, EdgeAI's while it speaks ── */
    useEffect(() => {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const history = new Array(BARS).fill(0);
        let raf = 0;
        let lastShift = 0;
        const frame = (now) => {
            const p = phaseRef.current;
            const tt = now / 1000;
            let lvl = 0;
            if (p === 'listening') lvl = micLevelRef.current || 0;
            else if (p === 'speaking') {
                pulseRef.current *= 0.9;
                lvl = 0.28 + 0.22 * Math.abs(Math.sin(tt * 7.3)) * Math.abs(Math.sin(tt * 3.1 + 1)) + 0.3 * pulseRef.current;
            } else if (p === 'thinking') {
                lvl = fillingRef.current
                    ? 0.22 + 0.16 * Math.abs(Math.sin(tt * 6.1)) * Math.abs(Math.sin(tt * 2.3 + 1))
                    : 0.1 + 0.06 * Math.sin(tt * 3);
            }
            levelRef.current = lvl;

            // The newest level enters at the centre and ripples outwards.
            if (now - lastShift > (reduced ? 160 : 55)) {
                lastShift = now;
                history.pop();
                history.unshift(lvl);
            }
            const mid = (BARS - 1) / 2;
            barsRef.current.forEach((el, i) => {
                if (!el) return;
                const d = Math.abs(i - mid);
                const v = history[Math.min(history.length - 1, Math.round(d))] || 0;
                const shape = 1 - (d / (mid + 1)) * 0.55;
                const h = 0.14 + Math.min(1, v * 1.6) * 0.86 * shape;
                el.style.transform = `scaleY(${h.toFixed(3)})`;
            });
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(raf);
    }, [micLevelRef]);

    // Keep the word being said in view.
    useEffect(() => {
        const box = textRef.current;
        const mark = markRef.current;
        if (!box || !mark) return;
        // Only once the word nears the bottom, so the question above it stays
        // in view for as long as the answer fits.
        if (mark.offsetTop < box.scrollTop + box.clientHeight * 0.72) return;
        box.scrollTo({ top: Math.max(0, mark.offsetTop - box.clientHeight * 0.45), behavior: 'smooth' });
    }, [spokenTo]);

    /* ── what is on screen ── */
    const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
    const status = error ? 'Microphone unavailable'
        : phase === 'unsupported' ? 'Voice needs Chrome or Edge'
            : { listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', paused: 'Paused' }[phase];

    let body;
    if (error || phase === 'unsupported') {
        body = <p className="vc-line is-hint">{error || 'This browser has no speech recognition. Open EdgeOS in Chrome or Edge to talk to EdgeAI.'}</p>;
    } else if (phase === 'listening') {
        body = heard
            ? (
                <p className="vc-line">
                    <span>{tidyTranscript(finalText)}</span>
                    {interim && <span className="is-pending">{finalText ? ' ' : ''}{interim}</span>}
                </p>
            )
            : <p className="vc-line is-hint">Go ahead — I’m listening.</p>;
    } else if (question || answer) {
        // You, then EdgeAI — two turns, never one run of text.
        body = (
            <div className="vc-qa">
                {question && (
                    <p className="vc-q"><span className="vc-who">You</span>{question}</p>
                )}
                {answer ? (
                    <p className="vc-line vc-a">
                        <span className="is-said">{answer.slice(0, spokenTo)}</span>
                        <span ref={markRef} />
                        <span>{answer.slice(spokenTo)}</span>
                    </p>
                ) : (
                    <p className="vc-a vc-wait" aria-label="EdgeAI is thinking"><span /><span /><span /></p>
                )}
                {trimmed && <p className="vc-more">The full answer is in the chat.</p>}
            </div>
        );
    } else {
        body = <p className="vc-line is-hint">Paused. Press play when you are ready.</p>;
    }

    const orbLive = phase === 'speaking' || phase === 'thinking';

    return (
        <div ref={rootRef} className="vc" role="dialog" aria-modal="true" aria-label="Voice call with EdgeAI" tabIndex={-1}>
            <div className="vc-top">
                <span className="vc-brand">EdgeAI</span>
                <span className="vc-time" aria-label={`Call time ${mmss}`}>{mmss}</span>
            </div>

            <div className="vc-stage">
                <button
                    type="button" className="vc-orb" onClick={cutIn} disabled={!orbLive}
                    aria-label={orbLive ? 'Interrupt and speak' : 'EdgeAI'}
                    title={orbLive ? 'Tap to interrupt' : undefined}
                    style={{ width: orbSize, height: orbSize }}
                >
                    <Orb size={orbSize} levelRef={levelRef} dark tone="blue" />
                </button>
                <div className={`vc-status is-${phase}`} role="status">
                    <span className="vc-dot" aria-hidden="true" />{status}
                </div>
            </div>

            <div ref={textRef} className="vc-text" aria-live="off">
                {body}
            </div>

            <div className="vc-bar">
                <button type="button" className="vc-btn" onClick={onClose} aria-label="End call" title="End call (Esc)">
                    <X size={16} strokeWidth={2} aria-hidden="true" />
                </button>
                <div className={`vc-wave is-${phase}`} aria-hidden="true">
                    {Array.from({ length: BARS }, (_, i) => (
                        <span key={i} ref={(el) => { barsRef.current[i] = el; }}
                            className={Math.abs(i - (BARS - 1) / 2) <= 3 ? 'is-core' : undefined} />
                    ))}
                </div>
                <button
                    type="button" className="vc-btn" onClick={togglePause}
                    disabled={phase === 'unsupported' || !!error}
                    aria-label={phase === 'paused' ? 'Resume call' : 'Pause call'} aria-pressed={phase === 'paused'}
                    title={phase === 'paused' ? 'Resume' : 'Pause'}
                >
                    {phase === 'paused'
                        ? <Play size={15} strokeWidth={2} fill="currentColor" aria-hidden="true" />
                        : <Pause size={15} strokeWidth={2} fill="currentColor" aria-hidden="true" />}
                </button>
            </div>
        </div>
    );
}
