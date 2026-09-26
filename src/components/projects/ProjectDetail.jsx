import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    Page, Toolbar, Panel, Row, Btn, Seg, Status, Avatar, Empty, Modal, Field, Textarea, Select, Muted,
} from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useSection } from '../financial/financeHooks';
import { useToast } from '../shared/Toast';
import { PROJECT_STATUSES, statusLabel, isClosed } from '../../services/projectAnalytics';
import {
    closeProject, updateProject, reopenProject, archiveProject, unarchiveProject, duplicateProject,
    canEditProjects, canSeeFinancials, isOwnerOrAdmin, health as fetchHealth,
} from '../../services/projectService';
import HealthChip from './HealthChip';
import ProjectMilestones from './ProjectMilestones';
import ProjectForm from './ProjectForm';
import ProjectOverview from './ProjectOverview';
import ProjectFinance from './ProjectFinance';
import ProjectTeam from './ProjectTeam';
import ProjectDocuments from './ProjectDocuments';
import ProjectActivity from './ProjectActivity';
import TasksPage from '../tasks/TasksPage';

/* ══════════════════════════════════════════════════════════════════════════
   One project. The header says what it is and lets the right people move it
   along; the tabs are its money, people, work and paper.
   ══════════════════════════════════════════════════════════════════════════ */

const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'finance', label: 'Finance', fin: true },
    { id: 'team', label: 'Team' },
    { id: 'milestones', label: 'Milestones' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'documents', label: 'Documents' },
    { id: 'activity', label: 'Activity' },
];

const STATUS_TONE = { active: 'up', on_hold: 'neutral', planned: 'mute', completed: 'mute', cancelled: 'mute' };

export default function ProjectDetail() {
    const t = useT();
    const toast = useToast();
    const navigate = useNavigate();
    const location = useLocation();
    const { projectId } = useParams();
    const [params, setParams] = useSearchParams();
    const projects = useSection('projects');
    const clients = useSection('customers');
    const employees = useSection('employees');
    const project = projects.find((p) => p.id === projectId);

    const [editing, setEditing] = useState(false);
    const [closing, setClosing] = useState(null);   // 'completed' | 'cancelled'
    const [reopening, setReopening] = useState(false);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [health, setHealth] = useState(null);

    useEffect(() => {
        let cancelled = false;
        if (projectId) fetchHealth(projectId).then((h) => { if (!cancelled) setHealth(h); }).catch(() => {});
        return () => { cancelled = true; };
    }, [projectId, project?.updated_at, project?.status]);

    const fin = canSeeFinancials();
    const tabs = TABS.filter((x) => !x.fin || fin);
    const tab = tabs.some((x) => x.id === params.get('tab')) ? params.get('tab') : 'overview';
    const setTab = (id) => {
        const next = new URLSearchParams(params);
        next.set('tab', id);
        setParams(next, { replace: true });
    };

    if (!project) {
        return (
            <Page>
                <Panel>
                    <Empty action={<Btn onClick={() => navigate('/projects')}>All projects</Btn>}>
                        This project does not exist, or you do not have access to it.
                    </Empty>
                </Panel>
            </Page>
        );
    }

    const client = clients.find((c) => c.id === project.client_id);
    const manager = employees.find((e) => e.id === project.manager_employee_id);
    const closed = isClosed(project);
    const editable = canEditProjects();

    const act = async (fn, done) => {
        setBusy(true);
        try { await fn(); if (done) toast(done, 'success'); }
        catch (e) { toast(e.message, 'error'); }
        finally { setBusy(false); }
    };

    const changeStatus = (next) => {
        if (next === project.status) return;
        if (next === 'completed' || next === 'cancelled') { setClosing(next); return; }
        act(() => updateProject(project.id, { status: next }), `Marked ${statusLabel(next).toLowerCase()}`);
    };

    const problems = location.state?.problems;

    return (
        <Page>
            <Toolbar right={
                <Row gap={6}>
                    {editable && !closed && <Btn size="sm" onClick={() => setEditing(true)}>Edit</Btn>}
                    {editable && (
                        <Btn size="sm" disabled={busy} onClick={() => act(async () => {
                            const { project: copy } = await duplicateProject(project.id);
                            navigate(`/projects/${copy.id}`);
                        }, 'Duplicated')}>Duplicate</Btn>
                    )}
                    {editable && (project.archived_at
                        ? <Btn size="sm" disabled={busy} onClick={() => act(() => unarchiveProject(project.id), 'Restored')}>Unarchive</Btn>
                        : <Btn size="sm" disabled={busy} onClick={() => act(() => archiveProject(project.id), 'Archived')}>Archive</Btn>)}
                </Row>
            }>
                <div style={{ minWidth: 0 }}>
                    <Row gap={10} wrap>
                        <span style={{ fontSize: 10, color: t.faint, letterSpacing: '0.04em' }}>{project.code}</span>
                        <span style={{ fontSize: 15, color: t.text }}>{project.name}</span>
                        <Status tone={STATUS_TONE[project.status]}>{statusLabel(project.status)}</Status>
                        {!closed && health && <HealthChip health={health.health} reasons={health.reasons} />}
                        {project.archived_at && <Muted>Archived</Muted>}
                    </Row>
                    <Row gap={12} wrap style={{ marginTop: 5 }}>
                        <Muted>
                            {client
                                ? <>Client: <Link to={`/customers?client=${client.id}`} style={{ color: t.dim }}>{client.name || client.clientName}</Link></>
                                : 'Internal project'}
                        </Muted>
                        {manager && (
                            <Row gap={6}><Avatar name={manager.name || ''} size={18} /><Muted>{manager.name}</Muted></Row>
                        )}
                    </Row>
                </div>
            </Toolbar>

            {problems?.length > 0 && (
                <div role="alert" style={{ marginBottom: 12, fontSize: 11, color: t.down }}>
                    The project was created, but part of it did not save: {problems.join(' · ')}
                </div>
            )}

            <Row gap={10} wrap style={{ marginBottom: 14 }}>
                <Seg value={tab} onChange={setTab} label="Project sections" options={tabs} />
                <div style={{ flex: 1 }} />
                {editable && !closed && (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: t.faint }}>
                        Status
                        <Select aria-label="Project status" value={project.status} disabled={busy}
                            onChange={(e) => changeStatus(e.target.value)} style={{ width: 140, height: 29 }}>
                            {PROJECT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </Select>
                    </label>
                )}
                {closed && isOwnerOrAdmin() && (
                    <Btn size="sm" onClick={() => { setReason(''); setReopening(true); }}>Reopen</Btn>
                )}
            </Row>

            {tab === 'overview' && <ProjectOverview project={project} onTab={setTab} />}
            {tab === 'finance' && fin && <ProjectFinance project={project} />}
            {tab === 'team' && <ProjectTeam project={project} />}
            {tab === 'milestones' && <ProjectMilestones project={project} />}
            {tab === 'tasks' && <TasksPage projectId={project.id} embedded />}
            {tab === 'documents' && <ProjectDocuments project={project} />}
            {tab === 'activity' && <ProjectActivity project={project} />}

            <Modal open={editing} onClose={() => setEditing(false)} title={`Edit ${project.code}`} width={760}>
                {editing && <ProjectForm project={project} onDone={() => setEditing(false)} />}
            </Modal>

            <Modal open={!!closing} onClose={() => setClosing(null)}
                title={closing === 'cancelled' ? 'Cancel this project?' : 'Mark this project complete?'}
                note="Its team, milestones and money links lock until an owner or admin reopens it"
                footer={<>
                    <Btn onClick={() => setClosing(null)}>Not now</Btn>
                    <Btn primary disabled={busy} onClick={() => act(async () => {
                        await closeProject(project.id, closing);
                        setClosing(null);
                    }, closing === 'cancelled' ? 'Project cancelled' : 'Project completed')}>
                        {closing === 'cancelled' ? 'Cancel project' : 'Mark complete'}
                    </Btn>
                </>}>
                <p style={{ margin: 0, fontSize: 11.5, color: t.dim, lineHeight: 1.7 }}>
                    The end date is recorded as today unless one is already set. Invoices can still be
                    linked to its milestones afterwards.
                </p>
            </Modal>

            <Modal open={reopening} onClose={() => setReopening(false)} title={`Reopen ${project.code}`}
                note="The reason is kept in the project's activity"
                footer={<>
                    <Btn onClick={() => setReopening(false)}>Cancel</Btn>
                    <Btn primary disabled={busy || !reason.trim()} onClick={() => act(async () => {
                        await reopenProject(project.id, reason.trim());
                        setReopening(false);
                    }, 'Project reopened')}>Reopen</Btn>
                </>}>
                <Field label="Why is it reopening?">
                    <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                </Field>
            </Modal>
        </Page>
    );
}
