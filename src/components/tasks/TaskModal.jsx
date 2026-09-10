import React, { useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import { taskStore } from '../../services/taskStore';
import { orgStore } from '../../services/orgStore';

const STATUSES = ['pending', 'in-progress', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];

const STATUS_COLORS = {
  pending: { bg: 'rgba(251,191,36,0.1)', color: '#d97706', border: 'rgba(251,191,36,0.25)' },
  'in-progress': { bg: 'rgba(59,130,246,0.1)', color: '#2563eb', border: 'rgba(59,130,246,0.25)' },
  done: { bg: 'rgba(16,185,129,0.1)', color: '#059669', border: 'rgba(16,185,129,0.25)' },
  overdue: { bg: 'rgba(239,68,68,0.1)', color: '#dc2626', border: 'rgba(239,68,68,0.25)' },
};

const PRIORITY_COLORS = {
  low: { bg: 'rgba(148,163,184,0.1)', color: 'var(--text-tertiary)', border: 'var(--border-subtle)' },
  medium: { bg: 'rgba(251,191,36,0.1)', color: '#d97706', border: 'rgba(251,191,36,0.25)' },
  high: { bg: 'rgba(239,68,68,0.1)', color: '#dc2626', border: 'rgba(239,68,68,0.25)' },
};

function getEmpName(emp) {
  if (emp.first_name && emp.last_name) return `${emp.first_name} ${emp.last_name}`;
  return emp.first_name || emp.last_name || emp.studentName || emp.name || '';
}

export default function TaskModal({ task, onClose, onSaved }) {
  const employees = orgStore.getSectionAsList('employees');

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

  const isEdit = !!task;

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSave = async () => {
    if (!form.title.trim()) { setError('Task title is required.'); return; }
    if (!form.assignedTo) { setError('Please assign this task to an employee.'); return; }
    setSaving(true);
    setError('');
    try {
      const empData = employees.find(e => e.id === form.assignedTo) || {};
      const payload = {
        ...form,
        title: form.title.trim(),
        assignedName: getEmpName(empData),
        assignedEmail: empData.email || '',
        assignedPhone: empData.phone || '',
        assignedRole: empData.role || '',
        assignedDept: empData.department || '',
        deadline: form.deadline || null,
        followUpSentAt: task?.followUpSentAt ?? null,
      };
      if (isEdit) {
        await taskStore.update(task.id, payload);
      } else {
        await taskStore.create(payload);
      }
      onSaved();
      onClose();
    } catch {
      setError('Failed to save task. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this task?')) return;
    taskStore.remove(task.id);
    onSaved();
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'var(--surface)', borderRadius: '16px', width: '100%', maxWidth: '520px',
        border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-xl)',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
          <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
            {isEdit ? 'Edit Task' : 'New Task'}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {isEdit && (
              <button onClick={handleDelete} style={{ background: 'rgba(239,68,68,0.08)', border: 'none', borderRadius: '8px', padding: '0.4rem 0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem', color: '#dc2626', fontSize: '0.8125rem', fontWeight: 600 }}>
                <Trash2 size={14} /> Delete
              </button>
            )}
            <button onClick={onClose} style={{ background: 'var(--bg-raised)', border: 'none', borderRadius: '8px', padding: '0.4rem', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {error && (
            <div style={{ background: 'rgba(239,68,68,0.08)', color: '#dc2626', borderRadius: '8px', padding: '0.75rem 1rem', fontSize: '0.875rem', border: '1px solid rgba(239,68,68,0.15)' }}>
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: '0.4rem' }}>Title *</label>
            <input
              autoFocus
              value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder="What needs to be done?"
              style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border-default)', borderRadius: '10px', padding: '0.75rem 1rem', color: 'var(--text-primary)', fontSize: '0.9375rem', outline: 'none', fontFamily: 'inherit' }}
            />
          </div>

          {/* Assign + Deadline row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: '0.4rem' }}>Assign To *</label>
              <select
                value={form.assignedTo}
                onChange={e => set('assignedTo', e.target.value)}
                style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border-default)', borderRadius: '10px', padding: '0.75rem 1rem', color: form.assignedTo ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: '0.875rem', outline: 'none', fontFamily: 'inherit', cursor: 'pointer' }}
              >
                <option value="">Select employee</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{getEmpName(e)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: '0.4rem' }}>Deadline</label>
              <input
                type="date"
                value={form.deadline}
                onChange={e => set('deadline', e.target.value)}
                style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border-default)', borderRadius: '10px', padding: '0.75rem 1rem', color: 'var(--text-primary)', fontSize: '0.875rem', outline: 'none', fontFamily: 'inherit', cursor: 'pointer' }}
              />
            </div>
          </div>

          {/* Priority */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: '0.5rem' }}>Priority</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {PRIORITIES.map(p => {
                const c = PRIORITY_COLORS[p];
                const active = form.priority === p;
                return (
                  <button key={p} onClick={() => set('priority', p)} style={{ flex: 1, padding: '0.5rem', borderRadius: '8px', border: `1px solid ${active ? c.border : 'var(--border-subtle)'}`, background: active ? c.bg : 'transparent', color: active ? c.color : 'var(--text-tertiary)', fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer', textTransform: 'capitalize', fontFamily: 'inherit', transition: 'all 0.15s' }}>
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Status */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: '0.5rem' }}>Status</label>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {STATUSES.map(s => {
                const c = STATUS_COLORS[s];
                const active = form.status === s;
                return (
                  <button key={s} onClick={() => set('status', s)} style={{ padding: '0.45rem 0.875rem', borderRadius: '8px', border: `1px solid ${active ? c.border : 'var(--border-subtle)'}`, background: active ? c.bg : 'transparent', color: active ? c.color : 'var(--text-tertiary)', fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer', textTransform: 'capitalize', fontFamily: 'inherit', transition: 'all 0.15s' }}>
                    {s.replace('-', ' ')}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: '0.4rem' }}>Description</label>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Add context, requirements, or links..."
              rows={3}
              style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border-default)', borderRadius: '10px', padding: '0.75rem 1rem', color: 'var(--text-primary)', fontSize: '0.875rem', outline: 'none', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 }}
            />
          </div>

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: '0.4rem' }}>Notes</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Internal notes for this task..."
              rows={2}
              style={{ width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border-default)', borderRadius: '10px', padding: '0.75rem 1rem', color: 'var(--text-primary)', fontSize: '0.875rem', outline: 'none', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '0.625rem 1.25rem', background: 'transparent', border: '1px solid var(--border-default)', borderRadius: '10px', color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '0.625rem 1.5rem', background: 'var(--accent)', border: 'none', borderRadius: '10px', color: 'var(--surface)', fontSize: '0.875rem', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, fontFamily: 'inherit' }}>
            {saving ? 'Saving…' : isEdit ? 'Update Task' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  );
}
