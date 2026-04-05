import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ReactFlow, addEdge, useNodesState, useEdgesState,
  Controls, Background, Handle, Position,
  MarkerType, Panel, BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ref, get, set } from 'firebase/database';
import { db } from '../lib/firebase';
import { storageService } from '../services/storageService';
import { useOrg } from '../context/OrgContext';
import {
  Save, Edit2, X, Users, GitBranch, Plus, Trash2,
  ChevronDown, ChevronRight, Check,
} from 'lucide-react';

// ── Department colour palette ─────────────────────────────────────────────────
export const DEPT_PALETTE = [
  '#6366f1','#3b82f6','#8b5cf6','#10b981',
  '#f59e0b','#ec4899','#14b8a6','#ef4444',
  '#06b6d4','#a855f7','#22c55e','#f97316',
  '#84cc16','#0ea5e9','#d946ef','#64748b',
];

function hashColor(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return DEPT_PALETTE[Math.abs(h) % DEPT_PALETTE.length];
}

function resolveColor(emp, deptMap) {
  if (emp.department && deptMap[emp.department]) return deptMap[emp.department];
  if (emp.department) return hashColor(emp.department);
  return hashColor(emp.name || '');
}

function initials(name = '') {
  return name.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
}

function getDisplayName(emp) {
  if (emp.studentName) return emp.studentName;
  const f = (emp.first_name || '').trim();
  const l = (emp.last_name || '').trim();
  return `${f} ${l}`.trim() || emp.email || 'Unknown';
}

function useWindowWidth() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const handler = () => setW(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return w;
}

// ── Custom employee node (desktop) ────────────────────────────────────────────
function EmployeeNode({ data, selected }) {
  const color = data.color || '#6366f1';
  return (
    <div style={{ position: 'relative', width: 240 }}>
      <Handle type="target" position={Position.Top}
        style={{ width: 8, height: 8, background: color, border: `2px solid var(--background)`, top: -4, zIndex: 10 }} />
      <div style={{
        background: 'var(--bg-elevated)', borderRadius: '14px', overflow: 'hidden',
        boxShadow: selected
          ? `0 0 0 2px ${color}, 0 12px 40px rgba(0,0,0,0.5)`
          : '0 4px 20px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.25)',
        border: '1px solid var(--border-default)', transition: 'box-shadow 0.18s ease',
      }}>
        <div style={{ height: 3, background: color }} />
        <div style={{ padding: '0.875rem 1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, background: `${color}22`, border: `1.5px solid ${color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem', fontWeight: 800, color }}>
              {initials(data.name)}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.015em' }}>
                {data.name}
              </div>
              {data.email && (
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '0.1rem' }}>
                  {data.email}
                </div>
              )}
            </div>
          </div>
          {(data.role || data.department) && (
            <div style={{ marginTop: '0.625rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {data.role && <span style={{ fontSize: '0.63rem', fontWeight: 700, padding: '0.2rem 0.55rem', borderRadius: '99px', background: `${color}1a`, color }}>{data.role}</span>}
              {data.department && <span style={{ fontSize: '0.63rem', fontWeight: 600, padding: '0.2rem 0.55rem', borderRadius: '99px', background: 'rgba(255,255,255,0.07)', color: 'var(--text-muted)' }}>{data.department}</span>}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom}
        style={{ width: 8, height: 8, background: color, border: `2px solid var(--background)`, bottom: -4, zIndex: 10 }} />
    </div>
  );
}

// ── Build flow nodes & edges ──────────────────────────────────────────────────
function buildFlowData(hierData, empMap, deptMap) {
  const hierNodes = Object.values(hierData.nodes || {});
  const hierEdges = Object.values(hierData.edges || {});
  const nodes = hierNodes.filter(n => empMap[n.id]).map(n => {
    const emp = empMap[n.id];
    const name = getDisplayName(emp);
    const color = resolveColor({ ...emp, name }, deptMap);
    return { id: n.id, type: 'employee', position: n.position || { x: 0, y: 0 }, data: { name, email: emp.email || '', role: emp.role || '', department: emp.department || '', color } };
  });
  const nodeSet = new Set(nodes.map(n => n.id));
  const edges = hierEdges.filter(e => nodeSet.has(e.source) && nodeSet.has(e.target)).map(e => {
    const tgtNode = nodes.find(n => n.id === e.target);
    const color = tgtNode?.data.color || '#6366f1';
    return { id: e.id, source: e.source, target: e.target, type: 'smoothstep', animated: false, markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 }, style: { stroke: color, strokeWidth: 1.5, opacity: 0.65 } };
  });
  return { nodes, edges };
}

// ── Mobile: recursive tree node ───────────────────────────────────────────────
function MobileTreeNode({ nodeData, childIds, nodesById, childrenMap }) {
  const [open, setOpen] = useState(true);
  const children = (childIds || []).map(id => nodesById[id]).filter(Boolean);
  const color = nodeData.data.color || '#6366f1';
  const hasKids = children.length > 0;

  return (
    <div style={{ marginBottom: 10 }}>
      {/* Card */}
      <div style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: '14px',
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
      }}>
        {/* Color accent bar */}
        <div style={{ height: 3, background: `linear-gradient(90deg, ${color}, ${color}77)` }} />
        <div style={{ padding: '0.75rem 0.875rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Avatar */}
          <div style={{
            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
            background: `${color}18`, border: `2px solid ${color}45`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.78rem', fontWeight: 800, color, letterSpacing: '0.02em',
          }}>
            {initials(nodeData.data.name)}
          </div>
          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.015em' }}>
              {nodeData.data.name}
            </div>
            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', marginTop: '0.2rem', flexWrap: 'wrap' }}>
              {nodeData.data.role && (
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color, background: `${color}15`, padding: '0.1rem 0.45rem', borderRadius: '99px' }}>
                  {nodeData.data.role}
                </span>
              )}
              {nodeData.data.department && (
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                  {nodeData.data.department}
                </span>
              )}
            </div>
          </div>
          {/* Toggle button w/ child count */}
          {hasKids && (
            <button
              onClick={() => setOpen(p => !p)}
              style={{
                flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: '0.2rem',
                background: open ? `${color}14` : 'var(--bg-raised)',
                border: `1px solid ${open ? color + '35' : 'var(--border-default)'}`,
                borderRadius: '99px',
                padding: '0.25rem 0.55rem 0.25rem 0.65rem',
                cursor: 'pointer',
                color: open ? color : 'var(--text-muted)',
                fontSize: '0.7rem', fontWeight: 700,
                transition: 'all 0.15s',
              }}
            >
              {children.length}
              {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </button>
          )}
        </div>
      </div>

      {/* Children subtree */}
      {open && hasKids && (
        <div style={{
          marginLeft: 20,
          paddingLeft: 16,
          borderLeft: `1.5px solid ${color}35`,
          paddingTop: 8,
          paddingBottom: 2,
        }}>
          {children.map(child => (
            <MobileTreeNode
              key={child.id}
              nodeData={child}
              childIds={childrenMap[child.id] || []}
              nodesById={nodesById}
              childrenMap={childrenMap}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Mobile: full hierarchy view ───────────────────────────────────────────────
function MobileHierarchyView({ nodes, edges, employees, departments, deptMap, allDeptNames, stats, onEdit, hasHierarchy, onSetup }) {
  const nodesById = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes]);
  const childrenMap = useMemo(() => {
    const map = {};
    edges.forEach(e => {
      if (!map[e.source]) map[e.source] = [];
      map[e.source].push(e.target);
    });
    return map;
  }, [edges]);
  const hasParent = useMemo(() => {
    const s = new Set();
    edges.forEach(e => s.add(e.target));
    return s;
  }, [edges]);
  const roots = useMemo(() => nodes.filter(n => !hasParent.has(n.id)), [nodes, hasParent]);

  if (!hasHierarchy) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3.5rem 1.5rem', gap: '1.5rem', textAlign: 'center' }}>
        <div style={{ width: 72, height: 72, borderRadius: '20px', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <GitBranch size={30} color="#6366f1" />
        </div>
        <div>
          <h2 style={{ margin: '0 0 0.5rem', fontWeight: 800, fontSize: '1.25rem', color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>Build your org chart</h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6, maxWidth: 280 }}>
            {employees.length} employee{employees.length !== 1 ? 's' : ''} ready. Tap below to set up reporting lines.
          </p>
        </div>
        <button
          onClick={onSetup}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.75rem', background: '#6366f1', color: '#fff', border: 'none', borderRadius: '12px', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}
        >
          <GitBranch size={15} /> Get Started
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Title row + Edit button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Team Structure</h2>
          <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {stats.total} members · {stats.managers} manager{stats.managers !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={onEdit}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
            padding: '0.5rem 0.875rem',
            background: 'rgba(99,102,241,0.1)',
            border: '1px solid rgba(99,102,241,0.25)',
            borderRadius: '10px',
            color: '#818cf8',
            fontWeight: 700,
            fontSize: '0.8rem',
            cursor: 'pointer',
          }}
        >
          <Edit2 size={13} /> Edit
        </button>
      </div>

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.5rem', marginBottom: '1rem' }}>
        {[
          { label: 'Members',  value: stats.total,    color: '#3b82f6' },
          { label: 'Managers', value: stats.managers, color: '#10b981' },
          { label: 'Depts',    value: stats.depts,    color: '#8b5cf6' },
        ].map(s => (
          <div key={s.label} style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderTop: `2px solid ${s.color}`,
            borderRadius: '10px',
            padding: '0.625rem 0.5rem',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '1.375rem', fontWeight: 800, color: s.color, lineHeight: 1, letterSpacing: '-0.04em' }}>{s.value}</div>
            <div style={{ fontSize: '0.6rem', fontWeight: 600, color: 'var(--text-muted)', marginTop: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
          </div>
        ))}
      </div>


      {/* Tree */}
      <div>
        {roots.length === 0 && nodes.length > 0 ? (
          nodes.map(node => (
            <MobileTreeNode key={node.id} nodeData={node} childIds={childrenMap[node.id] || []} nodesById={nodesById} childrenMap={childrenMap} />
          ))
        ) : (
          roots.map(root => (
            <MobileTreeNode key={root.id} nodeData={root} childIds={childrenMap[root.id] || []} nodesById={nodesById} childrenMap={childrenMap} />
          ))
        )}
      </div>

      {nodes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>No members in hierarchy yet.</div>
          <button
            onClick={onEdit}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '8px', color: '#818cf8', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}
          >
            <Plus size={13} /> Add members
          </button>
        </div>
      )}
    </div>
  );
}

// ── Mobile: form-based edit ───────────────────────────────────────────────────
function MobileEditView({ employees, initialMembers, deptMap, onSave, onCancel, saving }) {
  const [members, setMembers] = useState(initialMembers);
  const memberIds = useMemo(() => new Set(members.map(m => m.empId)), [members]);

  const toggleMember = (empId) => {
    if (memberIds.has(empId)) {
      setMembers(prev => prev.filter(m => m.empId !== empId));
    } else {
      setMembers(prev => [...prev, { empId, managerId: '' }]);
    }
  };

  const setManager = (empId, managerId) => {
    setMembers(prev => prev.map(m => m.empId === empId ? { ...m, managerId } : m));
  };

  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '1.25rem',
        paddingBottom: '1rem',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div>
          <h3 style={{ margin: 0, fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Edit Hierarchy</h3>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>Toggle members on, then assign their manager</p>
        </div>
        <button
          onClick={onCancel}
          style={{ width: 32, height: 32, borderRadius: '8px', background: 'var(--bg-raised)', border: '1px solid var(--border-default)', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Selected count */}
      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
        {members.length} of {employees.length} selected
      </div>

      {/* Employee list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', marginBottom: '1.5rem' }}>
        {employees.map(emp => {
          const name = getDisplayName(emp);
          const color = resolveColor({ ...emp, name }, deptMap);
          const inHierarchy = memberIds.has(emp.id);
          const member = members.find(m => m.empId === emp.id);

          return (
            <div
              key={emp.id}
              style={{
                background: inHierarchy ? `${color}07` : 'var(--bg-elevated)',
                border: `1px solid ${inHierarchy ? color + '30' : 'var(--border-default)'}`,
                borderRadius: '12px',
                overflow: 'hidden',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              {inHierarchy && <div style={{ height: 2, background: `linear-gradient(90deg, ${color}, ${color}77)` }} />}
              <div style={{ padding: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                  background: `${color}18`,
                  border: `2px solid ${inHierarchy ? color + '50' : color + '20'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.72rem', fontWeight: 800, color,
                }}>
                  {initials(name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                    {emp.role || 'No role'}{emp.department ? ` · ${emp.department}` : ''}
                  </div>
                </div>
                <button
                  onClick={() => toggleMember(emp.id)}
                  style={{
                    width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                    background: inHierarchy ? color : 'var(--bg-raised)',
                    border: `1.5px solid ${inHierarchy ? color : 'var(--border-default)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  {inHierarchy ? <Check size={14} color="#fff" /> : <Plus size={14} color="var(--text-muted)" />}
                </button>
              </div>
              {/* Manager select */}
              {inHierarchy && (
                <div style={{ padding: '0 0.75rem 0.75rem' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>
                    Reports to
                  </div>
                  <select
                    value={member?.managerId || ''}
                    onChange={e => setManager(emp.id, e.target.value)}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '8px',
                      border: `1px solid ${color}30`,
                      background: 'var(--background)',
                      color: 'var(--text-secondary)',
                      fontSize: '0.82rem',
                      outline: 'none',
                    }}
                  >
                    <option value="">— No manager (top-level) —</option>
                    {members
                      .filter(m => m.empId !== emp.id)
                      .map(m => {
                        const mEmp = employees.find(e => e.id === m.empId);
                        if (!mEmp) return null;
                        return <option key={m.empId} value={m.empId}>{getDisplayName(mEmp)}{mEmp.role ? ` (${mEmp.role})` : ''}</option>;
                      })}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.625rem' }}>
        <button
          onClick={onCancel}
          style={{ flex: 1, padding: '0.75rem', borderRadius: '12px', background: 'none', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(members)}
          disabled={saving}
          style={{ flex: 2, padding: '0.75rem', borderRadius: '12px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', color: '#fff', fontWeight: 700, fontSize: '0.875rem', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', boxShadow: saving ? 'none' : '0 4px 14px rgba(99,102,241,0.35)' }}
        >
          {saving ? (
            <><div className="pro-spinner" style={{ width: 14, height: 14, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} /> Saving…</>
          ) : (
            <><Save size={14} /> Save Hierarchy</>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Department Manager Panel ──────────────────────────────────────────────────
function DeptPanel({ departments, orgId, onClose, onChange }) {
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(DEPT_PALETTE[0]);
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    await storageService.saveDepartment({ name: newName.trim(), color: newColor }, orgId);
    setNewName('');
    setNewColor(DEPT_PALETTE[0]);
    setSaving(false);
    onChange();
  };

  const handleDelete = async (id) => {
    await storageService.deleteDepartment(id, orgId);
    onChange();
  };

  return (
    <div style={{ background: 'var(--bg-elevated)', borderRadius: '14px', boxShadow: '0 8px 32px rgba(0,0,0,0.35)', border: '1px solid var(--border-default)', padding: '1rem', width: 240 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Departments</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}><X size={14} /></button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '0.75rem', maxHeight: 200, overflowY: 'auto' }}>
        {departments.length === 0 && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', padding: '0.5rem 0' }}>No departments yet</div>}
        {departments.map(d => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0.4rem', borderRadius: '8px', background: 'rgba(255,255,255,0.03)' }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
            <button onClick={() => handleDelete(d.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, opacity: 0.5 }} onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.625rem' }}>
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Department name…" style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-default)', borderRadius: '8px', padding: '0.4rem 0.6rem', color: 'var(--text-primary)', fontSize: '0.78rem', outline: 'none', boxSizing: 'border-box', marginBottom: '0.5rem' }} onKeyDown={e => e.key === 'Enter' && handleAdd()} />
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          {DEPT_PALETTE.map(c => <div key={c} onClick={() => setNewColor(c)} style={{ width: 18, height: 18, borderRadius: '50%', background: c, cursor: 'pointer', boxShadow: newColor === c ? `0 0 0 2px var(--background), 0 0 0 4px ${c}` : 'none', transition: 'box-shadow 0.12s' }} />)}
        </div>
        <button onClick={handleAdd} disabled={saving || !newName.trim()} style={{ width: '100%', padding: '0.45rem', borderRadius: '8px', border: 'none', cursor: 'pointer', background: newColor, color: '#fff', fontSize: '0.75rem', fontWeight: 700, opacity: (!newName.trim() || saving) ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
          <Plus size={13} /> Add Department
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const nodeTypes = { employee: EmployeeNode };

export default function TeamHierarchy() {
  const { activeOrg } = useOrg();
  const winW = useWindowWidth();
  const isMobile = winW < 768;

  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [hasHierarchy, setHasHierarchy] = useState(false);
  const [showDeptPanel, setShowDeptPanel] = useState(false);
  const [mobileEdit, setMobileEdit] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [rfInstance, setRfInstance] = useState(null);

  const deptMap = useMemo(() => {
    const map = {};
    employees.forEach(e => { if (e.department && !map[e.department]) map[e.department] = hashColor(e.department); });
    departments.forEach(d => { if (d.name) map[d.name] = d.color; });
    return map;
  }, [employees, departments]);

  const allDeptNames = useMemo(() =>
    [...new Set(employees.map(e => e.department).filter(Boolean))].sort(),
    [employees]
  );

  const loadDepartments = useCallback(async () => {
    if (!activeOrg?.id) return;
    const depts = await storageService.getDepartments(activeOrg.id);
    setDepartments(depts);
  }, [activeOrg?.id]);

  useEffect(() => {
    if (!activeOrg?.id) return;
    (async () => {
      setLoading(true);
      const [emps, depts, snap] = await Promise.all([
        storageService.getEmployees(activeOrg.id),
        storageService.getDepartments(activeOrg.id),
        get(ref(db, `hierarchy/${activeOrg.id}`)),
      ]);
      setEmployees(emps);
      setDepartments(depts);
      const dm = Object.fromEntries(depts.map(d => [d.name, d.color]));
      if (snap.exists()) {
        const empMap = Object.fromEntries(emps.map(e => [e.id, e]));
        const { nodes: fn, edges: fe } = buildFlowData(snap.val(), empMap, dm);
        if (fn.length > 0) { setNodes(fn); setEdges(fe); setHasHierarchy(true); }
      }
      setLoading(false);
    })();
  }, [activeOrg?.id]);

  const onConnect = useCallback((params) => {
    const tgtNode = nodes.find(n => n.id === params.target);
    const color = tgtNode?.data.color || '#6366f1';
    setEdges(eds => addEdge({ ...params, id: `e-${params.source}-${params.target}-${Date.now()}`, type: 'smoothstep', animated: false, markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 }, style: { stroke: color, strokeWidth: 1.5, opacity: 0.65 } }, eds));
  }, [nodes, setEdges]);

  const handleSetupHierarchy = () => { setNodes([]); setEdges([]); setEditMode(true); };

  const onDragOver = useCallback((event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }, []);

  const onDrop = useCallback((event) => {
    event.preventDefault();
    if (!rfInstance || !editMode) return;
    const empId = event.dataTransfer.getData('application/reactflow-emp');
    if (!empId) return;
    const emp = employees.find(e => e.id === empId);
    if (!emp || nodes.some(n => n.id === empId)) return;
    const position = rfInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const name = getDisplayName(emp);
    const color = resolveColor({ ...emp, name }, deptMap);
    setNodes(nds => [...nds, { id: emp.id, type: 'employee', position, data: { name, email: emp.email || '', role: emp.role || '', department: emp.department || '', color } }]);
  }, [rfInstance, editMode, employees, nodes, deptMap, setNodes]);

  // Accept optional override nodes/edges (used by mobile save)
  const handleSave = async (overrideNodes = null, overrideEdges = null) => {
    setSaving(true);
    try {
      const orgId = activeOrg.id;
      const saveNodes = overrideNodes || nodes;
      const saveEdges = overrideEdges || edges;

      const nodesObj = Object.fromEntries(saveNodes.map(n => [n.id, { id: n.id, position: n.position }]));
      const edgesObj = Object.fromEntries(saveEdges.map(e => [e.id, { id: e.id, source: e.source, target: e.target }]));
      await set(ref(db, `hierarchy/${orgId}`), { nodes: nodesObj, edges: edgesObj });

      const empMap = Object.fromEntries(employees.map(e => [e.id, e]));
      const supervisorOf = {};
      saveEdges.forEach(e => { supervisorOf[e.target] = e.source; });

      const updatePromises = [];
      for (const node of saveNodes) {
        const emp = empMap[node.id];
        if (!emp) continue;
        const managerId = supervisorOf[node.id];
        const managerNode = managerId ? saveNodes.find(n => n.id === managerId) : null;
        const newSupervisor = managerNode ? managerNode.data.name : '';
        if (emp.supervisorName !== newSupervisor) {
          updatePromises.push(storageService.updateEmployee(emp.id, { supervisorName: newSupervisor }, orgId));
        }
      }
      await Promise.all(updatePromises);

      setHasHierarchy(true);
      setEditMode(false);
      setMobileEdit(false);
    } catch (err) {
      alert('Failed to save: ' + err.message);
    }
    setSaving(false);
  };

  // Mobile save: convert form state to nodes/edges then save
  const handleMobileSave = async (members) => {
    // Auto-layout: simple grid
    const newNodes = members.map((m, i) => {
      const emp = employees.find(e => e.id === m.empId);
      if (!emp) return null;
      const name = getDisplayName(emp);
      const color = resolveColor({ ...emp, name }, deptMap);
      const existingPos = nodes.find(n => n.id === emp.id)?.position;
      const cols = 3;
      const autoPos = { x: (i % cols) * 280 + 60, y: Math.floor(i / cols) * 160 + 60 };
      return { id: emp.id, type: 'employee', position: existingPos || autoPos, data: { name, email: emp.email || '', role: emp.role || '', department: emp.department || '', color } };
    }).filter(Boolean);

    const newEdges = members.filter(m => m.managerId).map(m => {
      const tgtNode = newNodes.find(n => n.id === m.empId);
      const color = tgtNode?.data.color || '#6366f1';
      return { id: `e-${m.managerId}-${m.empId}`, source: m.managerId, target: m.empId, type: 'smoothstep', animated: false, markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 }, style: { stroke: color, strokeWidth: 1.5, opacity: 0.65 } };
    });

    setNodes(newNodes);
    setEdges(newEdges);
    await handleSave(newNodes, newEdges);
  };

  const handleCancelEdit = async () => {
    setEditMode(false);
    setMobileEdit(false);
    if (!hasHierarchy) { setNodes([]); setEdges([]); return; }
    const snap = await get(ref(db, `hierarchy/${activeOrg.id}`));
    if (snap.exists()) {
      const empMap = Object.fromEntries(employees.map(e => [e.id, e]));
      const { nodes: fn, edges: fe } = buildFlowData(snap.val(), empMap, deptMap);
      setNodes(fn); setEdges(fe);
    }
  };

  const onKeyDown = useCallback((e) => {
    if (!editMode) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      setEdges(eds => eds.filter(ed => !ed.selected));
      setNodes(nds => nds.filter(nd => !nd.selected));
    }
  }, [editMode, setEdges, setNodes]);

  const stats = useMemo(() => ({
    total:    employees.length,
    managers: new Set(edges.map(e => e.source)).size,
    depts:    allDeptNames.length,
  }), [employees, edges, allDeptNames]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '0.75rem', color: 'rgba(255,255,255,0.4)' }}>
      <div className="pro-spinner" />
      <span style={{ fontSize: '0.85rem' }}>Loading team data…</span>
    </div>
  );

  if (employees.length === 0) return (
    <div style={{ textAlign: 'center', padding: '5rem 2rem' }}>
      <div style={{ width: 56, height: 56, borderRadius: '16px', background: 'rgba(59,130,246,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
        <Users size={26} color="#3b82f6" />
      </div>
      <h3 style={{ margin: '0 0 0.4rem', fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>No employees found</h3>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Add employees first, then build the hierarchy.</p>
    </div>
  );

  // ── Mobile view ──────────────────────────────────────────────────────────
  if (isMobile) {
    // Compute initial members from current nodes/edges for edit form
    const getMobileInitialMembers = () => {
      const supervisorOf = {};
      edges.forEach(e => { supervisorOf[e.target] = e.source; });
      return nodes.map(n => ({ empId: n.id, managerId: supervisorOf[n.id] || '' }));
    };

    const mobileWrap = { padding: '1.25rem', overflowY: 'auto', height: '100%', boxSizing: 'border-box' };

    if (mobileEdit) {
      return (
        <div style={mobileWrap}>
          <MobileEditView
            employees={employees}
            initialMembers={getMobileInitialMembers()}
            deptMap={deptMap}
            onSave={handleMobileSave}
            onCancel={handleCancelEdit}
            saving={saving}
          />
        </div>
      );
    }

    return (
      <div style={mobileWrap}>
        <MobileHierarchyView
          nodes={nodes}
          edges={edges}
          employees={employees}
          departments={departments}
          deptMap={deptMap}
          allDeptNames={allDeptNames}
          stats={stats}
          hasHierarchy={hasHierarchy}
          onEdit={() => setMobileEdit(true)}
          onSetup={() => setMobileEdit(true)}
        />
      </div>
    );
  }

  // ── Desktop: empty state ─────────────────────────────────────────────────
  if (!hasHierarchy && !editMode) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '62vh', gap: '1.75rem', padding: '2rem' }}>
      <div style={{ width: 72, height: 72, borderRadius: '20px', background: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 40px rgba(99,102,241,0.15)' }}>
        <GitBranch size={32} color="#6366f1" />
      </div>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <h2 style={{ margin: '0 0 0.5rem', fontWeight: 800, fontSize: '1.5rem', color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>Build your org chart</h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.65 }}>
          {employees.length} employee{employees.length !== 1 ? 's' : ''} ready. Drag them from the sidebar onto the canvas, then connect to define reporting lines.
        </p>
      </div>
      <button className="btn-cinematic" onClick={handleSetupHierarchy} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1.5rem', fontSize: '0.875rem' }}>
        <GitBranch size={15} /> Get Started
      </button>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center', maxWidth: 520 }}>
        {employees.slice(0, 7).map(emp => {
          const name = getDisplayName(emp);
          const color = resolveColor({ ...emp, name }, deptMap);
          return (
            <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', background: 'rgba(255,255,255,0.04)', borderRadius: '99px', padding: '0.35rem 0.7rem 0.35rem 0.35rem' }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: `${color}22`, border: `1.5px solid ${color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.58rem', fontWeight: 800, color }}>{initials(name)}</div>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{name}</span>
            </div>
          );
        })}
        {employees.length > 7 && <div style={{ display: 'flex', alignItems: 'center', padding: '0.35rem 0.7rem', color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem' }}>+{employees.length - 7} more</div>}
      </div>
    </div>
  );

  // ── Desktop: Flow canvas ─────────────────────────────────────────────────
  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }} onKeyDown={onKeyDown} onDrop={onDrop} onDragOver={onDragOver} tabIndex={0}>
      <ReactFlow
        nodes={nodes} edges={edges}
        onNodesChange={editMode ? onNodesChange : undefined}
        onEdgesChange={editMode ? onEdgesChange : undefined}
        onConnect={editMode ? onConnect : undefined}
        onInit={setRfInstance}
        nodeTypes={nodeTypes}
        fitView fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={editMode} nodesConnectable={editMode} elementsSelectable={editMode}
        panOnDrag zoomOnScroll
        style={{ background: 'var(--background)' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="rgba(128,128,128,0.22)" />
        <Controls showInteractive={false} style={{ background: 'var(--bg-elevated)', backdropFilter: 'blur(16px)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border-default)' }} />

        <Panel position="top-left">
          <div style={{ background: 'var(--bg-elevated)', backdropFilter: 'blur(20px)', borderRadius: '14px', padding: '1rem 1.25rem', boxShadow: '0 2px 10px rgba(0,0,0,0.18)', border: '1px solid var(--border-default)', minWidth: 220 }}>
            <p style={{ margin: '0 0 0.875rem', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Team Overview</p>
            <div style={{ display: 'flex', gap: '1.25rem', marginBottom: departments.length > 0 ? '0.75rem' : 0 }}>
              {[
                { label: 'Members',  value: stats.total,    color: '#3b82f6' },
                { label: 'Managers', value: stats.managers, color: '#10b981' },
                { label: 'Depts',    value: stats.depts,    color: '#8b5cf6' },
              ].map(s => (
                <div key={s.label}>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: s.color, lineHeight: 1, letterSpacing: '-0.04em' }}>{s.value}</div>
                  <div style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--text-muted)', marginTop: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
                </div>
              ))}
            </div>
            {allDeptNames.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.75rem' }}>
                {allDeptNames.map(name => (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: deptMap[name], flexShrink: 0 }} />
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{name}</span>
                  </div>
                ))}
              </div>
            )}
            {editMode && (
              <div style={{ marginTop: '0.875rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)', fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.65 }}>
                Drag employees from list → canvas<br />
                Connect dots to link · Move cards<br />
                <span style={{ color: 'rgba(239,68,68,0.6)' }}>Delete</span> key removes selected
              </div>
            )}
          </div>
        </Panel>

        {showDeptPanel && (
          <Panel position="top-right">
            <DeptPanel departments={departments} orgId={activeOrg.id} onClose={() => setShowDeptPanel(false)} onChange={loadDepartments} />
          </Panel>
        )}

        {editMode && !showDeptPanel && (
          <Panel position="top-right">
            <div style={{ background: 'var(--bg-elevated)', backdropFilter: 'blur(20px)', borderRadius: '14px', padding: '0.875rem', boxShadow: '0 8px 32px rgba(0,0,0,0.35)', border: '1px solid var(--border-default)', width: 205, maxHeight: '54vh', overflowY: 'auto' }}>
              <p style={{ margin: '0 0 0.625rem', fontSize: '0.67rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>All Employees ({employees.length})</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {employees.map(emp => {
                  const name = getDisplayName(emp);
                  const color = resolveColor({ ...emp, name }, deptMap);
                  const onCanvas = nodes.some(n => n.id === emp.id);
                  return (
                    <div key={emp.id} draggable={!onCanvas} onDragStart={!onCanvas ? (e) => { e.dataTransfer.setData('application/reactflow-emp', emp.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.5rem', borderRadius: '9px', background: onCanvas ? `${color}12` : 'rgba(255,255,255,0.03)', cursor: onCanvas ? 'default' : 'grab', userSelect: 'none', transition: 'background 0.12s' }}
                      onMouseEnter={e => { if (!onCanvas) e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = onCanvas ? `${color}12` : 'rgba(255,255,255,0.03)'; }}
                    >
                      <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, background: `${color}1e`, border: `1.5px solid ${color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.58rem', fontWeight: 800, color }}>{initials(name)}</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: onCanvas ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{onCanvas ? 'On canvas' : emp.role || 'Drag to canvas'}</div>
                      </div>
                      {!onCanvas && <div style={{ fontSize: '0.55rem', color: 'var(--text-muted)', opacity: 0.5, flexShrink: 0 }}>⠿</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </Panel>
        )}

        <Panel position="bottom-center">
          <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-elevated)', backdropFilter: 'blur(20px)', borderRadius: '99px', boxShadow: '0 8px 32px rgba(0,0,0,0.35)', border: '1px solid var(--border-default)', overflow: 'hidden', marginBottom: '0.5rem' }}>
            {!editMode ? (
              <>
                <TBtn accent icon={<Edit2 size={13} />} label="Edit Structure" onClick={() => { setEditMode(true); if (!hasHierarchy) handleSetupHierarchy(); }} />
                <Sep />
                <TBtn icon={<Users size={13} />} label={`${employees.length} Members`} />
                <Sep />
                <TBtn icon={<GitBranch size={13} />} label={`${edges.length} Links`} />
                <Sep />
                <TBtn icon={<Plus size={13} />} label="Departments" onClick={() => setShowDeptPanel(p => !p)} />
              </>
            ) : (
              <>
                <TBtn accent icon={saving ? <div className="pro-spinner" style={{ width: 13, height: 13 }} /> : <Save size={13} />} label={saving ? 'Saving…' : 'Save'} onClick={() => handleSave()} disabled={saving} />
                <Sep />
                <TBtn icon={<Plus size={13} />} label="Departments" onClick={() => setShowDeptPanel(p => !p)} />
                <Sep />
                <TBtn icon={<X size={13} />} label="Cancel" onClick={handleCancelEdit} />
              </>
            )}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

function Sep() {
  return <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.07)' }} />;
}

function TBtn({ icon, label, onClick, accent, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.65rem 1.05rem', background: 'none', border: 'none', color: accent ? '#818cf8' : 'var(--text-tertiary)', fontSize: '0.78rem', fontWeight: accent ? 700 : 600, cursor: disabled ? 'not-allowed' : (onClick ? 'pointer' : 'default'), opacity: disabled ? 0.45 : 1, transition: 'color 0.12s', whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}
      onMouseEnter={e => { if (!disabled && onClick) e.currentTarget.style.color = accent ? '#a5b4fc' : 'var(--text-primary)'; }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.color = accent ? '#818cf8' : 'var(--text-tertiary)'; }}
    >
      {icon}<span>{label}</span>
    </button>
  );
}
