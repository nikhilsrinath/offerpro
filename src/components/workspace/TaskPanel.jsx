import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Btn, Seg, Field, Input, Select, Textarea, Modal, ConfirmBtn } from '../ui/edge';
import { MONO, useT } from '../ui/edgeUtils';
import { useToast } from '../shared/Toast';
import { workspaceService } from '../../services/workspaceService';
import { DEFAULT_LIST, listOf, nextPosition, firstPosition } from './tasksModel';
import { TickBox, IconBtn } from './workspaceUi';

/* The side panel for one personal task: its title, notes, due date and
   time, list and star, and its subtasks. Subtasks are saved as they are
   added, ticked or removed; the rest saves with Save. */

export default function TaskPanel({ orgId, task = null, list = DEFAULT_LIST, lists = [DEFAULT_LIST], all = [], onClose }) {
    const t = useT();
    const toast = useToast();
    const isEdit = !!task;
    const [form, setForm] = useState({
        title: task?.title || '',
        notes: task?.notes || '',
        due_date: task?.due_date || '',
        due_time: task?.due_time ? String(task.due_time).slice(0, 5) : '',
        list_name: task ? listOf(task) : list,
        starred: !!task?.starred,
    });
    const [newSub, setNewSub] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const subs = isEdit ? all.filter((x) => x.parent_id === task.id).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) : [];

    const set = (key) => (v) => setForm((f) => ({ ...f, [key]: v?.target ? v.target.value : v }));

    const save = async () => {
        const title = form.title.trim();
        if (!title) { setError('Give the task a title.'); return; }
        setSaving(true);
        setError('');
        const row = {
            title, notes: form.notes.trim() || null,
            due_date: form.due_date || null, due_time: form.due_date && form.due_time ? form.due_time : null,
            list_name: form.list_name.trim() || DEFAULT_LIST, starred: form.starred,
        };
        try {
            if (isEdit) {
                // A task moved to another list goes to the end of it, with its subtasks.
                if (row.list_name !== listOf(task)) {
                    row.position = nextPosition(all, row.list_name);
                    if (subs.length) await workspaceService.updateMany('tasks', subs.map((s) => ({ id: s.id, patch: { list_name: row.list_name } })));
                }
                await workspaceService.update('tasks', task.id, row);
            } else {
                await workspaceService.create('tasks', orgId, { ...row, position: firstPosition(all, row.list_name) });
                toast('Task added', 'success');
            }
            onClose();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        const gone = [task, ...subs];
        try {
            await workspaceService.remove('tasks', task.id);
            toast('Task deleted', 'success', 6000, {
                label: 'Undo', onClick: () => workspaceService.restore('tasks', gone).catch((e) => toast(e.message, 'error')),
            });
            onClose();
        } catch (e) {
            setError(e.message);
        }
    };

    const addSub = async () => {
        const title = newSub.trim();
        if (!title) return;
        setNewSub('');
        try {
            await workspaceService.create('tasks', orgId, {
                title, parent_id: task.id, list_name: listOf(task), position: nextPosition(all, listOf(task), task.id),
            });
        } catch (e) { setError(e.message); }
    };
    const tickSub = (s) => workspaceService.update('tasks', s.id, { completed_at: s.completed_at ? null : new Date().toISOString() })
        .catch((e) => setError(e.message));
    const dropSub = (s) => workspaceService.remove('tasks', s.id).catch((e) => setError(e.message));

    const gap = <div style={{ height: 13 }} />;
    const done = subs.filter((s) => s.completed_at).length;

    return (
        <Modal open onClose={onClose} width={680}
            title={isEdit ? 'Edit task' : 'New task'}
            note="Only you can see your tasks"
            footer={(
                <>
                    {isEdit && <ConfirmBtn size="md" label="Delete task" confirmLabel="Delete" title="Delete task"
                        message={subs.length ? `The task and its ${subs.length} ${subs.length === 1 ? 'subtask' : 'subtasks'} are deleted.` : 'The task is deleted.'}
                        onConfirm={remove} />}
                    <div style={{ flex: 1 }} />
                    <Btn onClick={onClose}>Cancel</Btn>
                    <Btn primary onClick={save} disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add task'}</Btn>
                </>
            )}>
            <Field required label="Title">
                <Input value={form.title} onChange={set('title')} autoFocus maxLength={500} placeholder="What needs doing"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} />
            </Field>
            {gap}
            <Field label="Details" hint="Notes, links, what done looks like">
                <Textarea rows={4} value={form.notes} onChange={set('notes')} />
            </Field>
            {gap}
            <Field label="Due">
                <div style={{ display: 'flex', gap: 8 }}>
                    <Input type="date" value={form.due_date} onChange={set('due_date')} aria-label="Due date" style={{ flex: 1 }} />
                    <Input type="time" value={form.due_time} onChange={set('due_time')} aria-label="Due time" disabled={!form.due_date} style={{ width: 130 }} />
                    {form.due_date && <Btn onClick={() => setForm((f) => ({ ...f, due_date: '', due_time: '' }))}>Clear</Btn>}
                </div>
            </Field>
            {gap}
            <Field label="List">
                <Select value={form.list_name} onChange={set('list_name')}>
                    {[...new Set([...lists, form.list_name])].map((l) => <option key={l} value={l}>{l}</option>)}
                </Select>
            </Field>
            {gap}
            <Field label="Starred" hint="Starred tasks are gathered under Starred">
                <Seg value={form.starred ? 'yes' : 'no'} onChange={(v) => set('starred')(v === 'yes')} label="Starred" options={[
                    { id: 'no', label: 'No' }, { id: 'yes', label: 'Starred' },
                ]} />
            </Field>
            {gap}
            <Field label="Subtasks" hint={isEdit ? (subs.length ? `${done} of ${subs.length} done` : 'Break the task into steps') : 'Add the task first, then its steps'}>
                {isEdit && (
                    <div style={{ border: '1px solid ' + t.lineStrong, borderRadius: 8, overflow: 'hidden', background: t.card }}>
                        {subs.map((s) => (
                            <div key={s.id} className="ws-row" style={{ display: 'flex', alignItems: 'center', gap: 9, minHeight: 36, padding: '0 6px 0 10px', borderBottom: '1px solid ' + t.lineSoft }}>
                                <TickBox done={!!s.completed_at} onToggle={() => tickSub(s)} label={`Done: ${s.title}`} size={16} />
                                <span style={{
                                    flex: 1, minWidth: 0, fontSize: 13, color: s.completed_at ? t.faint : t.text,
                                    textDecoration: s.completed_at ? 'line-through' : 'none', overflowWrap: 'anywhere',
                                }}>{s.title}</span>
                                <IconBtn icon={X} label={`Remove ${s.title}`} size={24} className="ws-reveal" onClick={() => dropSub(s)} />
                            </div>
                        ))}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minHeight: 36, padding: '0 6px 0 10px' }}>
                            <Plus aria-hidden="true" size={15} style={{ color: t.faint, flexShrink: 0 }} />
                            <input value={newSub} onChange={(e) => setNewSub(e.target.value)} maxLength={500}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } }}
                                placeholder="Add a subtask and press Enter" aria-label="New subtask"
                                className="ws-bare-input" style={{ fontFamily: MONO, fontSize: 13, height: 34 }} />
                            {newSub.trim() && <Btn size="sm" onClick={addSub}>Add</Btn>}
                        </div>
                    </div>
                )}
            </Field>
            {error && <div role="alert" style={{ marginTop: 13, fontSize: 12.5, color: t.down }}>{error}</div>}
        </Modal>
    );
}
