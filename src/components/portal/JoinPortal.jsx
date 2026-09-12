// JoinPortal.jsx — the one page an employee sees before they have an account.
//
// Reached two ways:
//   /join?t=<token>   the link in the invitation email
//   /join?c=<code>    or typed, from the code shared in the team chat
//
// It renders outside the app shell and outside the onboarding gate on purpose.
// A person arriving here has no membership, and the gate reads "no membership"
// as "needs to create a company" — which is the opposite of what is happening.
//
// Redemption is idempotent and runs on its own as soon as there is a session,
// so a Google round-trip lands back here and finishes without another click.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Loader2, ArrowRight, KeyRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { portalAccessService } from '../../services/portalAccessService';

const CODE_RE = /^[A-Z2-9]{8}$/;

export default function JoinPortal() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading, login, signup } = useAuth();

  const token = params.get('t') || '';
  const [code, setCode] = useState((params.get('c') || '').toUpperCase());

  const [intro, setIntro] = useState(null);      // {orgName, employeeName, invitedEmail, problem}
  const [phase, setPhase] = useState('loading'); // loading | signin | working | done | dead
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const redeemed = useRef(false);

  // ── What to say before they sign in ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (token) {
        const p = await portalAccessService.previewInvite(token);
        if (cancelled) return;
        setIntro({
          orgName: p.org_name, employeeName: p.employee_name,
          invitedEmail: p.invited_email, problem: p.problem,
        });
        setForm((f) => ({ ...f, email: p.invited_email || '' }));
        setPhase(p.problem ? 'dead' : 'signin');
      } else if (CODE_RE.test(code)) {
        const name = await portalAccessService.previewCode(code);
        if (cancelled) return;
        setIntro({ orgName: name });
        setPhase(name ? 'signin' : 'dead');
        if (!name) setError('That code is not valid. Ask for the current one.');
      } else {
        if (cancelled) return;
        setIntro(null);
        setPhase('signin');
      }
    })();
    return () => { cancelled = true; };
    // `code` deliberately absent: re-previewing on every keystroke would ask the
    // server to confirm partial codes. The form submit validates instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── Redeem, the moment there is a session ──────────────────────────────────
  const redeem = useCallback(async () => {
    if (redeemed.current) return;
    redeemed.current = true;
    setPhase('working');
    setError('');
    try {
      if (token) await portalAccessService.acceptInvite(token);
      else await portalAccessService.claimWithCode(code);
      setPhase('done');
      // Full reload, not a route change: AuthContext decided there was no
      // membership when this page mounted, and the app needs to re-read that.
      setTimeout(() => { window.location.assign('/me'); }, 1200);
    } catch (err) {
      // Deliberately NOT clearing `redeemed` here. The redeem effect watches
      // `phase`, so putting it back to 'signin' with the guard released re-runs
      // this immediately, and a server-side refusal loops forever. A failure is
      // terminal until the person asks to try again.
      setError(err.message || 'Could not complete your sign-in.');
      setFailed(true);
      setPhase('signin');
    }
  }, [token, code]);

  useEffect(() => {
    if (loading || !user || phase === 'loading' || phase === 'dead') return;
    if (phase === 'done' || phase === 'working' || failed) return;
    if (!token && !CODE_RE.test(code)) return;
    redeem();
  }, [user, loading, phase, failed, token, code, redeem]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const withPassword = async (e) => {
    e.preventDefault();
    setError('');
    setFailed(false);
    redeemed.current = false;
    if (!token && !CODE_RE.test(code)) {
      setError('Enter the 8-character code your employer gave you.');
      return;
    }
    setPhase('working');
    try {
      // Sign in if the account exists, create it if it does not. The employee
      // does not know or care which of the two they are doing.
      try {
        await login(form.email, form.password);
      } catch {
        await signup(form.email, form.password);
      }
      // The redeem effect picks it up from here.
      setPhase('signin');
    } catch (err) {
      setPhase('signin');
      setError(err.message || 'Could not sign you in.');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const org = intro?.orgName;

  if (phase === 'loading' || loading) {
    return (
      <Shell>
        <p className="join-muted"><Loader2 className="spin" size={16} /> Checking your link…</p>
      </Shell>
    );
  }

  if (phase === 'dead') {
    return (
      <Shell>
        <div className="join-icon bad"><AlertTriangle size={22} /></div>
        <h1>{intro?.problem || 'This link is not valid.'}</h1>
        <p className="join-sub">
          Ask whoever set up your portal for a fresh link or the current join code.
        </p>
        <button type="button" className="join-ghost" onClick={() => navigate('/login')}>
          Go to sign in
        </button>
      </Shell>
    );
  }

  if (phase === 'done') {
    return (
      <Shell>
        <div className="join-icon good"><CheckCircle2 size={22} /></div>
        <h1>You&rsquo;re in{org ? `, at ${org}` : ''}</h1>
        <p className="join-sub">Taking you to your portal…</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="join-eyebrow">{org ? org : 'Employee portal'}</p>
      <h1>
        {intro?.employeeName
          ? `${intro.employeeName.split(/\s+/)[0]}, your portal is ready`
          : 'Join your team&rsquo;s portal'}
      </h1>
      <p className="join-sub">
        Check in and out, see your attendance, apply for leave and read announcements.
        {intro?.invitedEmail && <> Sign in as <b>{intro.invitedEmail}</b>.</>}
      </p>

      {!token && (
        <label className="join-field">
          <span>Join code</span>
          <input
            id="join-code"
            className="join-input join-code"
            value={code}
            maxLength={8}
            autoCapitalize="characters"
            spellCheck="false"
            placeholder="XXXXXXXX"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))}
          />
        </label>
      )}

      {phase === 'working' ? (
        <p className="join-muted"><Loader2 className="spin" size={16} /> Setting up your access…</p>
      ) : (
        <form className="join-form" onSubmit={withPassword}>
          <label className="join-field">
            <span>Work email</span>
            <input
              id="join-email" type="email" className="join-input" required
              autoComplete="email" value={form.email}
              readOnly={!!intro?.invitedEmail}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label className="join-field">
            <span>Password</span>
            <input
              id="join-password" type="password" className="join-input" required
              minLength={6} autoComplete="current-password" value={form.password}
              placeholder="At least 6 characters"
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <button type="submit" className="join-primary">
            Continue <ArrowRight size={15} />
          </button>
          <p className="join-note">
            {/* Sign-in and sign-up are the same button on purpose — nobody
                arriving here knows or cares which of the two they are doing.
                Sign-in with a provider is deliberately absent: the address has
                to be the one on the employee record, and a provider returns
                whichever address it likes. */}
            If you don&rsquo;t have an account yet, this creates one.
          </p>
        </form>
      )}

      {error && (
        <>
          <p className="join-error"><AlertTriangle size={14} /> {error}</p>
          {failed && (
            <button
              type="button"
              className="join-switch"
              onClick={() => { redeemed.current = false; setError(''); setFailed(false); }}
            >
              Try again
            </button>
          )}
        </>
      )}

      {!token && !intro?.orgName && (
        <p className="join-note join-hint">
          <KeyRound size={13} /> The code is 8 characters, shared by your employer.
        </p>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="join-page">
      <div className="join-card">{children}</div>
    </div>
  );
}
