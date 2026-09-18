import { useCallback, useEffect, useRef, useState } from 'react';

/* Live speech-to-text over the browser's Web Speech API, plus a mic level.
 *
 * Speed: interimResults are on, so words appear while they are still being
 * spoken and are replaced in place when the recogniser commits them.
 * Continuity: Chrome ends a "continuous" session after a pause or ~60s. When
 * that happens while the user still wants to listen, we bank the committed
 * text and start a new session, so the transcript never resets mid-thought.
 *
 * The level meter is a separate getUserMedia + AnalyserNode. SpeechRecognition
 * exposes no audio, and the orb needs something to breathe with. If the level
 * stream is refused, recognition still works; the orb just idles.
 */

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

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

    const join = (a, b) => (a && b ? a.replace(/\s+$/, '') + ' ' + b.replace(/^\s+/, '') : a || b);

    const stopMeter = useCallback(() => {
        const a = audioRef.current;
        audioRef.current = null;
        levelRef.current = 0;
        if (!a) return;
        cancelAnimationFrame(a.raf);
        a.stream.getTracks().forEach((tr) => tr.stop());
        a.ctx.close().catch(() => {});
    }, []);

    const startMeter = useCallback(async () => {
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
    }, []);

    const startSession = useCallback(() => {
        const rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.lang = lang || navigator.language || 'en-IN';
        sessionRef.current = '';

        rec.onresult = (e) => {
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
        rec.onerror = (e) => {
            if (e.error === 'no-speech' || e.error === 'aborted') return;   // restart handles these
            setError(ERRORS[e.error] || 'Speech recognition stopped: ' + e.error);
            if (ERRORS[e.error]) wantRef.current = false;
        };
        rec.onend = () => {
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

    const start = useCallback(() => {
        if (!SR || wantRef.current) return;
        setError(null);
        wantRef.current = true;
        setListening(true);
        try { startSession(); } catch (err) {
            wantRef.current = false;
            setListening(false);
            setError(err.message);
            return;
        }
        startMeter();
    }, [startSession, startMeter]);

    const stop = useCallback(() => {
        wantRef.current = false;
        // stop() (not abort()) lets the recogniser commit what it has heard
        if (recRef.current) recRef.current.stop();
        else setListening(false);
        stopMeter();
    }, [stopMeter]);

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
        if (recRef.current) { recRef.current.onend = null; recRef.current.abort(); }
        stopMeter();
    }, [stopMeter]);

    return { supported, listening, finalText, interim, error, levelRef, start, stop, reset };
}
