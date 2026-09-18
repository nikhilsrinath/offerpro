import { useEffect, useState } from 'react';
import { Shield, Loader } from 'lucide-react';
import { useOrg } from '../../context/OrgContext';
import { listMembers, listRoles, getMyMembership, setMemberRole } from '../../services/permissionService';

/**
 * Employee profile → "App access": the EdgeOS role of the login whose email
 * matches this employee. An employee record is not a login; if nobody has
 * signed in with that email there is nothing to assign yet.
 *
 * Only owners and admins may grant or revoke owner/admin, and the last owner
 * cannot be demoted — the database enforces both and its message is shown.
 */
export default function AccessRolePicker({ email }) {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id;
  const [member, setMember] = useState(undefined);   // undefined = loading, null = no login
  const [roles, setRoles] = useState([]);
  const [myRole, setMyRole] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!orgId || !email) { setMember(null); return; }
    let cancelled = false;
    Promise.all([listMembers(orgId), listRoles(), getMyMembership(orgId)])
      .then(([members, r, me]) => {
        if (cancelled) return;
        const target = email.trim().toLowerCase();
        setMember(members.find((m) => (m.email || '').toLowerCase() === target) || null);
        setRoles(r);
        setMyRole(me?.role || null);
      })
      .catch((e) => { if (!cancelled) { setMember(null); setMsg(e.message); } });
    return () => { cancelled = true; };
  }, [orgId, email]);

  const privileged = (r) => r === 'owner' || r === 'admin';
  const onChange = async (role) => {
    setSaving(true); setMsg('');
    try {
      const updated = await setMemberRole(member.membership_id, role);
      setMember({ ...member, role: updated.role });
      setMsg('Access updated.');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  };

  const box = { padding: '0.75rem', borderRadius: 10, background: 'var(--bg-raised)', border: '1px solid var(--border-subtle)', marginBottom: '1rem' };
  const label = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
      <Shield size={13} /> App access
    </div>
  );

  if (member === undefined) return <div style={box}>{label}<Loader size={14} className="spin-icon" /></div>;
  if (!member) {
    return (
      <div style={box}>
        {label}
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {email ? `No EdgeOS login uses ${email} yet.` : 'Add an email to this employee to manage their access.'}
        </div>
        {msg && <div style={{ fontSize: '0.75rem', color: '#f87171', marginTop: 4 }}>{msg}</div>}
      </div>
    );
  }

  const canManage = myRole === 'owner' || myRole === 'admin';
  return (
    <div style={box}>
      {label}
      <select
        value={member.role}
        disabled={!canManage || saving}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', padding: '0.45rem', borderRadius: 8, background: 'var(--bg-surface, transparent)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
      >
        {roles.map((r) => (
          <option key={r.key} value={r.key} disabled={privileged(r.key) && !canManage}>{r.label}</option>
        ))}
      </select>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
        {roles.find((r) => r.key === member.role)?.description}
      </div>
      {msg && <div style={{ fontSize: '0.75rem', color: msg === 'Access updated.' ? '#22c55e' : '#f87171', marginTop: 4 }}>{msg}</div>}
    </div>
  );
}
