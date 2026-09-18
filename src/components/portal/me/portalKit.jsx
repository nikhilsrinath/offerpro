// portalKit.jsx — the few pieces the portal needs that the edge kit does not
// have: a photo avatar at any size, a KPI tile with a bar, a chart tooltip, and
// the check-in card. Everything reads the same tokens as ui/edge.jsx.
import { LogIn, LogOut, Check } from 'lucide-react';
import { useT, MONO } from '../../ui/edgeUtils';
import { Bar } from '../../ui/edge';
import { formatDuration, workedMinutes, todayKey } from '../../../services/attendanceService';
import { useSignedPhoto, clockTime, fmtLongDay, hoursLabel, useNow } from './portalUtils';

export function PhotoAvatar({ name = '', path, size = 36, radius }) {
  const t = useT();
  const url = useSignedPhoto(path);
  const ini = name.trim().split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  return (
    <span style={{
      width: size, height: size, flexShrink: 0, borderRadius: radius ?? Math.round(size / 4),
      overflow: 'hidden', display: 'grid', placeItems: 'center',
      background: t.panelAlt, border: '1px solid ' + t.line,
      fontSize: Math.round(size * 0.34), fontWeight: 600, color: t.dim, fontFamily: MONO,
    }}>
      {url
        ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        : ini}
    </span>
  );
}

export function SectionLabel({ children, right }) {
  const t = useT();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 9px' }}>
      <span style={{ fontSize: 9.5, letterSpacing: '0.1em', color: t.faint }}>{String(children).toUpperCase()}</span>
      <span style={{ flex: 1, height: 1, background: t.lineSoft }} />
      {right}
    </div>
  );
}

/** A headline number with a one-line explanation and, when it is a share of
    something, the bar that shows how much. */
export function Kpi({ label, value, note, share, tone }) {
  const t = useT();
  return (
    <div style={{
      border: '1px solid ' + t.line, borderRadius: 10, padding: '13px 14px 12px',
      background: t.panel, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <span style={{ fontSize: 9, letterSpacing: '0.1em', color: t.faint }}>{String(label).toUpperCase()}</span>
      <span style={{
        fontSize: 22, fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1.1,
        color: tone === 'up' ? t.up : tone === 'down' ? t.down : t.text,
      }}>{value}</span>
      {share != null && <Bar value={share} max={1} height={3} />}
      {note && <span style={{ fontSize: 10, color: t.faint, lineHeight: 1.4 }}>{note}</span>}
    </div>
  );
}

/** Recharts tooltip in the terminal style. `render(payload)` returns rows. */
export function ChartTip({ active, payload, render }) {
  const t = useT();
  if (!active || !payload?.length) return null;
  const rows = render(payload[0].payload);
  if (!rows) return null;
  return (
    <div style={{
      background: t.panel, border: '1px solid ' + t.lineStrong, borderRadius: 8,
      boxShadow: t.shadow, padding: '8px 10px', fontFamily: MONO, minWidth: 140,
    }}>
      {rows.map(([k, v], i) => (
        <div key={k} style={{
          display: 'flex', justifyContent: 'space-between', gap: 14,
          fontSize: i === 0 ? 11 : 10.5, color: i === 0 ? t.text : t.dim,
          marginBottom: i === 0 && rows.length > 1 ? 5 : 1,
        }}>
          <span>{k}</span>{v != null && <span style={{ color: t.text }}>{v}</span>}
        </div>
      ))}
    </div>
  );
}

/** Today's attendance, and the one button that changes it. */
export function ClockCard({ today, clocking, onClock, compact }) {
  const t = useT();
  const now = useNow(30000);
  const inAt = clockTime(today?.check_in);
  const outAt = clockTime(today?.check_out);
  const running = inAt && !outAt ? Math.max(0, Math.round((now - new Date(today.check_in)) / 60000)) : null;

  const state = !inAt ? 'Not checked in' : !outAt ? 'Working' : 'Day complete';
  const dot = !inAt ? t.ghost : !outAt ? t.up : t.dim;

  return (
    <div style={{
      border: '1px solid ' + t.line, borderRadius: 12, background: t.panel,
      padding: compact ? 14 : 18, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, height: '100%',
      boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, boxShadow: inAt && !outAt ? `0 0 0 3px ${t.up}33` : 'none' }} />
        <span style={{ fontSize: 9.5, letterSpacing: '0.1em', color: t.faint }}>TODAY · {fmtLongDay(todayKey()).toUpperCase()}</span>
      </div>

      <div>
        <div style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-0.04em', lineHeight: 1, color: t.text }}>
          {running != null ? hoursLabel(running) : outAt ? formatDuration(workedMinutes(today)) : '0h'}
        </div>
        <div style={{ fontSize: 10.5, color: t.faint, marginTop: 6 }}>{state}{running != null && ' — the clock is running'}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '1px solid ' + t.lineSoft, borderRadius: 8 }}>
        {[['IN', inAt], ['OUT', outAt]].map(([k, v], i) => (
          <div key={k} style={{ padding: '8px 11px', borderLeft: i ? '1px solid ' + t.lineSoft : 'none' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.1em', color: t.faint }}>{k}</div>
            <div style={{ fontSize: 13, color: v ? t.text : t.ghost, marginTop: 3 }}>{v || '--:--'}</div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      {/* Once the day is closed the button goes rather than re-opening it:
          correcting a finished day is a manager's job, not a second tap. */}
      {!outAt ? (
        <button
          type="button" className="edge-btn edge-btn-primary"
          onClick={() => onClock(inAt ? 'out' : 'in')} disabled={clocking}
          style={{
            height: 40, borderRadius: 9, border: '1px solid ' + t.text, background: t.text, color: t.panel,
            fontFamily: MONO, fontSize: 12.5, cursor: clocking ? 'wait' : 'pointer', opacity: clocking ? 0.6 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          {inAt ? <LogOut size={15} /> : <LogIn size={15} />}
          {clocking ? 'Saving…' : inAt ? 'Check out' : 'Check in'}
        </button>
      ) : (
        <div style={{
          height: 40, borderRadius: 9, border: '1px dashed ' + t.line, color: t.dim, fontSize: 11.5,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}><Check size={14} /> See you tomorrow</div>
      )}
    </div>
  );
}

/** A photo that fills its column — the admin sheet's portrait. */
export function PhotoPortrait({ name = '', path, radius = 14 }) {
  const t = useT();
  const url = useSignedPhoto(path);
  const ini = name.trim().split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  return (
    <div style={{
      width: '100%', aspectRatio: '1 / 1', borderRadius: radius, overflow: 'hidden', position: 'relative',
      background: t.panelAlt, border: '1px solid ' + t.line, display: 'grid', placeItems: 'center',
    }}>
      {url
        ? <img src={url} alt={name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ fontFamily: MONO, fontSize: 64, fontWeight: 500, letterSpacing: '-0.04em', color: t.ghost }}>{ini}</span>}
    </div>
  );
}
