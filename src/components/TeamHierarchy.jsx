import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import {
  ReactFlow, addEdge, useNodesState, useEdgesState,
  Background, Handle, Position, MarkerType, BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { storageService } from '../services/storageService';
import { orgStore } from '../services/orgStore';
import { useOrg } from '../context/OrgContext';
import { MONO, makeTokens } from '../theme/edge';
import { useEdgeTheme } from '../theme/EdgeTheme';
import { EmployeePhotoFill } from './shared/EmployeeAvatar';
import { confirmDialog } from '../services/confirm';

/* ══════════════════════════════════════════════════════════════════════════
   Org chart.

   Every control is docked — a toolbar above the canvas and a people panel
   beside it — rather than floating over the chart. The old layout put the
   stats, the employee list and the action bar on top of the diagram, which
   meant the three things you needed at once were covering the thing you were
   working on.

   Placing a person does not require a mouse drag: the panel's rows are
   buttons, and activating one drops that person onto the canvas. Drag still
   works for people who prefer it.
   ══════════════════════════════════════════════════════════════════════════ */

// Department colour is the one place colour is allowed here: it is identity,
// not decoration. Kept for the pages that already import this palette.
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
  return null;
}

function initials(name = '') {
  return name.trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
}

function getDisplayName(emp) {
  if (emp.studentName) return emp.studentName;
  const f = (emp.first_name || '').trim();
  const l = (emp.last_name || '').trim();
  return `${f} ${l}`.trim() || emp.email || 'Unknown';
}

function useWindowWidth() {
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440));
  useEffect(() => {
    const handler = () => setW(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return w;
}

/* ── node ─────────────────────────────────────────────────────────────────── */

// Tokens reach the node through context rather than through node data:
// ReactFlow memoises node components on their data object, so carrying a token
// object in there would invalidate every node on every render.
const TokenCtx = createContext(makeTokens(true));

function EmployeeNode({ data, selected }) {
  const t = useContext(TokenCtx);
  const accent = data.color;
  return (
    <div style={{ position: 'relative', width: 218, fontFamily: MONO }}>
      <Handle type="target" position={Position.Top}
        style={{ width: 7, height: 7, background: t.dim, border: '1.5px solid ' + t.panel, top: -4, zIndex: 10 }} />
      <div style={{
        background: t.panel,
        border: '1px solid ' + (selected ? t.text : t.line),
        boxShadow: selected ? '0 0 0 3px ' + (t.isDark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.07)') : 'none',
        borderRadius: 9, overflow: 'hidden',
        transition: 'border-color .15s, box-shadow .15s',
      }}>
        <div style={{ display: 'flex' }}>
          <div style={{ width: 2, background: accent || t.lineStrong, flexShrink: 0 }} />
          <div style={{ padding: '10px 12px', minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{
                position: 'relative', overflow: 'hidden', flexShrink: 0,
                width: 28, height: 28, borderRadius: 6,
                background: t.panelAlt, border: '1px solid ' + t.line,
                display: 'grid', placeItems: 'center',
                fontSize: 10, fontWeight: 600, color: t.dim,
              }}>
                {initials(data.name)}
                <EmployeePhotoFill photoPath={data.photo_path} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontSize: 12, fontWeight: 500, color: t.text, letterSpacing: '-0.01em',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{data.name}</div>
                {data.role && (
                  <div style={{
                    fontSize: 9.5, color: t.faint, marginTop: 2,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{data.role}</div>
                )}
              </div>
            </div>
            {data.department && (
              <div style={{
                marginTop: 8, paddingTop: 7, borderTop: '1px solid ' + t.lineSoft,
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 9, letterSpacing: '0.05em', color: t.faint,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: accent || t.ghost, flexShrink: 0 }} />
                {data.department.toUpperCase()}
              </div>
            )}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom}
        style={{ width: 7, height: 7, background: t.dim, border: '1.5px solid ' + t.panel, bottom: -4, zIndex: 10 }} />
    </div>
  );
}

const nodeTypes = { employee: EmployeeNode };

function edgeStyle(t) {
  return {
    type: 'smoothstep',
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed, color: t.dim, width: 14, height: 14 },
    style: { stroke: t.lineStrong, strokeWidth: 1.4 },
  };
}

function buildFlowData(hierData, empMap, deptMap, t) {
  const hierNodes = Object.values(hierData.nodes || {});
  const hierEdges = Object.values(hierData.edges || {});
  const nodes = hierNodes.filter((n) => empMap[n.id]).map((n) => {
    const emp = empMap[n.id];
    const name = getDisplayName(emp);
    return {
      id: n.id, type: 'employee', position: n.position || { x: 0, y: 0 },
      data: {
        name, email: emp.email || '', role: emp.role || '',
        department: emp.department || '', color: resolveColor(emp, deptMap),
        photo_path: emp.photo_path || null,
      },
    };
  });
  const nodeSet = new Set(nodes.map((n) => n.id));
  const edges = hierEdges
    .filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target))
    .map((e) => ({ id: e.id, source: e.source, target: e.target, ...edgeStyle(t) }));
  return { nodes, edges };
}

/* Tidy tree layout. Rows are depth, columns are order within depth; anyone with
   no manager starts a new tree at the top. */
function autoLayout(nodes, edges) {
  const parent = {};
  edges.forEach((e) => { parent[e.target] = e.source; });
  const children = {};
  nodes.forEach((n) => { children[n.id] = []; });
  edges.forEach((e) => { if (children[e.source]) children[e.source].push(e.target); });

  const roots = nodes.filter((n) => !parent[n.id]).map((n) => n.id);
  const COL = 254, ROW = 132;
  const placed = {};
  let cursor = 0;

  const walk = (id, depth, seen) => {
    if (seen.has(id)) return cursor;
    seen.add(id);
    const kids = children[id] || [];
    if (kids.length === 0) {
      placed[id] = { x: cursor * COL, y: depth * ROW };
      cursor += 1;
      return cursor;
    }
    const first = cursor;
    kids.forEach((k) => walk(k, depth + 1, seen));
    const last = cursor - 1;
    placed[id] = { x: ((first + last) / 2) * COL, y: depth * ROW };
    return cursor;
  };

  const seen = new Set();
  roots.forEach((r) => walk(r, 0, seen));
  // Anything left is part of a cycle, or orphaned; park it on its own row.
  nodes.forEach((n) => {
    if (!placed[n.id]) { placed[n.id] = { x: cursor * COL, y: 0 }; cursor += 1; }
  });

  return nodes.map((n) => ({ ...n, position: placed[n.id] }));
}

/* ── small themed primitives ──────────────────────────────────────────────── */

function Btn({ t, children, onClick, primary, disabled, title, danger }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={title}
      className={'th-btn' + (primary ? ' th-primary' : '')}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 29, padding: '0 12px', borderRadius: 7,
        fontFamily: MONO, fontSize: 11.5, whiteSpace: 'nowrap',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
        border: '1px solid ' + (primary ? t.text : t.line),
        background: primary ? t.text : t.panel,
        color: primary ? t.panel : (danger ? t.down : t.text),
        transition: 'border-color .15s, background .15s, color .15s',
      }}
    >{children}</button>
  );
}

function Stat({ t, label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: 14, fontWeight: 500, color: t.text, letterSpacing: '-0.02em' }}>{value}</span>
      <span style={{ fontSize: 9, letterSpacing: '0.09em', color: t.faint }}>{label}</span>
    </div>
  );
}

/* ── people panel ─────────────────────────────────────────────────────────── */

function PeoplePanel({ t, employees, nodes, deptMap, editMode, onPlace, onFocus, onRemove }) {
  const [q, setQ] = useState('');
  const placed = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return employees
      .map((e) => ({ emp: e, name: getDisplayName(e) }))
      .filter(({ emp, name }) => !needle
        || name.toLowerCase().includes(needle)
        || (emp.role || '').toLowerCase().includes(needle)
        || (emp.department || '').toLowerCase().includes(needle))
      .sort((a, b) => Number(placed.has(b.emp.id)) - Number(placed.has(a.emp.id)) || a.name.localeCompare(b.name));
  }, [employees, q, placed]);

  const unplaced = employees.length - placed.size;

  return (
    <aside style={{
      width: 246, flexShrink: 0, display: 'flex', flexDirection: 'column',
      borderRight: '1px solid ' + t.line, background: t.panel, minHeight: 0,
    }}>
      <div style={{ padding: '12px 12px 10px', borderBottom: '1px solid ' + t.lineSoft }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
          <span style={{ fontSize: 9.5, letterSpacing: '0.1em', color: t.faint, flex: 1 }}>PEOPLE</span>
          <span style={{ fontSize: 9.5, color: t.ghost }}>{placed.size}/{employees.length} placed</span>
        </div>
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, role, team…"
          aria-label="Search people"
          style={{
            width: '100%', boxSizing: 'border-box', height: 29, padding: '0 10px',
            background: t.panelAlt, border: '1px solid ' + t.line, borderRadius: 7,
            color: t.text, fontFamily: MONO, fontSize: 11, outline: 'none',
          }}
        />
      </div>

      <div className="edge-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 7 }}>
        {list.length === 0 && (
          <div style={{ padding: '26px 10px', textAlign: 'center', fontSize: 10.5, color: t.faint }}>
            No one matches “{q}”
          </div>
        )}
        {list.map(({ emp, name }) => {
          const on = placed.has(emp.id);
          const accent = resolveColor(emp, deptMap);
          return (
            <div
              key={emp.id}
              draggable={editMode && !on}
              onDragStart={editMode && !on ? (e) => {
                e.dataTransfer.setData('application/reactflow-emp', emp.id);
                e.dataTransfer.effectAllowed = 'move';
              } : undefined}
              style={{ display: 'flex', alignItems: 'stretch', gap: 2, marginBottom: 1 }}
            >
              <button
                type="button"
                className="th-person"
                onClick={() => (on ? onFocus(emp.id) : (editMode ? onPlace(emp.id) : null))}
                disabled={!on && !editMode}
                title={on ? 'Show on the chart' : (editMode ? 'Place on the chart' : 'Turn on Edit structure to place')}
                style={{
                  flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9,
                  padding: '7px 8px', borderRadius: 7, textAlign: 'left',
                  background: 'transparent', border: '1px solid transparent',
                  cursor: (on || editMode) ? 'pointer' : 'default',
                  fontFamily: MONO, color: t.text,
                  opacity: (on || editMode) ? 1 : 0.55,
                }}
              >
                <span style={{
                  width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                  background: t.panelAlt, border: '1px solid ' + t.line,
                  display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 600,
                  color: on ? t.text : t.faint,
                }}>{initials(name)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: 'block', fontSize: 11, color: on ? t.text : t.dim,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{name}</span>
                  <span style={{
                    display: 'block', fontSize: 9, color: t.faint, marginTop: 1,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{emp.role || (on ? 'On chart' : 'Not placed')}</span>
                </span>
                {accent && <span style={{ width: 4, height: 4, borderRadius: '50%', background: accent, flexShrink: 0 }} />}
                {!on && editMode && <span style={{ fontSize: 13, color: t.ghost, flexShrink: 0, lineHeight: 1 }}>+</span>}
              </button>
              {on && editMode && (
                <button
                  type="button" className="th-btn" onClick={() => onRemove(emp.id)}
                  title={'Remove ' + name + ' from the chart'} aria-label={'Remove ' + name + ' from the chart'}
                  style={{
                    width: 24, flexShrink: 0, borderRadius: 6, cursor: 'pointer',
                    background: 'transparent', border: '1px solid transparent',
                    color: t.ghost, fontFamily: MONO, fontSize: 13, lineHeight: 1,
                  }}
                >×</button>
              )}
            </div>
          );
        })}
      </div>

      <div style={{
        padding: '9px 12px', borderTop: '1px solid ' + t.lineSoft,
        fontSize: 9.5, color: t.faint, lineHeight: 1.6,
      }}>
        {editMode
          ? <>Click a name to place it · drag from a dot to link<br />Select a card or line and press <b style={{ color: t.dim }}>Delete</b></>
          : (unplaced > 0
            ? unplaced + ' not on the chart yet'
            : 'Everyone is on the chart')}
      </div>
    </aside>
  );
}

/* ── departments drawer ───────────────────────────────────────────────────── */

function DeptDrawer({ t, departments, employees, orgId, onClose, onChange }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEPT_PALETTE[0]);
  const [busy, setBusy] = useState(false);

  const counts = useMemo(() => {
    const m = {};
    employees.forEach((e) => { if (e.department) m[e.department] = (m[e.department] || 0) + 1; });
    return m;
  }, [employees]);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    await storageService.saveDepartment({ name: name.trim(), color }, orgId);
    setName(''); setColor(DEPT_PALETTE[0]); setBusy(false);
    onChange();
  };

  return (
    <aside style={{
      width: 262, flexShrink: 0, display: 'flex', flexDirection: 'column',
      borderLeft: '1px solid ' + t.line, background: t.panel, minHeight: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '12px 12px 10px', borderBottom: '1px solid ' + t.lineSoft,
      }}>
        <span style={{ fontSize: 9.5, letterSpacing: '0.1em', color: t.faint, flex: 1 }}>DEPARTMENTS</span>
        <button type="button" className="th-btn" onClick={onClose} aria-label="Close departments"
          style={{
            width: 22, height: 22, borderRadius: 5, cursor: 'pointer',
            background: 'transparent', border: '1px solid transparent',
            color: t.faint, fontFamily: MONO, fontSize: 13, lineHeight: 1,
          }}>×</button>
      </div>

      <div className="edge-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 7 }}>
        {departments.length === 0 && (
          <div style={{ padding: '22px 10px', textAlign: 'center', fontSize: 10.5, color: t.faint }}>
            No departments yet
          </div>
        )}
        {departments.map((d) => (
          <div key={d.id} className="th-row" style={{
            display: 'flex', alignItems: 'center', gap: 9,
            padding: '7px 8px', borderRadius: 7,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
            <span style={{
              flex: 1, minWidth: 0, fontSize: 11, color: t.text,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{d.name}</span>
            <span style={{ fontSize: 9.5, color: t.ghost, flexShrink: 0 }}>{counts[d.name] || 0}</span>
            <button
              type="button" className="th-btn"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: 'Delete department',
                  message: `Are you sure you want to delete the ${d.name} department? People in it keep their records.`,
                });
                if (ok) storageService.deleteDepartment(d.id, orgId).then(onChange);
              }}
              aria-label={'Delete ' + d.name}
              style={{
                width: 20, flexShrink: 0, borderRadius: 5, cursor: 'pointer',
                background: 'transparent', border: '1px solid transparent',
                color: t.ghost, fontFamily: MONO, fontSize: 12, lineHeight: 1,
              }}
            >×</button>
          </div>
        ))}
      </div>

      <div style={{ padding: 12, borderTop: '1px solid ' + t.lineSoft }}>
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="New department…" aria-label="New department name"
          style={{
            width: '100%', boxSizing: 'border-box', height: 29, padding: '0 10px',
            background: t.panelAlt, border: '1px solid ' + t.line, borderRadius: 7,
            color: t.text, fontFamily: MONO, fontSize: 11, outline: 'none', marginBottom: 9,
          }}
        />
        <div role="radiogroup" aria-label="Department colour" style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
          {DEPT_PALETTE.map((c) => (
            <button
              key={c} type="button" onClick={() => setColor(c)}
              role="radio" aria-checked={color === c} aria-label={'Colour ' + c}
              style={{
                width: 16, height: 16, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                border: '2px solid ' + (color === c ? t.text : 'transparent'),
                outlineOffset: 1,
              }}
            />
          ))}
        </div>
        <Btn t={t} primary onClick={add} disabled={busy || !name.trim()}>Add department</Btn>
      </div>
    </aside>
  );
}

/* ── mobile ───────────────────────────────────────────────────────────────── */

function MobileTree({ t, nodes, edges, deptMap, employees, onEdit }) {
  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const childrenMap = useMemo(() => {
    const m = {};
    nodes.forEach((n) => { m[n.id] = []; });
    edges.forEach((e) => { if (m[e.source]) m[e.source].push(e.target); });
    return m;
  }, [nodes, edges]);
  const hasParent = useMemo(() => new Set(edges.map((e) => e.target)), [edges]);
  const roots = nodes.filter((n) => !hasParent.has(n.id));

  const Row = ({ id, depth }) => {
    const n = byId[id];
    if (!n) return null;
    const kids = childrenMap[id] || [];
    return (
      <div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9,
          padding: '9px 10px', marginLeft: depth * 14,
          borderLeft: depth ? '1px solid ' + t.lineSoft : 'none',
          borderBottom: '1px solid ' + t.lineSoft,
        }}>
          <span style={{
            width: 26, height: 26, borderRadius: 6, flexShrink: 0,
            background: t.panelAlt, border: '1px solid ' + t.line,
            display: 'grid', placeItems: 'center', fontSize: 9.5, color: t.dim,
          }}>{initials(n.data.name)}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 12, color: t.text }}>{n.data.name}</span>
            <span style={{ display: 'block', fontSize: 9.5, color: t.faint, marginTop: 1 }}>
              {n.data.role || '—'}{n.data.department ? ' · ' + n.data.department : ''}
            </span>
          </span>
          {kids.length > 0 && <span style={{ fontSize: 9.5, color: t.ghost }}>{kids.length}</span>}
        </div>
        {kids.map((k) => <Row key={k} id={k} depth={depth + 1} />)}
      </div>
    );
  };

  return (
    <div style={{ fontFamily: MONO }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        padding: '12px 12px 14px',
      }}>
        <Stat t={t} label="MEMBERS" value={nodes.length} />
        <Stat t={t} label="LINKS" value={edges.length} />
        <Stat t={t} label="DEPTS" value={Object.keys(deptMap).length} />
        <div style={{ flex: 1 }} />
        <Btn t={t} primary onClick={onEdit}>Edit</Btn>
      </div>
      <div style={{ border: '1px solid ' + t.line, borderRadius: 10, overflow: 'hidden' }}>
        {nodes.length === 0 ? (
          <div style={{ padding: '30px 14px', textAlign: 'center', fontSize: 11, color: t.faint }}>
            Nobody is on the chart yet. {employees.length} {employees.length === 1 ? 'person' : 'people'} available.
          </div>
        ) : (roots.length ? roots : nodes).map((n) => <Row key={n.id} id={n.id} depth={0} />)}
      </div>
    </div>
  );
}

function MobileEdit({ t, employees, initialMembers, onSave, onCancel, saving }) {
  const [members, setMembers] = useState(initialMembers);
  const ids = useMemo(() => new Set(members.map((m) => m.empId)), [members]);

  const toggle = (id) => setMembers((prev) => (ids.has(id)
    ? prev.filter((m) => m.empId !== id)
    : [...prev, { empId: id, managerId: '' }]));

  return (
    <div style={{ fontFamily: MONO, padding: 12 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
        paddingBottom: 12, borderBottom: '1px solid ' + t.lineSoft,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: t.text }}>Edit structure</div>
          <div style={{ fontSize: 10, color: t.faint, marginTop: 2 }}>
            {members.length} of {employees.length} on the chart
          </div>
        </div>
        <Btn t={t} onClick={onCancel}>Cancel</Btn>
        <Btn t={t} primary onClick={() => onSave(members)} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Btn>
      </div>

      <div style={{ border: '1px solid ' + t.line, borderRadius: 10, overflow: 'hidden' }}>
        {employees.map((emp, i) => {
          const name = getDisplayName(emp);
          const on = ids.has(emp.id);
          const member = members.find((m) => m.empId === emp.id);
          return (
            <div key={emp.id} style={{ borderBottom: i < employees.length - 1 ? '1px solid ' + t.lineSoft : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12, color: on ? t.text : t.dim }}>{name}</span>
                  <span style={{ display: 'block', fontSize: 9.5, color: t.faint, marginTop: 1 }}>
                    {emp.role || '—'}{emp.department ? ' · ' + emp.department : ''}
                  </span>
                </span>
                <button
                  type="button" onClick={() => toggle(emp.id)}
                  aria-pressed={on} aria-label={(on ? 'Remove ' : 'Add ') + name}
                  style={{
                    height: 26, padding: '0 10px', borderRadius: 6, cursor: 'pointer',
                    fontFamily: MONO, fontSize: 10.5,
                    border: '1px solid ' + (on ? t.text : t.line),
                    background: on ? t.text : t.panel,
                    color: on ? t.panel : t.dim,
                  }}
                >{on ? 'On' : 'Add'}</button>
              </div>
              {on && (
                <div style={{ padding: '0 10px 10px' }}>
                  <label style={{ display: 'block', fontSize: 9, letterSpacing: '0.08em', color: t.faint, marginBottom: 4 }}>
                    REPORTS TO
                  </label>
                  <select
                    value={member?.managerId || ''}
                    onChange={(e) => setMembers((prev) => prev.map((m) => (m.empId === emp.id ? { ...m, managerId: e.target.value } : m)))}
                    style={{
                      width: '100%', boxSizing: 'border-box', height: 30, padding: '0 8px',
                      background: t.panelAlt, border: '1px solid ' + t.line, borderRadius: 6,
                      color: t.text, fontFamily: MONO, fontSize: 11, outline: 'none',
                    }}
                  >
                    <option value="">Nobody — top level</option>
                    {members.filter((m) => m.empId !== emp.id).map((m) => {
                      const e2 = employees.find((x) => x.id === m.empId);
                      return e2 ? <option key={m.empId} value={m.empId}>{getDisplayName(e2)}</option> : null;
                    })}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── main ─────────────────────────────────────────────────────────────────── */

export default function TeamHierarchy() {
  const { activeOrg } = useOrg();
  const { theme, t } = useEdgeTheme();

  const winW = useWindowWidth();
  const isMobile = winW < 860;

  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [hasHierarchy, setHasHierarchy] = useState(false);
  const [showDepts, setShowDepts] = useState(false);
  const [mobileEdit, setMobileEdit] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [rf, setRf] = useState(null);
  const wrapRef = useRef(null);

  const deptMap = useMemo(() => {
    const map = {};
    employees.forEach((e) => { if (e.department && !map[e.department]) map[e.department] = hashColor(e.department); });
    departments.forEach((d) => { if (d.name) map[d.name] = d.color; });
    return map;
  }, [employees, departments]);

  const loadDepartments = useCallback(async () => {
    if (!activeOrg?.id) return;
    setDepartments(await storageService.getDepartments(activeOrg.id));
  }, [activeOrg?.id]);

  useEffect(() => {
    if (!activeOrg?.id) return;
    (async () => {
      setLoading(true);
      const [emps, depts] = await Promise.all([
        storageService.getEmployees(activeOrg.id),
        storageService.getDepartments(activeOrg.id),
      ]);
      setEmployees(emps);
      setDepartments(depts);
      const dm = Object.fromEntries(depts.map((d) => [d.name, d.color]));
      const hier = orgStore.getSection('hierarchy');
      if (hier && (hier.nodes || hier.edges)) {
        const empMap = Object.fromEntries(emps.map((e) => [e.id, e]));
        const { nodes: fn, edges: fe } = buildFlowData(hier, empMap, dm, t);
        if (fn.length > 0) { setNodes(fn); setEdges(fe); setHasHierarchy(true); }
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id]);

  // Edge colouring follows the theme, so a toggle must repaint what is on screen.
  useEffect(() => {
    setEdges((eds) => eds.map((e) => ({ ...e, ...edgeStyle(t) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  const onConnect = useCallback((params) => {
    setEdges((eds) => addEdge({
      ...params,
      id: `e-${params.source}-${params.target}-${Date.now()}`,
      ...edgeStyle(t),
    }, eds));
  }, [setEdges, t]);

  const nodeFor = useCallback((empId, position) => {
    const emp = employees.find((e) => e.id === empId);
    if (!emp) return null;
    return {
      id: emp.id, type: 'employee', position,
      data: {
        name: getDisplayName(emp), email: emp.email || '', role: emp.role || '',
        department: emp.department || '', color: resolveColor(emp, deptMap),
        photo_path: emp.photo_path || null,
      },
    };
  }, [employees, deptMap]);

  // The keyboard route onto the canvas: no drag needed. New cards land just
  // below whatever is already there so they never stack on top of each other.
  const placeEmployee = useCallback((empId) => {
    if (nodes.some((n) => n.id === empId)) return;
    const lowest = nodes.reduce((m, n) => Math.max(m, n.position.y), -132);
    const sameRow = nodes.filter((n) => n.position.y === lowest);
    const position = { x: sameRow.length * 254, y: lowest + (sameRow.length >= 4 ? 132 : 0) };
    const node = nodeFor(empId, sameRow.length >= 4 ? { x: 0, y: lowest + 132 } : position);
    if (!node) return;
    setNodes((nds) => [...nds, node]);
    window.requestAnimationFrame(() => rf?.fitView({ padding: 0.2, duration: 320 }));
  }, [nodes, nodeFor, setNodes, rf]);

  const removeEmployee = useCallback((empId) => {
    setNodes((nds) => nds.filter((n) => n.id !== empId));
    setEdges((eds) => eds.filter((e) => e.source !== empId && e.target !== empId));
  }, [setNodes, setEdges]);

  const focusEmployee = useCallback((empId) => {
    const n = nodes.find((x) => x.id === empId);
    if (!n || !rf) return;
    rf.setCenter(n.position.x + 109, n.position.y + 40, { zoom: 1.1, duration: 380 });
    setNodes((nds) => nds.map((x) => ({ ...x, selected: x.id === empId })));
  }, [nodes, rf, setNodes]);

  const onDragOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);

  const onDrop = useCallback((event) => {
    event.preventDefault();
    if (!rf || !editMode) return;
    const empId = event.dataTransfer.getData('application/reactflow-emp');
    if (!empId || nodes.some((n) => n.id === empId)) return;
    const node = nodeFor(empId, rf.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    if (node) setNodes((nds) => [...nds, node]);
  }, [rf, editMode, nodes, nodeFor, setNodes]);

  const arrange = useCallback(() => {
    setNodes((nds) => autoLayout(nds, edges));
    window.requestAnimationFrame(() => rf?.fitView({ padding: 0.2, duration: 380 }));
  }, [edges, setNodes, rf]);

  const handleSave = async (overrideNodes = null, overrideEdges = null) => {
    setSaving(true);
    try {
      const orgId = activeOrg.id;
      const saveNodes = overrideNodes || nodes;
      const saveEdges = overrideEdges || edges;

      await orgStore.setSection('hierarchy', {
        nodes: Object.fromEntries(saveNodes.map((n) => [n.id, { id: n.id, position: n.position }])),
        edges: Object.fromEntries(saveEdges.map((e) => [e.id, { id: e.id, source: e.source, target: e.target }])),
      });

      const empMap = Object.fromEntries(employees.map((e) => [e.id, e]));
      const supervisorOf = {};
      saveEdges.forEach((e) => { supervisorOf[e.target] = e.source; });

      const updates = [];
      for (const node of saveNodes) {
        const emp = empMap[node.id];
        if (!emp) continue;
        const managerNode = supervisorOf[node.id] ? saveNodes.find((n) => n.id === supervisorOf[node.id]) : null;
        const newSupervisor = managerNode ? managerNode.data.name : '';
        if (emp.supervisorName !== newSupervisor) {
          updates.push(storageService.updateEmployee(emp.id, { supervisorName: newSupervisor }, orgId));
        }
      }
      await Promise.all(updates);

      setHasHierarchy(true);
      setEditMode(false);
      setMobileEdit(false);
    } catch (err) {
      alert('Failed to save: ' + err.message);
    }
    setSaving(false);
  };

  const handleMobileSave = async (members) => {
    const newNodes = members.map((m, i) => nodeFor(m.empId, { x: (i % 3) * 254, y: Math.floor(i / 3) * 132 })).filter(Boolean);
    const newEdges = members.filter((m) => m.managerId).map((m) => ({
      id: `e-${m.managerId}-${m.empId}`, source: m.managerId, target: m.empId, ...edgeStyle(t),
    }));
    const laid = autoLayout(newNodes, newEdges);
    setNodes(laid); setEdges(newEdges);
    await handleSave(laid, newEdges);
  };

  const handleCancel = async () => {
    setEditMode(false);
    setMobileEdit(false);
    if (!hasHierarchy) { setNodes([]); setEdges([]); return; }
    const hier = orgStore.getSection('hierarchy');
    if (hier && (hier.nodes || hier.edges)) {
      const empMap = Object.fromEntries(employees.map((e) => [e.id, e]));
      const { nodes: fn, edges: fe } = buildFlowData(hier, empMap, deptMap, t);
      setNodes(fn); setEdges(fe);
    }
  };

  const onKeyDown = useCallback((e) => {
    if (!editMode) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      setEdges((eds) => eds.filter((ed) => !ed.selected));
      setNodes((nds) => nds.filter((nd) => !nd.selected));
    }
  }, [editMode, setEdges, setNodes]);

  const stats = useMemo(() => ({
    members: nodes.length,
    links: edges.length,
    depts: new Set(employees.map((e) => e.department).filter(Boolean)).size,
  }), [nodes, edges, employees]);

  const frame = (content) => (
    <div className="th-root" style={{
      width: '100%', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column',
      background: t.panel, fontFamily: MONO, color: t.text,
    }}>
      {content}
      <style>{`
        .th-root .th-btn:not(.th-primary):hover:not(:disabled) { border-color: ${t.lineStrong} !important; background: ${t.panelAlt} !important; }
        .th-root .th-primary:hover:not(:disabled) { opacity: .86; }
        .th-root .th-person:hover:not(:disabled) { background: ${t.panelAlt}; border-color: ${t.line} !important; }
        .th-root .th-row:hover { background: ${t.panelAlt}; }
        .th-root :focus-visible { outline: 2px solid ${t.text}; outline-offset: 2px; border-radius: 4px; }
        .th-root .edge-scroll::-webkit-scrollbar-thumb {
          background: ${t.lineStrong}; background-clip: content-box;
        }
        .th-root .react-flow__attribution { display: none; }
        .th-root .react-flow__edge.selected .react-flow__edge-path { stroke: ${t.text} !important; stroke-width: 2 !important; }
        .th-root input::placeholder { color: ${t.ghost}; }
      `}</style>
    </div>
  );

  if (loading) return frame(
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', fontSize: 11, color: t.faint }}>
      Loading team…
    </div>
  );

  if (employees.length === 0) return frame(
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 320 }}>
        <div style={{ fontSize: 14, color: t.text, marginBottom: 6 }}>No employees yet</div>
        <p style={{ margin: 0, fontSize: 11, color: t.faint, lineHeight: 1.7 }}>
          Add people to the registry first — the chart is built from the same records.
        </p>
      </div>
    </div>
  );

  /* ── mobile ─────────────────────────────────────────────────────────── */
  if (isMobile) {
    if (mobileEdit) {
      const supervisorOf = {};
      edges.forEach((e) => { supervisorOf[e.target] = e.source; });
      return frame(
        <div className="edge-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <MobileEdit
            t={t} employees={employees} saving={saving}
            initialMembers={nodes.map((n) => ({ empId: n.id, managerId: supervisorOf[n.id] || '' }))}
            onSave={handleMobileSave} onCancel={handleCancel}
          />
        </div>
      );
    }
    return frame(
      <div className="edge-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
        <MobileTree t={t} nodes={nodes} edges={edges} deptMap={deptMap}
          employees={employees} onEdit={() => setMobileEdit(true)} />
      </div>
    );
  }

  /* ── desktop ────────────────────────────────────────────────────────── */
  return frame(
    <>
      {/* toolbar — docked above the canvas, never over it */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0,
        padding: '0 14px', height: 46, borderBottom: '1px solid ' + t.line,
      }}>
        <Stat t={t} label="ON CHART" value={stats.members} />
        <Stat t={t} label="LINKS" value={stats.links} />
        <Stat t={t} label="DEPTS" value={stats.depts} />

        <div style={{ flex: 1 }} />

        {editMode && (
          <span style={{
            fontSize: 9.5, letterSpacing: '0.08em', color: t.faint,
            padding: '3px 8px', borderRadius: 999, border: '1px dashed ' + t.lineStrong,
          }}>EDITING</span>
        )}

        <Btn t={t} onClick={arrange} title="Lay the chart out as a tidy tree">Arrange</Btn>
        <Btn t={t} onClick={() => rf?.fitView({ padding: 0.2, duration: 320 })} title="Fit the whole chart on screen">Fit</Btn>
        <Btn t={t} onClick={() => setShowDepts((v) => !v)}>Departments</Btn>

        <span style={{ width: 1, height: 18, background: t.line }} />

        {!editMode ? (
          <Btn t={t} primary onClick={() => setEditMode(true)}>Edit structure</Btn>
        ) : (
          <>
            <Btn t={t} onClick={handleCancel}>Cancel</Btn>
            <Btn t={t} primary onClick={() => handleSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Btn>
          </>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <PeoplePanel
          t={t} employees={employees} nodes={nodes} deptMap={deptMap} editMode={editMode}
          onPlace={placeEmployee} onFocus={focusEmployee} onRemove={removeEmployee}
        />

        <div
          ref={wrapRef}
          style={{ flex: 1, minWidth: 0, position: 'relative', background: t.panelAlt }}
          onKeyDown={onKeyDown} onDrop={onDrop} onDragOver={onDragOver} tabIndex={0}
        >
          {nodes.length === 0 && (
            <div style={{
              position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
              zIndex: 5, pointerEvents: 'none', padding: 24,
            }}>
              <div style={{ textAlign: 'center', maxWidth: 340 }}>
                <div style={{ fontSize: 13, color: t.text, marginBottom: 6 }}>The chart is empty</div>
                <p style={{ margin: 0, fontSize: 11, color: t.faint, lineHeight: 1.7 }}>
                  {editMode
                    ? 'Click a name in the people panel to put them on the chart, then drag from the dot under one card to the dot above another to set who reports to whom.'
                    : 'Choose Edit structure to start placing people.'}
                </p>
              </div>
            </div>
          )}

          <TokenCtx.Provider value={t}>
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={editMode ? onNodesChange : undefined}
            onEdgesChange={editMode ? onEdgesChange : undefined}
            onConnect={editMode ? onConnect : undefined}
            onInit={setRf}
            nodeTypes={nodeTypes}
            fitView fitViewOptions={{ padding: 0.2 }}
            nodesDraggable={editMode} nodesConnectable={editMode} elementsSelectable
            panOnDrag zoomOnScroll minZoom={0.25} maxZoom={1.8}
            style={{ background: t.panelAlt }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color={t.ghost} />
          </ReactFlow>
          </TokenCtx.Provider>
        </div>

        {showDepts && (
          <DeptDrawer
            t={t} departments={departments} employees={employees} orgId={activeOrg.id}
            onClose={() => setShowDepts(false)} onChange={loadDepartments}
          />
        )}
      </div>
    </>
  );
}
