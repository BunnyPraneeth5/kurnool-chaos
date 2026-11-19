// Landmark search rules shared by report.mjs and build.mjs.
// English and Telugu names come from the landmark table in docs/MAP-SPEC.md,
// so Bunny can fix spellings in one place.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DIR, project, inBox } from './common.mjs';
import { allNames, centerOf } from './geo.mjs';

const CIRCLE = /circle|centre|center/i;

/** Point landmarks found by OSM tags and names. River and bridge are handled in build.mjs. */
export const SPECS = [
  {
    id: 'fort',
    type: 'fort',
    score: (t) =>
      /konda ?reddy|kondareddy|buruju|burj|కొండారెడ్డి|బురుజు/i.test(allNames(t))
        ? 10 + (t.historic ? 5 : 0) - (t.highway ? 6 : 0)
        : 0,
  },
  {
    id: 'station',
    type: 'station',
    score: (t) => {
      if (t.railway === 'station') return 5 + (/kurnool|కర్నూలు/i.test(allNames(t)) ? 5 : 0);
      return /railway station|రైల్వే స్టేషన్/i.test(allNames(t)) && !t.highway ? 4 : 0;
    },
  },
  {
    id: 'busstand',
    type: 'busstand',
    score: (t) => {
      const n = allNames(t);
      if (t.amenity === 'bus_station') {
        // Main APSRTC Kurnool station, not the Rajvihar one or a depot (DECISIONS 2026-11-18).
        return 5 + (/kurnool|apsrtc|central|కర్నూలు/i.test(n) ? 5 : 0) - (/rajvihar|raj vihar|depot/i.test(n) ? 4 : 0);
      }
      return /bus ?stand|bus station|apsrtc|బస్ ?స్టాండ్/i.test(n) && !t.highway ? 4 : 0;
    },
  },
  {
    id: 'ccamp',
    type: 'junction',
    score: (t) =>
      /\bc[ .-]*camp\b|సి ?క్యాంప్/i.test(allNames(t)) ? (t.highway ? 5 : 10) + (CIRCLE.test(allNames(t)) ? 3 : 0) : 0,
  },
  {
    id: 'ggh',
    type: 'hospital',
    score: (t) => {
      const n = allNames(t);
      if (t.amenity === 'hospital' && /general hospital|\bggh\b|govt|government|సర్వజన/i.test(n)) return 10;
      return /general hospital|\bggh\b/i.test(n) && !t.highway ? 6 : 0;
    },
  },
  {
    id: 'kmc',
    type: 'college',
    score: (t) => {
      if (!/medical college|వైద్య కళాశాల/i.test(allNames(t)) || t.highway) return 0;
      if (/hostel|library|canteen|quarters/i.test(allNames(t))) return 4;
      return t.amenity === 'college' ? 12 : t.building === 'college' ? 11 : 10;
    },
  },
  {
    id: 'rajvihar',
    type: 'junction',
    score: (t) =>
      /raj ?vihar|రాజ్ ?విహార్/i.test(allNames(t)) ? (t.highway ? 5 : 10) + (CIRCLE.test(allNames(t)) ? 3 : 0) : 0,
  },
  {
    id: 'akestate',
    type: 'estate',
    score: (t) => (/abdul+ah? ?khan|అబ్దుల్లా ?ఖాన్/i.test(allNames(t)) ? (t.highway ? 5 : 10) : 0),
  },
];

/**
 * Hand-placed pins for landmarks OSM does not have, as [lat, lon].
 * Fill these in from Bunny. A pin overrides the OSM search.
 */
export const MANUAL_PINS = {
  akestate: null,
};

/** Candidates for one landmark, best first. */
export function rankCandidates(spec, pool) {
  const cands = [];
  for (const el of pool.values()) {
    const s = spec.score(el.tags);
    if (s <= 0) continue;
    const c = centerOf(el);
    if (!c) continue;
    const [x, z] = project(c[0], c[1]);
    cands.push({ el, s, c, x, z, inside: inBox(c[0], c[1]), d: Math.hypot(x, z) });
  }
  cands.sort((a, b) => b.s - a.s || Number(b.inside) - Number(a.inside) || a.d - b.d);
  return cands;
}

/** English and Telugu names per landmark id, read from the MAP-SPEC landmark table. */
export async function loadLandmarkNames() {
  const md = await readFile(join(DIR, '..', '..', 'docs', 'MAP-SPEC.md'), 'utf8');
  const ids = new Set([...SPECS.map((s) => s.id), 'river', 'bridge']);
  const names = {};
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^\|\s*([a-z]+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (m && ids.has(m[1])) names[m[1]] = { en: m[2], te: m[3] };
  }
  const missing = [...ids].filter((id) => !names[id]);
  if (missing.length) throw new Error(`docs/MAP-SPEC.md landmark table is missing: ${missing.join(', ')}`);
  return names;
}
