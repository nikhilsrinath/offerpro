import React from 'react';
import { ArrowUpRight, Clock, Database, Crosshair } from 'lucide-react';
import { useT, MONO, fmtDate } from '../ui/edgeUtils';
import { Empty, Loading, Muted } from '../ui/edge';
import { kindLabel, relLabel } from '../../services/brainService';

/* The inspector: everything the brain holds about one entity, and every
   record it is joined to.

   Provenance leads, because a fact worth reading is a fact worth being able to
   trace back to the row it came from. The connected list is the graph in
   words — the same hop the canvas draws when a node is lit, reachable by
   keyboard and readable by a screen reader. */

export default function BrainInspector({ detail, loading, error, onOpen, onLocate }) {
    const t = useT();
    const node = detail?.node;

    if (loading) return <div style={{ padding: 14 }}><Loading>Opening…</Loading></div>;
    if (error) {
        return (
            <div role="alert" style={{ padding: 14, fontSize: 11, color: t.down, lineHeight: 1.6 }}>
                {error}
            </div>
        );
    }
    if (!node) {
        return (
            <Empty>
                Select anything on the graph — or in the list — to see what the brain
                knows about it and what it connects to.
            </Empty>
        );
    }

    return (
        <div style={{ fontFamily: MONO }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 13 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 9, letterSpacing: '0.1em', color: t.faint }}>
                        {kindLabel(node.kind).toUpperCase()}
                    </div>
                    <div style={{
                        fontSize: 14, color: t.text, marginTop: 4, lineHeight: 1.35,
                        wordBreak: 'break-word',
                    }}>{node.label}</div>
                </div>
                {onLocate && (
                    <button
                        type="button" className="edge-btn" onClick={() => onLocate(node.id)}
                        title="Centre this on the graph"
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5, height: 25,
                            padding: '0 8px', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
                            border: `1px solid ${t.line}`, background: t.panel, color: t.dim,
                            fontFamily: MONO, fontSize: 10,
                        }}>
                        <Crosshair aria-hidden="true" size={11} strokeWidth={1.8} />
                        Locate
                    </button>
                )}
            </div>

            <div style={{
                display: 'grid', gap: 6, padding: '9px 11px', marginBottom: 14,
                border: `1px solid ${t.lineSoft}`, borderRadius: 8, background: t.panelAlt,
            }}>
                <Line t={t} icon={<Database size={11} strokeWidth={1.8} />}
                    label="Source" value={`${node.source_table} · ${String(node.entity_id).slice(0, 8)}`} />
                <Line t={t} icon={<Clock size={11} strokeWidth={1.8} />}
                    label="Record updated" value={fmtDate(node.source_updated_at)} />
                <Line t={t} icon={<Clock size={11} strokeWidth={1.8} />}
                    label="Synced" value={fmtDate(node.synced_at)} />
            </div>

            <Section t={t} title="FACTS" note="from the source record">
                <FactList t={t} data={node.facts} />
            </Section>

            {node.metrics && Object.keys(node.metrics).length > 0 && (
                <Section t={t} title="DERIVED" note="computed in PostgreSQL">
                    <FactList t={t} data={node.metrics} />
                </Section>
            )}

            <Section
                t={t} title="CONNECTED"
                note={`${detail.neighbours.length} entit${detail.neighbours.length === 1 ? 'y' : 'ies'}`}
            >
                {detail.neighbours.length === 0 ? (
                    <Muted>Nothing links to this record.</Muted>
                ) : (
                    <div style={{ display: 'grid', gap: 1 }}>
                        {detail.neighbours.map((nb) => {
                            const edge = detail.edges.find(
                                (e) => e.src_id === nb.id || e.dst_id === nb.id,
                            );
                            const outgoing = edge?.src_id === node.id;
                            return (
                                <button
                                    key={nb.id} type="button" className="edge-row"
                                    onClick={() => onOpen(nb)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                                        padding: '7px 8px', border: 'none', background: 'transparent',
                                        cursor: 'pointer', textAlign: 'left', borderRadius: 6,
                                        fontFamily: MONO,
                                    }}>
                                    <span style={{ flex: 1, minWidth: 0 }}>
                                        <span style={{
                                            display: 'block', fontSize: 11, color: t.text,
                                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                        }}>{nb.label}</span>
                                        <span style={{ display: 'block', fontSize: 9.5, color: t.faint, marginTop: 2 }}>
                                            {edge
                                                ? `${outgoing ? '' : '← '}${relLabel(edge.rel)}${outgoing ? ' →' : ''} · ${kindLabel(nb.kind)}`
                                                : kindLabel(nb.kind)}
                                        </span>
                                    </span>
                                    <ArrowUpRight aria-hidden="true" size={12} strokeWidth={1.8}
                                        style={{ color: t.ghost, flexShrink: 0 }} />
                                </button>
                            );
                        })}
                    </div>
                )}
            </Section>
        </div>
    );
}

function Line({ t, icon, label, value }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10 }}>
            <span aria-hidden="true" style={{ color: t.ghost, display: 'grid', placeItems: 'center' }}>{icon}</span>
            <span style={{ color: t.faint, width: 92, flexShrink: 0 }}>{label}</span>
            <span style={{
                color: t.dim, flex: 1, minWidth: 0, whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{value}</span>
        </div>
    );
}

function Section({ t, title, note, children }) {
    return (
        <section style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 8 }}>
                <h3 style={{
                    margin: 0, fontSize: 9, letterSpacing: '0.1em', fontWeight: 400, color: t.faint,
                }}>{title}</h3>
                {note && <span style={{ fontSize: 9, color: t.ghost }}>{note}</span>}
            </div>
            {children}
        </section>
    );
}

const HIDDEN_KEYS = new Set(['line_items', 'created_at']);

function FactList({ t, data }) {
    const entries = Object.entries(data || {})
        .filter(([k, v]) => !HIDDEN_KEYS.has(k) && v !== null && v !== '' && typeof v !== 'object');
    if (entries.length === 0) return <Muted>Nothing recorded.</Muted>;
    return (
        <div style={{ display: 'grid', gap: 5 }}>
            {entries.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 9, fontSize: 10.5, alignItems: 'baseline' }}>
                    <span style={{ color: t.faint, width: 112, flexShrink: 0 }}>
                        {k.replace(/_/g, ' ')}
                    </span>
                    <span style={{ color: t.text, flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
                        {typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)}
                    </span>
                </div>
            ))}
        </div>
    );
}
