import * as THREE from 'three';
import type { SlickInfo, ProjInfo } from '../../shared/protocol';
import type { Track } from './track';

const BOX_ROWS: { arcFrac: number; lateral: number[] }[] = [
  { arcFrac: 0.16, lateral: [-2.8, 0, 2.8] }, // north straight
  { arcFrac: 0.42, lateral: [-2.8, 0, 2.8] }, // east descent
  { arcFrac: 0.72, lateral: [-2.8, 0, 2.8] }, // before the ramp
  { arcFrac: 0.84, lateral: [-2.8, 0, 2.8] }, // after the landing
];

const BOOST_PADS: { arcFrac: number; lateral: number }[] = [
  { arcFrac: 0.145, lateral: 0 }, // north straight
  { arcFrac: 0.7, lateral: -1.5 }, // south straight before the ramp
  { arcFrac: 0.738, lateral: 1.5 }, // ramp approach
  { arcFrac: 0.752, lateral: -1 }, // ramp approach
  { arcFrac: 0.845, lateral: 0 }, // after the landing
];

export const BOX_COUNT = BOX_ROWS.length * 3;

interface BoxView {
  mesh: THREE.Group;
  x: number;
  y: number;
  z: number;
  cooldownUntil: number;
}

export class Items {
  boxes: BoxView[] = [];
  pads: { x: number; y: number; z: number; mesh: THREE.Mesh; cooldown: number }[] = [];
  slicks = new Map<number, { mesh: THREE.Mesh; until: number }>();
  projs = new Map<number, { mesh: THREE.Group; info: ProjInfo }>();
  private scene: THREE.Scene;
  private track: Track;
  private padCooldowns = new Map<number, number>();

  constructor(scene: THREE.Scene, track: Track) {
    this.scene = scene;
    this.track = track;
    this.buildBoxes();
    this.buildPads();
  }

  private buildBoxes(): void {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#d9a24a';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#8a5a24';
    g.lineWidth = 6;
    g.strokeRect(3, 3, 58, 58);
    g.beginPath();
    g.moveTo(3, 3);
    g.lineTo(61, 61);
    g.moveTo(61, 3);
    g.lineTo(3, 61);
    g.stroke();
    g.fillStyle = '#5c8a3c';
    g.beginPath();
    g.arc(32, 32, 10, 0, Math.PI * 2);
    g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.BoxGeometry(1.15, 1.15, 1.15);
    const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true });
    for (const row of BOX_ROWS) {
      const arc = row.arcFrac * this.track.length;
      const sm = this.track.sampleAtArc(arc);
      const px = -sm.tz;
      const pz = sm.tx;
      for (const lat of row.lateral) {
        const x = sm.x + px * lat;
        const z = sm.z + pz * lat;
        const y = sm.y + 1.1;
        const m = new THREE.Mesh(geo, mat.clone());
        m.position.set(x, y, z);
        const group = new THREE.Group();
        group.add(m);
        this.scene.add(group);
        this.boxes.push({ mesh: group, x, y, z, cooldownUntil: 0 });
      }
    }
  }

  private buildPads(): void {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#e8762d';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#ffd98c';
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(10, 14 + i * 18);
      g.lineTo(32, 2 + i * 18);
      g.lineTo(54, 14 + i * 18);
      g.lineTo(54, 22 + i * 18);
      g.lineTo(32, 10 + i * 18);
      g.lineTo(10, 22 + i * 18);
      g.closePath();
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(4.4, 5);
    for (const pad of BOOST_PADS) {
      const arc = pad.arcFrac * this.track.length;
      const sm = this.track.sampleAtArc(arc);
      const px = -sm.tz;
      const pz = sm.tx;
      const x = sm.x + px * pad.lateral;
      const z = sm.z + pz * pad.lateral;
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.95 }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = Math.atan2(sm.tx, sm.tz);
      mesh.position.set(x, sm.y + 0.1, z);
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      this.pads.push({ x, y: sm.y, z, mesh, cooldown: 0 });
    }
  }

  boxAt(index: number): BoxView | null {
    return this.boxes[index] ?? null;
  }

  setBoxCooldown(index: number, until: number): void {
    const b = this.boxes[index];
    if (b) b.cooldownUntil = until;
  }

  /** Returns the index of the first active box overlapping the kart, or -1. */
  hitBox(x: number, y: number, z: number, now: number): number {
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (now < b.cooldownUntil) continue;
      if ((b.x - x) ** 2 + (b.z - z) ** 2 < 2.4 ** 2 && Math.abs(b.y - y) < 2.6) return i;
    }
    return -1;
  }

  /** Returns true when the kart drives onto an armed boost pad. */
  hitPad(x: number, z: number, now: number): boolean {
    for (let i = 0; i < this.pads.length; i++) {
      const p = this.pads[i];
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < 3.1 ** 2) {
        if (now < (this.padCooldowns.get(i) ?? 0)) continue;
        this.padCooldowns.set(i, now + 900);
        return true;
      }
    }
    return false;
  }

  addSlick(info: SlickInfo): void {
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(2.1, 20),
      new THREE.MeshBasicMaterial({ color: 0xd98f2b, transparent: true, opacity: 0.88 })
    );
    mesh.rotation.x = -Math.PI / 2;
    const gy = this.track.groundAt(info.x, info.z, info.y);
    mesh.position.set(info.x, gy.h + 0.08, info.z);
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.slicks.set(info.id, { mesh, until: info.until });
  }

  addProj(info: ProjInfo): void {
    const group = new THREE.Group();
    const cob = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 1.3, 8),
      new THREE.MeshLambertMaterial({ color: 0xf2c53d })
    );
    cob.rotation.x = Math.PI / 2;
    group.add(cob);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 6, 6),
      new THREE.MeshLambertMaterial({ color: 0x8fae3c })
    );
    tip.position.z = 0.7;
    group.add(tip);
    group.position.set(info.x, info.y, info.z);
    group.rotation.y = Math.atan2(info.dx, info.dz);
    this.scene.add(group);
    this.projs.set(info.id, { mesh: group, info });
  }

  removeProj(id: number): void {
    const p = this.projs.get(id);
    if (p) {
      this.scene.remove(p.mesh);
      this.projs.delete(id);
    }
  }

  /** Advances rockets; returns the id of a rocket that hit (x,y,z) kart, if any. */
  updateProjectiles(dt: number, now: number, me: { x: number; y: number; z: number } | null): number | null {
    let hitMe: number | null = null;
    for (const [id, p] of this.projs) {
      const info = p.info;
      if (now - info.born > 4200) {
        this.removeProj(id);
        continue;
      }
      const speed = 46;
      info.x += info.dx * speed * dt;
      info.z += info.dz * speed * dt;
      const g = this.track.groundAt(info.x, info.z, info.y);
      info.y += (g.h + 0.6 - info.y) * Math.min(1, 8 * dt);
      p.mesh.position.set(info.x, info.y, info.z);
      if (me && (info.x - me.x) ** 2 + (info.z - me.z) ** 2 < 1.9 ** 2 && Math.abs(info.y - me.y) < 2.4) {
        hitMe = id;
      }
    }
    for (const [id, s] of this.slicks) {
      if (now > s.until) {
        this.scene.remove(s.mesh);
        this.slicks.delete(id);
      }
    }
    return hitMe;
  }

  /** Returns the slick id overlapping the kart, or null. */
  hitSlick(x: number, z: number): number | null {
    for (const [id, s] of this.slicks) {
      const m = s.mesh.position;
      if ((m.x - x) ** 2 + (m.z - z) ** 2 < 2.2 ** 2) return id;
    }
    return null;
  }

  clearTransient(): void {
    for (const [, s] of this.slicks) this.scene.remove(s.mesh);
    this.slicks.clear();
    for (const id of [...this.projs.keys()]) this.removeProj(id);
    for (const b of this.boxes) b.cooldownUntil = 0;
  }
}
