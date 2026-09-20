import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutGrid, Building2, Mail, Sun, Moon, LogOut, ShieldCheck, RefreshCw, ArrowUpRight,
} from 'lucide-react';
import { useT, MONO } from '../ui/edgeUtils';

/* The console's frame. Deliberately the same object as ModuleShell — a rail of
   sections on the left, a hairline top bar, the account at its right end — so
   the platform console reads as part of EdgeOS rather than a second product
   bolted to the side of it. It does not reuse ModuleShell itself because that
   one is built around an active tenant, and the console has none. */

const SECTIONS = [
  { to: '/admin', end: true, label: 'Overview', icon: LayoutGrid, note: 'Platform totals' },
  { to: '/admin/orgs', label: 'Organisations', icon: Building2, note: 'Users · revenue · plans' },
  { to: '/admin/mail', label: 'Mail', icon: Mail, note: 'Reach customers' },
];

export default function AdminShell({
  theme, onToggleTheme, email, onSignOut, title, subtitle, actions, onRefresh, busy, children,
}) {
  const t = useT();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', background: t.shell,
      fontFamily: MONO, color: t.text,
    }}>
      {/* ── rail ─────────────────────────────────────────────────────────── */}
      <nav aria-label="Console sections" style={{
        width: 214, flexShrink: 0, background: t.panel,
        borderRight: '1px solid ' + t.line,
        display: 'flex', flexDirection: 'column',
        position: 'sticky', top: 0, height: '100vh',
      }}>
        <div style={{
          padding: '15px 14px', borderBottom: '1px solid ' + t.lineSoft,
          display: 'flex', alignItems: 'center', gap: 9,
        }}>
          <span aria-hidden="true" style={{
            width: 26, height: 26, borderRadius: 7, display: 'grid', placeItems: 'center',
            background: t.panelAlt, border: '1px solid ' + t.line, color: t.dim, flexShrink: 0,
          }}><ShieldCheck size={13} /></span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 11.5, color: t.text }}>Platform</span>
            <span style={{ display: 'block', fontSize: 9, letterSpacing: '0.09em', color: t.faint, marginTop: 1 }}>
              CONSOLE
            </span>
          </span>
        </div>

        <div style={{ padding: 8, display: 'grid', gap: 2 }}>
          {SECTIONS.map((s) => (
            <NavLink key={s.to} to={s.to} end={s.end} style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '8px 10px', borderRadius: 7, textDecoration: 'none',
              background: isActive ? t.panelAlt : 'transparent',
              border: '1px solid ' + (isActive ? t.line : 'transparent'),
              color: isActive ? t.text : t.dim,
            })}>
              {({ isActive }) => (
                <>
                  <s.icon size={13} aria-hidden="true" style={{ flexShrink: 0, color: isActive ? t.text : t.faint }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 11.5 }}>{s.label}</span>
                    <span style={{ display: 'block', fontSize: 9, color: t.ghost, marginTop: 1 }}>{s.note}</span>
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <button
          type="button" onClick={() => navigate('/hub')} className="edge-row"
          style={{
            margin: 8, padding: '8px 10px', borderRadius: 7, textAlign: 'left',
            display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer',
            background: 'transparent', border: '1px solid transparent',
            color: t.dim, fontFamily: MONO, fontSize: 11.5,
          }}
        >
          <ArrowUpRight size={13} aria-hidden="true" style={{ color: t.faint, flexShrink: 0 }} />
          Back to workspace
        </button>
      </nav>

      {/* ── content ──────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '13px 20px', background: t.panel,
          borderBottom: '1px solid ' + t.line,
          position: 'sticky', top: 0, zIndex: 30,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 13, fontWeight: 500, color: t.text, letterSpacing: '-0.01em' }}>
              {title}
            </h1>
            {subtitle && (
              <p style={{ margin: '3px 0 0', fontSize: 10, color: t.faint, lineHeight: 1.5 }}>{subtitle}</p>
            )}
          </div>

          {actions}

          {onRefresh && (
            <IconBtn t={t} label={busy ? 'Refreshing' : 'Refresh'} onClick={onRefresh} disabled={busy}>
              <RefreshCw size={13} style={busy ? { animation: 'edgeSpin 1s linear infinite' } : undefined} />
            </IconBtn>
          )}

          <IconBtn t={t} label={theme === 'dark' ? 'Switch to light' : 'Switch to dark'} onClick={onToggleTheme}>
            {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
          </IconBtn>

          <div style={{ position: 'relative' }}>
            <button
              type="button" onClick={() => setMenu((v) => !v)}
              aria-expanded={menu} aria-haspopup="menu" className="edge-btn"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, height: 29, padding: '0 10px',
                borderRadius: 7, cursor: 'pointer', maxWidth: 230,
                background: t.panelAlt, border: '1px solid ' + t.line,
                color: t.dim, fontFamily: MONO, fontSize: 10.5,
              }}
            >
              <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, background: t.up, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
            </button>

            {menu && (
              <>
                <div
                  onClick={() => setMenu(false)} aria-hidden="true"
                  style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                />
                <div role="menu" style={{
                  position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 41, width: 210,
                  background: t.panel, border: '1px solid ' + t.lineStrong,
                  borderRadius: 9, boxShadow: t.shadow, padding: 5,
                }}>
                  <div style={{ padding: '7px 9px 9px', borderBottom: '1px solid ' + t.lineSoft, marginBottom: 4 }}>
                    <div style={{ fontSize: 9, letterSpacing: '0.09em', color: t.faint }}>SIGNED IN AS</div>
                    <div style={{ fontSize: 10.5, color: t.text, marginTop: 3, wordBreak: 'break-all' }}>{email}</div>
                  </div>
                  <button
                    type="button" role="menuitem" className="edge-row"
                    onClick={() => { setMenu(false); onSignOut(); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                      padding: '8px 9px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                      background: 'transparent', border: 'none',
                      color: t.down, fontFamily: MONO, fontSize: 11.5,
                    }}
                  >
                    <LogOut size={13} aria-hidden="true" /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main style={{ flex: 1, minWidth: 0, padding: '18px 20px 40px', background: t.panel }}>
          {children}
        </main>
      </div>

      <style>{`
        @keyframes edgeSpin { to { transform: rotate(360deg); } }
        .edge-row:hover { background: ${t.panelAlt} !important; }
        a[href]:focus-visible, button:focus-visible {
          outline: 2px solid ${t.text}; outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}

function IconBtn({ t, label, onClick, disabled, children }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      aria-label={label} title={label} className="edge-btn"
      style={{
        width: 29, height: 29, borderRadius: 7, display: 'grid', placeItems: 'center',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
        background: t.panel, border: '1px solid ' + t.line, color: t.dim,
      }}
    >{children}</button>
  );
}
