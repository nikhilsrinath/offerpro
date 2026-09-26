// ProfileTab — the employee's own card. Personal details save through
// meService.updateMyProfile (0032), which writes the same `employees` row the
// admin screens read, so a new photo or phone number shows up there too.
// Role, department, manager and dates are the employer's and are shown here
// read-only, with a line saying who to ask.
import { useRef, useState } from 'react';
import { Camera, Trash2, KeyRound, Lock } from 'lucide-react';
import { Panel, Btn, Field, Input, Textarea, Bar } from '../../ui/edge';
import { useT } from '../../ui/edgeUtils';
import { useToast } from '../../shared/Toast';
import { todayKey } from '../../../services/attendanceService';
import { meService } from '../../../services/meService';
import { PhotoAvatar } from './portalKit';
import { fmtLongDay, profileCompleteness } from './portalUtils';
import { confirmDialog } from '../../../services/confirm';

const TYPE_LABEL = { fulltime: 'Full-time', parttime: 'Part-time', intern: 'Intern', contract: 'Contract' };
const EDITABLE = ['full_name', 'phone', 'date_of_birth', 'address', 'bio', 'emergency_contact_name', 'emergency_contact_phone'];

const pick = (me) => Object.fromEntries(EDITABLE.map((k) => [k, me?.[k] ?? '']));

export default function ProfileTab({ orgId, me, setMe, email, narrow }) {
  const t = useT();
  const toast = useToast();
  const fileRef = useRef(null);
  const [form, setForm] = useState(() => pick(me));
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const changed = EDITABLE.filter((k) => String(form[k] ?? '') !== String(me?.[k] ?? ''));
  const completeness = profileCompleteness({ ...me, ...form });

  // The row the database hands back is the truth; merge it over what we hold
  // so the department and manager resolved by getMyEmployee() survive.
  const absorb = (row) => { if (row) setMe((m) => ({ ...m, ...row })); };

  const save = async (e) => {
    e.preventDefault();
    if (!changed.length) return;
    if (!String(form.full_name).trim()) { toast('Your name cannot be empty.', 'error'); return; }
    setSaving(true);
    try {
      const patch = Object.fromEntries(changed.map((k) => [k, form[k] ?? '']));
      const row = await meService.updateMyProfile(orgId, patch);
      absorb(row);
      setForm(pick({ ...me, ...row }));
      toast('Profile saved', 'success');
    } catch (err) {
      toast(err.message || 'Could not save your profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoBusy(true);
    try {
      absorb(await meService.uploadMyPhoto(orgId, me, file));
      toast('Photo updated', 'success');
    } catch (err) {
      toast(/permission/i.test(err.message || '')
        ? 'Photo upload is not enabled on this workspace yet. Ask an admin to apply the latest database update.'
        : (err.message || 'Could not upload that photo.'), 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = async () => {
    if (!(await confirmDialog({ title: 'Remove photo', message: 'Remove your profile photo?', confirmLabel: 'Remove' }))) return;
    setPhotoBusy(true);
    try {
      absorb(await meService.removeMyPhoto(orgId, me));
      toast('Photo removed', 'success');
    } catch (err) {
      toast(err.message || 'Could not remove the photo.', 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  const employer = [
    ['Work email', email || me.email],
    ['Role', me.role],
    ['Department', me.department_name],
    ['Reports to', me.manager?.full_name || me.supervisor_name],
    ['Employment', TYPE_LABEL[me.employment_type]],
    ['Started', me.start_date ? fmtLongDay(me.start_date) : null],
  ];

  return (
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: narrow ? '1fr' : 'minmax(260px, 0.8fr) minmax(0, 1.6fr)', alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 14 }}>
        <Panel>
          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
            <div style={{ position: 'relative' }}>
              <PhotoAvatar name={form.full_name || me.full_name} path={me.photo_path} size={112} radius={24} />
              <button
                type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy}
                title="Change photo" aria-label="Change photo"
                style={{
                  position: 'absolute', right: -6, bottom: -6, width: 34, height: 34, borderRadius: 10,
                  display: 'grid', placeItems: 'center', cursor: photoBusy ? 'wait' : 'pointer',
                  background: t.text, color: t.panel, border: '3px solid ' + t.panel,
                }}
              ><Camera size={15} /></button>
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onPhoto} style={{ display: 'none' }} />
            <div>
              <div style={{ fontSize: 15, color: t.text, fontWeight: 500 }}>{me.full_name}</div>
              <div style={{ fontSize: 10.5, color: t.faint, marginTop: 3 }}>{[me.role, me.department_name].filter(Boolean).join(' · ') || 'Team member'}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Btn size="sm" onClick={() => fileRef.current?.click()} disabled={photoBusy}>
                <Camera size={12} /> {photoBusy ? 'Working…' : me.photo_path ? 'Replace photo' : 'Upload photo'}
              </Btn>
              {me.photo_path && <Btn size="sm" onClick={removePhoto} disabled={photoBusy} title="Remove photo"><Trash2 size={12} /></Btn>}
            </div>
            <div style={{ width: '100%', textAlign: 'left', marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: t.faint, marginBottom: 5 }}>
                <span>Profile complete</span><span style={{ color: t.text }}>{completeness.done}/{completeness.total}</span>
              </div>
              <Bar value={completeness.done} max={completeness.total} />
            </div>
          </div>
        </Panel>

        <Panel title="From your employer" actions={<Lock size={12} style={{ color: t.faint }} />}>
          {employer.map(([k, v], i) => (
            <div key={k} style={{ display: 'flex', gap: 12, padding: '9px 14px', borderTop: i ? '1px solid ' + t.lineSoft : 'none' }}>
              <span style={{ width: 88, flexShrink: 0, fontSize: 9, letterSpacing: '0.09em', color: t.faint, paddingTop: 2 }}>{k.toUpperCase()}</span>
              <span style={{ fontSize: 11.5, color: v ? t.text : t.ghost, minWidth: 0, wordBreak: 'break-word' }}>{v || '—'}</span>
            </div>
          ))}
          <div style={{ padding: '9px 14px', borderTop: '1px solid ' + t.lineSoft, fontSize: 9.5, color: t.faint, lineHeight: 1.5 }}>
            Something wrong here? Ask your admin — these are set on your employee record.
          </div>
        </Panel>
      </div>

      <div style={{ display: 'grid', gap: 14 }}>
        <Panel title="Personal details" note="visible to your admins">
          <form onSubmit={save} style={{ padding: 14, display: 'grid', gap: 12, gridTemplateColumns: narrow ? '1fr' : '1fr 1fr' }}>
            <Field label="Full name"><Input value={form.full_name} onChange={set('full_name')} maxLength={120} required /></Field>
            <Field label="Phone"><Input type="tel" value={form.phone} onChange={set('phone')} maxLength={40} placeholder="+91 98765 43210" /></Field>
            <Field label="Date of birth"><Input type="date" value={form.date_of_birth || ''} onChange={set('date_of_birth')} max={todayKey()} /></Field>
            <Field label="Address"><Input value={form.address} onChange={set('address')} maxLength={400} placeholder="Where you live" /></Field>
            <Field label="About you" wide hint={`${String(form.bio || '').length}/600 — a line or two your team will see on your card`}>
              <Textarea rows={3} value={form.bio} onChange={set('bio')} maxLength={600} placeholder="What you work on, what you're into" />
            </Field>
            <div style={{ gridColumn: '1 / -1', fontSize: 9.5, letterSpacing: '0.1em', color: t.faint, borderTop: '1px solid ' + t.lineSoft, paddingTop: 12 }}>
              EMERGENCY CONTACT
            </div>
            <Field label="Name"><Input value={form.emergency_contact_name} onChange={set('emergency_contact_name')} maxLength={120} /></Field>
            <Field label="Phone"><Input type="tel" value={form.emergency_contact_phone} onChange={set('emergency_contact_phone')} maxLength={40} /></Field>
            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
              {changed.length > 0 && <span style={{ fontSize: 10, color: t.faint, marginRight: 'auto' }}>{changed.length} unsaved change{changed.length === 1 ? '' : 's'}</span>}
              <Btn onClick={() => setForm(pick(me))} disabled={!changed.length || saving}>Discard</Btn>
              <Btn type="submit" primary disabled={!changed.length || saving}>{saving ? 'Saving…' : 'Save changes'}</Btn>
            </div>
          </form>
        </Panel>

        <ChangePassword />
      </div>
    </div>
  );
}

// The password an admin generated is a password an admin saw. This is the one
// place an employee can replace it; the portal also raises it above every tab
// until they do.
export function ChangePassword({ mustChange = false, onDone }) {
  const t = useT();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < 8) { setError('Use at least 8 characters.'); return; }
    if (pw !== confirm) { setError('The two passwords do not match.'); return; }
    setBusy(true);
    setError('');
    try {
      await meService.changeMyPassword(pw);
      setPw(''); setConfirm('');
      toast('Password changed', 'success');
      onDone?.();
    } catch (err) {
      setError(err.message || 'Could not change your password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={mustChange ? 'Choose your own password' : 'Password'} actions={<KeyRound size={12} style={{ color: t.faint }} />}
      style={mustChange ? { borderColor: t.text } : undefined}>
      <form onSubmit={submit} style={{ padding: 14, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'end' }}>
        {mustChange && (
          <div style={{ gridColumn: '1 / -1', fontSize: 11, color: t.dim, lineHeight: 1.6 }}>
            You are signed in with the password your workplace generated for you, which means someone else has
            seen it. Pick one only you know.
          </div>
        )}
        <Field label="New password">
          <Input type="password" autoComplete="new-password" value={pw} placeholder="At least 8 characters" onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Confirm it">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Btn type="submit" primary disabled={busy || !pw || !confirm}>{busy ? 'Saving…' : 'Update password'}</Btn>
        {error && <div style={{ gridColumn: '1 / -1', fontSize: 10.5, color: t.down }}>{error}</div>}
      </form>
    </Panel>
  );
}
