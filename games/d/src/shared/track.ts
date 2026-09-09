// Shared track definition for Cinder Peak Rally.
// Pure math (no Three.js) so both the browser client and the Node server
// use the exact same centerline, checkpoints, jump, and overpass geometry.
//
// Track: "Cinder Peak Circuit" — a volcanic-island loop with:
//  - elevation changes (climb to an obsidian bridge, descent back to the beach)
//  - a lava-gap jump on the back straight (segment C13 -> C14)
//  - an overpass: the bridge deck (near t~0.32) crosses ~6.8m above the
//    low road (near t~0.68) at approximately XZ (-5, -33).

export interface ControlPoint {
  x: number;
  y: number;
  z: number;
}

// [x, elevationY, z]
const CONTROL: ControlPoint[] = [
  { x: 0, y: 0, z: 62 },
  { x: 52, y: 0, z: 58 },
  { x: 86, y: 0, z: 28 },
  { x: 78, y: 1, z: -2 },
  { x: 44, y: 3, z: -20 },
  { x: 2, y: 6.5, z: -32 },
  { x: -38, y: 7, z: -38 },
  { x: -72, y: 3.5, z: -28 },
  { x: -88, y: 0, z: 2 },
  { x: -66, y: 0, z: 30 },
  { x: -30, y: 0, z: 34 },
  { x: -12, y: 0, z: 2 },
  { x: -4, y: 0, z: -34 },
  { x: 26, y: 0.5, z: -58 },
  { x: 64, y: 1.5, z: -52 },
  { x: 80, y: 1, z: -14 },
  { x: 52, y: 0, z: 34 },
];

export const NUM_CONTROL = CONTROL.length;
export const NUM_SAMPLES = 1400;
export const TRACK_HALF_WIDTH = 6.5;
export const NUM_CHECKPOINTS = 16;
export const TOTAL_LAPS = 3;
export const FINISH_TIMEOUT_MS = 35000;

export interface TrackSample {
  x: number;
  y: number;
  z: number;
  /** unit tangent in XZ */
  dx: number;
  dz: number;
  /** yaw of tangent (radians, three.js convention: 0 faces -Z? we use atan2(dx,dz)) */
  yaw: number;
}

function catmull(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  );
}

function pointOnCurve(seg: number, u: number): { x: number; y: number; z: number } {
  const m = NUM_CONTROL;
  const p0 = CONTROL[(seg - 1 + m) % m];
  const p1 = CONTROL[seg % m];
  const p2 = CONTROL[(seg + 1) % m];
  const p3 = CONTROL[(seg + 2) % m];
  return {
    x: catmull(p0.x, p1.x, p2.x, p3.x, u),
    y: catmull(p0.y, p1.y, p2.y, p3.y, u),
    z: catmull(p0.z, p1.z, p2.z, p3.z, u),
  };
}

export const SAMPLES: TrackSample[] = (() => {
  const pts: { x: number; y: number; z: number }[] = [];
  const per = NUM_SAMPLES / NUM_CONTROL;
  for (let s = 0; s < NUM_CONTROL; s++) {
    for (let k = 0; k < per; k++) {
      pts.push(pointOnCurve(s, k / per));
    }
  }
  const out: TrackSample[] = [];
  for (let i = 0; i < NUM_SAMPLES; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % NUM_SAMPLES];
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    out.push({ x: a.x, y: a.y, z: a.z, dx, dz, yaw: Math.atan2(dx, dz) });
  }
  return out;
})();

export const TRACK_LENGTH: number = (() => {
  let len = 0;
  for (let i = 0; i < NUM_SAMPLES; i++) {
    const a = SAMPLES[i];
    const b = SAMPLES[(i + 1) % NUM_SAMPLES];
    len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return len;
})();

export function wrapT(t: number): number {
  t = t % 1;
  return t < 0 ? t + 1 : t;
}

export function sampleAt(t: number): TrackSample {
  const idx = Math.floor(wrapT(t) * NUM_SAMPLES) % NUM_SAMPLES;
  return SAMPLES[idx];
}

/** Fraction t of checkpoint k (k in 0..NUM_CHECKPOINTS-1). Checkpoint 0 is the start/finish line. */
export function checkpointT(k: number): number {
  return wrapT(k / NUM_CHECKPOINTS);
}

export interface QueryResult {
  t: number;
  cx: number;
  cy: number;
  cz: number;
  dx: number;
  dz: number;
  yaw: number;
  lateral: number;
  dist: number;
  onTrack: boolean;
}

function evaluateIndex(x: number, z: number, i: number): QueryResult {
  const s = SAMPLES[i];
  const ox = x - s.x;
  const oz = z - s.z;
  // left normal of tangent (dx,dz) is (dz, -dx)? choose lateral sign: + = right of travel
  const rx = -s.dz;
  const rz = s.dx;
  const lateral = ox * rx + oz * rz;
  const dist = Math.hypot(ox, oz);
  return {
    t: i / NUM_SAMPLES,
    cx: s.x,
    cy: s.y,
    cz: s.z,
    dx: s.dx,
    dz: s.dz,
    yaw: s.yaw,
    lateral,
    dist,
    onTrack: Math.abs(lateral) <= TRACK_HALF_WIDTH,
  };
}

/** Local query around a hint (keeps bridge vs underpass levels distinct). */
export function queryNear(x: number, z: number, hintT: number, windowT = 0.035): QueryResult {
  const center = Math.floor(wrapT(hintT) * NUM_SAMPLES);
  const w = Math.max(4, Math.floor(windowT * NUM_SAMPLES));
  let best: QueryResult | null = null;
  for (let o = -w; o <= w; o++) {
    const i = (center + o + NUM_SAMPLES) % NUM_SAMPLES;
    const q = evaluateIndex(x, z, i);
    if (!best || q.dist < best.dist) best = q;
  }
  return best!;
}

/** Global nearest sample (level-agnostic). */
export function queryGlobal(x: number, z: number): QueryResult {
  let best: QueryResult | null = null;
  for (let i = 0; i < NUM_SAMPLES; i += 2) {
    const q = evaluateIndex(x, z, i);
    if (!best || q.dist < best.dist) best = q;
  }
  // refine around best
  let bi = Math.round(best!.t * NUM_SAMPLES);
  for (let o = -2; o <= 2; o++) {
    const i = (bi + o + NUM_SAMPLES) % NUM_SAMPLES;
    const q = evaluateIndex(x, z, i);
    if (q.dist < best!.dist) best = q;
  }
  return best!;
}

/**
 * Find the highest track surface at (x,z) that is at or below maxY.
 * Used when falling (e.g. off the bridge) to land on a lower level.
 */
export function queryBelow(x: number, z: number, maxY: number): QueryResult | null {
  let best: QueryResult | null = null;
  for (let i = 0; i < NUM_SAMPLES; i += 4) {
    const q = evaluateIndex(x, z, i);
    if (!q.onTrack) continue;
    const s = SAMPLES[i];
    if (s.y > maxY) continue;
    if (!best || s.y > SAMPLES[Math.round(best.t * NUM_SAMPLES) % NUM_SAMPLES].y) best = q;
  }
  return best;
}

// ---- Jump (lava gap on segment C13 -> C14) ----
const SEG = 13;
export const JUMP = {
  rampT0: (SEG + 0.22) / NUM_CONTROL,
  rampT1: (SEG + 0.45) / NUM_CONTROL,
  gapT0: (SEG + 0.45) / NUM_CONTROL,
  gapT1: (SEG + 0.62) / NUM_CONTROL,
  landT: (SEG + 0.66) / NUM_CONTROL,
};

export function isInGap(t: number): boolean {
  const w = wrapT(t);
  return w >= JUMP.gapT0 && w <= JUMP.gapT1;
}

export function isOnRamp(t: number): boolean {
  const w = wrapT(t);
  return w >= JUMP.rampT0 && w <= JUMP.gapT0;
}

// ---- Island ground (drivable off-track surface) ----
/** Elliptical island; outside this is lava (fall/respawn). The lava pool under the jump gap is carved out. */
export function islandGroundY(x: number, z: number): number | null {
  const nx = x / 108;
  const nz = z / 82;
  if (nx * nx + nz * nz > 1) return null; // lava sea
  // lava pool under the jump gap
  const gap = sampleAt((JUMP.gapT0 + JUMP.gapT1) / 2);
  const dg = Math.hypot(x - gap.x, z - gap.z);
  if (dg < 9) return null;
  // volcano cone in the middle raises terrain slightly (still drivable, bumpy)
  const dc = Math.hypot(x - -30, z - -5);
  let y = -0.6;
  if (dc < 34) y += (1 - dc / 34) * 2.2;
  return y;
}

export const KILL_Y = -2.6;

// ---- Start grid ----
export interface GridSlot {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Grid slots sit just behind the start/finish line (t slightly less than 1). */
export function gridSlot(i: number): GridSlot {
  const row = Math.floor(i / 2);
  const side = i % 2 === 0 ? -1 : 1;
  const t = wrapT(1 - 0.0035 - row * 0.0032);
  const s = sampleAt(t);
  const rx = -s.dz;
  const rz = s.dx;
  const lat = side * 3.1;
  return {
    x: s.x + rx * lat,
    y: s.y + 0.4,
    z: s.z + rz * lat,
    yaw: s.yaw,
  };
}

// ---- Item boxes ----
export interface ItemBoxDef {
  id: number;
  t: number;
  lateral: number;
}

const ITEM_T = [0.06, 0.14, 0.22, 0.32, 0.42, 0.52, 0.6, 0.7, 0.86, 0.94];

export const ITEM_BOXES: ItemBoxDef[] = ITEM_T.map((t, i) => ({
  id: i,
  t,
  lateral: i % 2 === 0 ? -2.6 : 2.6,
}));

export function itemBoxPos(def: ItemBoxDef): { x: number; y: number; z: number } {
  const s = sampleAt(def.t);
  const rx = -s.dz;
  const rz = s.dx;
  return { x: s.x + rx * def.lateral, y: s.y + 1.1, z: s.z + rz * def.lateral };
}

// ---- Kart colors for up to 8 players ----
export const KART_COLORS = [
  "#e63b2e", // ember red
  "#2e7de6", // lagoon blue
  "#2ee66b", // palm green
  "#e6c52e", // sun gold
  "#9b2ee6", // orchid purple
  "#e67e2e", // magma orange
  "#2ee6d8", // tide teal
  "#e62e9b", // flamingo pink
];
