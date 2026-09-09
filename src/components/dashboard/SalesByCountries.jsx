import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronDown, Globe } from 'lucide-react';
import { useOrg } from '../../context/OrgContext';
import { catalogService } from '../../services/catalogService';
import { salesGeoService, summarise, PERIODS, periodRange } from '../../services/salesGeoService';

/**
 * Sales by Countries.
 *
 * The map geometry is real (Natural Earth via world-atlas, projected at build
 * time by scripts/generate-world-map.js) and lazily imported, so its ~150KB
 * lands in its own chunk rather than in everyone's first paint.
 *
 * Every figure comes from the sales_by_country() RPC. Nothing here sums
 * documents; this component picks a window and draws the answer.
 */

const TOP_OPTIONS = [
  { id: 3, label: 'Top 3' },
  { id: 4, label: 'Top 4' },
  { id: 6, label: 'Top 6' },
  { id: 99, label: 'All countries' },
];

/**
 * ISO alpha-2 to the regional-indicator pair that renders as a flag.
 *
 * Windows has no flag glyphs, so there it falls back to the two letters — which
 * inside the circular chip reads as a country code rather than as breakage. The
 * alternative is fetching images from a flag CDN on every render, which trades
 * a cosmetic gap for a third-party request on the dashboard.
 */
function flagEmoji(code) {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

const money = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

/**
 * Keep callouts from sitting on top of each other.
 *
 * Countries are laid out by geography, not by convenience — Finland and Norway
 * are 6 map-units apart — so drawn at their anchors two callouts would overlap
 * into an unreadable stack. Boxes are placed strongest-first and any that
 * collides with one already placed is lifted above it, keeping the pointer on
 * the right country while the label moves out of the way.
 */
// Callout geometry, in map units rather than pixels, so it means the same thing
// at every rendered width.
const BOX_W = 150;
const BOX_H = 46;

function layoutCallouts(entries, centroids, height) {
  const GAP = 6;

  const placed = [];
  for (const e of entries) {
    const c = centroids[e.code];
    if (!c) continue;

    let [x, y] = c;
    // The box floats above its anchor with a visible run of leader line between
    // them. The gap is what makes the connection readable: sat directly on the
    // country, a bubble looks like it is covering the answer rather than
    // pointing at it.
    const LIFT = 28;
    let boxY = y - BOX_H - LIFT;

    let guard = 0;
    while (guard < 12) {
      const clash = placed.find((p) =>
        Math.abs(p.boxX - x) < BOX_W + GAP && Math.abs(p.boxY - boxY) < BOX_H + GAP
      );
      if (!clash) break;
      boxY = clash.boxY - BOX_H - GAP;
      guard += 1;
    }

    // Never push a callout off the top of the frame; drop it below the anchor
    // instead, which the pointer direction follows.
    const below = boxY < 4;
    if (below) boxY = Math.min(y + LIFT, height - BOX_H - 4);

    placed.push({ ...e, anchorX: x, anchorY: y, boxX: x, boxY, below });
  }
  return placed;
}

function Dropdown({ value, options, onChange, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const current = options.find((o) => o.id === value);

  return (
    <div ref={ref} className="sbc-dd">
      <button
        type="button"
        aria-label={ariaLabel}
        className="sbc-dd-btn"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current?.label ?? '—'}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="sbc-dd-menu">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`sbc-dd-item ${o.id === value ? 'active' : ''}`}
              onClick={() => { onChange(o.id); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SalesByCountries() {
  const { activeOrg } = useOrg();

  const [map, setMap] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState('12m');
  const [topN, setTopN] = useState(4);
  const [productId, setProductId] = useState('all');

  // The geometry is static and large: import it once, on mount, into its own
  // chunk. Failing to load it must not take the panel's numbers down with it.
  useEffect(() => {
    let cancelled = false;
    import('../../data/worldMap.js')
      .then((m) => { if (!cancelled) setMap(m); })
      .catch(() => { if (!cancelled) setMap(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!activeOrg) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { from, to } = periodRange(period);
      const data = await salesGeoService.byCountry(activeOrg.id, {
        from,
        to,
        catalogItemId: productId === 'all' ? null : productId,
      });
      if (!cancelled) { setRows(data); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [activeOrg, period, productId]);

  // Read on each render rather than memoised: the catalogue is a synchronous
  // orgStore cache lookup over a handful of rows, and doing it here means a
  // product added on the Products page appears in this filter without a reload.
  const products = [
    { id: 'all', label: 'All Products' },
    ...catalogService.getActive().map((p) => ({ id: p.id, label: p.name })),
  ];

  const summary = useMemo(() => summarise(rows), [rows]);

  const names = map ? map.COUNTRY_NAMES : {};

  const ranked = useMemo(
    () => rows.filter((r) => r.code && r.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue),
    [rows]
  );

  const shown = ranked.slice(0, topN);
  const highlighted = new Set(shown.map((r) => r.code));

  const callouts = useMemo(() => {
    if (!map) return [];
    return layoutCallouts(shown, map.COUNTRY_CENTROIDS, map.MAP_HEIGHT);
  }, [map, shown]);

  const periodOptions = PERIODS.map((p) => ({ id: p.id, label: p.label }));

  return (
    <div className="pro-card sbc-card">
      <div className="sbc-head">
        <div>
          <h3 className="sbc-title">Sales by Countries</h3>
          <p className="sbc-sub">Keep track of all orders here</p>
        </div>
        <div className="sbc-filters">
          <Dropdown
            ariaLabel="Filter by product"
            value={productId}
            options={products}
            onChange={setProductId}
          />
          <Dropdown
            ariaLabel="How many countries to show"
            value={topN}
            options={TOP_OPTIONS}
            onChange={setTopN}
          />
        </div>
      </div>

      <div className="sbc-body">
        <div className="sbc-panel">
          <div className="sbc-metric">
            <span className="sbc-metric-label">Top Performing Country</span>
            <strong className="sbc-metric-value">
              {summary.top ? money(summary.top.revenue) : '—'}
            </strong>
            <span className="sbc-metric-note">
              {summary.top ? (names[summary.top.code] || summary.top.code) : 'No sales in this period'}
            </span>
          </div>

          <div className="sbc-metric">
            <span className="sbc-metric-label">Revenue Growth</span>
            <strong
              className="sbc-metric-value"
              style={summary.growthPct != null && summary.growthPct < 0
                ? { color: 'var(--error)' } : undefined}
            >
              {summary.growthPct == null
                ? '—'
                : `${summary.growthPct >= 0 ? '+' : ''}${summary.growthPct.toFixed(0)}%`}
            </strong>
            <span className="sbc-metric-note">
              {summary.growthPct == null
                ? 'No earlier period to compare'
                : summary.drivers.length
                  ? summary.drivers.map((d) => names[d.code] || d.code).join(' and ')
                  : 'No country grew against last period'}
            </span>
          </div>

          <div className="sbc-metric">
            <span className="sbc-metric-label">Period</span>
            <Dropdown
              ariaLabel="Reporting period"
              value={period}
              options={periodOptions}
              onChange={setPeriod}
            />
          </div>
        </div>

        <div className="sbc-map-wrap">
          {map === null ? (
            <div className="sbc-map-state"><div className="pro-spinner" /></div>
          ) : map === false ? (
            <div className="sbc-map-state">
              <Globe size={26} />
              <span>Map could not be loaded. The figures on the left are unaffected.</span>
            </div>
          ) : (
            <div className="sbc-map">
              <svg
                viewBox={`0 0 ${map.MAP_WIDTH} ${map.MAP_HEIGHT}`}
                className="sbc-svg"
                role="img"
                aria-label="World map of revenue by country"
              >
                {map.UNMATCHED_PATHS.map((d, i) => (
                  <path key={`u${i}`} d={d} className="sbc-country" />
                ))}
                {Object.entries(map.COUNTRY_PATHS).map(([code, d]) => (
                  <path
                    key={code}
                    d={d}
                    className={`sbc-country ${highlighted.has(code) ? 'active' : ''}`}
                  >
                    <title>{names[code] || code}</title>
                  </path>
                ))}

                {/* Leader lines, drawn here rather than in CSS. A stem sized as
                    a percentage resolves against the bubble it hangs off — a
                    few pixels — not against the map, so it never reached the
                    country. In map units it scales with everything else. */}
                {callouts.map((c) => (
                  <g key={`pin-${c.code}`} className="sbc-pin">
                    <line
                      x1={c.anchorX}
                      y1={c.anchorY}
                      x2={c.boxX}
                      y2={c.below ? c.boxY : c.boxY + BOX_H}
                    />
                    <circle cx={c.anchorX} cy={c.anchorY} r={4} />
                  </g>
                ))}
              </svg>

              {callouts.map((c) => {
                const left = (c.boxX / map.MAP_WIDTH) * 100;
                const top = (c.boxY / map.MAP_HEIGHT) * 100;
                return (
                  <div
                    key={c.code}
                    className={`sbc-callout ${c.below ? 'below' : ''}`}
                    style={{ left: `${left}%`, top: `${top}%` }}
                  >
                    <span className="sbc-flag" aria-hidden="true">{flagEmoji(c.code)}</span>
                    <span className="sbc-callout-text">
                      <span className="sbc-callout-name">{names[c.code] || c.code}</span>
                      <span className="sbc-callout-amount">{money(c.revenue)}</span>
                    </span>
                  </div>
                );
              })}

              {!loading && ranked.length === 0 && (
                <div className="sbc-map-empty">
                  No invoices with a country in this period yet.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {summary.unspecified && summary.unspecified.revenue > 0 && (
        <p className="sbc-foot">
          {money(summary.unspecified.revenue)} is not attributed to any country —
          those documents have no country on them and none could be inferred from
          the customer or your organisation profile.
        </p>
      )}
    </div>
  );
}
