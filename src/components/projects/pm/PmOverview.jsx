import React from 'react';
import { Panel, Row, Btn, Avatar, Empty, StatBand, Grid } from '../../ui/edge';
import { useT } from '../../ui/edgeUtils';
import { toDay } from '../../../services/wbs';
import { usePmData, empName, fmtD, fmtDY } from './pmData';
import { Progress } from './pmUi';

/* Portfolio — the project's work breakdown at a glance: how far
   along it is, whether the network finishes by the target date, and each
   sub-project with the person who answers for it. */

export default function PmOverview({ project, onOpen }) {
    const t = useT();
    const data = usePmData(project);
    const { tree, roll, total, sched } = data;

    if (!tree.flat.length) {
        return (
            <Panel>
                <Empty action={<Btn primary onClick={() => onOpen('wbs')}>Build the work breakdown</Btn>}>
                    No work breakdown yet. Add sub-projects, tasks and the people responsible on Tasks (WBS).
                </Empty>
            </Panel>
        );
    }

    const target = toDay(project.target_end_date);
    const forecast = sched.order.length ? sched.finish - 1 : total.finish;
    const late = target != null && forecast != null ? forecast - target : null;
    const broken = sched.edges.filter((e) => e.violated).length;

    return (
        <div style={{ display: 'grid', gap: 14 }}>
            <StatBand items={[
                { label: 'Complete', value: `${total.progress}%`, note: `${total.done} of ${total.leaves} work items done` },
                { label: 'Overdue', value: total.overdue, tone: total.overdue ? 'down' : undefined, note: 'work items past their finish' },
                { label: 'Forecast finish', value: fmtDY(forecast), tone: late > 0 ? 'down' : undefined,
                    note: late == null ? 'no target end date' : late > 0 ? `${late}d after target` : 'on or before target' },
                { label: 'Critical path', value: sched.critical.length, note: broken ? `${broken} link${broken === 1 ? '' : 's'} broken` : 'tasks with no float' },
            ]} />

            <Panel title="Sub-projects" note="each with the person responsible"
                actions={<Btn size="sm" onClick={() => onOpen('wbs')}>Open WBS</Btn>} pad={12}>
                <Grid min={240}>
                    {tree.roots.map((x) => {
                        const r = roll.get(x.id);
                        const person = data.empById.get(x.assignedTo);
                        return (
                            <div key={x.id} style={{ border: '1px solid ' + t.line, borderRadius: 9, padding: 12 }}>
                                <div style={{ fontSize: 11, color: t.faint }}>{tree.code.get(x.id)}</div>
                                <div style={{ fontSize: 13.5, color: t.text, margin: '2px 0 8px' }}>{x.title}</div>
                                <Row gap={6} style={{ marginBottom: 8 }}>
                                    <Avatar name={empName(person) || '?'} size={18} />
                                    <span style={{ fontSize: 12, color: t.dim }}>{empName(person) || 'Unassigned'}</span>
                                </Row>
                                <Progress value={r.progress} width={120} tone={r.overdue ? t.down : undefined} />
                                <div style={{ fontSize: 11.5, color: t.faint, marginTop: 6 }}>
                                    {fmtD(r.start)} → {fmtD(r.finish)} · {r.done}/{r.leaves} done
                                    {r.overdue ? <span style={{ color: t.down }}> · {r.overdue} late</span> : ''}
                                </div>
                            </div>
                        );
                    })}
                </Grid>
            </Panel>
        </div>
    );
}
