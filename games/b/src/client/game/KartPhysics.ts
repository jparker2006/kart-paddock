import { KART } from '../../shared/constants.ts';
import { TRACK, projectToTrack, type TrackProjection } from '../../shared/track.ts';
import type { InputState } from './Input.ts';

export type BoostKind = 'none' | 'mini' | 'super' | 'pad' | 'nectar';

/** Search window (samples) for the local kart's track projection. */
const WINDOW = 45;

export interface KartEvents {
  onLeaveTrack(): void;
  onWallHit(strength: number): void;
  onDriftBoost(kind: BoostKind): void;
  onLand(): void;
}

/**
 * Arcade kart model for the local player.  Position is free in XZ; the track
 * spline provides the floor height, walls and "are we still on the road"
 * information through `projectToTrack`.
 */
export class LocalKart {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  speed = 0;
  vy = 0;
  grounded = true;
  /** fractional track index we believe we are at */
  hint = 0;
  proj: TrackProjection | null = null;
  lateral = 0;
  onShoulder = false;
  drift = 0; // -1, 0, 1
  driftCharge = 0;
  boostTimer = 0;
  boostKind: BoostKind = 'none';
  spinTimer = 0;
  spinAngle = 0;
  wrongWay = false;
  /** vertical velocity to carry into the air from the last slope */
  private lastGroundVy = 0;
  private wallCooldown = 0;
  private fallTimer = 0;
  private hopTimer = 0;
  hopOffset = 0;
  /** tilt used for drift/lean visuals */
  lean = 0;
  respawning = false;
  /** time since last respawn (invulnerability + fade) */
  sinceRespawn = 10;
  stuckTimer = 0;
  airTime = 0;

  constructor(private events: KartEvents) {}

  reset(x: number, y: number, z: number, yaw: number, hint: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.speed = 0;
    this.vy = 0;
    this.grounded = true;
    this.hint = hint;
    this.drift = 0;
    this.driftCharge = 0;
    this.boostTimer = 0;
    this.boostKind = 'none';
    this.spinTimer = 0;
    this.spinAngle = 0;
    this.lastGroundVy = 0;
    this.fallTimer = 0;
    this.respawning = false;
    this.sinceRespawn = 0;
    this.stuckTimer = 0;
    this.airTime = 0;
    this.proj = projectToTrack(TRACK, this, hint, WINDOW);
    this.lateral = this.proj.lateral;
  }

  /** Called when an item or hazard hits us. */
  spinOut(duration: number): void {
    this.spinTimer = duration;
    this.spinAngle = 0;
    this.drift = 0;
    this.driftCharge = 0;
    this.boostTimer = 0;
    this.boostKind = 'none';
    this.speed *= 0.35;
  }

  applyBoost(kind: BoostKind, duration: number): void {
    this.boostKind = kind;
    this.boostTimer = Math.max(this.boostTimer, duration);
  }

  forward(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  step(dt: number, input: InputState, canDrive: boolean): void {
    this.sinceRespawn += dt;
    if (this.respawning) return;
    const K = KART;
    const spinning = this.spinTimer > 0;
    const control = canDrive && !spinning;

    // ---- longitudinal
    const boosting = this.boostTimer > 0;
    let maxSpeed = boosting ? K.boostMaxSpeed : K.maxSpeed;
    if (this.onShoulder && !boosting) maxSpeed *= K.shoulderSpeedFactor;
    if (spinning) {
      this.spinTimer -= dt;
      this.spinAngle += dt * 9;
      this.speed -= this.speed * Math.min(1, dt * 2.5);
    } else if (control && input.accel) {
      const accel = boosting ? K.boostAccel : K.accel;
      if (this.speed < maxSpeed) this.speed = Math.min(maxSpeed, this.speed + accel * dt);
    } else if (control && input.brake) {
      if (this.speed > 0.5) this.speed = Math.max(0, this.speed - K.brake * dt);
      else this.speed = Math.max(-K.maxReverse, this.speed - K.accel * 0.6 * dt);
    } else {
      // coasting friction
      const decel = K.coast * dt;
      if (Math.abs(this.speed) <= decel) this.speed = 0;
      else this.speed -= Math.sign(this.speed) * decel;
    }
    if (boosting) {
      this.boostTimer -= dt;
      if (this.boostTimer <= 0) {
        this.boostTimer = 0;
        this.boostKind = 'none';
      }
    }
    // soft cap after a boost ends / when leaving the road
    if (this.speed > maxSpeed) this.speed = Math.max(maxSpeed, this.speed - 28 * dt);

    // ---- steering & drifting
    const steer = control ? (input.left ? 1 : 0) - (input.right ? 1 : 0) : 0;
    const speedRatio = Math.min(1, Math.abs(this.speed) / K.maxSpeed);
    let turnRate = K.steerLow + (K.steerHigh - K.steerLow) * speedRatio;
    let steerAmount = steer;

    if (this.drift === 0 && control && input.drift && steer !== 0 && this.speed > K.driftMinSpeed && this.grounded) {
      this.drift = steer;
      this.driftCharge = 0;
      this.hopTimer = 0.28;
    }
    if (this.drift !== 0) {
      const release = !control || !input.drift || this.speed < K.driftMinSpeed * 0.75 || this.speed < 0;
      if (release) {
        if (this.driftCharge >= K.driftChargeTime) {
          this.applyBoost('super', K.superBoostTime);
          this.events.onDriftBoost('super');
        } else if (this.driftCharge >= K.driftChargeTime * 0.45) {
          this.applyBoost('mini', K.miniBoostTime);
          this.events.onDriftBoost('mini');
        }
        this.drift = 0;
        this.driftCharge = 0;
      } else {
        turnRate *= K.driftSteerMult;
        // you can tighten or loosen a drift, but never reverse it
        steerAmount = this.drift * 0.62 + steer * 0.42;
        if (Math.sign(steerAmount) !== this.drift) steerAmount = this.drift * 0.15;
        if (this.grounded) this.driftCharge += dt;
      }
    }
    if (!this.grounded) turnRate *= 0.45;
    const moveFactor = Math.min(1, Math.abs(this.speed) / 4);
    this.yaw += steerAmount * turnRate * dt * moveFactor * (this.speed >= 0 ? 1 : -1);
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;

    // hop
    if (this.hopTimer > 0) {
      this.hopTimer -= dt;
      this.hopOffset = Math.sin((1 - this.hopTimer / 0.28) * Math.PI) * 0.45;
    } else this.hopOffset = 0;

    // ---- move
    const slide = this.drift !== 0 ? this.drift * 0.38 : 0;
    const dirYaw = this.yaw - slide;
    const mx = -Math.sin(dirYaw);
    const mz = -Math.cos(dirYaw);
    this.x += mx * this.speed * dt;
    this.z += mz * this.speed * dt;

    // ---- track projection
    const proj = projectToTrack(TRACK, this, this.hint, WINDOW);
    this.proj = proj;
    if (proj.distance < 40) this.hint = proj.progress;
    this.lateral = proj.lateral;
    const halfWidth = TRACK.halfWidth;
    const shoulder = TRACK.shoulderHalfWidth;
    this.onShoulder = Math.abs(this.lateral) > halfWidth;
    this.wrongWay = this.speed > 3 && mx * proj.tx + mz * proj.tz < -0.35;

    // walls (closed edges only)
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    if (!proj.open && Math.abs(this.lateral) > shoulder && this.grounded) {
      const over = Math.abs(this.lateral) - shoulder;
      const side = Math.sign(this.lateral);
      this.x -= proj.rx * over * side;
      this.z -= proj.rz * over * side;
      this.lateral = shoulder * side;
      // bounce: kill some speed and deflect the nose parallel to the wall
      const forwardDotTangent = mx * proj.tx + mz * proj.tz;
      const towardWall = (mx * proj.rx + mz * proj.rz) * side; // > 0 when moving into the wall
      const lateralSpeed = Math.max(0, towardWall) * Math.abs(this.speed);
      const wallYaw = forwardDotTangent >= 0 ? Math.atan2(-proj.tx, -proj.tz) : Math.atan2(proj.tx, proj.tz);
      if (this.wallCooldown === 0 && lateralSpeed > 4) {
        this.speed *= 1 - K.wallBounce * Math.min(1, lateralSpeed / 20);
        this.wallCooldown = 0.35;
        this.events.onWallHit(Math.min(1, lateralSpeed / 25));
        this.yaw = lerpAngle(this.yaw, wallYaw, 0.65);
      } else if (towardWall > 0) {
        // scraping along the wall: ease the nose parallel, but slowly enough
        // that steering away always wins
        this.yaw = lerpAngle(this.yaw, wallYaw, Math.min(1, dt * 2));
      }
    }

    // ---- vertical
    const groundY = proj.groundY;
    const hasFloor = !proj.gap && Math.abs(this.lateral) <= shoulder + 0.6;
    if (this.grounded) {
      const dy = groundY - this.y;
      if (hasFloor && dy > -0.7) {
        this.lastGroundVy = dt > 0 ? dy / dt : 0;
        this.y = groundY;
        this.vy = 0;
        this.airTime = 0;
      } else {
        this.grounded = false;
        this.vy = Math.max(0, this.lastGroundVy) * (hasFloor ? 0.2 : 1);
        this.drift = 0;
        this.driftCharge = 0;
      }
    } else {
      this.airTime += dt;
      this.vy -= K.gravity * dt;
      this.y += this.vy * dt;
      if (hasFloor && this.y <= groundY && this.y > groundY - 2.2) {
        this.y = groundY;
        this.vy = 0;
        this.grounded = true;
        this.lastGroundVy = 0;
        this.events.onLand();
      } else if (this.y < groundY - 6 || this.y < -20) {
        this.fallTimer += dt;
        if (this.fallTimer > 0.15) {
          this.fallTimer = 0;
          this.respawning = true;
          this.events.onLeaveTrack();
        }
      }
    }

    // stuck detector (pressed against a wall or very far off the racing line)
    if (canDrive && input.accel && Math.abs(this.speed) < 1.5 && this.grounded) this.stuckTimer += dt;
    else this.stuckTimer = 0;

    // lean visual
    const targetLean = this.drift !== 0 ? -this.drift * 0.28 : -steer * 0.08 * speedRatio;
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 8);
  }

  /** Nudges the kart away from another kart at (ox, oz). */
  resolveKartCollision(ox: number, oz: number, oy: number): boolean {
    const dx = this.x - ox;
    const dz = this.z - oz;
    if (Math.abs(this.y - oy) > 2.5) return false;
    const d = Math.hypot(dx, dz);
    const minD = KART.radius * 2;
    if (d >= minD || d < 1e-4) return false;
    const push = (minD - d) * 0.55;
    this.x += (dx / d) * push;
    this.z += (dz / d) * push;
    this.speed *= 0.965;
    return true;
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
