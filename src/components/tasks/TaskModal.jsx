import React, { useState } from 'react';
import { taskStore } from '../../services/taskStore';
import { orgStore } from '../../services/orgStore';
import {
    Btn, Seg, Field, Input, Select, Textarea, Modal, ConfirmBtn,
} from '../ui/edge';
import { useT } from '../ui/edgeUtils';

/* The task sheet. Status and priority are segmented controls rather than
   dropdowns — three options each, all worth seeing without opening anything. */

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

export default function TaskModal({ task, onClose, onSaved }) {
    const t = useT();
    const employees = orgStore.getSectionAsList('employees');
    const isEdit = !!task;

    const [form, setForm] = useState({
        title: task?.title || '',
        description: task?.description || '',
        assignedTo: task?.assignedTo || '',
        status: task?.status || 'pending',
        priority: task?.priority || 'medium',
        deadline: task?.deadline || '',
        notes: task?.notes || '',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

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
            if (isEdit) await taskStore.update(task.id, payload);
            else await taskStore.create(payload);
            onSaved();
            onClose();
        } catch {
            setError('Could not save the task. Try again.');
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
                    {isEdit && <ConfirmBtn size="md" label="Delete task" confirmLabel="Delete for good" onConfirm={remove} />}
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
            <Field label="Assign to">
                <Select value={form.assignedTo} onChange={set('assignedTo')}>
                    <option value="">Choose a person…</option>
                    {employees.map((e) => (
                        <option key={e.id} value={e.id}>{empName(e)}{e.role ? ` — ${e.role}` : ''}</option>
                    ))}
                </Select>
            </Field>
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
