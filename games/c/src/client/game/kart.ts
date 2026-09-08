import * as THREE from 'three';
import { CHARACTERS, type KartState } from '../../shared/protocol';
import type { Track } from './track';

export const GRAV = 26;
export const GRAV_HANG = 12.5; // floatier gravity near the apex of a jump
export const MAX_SPEED = 26;
export const GRASS_MAX = 15;
export const BOOST_MULT = 1.32;

export interface KartInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1
  drift: boolean;
}

// ------------------------------------------------------------------

function nameSprite(name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '800 34px "Trebuchet MS", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(40,22,6,0.9)';
  g.strokeText(name, 128, 34);
  g.fillStyle = '#fff4e0';
  g.fillText(name, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  spr.scale.set(2.3, 0.58, 1);
  spr.position.y = 2.05;
  return spr;
}

function blobShadow(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(20,10,0,0.42)');
  grad.addColorStop(1, 'rgba(20,10,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 3.2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 3;
  return m;
}

/** Builds the visual kart for a character (procedural produce-racer). */
export function buildKartMesh(
  character: number,
  name: string
): { group: THREE.Group; body: THREE.Group; flame: THREE.Mesh; label: THREE.Sprite } {
  const color = CHARACTERS[character]?.color ?? 0xff8a2a;
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const paint = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x33261c });

  // rounded produce body
  const hull = new THREE.Mesh(new THREE.SphereGeometry(0.78, 18, 14), paint);
  hull.scale.set(1.05, 0.62, 1.5);
  hull.position.y = 0.52;
  body.add(hull);

  // seat back + driver
  const seat = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), dark);
  seat.scale.set(1, 0.9, 0.55);
  seat.position.set(0, 0.86, -0.42);
  body.add(seat);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), new THREE.MeshLambertMaterial({ color: 0xffe0bd }));
  head.position.set(0, 1.02, -0.18);
  body.add(head);
  const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 6), new THREE.MeshLambertMaterial({ color: 0x4c8a34 }));
  leaf.position.set(0.06, 1.32, -0.16);
  leaf.rotation.z = -0.4;
  body.add(leaf);

  // bumper (wicker look)
  const bumper = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.09, 8, 16), new THREE.MeshLambertMaterial({ color: 0xd9b077 }));
  bumper.rotation.x = Math.PI / 2;
  bumper.position.set(0, 0.36, 0.86);
  body.add(bumper);

  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.26, 14);
  const wheels: THREE.Mesh[] = [];
  for (const [wx, wz] of [
    [-0.62, 0.52],
    [0.62, 0.52],
    [-0.66, -0.55],
    [0.66, -0.55],
  ]) {
    const w = new THREE.Mesh(wheelGeo, new THREE.MeshLambertMaterial({ color: 0x2b2018 }));
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.33, wz);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.3, 10), new THREE.MeshLambertMaterial({ color: 0xd9b077 }));
    hub.rotation.z = Math.PI / 2;
    w.add(hub);
    body.add(w);
    wheels.push(w);
  }

  // boost flame (hidden by default)
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 1.2, 10),
    new THREE.MeshBasicMaterial({ color: 0xffa53d, transparent: true, opacity: 0.9 })
  );
  flame.rotation.x = Math.PI / 2;
  flame.position.set(0, 0.5, -1.35);
  flame.visible = false;
  body.add(flame);

  const label = nameSprite(name);
  group.add(label);
  const shadow = blobShadow();
  group.add(shadow);
  return { group, body, flame, label };
}

// ------------------------------------------------------------------

interface RemoteSample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  dr: boolean;
  bo: boolean;
  sp: number;
}

/** Network ghost for another player's kart: interpolated, purely visual. */
export class RemoteKart {
  group: THREE.Group;
  body: THREE.Group;
  flame: THREE.Mesh;
  shadow: THREE.Mesh;
  samples: RemoteSample[] = [];
  lastTp = 0;
  spinUntil = 0;
  slipUntil = 0;
  drift = false;
  boosting = false;
  private wheelSpin = 0;

  constructor(character: number, name: string) {
    const built = buildKartMesh(character, name);
    this.group = built.group;
    this.body = built.body;
    this.flame = built.flame;
    this.shadow = this.group.children[this.group.children.length - 1] as THREE.Mesh;
  }

  push(s: KartState, now: number): void {
    this.samples.push({
      t: now,
      x: s.x,
      y: s.y,
      z: s.z,
      yaw: s.yaw,
      dr: s.dr === 1,
      bo: s.bo === 1,
      sp: s.sp,
    });
    if (this.samples.length > 30) this.samples.splice(0, this.samples.length - 30);
    if (s.tp !== this.lastTp) {
      this.lastTp = s.tp;
      this.snap();
    }
  }

  snap(): void {
    const last = this.samples[this.samples.length - 1];
    if (!last) return;
    this.group.position.set(last.x, last.y, last.z);
    this.group.rotation.y = last.yaw;
    this.samples = this.samples.slice(-2);
  }

  update(renderTime: number, track: Track): void {
    // find the two samples surrounding the (delayed) render time
    let a = this.samples[0];
    let b = this.samples[this.samples.length - 1];
    if (!a) return;
    if (this.samples.length === 1 || renderTime <= a.t) {
      b = a;
    } else {
      for (let i = 0; i < this.samples.length - 1; i++) {
        if (this.samples[i].t <= renderTime && this.samples[i + 1].t >= renderTime) {
          a = this.samples[i];
          b = this.samples[i + 1];
          break;
        }
      }
    }
    const span = b.t - a.t;
    const f = span > 0 ? Math.min(Math.max((renderTime - a.t) / span, 0), 1) : 1;
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;
    const z = a.z + (b.z - a.z) * f;
    let dy = b.yaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const yaw = a.yaw + dy * f;
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    this.drift = b.dr;
    this.boosting = b.bo;
    this.wheelSpin += b.sp * 0.016;
    // wobble while spinning out
    const now = Date.now();
    if (now < this.spinUntil) {
      this.body.rotation.y = Math.sin((this.spinUntil - now) * 0.012) * 2.6;
    } else {
      this.body.rotation.y = 0;
    }
    this.flame.visible = this.boosting;
    // shadow sticks to the ground under the kart
    const g = track.groundAt(x, z, y);
    this.shadow.position.y = g.h - y + 0.06;
    this.shadow.rotation.z = -yaw;
    this.shadow.visible = y - g.h < 12;
  }
}

// ------------------------------------------------------------------

export type DriftTier = 0 | 1 | 2 | 3;

/**
 * The player's own kart: arcade physics simulated locally at a fixed step.
 * The owning client is the authority for its kart and broadcasts state.
 */
export class OwnKart {
  group: THREE.Group;
  body: THREE.Group;
  flame: THREE.Mesh;
  shadow: THREE.Mesh;
  wheels: THREE.Mesh[] = [];

  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  speed = 0;
  vy = 0;
  grounded = true;
  slipAngle = 0;
  lastSlopeVy = 0;

  drifting = false;
  driftDir = 0;
  driftCharge = 0;
  hopT = 0;

  boostT = 0;
  spinT = 0;
  slipT = 0;
  ghostT = 0;
  offRoadT = 0;

  tpCounter = 0;
  private wheelSpin = 0;
  private lastRespawnHint = 0;

  constructor(character: number, name: string) {
    const built = buildKartMesh(character, name);
    this.group = built.group;
    this.body = built.body;
    this.flame = built.flame;
    built.label.visible = false; // don't float your own name over the camera
    // wheels are the four cylinders; grab them from the body
    let found = 0;
    for (const child of this.body.children) {
      if ((child as THREE.Mesh).geometry?.type === 'CylinderGeometry' && found < 4) {
        this.wheels.push(child as THREE.Mesh);
        found++;
      }
    }
    this.shadow = this.group.children[this.group.children.length - 1] as THREE.Mesh;
  }

  placeAtGrid(x: number, y: number, z: number, yaw: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.speed = 0;
    this.vy = 0;
    this.grounded = true;
    this.drifting = false;
    this.driftCharge = 0;
    this.boostT = 0;
    this.spinT = 0;
    this.slipT = 0;
    this.ghostT = 0;
    this.tpCounter++;
    this.syncMesh();
  }

  teleport(x: number, y: number, z: number, yaw: number): void {
    this.placeAtGrid(x, y, z, yaw);
  }

  get maxSpeed(): number {
    let m = MAX_SPEED;
    if (this.boostT > 0) m *= BOOST_MULT;
    return m;
  }

  spinOut(): void {
    if (this.ghostT > 0 || this.spinT > 0) return;
    this.spinT = 1.3;
    this.speed *= 0.3;
    this.drifting = false;
    this.driftCharge = 0;
  }

  slip(): void {
    if (this.ghostT > 0 || this.slipT > 0 || this.spinT > 0) return;
    this.slipT = 1.7;
    this.speed *= 0.55;
  }

  applyBoost(dur: number): void {
    this.boostT = Math.max(this.boostT, dur);
  }

  respawnAt(track: Track, cpIndex: number): void {
    const r = track.respawn[cpIndex % track.respawn.length];
    this.teleport(r.x, r.y + 0.4, r.z, r.yaw);
    this.ghostT = 1.6;
  }

  private syncMesh(): void {
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.yaw;
  }

  /** One fixed physics step. */
  update(dt: number, input: KartInput, track: Track, locked: boolean, onEvent: (e: string, data?: number) => void): void {
    const g0 = track.groundAt(this.x, this.z, this.y);
    const onRoad = g0.surface === 'road';
    // "in the water" means at the water surface, not flying over the creek
    const inWater = g0.surface === 'water' && this.y - g0.h < 0.7;

    // timers
    this.boostT = Math.max(0, this.boostT - dt);
    this.spinT = Math.max(0, this.spinT - dt);
    this.slipT = Math.max(0, this.slipT - dt);
    this.ghostT = Math.max(0, this.ghostT - dt);

    let throttle = locked || this.spinT > 0 ? 0 : input.throttle;
    let brake = locked || this.spinT > 0 ? 0 : input.brake;
    let steer = locked || this.spinT > 0 ? 0 : input.steer;

    // surface speed caps (only while rolling on the ground)
    let cap = this.maxSpeed;
    if (this.grounded && !onRoad) cap = GRASS_MAX * (this.boostT > 0 ? BOOST_MULT : 1);
    if (this.slipT > 0) cap *= 0.6;
    if (brake > 0 && this.speed > 0) {
      this.speed -= 34 * dt * brake;
    } else if (throttle > 0) {
      this.speed += (this.boostT > 0 ? 30 : 13.5) * dt * throttle;
    }
    // rolling resistance + drag (light while airborne)
    this.speed -= this.speed * (this.grounded ? (onRoad ? 0.5 : 1.1) : 0.12) * dt;
    if (throttle === 0 && brake === 0) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 2.2 * dt);
    if (brake > 0 && this.speed <= 0.2) {
      this.speed -= 10 * dt; // reverse
    }
    const revCap = -9;
    if (this.speed < revCap) this.speed = revCap;
    if (this.speed > cap) this.speed -= (this.speed - cap) * Math.min(1, 4 * dt);
    if (inWater) this.speed *= 0.4;

    // ---- drift & steering ----
    const speedFactor = Math.min(Math.abs(this.speed) / MAX_SPEED, 1.4);
    const canDrift = this.grounded && Math.abs(this.speed) > 11 && onRoad;
    if (input.drift && canDrift && !this.drifting && this.spinT === 0 && this.slipT === 0) {
      this.drifting = true;
      this.driftDir = steer >= 0 ? 1 : -1;
      this.driftCharge = 0;
      if (this.grounded) {
        this.vy = 4.2; // hop
        this.grounded = false;
      }
      onEvent('hop');
    }
    if (this.drifting) {
      if (!input.drift || Math.abs(this.speed) < 8 || this.spinT > 0) {
        // release: grant mini-turbo by charge tier
        const tier: DriftTier = this.driftCharge > 3.1 ? 3 : this.driftCharge > 2.0 ? 2 : this.driftCharge > 1.0 ? 1 : 0;
        if (tier > 0) {
          this.applyBoost(tier === 3 ? 2.1 : tier === 2 ? 1.5 : 0.95);
          onEvent('boost', tier);
        }
        this.drifting = false;
        this.driftCharge = 0;
      } else {
        this.driftCharge += dt;
      }
    }
    const baseTurn = 2.05 * (1 - 0.35 * Math.min(speedFactor, 1));
    // three.js rotation.y grows counter-clockwise on screen, so a right-hand
    // steer input must DECREASE yaw; and no turning without motion
    const grip = Math.min(Math.abs(this.speed) / 4, 1);
    let turn = -steer * baseTurn * grip;
    if (this.drifting) {
      turn = -(steer * 0.55 + this.driftDir * 0.75) * baseTurn * 1.35 * grip;
    }
    if (this.slipT > 0) turn += Math.sin(Date.now() * 0.02) * 0.5;
    if (!this.grounded) turn *= 0.35;
    if (this.speed < 0) turn = -turn;
    this.yaw += turn * dt;

    // slip angle (visual + slight lateral slide while drifting)
    const targetSlip = this.drifting ? this.driftDir * 0.4 : 0;
    this.slipAngle += (targetSlip - this.slipAngle) * Math.min(1, 6 * dt);

    // ---- integrate ----
    const moveYaw = this.yaw + this.slipAngle;
    const dx = Math.sin(moveYaw) * this.speed * dt;
    const dz = Math.cos(moveYaw) * this.speed * dt;
    const nx = this.x + dx;
    const nz = this.z + dz;

    if (this.grounded) {
      const g1 = track.groundAt(nx, nz, this.y + 0.4);
      if (g1.h > this.y + 1.25) {
        // steep bank ahead: blocked, scrub speed
        this.speed *= 0.86;
      } else if (g1.h < this.y - 0.85) {
        // ground fell away -> airborne, carry slope velocity
        this.grounded = false;
        if (g1.h < this.y - 3 && this.lastSlopeVy > 0) {
          // launched off a ramp edge (the creek jump): give the kart its
          // ramp arc so a fast approach always clears the gap
          this.vy = Math.max(this.lastSlopeVy, this.speed * 0.22, 2);
        } else {
          this.vy = Math.max(0, Math.min(this.lastSlopeVy, 9));
        }
      } else {
        const slopeVy = (g1.h - this.y) / dt;
        this.lastSlopeVy = Math.max(-20, Math.min(20, slopeVy));
        this.y = g1.h;
        this.x = nx;
        this.z = nz;
      }
    }
    if (!this.grounded) {
      const gy = track.groundAt(nx, nz, this.y).h;
      const height = this.y - gy;
      const grav = this.vy < 0 && height > 2.2 ? GRAV_HANG : GRAV;
      this.vy -= grav * dt;
      this.y += this.vy * dt;
      this.x = nx;
      this.z = nz;
      if (this.y <= gy) {
        this.y = gy;
        this.grounded = true;
        if (this.vy < -10) onEvent('land');
        this.vy = 0;
        this.lastSlopeVy = 0;
      }
    }

    // off-road stuck tracking (hint, then auto-respawn)
    if (!onRoad && this.grounded && Math.abs(this.speed) < 3) {
      this.offRoadT += dt;
      if (this.offRoadT > 4 && Date.now() - this.lastRespawnHint > 4000) {
        this.lastRespawnHint = Date.now();
        onEvent('stuck');
      }
      if (this.offRoadT > 9) {
        this.offRoadT = 0;
        onEvent('stuckAuto');
      }
    } else {
      this.offRoadT = 0;
    }

    // fell into the creek or off the world
    if (inWater || this.y < -18) {
      onEvent('splash');
    }

    this.syncMesh();

    // ---- visuals ----
    this.wheelSpin += this.speed * dt * 2.4;
    for (let i = 0; i < this.wheels.length; i++) {
      this.wheels[i].rotation.x = this.wheelSpin;
      if (i < 2) this.wheels[i].rotation.y = -steer * 0.45;
    }
    const now = Date.now();
    if (this.spinT > 0) {
      this.body.rotation.y = Math.sin(this.spinT * 7) * 2.4 * (this.spinT / 1.3);
      this.body.rotation.z = Math.sin(this.spinT * 11) * 0.25;
    } else if (this.slipT > 0) {
      this.body.rotation.y = Math.sin(now * 0.03) * 0.3;
      this.body.rotation.z = 0;
    } else {
      this.body.rotation.y = this.drifting ? -this.slipAngle * 1.6 : 0;
      this.body.rotation.z = -turn * 0.1 * speedFactor;
    }
    this.flame.visible = this.boostT > 0;
    if (this.flame.visible) {
      const s = 0.7 + Math.random() * 0.6;
      this.flame.scale.set(s, s, 1);
    }
    const gNow = track.groundAt(this.x, this.z, this.y);
    this.shadow.position.y = gNow.h - this.y + 0.06;
    this.shadow.visible = this.y - gNow.h < 12;
    this.group.visible = !(this.ghostT > 0 && Math.floor(now / 90) % 2 === 0);
  }

  toState(id: string, lap: number, cps: number, prog: number): KartState {
    return {
      id,
      x: Math.round(this.x * 100) / 100,
      y: Math.round(this.y * 100) / 100,
      z: Math.round(this.z * 100) / 100,
      yaw: Math.round(this.yaw * 1000) / 1000,
      sp: Math.round(this.speed * 100) / 100,
      lap,
      cps,
      prog: Math.round(prog * 1000) / 1000,
      dr: this.drifting ? 1 : 0,
      tp: this.tpCounter,
      bo: this.boostT > 0 ? 1 : 0,
    };
  }
}
