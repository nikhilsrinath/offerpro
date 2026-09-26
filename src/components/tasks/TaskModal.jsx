import React, { useState } from 'react';
import { taskStore } from '../../services/taskStore';
import { orgStore } from '../../services/orgStore';
import { addMember } from '../../services/projectService';
import { isOpen, memberActive } from '../../services/projectAnalytics';
import {
    Btn, Seg, Field, Input, Select, Textarea, Modal, ConfirmBtn,
} from '../ui/edge';
import { useT } from '../ui/edgeUtils';

/* The task sheet. Status and priority are segmented controls rather than
   dropdowns — three options each, all worth seeing without opening anything.

   A task belongs to a project (optionally one of its milestones) or to
   nobody — "General". With a project chosen, its current team is listed first
   among the assignees; picking someone outside it offers to add them to the
   team, since a project's tasks are its members' work. */

// The smallest time share a membership can carry (project_members checks
// allocation_pct > 0). Enough to show on the team; adjust it on the Team tab.
const JOIN_PCT = 10;

const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const STATUSES = [
    { id: 'pending', label: 'Pending' },
    { id: 'in-progress', label: 'In progress' },
    { id: 'done', label: 'Done' },
];
const PRIORITIES = [
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
];

function empName(emp) {
    if (!emp) return '';
    if (emp.first_name && emp.last_name) return `${emp.first_name} ${emp.last_name}`;
    return emp.first_name || emp.last_name || emp.studentName || emp.name || '';
}

export default function TaskModal({ task, onClose, onSaved, defaultProjectId = null, defaultMilestoneId = null, lockProject = false }) {
    const t = useT();
    const employees = orgStore.getSectionAsList('employees');
    const projects = orgStore.getSectionAsList('projects');
    const allMilestones = orgStore.getSectionAsList('project_milestones');
    const allMembers = orgStore.getSectionAsList('project_members');
    const isEdit = !!task;

    const [form, setForm] = useState({
        title: task?.title || '',
        description: task?.description || '',
        assignedTo: task?.assignedTo || '',
        status: task?.status || 'pending',
        priority: task?.priority || 'medium',
        deadline: task?.deadline || '',
        notes: task?.notes || '',
        projectId: task ? task.projectId || '' : defaultProjectId || '',
        milestoneId: task ? task.milestoneId || '' : defaultMilestoneId || '',
    });
    const [addToTeam, setAddToTeam] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const today = todayIso();
    const canJoin = orgStore.can('project_members', 'create');
    const pickable = projects.filter((p) => isOpen(p) || p.id === form.projectId);
    const milestones = allMilestones
        .filter((m) => m.project_id === form.projectId && m.status !== 'cancelled')
        .sort((a, b) => a.sort_order - b.sort_order);
    const teamIds = new Set(allMembers
        .filter((m) => m.project_id === form.projectId && memberActive(m, today))
        .map((m) => m.employee_id));
    const onTeam = employees.filter((e) => teamIds.has(e.id));
    const offTeam = employees.filter((e) => !teamIds.has(e.id));
    const outsider = !!form.projectId && !!form.assignedTo && !teamIds.has(form.assignedTo);

    const set = (key) => (v) => setForm((f) => ({ ...f, [key]: v?.target ? v.target.value : v }));

    const save = async () => {
        if (!form.title.trim()) { setError('Give the task a title.'); return; }
        if (!form.assignedTo) { setError('Choose who this is for.'); return; }
        setSaving(true);
        setError('');
        try {
            const emp = employees.find((e) => e.id === form.assignedTo) || {};
            const payload = {
                ...form,
                title: form.title.trim(),
                assignedName: empName(emp),
                assignedEmail: emp.email || '',
                assignedPhone: emp.phone || '',
                assignedRole: emp.role || '',
                assignedDept: emp.department || '',
                deadline: form.deadline || null,
                followUpSentAt: task?.followUpSentAt ?? null,
            };
            payload.projectId = form.projectId || null;
            payload.milestoneId = form.projectId ? form.milestoneId || null : null;
            if (isEdit) await taskStore.update(task.id, payload);
            else await taskStore.create(payload);
            // Joining the team is a second write; the task is already saved
            // if it fails, so say so rather than failing the whole sheet.
            if (outsider && addToTeam && canJoin) {
                try {
                    await addMember(form.projectId, {
                        employee_id: form.assignedTo, role: 'member', allocation_pct: JOIN_PCT, start_date: today,
                    });
                } catch (e) {
                    setError(`Task saved, but they were not added to the team: ${e.message}`);
                    onSaved();
                    return;
                }
            }
            onSaved();
            onClose();
        } catch (e) {
            setError(/MILESTONE|project/i.test(e?.message || '')
                ? 'That milestone belongs to a different project.'
                : 'Could not save the task. Try again.');
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        taskStore.remove(task.id);
        onSaved();
        onClose();
    };

    return (
        <Modal open onClose={onClose} width={540}
            title={isEdit ? 'Edit task' : 'New task'}
            note={isEdit ? undefined : 'The person sees this in their portal, with its deadline'}
            footer={
                <>
                    {isEdit && <ConfirmBtn size="md" label="Delete task" confirmLabel="Delete" title="Delete task" message="Are you sure you want to delete this task?" onConfirm={remove} />}
                    <div style={{ flex: 1 }} />
                    <Btn onClick={onClose}>Cancel</Btn>
                    <Btn primary onClick={save} disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create task'}</Btn>
                </>
            }>
            <Field label="Title">
                <Input value={form.title} onChange={set('title')} placeholder="What needs doing" autoFocus />
            </Field>
            <div style={{ height: 13 }} />
            <Field label="Details" hint="Optional — what done looks like">
                <Textarea rows={3} value={form.description} onChange={set('description')} />
            </Field>
            <div style={{ height: 13 }} />
            <Field label="Project" hint={lockProject ? undefined : 'Leave as General for work that belongs to no project'}>
                <Select value={form.projectId} disabled={lockProject}
                    onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value, milestoneId: '' }))}>
                    <option value="">General — no project</option>
                    {pickable.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                </Select>
            </Field>
            {milestones.length > 0 && (
                <>
                    <div style={{ height: 13 }} />
                    <Field label="Milestone">
                        <Select value={form.milestoneId} onChange={set('milestoneId')}>
                            <option value="">None</option>
                            {milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                        </Select>
                    </Field>
                </>
            )}
            <div style={{ height: 13 }} />
            <Field label="Assign to">
                <Select value={form.assignedTo} onChange={set('assignedTo')}>
                    <option value="">Choose a person…</option>
                    {form.projectId && onTeam.length > 0 ? (
                        <>
                            <optgroup label="On this project">
                                {onTeam.map((e) => <option key={e.id} value={e.id}>{empName(e)}{e.role ? ` — ${e.role}` : ''}</option>)}
                            </optgroup>
                            <optgroup label="Everyone else">
                                {offTeam.map((e) => <option key={e.id} value={e.id}>{empName(e)}{e.role ? ` — ${e.role}` : ''}</option>)}
                            </optgroup>
                        </>
                    ) : employees.map((e) => (
                        <option key={e.id} value={e.id}>{empName(e)}{e.role ? ` — ${e.role}` : ''}</option>
                    ))}
                </Select>
            </Field>
            {outsider && canJoin && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, fontSize: 10.5, color: t.dim }}>
                    <input type="checkbox" checked={addToTeam} onChange={(e) => setAddToTeam(e.target.checked)} />
                    Also add them to the project team ({JOIN_PCT}% of their time — adjust on the Team tab)
                </label>
            )}
            <div style={{ height: 13 }} />
            <Field label="Status">
                <Seg value={form.status} onChange={set('status')} options={STATUSES} />
            </Field>
            <div style={{ height: 13 }} />
            <Field label="Priority">
                <Seg value={form.priority} onChange={set('priority')} options={PRIORITIES} />
            </Field>
            <div style={{ height: 13 }} />
            <Field label="Deadline" hint="Leave blank if there is no date">
                <Input type="date" value={form.deadline} onChange={set('deadline')} />
            </Field>
            <div style={{ height: 13 }} />
            <Field label="Notes" hint="Kept on the task, not sent as a message">
                <Textarea rows={2} value={form.notes} onChange={set('notes')} style={{ minHeight: 56 }} />
            </Field>

            {error && (
                <div style={{ marginTop: 13, fontSize: 11, color: t.down }}>{error}</div>
            )}
        </Modal>
    );
}
