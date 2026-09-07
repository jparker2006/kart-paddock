/**
 * "Garden Loop" - the single Bumble Rally track.
 *
 * The track is a closed Catmull-Rom spline through 3D control points that is
 * resampled at ~1 m spacing.  Both the browser client (rendering + local kart
 * physics) and the Node server (checkpoints, laps, items) use this exact data,
 * so everybody agrees on where the road is.
 *
 * Track-relative positions are expressed as a fractional *sample index*
 * ("progress").  Because the layout crosses over itself (the hose bridge
 * passes above the start straight) we never do a global nearest-point search
 * during play; instead `projectToTrack` searches only a window around a hint
 * index, which keeps a kart on the bridge from "snapping" to the road below.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TrackSample {
  /** centre-line position */
  x: number;
  y: number;
  z: number;
  /** unit tangent (direction of travel) */
  tx: number;
  ty: number;
  tz: number;
  /** unit right vector in the XZ plane */
  rx: number;
  rz: number;
  /** cumulative distance from the start line (metres) */
  s: number;
  /** true when this part of the track has no floor (the jump gap) */
  gap: boolean;
  /** true when the road edges have no barrier (you can fall off) */
  open: boolean;
  /** true when a boost pad covers this sample */
  boost: boolean;
}

export interface Checkpoint {
  /** sample index */
  index: number;
  /** distance along the track */
  s: number;
}

export interface ItemBoxDef {
  id: number;
  index: number;
  lateral: number;
  x: number;
  y: number;
  z: number;
}

export interface TrackFeatureRange {
  from: number; // metres
  to: number; // metres
}

export interface TrackDef {
  name: string;
  samples: TrackSample[];
  /** total length in metres */
  length: number;
  /** half width of the drivable asphalt */
  halfWidth: number;
  /** half width including the flower-bed shoulder (slow, but still floor) */
  shoulderHalfWidth: number;
  checkpoints: Checkpoint[];
  itemBoxes: ItemBoxDef[];
  gaps: TrackFeatureRange[];
  openEdges: TrackFeatureRange[];
  boostPads: TrackFeatureRange[];
  /** index used for the start/finish line */
  finishIndex: number;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Control points, in order of travel.  y is height.  The loop is closed
 * automatically.  Units are metres.
 */
const CONTROL_POINTS: Vec3[] = [
  { x: -90, y: 0, z: 0 }, // 0  start / finish, heading +x
  { x: -20, y: 0, z: 0 }, // 1  main straight (under the bridge)
  { x: 60, y: 0, z: 0 }, // 2
  { x: 110, y: 0, z: -22 }, // 3  sweeping right-hander into the hill
  { x: 140, y: 3, z: -72 }, // 4
  { x: 122, y: 9, z: -132 }, // 5  climbing
  { x: 60, y: 15, z: -162 }, // 6  hilltop (open cliff edge)
  { x: 0, y: 19, z: -152 }, // 7
  { x: -32, y: 16, z: -104 }, // 8  descending
  { x: -26, y: 12, z: -52 }, // 9
  { x: -20, y: 10, z: 0 }, // 10 HOSE BRIDGE: crosses above the start straight
  { x: -15, y: 8, z: 50 }, // 11
  { x: 2, y: 4, z: 100 }, // 12
  { x: 42, y: 0, z: 132 }, // 13
  { x: -20, y: 0, z: 142 }, // 14 return leg
  { x: -80, y: 1, z: 132 }, // 15
  { x: -122, y: 5, z: 100 }, // 16 leaf ramp - jump take-off
  { x: -134, y: 0, z: 50 }, // 17 landing
  { x: -124, y: 0, z: 16 }, // 18 final corner into the finish straight
];

/** Distance-based feature ranges (metres along the track). Filled in below. */
const HALF_WIDTH = 7;
const SHOULDER_HALF_WIDTH = 9.5;
const SAMPLE_SPACING = 1.0;

function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y), z: f(p0.z, p1.z, p2.z, p3.z) };
}

function buildSamples(points: Vec3[]): { samples: TrackSample[]; length: number } {
  // 1. densely sample the closed spline
  const dense: Vec3[] = [];
  const n = points.length;
  const SUB = 48;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    for (let k = 0; k < SUB; k++) dense.push(catmullRom(p0, p1, p2, p3, k / SUB));
  }
  // 2. resample by arc length
  const cum: number[] = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  const total = cum[cum.length - 1];
  const count = Math.round(total / SAMPLE_SPACING);
  const pos: Vec3[] = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const target = (i / count) * total;
    while (j < cum.length - 2 && cum[j + 1] < target) j++;
    const segLen = cum[j + 1] - cum[j];
    const t = segLen > 0 ? (target - cum[j]) / segLen : 0;
    const a = dense[j % dense.length];
    const b = dense[(j + 1) % dense.length];
    pos.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
  }
  // 3. tangents / right vectors
  const samples: TrackSample[] = [];
  for (let i = 0; i < count; i++) {
    samples.push({
      x: pos[i].x,
      y: pos[i].y,
      z: pos[i].z,
      tx: 0,
      ty: 0,
      tz: 0,
      rx: 0,
      rz: 0,
      s: (i / count) * total,
      gap: false,
      open: false,
      boost: false,
    });
  }
  recomputeTangents(samples);
  return { samples, length: total };
}

function recomputeTangents(samples: TrackSample[]): void {
  const count = samples.length;
  for (let i = 0; i < count; i++) {
    const cur = samples[i];
    let prev = samples[(i - 1 + count) % count];
    let next = samples[(i + 1) % count];
    // do not average across a floor discontinuity (ramp lip / landing edge)
    if (next.gap !== cur.gap) next = cur;
    if (prev.gap !== cur.gap) prev = cur;
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    let tz = next.z - prev.z;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    // right = tangent x up  (flat in XZ)
    let rx = -tz;
    let rz = tx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    const s = samples[i];
    s.tx = tx;
    s.ty = ty;
    s.tz = tz;
    s.rx = rx;
    s.rz = rz;
  }
}

function markRange(samples: TrackSample[], range: TrackFeatureRange, key: 'gap' | 'open' | 'boost'): void {
  for (const smp of samples) {
    if (smp.s >= range.from && smp.s <= range.to) smp[key] = true;
  }
}

export function indexAtDistance(track: TrackDef, s: number): number {
  const n = track.samples.length;
  const wrapped = ((s % track.length) + track.length) % track.length;
  return Math.round((wrapped / track.length) * n) % n;
}

function buildTrack(): TrackDef {
  const { samples, length } = buildSamples(CONTROL_POINTS);

  // The features are placed by distance from the start line.  The totals were
  // read off `npm run track:info`-style logging while designing the layout;
  // they are ratios of the total so a small tweak to the layout keeps them
  // roughly in place.
  const L = length;
  const at = (ratio: number) => ratio * L;

  // Jump: a 14 m "leaf ramp" kicker rises 3 m just before control point 16,
  // then the floor is missing for 22 m.  Karts carry the ramp's upward
  // velocity into the air and land on the lower road beyond the gap.
  const jumpTakeoff = findClosestDistance(samples, CONTROL_POINTS[16]) - 4;
  const RAMP_LENGTH = 14;
  const RAMP_HEIGHT = 3;
  for (const smp of samples) {
    if (smp.s >= jumpTakeoff - RAMP_LENGTH && smp.s <= jumpTakeoff) {
      smp.y += ((smp.s - (jumpTakeoff - RAMP_LENGTH)) / RAMP_LENGTH) * RAMP_HEIGHT;
    }
  }
  const gaps: TrackFeatureRange[] = [{ from: jumpTakeoff + 0.5, to: jumpTakeoff + 22.5 }];
  for (const g of gaps) markRange(samples, g, 'gap');
  recomputeTangents(samples);
  // Hilltop cliff (control points 6..7): no barriers on either edge.
  const cliffStart = findClosestDistance(samples, CONTROL_POINTS[5]) + 25;
  const cliffEnd = findClosestDistance(samples, CONTROL_POINTS[7]) + 10;
  // The bridge itself has railings (closed) but the descent after it is open.
  const openEdges: TrackFeatureRange[] = [{ from: cliffStart, to: cliffEnd }];
  const boostPads: TrackFeatureRange[] = [
    { from: jumpTakeoff - 40, to: jumpTakeoff - 32 }, // run-up to the leaf ramp
    { from: at(0.36), to: at(0.36) + 6 }, // hill climb helper
  ];
  for (const o of openEdges) markRange(samples, o, 'open');
  for (const b of boostPads) markRange(samples, b, 'boost');

  const track: TrackDef = {
    name: 'Garden Loop',
    samples,
    length,
    halfWidth: HALF_WIDTH,
    shoulderHalfWidth: SHOULDER_HALF_WIDTH,
    checkpoints: [],
    itemBoxes: [],
    gaps,
    openEdges,
    boostPads,
    finishIndex: 0,
  };

  // Checkpoints: the finish line is checkpoint 0; the rest are evenly spread
  // (a lap only counts when every one is crossed in order).
  const CHECKPOINT_COUNT = 10;
  for (let i = 0; i < CHECKPOINT_COUNT; i++) {
    let s = (i / CHECKPOINT_COUNT) * L;
    // never put a checkpoint where there is no floor (or on the ramp lip)
    for (const g of gaps) {
      if (s >= g.from - 16 && s <= g.to + 4) s = g.to + 6;
    }
    track.checkpoints.push({ index: indexAtDistance(track, s), s });
  }

  // Item boxes: rows of three across the road at a few spots.
  const boxRows = [at(0.12), at(0.3), at(0.55), at(0.72)];
  let id = 0;
  for (const s of boxRows) {
    const idx = indexAtDistance(track, s);
    const smp = samples[idx];
    for (const lat of [-4, 0, 4]) {
      track.itemBoxes.push({
        id: id++,
        index: idx,
        lateral: lat,
        x: smp.x + smp.rx * lat,
        y: smp.y + 1.2,
        z: smp.z + smp.rz * lat,
      });
    }
  }
  return track;
}

function findClosestDistance(samples: TrackSample[], p: Vec3): number {
  let best = Infinity;
  let bestS = 0;
  for (const s of samples) {
    const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2 + (s.z - p.z) ** 2;
    if (d < best) {
      best = d;
      bestS = s.s;
    }
  }
  return bestS;
}

export const TRACK: TrackDef = buildTrack();

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface TrackProjection {
  /** integer sample index of the segment start */
  index: number;
  /** fractional progress (index + t) in [0, n) */
  progress: number;
  /** signed lateral offset from the centre line (+ = right of travel) */
  lateral: number;
  /** height of the road surface here */
  groundY: number;
  /** horizontal distance from the centre line */
  distance: number;
  /** interpolated unit tangent */
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  rz: number;
  gap: boolean;
  open: boolean;
  boost: boolean;
}

export function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/**
 * Finds the closest point on the centre line to `p`, searching only samples
 * within `window` of `hint`.  Pass `hint = -1` (or a huge window) for a global
 * search - only do that at spawn time, never while racing, or a kart on the
 * bridge may be matched to the road beneath it.
 */
export function projectToTrack(track: TrackDef, p: Vec3, hint: number, window: number): TrackProjection {
  const S = track.samples;
  const n = S.length;
  const global = hint < 0 || window >= n / 2;
  const start = global ? 0 : Math.floor(hint) - window;
  const end = global ? n - 1 : Math.floor(hint) + window;
  let bestD = Infinity;
  let bestI = 0;
  let bestT = 0;
  for (let k = start; k <= end; k++) {
    const i = wrapIndex(k, n);
    const a = S[i];
    const b = S[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1e-6;
    let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = a.x + dx * t;
    const cz = a.z + dz * t;
    // include a small vertical term so overlapping levels are disambiguated
    // even inside a wide window
    const cy = a.y + (b.y - a.y) * t;
    const d = (p.x - cx) ** 2 + (p.z - cz) ** 2 + 0.15 * (p.y - cy) ** 2;
    if (d < bestD) {
      bestD = d;
      bestI = i;
      bestT = t;
    }
  }
  const a = S[bestI];
  const b = S[(bestI + 1) % n];
  const cx = a.x + (b.x - a.x) * bestT;
  const cz = a.z + (b.z - a.z) * bestT;
  const groundY = a.y + (b.y - a.y) * bestT;
  const rx = a.rx + (b.rx - a.rx) * bestT;
  const rz = a.rz + (b.rz - a.rz) * bestT;
  const lateral = (p.x - cx) * rx + (p.z - cz) * rz;
  const distance = Math.hypot(p.x - cx, p.z - cz);
  let tx = a.tx + (b.tx - a.tx) * bestT;
  let ty = a.ty + (b.ty - a.ty) * bestT;
  let tz = a.tz + (b.tz - a.tz) * bestT;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl;
  ty /= tl;
  tz /= tl;
  const feat = bestT < 0.5 ? a : b;
  return {
    index: bestI,
    progress: bestI + bestT,
    lateral,
    groundY,
    distance,
    tx,
    ty,
    tz,
    rx,
    rz,
    gap: feat.gap,
    open: feat.open,
    boost: feat.boost,
  };
}

/** World position for a track index + lateral offset (+ optional height). */
export function trackPoint(track: TrackDef, index: number, lateral = 0, up = 0): Vec3 {
  const s = track.samples[wrapIndex(Math.round(index), track.samples.length)];
  return { x: s.x + s.rx * lateral, y: s.y + up, z: s.z + s.rz * lateral };
}

/** Heading (yaw, radians, three.js convention: 0 = -Z, positive turns left) at an index. */
export function trackYaw(track: TrackDef, index: number): number {
  const s = track.samples[wrapIndex(Math.round(index), track.samples.length)];
  return Math.atan2(-s.tx, -s.tz);
}

/** Signed forward distance (in samples) from `from` to `to`, wrapped to (-n/2, n/2]. */
export function progressDelta(n: number, from: number, to: number): number {
  let d = to - from;
  const half = n / 2;
  while (d > half) d -= n;
  while (d <= -half) d += n;
  return d;
}

/**
 * Grid slot for racer `slot` (0-based) behind the start line: two abreast,
 * staggered backwards.
 */
export function startGridSlot(track: TrackDef, slot: number): { pos: Vec3; yaw: number; index: number } {
  const row = Math.floor(slot / 2);
  const side = slot % 2 === 0 ? -1 : 1;
  const back = 6 + row * 5;
  const idx = wrapIndex(track.finishIndex - back, track.samples.length);
  const pos = trackPoint(track, idx, side * 3.2, 0);
  return { pos, yaw: trackYaw(track, idx), index: idx };
}
