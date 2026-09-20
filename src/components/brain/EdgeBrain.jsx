import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Minus, Plus, Maximize2, PanelRight } from 'lucide-react';
import { useT, MONO } from '../ui/edgeUtils';
import { Page, Loading, Empty, Btn } from '../ui/edge';
import { useOrg } from '../../context/OrgContext';
import * as brain from '../../services/brainService';
import BrainOnboarding from './BrainOnboarding';
import BrainDock from './BrainDock';
import KnowledgeGraph from './KnowledgeGraph';
import {
    searchEntities, getEntity, DOMAINS, domainOf,
} from '../../services/brainService';

/* ══════════════════════════════════════════════════════════════════════════
   EdgeBrain.

   The page is the graph. It fills the shell edge to edge, and everything else
   — the figures, the entity list, the inspector, Ask, the health of the thing
   that produced all of it — sits in one dock on the right behind a rail of
   icons. Nothing floats over the middle of the canvas, and nothing stacks
   above it pushing the graph into a letterbox.

   That is the whole reorganisation: the four tabs this module used to have
   were four pages that each rebuilt the graph, when they were really one
   subject seen from one place. Selecting a node now changes the panel beside
   it rather than navigating away from the picture.
   ══════════════════════════════════════════════════════════════════════════ */

export default function EdgeBrain() {
    const t = useT();
    const { activeOrg } = useOrg();
    const orgId = activeOrg?.id;

    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');

    const [metrics, setMetrics] = useState([]);
    const [graph, setGraph] = useState(null);
    const [dataError, setDataError] = useState('');
    const [dataLoading, setDataLoading] = useState(false);

    /* ── the workspace ────────────────────────────────────────────────────── */
    const [tab, setTab] = useState('summary');
    const [dockOpen, setDockOpen] = useState(true);
    const [query, setQuery] = useState('');
    const [domain, setDomain] = useState('all');
    const [selected, setSelected] = useState(null);
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState('');
    const [hits, setHits] = useState(null);
    const [searching, setSearching] = useState(false);
    const [zoom, setZoom] = useState(1);
    const graphRef = useRef(null);

    // Guards every async settle against an org switch mid-flight, so a response
    // for the previous tenant can never paint over the current one.
    const orgRef = useRef(orgId);
    orgRef.current = orgId;

    // Guards the open-the-page catch-up sync to once per organization.
    const autoSyncedRef = useRef(false);

    const loadStatus = useCallback(async () => {
        if (!orgId) return null;
        setError('');
        try {
            const res = await brain.getStatus(orgId);
            if (orgRef.current !== orgId) return null;
            setStatus(res);
            return res;
        } catch (e) {
            if (orgRef.current !== orgId) return null;
            setError(e.status === 403
                ? 'Your role does not have access to the Company Brain. An owner or admin can grant it under company settings.'
                : e.message || 'Could not reach the Company Brain.');
            return null;
        } finally {
            if (orgRef.current === orgId) setLoading(false);
        }
    }, [orgId]);

    const loadData = useCallback(async () => {
        if (!orgId) return;
        setDataLoading(true);
        setDataError('');
        try {
            const [m, g] = await Promise.all([
                brain.getMetrics(orgId),
                brain.getGraph(orgId, { limit: 600 }),
            ]);
            if (orgRef.current !== orgId) return;
            setMetrics(m);
            setGraph(g);
        } catch (e) {
            if (orgRef.current !== orgId) return;
            setDataError(e.message || 'Could not load the brain\'s contents.');
        } finally {
            if (orgRef.current === orgId) setDataLoading(false);
        }
    }, [orgId]);

    useEffect(() => {
        setLoading(true);
        setStatus(null);
        setGraph(null);
        setMetrics([]);
        setSelected(null);
        setDetail(null);
        autoSyncedRef.current = false;
        loadStatus();
    }, [loadStatus]);

    useEffect(() => {
        if (status?.state?.status === 'ready') loadData();
    }, [status?.state?.status, status?.state?.last_sync_at, loadData]);

    /* ── staying current ──────────────────────────────────────────────────
       Changes reach the brain on their own: a trigger marks the organization
       dirty and pg_cron drains it within seconds (0034). This page's job is
       only to notice, which it does by watching brain_state over realtime.

       The poll underneath is not redundant. Realtime needs a websocket, and a
       proxy or a sleeping laptop will drop one without telling the page; a
       thirty-second poll means the worst case is a slightly late refresh
       rather than a screen that silently stopped updating. It backs off to
       two minutes once realtime is confirmed connected. */
    const [live, setLive] = useState(false);

    useEffect(() => {
        if (!orgId || status?.state?.status !== 'ready') return undefined;

        const refresh = () => { loadStatus(); };
        const unsubscribe = brain.subscribeToBrain(
            orgId,
            refresh,
            (s) => setLive(s === 'SUBSCRIBED'),
        );
        return () => { unsubscribe(); setLive(false); };
    }, [orgId, status?.state?.status, loadStatus]);

    useEffect(() => {
        if (!orgId || status?.state?.status !== 'ready') return undefined;
        const id = setInterval(() => { loadStatus(); }, live ? 120000 : 30000);
        return () => clearInterval(id);
    }, [orgId, status?.state?.status, live, loadStatus]);

    /* A deployment without pg_cron has no background drain, so the brain would
       sit stale until someone pressed Sync. Opening the page with changes
       outstanding syncs them — quietly, because the user asked to look at the
       brain, not to be told it was briefly behind. Once per mount: the flag is
       what stops this from retriggering on the status reload it causes. */
    useEffect(() => {
        if (autoSyncedRef.current) return;
        if (status?.state?.status !== 'ready') return;
        if (!status?.can?.sync || !(status?.pendingChanges > 0)) return;
        autoSyncedRef.current = true;
        brain.syncBrain(orgId)
            .then(() => { loadStatus(); loadData(); })
            .catch(() => { /* the sync chip already shows the drift */ });
    }, [status, orgId, loadStatus, loadData]);

    const run = useCallback(async (fn) => {
        setBusy(true);
        setActionError('');
        try {
            const res = await fn();
            const next = await loadStatus();
            await loadData();
            if (res?.skipped) {
                setActionError(res.message || 'A synchronisation is already running.');
            } else if (res?.partial) {
                const failed = res.result?.failed_domains || [];
                setActionError(
                    `Finished with ${failed.length} domain${failed.length === 1 ? '' : 's'} failing `
                    + `(${failed.join(', ')}). The rest of the brain is up to date — see Health.`,
                );
            }
            return next;
        } catch (e) {
            setActionError(e.message || 'That did not complete.');
            return null;
        } finally {
            setBusy(false);
        }
    }, [loadStatus, loadData]);

    const build = useCallback(() => run(() => brain.buildBrain(orgId)), [run, orgId]);
    const sync = useCallback(() => run(() => brain.syncBrain(orgId)), [run, orgId]);
    const rebuild = useCallback(() => run(() => brain.buildBrain(orgId)), [run, orgId]);

    /* ── search, selection, filtering ─────────────────────────────────────── */

    /* Search runs against the database rather than the loaded graph: the canvas
       holds a capped slice, and a record outside that cap must still be findable. */
    useEffect(() => {
        const term = query.trim();
        if (!term || !orgId) { setHits(null); return undefined; }
        let cancelled = false;
        setSearching(true);
        const id = setTimeout(() => {
            searchEntities(orgId, term, { limit: 60 })
                .then((rows) => { if (!cancelled) setHits(rows); })
                .catch(() => { if (!cancelled) setHits([]); })
                .finally(() => { if (!cancelled) setSearching(false); });
        }, 220);
        return () => { cancelled = true; clearTimeout(id); };
    }, [query, orgId]);

    const openNode = useCallback((node) => {
        setSelected(node.id);
        setTab('inspect');
        setDockOpen(true);
        setDetail(null);
        setDetailError('');
        setDetailLoading(true);
        graphRef.current?.focusNode(node.id);
        getEntity(orgId, node.id)
            .then((d) => {
                if (!d) { setDetailError('That record is no longer in the brain.'); return; }
                setDetail(d);
            })
            .catch((e) => setDetailError(e.message || 'Could not open that record.'))
            .finally(() => setDetailLoading(false));
    }, [orgId]);

    const clearSelection = useCallback(() => {
        setSelected(null);
        setDetail(null);
        setDetailError('');
    }, []);

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

    const listed = useMemo(() => {
        const source = hits ?? graphNodes;
        return domain === 'all' ? source : source.filter((n) => domainOf(n.kind) === domain);
    }, [hits, graphNodes, domain]);

    /* ── the lifecycle gates ──────────────────────────────────────────────── */

    if (!orgId) {
        return <Page><Empty>Select an organisation to open its Company Brain.</Empty></Page>;
    }

    if (loading) {
        return <Page><Loading>Checking your Company Brain…</Loading></Page>;
    }

    if (error) {
        return (
            <Page>
                <Empty action={<Btn onClick={() => { setLoading(true); loadStatus(); }}>Try again</Btn>}>
                    {error}
                </Empty>
            </Page>
        );
    }

    const state = status?.state || {};
    const absent = !state.status || state.status === 'absent';
    const building = state.status === 'building' || busy;

    if (absent) {
        return (
            <Page>
                <BrainOnboarding
                    onBuild={build} building={busy}
                    error={actionError} canBuild={!!status?.can?.build}
                />
            </Page>
        );
    }

    // Built once, then every domain failed on a later run: there is a brain, but
    // nothing in it can be trusted, so Health is the only honest place to land.
    const broken = state.status === 'error' && (state.node_count || 0) === 0;
    const stale = (status?.pendingChanges || 0) > 0;

    return (
        <Page fill>
            <div className="brain-workspace" style={{
                flex: 1, minHeight: 0, display: 'flex', fontFamily: MONO, position: 'relative',
            }}>
                {/* ── the canvas ───────────────────────────────────────────── */}
                <div style={{ flex: 1, minWidth: 0, position: 'relative', background: t.panel }}>
                    {dataLoading && !graph ? (
                        <Loading>Loading what the brain knows…</Loading>
                    ) : dataError ? (
                        <Empty action={<Btn onClick={loadData}>Try again</Btn>}>{dataError}</Empty>
                    ) : graphNodes.length === 0 ? (
                        <Empty>
                            {domain === 'all'
                                ? 'The graph is empty. Synchronise the brain to populate it.'
                                : 'Nothing in this domain yet. Clear the filter to see the rest.'}
                        </Empty>
                    ) : (
                        <KnowledgeGraph
                            ref={graphRef} bare
                            nodes={graphNodes} edges={graphEdges}
                            highlight={query} selectedId={selected}
                            onSelect={openNode} onViewChange={setZoom}
                            onClear={clearSelection}
                        />
                    )}

                    {/* ── the status strip ─────────────────────────────────
                        Top-left, over the canvas corner rather than in a bar
                        above it: the one thing that has to be true before any
                        figure on this page can be trusted, and it costs the
                        graph nothing. */}
                    <div style={{
                        position: 'absolute', left: 12, top: 12, display: 'flex',
                        alignItems: 'center', gap: 8, flexWrap: 'wrap', maxWidth: 'calc(100% - 24px)',
                        pointerEvents: 'none',
                    }}>
                        <SyncChip
                            t={t} busy={building} stale={stale} live={live}
                            pending={status?.pendingChanges || 0}
                            failed={(state.failed_domains || []).length}
                            onClick={() => { setTab('health'); setDockOpen(true); }}
                        />
                        {graph && (
                            <Chip t={t} muted>
                                {graphNodes.length} entities · {graphEdges.length} links
                            </Chip>
                        )}
                        {broken && (
                            <Chip t={t} tone={t.down}>
                                Nothing in the brain can be trusted — open Health
                            </Chip>
                        )}
                    </div>

                    {actionError && (
                        <div role="alert" style={{
                            position: 'absolute', left: '50%', top: 12, transform: 'translateX(-50%)',
                            maxWidth: 'min(560px, calc(100% - 24px))', padding: '10px 13px', borderRadius: 9,
                            border: `1px solid ${t.lineStrong}`, background: t.panel, boxShadow: t.shadow,
                            fontSize: 10.5, color: t.dim, lineHeight: 1.6, zIndex: 6,
                        }}>{actionError}</div>
                    )}

                    {/* ── domain legend, which is also the filter ──────────
                        The key a reader needs to decode the colours and the
                        control they reach for next are the same control. */}
                    <div style={{
                        position: 'absolute', left: 12, bottom: 12, right: 128,
                        display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center',
                    }}>
                        <FilterChip
                            t={t} on={domain === 'all'} label="All"
                            onClick={() => setDomain('all')}
                        />
                        {DOMAINS.map((d) => (
                            <FilterChip
                                key={d.id} t={t} on={domain === d.id} label={d.label}
                                dot={DOMAIN_COLOR[t.isDark ? 'dark' : 'light'][d.id]}
                                onClick={() => setDomain(domain === d.id ? 'all' : d.id)}
                            />
                        ))}
                    </div>

                    {/* ── the camera controls ──────────────────────────────── */}
                    <div style={{
                        position: 'absolute', right: 12, bottom: 12, display: 'flex',
                        alignItems: 'center', gap: 4,
                        background: t.isDark ? 'rgba(13,13,15,.86)' : 'rgba(255,255,255,.88)',
                        border: `1px solid ${t.line}`, borderRadius: 8, padding: 3,
                        backdropFilter: 'blur(8px)',
                    }}>
                        <CtlBtn t={t} label="Zoom out" onClick={() => graphRef.current?.zoomBy(1 / 1.35)}>
                            <Minus aria-hidden="true" size={13} strokeWidth={1.9} />
                        </CtlBtn>
                        <span aria-live="off" style={{
                            minWidth: 42, textAlign: 'center', fontSize: 10, color: t.faint,
                        }}>{Math.round(zoom * 100)}%</span>
                        <CtlBtn t={t} label="Zoom in" onClick={() => graphRef.current?.zoomBy(1.35)}>
                            <Plus aria-hidden="true" size={13} strokeWidth={1.9} />
                        </CtlBtn>
                        <span aria-hidden="true" style={{ width: 1, height: 16, background: t.line, margin: '0 2px' }} />
                        <CtlBtn t={t} label="Fit the whole graph" onClick={() => graphRef.current?.fit()}>
                            <Maximize2 aria-hidden="true" size={12.5} strokeWidth={1.9} />
                        </CtlBtn>
                        {!dockOpen && (
                            <CtlBtn t={t} label="Show the panel" onClick={() => setDockOpen(true)}>
                                <PanelRight aria-hidden="true" size={13} strokeWidth={1.9} />
                            </CtlBtn>
                        )}
                    </div>
                </div>

                {/* ── the dock ─────────────────────────────────────────────── */}
                <BrainDock
                    tab={broken ? 'health' : tab} onTab={setTab}
                    open={dockOpen} onOpenChange={setDockOpen}
                    lockedToHealth={broken}
                    status={status} metrics={metrics}
                    query={query} onQuery={setQuery} listed={listed} searching={searching}
                    selectedId={selected} onOpenNode={openNode}
                    shownCount={graphNodes.length} hasHits={!!hits}
                    detail={detail} detailLoading={detailLoading} detailError={detailError}
                    onLocate={(id) => graphRef.current?.focusNode(id, 1.6)}
                    orgId={orgId} stale={stale} syncedAt={state.last_sync_at}
                    syncing={busy} actionError={actionError}
                    onSync={sync} onFullRebuild={rebuild}
                />
            </div>

            <style>{`
                @media (max-width: 860px) {
                    .brain-workspace .brain-dock-panel {
                        position: absolute; right: 46px; top: 0; bottom: 0;
                        width: min(340px, calc(100vw - 58px)) !important;
                        box-shadow: -14px 0 34px rgba(0,0,0,.24); z-index: 8;
                    }
                }
            `}</style>
        </Page>
    );
}

/* The domain palette is owned by the canvas; the legend needs the same values,
   and one of the two having its own copy that drifts is the classic way a key
   stops matching the picture it explains. */
const DOMAIN_COLOR = {
    dark: {
        organization: '#e8e8ea', people: '#7dd3fc', clients: '#a78bfa',
        finance: '#4ade80', products: '#fbbf24', spend: '#f87171',
        documents: '#22d3ee', operations: '#f0abfc',
    },
    light: {
        organization: '#0e1011', people: '#0369a1', clients: '#6d28d9',
        finance: '#15803d', products: '#b45309', spend: '#b91c1c',
        documents: '#0e7490', operations: '#a21caf',
    },
};

function glass(t) {
    return {
        background: t.isDark ? 'rgba(13,13,15,.86)' : 'rgba(255,255,255,.88)',
        border: `1px solid ${t.line}`,
        backdropFilter: 'blur(8px)',
    };
}

function Chip({ t, children, tone, muted }) {
    return (
        <span style={{
            ...glass(t), display: 'inline-flex', alignItems: 'center', height: 27,
            padding: '0 10px', borderRadius: 999, fontFamily: MONO, fontSize: 10.5,
            color: tone || (muted ? t.faint : t.dim), whiteSpace: 'nowrap',
        }}>{children}</span>
    );
}

function FilterChip({ t, on, label, dot, onClick }) {
    return (
        <button
            type="button" onClick={onClick} className="edge-btn" aria-pressed={on}
            style={{
                ...glass(t),
                display: 'inline-flex', alignItems: 'center', gap: 5, height: 24,
                padding: '0 9px', borderRadius: 999, cursor: 'pointer', fontFamily: MONO,
                fontSize: 9.5, whiteSpace: 'nowrap',
                borderColor: on ? t.lineStrong : t.line,
                color: on ? t.text : t.faint,
            }}>
            {dot && (
                <span aria-hidden="true" style={{
                    width: 6, height: 6, borderRadius: 999, background: dot, flexShrink: 0,
                }} />
            )}
            {label}
        </button>
    );
}

function CtlBtn({ t, label, onClick, children }) {
    return (
        <button
            type="button" onClick={onClick} className="edge-icon"
            title={label} aria-label={label}
            style={{
                width: 27, height: 27, display: 'grid', placeItems: 'center', borderRadius: 6,
                cursor: 'pointer', border: '1px solid transparent', background: 'transparent',
                color: t.dim,
            }}>
            {children}
        </button>
    );
}

/** The always-visible answer to "can I trust what I am looking at". */
function SyncChip({ t, busy, stale, pending, failed, live, onClick }) {
    const tone = busy ? t.dim : failed > 0 ? t.down : stale ? t.down : t.up;
    const text = busy
        ? 'Syncing'
        : failed > 0
            ? `${failed} domain${failed === 1 ? '' : 's'} failing`
            : stale
                ? `${pending} change${pending === 1 ? '' : 's'} pending`
                : 'In sync';

    return (
        <button type="button" onClick={onClick} className="edge-btn" style={{
            ...glass(t),
            display: 'inline-flex', alignItems: 'center', gap: 7, height: 27,
            padding: '0 11px', borderRadius: 999, cursor: 'pointer',
            color: t.dim, fontFamily: MONO, fontSize: 10.5, pointerEvents: 'auto',
        }} title="Open Brain Health">
            <span aria-hidden="true" style={{
                width: 6, height: 6, borderRadius: 999, background: tone, flexShrink: 0,
            }} />
            {text}
            {/* Only claimed when the websocket actually reported SUBSCRIBED —
                a "live" badge that lies is worse than none. */}
            {live && !busy && (
                <span style={{ color: t.ghost }} title="Updating live as your records change">· live</span>
            )}
        </button>
    );
}
