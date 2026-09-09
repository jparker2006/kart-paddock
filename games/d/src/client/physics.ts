// Arcade kart physics (client-side, per-kart). Uses the shared track math so
// height lookups stay level-aware (bridge vs underpass) via a progress hint.
import {
  KILL_Y,
  TRACK_HALF_WIDTH,
  isInGap,
  isOnRamp,
  islandGroundY,
  queryBelow,
  queryNear,
  wrapT,
} from "../shared/track.js";

export interface KartState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** forward speed (m/s), can be negative for reverse */
  speed: number;
  /** lateral slide velocity in world XZ */
  slideX: number;
  slideZ: number;
  vy: number;
  grounded: boolean;
  lastT: number;
  onTrack: boolean;
  offTrack: boolean;
  /** drift state */
  drifting: boolean;
  driftDir: number;
  driftCharge: number; // 0..1
  /** boost timers */
  boostTime: number; // item rocket
  miniBoostTime: number; // drift release
  spinTime: number; // slick spin-out
  slickImmuneUntil: number;
  respawns: number;
}

export interface KartInput {
  throttle: number; // -1..1
  steer: number; // -1..1
  drift: boolean;
}

export interface PhysicsEvents {
  landed: boolean;
  jumped: boolean;
  fell: boolean; // fell below KILL_Y -> caller should respawn
  driftBoost: boolean;
}

export const PHYS = {
  maxSpeed: 30,
  maxReverse: 10,
  accel: 17,
  brake: 30,
  drag: 0.55,
  offTrackScale: 0.5,
  steerRate: 2.1,
  driftSteerMult: 1.75,
  gravity: 22,
  jumpVy: 7.5,
  boostMax: 42,
  boostAccel: 34,
  miniBoostTime: 1.4,
  rocketTime: 2.2,
  spinTime: 1.25,
};

export function createKart(x: number, y: number, z: number, yaw: number): KartState {
  return {
    x, y, z, yaw,
    speed: 0, slideX: 0, slideZ: 0, vy: 0,
    grounded: true, lastT: 0.997, onTrack: true, offTrack: false,
    drifting: false, driftDir: 0, driftCharge: 0,
    boostTime: 0, miniBoostTime: 0, spinTime: 0,
    slickImmuneUntil: 0, respawns: 0,
  };
}

function groundAt(x: number, z: number, hintT: number, yRef: number): { y: number; t: number; onTrack: boolean } | null {
  const q = queryNear(x, z, hintT, 0.03);
  if (q.onTrack && !isInGap(q.t)) {
    return { y: q.cy + 0.35, t: q.t, onTrack: true };
  }
  if (!q.onTrack || isInGap(q.t)) {
    // Maybe there is a lower drivable level beneath (fell off bridge / gap edge).
    const below = queryBelow(x, z, yRef - 0.4);
    if (below && below.onTrack && !isInGap(below.t)) {
      return { y: below.cy + 0.35, t: below.t, onTrack: true };
    }
    const island = islandGroundY(x, z);
    if (island !== null) return { y: island + 0.35, t: q.t, onTrack: false };
    return null; // lava / void
  }
  const island = islandGroundY(x, z);
  if (island !== null) return { y: island + 0.35, t: q.t, onTrack: false };
  return null;
}

export function stepKart(s: KartState, input: KartInput, dt: number, nowMs: number, controlsLocked: boolean): PhysicsEvents {
  const ev: PhysicsEvents = { landed: false, jumped: false, fell: false, driftBoost: false };
  dt = Math.min(dt, 1 / 20);

  const spinning = s.spinTime > 0;
  if (s.spinTime > 0) s.spinTime -= dt;
  if (s.boostTime > 0) s.boostTime -= dt;
  if (s.miniBoostTime > 0) s.miniBoostTime -= dt;

  const throttle = controlsLocked || spinning ? 0 : input.throttle;
  const steer = controlsLocked ? 0 : input.steer;
  const wantDrift = !controlsLocked && !spinning && input.drift && Math.abs(s.speed) > 13;

  // --- steering ---
  const speedAbs = Math.abs(s.speed);
  const dirSign = s.speed >= 0 ? 1 : -1;
  const steerAuthority = Math.min(1, speedAbs / 8);
  let yawRate = steer * PHYS.steerRate * steerAuthority * dirSign;

  s.drifting = wantDrift && steer !== 0;
  if (s.drifting) {
    s.driftDir = Math.sign(steer);
    yawRate *= PHYS.driftSteerMult;
    s.driftCharge = Math.min(1, s.driftCharge + dt * 0.55);
  } else {
    if (s.driftCharge > 0.55 && s.grounded && !controlsLocked && !spinning) {
      s.miniBoostTime = PHYS.miniBoostTime;
      ev.driftBoost = true;
    }
    s.driftCharge = 0;
  }
  if (spinning) {
    yawRate = 9; // wild spin
  }
  if (s.grounded) s.yaw += yawRate * dt;

  // --- longitudinal ---
  const boosting = s.boostTime > 0 || s.miniBoostTime > 0;
  const topSpeed = boosting ? PHYS.boostMax : PHYS.maxSpeed;
  if (s.grounded) {
    if (throttle > 0) {
      const a = (boosting ? PHYS.boostAccel : PHYS.accel) * (s.offTrack ? 0.6 : 1);
      s.speed += a * throttle * dt * (s.speed < 0 ? 2.2 : 1);
    } else if (throttle < 0) {
      if (s.speed > 1) s.speed += -PHYS.brake * dt; // brake
      else s.speed = Math.max(-PHYS.maxReverse, s.speed + PHYS.accel * 0.6 * throttle * dt);
    } else {
      // coast
      s.speed -= Math.sign(s.speed) * Math.min(Math.abs(s.speed), PHYS.drag * 3 * dt);
    }
    const cap = s.offTrack ? topSpeed * PHYS.offTrackScale : topSpeed;
    s.speed = Math.max(-PHYS.maxReverse, Math.min(cap, s.speed));
    if (!boosting && s.speed > PHYS.maxSpeed) {
      s.speed = Math.max(PHYS.maxSpeed, s.speed - 20 * dt);
    }
    // slide: drifting keeps lateral velocity, otherwise grip kills it
    const grip = s.drifting ? 1.6 : 7;
    const k = Math.max(0, 1 - grip * dt);
    s.slideX *= k;
    s.slideZ *= k;
    if (s.drifting) {
      // push tail outward for the slide feel
      const fx = Math.sin(s.yaw);
      const fz = Math.cos(s.yaw);
      const sideX = fz * s.driftDir;
      const sideZ = -fx * s.driftDir;
      s.slideX += sideX * speedAbs * 0.55 * dt * 3;
      s.slideZ += sideZ * speedAbs * 0.55 * dt * 3;
    }
  }

  // --- integrate horizontal ---
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  s.x += (fx * s.speed + s.slideX) * dt;
  s.z += (fz * s.speed + s.slideZ) * dt;

  // --- vertical / ground ---
  if (s.grounded) {
    const g = groundAt(s.x, s.z, s.lastT, s.y);
    if (!g) {
      s.grounded = false; // drove off an edge or into the gap
      s.vy = 0;
    } else {
      s.lastT = g.t;
      s.onTrack = g.onTrack;
      s.offTrack = !g.onTrack;
      // ramp launch
      if (isOnRamp(g.t) && s.speed > 12) {
        s.grounded = false;
        s.vy = PHYS.jumpVy;
        ev.jumped = true;
      } else {
        // smooth vertical follow (elevation changes, bridge ramps)
        const dy = g.y - s.y;
        s.y += dy * Math.min(1, 14 * dt);
        s.vy = 0;
      }
    }
  }
  if (!s.grounded) {
    s.vy -= PHYS.gravity * dt;
    s.y += s.vy * dt;
    // try landing on local surface (same level)
    const local = queryNear(s.x, s.z, s.lastT, 0.03);
    const canLandLocal =
      local.onTrack && !isInGap(local.t) && s.vy <= 0 && s.y <= local.cy + 0.4;
    if (canLandLocal) {
      s.y = local.cy + 0.35;
      s.grounded = true;
      s.onTrack = true;
      s.offTrack = false;
      s.lastT = local.t;
      s.vy = 0;
      s.slideX *= 0.5;
      s.slideZ *= 0.5;
      ev.landed = true;
    } else {
      // try a lower level (fell off the bridge onto the low road / island)
      const below = queryBelow(s.x, s.z, s.y - 0.3);
      if (below && s.vy <= 0 && s.y <= below.cy + 0.4) {
        s.y = below.cy + 0.35;
        s.grounded = true;
        s.onTrack = true;
        s.offTrack = false;
        s.lastT = below.t;
        s.vy = 0;
        ev.landed = true;
      } else {
        const island = islandGroundY(s.x, s.z);
        if (island !== null && s.vy <= 0 && s.y <= island + 0.4) {
          s.y = island + 0.35;
          s.grounded = true;
          s.onTrack = false;
          s.offTrack = true;
          s.lastT = local.t;
          s.vy = 0;
          ev.landed = true;
        }
      }
    }
    if (s.y < KILL_Y) ev.fell = true;
    void wrapT;
  }
  void TRACK_HALF_WIDTH;
  return ev;
}

export function respawnKart(
  s: KartState,
  x: number,
  y: number,
  z: number,
  yaw: number,
  t: number,
) {
  s.x = x;
  s.y = y;
  s.z = z;
  s.yaw = yaw;
  s.speed = 0;
  s.slideX = 0;
  s.slideZ = 0;
  s.vy = 0;
  s.grounded = true;
  s.lastT = t;
  s.drifting = false;
  s.driftCharge = 0;
  s.spinTime = 0;
  s.boostTime = 0;
  s.miniBoostTime = 0;
  s.respawns += 1;
}
