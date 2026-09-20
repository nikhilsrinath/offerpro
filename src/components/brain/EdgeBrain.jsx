import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useT, MONO } from '../ui/edgeUtils';
import { Page, Seg, Loading, Empty, Btn } from '../ui/edge';
import { useOrg } from '../../context/OrgContext';
import * as brain from '../../services/brainService';
import BrainOnboarding from './BrainOnboarding';
import BrainOverview from './BrainOverview';
import BrainExplore from './BrainExplore';
import BrainAsk from './BrainAsk';
import BrainHealth from './BrainHealth';

/* ══════════════════════════════════════════════════════════════════════════
   EdgeBrain.

   One module, four views, and the lifecycle in front of them: no brain yet,
   building, ready, degraded, or not yours to see. The views are deliberately
   sections of one page rather than separate routes — the graph, the answer and
   the health of the thing that produced both are one subject, and paging
   between them would reload the graph every time.
   ══════════════════════════════════════════════════════════════════════════ */

const VIEWS = [
    { id: 'overview', label: 'Overview' },
    { id: 'explore', label: 'Explore' },
    { id: 'ask', label: 'Ask' },
    { id: 'health', label: 'Brain Health' },
];

export default function EdgeBrain() {
    const t = useT();
    const { activeOrg } = useOrg();
    const orgId = activeOrg?.id;

    const [view, setView] = useState('overview');
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');

    const [metrics, setMetrics] = useState([]);
    const [graph, setGraph] = useState(null);
    const [dataError, setDataError] = useState('');
    const [dataLoading, setDataLoading] = useState(false);

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
                    + `(${failed.join(', ')}). The rest of the brain is up to date — see Brain Health.`,
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
        <Page>
            <div style={{ fontFamily: MONO }}>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    paddingBottom: 12, marginBottom: 14, borderBottom: `1px solid ${t.line}`,
                }}>
                    <Seg
                        label="EdgeBrain view" value={broken ? 'health' : view}
                        onChange={setView} options={VIEWS}
                    />
                    <div style={{ flex: 1 }} />
                    <SyncChip
                        t={t} state={state} busy={building} stale={stale} live={live}
                        pending={status?.pendingChanges || 0}
                        failed={(state.failed_domains || []).length}
                        onClick={() => setView('health')}
                    />
                </div>

                {actionError && (
                    <div role="alert" style={{
                        marginBottom: 14, padding: '11px 13px', borderRadius: 9,
                        border: `1px solid ${t.line}`, background: t.panelAlt,
                        fontSize: 11, color: t.dim, lineHeight: 1.6,
                    }}>{actionError}</div>
                )}

                {building && (
                    <div role="status" aria-live="polite" style={{
                        marginBottom: 14, padding: '11px 13px', borderRadius: 9,
                        border: `1px solid ${t.line}`, fontSize: 11, color: t.dim,
                    }}>Synchronising with your records…</div>
                )}

                {(broken || view === 'health') && (
                    <BrainHealth
                        status={status} syncing={busy} error={actionError}
                        onSync={sync} onFullRebuild={rebuild}
                    />
                )}

                {!broken && view === 'overview' && (
                    dataLoading && !graph
                        ? <Loading>Loading what the brain knows…</Loading>
                        : dataError
                            ? <Empty action={<Btn onClick={loadData}>Try again</Btn>}>{dataError}</Empty>
                            : <BrainOverview
                                status={status} metrics={metrics} graph={graph}
                                onExplore={() => setView('explore')}
                                onAsk={() => setView('ask')}
                              />
                )}

                {!broken && view === 'explore' && (
                    <BrainExplore
                        orgId={orgId} graph={graph} loading={dataLoading && !graph}
                        error={dataError} onReload={loadData}
                    />
                )}

                {!broken && view === 'ask' && (
                    <BrainAsk orgId={orgId} stale={stale} syncedAt={state.last_sync_at} />
                )}
            </div>
        </Page>
    );
}

/** The always-visible answer to "can I trust what I am looking at". */
function SyncChip({ t, state, busy, stale, pending, failed, live, onClick }) {
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
            display: 'inline-flex', alignItems: 'center', gap: 7, height: 27,
            padding: '0 11px', borderRadius: 999, cursor: 'pointer',
            border: `1px solid ${t.line}`, background: t.panel,
            color: t.dim, fontFamily: MONO, fontSize: 10.5,
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
            <span style={{ color: t.ghost }}>· {state.node_count ?? 0}</span>
        </button>
    );
}
