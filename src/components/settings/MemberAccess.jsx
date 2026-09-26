import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useOrg } from '../../context/OrgContext';
import {
  ACTIONS, loadPermissionMatrix, getMyMembership, listMembers, setMemberRole,
  setRolePermissions, loadMemberOverrides, setMemberOverride, clearMemberOverride,
  toFlags, sameFlags, nextFlags,
} from '../../services/permissionService';
import { Panel, Btn, Seg, Select, Status, Loading } from '../ui/edge';
import { useT } from '../ui/edgeUtils';

/**
 * Employee profile → "Role & permissions": everything about what one person
 * may do in EdgeOS, in one place.
 *
 *   Role          which role their login holds.
 *   Permissions   what they can actually do, resource by resource. A change
 *                 made "for this person" becomes a Custom exception (0062) that
 *                 replaces the role's row for that resource; resetting it
 *                 returns them to the role. A change made "for everyone in the
 *                 role" edits the role itself.
 *
 * The database enforces every rule shown here — owners are never limited, only
 * an owner shapes admins, nobody edits their own access — so the controls are
 * disabled with the reason rather than failing on click. Pay, banking and
 * email credentials are owner/admin-only by policy and are not listed at all.
 *
 * An employee record is not a login: this matches the login by email, and
 * when nobody has signed in with that address there is nothing to assign.
 */
export default function MemberAccess({ email, name }) {
  const t = useT();
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id;
  const first = (name || '').split(' ')[0] || 'this person';

  const [data, setData] = useState(null);          // { roles, resources, matrix }
  const [member, setMember] = useState(undefined); // undefined = loading, null = no login
  const [members, setMembers] = useState([]);
  const [me, setMe] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [scope, setScope] = useState('person');
  const [perPerson, setPerPerson] = useState(true); // false: database predates 0062
  const [open, setOpen] = useState(() => new Set());
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);            // { tone, text }
  const [pendingRole, setPendingRole] = useState(null);

  const load = useCallback(async () => {
    if (!orgId || !email) { setMember(null); return; }
    try {
      const [matrix, all, mine] = await Promise.all([
        loadPermissionMatrix(orgId), listMembers(orgId), getMyMembership(orgId),
      ]);
      const target = all.find((m) => (m.email || '').toLowerCase() === email.trim().toLowerCase()) || null;
      setData(matrix); setMembers(all); setMe(mine); setMember(target);
      const own = target ? await loadMemberOverrides(target.membership_id) : {};
      setPerPerson(own !== null);
      if (own === null) setScope('role');
      setOverrides(own || {});
    } catch (e) {
      setMember((m) => (m === undefined ? null : m));
      setMsg({ tone: 'down', text: e.message });
    }
  }, [orgId, email]);

  useEffect(() => { load(); }, [load]);

  const myRole = me?.role || null;
  const canManage = myRole === 'owner' || myRole === 'admin';
  const role = data?.roles.find((r) => r.key === member?.role);
  const roleLabel = role?.label || member?.role || '';
  const inRole = members.filter((m) => m.role === member?.role).length;
  const customCount = Object.keys(overrides).length;

  // Why the grid is read-only, or null when it is editable. Mirrors the
  // database's guards (0026 for roles, 0062 for people).
  const lockReason = useMemo(() => {
    if (!member) return null;
    if (!canManage) return 'Only owners and admins can change access.';
    if (scope === 'person') {
      if (member.role === 'owner') return `${first} is an owner. Owners always have full access.`;
      if (me && member.membership_id === me.id) return 'You cannot change your own access. Ask another owner or admin.';
      if (member.role === 'admin' && myRole !== 'owner') return 'Only an owner can change what an admin may do.';
    } else {
      if (member.role === 'owner') return 'The Owner role always has full access.';
      if (member.role === 'admin' && myRole !== 'owner') return 'Only an owner can change the Admin role.';
    }
    return null;
  }, [member, canManage, scope, first, me, myRole]);

  const roleRow = (resKey) => data?.matrix[`${member.role}:${resKey}`];
  const shown = (resKey) => {
    if (scope === 'person' && overrides[resKey]) return toFlags(overrides[resKey]);
    return toFlags(roleRow(resKey));
  };

  const run = async (key, fn, done) => {
    setBusy(key); setMsg(null);
    try { await fn(); if (done) setMsg({ tone: 'up', text: done }); }
    catch (e) { setMsg({ tone: 'down', text: e.message || 'That did not work.' }); }
    finally { setBusy(''); }
  };

  const toggle = (res, action, value) => run(`${res.key}:${action}`, async () => {
    const flags = nextFlags(shown(res.key), res, action, value);
    if (scope === 'role') {
      const row = await setRolePermissions(orgId, member.role, res.key, flags);
      setData((d) => ({ ...d, matrix: { ...d.matrix, [`${member.role}:${res.key}`]: row } }));
      return;
    }
    // Back to exactly what the role gives: no exception needed.
    if (sameFlags(flags, toFlags(roleRow(res.key)))) {
      await clearMemberOverride(member.membership_id, res.key);
      setOverrides(({ [res.key]: _, ...rest }) => rest);
    } else {
      const row = await setMemberOverride(orgId, member.membership_id, res.key, flags);
      setOverrides((o) => ({ ...o, [res.key]: row }));
    }
  });

  const resetOne = (res) => run(`${res.key}:reset`, async () => {
    await clearMemberOverride(member.membership_id, res.key);
    setOverrides(({ [res.key]: _, ...rest }) => rest);
  }, `${res.label} is back to what the ${roleLabel} role allows.`);

  const resetAll = () => run('reset-all', async () => {
    await clearMemberOverride(member.membership_id);
    setOverrides({});
  }, `${first} now has exactly what the ${roleLabel} role allows.`);

  const changeRole = (next) => run('role', async () => {
    const updated = await setMemberRole(member.membership_id, next);
    setPendingRole(null);
    setMember((m) => ({ ...m, role: updated.role }));
    setMembers((all) => all.map((m) => (m.membership_id === member.membership_id ? { ...m, role: updated.role } : m)));
    // The database clears a person's exceptions when their role changes.
    setOverrides((await loadMemberOverrides(member.membership_id)) || {});
  }, 'Role updated.');

  const onRoleSelect = (next) => {
    if (next === member.role) return;
    if (customCount > 0) setPendingRole(next);
    else changeRole(next);
  };

  const toggleCat = (cat) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(cat)) n.delete(cat); else n.add(cat);
    return n;
  });

  /* ── render ─────────────────────────────────────────────────────────────── */

  const text = (size, color = t.faint) => ({ fontSize: size, color, lineHeight: 1.6 });

  if (member === undefined) {
    return <Panel title="Role & permissions" pad={13}><Loading>Loading access…</Loading></Panel>;
  }
  if (!member) {
    return (
      <Panel title="Role & permissions" note="No login" pad={13}>
        <p style={{ ...text(10.5), margin: 0 }}>
          {email
            ? `No EdgeOS login uses ${email} yet. Once they have a login (create one above), their role and permissions are set here.`
            : 'Add an email to this employee to manage their role and permissions.'}
        </p>
        {msg && <p role="alert" style={{ ...text(10.5, t.down), margin: '8px 0 0' }}>{msg.text}</p>}
      </Panel>
    );
  }

  const categories = [...new Set(data.resources.map((r) => r.category))];
  const locked = lockReason !== null;
  const cell = { padding: '0 4px', textAlign: 'center', borderTop: '1px solid ' + t.lineSoft };
  const roleSelectId = `member-role-${member.membership_id}`;

  return (
    <Panel title="Role & permissions" note={`${roleLabel}${customCount ? ` · ${customCount} custom` : ''}`} pad={13}>
      {/* ── role ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
        <label htmlFor={roleSelectId} style={{ fontSize: 9, letterSpacing: '0.1em', color: t.faint }}>ROLE</label>
        <Select id={roleSelectId} value={pendingRole || member.role} disabled={!canManage || busy !== ''}
          onChange={(e) => onRoleSelect(e.target.value)}>
          {data.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </Select>
        {role?.description && <div style={text(10.5, t.dim)}>{role.description}</div>}
        {pendingRole && (
          <div role="alertdialog" aria-label="Confirm role change" style={{
            border: '1px solid ' + t.lineStrong, borderRadius: 8, padding: 10, background: t.panelAlt,
          }}>
            <div style={text(11, t.text)}>
              Change {first} to {data.roles.find((r) => r.key === pendingRole)?.label}?
            </div>
            <div style={{ ...text(10.5), margin: '2px 0 9px' }}>
              Their {customCount} custom permission{customCount === 1 ? '' : 's'} will be cleared, and they start from the new role.
            </div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <Btn size="sm" primary onClick={() => changeRole(pendingRole)} disabled={busy !== ''}>
                {busy === 'role' ? 'Changing…' : 'Change role'}
              </Btn>
              <Btn size="sm" onClick={() => setPendingRole(null)} disabled={busy !== ''}>Cancel</Btn>
            </div>
          </div>
        )}
      </div>

      {/* ── permissions ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 9, letterSpacing: '0.1em', color: t.faint }}>PERMISSIONS</span>
        <div style={{ flex: 1 }} />
        <Seg size="sm" value={scope} onChange={setScope} label="Apply permission changes to"
          options={[
            ...(perPerson ? [{ id: 'person', label: `Only ${first}` }] : []),
            { id: 'role', label: `Everyone who is ${roleLabel}` },
          ]} />
      </div>
      <p style={{ ...text(10.5), margin: '0 0 10px' }}>
        {scope === 'person'
          ? `What ${first} can do. A change here applies only to ${first} and is marked Custom; everything else follows the ${roleLabel} role.`
          : `Changes here apply to all ${inRole} ${inRole === 1 ? 'person' : 'people'} with the ${roleLabel} role, except where someone has a Custom setting.`}
        {!perPerson && ` Setting permissions for one person needs the latest database update (migration 0062).`}
        {' '}Salaries, bank details and email credentials are always limited to owners and admins.
      </p>

      {lockReason && (
        <div role="note" style={{ ...text(10.5, t.dim), padding: '7px 10px', marginBottom: 10, border: '1px solid ' + t.line, borderRadius: 7, background: t.panelAlt }}>
          {lockReason}
        </div>
      )}
      {msg && (
        <div role={msg.tone === 'down' ? 'alert' : 'status'} style={{
          ...text(10.5, msg.tone === 'down' ? t.down : t.text), padding: '7px 10px', marginBottom: 10,
          border: '1px solid ' + t.line, borderLeft: '3px solid ' + (msg.tone === 'down' ? t.down : t.up),
          borderRadius: 7, background: t.panelAlt,
        }}>{msg.text}</div>
      )}

      <div style={{ display: 'flex', gap: 7, marginBottom: 8, flexWrap: 'wrap' }}>
        <Btn size="sm" onClick={() => setOpen(open.size === categories.length ? new Set() : new Set(categories))}>
          {open.size === categories.length ? 'Collapse all' : 'Expand all'}
        </Btn>
        {scope === 'person' && customCount > 0 && !locked && (
          <Btn size="sm" onClick={resetAll} disabled={busy !== ''}>
            {busy === 'reset-all' ? 'Resetting…' : `Reset all to ${roleLabel}`}
          </Btn>
        )}
      </div>

      <div style={{ border: '1px solid ' + t.line, borderRadius: 8, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 420 }}>
          <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            {scope === 'person' ? `Permissions for ${name || first}` : `Permissions for the ${roleLabel} role`}
          </caption>
          <thead>
            <tr style={{ background: t.panelAlt }}>
              <th scope="col" style={{ textAlign: 'left', padding: '7px 10px', fontSize: 9, letterSpacing: '0.1em', color: t.faint, fontWeight: 400 }}>RESOURCE</th>
              {ACTIONS.map((a) => (
                <th key={a} scope="col" style={{ width: 52, padding: '7px 4px', fontSize: 9, letterSpacing: '0.1em', color: t.faint, fontWeight: 400 }}>
                  {a.toUpperCase()}
                </th>
              ))}
              <th scope="col" style={{ width: 118 }}><span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Status</span></th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => {
              const rows = data.resources.filter((r) => r.category === cat);
              const isOpen = open.has(cat);
              const viewable = rows.filter((r) => shown(r.key).view || (!r.actions.includes('view') && ACTIONS.some((a) => shown(r.key)[a]))).length;
              const custom = scope === 'person' ? rows.filter((r) => overrides[r.key]).length : 0;
              return (
                <Fragment key={cat}>
                  <tr>
                    <td colSpan={2 + ACTIONS.length} style={{ padding: 0, borderTop: '1px solid ' + t.line }}>
                      <button type="button" className="edge-btn" aria-expanded={isOpen}
                        onClick={() => toggleCat(cat)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 32, padding: '6px 10px',
                          border: 'none', borderRadius: 0, background: 'transparent', color: t.text, cursor: 'pointer',
                          fontFamily: 'inherit', fontSize: 11, textAlign: 'left',
                        }}>
                        <span aria-hidden="true" style={{ color: t.faint, width: 10 }}>{isOpen ? '▾' : '▸'}</span>
                        <span style={{ fontWeight: 500 }}>{cat}</span>
                        <span style={{ fontSize: 10, color: t.faint }}>{viewable} of {rows.length} allowed</span>
                        {custom > 0 && <Status tone="up">{custom} custom</Status>}
                      </button>
                    </td>
                  </tr>
                  {isOpen && rows.map((res) => {
                    const flags = shown(res.key);
                    const isCustom = scope === 'person' && !!overrides[res.key];
                    return (
                      <tr key={res.key}>
                        <th scope="row" title={res.description || undefined}
                          style={{ ...cell, textAlign: 'left', padding: '6px 10px 6px 28px', fontWeight: 400, fontSize: 11, letterSpacing: 'normal', textTransform: 'none', color: t.text }}>
                          {res.label}
                        </th>
                        {ACTIONS.map((a) => (
                          <td key={a} style={cell}>
                            {res.actions.includes(a) ? (
                              <label style={{ display: 'grid', placeItems: 'center', minHeight: 30, minWidth: 30, cursor: locked ? 'not-allowed' : 'pointer' }}>
                                <input type="checkbox"
                                  aria-label={`${a[0].toUpperCase() + a.slice(1)} ${res.label}`}
                                  checked={flags[a]} disabled={locked || busy !== ''}
                                  onChange={(e) => toggle(res, a, e.target.checked)}
                                  style={{ width: 15, height: 15, margin: 0, accentColor: t.text, cursor: 'inherit' }} />
                              </label>
                            ) : <span aria-label="Not applicable" style={{ color: t.faint }}>–</span>}
                          </td>
                        ))}
                        <td style={{ ...cell, textAlign: 'right', paddingRight: 8, whiteSpace: 'nowrap' }}>
                          {isCustom && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <Status tone="up">Custom</Status>
                              {!locked && (
                                <Btn size="sm" onClick={() => resetOne(res)} disabled={busy !== ''}
                                  aria-label={`Reset ${res.label} to the ${roleLabel} role`}>Reset</Btn>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
