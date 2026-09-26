import { useCallback, useEffect, useRef, useState } from 'react';

/* Live speech-to-text over the browser's Web Speech API, plus a mic level.
 *
 * Speed: interimResults are on, so words appear while they are still being
 * spoken and are replaced in place when the recogniser commits them.
 * Continuity: Chrome ends a "continuous" session after a pause or ~60s. When
 * that happens while the user still wants to listen, we bank the committed
 * text and start a new session, so the transcript never resets mid-thought.
 *
 * Ending: a voice call listens until it is hung up, but dictation into a text
 * box should end the way a person does — by stopping talking. start({ autoStop })
 * ends the session after a short silence once something was heard, or after a
 * longer wait when nothing was said at all.
 *
 * The level meter is a separate getUserMedia + AnalyserNode. SpeechRecognition
 * exposes no audio, and the orb needs something to breathe with. If the level
 * stream is refused, recognition still works; the orb just idles.
 *
 * Mobile: Android Chrome and iOS Safari hand the microphone to one consumer at
 * a time. A second getUserMedia stream takes it from the recogniser, which then
 * hears silence — the orb moves but no words arrive. There the meter is faked
 * from the recogniser's own events instead. Android also repeats earlier text
 * in every result of a continuous session, so there each session is one
 * utterance and the restart loop in onend provides the continuity.
 */

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

const MOBILE = typeof navigator !== 'undefined' && (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)   // iPadOS reports as a Mac
);

const ERRORS = {
    'not-allowed': 'Microphone access was blocked. Allow it in the browser’s site settings.',
    'service-not-allowed': 'Speech recognition is disabled in this browser.',
    'audio-capture': 'No microphone was found.',
    network: 'Speech recognition needs a network connection.',
    'language-not-supported': 'That language is not supported for recognition.',
};

export function useSpeechRecognition({ lang } = {}) {
    const supported = !!SR;
    const [listening, setListening] = useState(false);
    const [finalText, setFinalText] = useState('');
    const [interim, setInterim] = useState('');
    const [error, setError] = useState(null);
    const levelRef = useRef(0);

    const recRef = useRef(null);
    const wantRef = useRef(false);        // user intent; survives the session restarts
    const bankRef = useRef('');           // text committed by earlier sessions
    const sessionRef = useRef('');        // text committed by the current session
    const audioRef = useRef(null);        // { ctx, stream, raf }
    const heardAtRef = useRef(0);         // last time the recogniser reported anything
    const heardAnyRef = useRef(false);    // whether anything was heard this time
    const watchRef = useRef(null);        // the auto-stop interval, when on

    const join = (a, b) => (a && b ? a.replace(/\s+$/, '') + ' ' + b.replace(/^\s+/, '') : a || b);

    const stopMeter = useCallback(() => {
        const a = audioRef.current;
        audioRef.current = null;
        levelRef.current = 0;
        if (!a) return;
        cancelAnimationFrame(a.raf);
        a.stream?.getTracks().forEach((tr) => tr.stop());
        a.ctx?.close().catch(() => {});
    }, []);

    // Mobile stand-in for the meter: the recogniser bumps levelRef when it
    // hears something, and this lets it fall back so the orb still breathes.
    const startFakeMeter = useCallback(() => {
        if (audioRef.current) return;
        const a = { ctx: null, stream: null, raf: 0 };
        const loop = () => {
            levelRef.current *= 0.9;
            a.raf = requestAnimationFrame(loop);
        };
        loop();
        audioRef.current = a;
    }, []);

    const startMeter = useCallback(async () => {
        if (MOBILE) { startFakeMeter(); return; }
        if (audioRef.current || !navigator.mediaDevices?.getUserMedia) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
            if (!wantRef.current) { stream.getTracks().forEach((tr) => tr.stop()); return; }
            const Ctx = window.AudioContext || window.webkitAudioContext;
            const ctx = new Ctx();
            const an = ctx.createAnalyser();
            an.fftSize = 512;
            ctx.createMediaStreamSource(stream).connect(an);
            const buf = new Uint8Array(an.fftSize);
            const a = { ctx, stream, raf: 0 };
            const loop = () => {
                an.getByteTimeDomainData(buf);
                let sum = 0;
                for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
                // RMS of speech sits around 0.02‥0.2; stretch that onto 0‥1
                levelRef.current = Math.min(1, Math.sqrt(sum / buf.length) * 6);
                a.raf = requestAnimationFrame(loop);
            };
            loop();
            audioRef.current = a;
        } catch { /* recognition can still run without a meter */ }
    }, [startFakeMeter]);

    const startSession = useCallback(() => {
        const rec = new SR();
        rec.continuous = !MOBILE;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        // Indian English unless told otherwise. The browser's own language is
        // usually en-US even here, and the Indian model hears Indian names,
        // "lakh" and "crore" and the accent markedly better.
        rec.lang = lang || 'en-IN';
        sessionRef.current = '';

        rec.onresult = (e) => {
            // A session that has been replaced keeps delivering its last words;
            // they belong to a turn that is over.
            if (recRef.current !== rec) return;
            heardAtRef.current = Date.now();
            heardAnyRef.current = true;
            if (MOBILE) levelRef.current = Math.max(levelRef.current, 0.7);
            let fin = '';
            let tmp = '';
            for (let i = 0; i < e.results.length; i++) {
                const r = e.results[i];
                if (r.isFinal) fin = join(fin, r[0].transcript);
                else tmp = join(tmp, r[0].transcript);
            }
            sessionRef.current = fin;
            setFinalText(join(bankRef.current, fin));
            setInterim(tmp);
        };
        rec.onsoundstart = () => { if (MOBILE) levelRef.current = Math.max(levelRef.current, 0.4); };
        rec.onerror = (e) => {
            if (e.error === 'no-speech' || e.error === 'aborted') return;   // restart handles these
            setError(ERRORS[e.error] || 'Speech recognition stopped: ' + e.error);
            if (ERRORS[e.error]) wantRef.current = false;
        };
        rec.onend = () => {
            // Stopped and already replaced by a new session: restarting this one
            // would leave two recognisers writing into one transcript.
            if (recRef.current !== rec) return;
            bankRef.current = join(bankRef.current, sessionRef.current);
            sessionRef.current = '';
            setInterim('');
            // the same instance can be started again; its handlers stay attached
            if (wantRef.current) {
                try { rec.start(); return; } catch { /* fall through to stop */ }
            }
            recRef.current = null;
            setListening(false);
            stopMeter();
        };

        recRef.current = rec;
        rec.start();
    }, [lang, stopMeter]);

    const stopWatch = useCallback(() => {
        clearInterval(watchRef.current);
        watchRef.current = null;
    }, []);

    const stop = useCallback(() => {
        wantRef.current = false;
        stopWatch();
        // stop() (not abort()) lets the recogniser commit what it has heard
        if (recRef.current) recRef.current.stop();
        else setListening(false);
        stopMeter();
    }, [stopMeter, stopWatch]);

    /**
     * @param {{ autoStop?: boolean, silenceMs?: number, idleMs?: number }} [opts]
     *   autoStop   end by itself: `silenceMs` after the last word heard, or
     *              `idleMs` after starting when nothing is said at all
     */
    const start = useCallback((opts = {}) => {
        if (!SR || wantRef.current) return;
        setError(null);
        wantRef.current = true;
        setListening(true);
        heardAtRef.current = Date.now();
        heardAnyRef.current = false;
        try { startSession(); } catch (err) {
            wantRef.current = false;
            setListening(false);
            setError(err.message);
            return;
        }
        startMeter();

        stopWatch();
        if (opts.autoStop) {
            const silence = opts.silenceMs ?? 2500;
            const idle = opts.idleMs ?? 8000;
            watchRef.current = setInterval(() => {
                if (!wantRef.current) { stopWatch(); return; }
                const quiet = Date.now() - heardAtRef.current;
                if (quiet > (heardAnyRef.current ? silence : idle)) stop();
            }, 250);
        }
    }, [startSession, startMeter, stop, stopWatch]);

    const reset = useCallback(() => {
        bankRef.current = '';
        sessionRef.current = '';
        setFinalText('');
        setInterim('');
        setError(null);
        // drop what the live session already holds by starting it over
        if (recRef.current) recRef.current.abort();
    }, []);

    useEffect(() => () => {
        wantRef.current = false;
        clearInterval(watchRef.current);
        if (recRef.current) { recRef.current.onend = null; recRef.current.abort(); }
        stopMeter();
    }, [stopMeter]);

    return { supported, listening, finalText, interim, error, levelRef, heardAtRef, start, stop, reset };
}
