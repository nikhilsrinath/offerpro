import React, { useLayoutEffect, useMemo, useState } from 'react';
import { Toolbar, Btn, Panel, Empty, Status } from '../../ui/edge';
import { useT } from '../../ui/edgeUtils';
import { useToast } from '../../shared/Toast';
import { rescheduleWrites, toDay, ganttWindow, ganttScale, ganttTicks } from '../../../services/wbs';
import { usePmData, applyWrites, removeLink, pmError, fmtD, fmtDY } from './pmData';
import { LinkSheet, NodeSheet } from './pmUi';

/* Gantt Chart with the Precedence Diagramming Method. Bars are the planned
   dates; the critical path (no float) is marked; links that the plan breaks
   are listed with how far the successor has to move, and Reschedule moves
   every slipping task to the start its links allow.

   The time axis is built from the tasks' own dates (ganttWindow) and ticks
   in days, weeks, months or quarters to suit the span (ganttScale). The task
   column stays put while the timeline scrolls under the axis. A task with
   no dates keeps its row and says so — no bar is drawn for it. */

const NAME_W = 300;
const ROW_H = 32;
const AXIS_ROW = 22;

/** The scroll box's inner width, so a short plan fills it instead of
    leaving a strip of chart on the left. */
function useWidth() {
    // A callback ref: the box only mounts once the project has tasks.
    const [el, setEl] = useState(null);
    const [w, setW] = useState(0);
    useLayoutEffect(() => {
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        // Observing reports the first size too.
        const ro = new ResizeObserver(() => setW(el.clientWidth));
        ro.observe(el);
        return () => ro.disconnect();
    }, [el]);
    return [setEl, w];
}

export default function GanttPage({ project }) {
    const t = useT();
    const toast = useToast();
    const data = usePmData(project);
    const { tree, roll, sched, can } = data;
    const [linking, setLinking] = useState(false);
    const [sheet, setSheet] = useState(null);
    const [boxRef, boxW] = useWidth();
    const writes = rescheduleWrites(sched);

    // The window comes from the dates the tasks carry (a summary row's are
    // its children's, from rollups) plus where a slipping task has to move.
    const axis = useMemo(() => {
        const spans = tree.flat.map((x) => [roll.get(x.id).start, roll.get(x.id).finish]);
        sched.nodes.forEach((n) => { if (n.slip > 0) spans.push([n.es, n.es + n.dur - 1]); });
        const ps = toDay(project.start_date);
        const pe = toDay(project.target_end_date);
        const fallback = ps != null && pe != null && pe >= ps ? [ps, pe] : [data.today, data.today + 13];
        const win = ganttWindow(spans, fallback);
        const scale = ganttScale(win, Math.max(0, boxW - NAME_W));
        return { ...scale, empty: win.empty, ...ganttTicks(scale.from, scale.to, scale.unit) };
    }, [tree, roll, sched, project.start_date, project.target_end_date, data.today, boxW]);

    if (!tree.flat.length) {
        return <Panel><Empty>No tasks yet. Build the work breakdown on Tasks (WBS) first.</Empty></Panel>;
    }
    const { from, to, dayW, minor, major } = axis;
    const x = (day) => (day - from) * dayW;
    const width = NAME_W + (to - from) * dayW;
    const title = (id) => `${tree.code.get(id)} ${tree.byId.get(id)?.title || ''}`;
    const undated = tree.flat.filter((n) => roll.get(n.id).start == null).length;
    const sticky = { position: 'sticky', left: 0, zIndex: 2, background: t.panel, borderRight: '1px solid ' + t.line };
    const label = { position: 'absolute', fontSize: 11, color: t.faint, whiteSpace: 'nowrap', paddingLeft: 5, lineHeight: AXIS_ROW + 'px' };

    const reschedule = async () => {
        try { await applyWrites(writes); toast(`${writes.length} task${writes.length === 1 ? '' : 's'} moved`, 'success'); }
        catch (e) { toast(pmError(e), 'error'); }
    };

    return (
        <div>
            <Toolbar right={can.edit && <Btn primary onClick={() => setLinking(true)}>Link tasks</Btn>}>
                {can.edit && writes.length > 0 && <Btn onClick={reschedule}>Reschedule {writes.length}</Btn>}
                <span style={{ fontSize: 12, color: t.faint }}>
                    {axis.empty
                        ? 'No task has dates yet — set Start and Finish on a task to place it on the timeline'
                        : <>Network finish {fmtD(sched.finish - 1)} · <span style={{ color: t.down }}>■</span> critical path</>}
                    {!axis.empty && undated ? ` · ${undated} without dates` : ''}
                    {sched.ignored ? ` · ${sched.ignored} link(s) on summary rows ignored` : ''}
                </span>
            </Toolbar>

            <div ref={boxRef} className="edge-scroll" style={{ overflowX: 'auto', border: '1px solid ' + t.line, borderRadius: 10, background: t.panel }}>
                <div role="table" aria-label="Gantt chart" style={{ position: 'relative', width }}>
                    {/* Grid: one faint line per tick, from the axis down through every row. */}
                    <div aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: NAME_W, right: 0, pointerEvents: 'none' }}>
                        {minor.map((k) => (
                            <span key={k.day} style={{ position: 'absolute', left: x(k.day), top: AXIS_ROW, bottom: 0, width: 1, background: t.lineSoft }} />
                        ))}
                        {major.slice(1).map((k) => (
                            <span key={k.day} style={{ position: 'absolute', left: x(k.day), top: 0, bottom: 0, width: 1, background: t.line }} />
                        ))}
                        {data.today >= from && data.today < to && (
                            <span style={{ position: 'absolute', left: x(data.today) + dayW / 2, top: AXIS_ROW * 2, bottom: 0, width: 1, background: t.down, opacity: 0.4 }} />
                        )}
                    </div>

                    <div role="row" style={{ display: 'flex', height: AXIS_ROW * 2, borderBottom: '1px solid ' + t.line }}>
                        <div role="columnheader" style={{
                            ...sticky, width: NAME_W, flexShrink: 0, padding: '0 10px 5px', display: 'flex', alignItems: 'flex-end', fontSize: 11, color: t.faint,
                        }}>Task</div>
                        <div role="columnheader" aria-label={`Timeline ${fmtDY(from)} to ${fmtDY(to - 1)}`} style={{ position: 'relative', flex: 1 }}>
                            {major.map((k, i) => ((major[i + 1]?.day ?? to) - k.day) * dayW >= 56 && (
                                <span key={k.day} style={{ ...label, left: x(k.day), top: 0, color: t.dim }}>{k.label}</span>
                            ))}
                            <span aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: AXIS_ROW, height: 1, background: t.lineSoft }} />
                            {minor.map((k, i) => ((minor[i + 1]?.day ?? to) - k.day) * dayW >= 18 && (
                                <span key={k.day} style={{ ...label, left: x(k.day), top: AXIS_ROW }}>{k.label}</span>
                            ))}
                        </div>
                    </div>

                    {tree.flat.map((node) => {
                        const r = roll.get(node.id);
                        const n = sched.nodes.get(node.id);
                        const depth = tree.depth.get(node.id);
                        const crit = n?.critical && sched.edges.some((e) => e.from === node.id || e.to === node.id);
                        return (
                            <div role="row" key={node.id} style={{ display: 'flex', alignItems: 'center', height: ROW_H, borderBottom: '1px solid ' + t.lineSoft }}>
                                <button role="cell" type="button" onClick={() => setSheet(node)} style={{
                                    ...sticky, width: NAME_W, height: '100%', flexShrink: 0, padding: `0 10px 0 ${10 + depth * 14}px`, border: 'none',
                                    borderRight: '1px solid ' + t.line, textAlign: 'left', color: t.text, cursor: 'pointer', fontSize: 12.5,
                                    fontWeight: r.leaf ? 400 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'inherit',
                                }}>{title(node.id)}</button>
                                <div role="cell" style={{ position: 'relative', flex: 1, height: '100%' }}>
                                    {r.start != null ? (
                                        <span title={`${fmtD(r.start)} → ${fmtD(r.finish)} · ${r.finish - r.start + 1}d · ${r.progress}%`} style={{
                                            position: 'absolute', left: x(r.start), width: Math.max(3, (r.finish - r.start + 1) * dayW),
                                            top: r.leaf ? 8 : 12, height: r.leaf ? 16 : 7, borderRadius: 4, overflow: 'hidden',
                                            background: t.scale[1], border: '1px solid ' + (crit ? t.down : t.lineStrong),
                                        }}>
                                            <span style={{ display: 'block', height: '100%', width: `${r.progress}%`, background: t.scale[3] }} />
                                        </span>
                                    ) : (
                                        <span style={{ position: 'sticky', left: NAME_W + 10, display: 'inline-block', lineHeight: ROW_H + 'px', fontSize: 11.5, color: t.ghost }}>
                                            No dates
                                        </span>
                                    )}
                                    {n?.slip > 0 && (
                                        <span aria-hidden="true" style={{
                                            position: 'absolute', left: x(n.es), width: n.dur * dayW, top: 6, height: 20,
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
