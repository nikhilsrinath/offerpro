import { useT, MONO } from '../ui/edgeUtils';
import { Status } from '../ui/edge';
import { money, monthLabel } from './adminUtils';

/* The few display pieces the console needs that the shared kit does not
   already carry. Everything else — Panel, Table, Stat, Modal, Btn — comes from
   components/ui/edge so the console is the same object as the rest of EdgeOS.  */

/* ── plan ─────────────────────────────────────────────────────────────────── */

export function PlanTag({ plan }) {
  const t = useT();
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 19, padding: '0 7px',
      borderRadius: 5, border: '1px solid ' + t.line, background: t.panelAlt,
      fontSize: 9.5, letterSpacing: '0.07em', color: plan === 'max' ? t.up : t.dim,
      textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>{plan || 'free'}</span>
  );
}

export function SubStatus({ status }) {
  const tone = status === 'active' || status === 'trialing' ? 'up'
    : status === 'past_due' || status === 'cancelled' ? 'down' : 'mute';
  return <Status tone={tone}>{String(status || 'active').replace('_', ' ')}</Status>;
}

/* ── chart ────────────────────────────────────────────────────────────────── */

/**
 * Twelve months of two figures. Paired bars rather than a line: the two series
 * are billed against collected, and the gap between them is the reading — a
 * line chart makes that gap something you measure instead of something you see.
 *
 * The figures are also in the bar's title, so the chart is not the only way to
 * get the numbers out of it.
 */
export function MonthBars({ series, height = 132, keys = ['billed', 'collected'], labels = ['Billed', 'Collected'] }) {
  const t = useT();
  const peak = Math.max(1, ...series.flatMap((p) => keys.map((k) => Number(p[k]) || 0)));
  const isMoney = keys[0] !== 'signups';
  const plot = Math.max(30, height - 18); // the rest is the month label row

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, marginBottom: 10, paddingLeft: 2 }}>
        {labels.map((l, i) => (
          <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 9.5, color: t.faint }}>
            <span aria-hidden="true" style={{
              width: 8, height: 8, borderRadius: 2,
              background: i === 0 && keys.length > 1 ? t.scale[2] : t.chart,
            }} />
            {l}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
        {series.map((p) => (
          <div key={p.month} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            {/* An explicit pixel height, not flex: 1 — a percentage height on
                the bars only resolves against a parent whose own height is
                definite, and a flex item's computed height is not. */}
            <div
              style={{ height: plot, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2 }}
              title={`${monthLabel(p.month)} — ${keys.map((k, i) => `${labels[i]} ${isMoney ? money(p[k]) : (p[k] || 0)}`).join(' · ')}`}
            >
              {keys.map((k, i) => (
                <span key={k} style={{
                  flex: 1, maxWidth: 13, borderRadius: '2px 2px 0 0',
                  height: `${Math.max(Number(p[k]) ? 2 : 0, ((Number(p[k]) || 0) / peak) * 100)}%`,
                  background: i === 0 && keys.length > 1 ? t.scale[2] : t.chart,
                }} />
              ))}
            </div>
            <span style={{ fontSize: 8.5, color: t.ghost, whiteSpace: 'nowrap' }}>{monthLabel(p.month)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── detail ───────────────────────────────────────────────────────────────── */

/** A label-over-value pair. The console's unit of "here is a fact". */
export function KeyVal({ label, children, mono }) {
  const t = useT();
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9, letterSpacing: '0.09em', color: t.faint, marginBottom: 4 }}>
        {String(label).toUpperCase()}
      </div>
      <div style={{
        fontSize: 11.5, color: t.text, wordBreak: 'break-word',
        fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : MONO,
      }}>{children || <span style={{ color: t.ghost }}>—</span>}</div>
    </div>
  );
}

/** A mailto/tel/href that looks like body text until you hover it. */
export function Link({ href, children }) {
  const t = useT();
  if (!href) return <span style={{ color: t.ghost }}>—</span>;
  const external = href.startsWith('http');
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
      style={{ color: t.text, textDecoration: 'none', borderBottom: '1px solid ' + t.line }}
    >{children}</a>
  );
}
