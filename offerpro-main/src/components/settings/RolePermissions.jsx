import { Fragment, useEffect, useState } from 'react';
import { Loader, Lock, AlertCircle } from 'lucide-react';
import { ACTIONS, loadPermissionMatrix, setPermission, getMyMembership } from '../../services/permissionService';

/**
 * Settings → Roles & permissions: a toggle grid of role × resource.
 *
 * Owners and admins edit; everyone else sees it read-only. The owner column is
 * always locked, and only an owner may change the admin column — the database
 * refuses otherwise, and this screen mirrors that so the toggles don't lie.
 * Pay, banking and email credentials are not in the grid at all: they are
 * owner/admin-only by policy and cannot be configured.
 */
export default function RolePermissions({ orgId }) {
  const [state, setState] = useState({ loading: true, error: '', roles: [], resources: [], matrix: {} });
  const [myRole, setMyRole] = useState(null);
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState('');

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    Promise.all([loadPermissionMatrix(orgId), getMyMembership(orgId)])
      .then(([m, me]) => { if (!cancelled) { setState({ loading: false, error: '', ...m }); setMyRole(me?.role || null); } })
      .catch((e) => { if (!cancelled) setState((s) => ({ ...s, loading: false, error: e.message })); });
    return () => { cancelled = true; };
  }, [orgId]);

  const canEditColumn = (role) => {
    if (role === 'owner') return false;
    if (role === 'admin') return myRole === 'owner';
    return myRole === 'owner' || myRole === 'admin';
  };

  const toggle = async (role, resource, action, value) => {
    const id = `${role}:${resource.key}:${action}`;
    const current = state.matrix[`${role}:${resource.key}`];
    // Keep the grid coherent with the database's rule: no write without view.
    const patch = [[action, value]];
    if (action === 'view' && !value) {
      for (const a of ['create', 'edit', 'delete']) if (current[`can_${a}`]) patch.push([a, false]);
    } else if (action !== 'view' && value && resource.actions.includes('view') && !current.can_view) {
      patch.unshift(['view', true]);
    }
    setBusy(id); setFlash('');
    try {
      let row = current;
      // Order matters: clear writes before view; set view before writes.
      const ordered = action === 'view' && !value ? [...patch.slice(1), patch[0]] : patch;
      for (const [a, v] of ordered) row = await setPermission(orgId, role, resource.key, a, v);
      setState((s) => ({ ...s, matrix: { ...s.matrix, [`${role}:${resource.key}`]: row } }));
    } catch (e) {
      setFlash(e.message);
    } finally {
      setBusy('');
    }
  };

  if (state.loading) return <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}><Loader size={14} className="spin-icon" /> Loading permissions…</p>;
  if (state.error) return <p style={{ color: '#ef4444', fontSize: '0.8rem' }}>{state.error}</p>;

  const categories = [...new Set(state.resources.map((r) => r.category))];
  const cell = { padding: '0.35rem 0.25rem', textAlign: 'center', borderBottom: '1px solid var(--border-subtle)' };

  return (
    <div>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        What each role can do in this organization. Changes apply immediately, to everyone in that role.
        Salaries, bank details and email credentials are always limited to owners and admins and are not listed here.
        {!canEditColumn('member') && ' Only owners and admins can change these.'}
      </p>
      {flash && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.6rem 0.8rem', marginBottom: '0.75rem', borderRadius: 8, background: 'rgba(239,68,68,0.08)', color: '#f87171', fontSize: '0.8rem' }}>
          <AlertCircle size={14} /> {flash}
        </div>
      )}
      <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ ...cell, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg-raised)' }}>Resource</th>
              {state.roles.map((r) => (
                <th key={r.key} colSpan={4} title={r.description} style={{ ...cell, borderLeft: '1px solid var(--border-subtle)' }}>
                  {r.label}{!canEditColumn(r.key) && <Lock size={10} style={{ marginLeft: 4, opacity: 0.6 }} />}
                </th>
              ))}
            </tr>
            <tr>
              <th style={{ ...cell, position: 'sticky', left: 0, background: 'var(--bg-raised)' }} />
              {state.roles.map((r) => ACTIONS.map((a, i) => (
                <th key={`${r.key}-${a}`} style={{ ...cell, fontWeight: 500, color: 'var(--text-muted)', borderLeft: i === 0 ? '1px solid var(--border-subtle)' : undefined }}>
                  {a[0].toUpperCase() + a.slice(1)}
                </th>
              )))}
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => (
              <Fragment key={cat}>
                <tr><td colSpan={1 + state.roles.length * 4} style={{ ...cell, textAlign: 'left', fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--bg-raised)' }}>{cat}</td></tr>
                {state.resources.filter((res) => res.category === cat).map((res) => (
                  <tr key={res.key}>
                    <td title={res.description || ''} style={{ ...cell, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg-surface, var(--bg-raised))', color: 'var(--text-primary)' }}>{res.label}</td>
                    {state.roles.map((role) => ACTIONS.map((a, i) => {
                      const row = state.matrix[`${role.key}:${res.key}`];
                      const supported = res.actions.includes(a);
                      const id = `${role.key}:${res.key}:${a}`;
                      return (
                        <td key={id} style={{ ...cell, borderLeft: i === 0 ? '1px solid var(--border-subtle)' : undefined }}>
                          {supported && row ? (
                            <input
                              type="checkbox"
                              aria-label={`${role.label} ${a} ${res.label}`}
                              checked={!!row[`can_${a}`]}
                              disabled={!canEditColumn(role.key) || busy !== ''}
                              onChange={(e) => toggle(role.key, res, a, e.target.checked)}
                              style={{ cursor: canEditColumn(role.key) ? 'pointer' : 'not-allowed' }}
                            />
                          ) : <span style={{ color: 'var(--text-muted)', opacity: 0.4 }}>–</span>}
                        </td>
                      );
                    }))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
