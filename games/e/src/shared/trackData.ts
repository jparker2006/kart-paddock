import { CheckpointData, ItemBoxState } from './types.js';

export interface SplinePoint {
  x: number;
  y: number;
  z: number;
  bankAngle?: number; // radians of roll/bank
}

// 30 Control points forming the 3D circuit
export const RAW_TRACK_POINTS: SplinePoint[] = [
  { x: 0, y: 0, z: 0 },         // 0: Start / Finish line
  { x: 0, y: 0, z: 30 },        // 1: Start straight
  { x: 0, y: 0, z: 65 },        // 2: Approaching Turn 1
  { x: 20, y: 1.5, z: 95 },     // 3: Turn 1 sweep
  { x: 55, y: 3.5, z: 120 },    // 4: Banked climb
  { x: 95, y: 6.0, z: 120 },    // 5: Hill crest
  { x: 125, y: 8.5, z: 95 },    // 6: High curve
  { x: 130, y: 11.0, z: 55 },   // 7: Ridge climb
  { x: 115, y: 13.0, z: 15 },   // 8: Approaching overpass
  { x: 75, y: 14.0, z: -10 },   // 9: Overpass bridge approach
  { x: 25, y: 14.0, z: -10 },   // 10: Overpass bridge entrance
  { x: 0, y: 14.0, z: -10 },    // 11: OVERPASS CREST (directly crosses above Point 28 at y=0)
  { x: -30, y: 14.0, z: -10 },  // 12: Overpass bridge exit
  { x: -75, y: 11.0, z: 15 },   // 13: Downhill curve left
  { x: -100, y: 7.5, z: 55 },   // 14: Downhill sweep
  { x: -115, y: 4.5, z: 95 },   // 15: Low bend
  { x: -140, y: 2.5, z: 120 },  // 16: Turn toward jump runway
  { x: -165, y: 1.5, z: 90 },   // 17: Straightening out
  { x: -165, y: 1.5, z: 45 },   // 18: High speed runway
  { x: -165, y: 2.5, z: 15 },   // 19: Ramp incline begins
  { x: -165, y: 6.8, z: -15 },  // 20: JUMP RAMP LIP (launches over chasm)
  { x: -165, y: 4.8, z: -55 },  // 21: Air gap (mid-air chasm)
  { x: -165, y: 2.5, z: -80 },  // 22: Landing deck with boost pads
  { x: -150, y: 1.0, z: -115 }, // 23: Landing runout curve
  { x: -115, y: 0.2, z: -130 }, // 24: Sweeping curve right
  { x: -70, y: 0, z: -115 },    // 25: Flat speed straight
  { x: -35, y: 0, z: -75 },     // 26: Approach to underpass
  { x: -15, y: 0, z: -35 },     // 27: Underpass entry
  { x: 0, y: 0, z: -10 },       // 28: UNDERPASS (directly beneath Point 11)
  { x: 0, y: 0, z: -3 },        // 29: Final straight into finish line
];

export const TRACK_WIDTH = 17.0; // 17 meters wide
export const HALF_WIDTH = TRACK_WIDTH / 2.0;

export interface TrackSample {
  index: number;
  t: number;
  x: number;
  y: number;
  z: number;
  tx: number; // Tangent X
  ty: number; // Tangent Y
  tz: number; // Tangent Z
  nx: number; // Normal X
  ny: number; // Normal Y
  nz: number; // Normal Z
  bx: number; // Binormal X (cross track)
  by: number;
  bz: number;
  distance: number;
}

// Catmull-Rom spline interpolation
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function catmullRomDerivative(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  return (
    0.5 *
    (-p0 + p2 + (4 * p0 - 10 * p1 + 8 * p2 - 2 * p3) * t + (-3 * p0 + 9 * p1 - 9 * p2 + 3 * p3) * t2)
  );
}

export class TrackCircuit {
  public samples: TrackSample[] = [];
  public checkpoints: CheckpointData[] = [];
  public totalLength: number = 0;
  public itemBoxes: ItemBoxState[] = [];
  public boostPads: { x: number; y: number; z: number; width: number; length: number; angle: number }[] = [];

  constructor() {
    this.generateSplineSamples(300);
    this.generateCheckpoints(30);
    this.initBoostPads();
    this.initItemBoxes();
  }

  private generateSplineSamples(numSamples: number) {
    const pts = RAW_TRACK_POINTS;
    const count = pts.length;
    let accumulatedDist = 0;

    for (let i = 0; i < numSamples; i++) {
      const u = (i / numSamples) * count;
      const segIndex = Math.floor(u) % count;
      const t = u - Math.floor(u);

      const p0 = pts[(segIndex - 1 + count) % count];
      const p1 = pts[segIndex];
      const p2 = pts[(segIndex + 1) % count];
      const p3 = pts[(segIndex + 2) % count];

      const x = catmullRom(p0.x, p1.x, p2.x, p3.x, t);
      const y = catmullRom(p0.y, p1.y, p2.y, p3.y, t);
      const z = catmullRom(p0.z, p1.z, p2.z, p3.z, t);

      // Tangent vector
      const dxdt = catmullRomDerivative(p0.x, p1.x, p2.x, p3.x, t);
      const dydt = catmullRomDerivative(p0.y, p1.y, p2.y, p3.y, t);
      const dzdt = catmullRomDerivative(p0.z, p1.z, p2.z, p3.z, t);
      const tLen = Math.sqrt(dxdt * dxdt + dydt * dydt + dzdt * dzdt) || 1;
      const tx = dxdt / tLen;
      const ty = dydt / tLen;
      const tz = dzdt / tLen;

      // Approximate up normal and binormal
      // Binormal = Tangent x Up (where Up is initially 0, 1, 0)
      let bx = tz;
      let by = 0;
      let bz = -tx;
      const bLen = Math.sqrt(bx * bx + bz * bz) || 1;
      bx /= bLen;
      bz /= bLen;

      // True surface normal = Binormal x Tangent
      const nx = by * tz - bz * ty;
      const ny = bz * tx - bx * tz;
      const nz = bx * ty - by * tx;

      if (i > 0) {
        const prev = this.samples[i - 1];
        const dist = Math.hypot(x - prev.x, y - prev.y, z - prev.z);
        accumulatedDist += dist;
      }

      this.samples.push({
        index: i,
        t: u / count,
        x,
        y,
        z,
        tx,
        ty,
        tz,
        nx,
        ny,
        nz,
        bx,
        by,
        bz,
        distance: accumulatedDist,
      });
    }

    // Connect loop length
    if (this.samples.length > 0) {
      const first = this.samples[0];
      const last = this.samples[this.samples.length - 1];
      accumulatedDist += Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z);
    }
    this.totalLength = accumulatedDist;
  }

  private generateCheckpoints(numCheckpoints: number) {
    const pts = RAW_TRACK_POINTS;
    const totalPts = pts.length;

    for (let i = 0; i < totalPts; i++) {
      const p = pts[i];
      const pNext = pts[(i + 1) % totalPts];
      const dx = pNext.x - p.x;
      const dy = pNext.y - p.y;
      const dz = pNext.z - p.z;
      const len = Math.hypot(dx, dy, dz) || 1;

      this.checkpoints.push({
        index: i,
        x: p.x,
        y: p.y,
        z: p.z,
        nx: dx / len,
        ny: dy / len,
        nz: dz / len,
        width: TRACK_WIDTH,
      });
    }
  }

  private initBoostPads() {
    // Boost pads placed strategically:
    // 1. Start straight
    this.boostPads.push({ x: 0, y: 0.05, z: 25, width: 7, length: 10, angle: 0 });
    // 2. High Overpass bridge center
    this.boostPads.push({ x: 0, y: 14.05, z: -10, width: 7, length: 10, angle: -Math.PI / 2 });
    // 3. Jump runway
    this.boostPads.push({ x: -165, y: 2.05, z: 25, width: 7, length: 12, angle: Math.PI });
    // 4. Jump landing deck
    this.boostPads.push({ x: -165, y: 2.55, z: -80, width: 8, length: 12, angle: Math.PI });
    // 5. Underpass entrance
    this.boostPads.push({ x: -10, y: 0.05, z: -25, width: 7, length: 10, angle: Math.PI * 0.15 });
  }

  private initItemBoxes() {
    // 3 clusters of item boxes:
    // Cluster 1: Straight after Turn 1 (near point 4)
    this.itemBoxes.push(
      { id: 1, x: 48, y: 4.8, z: 118, active: true, respawnTimer: 0 },
      { id: 2, x: 55, y: 4.8, z: 120, active: true, respawnTimer: 0 },
      { id: 3, x: 62, y: 4.8, z: 122, active: true, respawnTimer: 0 }
    );

    // Cluster 2: Overpass exit descent (near point 13)
    this.itemBoxes.push(
      { id: 4, x: -70, y: 12.2, z: 12, active: true, respawnTimer: 0 },
      { id: 5, x: -75, y: 12.2, z: 15, active: true, respawnTimer: 0 },
      { id: 6, x: -80, y: 12.2, z: 18, active: true, respawnTimer: 0 }
    );

    // Cluster 3: Before jump ramp runway (near point 18)
    this.itemBoxes.push(
      { id: 7, x: -168, y: 2.8, z: 50, active: true, respawnTimer: 0 },
      { id: 8, x: -165, y: 2.8, z: 50, active: true, respawnTimer: 0 },
      { id: 9, x: -162, y: 2.8, z: 50, active: true, respawnTimer: 0 }
    );

    // Cluster 4: Speed straightaway (near point 25)
    this.itemBoxes.push(
      { id: 10, x: -72, y: 1.2, z: -113, active: true, respawnTimer: 0 },
      { id: 11, x: -70, y: 1.2, z: -115, active: true, respawnTimer: 0 },
      { id: 12, x: -68, y: 1.2, z: -117, active: true, respawnTimer: 0 }
    );
  }

  // Find nearest track sample to a 3D position within a localized window around lastCheckpoint
  public getTrackSampleAt(x: number, y: number, z: number, nearCheckpoint: number = 0): TrackSample {
    const totalSamples = this.samples.length;
    const totalCheckpoints = this.checkpoints.length;
    
    // Estimate center sample index based on nearCheckpoint
    const centerSample = Math.floor((nearCheckpoint / totalCheckpoints) * totalSamples);
    const windowSize = Math.floor(totalSamples * 0.25); // Check within 25% window of track

    let bestSample = this.samples[centerSample];
    let bestDistSq = Infinity;

    for (let offset = -windowSize; offset <= windowSize; offset++) {
      const idx = (centerSample + offset + totalSamples) % totalSamples;
      const s = this.samples[idx];
      // Weighted 3D distance giving extra weight to vertical difference to distinguish overpass / underpass
      const dx = x - s.x;
      const dy = (y - s.y) * 2.5;
      const dz = z - s.z;
      const dsq = dx * dx + dy * dy + dz * dz;
      if (dsq < bestDistSq) {
        bestDistSq = dsq;
        bestSample = s;
      }
    }

    return bestSample;
  }

  // Query track surface elevation, road boundary, and special zones
  public querySurface(x: number, y: number, z: number, nearCheckpoint: number = 0): {
    surfaceY: number;
    lateralOffset: number;
    isOffroad: boolean;
    isOutOfBounds: boolean;
    isBoostPad: boolean;
    isJumpLip: boolean;
    isChasm: boolean;
    normal: { x: number; y: number; z: number };
    tangent: { x: number; y: number; z: number };
  } {
    const sample = this.getTrackSampleAt(x, y, z, nearCheckpoint);

    // Vector from sample center to position
    const dx = x - sample.x;
    const dy = y - sample.y;
    const dz = z - sample.z;

    // Project onto cross-track binormal (lateral offset across road)
    const lateralOffset = dx * sample.bx + dz * sample.bz;
    const absLateral = Math.abs(lateralOffset);

    // Road surface height
    const surfaceY = sample.y;

    // Check if in jump chasm (between sample 20 lip and sample 22 landing)
    // In our raw track points, Lip is point 20 at z=-15, landing at point 22 at z=-80, x approx -165
    const isChasm =
      nearCheckpoint >= 20 &&
      nearCheckpoint <= 21 &&
      z < -16 &&
      z > -72 &&
      Math.abs(x - -165) < 22;

    const isJumpLip =
      nearCheckpoint === 20 &&
      z <= -12 &&
      z >= -16 &&
      Math.abs(x - -165) <= HALF_WIDTH;

    // Check if player drove over a boost pad
    let isBoostPad = false;
    for (const pad of this.boostPads) {
      const pdx = x - pad.x;
      const pdz = z - pad.z;
      // Rotated bounding box check
      const cosA = Math.cos(-pad.angle);
      const sinA = Math.sin(-pad.angle);
      const localX = pdx * cosA - pdz * sinA;
      const localZ = pdx * sinA + pdz * cosA;
      if (
        Math.abs(localX) <= pad.width / 2 &&
        Math.abs(localZ) <= pad.length / 2 &&
        Math.abs(y - pad.y) < 2.0
      ) {
        isBoostPad = true;
        break;
      }
    }

    const isOffroad = absLateral > HALF_WIDTH && absLateral <= HALF_WIDTH + 8.0;
    const isOutOfBounds = absLateral > HALF_WIDTH + 8.0 || (isChasm && y < -5.0) || y < -12.0;

    return {
      surfaceY,
      lateralOffset,
      isOffroad,
      isOutOfBounds,
      isBoostPad,
      isJumpLip,
      isChasm,
      normal: { x: sample.nx, y: sample.ny, z: sample.nz },
      tangent: { x: sample.tx, y: sample.ty, z: sample.tz },
    };
  }

  // Get respawn point for a given checkpoint index
  public getRespawnPoint(checkpointIndex: number): {
    x: number;
    y: number;
    z: number;
    forwardAngle: number;
  } {
    const cp = this.checkpoints[checkpointIndex % this.checkpoints.length];
    const forwardAngle = Math.atan2(cp.nx, cp.nz);
    return {
      x: cp.x,
      y: cp.y + 0.8,
      z: cp.z,
      forwardAngle,
    };
  }
}

export const trackCircuit = new TrackCircuit();
