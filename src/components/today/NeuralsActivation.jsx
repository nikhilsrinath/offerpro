import React, { useEffect, useState } from 'react';
import { Check, ShieldCheck, Sparkles } from 'lucide-react';
import NeuralBrain from './NeuralBrain.jsx';
import './neuralsActivation.css';

/* ══════════════════════════════════════════════════════════════════════════
   The AI page before a company has Neurals.

   EdgeAI answers from the company brain, so until it exists the page is this
   one screen: a living neural brain (NeuralBrain) and the single control
   that builds it. While the build runs the brain region for each domain
   bursts in turn; when it lands a wave lights the whole brain and the real
   counts from the finished brain are shown. Only then does the page open its
   Ask, Agents, Connectors and Neurals tabs.

   phase: 'idle' | 'building' | 'done'. The counts on 'done' come from the
   brain's own status, never a guess.
   ══════════════════════════════════════════════════════════════════════════ */

// The domains the build reads; NeuralBrain maps each to a region.
const STEPS = ['Customers', 'Finance', 'Products', 'Documents', 'Operations', 'Activity', 'History', 'Team'];

const fmt = (n) => Number(n || 0).toLocaleString();

export default function NeuralsActivation({ phase, canBuild, error, counts, onActivate, onContinue }) {
    const building = phase === 'building';
    const done = phase === 'done';

    // Which domain the caption names while the build runs. Cosmetic: the build
    // is one call, so this only walks the list, it does not claim progress.
    const [step, setStep] = useState(0);
    useEffect(() => {
        if (!building) return undefined;
        const id = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 900);
        return () => clearInterval(id);
    }, [building]);

    return (
        <div className="ask-pane eo-scroll na" data-phase={phase}>
            <div className="na-inner">
                <div className="na-stage" aria-hidden="true">
                    <NeuralBrain phase={phase} focus={building ? STEPS[step] : null} />
                </div>

                <div className="na-copy" aria-live="polite">
                    {done ? (
                        <>
                            <span className="na-badge is-done"><Check size={12} strokeWidth={2.4} aria-hidden="true" />Activated</span>
                            <h2 className="na-title">Your Neurals Are Live</h2>
                            <p className="na-text">
                                EdgeAI now reasons over your company's own records.
                                {counts && <> It connected <b>{fmt(counts.nodes)}</b> records with <b>{fmt(counts.edges)}</b> links.</>}
                            </p>
                            <button type="button" className="na-btn" onClick={onContinue} autoFocus>
                                Start Using EdgeAI
                            </button>
                        </>
                    ) : building ? (
                        <>
                            <span className="na-badge"><Sparkles size={12} strokeWidth={2} aria-hidden="true" />Activating</span>
                            <h2 className="na-title">Building Your Neurals</h2>
                            <p className="na-text">
                                Connecting <span className="na-step" key={step}>{STEPS[step]}</span>
                                <span className="na-dots"><i /><i /><i /></span>
                            </p>
                            <p className="na-note">Reading the records you already hold. This runs once.</p>
                        </>
                    ) : (
                        <>
                            <span className="na-badge"><Sparkles size={12} strokeWidth={2} aria-hidden="true" />Neurals</span>
                            <h2 className="na-title">Activate Your Neurals</h2>
                            <p className="na-text">
                                EdgeAI answers from one connected picture of your company: team,
                                customers, finance, products, documents and operations. Activate it
                                once and chat, agents and connectors open up.
                            </p>
                            {error && <div className="na-error" role="alert">{error}</div>}
                            <button type="button" className="na-btn" onClick={onActivate} disabled={!canBuild}>
                                Activate Neurals
                            </button>
                            <p className="na-note">
                                {canBuild
                                    ? 'Nothing to upload or type. It reads what is already in Opstead.'
                                    : 'Your role cannot activate Neurals. Ask an owner or admin.'}
                            </p>
                            <p className="na-safe">
                                <ShieldCheck size={13} strokeWidth={1.8} aria-hidden="true" />
                                Every record keeps the permissions of the table it came from.
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
