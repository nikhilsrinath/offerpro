import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Btn, Modal, Field, Textarea, Select } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useToast } from '../shared/Toast';
import { confirmDialog } from '../../services/confirm';
import { PROJECT_STATUSES, statusLabel, isClosed } from '../../services/projectAnalytics';
import {
    closeProject, updateProject, reopenProject, archiveProject, unarchiveProject, duplicateProject, deleteProject,
    canEditProjects, isOwnerOrAdmin,
} from '../../services/projectService';
import { RowMenu } from './pm/pmUi';
import ProjectForm from './ProjectForm';
import { projectRef } from './projectSlug';

/* The project's own controls: its status (with Archive), and Edit /
   Duplicate / Delete under one Actions menu. Shown on the project's home and its
   Overview dashboard only; every other page is about its section. */
export default function ProjectActions({ project }) {
    const t = useT();
    const toast = useToast();
    const navigate = useNavigate();

    const [editing, setEditing] = useState(false);
    const [closing, setClosing] = useState(null);   // 'completed' | 'cancelled'
    const [reopening, setReopening] = useState(false);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);

    const closed = isClosed(project);
    const editable = canEditProjects();
    const admin = isOwnerOrAdmin();

    const act = async (fn, done) => {
        setBusy(true);
        try { await fn(); if (done) toast(done, 'success'); }
        catch (e) { toast(e.message, 'error'); }
        finally { setBusy(false); }
    };

    // Archive sits in the status dropdown after Cancelled. It is a flag, not a
    // status: archiving keeps the status, and picking a status again unarchives.
    const archived = !!project.archived_at;
    const changeStatus = (next) => {
        if (next === 'archived') {
            if (!archived) act(() => archiveProject(project.id), 'Archived');
            return;
        }
        if (archived) {
            act(async () => {
                await unarchiveProject(project.id);
                if (next !== project.status && next !== 'completed' && next !== 'cancelled') {
                    await updateProject(project.id, { status: next });
                }
            }, 'Restored');
            if (next !== project.status && (next === 'completed' || next === 'cancelled')) setClosing(next);
            return;
        }
        if (next === project.status) return;
        if (next === 'completed' || next === 'cancelled') { setClosing(next); return; }
        act(() => updateProject(project.id, { status: next }), `Marked ${statusLabel(next).toLowerCase()}`);
    };

    const remove = async () => {
        const ok = await confirmDialog({
            title: `Delete ${project.name || project.code}?`,
            message: 'The project is deleted for everyone. This cannot be undone.',
            confirmLabel: 'Delete', tone: 'danger',
        });
        if (!ok) return;
        act(async () => {
            await deleteProject(project.id);
            navigate('/projects', { replace: true });
        }, 'Project deleted');
    };

    const items = [
        editable && !closed && { label: 'Edit', onSelect: () => setEditing(true) },
        editable && { label: 'Duplicate', disabled: busy, onSelect: () => act(async () => {
            const { project: copy } = await duplicateProject(project.id);
            navigate(`/projects/${projectRef(copy.id)}`);
        }, 'Duplicated') },
        editable && admin && { label: 'Delete', danger: true, disabled: busy, onSelect: remove },
    ].filter(Boolean);

    return (
        <>
            <Row gap={6} wrap>
                {editable && (
                    <Select aria-label="Project status" value={archived ? 'archived' : project.status} disabled={busy}
                        onChange={(e) => changeStatus(e.target.value)} style={{ width: 130, height: 29 }}>
                        {/* a closed project only changes status through Reopen,
                            but it can still be archived or unarchived here */}
                        {PROJECT_STATUSES.filter((s) => !closed || s.id === project.status)
                            .map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        <option value="archived">{archived ? 'Archived' : 'Archive'}</option>
                    </Select>
                )}
                {closed && admin && (
                    <Btn size="sm" onClick={() => { setReason(''); setReopening(true); }}>Reopen</Btn>
                )}
                {items.length > 0 && (
                    <RowMenu label={`Actions for ${project.name || project.code}`} items={items}>Actions ▾</RowMenu>
                )}
            </Row>

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
                <p style={{ margin: 0, fontSize: 13, color: t.dim, lineHeight: 1.7 }}>
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
                <Field required label="Why is it reopening?">
                    <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                </Field>
            </Modal>
        </>
    );
}
