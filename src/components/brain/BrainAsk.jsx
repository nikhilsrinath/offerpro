import React, { useState, useRef, useEffect } from 'react';
import { CornerDownLeft, Database, AlertTriangle } from 'lucide-react';
import { useT, MONO, fmtDate } from '../ui/edgeUtils';
import { Btn, Muted, Empty } from '../ui/edge';
import { ask, kindLabel } from '../../services/brainService';

/* Ask: one question, one answer, and the records it came from.

   The source list under each answer is not decoration. It is the difference
   between an assistant that asserts and one that can be checked: every line
   names a real record, so a figure that looks wrong can be traced to the row it
   was read from. */

const SUGGESTED = [
    'How many employees do we have?',
    'What is outstanding across our invoices?',
    'Which customers have we billed the most?',
    'What is overdue right now?',
    'Which products have sold best?',
];

export default function BrainAsk({ orgId, stale, syncedAt }) {
    const t = useT();
    const [question, setQuestion] = useState('');
    const [turns, setTurns] = useState([]);
    const [busy, setBusy] = useState(false);
    const inputRef = useRef(null);
    const endRef = useRef(null);

    useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turns, busy]);

    const submit = async (text) => {
        const q = (text ?? question).trim();
        if (!q || busy) return;
        setQuestion('');
        setBusy(true);
        setTurns((prev) => [...prev, { role: 'user', text: q, id: `q${Date.now()}` }]);
        try {
            const res = await ask(orgId, q);
            setTurns((prev) => [...prev, {
                role: 'answer', id: `a${Date.now()}`,
                text: res.answer, sources: res.sources || [],
                retrieval: res.retrieval, syncedAt: res.synced_at,
            }]);
        } catch (e) {
            setTurns((prev) => [...prev, {
                role: 'error', id: `e${Date.now()}`,
                text: e.status === 429
                    ? 'You have reached your plan\'s AI message limit. Upgrade to keep asking.'
                    : e.message || 'That question could not be answered.',
            }]);
        } finally {
            setBusy(false);
            inputRef.current?.focus();
        }
    };

    return (
        <div style={{ fontFamily: MONO, maxWidth: 820, margin: '0 auto' }}>
            {stale && (
                <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 14,
                    padding: '10px 12px', borderRadius: 9,
                    border: `1px solid ${t.line}`, background: t.panelAlt,
                }}>
                    <AlertTriangle aria-hidden="true" size={13} strokeWidth={1.8}
                        style={{ color: t.dim, flexShrink: 0, marginTop: 1 }} />
                    <div style={{ fontSize: 10.5, color: t.dim, lineHeight: 1.6 }}>
                        Your records have changed since the brain last synchronised
                        {syncedAt ? ` on ${fmtDate(syncedAt)}` : ''}. Answers will reflect the
                        last sync, not this minute. Resynchronise from Brain Health for
                        current figures.
                    </div>
                </div>
            )}

            <div style={{ minHeight: 180, marginBottom: 16 }}>
                {turns.length === 0 && !busy && (
                    <Empty>
                        Ask anything about your company. EdgeBrain answers from your own
                        records and shows you which ones it used.
                    </Empty>
                )}

                {turns.map((turn) => (
                    <div key={turn.id} style={{ marginBottom: 16 }}>
                        {turn.role === 'user' && (
                            <div style={{
                                fontSize: 12.5, color: t.text, lineHeight: 1.6,
                                paddingLeft: 11, borderLeft: `2px solid ${t.lineStrong}`,
                            }}>{turn.text}</div>
                        )}

                        {turn.role === 'answer' && (
                            <div style={{
                                border: `1px solid ${t.line}`, borderRadius: 10,
                                background: t.panel, overflow: 'hidden', marginTop: 9,
                            }}>
                                <div style={{
                                    padding: '13px 15px', fontSize: 12, color: t.text,
                                    lineHeight: 1.75, whiteSpace: 'pre-wrap',
                                }}>{turn.text}</div>

                                {turn.sources?.length > 0 && (
                                    <details>
                                        <summary style={{
                                            cursor: 'pointer', listStyle: 'none', padding: '8px 15px',
                                            borderTop: `1px solid ${t.lineSoft}`, fontSize: 9.5,
                                            color: t.faint, letterSpacing: '0.06em',
                                            display: 'flex', alignItems: 'center', gap: 7,
                                        }}>
                                            <Database aria-hidden="true" size={11} strokeWidth={1.8} />
                                            {turn.sources.length} SOURCE RECORD{turn.sources.length === 1 ? '' : 'S'}
                                            {turn.retrieval ? ` · ${turn.retrieval.metrics} aggregates` : ''}
                                        </summary>
                                        <ul style={{
                                            listStyle: 'none', margin: 0, padding: '2px 15px 12px',
                                            display: 'grid', gap: 5,
                                        }}>
                                            {turn.sources.map((s) => (
                                                <li key={s.node_id} style={{
                                                    display: 'flex', gap: 9, fontSize: 10, alignItems: 'baseline',
                                                }}>
                                                    <span style={{ color: t.faint, width: 108, flexShrink: 0 }}>
                                                        {kindLabel(s.kind)}
                                                    </span>
                                                    <span style={{
                                                        color: t.dim, flex: 1, minWidth: 0,
                                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                    }}>{s.label}</span>
                                                    <span style={{ color: t.ghost, flexShrink: 0, fontSize: 9 }}>
                                                        {s.source_table}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </details>
                                )}
                            </div>
                        )}

                        {turn.role === 'error' && (
                            <div role="alert" style={{
                                marginTop: 9, padding: '11px 13px', borderRadius: 9,
                                border: `1px solid ${t.down}`, fontSize: 11, color: t.down, lineHeight: 1.6,
                            }}>{turn.text}</div>
                        )}
                    </div>
                ))}

                {busy && (
                    <div role="status" aria-live="polite" style={{
                        fontSize: 11, color: t.faint, padding: '10px 0',
                    }}>Reading your records…</div>
                )}
                <div ref={endRef} />
            </div>

            <form onSubmit={(e) => { e.preventDefault(); submit(); }} style={{
                display: 'flex', gap: 8, alignItems: 'flex-end',
                position: 'sticky', bottom: 0, background: t.panel, paddingTop: 10,
            }}>
                <label style={{ flex: 1, minWidth: 0 }}>
                    <span style={SR_ONLY}>Ask anything about your company</span>
                    <textarea
                        ref={inputRef} rows={1} value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        onKeyDown={(e) => {
                            // Enter sends; Shift+Enter is a newline, as every chat input
                            // people already use behaves.
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
                        }}
                        placeholder="Ask anything about your company…"
                        className="edge-input"
                        style={{
                            width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                            minHeight: 42, maxHeight: 140, resize: 'vertical',
                            background: t.panelAlt, border: `1px solid ${t.line}`, borderRadius: 9,
                            color: t.text, fontFamily: MONO, fontSize: 12, lineHeight: 1.6, outline: 'none',
                        }}
                    />
                </label>
                <Btn primary type="submit" disabled={busy || !question.trim()}>
                    <CornerDownLeft aria-hidden="true" size={13} strokeWidth={1.9} />
                    Ask
                </Btn>
            </form>

            {turns.length === 0 && (
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 12 }}>
                    {SUGGESTED.map((s) => (
                        <button key={s} type="button" className="edge-btn" onClick={() => submit(s)}
                            disabled={busy}
                            style={{
                                height: 26, padding: '0 10px', borderRadius: 999, cursor: 'pointer',
                                border: `1px solid ${t.line}`, background: t.panel,
                                color: t.dim, fontFamily: MONO, fontSize: 10.5,
                            }}>{s}</button>
                    ))}
                </div>
            )}

            <div style={{ marginTop: 14 }}>
                <Muted size={9.5}>
                    Answers are drawn from records you are permitted to see, and figures come
                    from aggregates computed in PostgreSQL rather than from the model's own
                    arithmetic.
                </Muted>
            </div>
        </div>
    );
}

const SR_ONLY = {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
    overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};
