// generate-world-map.js — bake the world map into a static module.
//
// Run:  node scripts/generate-world-map.js
// Out:  src/data/worldMap.js
//
// Why generate rather than project at runtime: d3-geo, topojson-client and
// world-atlas together are ~500KB of dependency to produce a few hundred
// immutable path strings that never change between builds. They are
// devDependencies, this script runs when the map needs regenerating, and the
// app itself ships no new runtime dependency at all.
//
// The output is lazily imported by SalesByCountries so the geometry lands in
// its own chunk instead of the main bundle.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { geoPath, geoNaturalEarth1 } from 'd3-geo';
import { feature } from 'topojson-client';
import countries from 'i18n-iso-countries';

const require = createRequire(import.meta.url);
const topo = JSON.parse(
  readFileSync(require.resolve('world-atlas/countries-110m.json'), 'utf8')
);

const WIDTH = 960;
const HEIGHT = 480;

// Natural Earth I: flatter poles than Mercator, so Greenland stays the size of
// Greenland rather than the size of Africa.
//
// Antarctica is dropped, not merely cropped. It is a fifth of the projected
// height, nobody invoices anyone there, and leaving it in shrinks every
// continent that matters to make room for it. Excluding it BEFORE fitSize is
// what lets the rest of the world fill the frame.
const ANTARCTICA_ID = '010';

const all = feature(topo, topo.objects.countries);
const drawn = {
  type: 'FeatureCollection',
  features: all.features.filter((f) => String(f.id).padStart(3, '0') !== ANTARCTICA_ID),
};

const projection = geoNaturalEarth1().fitSize([WIDTH, HEIGHT], drawn);
// 2 decimal places: at this viewBox that is sub-pixel, and it cuts the output
// roughly in half against d3's default precision.
const path = geoPath(projection).digits(2);

const fc = drawn;

const out = {};
const names = {};
const unmatched = [];
const skipped = [];

for (const f of fc.features) {
  const d = path(f);
  if (!d) continue;

  const alpha2 = countries.numericToAlpha2(String(f.id).padStart(3, '0'));
  if (!alpha2) {
    // N. Cyprus, Somaliland and Kosovo carry no ISO numeric id in world-atlas.
    // They are still drawn, as part of the world's silhouette — just in a
    // separate list with no key, since no sales row could ever match them.
    unmatched.push(d);
    skipped.push(f.properties?.name);
    continue;
  }
  out[alpha2] = d;
  names[alpha2] = f.properties?.name || countries.getName(alpha2, 'en') || alpha2;
}

// The full ISO 3166-1 list, not just the 174 shapes above. A customer can be in
// Monaco or Singapore — too small to have a polygon at 110m resolution, but
// they must still be selectable, and their revenue must still be counted even
// though the map cannot draw them.
const allCountries = Object.entries(countries.getNames('en', { select: 'official' }))
  .map(([code, name]) => [code, name])
  .sort((a, b) => a[1].localeCompare(b[1]));

// Label anchors: where a callout pin points.
//
// NOT the centroid of the whole country. The United States is a MultiPolygon
// including Alaska and Hawaii, and its true centroid sits in British Columbia —
// a pin there labels the wrong country. Taking the centroid of the single
// largest projected landmass puts the US pin in Kansas, France in France rather
// than the mid-Atlantic, and Norway on the mainland instead of Svalbard.
function anchorOf(f) {
  const g = f.geometry;
  if (!g) return null;
  if (g.type !== 'MultiPolygon' || g.coordinates.length === 1) {
    return path.centroid(f);
  }
  let best = null;
  let bestArea = -1;
  for (const coords of g.coordinates) {
    const piece = { type: 'Polygon', coordinates: coords };
    const area = path.area(piece);
    if (area > bestArea) { bestArea = area; best = piece; }
  }
  return best ? path.centroid(best) : path.centroid(f);
}

const centroids = {};
for (const f of fc.features) {
  const alpha2 = countries.numericToAlpha2(String(f.id).padStart(3, '0'));
  if (!alpha2 || !out[alpha2]) continue;
  const c = anchorOf(f);
  if (c && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
    centroids[alpha2] = [Math.round(c[0] * 10) / 10, Math.round(c[1] * 10) / 10];
  }
}

const banner = `// GENERATED FILE — do not edit by hand.
// Regenerate with:  node scripts/generate-world-map.js
//
// Source: world-atlas countries-110m (Natural Earth, public domain),
// projected with d3-geo geoNaturalEarth1 onto a ${WIDTH}x${HEIGHT} viewBox.
// Keyed by ISO 3166-1 alpha-2, which is what financial_documents.country_code
// stores, so a row joins to a shape with no name matching anywhere.
`;

const body = `${banner}
export const MAP_WIDTH = ${WIDTH};
export const MAP_HEIGHT = ${HEIGHT};

/** ISO alpha-2 -> SVG path data. */
export const COUNTRY_PATHS = ${JSON.stringify(out)};

/** ISO alpha-2 -> projected [x, y] centroid, for pinning callouts. */
export const COUNTRY_CENTROIDS = ${JSON.stringify(centroids)};

/** ISO alpha-2 -> English display name, for the countries with a shape. */
export const COUNTRY_NAMES = ${JSON.stringify(names)};

/** Shapes with no ISO code. Drawn as background only; never highlighted. */
export const UNMATCHED_PATHS = ${JSON.stringify(unmatched)};

/**
 * Every ISO 3166-1 alpha-2 country, as [code, name], alphabetical.
 * Wider than COUNTRY_PATHS: a customer can be somewhere the 110m map is too
 * coarse to draw. Revenue from those still aggregates; it just has no polygon.
 */
export const ALL_COUNTRIES = ${JSON.stringify(allCountries)};
`;

mkdirSync('src/data', { recursive: true });
writeFileSync('src/data/worldMap.js', body, 'utf8');

console.log(`wrote src/data/worldMap.js`);
console.log(`  countries: ${Object.keys(out).length}`);
console.log(`  centroids: ${Object.keys(centroids).length}`);
console.log(`  size: ${(Buffer.byteLength(body) / 1024).toFixed(0)} KB`);
if (skipped.length) console.log(`  no ISO code (drawn but unmatchable): ${skipped.join(', ')}`);
