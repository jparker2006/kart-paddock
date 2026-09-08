/**
 * Track layout validator. Run with: npx tsx tools/check-track.ts
 * Reports loop length, jump gap geometry, and minimum clearances between
 * parts of the track that are far apart along the loop (crossings).
 */
import { Track, ROAD_HALF_WIDTH, CONTROL_POINTS } from '../src/client/game/track';

const t = new Track();
console.log(`loop length: ${t.length.toFixed(1)}u, samples: ${t.samples.length}`);
console.log(`gap: arc ${t.gapStartArc.toFixed(1)} .. ${t.gapEndArc.toFixed(1)} (span ${(t.gapEndArc - t.gapStartArc).toFixed(1)}u)`);
console.log(`overpass apex arc: ${t.overpassArc.toFixed(1)}`);

// crest vs landing
const crest = CONTROL_POINTS[23];
const landing = CONTROL_POINTS[25];
console.log(
  `ramp crest y=${crest[1]}, landing y=${landing[1]}, plan gap=${Math.hypot(crest[0] - landing[0], crest[2] - landing[2]).toFixed(1)}u`
);

// clearance scan: min distance between samples far apart along the loop
const n = t.samples.length;
const s = t.samples;
let worst = { d: Infinity, i: 0, j: 0 };
for (let i = 0; i < n; i += 2) {
  for (let j = i + 90; j < n; j += 2) {
    const dx = s[i].x - s[j].x;
    const dz = s[i].z - s[j].z;
    const dy = s[i].y - s[j].y;
    const d3 = Math.hypot(dx, dy, dz);
    const arcGap = Math.min(s[j].s - s[i].s, t.length - (s[j].s - s[i].s));
    if (arcGap < 40) continue; // neighbors along the loop are fine
    if (d3 < worst.d) worst = { d: d3, i, j };
  }
}
const w = worst;
const planW = Math.hypot(s[w.i].x - s[w.j].x, s[w.i].z - s[w.j].z);
const dyW = Math.abs(s[w.i].y - s[w.j].y);
console.log(
  `min 3D clearance (non-adjacent): ${w.d.toFixed(1)}u at samples ${w.i}/${w.j} ` +
    `(pos ${s[w.i].x.toFixed(0)},${s[w.i].z.toFixed(0)} y${s[w.i].y.toFixed(1)} vs ${s[w.j].x.toFixed(0)},${s[w.j].z.toFixed(0)} y${s[w.j].y.toFixed(1)})`
);
if (planW < ROAD_HALF_WIDTH * 2 && dyW < 3.2) {
  console.log('WARNING: two road sections overlap without enough vertical clearance!');
} else if (planW < ROAD_HALF_WIDTH * 2) {
  console.log(`plan overlap but vertical separation ${dyW.toFixed(1)}u -> valid bridge/underpass`);
} else {
  console.log('clearance OK (road widths fit without overlap)');
}

// overpass check: deck height above the start straight at the crossing
const apex = t.pointAtArc(t.overpassArc);
const under = t.terrainAt(apex.x, apex.z);
console.log(`overpass deck y=${apex.y.toFixed(2)} vs terrain below y=${under.toFixed(2)} (clearance ${(apex.y - under).toFixed(2)})`);

// checkpoint boundaries away from the gap?
console.log('boundaries:', t.boundaries.map((b) => b.toFixed(0)).join(', '));
console.log('respawn sample OK:', t.respawn.every((r) => Number.isFinite(r.x + r.y + r.z + r.yaw)));
