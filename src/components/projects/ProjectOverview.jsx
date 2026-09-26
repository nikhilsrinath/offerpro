import React, { useEffect, useMemo, useState } from 'react';
import { Panel, Grid, Row, Avatar, Muted, StatBand, Status, Btn, Empty } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { TipProvider, RankBars, EmptyNote } from '../overview/vizKit';
import { useSection, money, fmtDate } from '../financial/financeHooks';
import { burnVsTime, memberActive, milestoneProgress } from '../../services/projectAnalytics';
import { financials, canSeeFinancials, activity } from '../../services/projectService';
import AllocationBar from './AllocationBar';
import { describeActivity } from './activityText';

/* The project at a glance: its numbers (for those who may see them), how the
   budget is burning against the calendar, what is due next, who is on it. */

const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function ProjectOverview({ project, onTab }) {
    const t = useT();
    const fin = canSeeFinancials();
    const members = useSection('project_members');
    const milestones = useSection('project_milestones');
    const tasks = useSection('tasks');
    const employees = useSection('employees');
    const [f, setF] = useState(null);
    const [recent, setRecent] = useState([]);
    const today = todayIso();

    useEffect(() => {
        let cancelled = false;
        if (fin) financials(project.id).then((r) => { if (!cancelled) setF(r); }).catch(() => {});
        activity(project.id, 12).then((r) => {
            if (!cancelled) setRecent(r.filter((a) => describeActivity(a)).slice(0, 6));
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [fin, project.id, project.updated_at]);

    const team = useMemo(() => members
        .filter((m) => m.project_id === project.id && memberActive(m, today)), [members, project.id, today]);
    const own = useMemo(() => milestones
        .filter((m) => m.project_id === project.id && m.status !== 'cancelled')
        .sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'))), [milestones, project.id]);
    const next = own.filter((m) => m.status === 'pending' || m.status === 'in_progress').slice(0, 4);
    const projectTasks = tasks.filter((x) => x.projectId === project.id);
    const openTasks = projectTasks.filter((x) => x.status !== 'done').length;
    const empName = (id) => employees.find((e) => e.id === id)?.name || 'Former employee';

    const burn = burnVsTime(project, f?.budget_burn_pct ?? null, today);

    return (
        <div style={{ display: 'grid', gap: 14 }}>
            {fin && f && (
                <StatBand items={[
                    { label: 'Contract', value: money(f.contract_value) },
                    { label: 'Billed', value: f.billed_pct == null ? '—' : `${f.billed_pct}%`, note: money(f.billed_to_date) },
                    { label: 'Collected', value: money(f.revenue_collected), note: 'Net of GST' },
                    { label: 'Cost to date', value: money(f.cost_to_date), note: 'Direct costs and labour' },
                    {
                        label: 'Net margin', value: money(f.net_margin),
                        note: f.net_margin_pct == null ? 'Nothing invoiced yet' : `${f.net_margin_pct}% of revenue`,
                        tone: Number(f.net_margin) < 0 ? 'down' : undefined,
                    },
                ]} />
            )}

            <Grid min={300} gap={14}>
                <Panel title="Budget burn against time" pad={15}
                    note={burn.gap != null && burn.gap > 10 ? 'Spending ahead of schedule' : undefined}>
                    {!fin ? (
                        <EmptyNote>Budget burn is visible to people with Project financials.</EmptyNote>
                    ) : burn.timePct == null && burn.burnPct == null ? (
                        <EmptyNote>Set a start, a target end and a budget to see this.</EmptyNote>
                    ) : (
                        <TipProvider>
                            <RankBars max={2} format={(v) => `${Math.round(v)}%`} total={0} rows={[
                                { key: 'time', name: 'Time elapsed', value: burn.timePct ?? 0 },
                                {
                                    key: 'burn', name: 'Budget used', value: burn.burnPct ?? 0,
                                    color: burn.gap != null && burn.gap > 10 ? t.down : undefined,
                                },
                            ]} />
                        </TipProvider>
                    )}
                </Panel>

                <Panel title="Next milestones" pad={15}
                    actions={<Btn size="sm" onClick={() => onTab('tasks')}>{openTasks} open task{openTasks === 1 ? '' : 's'}</Btn>}>
                    {next.length === 0 ? <EmptyNote>Nothing due.</EmptyNote> : (
                        <div style={{ display: 'grid', gap: 10 }}>
                            {next.map((m) => {
                                const late = m.due_date && m.due_date < today;
                                return (
                                    <div key={m.id}>
                                        <Row gap={8}>
                                            <span style={{ flex: 1, fontSize: 11.5 }}>{m.title}</span>
                                            <Status tone={late ? 'down' : 'mute'}>{m.due_date ? fmtDate(m.due_date) : 'No date'}</Status>
                                        </Row>
                                        <Muted>{Math.round(milestoneProgress(m, projectTasks) * 100)}% done</Muted>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </Panel>

                <Panel title="Team" pad={15} actions={<Btn size="sm" onClick={() => onTab('team')}>Manage</Btn>}>
                    {team.length === 0 ? <Empty>No one is on this project yet.</Empty> : (
                        <div style={{ display: 'grid', gap: 9 }}>
                            {team.map((m) => (
                                <Row key={m.id} gap={9}>
                                    <Avatar name={empName(m.employee_id)} size={22} />
                                    <span style={{ flex: 1, fontSize: 11.5, minWidth: 0 }}>{empName(m.employee_id)}
                                        <span style={{ color: t.faint, fontSize: 10 }}> · {m.role}</span></span>
                                    <AllocationBar pct={m.allocation_pct} width={60} />
                                </Row>
                            ))}
                        </div>
                    )}
                </Panel>

                <Panel title="Recent activity" pad={15} actions={<Btn size="sm" onClick={() => onTab('activity')}>All</Btn>}>
                    {recent.length === 0 ? <EmptyNote>Nothing yet.</EmptyNote> : (
                        <div style={{ display: 'grid', gap: 8 }}>
                            {recent.map((a) => (
                                <div key={a.id} style={{ fontSize: 11, color: t.dim, lineHeight: 1.5 }}>
                                    {describeActivity(a)}
                                    <span style={{ display: 'block', fontSize: 9.5, color: t.ghost }}>{new Date(a.created_at).toLocaleString('en-IN')}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </Panel>
            </Grid>
        </div>
    );
}
