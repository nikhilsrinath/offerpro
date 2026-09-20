import { useCallback, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { EdgeThemeContext } from '../../theme/EdgeTheme';
import { useTheme } from '../../hooks/useTheme';
import { adminService, isPlatformAdmin } from '../../services/adminService';
import AdminLogin from './AdminLogin';
import AdminShell from './AdminShell';
import AdminOverview from './AdminOverview';
import AdminOrgs from './AdminOrgs';
import AdminMail from './AdminMail';

/* ══════════════════════════════════════════════════════════════════════════
   The platform console, at /admin.

   Everything the operator needs about the business in one place: who has
   signed up, what each tenant has billed and collected, how to reach them,
   what plan they are on, and a composer for writing to any slice of them.

   It is its own tree rather than a module of the workspace, because the
   workspace is scoped to one tenant and this is scoped to all of them. The
   gate is a real Supabase sign-in checked against the `platform_admin` claim
   and the operator's address — and /api/admin re-checks both on every single
   request, so nothing here is load-bearing security on its own.
   ══════════════════════════════════════════════════════════════════════════ */

const PAGES = {
  '/admin': { title: 'Overview', subtitle: 'Every tenant, their revenue and the last twelve months' },
  '/admin/orgs': { title: 'Organisations', subtitle: 'Users, contacts, revenue and plans — open a row for the whole record' },
  '/admin/mail': { title: 'Mail', subtitle: 'Write to one tenant, a plan tier, or everybody' },
};

export default function AdminApp() {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  // ── session ──────────────────────────────────────────────────────────────
  const [session, setSession] = useState(undefined); // undefined = still checking

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSession(data.session ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, next) => {
      if (!cancelled) setSession(next ?? null);
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  const user = session?.user ?? null;
  const allowed = isPlatformAdmin(user);

  // ── data ─────────────────────────────────────────────────────────────────
  const [overview, setOverview] = useState(null);
  const [orgs, setOrgs] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // One round trip each, in parallel: the overview is aggregated
      // server-side and the org list is what every other screen filters.
      const [o, l] = await Promise.all([adminService.overview(), adminService.listOrgs()]);
      setOverview(o);
      setOrgs(l.orgs);
    } catch (err) {
      setError(err.message || 'Could not read the platform.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  // ── mail hand-off ────────────────────────────────────────────────────────
  // "Email these" from Organisations navigates to the composer carrying the
  // addresses, so the list the operator was looking at is the list that gets
  // written to.
  const [mailPreset, setMailPreset] = useState(null);
  const mailTo = useCallback((addresses) => {
    setMailPreset(addresses.filter(Boolean));
    navigate('/admin/mail');
  }, [navigate]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setOverview(null);
    setOrgs(null);
  };

  // ── gate ─────────────────────────────────────────────────────────────────
  if (session === undefined) {
    return (
      <EdgeThemeContext.Provider value={theme}>
        <div className="app-loading">
          <div style={{ textAlign: 'center' }}>
            <div className="app-loading-spinner" />
            <span className="app-loading-text">Checking access…</span>
          </div>
        </div>
      </EdgeThemeContext.Provider>
    );
  }

  if (!allowed) {
    return (
      <EdgeThemeContext.Provider value={theme}>
        <AdminLogin wrongAccount={user ? user.email : null} />
      </EdgeThemeContext.Provider>
    );
  }

  const meta = PAGES[location.pathname] || PAGES['/admin'];

  return (
    <EdgeThemeContext.Provider value={theme}>
      <AdminShell
        theme={theme} onToggleTheme={toggleTheme}
        email={user.email} onSignOut={signOut}
        title={meta.title} subtitle={meta.subtitle}
        onRefresh={load} busy={loading}
      >
        <Routes>
          <Route index element={
            <AdminOverview data={overview} orgs={orgs} loading={loading} error={error} />
          } />
          <Route path="orgs" element={
            <AdminOrgs
              orgs={orgs} loading={loading} error={error}
              onChanged={load} onMailTo={mailTo}
            />
          } />
          <Route path="mail" element={<AdminMail orgs={orgs} preset={mailPreset} />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </AdminShell>
    </EdgeThemeContext.Provider>
  );
}
