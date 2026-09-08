import * as THREE from 'three';
import { valueNoise } from './noise';

/**
 * Cider Creek Raceway — one original closed circuit built from a Catmull-Rom
 * spline with elevation, a wooden-ramp jump over Cider Creek, and a windmill
 * overpass that crosses above the start straight.
 *
 * Everything physical (ground height, surfaces, progress) derives from the
 * spline samples, so the karts, the terrain and the checkpoints all agree.
 */

export interface TrackSample {
  x: number;
  y: number;
  z: number;
  /** unit tangent in XZ */
  tx: number;
  tz: number;
  /** arc length from the start line */
  s: number;
  road: boolean;
}

export interface GroundInfo {
  h: number;
  surface: 'road' | 'grass' | 'water';
  /** signed lateral distance from the road centerline (when near road) */
  lateral: number;
}

export interface ProgressInfo {
  /** 0..1 around the loop */
  p: number;
  lateral: number;
  index: number;
}

export const ROAD_HALF_WIDTH = 4.6;
export const CP_COUNT = 12;

/** Control points of the loop: [x, y, z]. Start line sits at point 0. */
const CONTROL_POINTS: [number, number, number][] = [
  [-30, 0, 0], // finish line, start straight heading east
  [25, 0, 0],
  [70, 0.3, 4],
  [98, 1.2, -34], // T1 sweeps north
  [90, 2.4, -88],
  [46, 4.5, -126], // T2
  [-24, 6.5, -136], // north straight (highest point)
  [-80, 8, -110], // T3
  [-116, 7, -60],
  [-128, 5.6, -6], // west side descending
  [-112, 5.2, 28],
  [-84, 5.8, 42], // overpass approach climbs
  [-50, 6.8, 26],
  [-18, 7.3, 0], // WINDMILL OVERPASS above the start straight
  [26, 6.4, 14],
  [62, 5, 30], // descending east
  [94, 3.6, 52],
  [112, 3, 80], // SE curve
  [104, 2.8, 104],
  [72, 3.2, 112],
  [42, 3.4, 108], // ramp approach
  [24, 4.6, 106], // ramp climb
  [12, 5.8, 104],
  [5, 6.6, 102.6], // ramp crest — jump over Cider Creek
  // -- the gap: spline continues in the air, no road --
  [-8, 4.4, 100.6],
  [-18, 1.9, 100], // splashdown line
  // -- road resumes --
  [-42, 1.1, 98],
  [-70, 0.7, 92],
  [-96, 0.5, 66], // final corner
  [-102, 0.3, 34],
  [-92, 0.1, 6],
  [-72, 0, -6],
];

const GAP_START_CP = 23; // index of the crest control point
const GAP_END_CP = 25; // index of the landing control point

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

export class Track {
  samples: TrackSample[] = [];
  length = 0;
  gapStartArc = 0;
  gapEndArc = 0;
  overpassArc = 0;
  rampStartArc = 0;
  /** sample begins / ends a contiguous road run (edges of the jump gap) */
  runStart: boolean[] = [];
  runEnd: boolean[] = [];
  /** arc-length positions of the checkpoint boundaries */
  boundaries: number[] = [];
  respawn: { x: number; y: number; z: number; yaw: number }[] = [];

  // spatial acceleration for nearest-sample queries
  private coarseX: Float32Array;
  private coarseZ: Float32Array;
  private coarseStride = 6;
  private coarseIdx: Int32Array;
  /** 2D bucket grid: cell key -> sample indices (handles overlapping decks) */
  private grid = new Map<number, number[]>();
  private readonly gridCell = 16;

  constructor() {
    this.buildSamples();
    const n = this.samples.length;
    const stride = this.coarseStride;
    this.coarseIdx = new Int32Array(Math.ceil(n / stride));
    this.coarseX = new Float32Array(this.coarseIdx.length);
    this.coarseZ = new Float32Array(this.coarseIdx.length);
    for (let i = 0, j = 0; i < n; i += stride, j++) {
      this.coarseIdx[j] = i;
      this.coarseX[j] = this.samples[i].x;
      this.coarseZ[j] = this.samples[i].z;
    }
    this.buildGrid();
    this.locateFeatures();
  }

  private buildGrid(): void {
    for (let i = 0; i < this.samples.length; i++) {
      const gx = Math.floor(this.samples[i].x / this.gridCell) + 2048;
      const gz = Math.floor(this.samples[i].z / this.gridCell) + 2048;
      const key = gx * 4096 + gz;
      let arr = this.grid.get(key);
      if (!arr) {
        arr = [];
        this.grid.set(key, arr);
      }
      arr.push(i);
    }
  }

  private buildSamples(): void {
    const cp = CONTROL_POINTS;
    const n = cp.length;
    // dense sampling of the closed Catmull-Rom spline
    const raw: [number, number, number][] = [];
    const perSeg = 60;
    for (let i = 0; i < n; i++) {
      const p0 = cp[(i - 1 + n) % n];
      const p1 = cp[i];
      const p2 = cp[(i + 1) % n];
      const p3 = cp[(i + 2) % n];
      for (let j = 0; j < perSeg; j++) {
        const t = j / perSeg;
        raw.push([
          catmull(p0[0], p1[0], p2[0], p3[0], t),
          catmull(p0[1], p1[1], p2[1], p3[1], t),
          catmull(p0[2], p1[2], p2[2], p3[2], t),
        ]);
      }
    }
    // resample uniformly by arc length (~0.7u apart)
    let total = 0;
    const segLens: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      const a = raw[i];
      const b = raw[(i + 1) % raw.length];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      segLens.push(l);
      total += l;
    }
    this.length = total;
    const step = total / Math.round(total / 0.7);
    let idx = 0;
    let carried = 0;
    const pts: [number, number, number][] = [];
    const count = Math.round(total / step);
    for (let k = 0; k < count; k++) {
      const target = k * step;
      while (carried + segLens[idx] < target) {
        carried += segLens[idx];
        idx = (idx + 1) % raw.length;
      }
      const t = (target - carried) / Math.max(segLens[idx], 1e-6);
      const a = raw[idx];
      const b = raw[(idx + 1) % raw.length];
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
    // arc positions + tangents
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const next = pts[(i + 1) % pts.length];
      let dx = next[0] - prev[0];
      let dz = next[2] - prev[2];
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl;
      dz /= dl;
      this.samples.push({ x: pts[i][0], y: pts[i][1], z: pts[i][2], tx: dx, tz: dz, s: i * step, road: true });
    }
    // mark the jump gap: road is absent strictly between the crest control
    // point and the landing control point (located by position, so the road
    // ends exactly where the mesh ends)
    const crest = CONTROL_POINTS[GAP_START_CP];
    const landing = CONTROL_POINTS[GAP_END_CP];
    const nearCp = (p: [number, number, number]): number => {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < this.samples.length; i++) {
        const sm = this.samples[i];
        const d = (sm.x - p[0]) ** 2 + (sm.z - p[2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };
    const crestIdx = nearCp(crest);
    const landingIdx = nearCp(landing);
    this.gapStartArc = this.samples[crestIdx].s;
    this.gapEndArc = this.samples[landingIdx].s;
    for (let i = crestIdx; ; i = (i + 1) % this.samples.length) {
      if (i !== crestIdx && i !== landingIdx) this.samples[i].road = false;
      if (i === landingIdx) break;
    }
    // road run edges
    const N = this.samples.length;
    this.runStart = new Array(N).fill(false);
    this.runEnd = new Array(N).fill(false);
    for (let i = 0; i < N; i++) {
      const sm = this.samples[i];
      const prev = this.samples[(i - 1 + N) % N];
      const next = this.samples[(i + 1) % N];
      if (sm.road && !prev.road) this.runStart[i] = true;
      if (sm.road && !next.road) this.runEnd[i] = true;
    }
  }

  private locateFeatures(): void {
    // checkpoint boundaries: 12 evenly spaced, nudged away from the gap
    const L = this.length;
    const gapPad = 10;
    const bad = (arc: number) =>
      this.nearRange(arc, this.gapStartArc - gapPad, this.gapEndArc + gapPad) ||
      this.nearRange(arc, this.overpassArc - 8, this.overpassArc + 8);
    // feature arcs are located by position (control points are not evenly
    // spaced along the arc)
    this.overpassArc = this.samples[this.nearestSampleToIndex(13)].s;
    this.rampStartArc = this.samples[this.nearestSampleToIndex(21)].s;
    let offset = 0;
    outer: for (let o = 0; o < 48; o++) {
      const cand = (o * L) / 48;
      let ok = true;
      for (let i = 0; i < CP_COUNT; i++) {
        if (bad((i * L) / CP_COUNT + cand)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        offset = cand;
        break outer;
      }
    }
    for (let i = 0; i < CP_COUNT; i++) {
      const arc = ((i * L) / CP_COUNT + offset) % L;
      this.boundaries.push(arc);
      const idx = this.indexOfArc(arc);
      const sm = this.samples[idx];
      this.respawn.push({
        x: sm.x,
        y: sm.y,
        z: sm.z,
        yaw: Math.atan2(sm.tx, sm.tz),
      });
    }
  }

  private nearRange(v: number, a: number, b: number): boolean {
    const L = this.length;
    const dist = (p: number, q: number) => Math.min(Math.abs(p - q), L - Math.abs(p - q));
    // distance from point v to the arc interval [a,b]
    if (dist(v, a) < 0.5 || dist(v, b) < 0.5) return true;
    // is v between a and b going forward?
    const dv = (v - a + L) % L;
    const db = (b - a + L) % L;
    return dv > 0 && dv < db;
  }

  /** Sample index nearest to control point `cpIndex`. */
  nearestSampleToIndex(cpIndex: number): number {
    const p = CONTROL_POINTS[cpIndex];
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.samples.length; i++) {
      const sm = this.samples[i];
      const d = (sm.x - p[0]) ** 2 + (sm.z - p[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  indexOfArc(arc: number): number {
    const i = Math.round((arc / this.length) * this.samples.length);
    return ((i % this.samples.length) + this.samples.length) % this.samples.length;
  }

  sampleAtArc(arc: number): TrackSample {
    return this.samples[this.indexOfArc(arc)];
  }

  /** Interpolated point on the centerline at arc position. */
  pointAtArc(arc: number): { x: number; y: number; z: number; tx: number; tz: number } {
    const L = this.length;
    let a = arc % L;
    if (a < 0) a += L;
    const f = (a / L) * this.samples.length;
    const i0 = Math.floor(f) % this.samples.length;
    const i1 = (i0 + 1) % this.samples.length;
    const t = f - Math.floor(f);
    const A = this.samples[i0];
    const B = this.samples[i1];
    return {
      x: A.x + (B.x - A.x) * t,
      y: A.y + (B.y - A.y) * t,
      z: A.z + (B.z - A.z) * t,
      tx: A.tx,
      tz: A.tz,
    };
  }

  // ------------------------------------------------------------------
  // Ground queries
  // ------------------------------------------------------------------

  /**
   * Candidate road samples near (x,z) via a 2D bucket grid. Both stacked
   * decks (the overpass above the start straight) register in the same cells,
   * so overlapping road sections are always found together. Falls back to a
   * full coarse scan far from any road.
   */
  private nearestSamples(x: number, z: number): number[] {
    const gx = Math.floor(x / this.gridCell) + 2048;
    const gz = Math.floor(z / this.gridCell) + 2048;
    const out = new Set<number>();
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const arr = this.grid.get((gx + i) * 4096 + (gz + j));
        if (arr) for (const s of arr) out.add(s);
      }
    }
    if (out.size > 0) return [...out];
    // far from any road: coarse scan fallback (progress/lateral reports only)
    const stride = this.coarseStride;
    let bestD2 = Infinity;
    let bestJ = 0;
    for (let j = 0; j < this.coarseIdx.length; j++) {
      const dx = this.coarseX[j] - x;
      const dz = this.coarseZ[j] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestJ = j;
      }
    }
    const center = this.coarseIdx[bestJ];
    const n = this.samples.length;
    for (let k = -stride * 4; k <= stride * 4; k += 2) {
      out.add(((center + k) % n + n) % n);
    }
    return [...out];
  }

  /**
   * Ground height + surface under (x,z), given the querier's current height.
   * Surfaces above the querier (like the overpass deck when driving under it)
   * are ignored, so both track levels behave correctly.
   */
  groundAt(x: number, z: number, yRef: number): GroundInfo {
    const idxs = this.nearestSamples(x, z);
    // surfaces above the querier's reach (the overpass deck when driving
    // under it) are ignored per-candidate, then the highest remaining wins
    const terrace = yRef + 1.35;
    let bestLateral = Infinity;
    let bestRoad = false;
    let roadH = -Infinity;
    let roadLateral = Infinity;
    for (const i of idxs) {
      const sm = this.samples[i];
      if (!sm.road) continue;
      if (sm.y > terrace) continue;
      const dx = x - sm.x;
      const dz = z - sm.z;
      const along = dx * sm.tx + dz * sm.tz;
      const lat = Math.abs(dx * sm.tz - dz * sm.tx);
      if (lat < bestLateral) {
        bestLateral = lat;
        bestRoad = true;
      }
      // the ground a sample supports is only its own 0.7u span; this keeps
      // karts airborne past the ramp crest instead of "landing" on the line
      // through the crest sample
      if (Math.abs(along) > 0.9) continue;
      if (this.runEnd[i] && along > 0.5) continue;
      if (this.runStart[i] && along < -0.5) continue;
      if (lat <= ROAD_HALF_WIDTH + 0.6) {
        if (sm.y > roadH) {
          roadH = sm.y;
          roadLateral = lat;
        }
      }
    }
    if (bestRoad && roadH > -Infinity) {
      return { h: roadH, surface: 'road', lateral: roadLateral };
    }
    const terr = this.terrainAt(x, z);
    const water = this.inCreek(x, z) > 0.5 && terr < -2.6;
    return { h: terr, surface: water ? 'water' : 'grass', lateral: bestRoad ? bestLateral : Infinity };
  }

  /**
   * Continuous progress around the loop for (x,z) at the querier's height.
   * Candidates far above or below the querier (the other deck at the
   * overpass) are ignored. Null when far off-road.
   */
  progressAt(x: number, z: number, yRef: number): ProgressInfo | null {
    const idxs = this.nearestSamples(x, z);
    let bestD2 = Infinity;
    let bestIdx = -1;
    let bestLat = Infinity;
    for (const i of idxs) {
      const sm = this.samples[i];
      if (!sm.road) continue;
      if (Math.abs(sm.y - yRef) > 3.5) continue;
      const dx = x - sm.x;
      const dz = z - sm.z;
      const lat = Math.abs(dx * sm.tz - dz * sm.tx);
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = i;
        bestLat = lat;
      }
    }
    if (bestIdx < 0 || bestLat > 14) return null;
    return { p: this.samples[bestIdx].s / this.length, lateral: bestLat, index: bestIdx };
  }

  // ------------------------------------------------------------------
  // Terrain (matches the rendered terrain mesh exactly)
  // ------------------------------------------------------------------

  inCreek(x: number, z: number): number {
    // creek runs north-south under the jump gap, x in [-13, 0]
    const dx = x + 6.5;
    const bandX = 1 - smoothClamp(Math.abs(dx) - 6.5, 0, 3); // 1 inside, 0 outside
    const bandZ = 1 - smoothClamp(Math.abs(z - 106) - 26, 0, 5);
    return Math.min(bandX, bandZ);
  }

  terrainAt(x: number, z: number): number {
    let h =
      valueNoise(x * 0.018, z * 0.018) * 2.1 +
      valueNoise(x * 0.05 + 7.3, z * 0.05 - 3.1) * 0.8 +
      valueNoise(x * 0.011 - 11.7, z * 0.011 + 5.5) * 1.6;
    h -= 2.4; // gentle valley floor
    // road shoulders blend the terrain into the road surface. The support
    // surface is the LOWEST road sample close in plan: embankments rise to
    // meet their road, while anything passing over another drivable road
    // (the overpass) stays clear because the lower deck wins the min().
    // The support radius matches the blend falloff so a lower deck nearby
    // always beats a higher one further away.
    const idxs = this.nearestSamples(x, z);
    let supportY = Infinity;
    let supportLat = Infinity;
    for (const i of idxs) {
      const sm = this.samples[i];
      if (!sm.road) continue;
      const dx = x - sm.x;
      const dz = z - sm.z;
      const along = dx * sm.tx + dz * sm.tz;
      if (Math.abs(along) > 1.6) continue;
      const lat = Math.abs(dx * sm.tz - dz * sm.tx);
      if (lat <= ROAD_HALF_WIDTH + 11 && sm.y < supportY) {
        supportY = sm.y;
        supportLat = lat;
      }
    }
    if (supportY < Infinity) {
      const t = 1 - smoothClamp(supportLat - ROAD_HALF_WIDTH - 1.0, 0, 10);
      if (t > 0) {
        const target = supportY - 0.12;
        h = h + (target - h) * t;
      }
    }
    // carve Cider Creek
    const creek = this.inCreek(x, z);
    if (creek > 0) {
      h = h + (-5.2 - h) * creek;
    }
    return h;
  }
}

function smoothClamp(v: number, a: number, b: number): number {
  const t = Math.min(Math.max((v - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}


// ------------------------------------------------------------------
// Scene builders
// ------------------------------------------------------------------

function roadTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b0763c';
  g.fillRect(0, 0, 256, 256);
  // dirt speckle
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = Math.random() * 2.2;
    g.fillStyle = Math.random() < 0.5 ? 'rgba(120,74,32,0.35)' : 'rgba(220,170,105,0.3)';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // darker edge bands
  g.fillStyle = 'rgba(96,58,24,0.85)';
  g.fillRect(0, 0, 22, 256);
  g.fillRect(234, 0, 22, 256);
  // cream edge dashes
  g.fillStyle = '#f5e3bd';
  for (let y = 0; y < 256; y += 42) {
    g.fillRect(10, y, 8, 22);
    g.fillRect(238, y, 8, 22);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildRoadMesh(track: Track): THREE.Group {
  const group = new THREE.Group();
  const tex = roadTexture();
  const halfW = ROAD_HALF_WIDTH;
  const n = track.samples.length;
  // build one ribbon per contiguous run of road samples
  const runs: number[][] = [];
  let run: number[] = [];
  for (let i = 0; i < n; i++) {
    if (track.samples[i].road) {
      run.push(i);
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) {
    // close the loop run (wraps to 0) if the first samples are also road
    if (runs.length && track.samples[0].road && runs[0][0] === 0) {
      run.push(...runs[0]);
      runs.shift();
    }
    runs.push(run);
  }
  for (const indices of runs) {
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const cA = new THREE.Color(0xffffff);
    const cB = new THREE.Color(0x9a9a92);
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      const sm = track.samples[i];
      const px = -sm.tz;
      const pz = sm.tx;
      const lift = 0.07;
      pos.push(sm.x - px * halfW, sm.y + lift, sm.z - pz * halfW);
      pos.push(sm.x + px * halfW, sm.y + lift, sm.z + pz * halfW);
      const v = sm.s / 7;
      uv.push(0, v, 1, v);
      const shade = cA.clone().lerp(cB, (Math.sin(sm.s * 0.05) + 1) / 2 * 0.35);
      col.push(shade.r, shade.g, shade.b, shade.r, shade.g, shade.b);
    }
    for (let k = 0; k < indices.length - 1; k++) {
      const a = k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    group.add(mesh);
  }
  return group;
}

export function buildStartLine(track: Track): THREE.Mesh {
  const sm = track.samples[0];
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  const sq = 16;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? '#2b2320' : '#f5ead2';
      g.fillRect(x * sq, y * sq, sq, sq);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, 2.6);
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = Math.atan2(sm.tx, sm.tz);
  mesh.position.set(sm.x, sm.y + 0.09, sm.z);
  mesh.renderOrder = 2;
  return mesh;
}

export { CONTROL_POINTS };
