import React from 'react';
import { RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useT, MONO, fmtDate } from '../ui/edgeUtils';
import { Panel, Btn, Table, Tr, Td, Empty, Status, Muted, Grid, Bar } from '../ui/edge';
import { kindLabel } from '../../services/brainService';

/* Brain Health: whether what you are reading can be trusted.

   A derived store that cannot be checked against its source is a store nobody
   should build on, so everything that could be wrong is on this page: when it
   last agreed with Postgres, how far Postgres has moved since, which domains
   failed and what they said when they did. */

export default function BrainHealth({ status, syncing, onSync, onFullRebuild, error }) {
    const t = useT();
    const state = status?.state || {};
    const failed = state.failed_domains || [];
    const runs = status?.runs || [];
    const pending = status?.pendingChanges || 0;

    const healthy = state.status === 'ready' && failed.length === 0;
    const peak = Math.max(...(status?.byKind || []).map((k) => k.count), 1);

    return (
        <div style={{ fontFamily: MONO, display: 'grid', gap: 12 }}>
            <div style={{
                display: 'flex', alignItems: 'center', gap: 13, flexWrap: 'wrap',
                padding: '14px 16px', border: `1px solid ${failed.length ? t.down : t.line}`,
                borderRadius: 10,
            }}>
                <span aria-hidden="true" style={{ color: healthy ? t.up : t.down, display: 'grid', placeItems: 'center' }}>
                    {healthy
                        ? <CheckCircle2 size={18} strokeWidth={1.7} />
                        : <AlertTriangle size={18} strokeWidth={1.7} />}
                </span>
                <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: 12.5, color: t.text }}>
                        {healthy
                            ? 'The brain is synchronised'
                            : failed.length
                                ? `${failed.length} domain${failed.length === 1 ? '' : 's'} failed to synchronise`
                                : 'The brain has not finished a successful sync'}
                    </div>
                    <div style={{ fontSize: 10.5, color: t.faint, marginTop: 4, lineHeight: 1.6 }}>
                        Last sync {state.last_sync_at ? fmtDate(state.last_sync_at) : 'never'}
                        {state.last_sync_mode ? ` · ${state.last_sync_mode}` : ''}
                        {state.last_sync_ms ? ` · ${state.last_sync_ms} ms` : ''}
                        {pending > 0 && (
                            <> · <span style={{ color: t.down }}>{pending} record{pending === 1 ? '' : 's'} changed since</span></>
                        )}
                    </div>
                    {/* The buttons beside this are a manual override, not the
                        normal path — saying so stops "Sync now" from reading as
                        a chore the brain depends on somebody remembering. */}
                    <div style={{ fontSize: 10, color: t.ghost, marginTop: 5, lineHeight: 1.6 }}>
                        Changes to your records sync on their own, within seconds. Sync now
                        forces it immediately; a full rebuild reprojects every domain from
                        scratch and is what to reach for after a bulk import.
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <Btn onClick={onSync} disabled={syncing || !status?.can?.sync}
                        title={status?.can?.sync ? 'Apply changes since the last sync' : 'Your role cannot resynchronise the brain'}>
                        <RefreshCw aria-hidden="true" size={12} strokeWidth={1.9} />
                        {syncing ? 'Syncing…' : 'Sync now'}
                    </Btn>
                    <Btn onClick={onFullRebuild} disabled={syncing || !status?.can?.build}
                        title={status?.can?.build ? 'Reproject every domain from scratch' : 'Your role cannot rebuild the brain'}>
                        Full rebuild
                    </Btn>
                </div>
            </div>

            {error && (
                <div role="alert" style={{
                    padding: '11px 13px', borderRadius: 9, border: `1px solid ${t.down}`,
                    fontSize: 11, color: t.down, lineHeight: 1.6,
                }}>{error}</div>
            )}

            {failed.length > 0 && (
                <Panel title="Failed domains" note="the rest of the brain is still usable" pad={13}>
                    <div style={{ display: 'grid', gap: 9 }}>
                        {failed.map((d) => {
                            const detail = state.coverage?.[d];
                            return (
                                <div key={d} style={{
                                    padding: '9px 11px', border: `1px solid ${t.lineSoft}`,
                                    borderRadius: 8, background: t.panelAlt,
                                }}>
                                    <div style={{ fontSize: 11, color: t.text, marginBottom: 3 }}>{d}</div>
                                    <div style={{ fontSize: 10, color: t.down, lineHeight: 1.6, wordBreak: 'break-word' }}>
                                        {detail?.error || 'No detail recorded.'}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div style={{ marginTop: 11 }}>
                        <Muted size={9.5}>
                            A domain that fails leaves its records as they were at the last
                            successful sync. Answers can still be drawn from everything else,
                            which is why the brain stays available rather than going dark.
                        </Muted>
                    </div>
                </Panel>
            )}

            <Grid min={300} gap={12}>
                <Panel title="Coverage" note="entities by kind" pad={13}>
                    {(status?.byKind || []).length === 0 ? (
                        <Empty>Nothing projected yet.</Empty>
                    ) : (
                        <div style={{ display: 'grid', gap: 9 }}>
                            {status.byKind.map((k) => (
                                <div key={k.kind}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                                        <span style={{ flex: 1, fontSize: 11, color: t.text }}>{kindLabel(k.kind)}</span>
                                        <span style={{ fontSize: 11, color: t.text }}>{k.count}</span>
                                    </div>
                                    <Bar value={k.count} max={peak} />
                                </div>
                            ))}
                        </div>
                    )}
                </Panel>

                <Panel title="Totals" pad={13}>
                    <div style={{ display: 'grid', gap: 9 }}>
                        <Row t={t} label="Entities (all)" value={state.node_count ?? 0} />
                        <Row t={t} label="Entities (visible to you)" value={status?.visibleNodeCount ?? 0} />
                        <Row t={t} label="Relationships" value={state.edge_count ?? 0} />
                        <Row t={t} label="Aggregates" value={state.metric_count ?? 0} />
                        <Row t={t} label="Status" value={state.status || 'absent'} />
                        <Row t={t} label="First built" value={state.initialized_at ? fmtDate(state.initialized_at) : '—'} />
                        <Row t={t} label="Last full sync" value={state.last_full_sync_at ? fmtDate(state.last_full_sync_at) : '—'} />
                    </div>
                    <div style={{ marginTop: 11 }}>
                        <Muted size={9.5}>
                            The two entity counts differ when your role cannot see every table.
                            That is the permission model working, not a gap in the brain.
                        </Muted>
                    </div>
                </Panel>
            </Grid>

            <Panel title="Recent runs" pad={0}>
                {runs.length === 0 ? (
                    <Empty>No synchronisation has run yet.</Empty>
                ) : (
                    <Table cols={[
                        { key: 'when', label: 'Started' },
                        { key: 'mode', label: 'Mode' },
                        { key: 'status', label: 'Result' },
                        { key: 'nodes', label: 'Entities', align: 'right' },
                        { key: 'edges', label: 'Links', align: 'right' },
                        { key: 'ms', label: 'Duration', align: 'right' },
                    ]}>
                        {runs.map((r) => (
                            <Tr key={r.id}>
                                <Td nowrap>{fmtDate(r.started_at)}</Td>
                                <Td muted nowrap>{r.mode}</Td>
                                <Td nowrap>
                                    <Status tone={r.status === 'ok' ? 'up' : r.status === 'partial' ? 'neutral' : 'down'}>
                                        {r.status}
                                    </Status>
                                </Td>
                                <Td align="right">{r.nodes_upserted}{r.nodes_removed ? ` (−${r.nodes_removed})` : ''}</Td>
                                <Td align="right">{r.edges_upserted}</Td>
                                <Td align="right" muted>{r.duration_ms ? `${r.duration_ms} ms` : '—'}</Td>
                            </Tr>
                        ))}
                    </Table>
                )}
            </Panel>
        </div>
    );
}

function Row({ t, label, value }) {
    return (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: t.dim }}>{label}</span>
            <span style={{ fontSize: 12, color: t.text }}>{value}</span>
        </div>
    );
}
