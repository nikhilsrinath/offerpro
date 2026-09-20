import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, ArrowUpRight, Clock, Database } from 'lucide-react';
import { useT, MONO, fmtDate } from '../ui/edgeUtils';
import { Search, Seg, Empty, Loading, Btn, Muted } from '../ui/edge';
import KnowledgeGraph from './KnowledgeGraph';
import {
    searchEntities, getEntity, kindLabel, relLabel, DOMAINS, domainOf,
} from '../../services/brainService';

/* Explore: the graph, a searchable list of the same entities, and an inspector
   for whatever is selected.

   The list is not a fallback for the canvas — it is the keyboard and screen
   reader path to everything the canvas shows, and the fastest way to reach a
   record whose name you already know. Both drive the same selection. */

export default function BrainExplore({ orgId, graph, loading, error, onReload }) {
    const t = useT();
    const [query, setQuery] = useState('');
    const [domain, setDomain] = useState('all');
    const [selected, setSelected] = useState(null);
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState('');
    const [hits, setHits] = useState(null);
    const [searching, setSearching] = useState(false);

    /* Search runs against the database rather than the loaded graph: the canvas
       holds a capped slice, and a record outside that cap must still be findable. */
    useEffect(() => {
        const term = query.trim();
        if (!term) { setHits(null); return undefined; }
        let cancelled = false;
        setSearching(true);
        const id = setTimeout(() => {
            searchEntities(orgId, term, { limit: 40 })
                .then((rows) => { if (!cancelled) setHits(rows); })
                .catch(() => { if (!cancelled) setHits([]); })
                .finally(() => { if (!cancelled) setSearching(false); });
        }, 220);
        return () => { cancelled = true; clearTimeout(id); };
    }, [query, orgId]);

    const openNode = useCallback((node) => {
        setSelected(node.id);
        setDetail(null);
        setDetailError('');
        setDetailLoading(true);
        getEntity(orgId, node.id)
            .then((d) => {
                if (!d) { setDetailError('That record is no longer in the brain.'); return; }
                setDetail(d);
            })
            .catch((e) => setDetailError(e.message || 'Could not open that record.'))
            .finally(() => setDetailLoading(false));
    }, [orgId]);

    const listed = useMemo(() => {
        const source = hits ?? graph?.nodes ?? [];
        return domain === 'all' ? source : source.filter((n) => domainOf(n.kind) === domain);
    }, [hits, graph, domain]);

    const graphNodes = useMemo(() => {
        if (!graph) return [];
        return domain === 'all' ? graph.nodes : graph.nodes.filter((n) => domainOf(n.kind) === domain);
    }, [graph, domain]);

    // An edge survives the domain filter only when both of its ends did.
    const graphEdges = useMemo(() => {
        if (!graph) return [];
        if (domain === 'all') return graph.edges;
        const ids = new Set(graphNodes.map((n) => n.id));
        return graph.edges.filter((e) => ids.has(e.src_id) && ids.has(e.dst_id));
    }, [graph, domain, graphNodes]);

    if (loading) return <Loading>Loading the graph…</Loading>;
    if (error) {
        return (
            <Empty action={<Btn onClick={onReload}>Try again</Btn>}>{error}</Empty>
        );
    }

    return (
        <div style={{ fontFamily: MONO }}>
            <div style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12,
            }}>
                <Search
                    value={query} onChange={setQuery} width={280}
                    placeholder="Search employees, invoices, customers…"
                />
                <Seg
                    label="Filter by domain" size="sm" value={domain} onChange={setDomain}
                    options={[{ id: 'all', label: 'All' },
                        ...DOMAINS.map((d) => ({ id: d.id, label: d.label }))]}
                />
                <div style={{ flex: 1 }} />
                <Muted>
                    {searching ? 'Searching…'
                        : hits ? `${listed.length} match${listed.length === 1 ? '' : 'es'}`
                        : `${graphNodes.length} shown`}
                </Muted>
            </div>

            <div style={{
                display: 'grid', gap: 12,
                gridTemplateColumns: detail || detailLoading ? 'minmax(0,1fr) 340px' : 'minmax(0,1fr)',
            }} className="brain-explore-grid">
                <div style={{ minWidth: 0 }}>
                    <KnowledgeGraph
                        nodes={graphNodes} edges={graphEdges}
                        highlight={query} selectedId={selected}
                        onSelect={openNode} height={460}
                    />

                    <div style={{
                        marginTop: 12, border: `1px solid ${t.line}`, borderRadius: 10, overflow: 'hidden',
                    }}>
                        <div style={{
                            padding: '9px 13px', borderBottom: `1px solid ${t.lineSoft}`,
                            fontSize: 9, letterSpacing: '0.1em', color: t.faint,
                        }}>ENTITIES</div>
                        {listed.length === 0 ? (
                            <Empty>
                                {query
                                    ? `Nothing in the brain matches “${query}”.`
                                    : 'No entities in this domain yet.'}
                            </Empty>
                        ) : (
                            <ul className="edge-scroll" style={{
                                listStyle: 'none', margin: 0, padding: 0, maxHeight: 300, overflowY: 'auto',
                            }}>
                                {listed.slice(0, 200).map((n) => (
                                    <li key={n.id}>
                                        <button
                                            type="button" className="edge-row"
                                            onClick={() => openNode(n)}
                                            aria-current={selected === n.id ? 'true' : undefined}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                                                padding: '8px 13px', textAlign: 'left', cursor: 'pointer',
                                                border: 'none', fontFamily: MONO,
                                                borderBottom: `1px solid ${t.lineSoft}`,
                                                background: selected === n.id ? t.panelAlt : 'transparent',
                                            }}>
                                            <span style={{
                                                fontSize: 9, color: t.faint, width: 104, flexShrink: 0,
                                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                            }}>{kindLabel(n.kind).toUpperCase()}</span>
                                            <span style={{
                                                flex: 1, minWidth: 0, fontSize: 11.5, color: t.text,
                                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                            }}>{n.label}</span>
                                            {n.state && (
                                                <span style={{ fontSize: 9.5, color: t.faint, flexShrink: 0 }}>{n.state}</span>
                                            )}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>

                {(detail || detailLoading || detailError) && (
                    <Inspector
                        t={t} detail={detail} loading={detailLoading} error={detailError}
                        onClose={() => { setDetail(null); setSelected(null); setDetailError(''); }}
                        onOpen={openNode}
                    />
                )}
            </div>

            <style>{`
                @media (max-width: 900px) {
                    .brain-explore-grid { grid-template-columns: minmax(0,1fr) !important; }
                }
            `}</style>
        </div>
    );
}

/* ── the inspector ────────────────────────────────────────────────────────── */

function Inspector({ t, detail, loading, error, onClose, onOpen }) {
    const node = detail?.node;

    return (
        <aside aria-label="Entity detail" style={{
            border: `1px solid ${t.line}`, borderRadius: 10, background: t.panel,
            alignSelf: 'start', position: 'sticky', top: 0, maxHeight: '78vh',
            display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: MONO,
        }}>
            <header style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '11px 12px', borderBottom: `1px solid ${t.lineSoft}`, flexShrink: 0,
            }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 9, letterSpacing: '0.1em', color: t.faint }}>
                        {node ? kindLabel(node.kind).toUpperCase() : 'RECORD'}
                    </div>
                    <div style={{ fontSize: 12.5, color: t.text, marginTop: 3, wordBreak: 'break-word' }}>
                        {node?.label || (loading ? 'Loading…' : 'Not available')}
                    </div>
                </div>
                <button type="button" onClick={onClose} aria-label="Close detail" className="edge-icon" style={{
                    width: 26, height: 26, display: 'grid', placeItems: 'center', cursor: 'pointer',
                    border: '1px solid transparent', background: 'transparent', color: t.faint, borderRadius: 6,
                }}><X aria-hidden="true" size={13} strokeWidth={1.9} /></button>
            </header>

            <div className="edge-scroll" style={{ overflowY: 'auto', padding: 12, flex: 1, minHeight: 0 }}>
                {loading && <Loading>Opening…</Loading>}
                {error && <div role="alert" style={{ fontSize: 11, color: t.down, lineHeight: 1.6 }}>{error}</div>}

                {node && (
                    <>
                        {/* Provenance first. A fact worth reading is a fact worth being
                            able to trace back to the row it came from. */}
                        <div style={{
                            display: 'grid', gap: 6, padding: '9px 11px', marginBottom: 13,
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

                        <Section t={t} title="CONNECTED" note={`${detail.neighbours.length} entit${detail.neighbours.length === 1 ? 'y' : 'ies'}`}>
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
                    </>
                )}
            </div>
        </aside>
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
        <section style={{ marginBottom: 15 }}>
            <div style={{
                display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 8,
            }}>
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
