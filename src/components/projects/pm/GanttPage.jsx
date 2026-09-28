import React, { useState } from 'react';
import { Toolbar, Btn, Panel, Empty, Status } from '../../ui/edge';
import { useT } from '../../ui/edgeUtils';
import { useToast } from '../../shared/Toast';
import { rescheduleWrites } from '../../../services/wbs';
import { usePmData, applyWrites, removeLink, pmError, fmtD } from './pmData';
import { LinkSheet, NodeSheet } from './pmUi';

/* Gantt Chart with the Precedence Diagramming Method. Bars are the planned
   dates; the critical path (no float) is marked; links that the plan breaks
   are listed with how far the successor has to move, and Reschedule moves
   every slipping task to the start its links allow. */

const DAY_W = 22;

export default function GanttPage({ project }) {
    const t = useT();
    const toast = useToast();
    const data = usePmData(project);
    const { tree, roll, sched, can } = data;
    const [linking, setLinking] = useState(false);
    const [sheet, setSheet] = useState(null);
    const writes = rescheduleWrites(sched);

    if (!tree.flat.length) {
        return <Panel><Empty>No tasks yet. Build the work breakdown on Tasks (WBS) first.</Empty></Panel>;
    }
    const starts = tree.flat.map((x) => roll.get(x.id).start).filter((v) => v != null);
    const ends = tree.flat.map((x) => roll.get(x.id).finish).filter((v) => v != null);
    const from = starts.length ? Math.min(...starts) - 2 : data.today;
    const to = Math.max(ends.length ? Math.max(...ends) : data.today, sched.finish) + 3;
    const days = to - from;
    const title = (id) => `${tree.code.get(id)} ${tree.byId.get(id)?.title || ''}`;

    const reschedule = async () => {
        try { await applyWrites(writes); toast(`${writes.length} task${writes.length === 1 ? '' : 's'} moved`, 'success'); }
        catch (e) { toast(pmError(e), 'error'); }
    };

    return (
        <div>
            <Toolbar right={can.edit && <Btn primary onClick={() => setLinking(true)}>Link tasks</Btn>}>
                {can.edit && writes.length > 0 && <Btn onClick={reschedule}>Reschedule {writes.length}</Btn>}
                <span style={{ fontSize: 12, color: t.faint }}>
                    Network finish {fmtD(sched.finish - 1)} · <span style={{ color: t.down }}>■</span> critical path
                    {sched.ignored ? ` · ${sched.ignored} link(s) on summary rows ignored` : ''}
                </span>
            </Toolbar>

            <div className="edge-scroll" style={{ overflowX: 'auto', border: '1px solid ' + t.line, borderRadius: 10 }}>
                <div role="table" aria-label="Gantt chart" style={{ minWidth: 300 + days * DAY_W }}>
                    {tree.flat.map((x) => {
                        const r = roll.get(x.id);
                        const n = sched.nodes.get(x.id);
                        const depth = tree.depth.get(x.id);
                        const crit = n?.critical && sched.edges.some((e) => e.from === x.id || e.to === x.id);
                        return (
                            <div role="row" key={x.id} style={{ display: 'flex', alignItems: 'center', height: 32, borderBottom: '1px solid ' + t.lineSoft }}>
                                <button role="cell" type="button" onClick={() => setSheet(x)} style={{
                                    width: 300, flexShrink: 0, padding: `0 10px 0 ${10 + depth * 14}px`, border: 'none', background: 'transparent',
                                    textAlign: 'left', color: t.text, cursor: 'pointer', fontSize: 12.5, fontWeight: r.leaf ? 400 : 600,
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'inherit',
                                }}>{title(x.id)}</button>
                                <div role="cell" style={{ position: 'relative', flex: 1, height: '100%' }}>
                                    {data.today >= from && data.today < to && (
                                        <span aria-hidden="true" style={{ position: 'absolute', left: (data.today - from) * DAY_W, top: 0, bottom: 0, width: 1, background: t.down, opacity: 0.4 }} />
                                    )}
                                    {r.start != null && (
                                        <span title={`${fmtD(r.start)} → ${fmtD(r.finish)} · ${r.progress}%`} style={{
                                            position: 'absolute', left: (r.start - from) * DAY_W, width: (r.finish - r.start + 1) * DAY_W,
                                            top: r.leaf ? 8 : 12, height: r.leaf ? 16 : 7, borderRadius: 4, overflow: 'hidden',
                                            background: t.scale[1], border: '1px solid ' + (crit ? t.down : t.lineStrong),
                                        }}>
                                            <span style={{ display: 'block', height: '100%', width: `${r.progress}%`, background: t.scale[3] }} />
                                        </span>
                                    )}
                                    {n?.slip > 0 && (
                                        <span aria-hidden="true" style={{
                                            position: 'absolute', left: (n.es - from) * DAY_W, width: n.dur * DAY_W, top: 6, height: 20,
                                            border: '1px dashed ' + t.down, borderRadius: 4,
                                        }} />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <Panel title="Links" note="Precedence Diagramming Method" style={{ marginTop: 14 }} pad={12}>
                {sched.edges.length === 0 ? <span style={{ fontSize: 12, color: t.faint }}>No links yet.</span> : (
                    <div style={{ display: 'grid', gap: 6 }}>
                        {sched.edges.map((e) => (
                            <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12.5 }}>
                                <span style={{ flex: 1, minWidth: 0 }}>{title(e.from)} → {title(e.to)}</span>
                                <span style={{ color: t.faint }}>{e.kind}{e.lag ? (e.lag > 0 ? `+${e.lag}d` : `${e.lag}d`) : ''}</span>
                                {e.violated ? <Status tone="down">{e.by}d early</Status> : <Status tone="up">Holds</Status>}
                                {can.edit && <Btn size="sm" aria-label={`Remove link ${title(e.from)} to ${title(e.to)}`}
                                    onClick={() => removeLink(e.id).catch((err) => toast(pmError(err), 'error'))}>Remove</Btn>}
                            </div>
                        ))}
                    </div>
                )}
            </Panel>

            {linking && <LinkSheet data={data} onClose={() => setLinking(false)} />}
            {sheet && <NodeSheet data={data} node={sheet} onClose={() => setSheet(null)} />}
        </div>
    );
}
