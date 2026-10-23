import React, { useEffect, useState } from 'react';
import { Check, ShieldCheck, Sparkles } from 'lucide-react';
import './neuralsActivation.css';

/* ══════════════════════════════════════════════════════════════════════════
   The AI page before a company has Neurals.

   EdgeAI answers from the company brain, so until it exists the page is this
   one screen: a constellation of the company's domains around a core, and the
   single control that builds it. While the build runs the nodes light up and
   the links draw in; when it lands the core turns into a check, a ring breaks
   outwards and the real counts from the finished brain are shown. Only then
   does the page open its Ask, Agents, Connectors and Neurals tabs.

   phase: 'idle' | 'building' | 'done'. The counts on 'done' come from the
   brain's own status, never a guess.
   ══════════════════════════════════════════════════════════════════════════ */

const CX = 200;
const CY = 160;

// The domains the build reads, placed round the core.
const NODES = [
    { id: 'team', label: 'Team', x: 86, y: 74 },
    { id: 'customers', label: 'Customers', x: 200, y: 34 },
    { id: 'finance', label: 'Finance', x: 316, y: 72 },
    { id: 'products', label: 'Products', x: 358, y: 168 },
    { id: 'documents', label: 'Documents', x: 306, y: 262 },
    { id: 'operations', label: 'Operations', x: 196, y: 292 },
    { id: 'activity', label: 'Activity', x: 88, y: 256 },
    { id: 'history', label: 'History', x: 42, y: 160 },
];

// Links between neighbours, so the finished picture reads as a web, not a star.
const RING = NODES.map((n, i) => [n, NODES[(i + 1) % NODES.length]]);

const STEPS = NODES.map((n) => n.label);

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
                    <svg viewBox="0 0 400 320" className="na-svg">
                        <defs>
                            <radialGradient id="na-core" cx="38%" cy="32%" r="70%">
                                <stop offset="0%" stopColor="#d6e9ff" />
                                <stop offset="48%" style={{ stopColor: 'var(--accent)' }} />
                                <stop offset="100%" stopColor="#0b2a57" />
                            </radialGradient>
                        </defs>

                        {/* spokes, core to each domain */}
                        {NODES.map((n, i) => (
                            <line
                                key={`s-${n.id}`} className="na-link na-spoke" pathLength="1"
                                x1={CX} y1={CY} x2={n.x} y2={n.y}
                                style={{ '--i': i }}
                            />
                        ))}
                        {/* the outer web */}
                        {RING.map(([a, b], i) => (
                            <line
                                key={`r-${a.id}`} className="na-link na-ring" pathLength="1"
                                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                                style={{ '--i': i }}
                            />
                        ))}

                        {/* pulses travelling inwards while building */}
                        {building && NODES.map((n, i) => (
                            <circle key={`p-${n.id}`} r="2.6" className="na-pulse" style={{ '--i': i }}>
                                <animateMotion
                                    dur="1.6s" repeatCount="indefinite" begin={`${i * 0.2}s`}
                                    path={`M${n.x},${n.y} L${CX},${CY}`}
                                />
                            </circle>
                        ))}

                        {NODES.map((n, i) => (
                            <g key={n.id} className="na-node" style={{ '--i': i }}>
                                <circle cx={n.x} cy={n.y} r="11" className="na-node-halo" />
                                <circle cx={n.x} cy={n.y} r="5" className="na-node-dot" />
                                <text
                                    x={n.x} y={n.y + (n.y > CY ? 24 : -16)}
                                    className={`na-node-label${building && STEPS[step] === n.label ? ' is-now' : ''}`}
                                >{n.label}</text>
                            </g>
                        ))}

                        {/* the core */}
                        <circle cx={CX} cy={CY} r="44" className="na-orbit na-orbit-1" />
                        <circle cx={CX} cy={CY} r="56" className="na-orbit na-orbit-2" />
                        <circle cx={CX} cy={CY} r="30" className="na-shock" />
                        <circle cx={CX} cy={CY} r="30" className="na-shock na-shock-2" />
                        <circle cx={CX} cy={CY} r="30" fill="url(#na-core)" className="na-core" />
                        <path d={`M${CX - 11},${CY + 1} l7,7 l15,-16`} className="na-check" />
                    </svg>
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
                                    ? 'Nothing to upload or type. It reads what is already in EdgeOS.'
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
