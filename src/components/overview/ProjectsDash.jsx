import React, { useEffect, useMemo, useState } from 'react';
import { FolderKanban, AlertTriangle, Flag, CalendarClock, ListChecks, IndianRupee, Star } from 'lucide-react';
import { useOrg } from '../../context/OrgContext';
import { useSection } from '../financial/financeHooks';
import { orgStore } from '../../services/orgStore';
import { getPlanConfig, hasFeature, DEFAULT_PLAN } from '../../services/planConfig';
import { PROJECT_STATUSES, isClosed, projectProgress, statusLabel } from '../../services/projectAnalytics';
import { portfolio, canSeeFinancials, isOwnerOrAdmin } from '../../services/projectService';
import { needsAttention } from '../../services/importantTasks';
import { fmtShort, fmtInr, fmtDay, addDays } from './overviewModel';
import { RankBars, SplitBar, EmptyNote, TipBody } from './vizKit';
import { Dashboard, Card, Tile, More, TileRow, CardGrid, ListRow } from './dashKit';
import { projectSectionPath } from '../projects/projectPaths';

/* ══════════════════════════════════════════════════════════════════════════
   Dashboard · Projects: what is being delivered, what is late, and whether
   it pays.

   A snapshot: projects, milestones and tasks carry no history to replay.
   Status, progress and dates come from the org's own rows. Health and margin
   come from project_portfolio() (0053) and follow the plan exactly as the
   Portfolio page does: Pro and Max see health, and margins additionally
   need Project financials.

   Needs attention is the tasks an owner or admin has marked important
   (0077) on the open projects, until each is done, late first. The
   projects whose health is at risk or off track follow under it.
   ══════════════════════════════════════════════════════════════════════════ */

const DONE_MS = new Set(['completed', 'invoiced', 'cancelled']);

export default function ProjectsDash() {
    return <Dashboard periodic={false} snapshotNote="Projects today: delivery has no period to filter">{(ctx) => <ProjectsBody {...ctx} />}</Dashboard>;
}

function ProjectsBody({ model, navigate, t, cat, status, cols, grid, tileCols, today }) {
    const { activeOrg } = useOrg();
    const projects = useSection('projects');
    const milestones = useSection('project_milestones');
    const clients = useSection('customers');
    const tasks = model.raw.tasks;
    const liveTasks = useSection('tasks');
    const employees = useSection('employees');
    const planId = activeOrg?.plan || orgStore.getProfile().plan || DEFAULT_PLAN;
    const plan = getPlanConfig(planId);
    const withHealth = hasFeature(planId, 'projectPortfolio');
    const fin = canSeeFinancials();

    const [fetched, setFetched] = useState(undefined);
    useEffect(() => {
        if (!withHealth) return undefined;
        let alive = true;
        portfolio().then((r) => { if (alive) setFetched(r); }).catch(() => { if (alive) setFetched(null); });
        return () => { alive = false; };
    }, [withHealth]);
    // undefined loading · null unavailable (or not on this plan)
    const rows = withHealth ? fetched : null;
    const byId = useMemo(() => Object.fromEntries((rows || []).map((r) => [r.project_id, r])), [rows]);

    const clientName = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c.name || c.clientName])), [clients]);
    const live = projects.filter((p) => !p.archived_at);
    const openP = live.filter((p) => !isClosed(p));
    const openIds = new Set(openP.map((p) => p.id));

    const openMs = milestones.filter((m) => openIds.has(m.project_id) && m.due_date && !DONE_MS.has(m.status));
    const lateMs = openMs.filter((m) => m.due_date < today).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const soonMs = openMs.filter((m) => m.due_date >= today && m.due_date <= addDays(today, 14)).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const projTasks = tasks.filter((x) => x.projectId && openIds.has(x.projectId));
    const openTasks = projTasks.filter((x) => x.status !== 'done');
    const lateTasks = openTasks.filter((x) => x.deadline && String(x.deadline).slice(0, 10) < today);
    const attention = needsAttention(liveTasks, today, openIds);
    const attentionLate = attention.filter((a) => a.late).length;
    const personOf = Object.fromEntries(employees.map((e) => [e.id, e.name]));

    const nameOf = Object.fromEntries(projects.map((p) => [p.id, [p.code, p.name].filter(Boolean).join(' · ')]));
    const progressOf = (p) => projectProgress(milestones.filter((m) => m.project_id === p.id), tasks.filter((x) => x.projectId === p.id));

    const health = rows ? ['on_track', 'at_risk', 'off_track'].map((h) => ({
        id: h, label: h === 'on_track' ? 'On track' : h === 'at_risk' ? 'At risk' : 'Off track',
        value: openP.filter((p) => byId[p.id]?.health === h).length,
        color: h === 'on_track' ? status.good : h === 'at_risk' ? status.warning : status.critical,
    })) : null;
    const risky = health ? health[1].value + health[2].value : null;
    const contract = openP.reduce((s, p) => s + (Number(p.contract_value) || 0), 0);
    const limit = plan.limits.activeProjects;
    const statusColor = { planned: t.faint, active: cat[0], on_hold: status.warning, completed: status.good, cancelled: t.ghost };

    const margins = fin && rows ? live.map((p) => byId[p.id]).filter((r) => r && r.has_financials !== false && r.net_margin != null)
        .map((r) => ({ key: r.project_id, name: nameOf[r.project_id] || r.name, value: Number(r.net_margin) || 0, pct: r.net_margin_pct == null ? null : Number(r.net_margin_pct) }))
        .sort((a, b) => b.value - a.value) : null;

    const taskLoad = openP.map((p) => {
        const mine = openTasks.filter((x) => x.projectId === p.id);
        return { key: p.id, name: nameOf[p.id], value: mine.length, late: mine.filter((x) => x.deadline && String(x.deadline).slice(0, 10) < today).length };
    }).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);

    return (<>
        <TileRow cols={tileCols(6)}>
            <Tile icon={FolderKanban} label="Open projects" value={String(openP.length)} exact={`${openP.length} open`}
                tone={Number.isFinite(limit) && openP.length >= limit ? 'down' : null}
                onClick={() => navigate('/projects')} />
            <Tile icon={AlertTriangle} label="Need attention" value={String(attention.length)}
                exact={`${attention.length} important task${attention.length === 1 ? '' : 's'} open`}
                foot={attentionLate ? `${attentionLate} late` : risky ? `${risky} project${risky === 1 ? '' : 's'} at risk` : 'important tasks'}
                tone={attentionLate || risky ? 'down' : null}
                onClick={() => document.getElementById('needs-attention')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
            <Tile icon={Flag} label="Late milestones" value={String(lateMs.length)} exact={`${lateMs.length} late`} tone={lateMs.length ? 'down' : null}
                onClick={() => navigate('/projects')} />
            <Tile icon={CalendarClock} label="Due in 14 days" value={String(soonMs.length)} exact={`${soonMs.length} milestones`}
                onClick={() => navigate('/projects')} />
            <Tile icon={ListChecks} label="Project tasks" value={String(openTasks.length)} exact={`${openTasks.length} open`}
                tone={lateTasks.length ? 'down' : null}
                onClick={() => navigate('/tasks')} />
            <Tile icon={IndianRupee} label="Open contract value" value={fmtShort(contract)} exact={fmtInr(contract)}
                onClick={() => navigate('/portfolio')} />
        </TileRow>

        <CardGrid cols={cols}>
            <div id="needs-attention" style={{ ...grid(cols), scrollMarginTop: 12, minWidth: 0, display: 'flex' }}>
                <Card style={{ flex: 1 }} title="Needs attention"
                    note="tasks marked important, until they are done · late first">
                    {attention.length === 0 ? (
                        <EmptyNote>{isOwnerOrAdmin()
                            ? 'Nothing marked important. Star a task on a project’s Tasks (WBS) or in its task sheet to list it here.'
                            : 'Nothing marked important. An owner or admin chooses what goes here.'}</EmptyNote>
                    ) : attention.slice(0, 12).map(({ task, late, due }) => (
                        <ListRow key={task.id}
                            label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
                                <Star size={12} fill="currentColor" aria-hidden="true" style={{ color: t.down, flexShrink: 0 }} />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</span>
                            </span>}
                            sub={[nameOf[task.projectId], personOf[task.assignedTo] || 'Unassigned', task.status === 'in-progress' ? 'in progress' : null].filter(Boolean).join(' · ')}
                            value={due ? `${late ? 'late · ' : ''}${fmtDay(due).slice(0, 6)}` : 'no date'} tone={late ? 'down' : null}
                            onClick={() => navigate(projectSectionPath(task.projectId, 'wbs', null, { task: task.id }))} />
                    ))}
                    {attention.length > 12 && (
                        <div style={{ fontSize: 11.5, color: t.faint, marginTop: 8 }}>and {attention.length - 12} more</div>
                    )}
                    {risky > 0 && (
                        <ListRow label={`${risky} project${risky === 1 ? '' : 's'} at risk or off track`} sub="project health"
                            tone="down" value="Portfolio" onClick={() => navigate('/portfolio')} />
                    )}
                </Card>
            </div>

            <Card title="By status" note="every project not archived" right={<More label="Projects" to="/projects" />}>
                {live.length === 0 ? <EmptyNote>No projects yet</EmptyNote> : (
                    <SplitBar format={(v) => String(v)} unit="Projects" parts={PROJECT_STATUSES.map((s) => ({
                        id: s.id, label: s.label, value: live.filter((p) => p.status === s.id).length, color: statusColor[s.id],
                    }))} onSelect={() => navigate('/projects')} />
                )}
            </Card>

            <Card title="Progress" note="open projects · milestones, or tasks where there are none">
                <RankBars rows={openP.map((p) => {
                    const pr = progressOf(p);
                    const r = byId[p.id];
                    return {
                        key: p.id, name: nameOf[p.id], value: pr === null ? 0 : Math.round(pr * 100), none: pr === null,
                        tip: <TipBody title={nameOf[p.id]} rows={[
                            { label: 'Status', value: statusLabel(p.status) },
                            { label: 'Client', value: p.client_id ? clientName[p.client_id] || 'Client' : 'Internal' },
                            { label: 'Progress', value: pr === null ? 'no plan yet' : `${Math.round(pr * 100)}%` },
                            ...(p.target_end_date ? [{ label: 'Target end', value: fmtDay(p.target_end_date) }] : []),
                            ...(r?.health ? [{ label: 'Health', value: r.health.replace('_', ' ') }] : []),
                        ]} />,
                    };
                }).sort((a, b) => b.value - a.value)} format={(v) => `${v}%`} total={0} max={7} color={cat[2]}
                    sub={(r) => (r.none ? 'no plan' : '')}
                    onSelect={(r) => navigate(`/projects/${r.key}`)} empty="No open projects" />
            </Card>

            <Card title="Milestones" note="late, then due in the next 14 days">
                {lateMs.length + soonMs.length === 0 ? <EmptyNote>Nothing late or due soon</EmptyNote>
                    : [...lateMs.map((m) => ({ m, late: true })), ...soonMs.map((m) => ({ m, late: false }))].slice(0, 8).map(({ m, late }) => (
                        <ListRow key={m.id} label={m.title} sub={nameOf[m.project_id]}
                            value={late ? `late · ${fmtDay(m.due_date).slice(0, 6)}` : fmtDay(m.due_date).slice(0, 6)} tone={late ? 'down' : null}
                            onClick={() => navigate(`/projects/${m.project_id}`)} />
                    ))}
            </Card>

            <Card title="Open work by project" note="open tasks · today" right={<More label="Tasks" to="/tasks" />}>
                <RankBars rows={taskLoad} format={(v) => String(v)} max={6} color={cat[0]}
                    sub={(r) => (r.late ? <span style={{ color: t.down }}>{r.late} late</span> : '')}
                    onSelect={(r) => navigate(`/projects/${r.key}`)} empty="No open tasks on projects" />
            </Card>

            <Card style={grid(margins ? 2 : 1)} title="Margin by project" note="net margin to date · revenue less direct and labour cost" right={withHealth ? <More label="Portfolio" to="/portfolio" /> : null}>
                {!withHealth ? null
                    : !fin ? <EmptyNote>Margins need the Project financials permission.</EmptyNote>
                        : rows === undefined ? <EmptyNote>Loading…</EmptyNote>
                            : !margins?.length ? <EmptyNote>No project has money booked against it yet</EmptyNote>
                                : <RankBars rows={margins.map((m) => ({ ...m, color: m.value < 0 ? status.critical : status.good }))} format={fmtShort} total={0} max={8}
                                    sub={(r) => (r.pct == null ? '' : `${r.pct.toFixed(0)}%`)} onSelect={(r) => navigate(`/projects/${r.key}`)} />}
            </Card>
        </CardGrid>
    </>);
}
