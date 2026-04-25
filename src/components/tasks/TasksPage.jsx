import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, CheckCircle2, Clock, AlertTriangle, ListTodo, ChevronDown, User, Calendar } from 'lucide-react';
import { taskStore } from '../../services/taskStore';
import { orgStore } from '../../services/orgStore';
import TaskModal from './TaskModal';

const STATUS_CONFIG = {
  pending:       { label: 'Pending',     color: '#b45309', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.2)' },
  'in-progress': { label: 'In Progress', color: '#1d4ed8', bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.2)' },
  done:          { label: 'Done',        color: '#047857', bg: 'rgba(16,185,129,0.1)',  border: 'rgba(16,185,129,0.2)' },
  overdue:       { label: 'Overdue',     color: '#b91c1c', bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.2)'  },
};

const PRIORITY_CONFIG = {
  low:    { color: '#64748b', label: 'Low' },
  medium: { color: '#d97706', label: 'Medium' },
  high:   { color: '#dc2626', label: 'High' },
};

function getEmpName(emp) {
  if (!emp) return '';
  if (emp.first_name && emp.last_name) return `${emp.first_name} ${emp.last_name}`;
  return emp.first_name || emp.last_name || emp.studentName || emp.name || '';
}

function getInitials(name) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function formatDeadline(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return { text: 'Due today', urgent: true };
  if (diff === 1) return { text: 'Due tomorrow', urgent: false };
  if (diff < 0)  return { text: `${Math.abs(diff)}d overdue`, urgent: true };
  if (diff <= 7) return { text: `${diff}d left`, urgent: false };
  return { text: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), urgent: false };
}

const STAT_CARDS = [
  { key: 'total',     label: 'Total',     Icon: ListTodo,      accent: 'var(--border-strong)',       iconBg: 'var(--bg-overlay)',        iconColor: 'var(--text-secondary)' },
  { key: 'pending',   label: 'Pending',   Icon: Clock,         accent: 'rgba(245,158,11,0.6)',       iconBg: 'rgba(245,158,11,0.08)',    iconColor: '#d97706' },
  { key: 'overdue',   label: 'Overdue',   Icon: AlertTriangle, accent: 'rgba(239,68,68,0.6)',        iconBg: 'rgba(239,68,68,0.08)',     iconColor: '#dc2626' },
  { key: 'done',      label: 'Done',      Icon: CheckCircle2,  accent: 'rgba(16,185,129,0.6)',       iconBg: 'rgba(16,185,129,0.08)',    iconColor: '#059669' },
];

const FILTERS = [
  { id: 'all',         label: 'All' },
  { id: 'pending',     label: 'Pending' },
  { id: 'in-progress', label: 'In Progress' },
  { id: 'done',        label: 'Done' },
  { id: 'overdue',     label: 'Overdue' },
];

export default function TasksPage() {
  const [tasks, setTasks]               = useState([]);
  const [employees, setEmployees]       = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterEmployee, setFilterEmployee] = useState('all');
  const [showModal, setShowModal]       = useState(false);
  const [editingTask, setEditingTask]   = useState(null);
  const [showEmpFilter, setShowEmpFilter] = useState(false);
  const [isMobile, setIsMobile]         = useState(() => window.innerWidth < 768);
  const empFilterRef = useRef(null);

  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);

  const reload = useCallback(() => {
    setTasks(taskStore.getAll());
    setEmployees(orgStore.getSectionAsList('employees'));
  }, []);

  useEffect(() => {
    reload();
    const unsubscribe = taskStore.onChanged(reload);
    const interval = setInterval(reload, 5000);
    return () => { unsubscribe(); clearInterval(interval); };
  }, [reload]);

  useEffect(() => {
    const handler = (e) => {
      if (empFilterRef.current && !empFilterRef.current.contains(e.target)) {
        setShowEmpFilter(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const today = new Date().toISOString().slice(0, 10);

  const stats = {
    total:   tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    overdue: tasks.filter(t => t.status !== 'done' && t.deadline && t.deadline < today).length,
    done:    tasks.filter(t => t.status === 'done').length,
  };

  const filtered = tasks.filter(t => {
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (filterEmployee !== 'all' && t.assignedTo !== filterEmployee) return false;
    return true;
  });

  const selectedEmp = employees.find(e => e.id === filterEmployee);
  const selectedEmpName = filterEmployee === 'all' ? 'All Members' : getEmpName(selectedEmp);

  const openCreate = () => { setEditingTask(null); setShowModal(true); };
  const openEdit   = (task) => { setEditingTask(task); setShowModal(true); };

  return (
    <div style={{
      padding: isMobile ? '1rem 1rem 5rem' : '2rem 2.5rem 3rem',
      minHeight: '100%',
      boxSizing: 'border-box',
    }}>

      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: isMobile ? '1rem' : '1.5rem',
      }}>
        {/* Left: filter pills (desktop) or title (mobile) */}
        {isMobile ? (
          <span style={{ fontWeight: 700, fontSize: '1.0625rem', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Task Board
          </span>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            {FILTERS.map(f => {
              const active = filterStatus === f.id;
              return (
                <button key={f.id} onClick={() => setFilterStatus(f.id)} style={{
                  padding: '0.375rem 0.875rem',
                  borderRadius: '8px',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border-default)'}`,
                  background: active ? 'var(--accent)' : 'transparent',
                  color: active ? 'var(--surface)' : 'var(--text-secondary)',
                  fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer',
                  fontFamily: 'inherit', transition: 'all 0.15s', letterSpacing: '-0.01em',
                }}>
                  {f.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Right: emp filter + new task (desktop only — mobile has FAB) */}
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div ref={empFilterRef} style={{ position: 'relative' }}>
              <button onClick={() => setShowEmpFilter(v => !v)} style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.375rem 0.875rem', borderRadius: '8px',
                border: `1px solid ${filterEmployee !== 'all' ? 'var(--accent)' : 'var(--border-default)'}`,
                background: filterEmployee !== 'all' ? 'var(--bg-raised)' : 'transparent',
                color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.8125rem',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <User size={13} />
                {selectedEmpName}
                <ChevronDown size={12} style={{ opacity: 0.6, transform: showEmpFilter ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
              </button>
              {showEmpFilter && (
                <div style={{
                  position: 'absolute', right: 0, top: 'calc(100% + 6px)',
                  background: 'var(--surface)', border: '1px solid var(--border-default)',
                  borderRadius: '10px', boxShadow: 'var(--shadow-lg)',
                  zIndex: 100, minWidth: '200px', padding: '0.375rem',
                }}>
                  {[{ id: 'all', name: 'All Members' }, ...employees.map(e => ({ id: e.id, name: getEmpName(e) }))].map(e => (
                    <button key={e.id} onClick={() => { setFilterEmployee(e.id); setShowEmpFilter(false); }} style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '0.5rem 0.75rem', borderRadius: '7px', border: 'none',
                      background: filterEmployee === e.id ? 'var(--bg-raised)' : 'transparent',
                      color: filterEmployee === e.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: filterEmployee === e.id ? 600 : 500,
                      fontSize: '0.875rem', cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                      {e.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={openCreate} style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              background: 'var(--accent)', color: 'var(--surface)',
              border: 'none', borderRadius: '8px', padding: '0.45rem 1rem',
              fontWeight: 700, fontSize: '0.8125rem', cursor: 'pointer',
              fontFamily: 'inherit', letterSpacing: '-0.01em',
            }}>
              <Plus size={15} strokeWidth={2.5} /> New Task
            </button>
          </div>
        )}

        {/* Mobile: just show task count badge */}
        {isMobile && (
          <span style={{
            fontSize: '0.75rem', fontWeight: 600,
            color: 'var(--text-muted)',
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '20px', padding: '0.2rem 0.625rem',
          }}>
            {filtered.length} task{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Mobile filter row (scrollable pills) ─────────────────────── */}
      {isMobile && (
        <div style={{ marginBottom: '1rem' }}>
          {/* Status filters */}
          <div style={{
            display: 'flex', gap: '0.5rem',
            overflowX: 'auto', paddingBottom: '0.25rem',
            scrollbarWidth: 'none', msOverflowStyle: 'none',
            WebkitOverflowScrolling: 'touch',
          }}>
            {FILTERS.map(f => {
              const active = filterStatus === f.id;
              return (
                <button key={f.id} onClick={() => setFilterStatus(f.id)} style={{
                  flexShrink: 0,
                  padding: '0.375rem 0.875rem',
                  borderRadius: '20px',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border-default)'}`,
                  background: active ? 'var(--accent)' : 'var(--surface)',
                  color: active ? 'var(--surface)' : 'var(--text-secondary)',
                  fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer',
                  fontFamily: 'inherit', whiteSpace: 'nowrap',
                }}>
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* Employee filter (mobile) */}
          <div ref={empFilterRef} style={{ position: 'relative', marginTop: '0.625rem' }}>
            <button onClick={() => setShowEmpFilter(v => !v)} style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              width: '100%', padding: '0.5rem 0.875rem', borderRadius: '10px',
              border: `1px solid ${filterEmployee !== 'all' ? 'var(--accent)' : 'var(--border-default)'}`,
              background: filterEmployee !== 'all' ? 'rgba(99,102,241,0.05)' : 'var(--surface)',
              color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.875rem',
              cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
            }}>
              <User size={14} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{selectedEmpName}</span>
              <ChevronDown size={13} style={{ opacity: 0.5, transform: showEmpFilter ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
            </button>
            {showEmpFilter && (
              <div style={{
                position: 'absolute', left: 0, right: 0, top: 'calc(100% + 6px)',
                background: 'var(--surface)', border: '1px solid var(--border-default)',
                borderRadius: '12px', boxShadow: 'var(--shadow-lg)',
                zIndex: 100, padding: '0.375rem', maxHeight: 220, overflowY: 'auto',
              }}>
                {[{ id: 'all', name: 'All Members' }, ...employees.map(e => ({ id: e.id, name: getEmpName(e) }))].map(e => (
                  <button key={e.id} onClick={() => { setFilterEmployee(e.id); setShowEmpFilter(false); }} style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '0.625rem 0.875rem', borderRadius: '8px', border: 'none',
                    background: filterEmployee === e.id ? 'var(--bg-raised)' : 'transparent',
                    color: filterEmployee === e.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: filterEmployee === e.id ? 600 : 500,
                    fontSize: '0.9375rem', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    {e.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Stat strip ───────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
        gap: isMobile ? '0.625rem' : '1rem',
        marginBottom: isMobile ? '1.25rem' : '2rem',
      }}>
        {STAT_CARDS.map(({ key, label, Icon, accent, iconBg, iconColor }) => (
          <div key={key} style={{
            background: 'var(--surface)',
            border: '1px solid var(--border-subtle)',
            borderTop: `3px solid ${accent}`,
            borderRadius: '10px',
            padding: isMobile ? '0.875rem' : '1.125rem 1.25rem',
            display: 'flex', alignItems: 'center',
            gap: isMobile ? '0.625rem' : '1rem',
          }}>
            <div style={{
              width: isMobile ? 32 : 38, height: isMobile ? 32 : 38,
              borderRadius: '8px', background: iconBg,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Icon size={isMobile ? 14 : 17} color={iconColor} />
            </div>
            <div>
              <div style={{
                fontSize: isMobile ? '1.375rem' : '1.625rem',
                fontWeight: 800, color: 'var(--text-primary)',
                lineHeight: 1, letterSpacing: '-0.03em',
              }}>
                {stats[key]}
              </div>
              <div style={{
                fontSize: isMobile ? '0.6875rem' : '0.75rem',
                color: 'var(--text-muted)', marginTop: '0.2rem', fontWeight: 500,
              }}>
                {label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Task grid / empty state ───────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: isMobile ? '3rem 1.5rem' : '5rem 2rem',
          background: 'var(--surface)',
          border: '1px dashed var(--border-default)',
          borderRadius: '14px',
        }}>
          <div style={{ width: 48, height: 48, borderRadius: '14px', background: 'var(--bg-raised)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
            <ListTodo size={22} color="var(--text-tertiary)" />
          </div>
          <p style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', margin: '0 0 0.375rem', textAlign: 'center' }}>No tasks yet</p>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: '0 0 1.5rem', textAlign: 'center', maxWidth: 260 }}>
            {filterStatus !== 'all' || filterEmployee !== 'all'
              ? 'No tasks match the current filters.'
              : 'Create your first task and assign it to a team member.'}
          </p>
          {filterStatus === 'all' && filterEmployee === 'all' && (
            <button onClick={openCreate} style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              background: 'var(--accent)', color: 'var(--surface)',
              border: 'none', borderRadius: '8px', padding: '0.625rem 1.25rem',
              fontWeight: 700, fontSize: '0.875rem', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <Plus size={15} /> Create Task
            </button>
          )}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(310px, 1fr))',
          gap: isMobile ? '0.75rem' : '1rem',
        }}>
          {filtered.map(task => {
            const sc       = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
            const pc       = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
            const dl       = task.deadline ? formatDeadline(task.deadline) : null;
            const initials = getInitials(task.assignedName || '?');

            return (
              <div
                key={task.id}
                onClick={() => openEdit(task)}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '12px',
                  padding: isMobile ? '1rem' : '1.125rem',
                  cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', gap: '0.75rem',
                  transition: 'box-shadow 0.15s, border-color 0.15s',
                  position: 'relative',
                  // Tap highlight on mobile
                  WebkitTapHighlightColor: 'transparent',
                }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
              >
                {/* Row 1: status + priority */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                    padding: '0.2rem 0.625rem', borderRadius: '6px',
                    background: sc.bg, color: sc.color,
                    border: `1px solid ${sc.border}`,
                    fontSize: '0.6875rem', fontWeight: 700, textTransform: 'capitalize',
                  }}>
                    {sc.label}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.6875rem', fontWeight: 600, color: pc.color }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: pc.color, display: 'inline-block' }} />
                    {pc.label}
                  </span>
                </div>

                {/* Row 2: title + description */}
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    {task.title}
                  </p>
                  {task.description && (
                    <p style={{
                      margin: '0.35rem 0 0', fontSize: '0.8125rem', color: 'var(--text-tertiary)',
                      lineHeight: 1.55,
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>
                      {task.description}
                    </p>
                  )}
                </div>

                {/* Row 3: assignee + deadline */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  paddingTop: '0.625rem', borderTop: '1px solid var(--border-subtle)', marginTop: 'auto',
                  flexWrap: 'wrap', gap: '0.375rem',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%',
                      background: 'var(--accent)', color: 'var(--surface)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.625rem', fontWeight: 800, flexShrink: 0,
                    }}>
                      {initials || <User size={12} />}
                    </div>
                    <span style={{
                      fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: 500,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {task.assignedName || '—'}
                    </span>
                  </div>
                  {dl ? (
                    <span style={{
                      display: 'flex', alignItems: 'center', gap: '0.3rem',
                      fontSize: '0.75rem', fontWeight: 600, flexShrink: 0,
                      color: dl.urgent ? '#dc2626' : 'var(--text-muted)',
                      background: dl.urgent ? 'rgba(239,68,68,0.07)' : 'transparent',
                      padding: dl.urgent ? '0.15rem 0.5rem' : '0',
                      borderRadius: '5px',
                    }}>
                      <Calendar size={11} />
                      {dl.text}
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', flexShrink: 0 }}>No deadline</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Mobile FAB ───────────────────────────────────────────────── */}
      {isMobile && (
        <button
          onClick={openCreate}
          style={{
            position: 'fixed',
            bottom: '1.5rem',
            right: '1.5rem',
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'var(--accent)',
            color: 'var(--surface)',
            border: 'none',
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 50,
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <Plus size={24} strokeWidth={2.5} />
        </button>
      )}

      {/* ── Modal ────────────────────────────────────────────────────── */}
      {showModal && (
        <TaskModal
          task={editingTask}
          onClose={() => { setShowModal(false); setEditingTask(null); }}
          onSaved={reload}
        />
      )}
    </div>
  );
}
