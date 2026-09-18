// PortalJoinCode.jsx — the self-serve way in.
//
// One code per organization, shared the way a door code is: in the team chat,
// on the induction slide. Knowing it is not enough on its own — claiming a seat
// also needs an employee record an admin already created at that address, and a
// verified sign-in on it (claim_portal_seat, 0030 §5). So it can be pasted in a
// group without becoming a way in for whoever forwards it.
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Copy, Check, RefreshCw, Loader2 } from 'lucide-react';
import { portalAccessService, joinUrl } from '../../services/portalAccessService';
import { useToast } from '../shared/Toast';

const fmtDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : '');

export default function PortalJoinCode({ orgId }) {
  const toast = useToast();
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      setRow(await portalAccessService.getJoinCode(orgId));
    } catch {
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const rotate = async (firstTime) => {
    if (!firstTime && !window.confirm('Issue a new code? The current one stops working immediately.')) return;
    setBusy(true);
    try {
      await portalAccessService.rotateJoinCode(orgId, true);
      await load();
      toast(firstTime ? 'Join code created' : 'New code issued', 'success');
    } catch (err) {
      toast(err.message || 'Could not change the code.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    setBusy(true);
    try {
      await portalAccessService.setJoinEnabled(orgId, !row.portal_join_enabled);
      await load();
      toast(row.portal_join_enabled ? 'Self sign-up turned off' : 'Self sign-up turned on', 'success');
    } catch (err) {
      toast(err.message || 'Could not change that.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (what, value) => {
    await navigator.clipboard.writeText(value);
    setCopied(what);
    setTimeout(() => setCopied(''), 2000);
  };

  if (loading) {
    return <p className="join-muted"><Loader2 className="spin" size={15} /> Loading…</p>;
  }

  const expired = row?.portal_join_expires_at && new Date(row.portal_join_expires_at) < new Date();
  const live = row?.portal_join_code && row.portal_join_enabled && !expired;

  if (!row?.portal_join_code) {
    return (
      <div>
        <p className="prod-field-note" style={{ marginBottom: '0.6rem' }}>
          Instead of inviting people one at a time, share a code. Staff open the link, sign in with
          their work email, and land in their own portal — but only if you have already added them
          as an employee with that address.
        </p>
        <button type="button" className="prod-btn-primary" onClick={() => rotate(true)} disabled={busy}>
          <KeyRound size={14} /> {busy ? 'Creating…' : 'Create a join code'}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <code style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '1.35rem', letterSpacing: '0.28em', fontWeight: 600,
          padding: '0.5rem 0.9rem', borderRadius: '10px',
          background: 'var(--bg-base)', border: '1px solid var(--border-default)',
          color: live ? 'var(--text-primary)' : 'var(--text-muted)',
        }}>
          {row.portal_join_code}
        </code>
        <span className={`pa-state ${live ? 'active' : 'none'}`}>
          {live ? 'Accepting sign-ups' : expired ? 'Expired' : 'Turned off'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        <button type="button" className="prod-btn-ghost" onClick={() => copy('code', row.portal_join_code)}>
          {copied === 'code' ? <Check size={13} /> : <Copy size={13} />} Copy code
        </button>
        <button
          type="button" className="prod-btn-ghost"
          onClick={() => copy('link', joinUrl({ code: row.portal_join_code }))}
        >
          {copied === 'link' ? <Check size={13} /> : <Copy size={13} />} Copy link
        </button>
        <button type="button" className="prod-btn-ghost" onClick={toggle} disabled={busy}>
          {row.portal_join_enabled ? 'Turn off' : 'Turn on'}
        </button>
        <button type="button" className="prod-btn-ghost" onClick={() => rotate(false)} disabled={busy}>
          <RefreshCw size={13} /> New code
        </button>
      </div>

      <p className="prod-field-note" style={{ margin: 0 }}>
        {/* Said plainly, because an admin sharing this in a group chat is
            entitled to know exactly how far it reaches. */}
        Anyone with this code can join <strong>only</strong> as an employee, and only if you have
        already added them with the email address they sign in with. It always grants the employee
        role — never an admin seat.
        {row.portal_join_expires_at && (
          <> The code {expired ? 'expired on' : 'expires on'} {fmtDate(row.portal_join_expires_at)};
          issue a new one to extend it.</>
        )}
      </p>
    </div>
  );
}
