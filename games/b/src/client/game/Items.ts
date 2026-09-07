import * as THREE from 'three';
import { TRACK } from '../../shared/track.ts';
import type { HoneyNet, WaspNet } from '../../shared/protocol.ts';

/** Item boxes, honey puddles and wasps - all driven by server snapshots. */
export class ItemVisuals {
  readonly group = new THREE.Group();
  private boxes: THREE.Mesh[] = [];
  private boxInner: THREE.Mesh[] = [];
  private honeys = new Map<number, THREE.Mesh>();
  private wasps = new Map<number, THREE.Group>();
  private honeyGeo = new THREE.CircleGeometry(2.3, 20);
  private honeyMat = new THREE.MeshStandardMaterial({
    color: '#f59e0b',
    emissive: '#8a4b00',
    emissiveIntensity: 0.4,
    roughness: 0.15,
    transparent: true,
    opacity: 0.92,
  });
  private time = 0;
  private lastBoxMask = -1;

  constructor() {
    const boxGeo = new THREE.BoxGeometry(1.7, 1.7, 1.7);
    const boxMat = new THREE.MeshPhysicalMaterial({
      color: '#ffd166',
      transparent: true,
      opacity: 0.45,
      roughness: 0.1,
      metalness: 0.1,
      transmission: 0,
      emissive: '#ffb703',
      emissiveIntensity: 0.25,
    });
    const innerGeo = new THREE.IcosahedronGeometry(0.55, 0);
    const innerMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.6 });
    for (const def of TRACK.itemBoxes) {
      const box = new THREE.Mesh(boxGeo, boxMat);
      box.position.set(def.x, def.y, def.z);
      box.castShadow = true;
      this.group.add(box);
      this.boxes.push(box);
      const inner = new THREE.Mesh(innerGeo, innerMat);
      inner.position.copy(box.position);
      this.group.add(inner);
      this.boxInner.push(inner);
    }
  }

  setBoxes(mask: number): void {
    if (mask === this.lastBoxMask) return;
    this.lastBoxMask = mask;
    for (let i = 0; i < this.boxes.length; i++) {
      const active = (mask & (1 << i)) !== 0;
      this.boxes[i].visible = active;
      this.boxInner[i].visible = active;
    }
  }

  setHoneys(list: HoneyNet[]): void {
    const seen = new Set<number>();
    for (const h of list) {
      seen.add(h.id);
      let mesh = this.honeys.get(h.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.honeyGeo, this.honeyMat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(h.x, h.y + 0.08, h.z);
        this.group.add(mesh);
        this.honeys.set(h.id, mesh);
      }
    }
    for (const [id, mesh] of this.honeys) {
      if (!seen.has(id)) {
        this.group.remove(mesh);
        this.honeys.delete(id);
      }
    }
  }

  setWasps(list: WaspNet[]): void {
    const seen = new Set<number>();
    for (const w of list) {
      seen.add(w.id);
      let g = this.wasps.get(w.id);
      if (!g) {
        g = makeWasp();
        g.position.set(w.x, w.y, w.z);
        g.userData.target = new THREE.Vector3(w.x, w.y, w.z);
        this.group.add(g);
        this.wasps.set(w.id, g);
      }
      (g.userData.target as THREE.Vector3).set(w.x, w.y, w.z);
      g.userData.yaw = w.yaw;
    }
    for (const [id, g] of this.wasps) {
      if (!seen.has(id)) {
        this.group.remove(g);
        this.wasps.delete(id);
      }
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (!b.visible) continue;
      b.rotation.y += dt * 1.2;
      b.rotation.x += dt * 0.7;
      const bob = Math.sin(this.time * 2 + i) * 0.15;
      b.position.y = TRACK.itemBoxes[i].y + bob;
      const inner = this.boxInner[i];
      inner.position.y = b.position.y;
      inner.rotation.y -= dt * 2;
    }
    for (const g of this.wasps.values()) {
      const target = g.userData.target as THREE.Vector3;
      g.position.lerp(target, Math.min(1, dt * 12));
      g.position.y = target.y + Math.sin(this.time * 18) * 0.15;
      g.rotation.y = (g.userData.yaw as number) ?? 0;
      const wings = g.userData.wings as THREE.Mesh[];
      const flap = Math.sin(this.time * 60) * 0.7;
      wings[0].rotation.z = 0.4 + flap;
      wings[1].rotation.z = -0.4 - flap;
    }
  }
}

function makeWasp(): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#ffb703', roughness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#1d1d1b', roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), bodyMat);
  body.scale.set(0.8, 0.7, 1.4);
  g.add(body);
  for (const z of [-0.2, 0.25]) {
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.1, 6, 14), darkMat);
    stripe.position.z = z;
    stripe.scale.set(0.9, 0.85, 1);
    g.add(stripe);
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), darkMat);
  head.position.z = -0.85;
  g.add(head);
  const stinger = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.5, 6), darkMat);
  stinger.position.z = 1.05;
  stinger.rotation.x = Math.PI / 2;
  g.add(stinger);
  const wingMat = new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, side: THREE.DoubleSide });
  const wingGeo = new THREE.CircleGeometry(0.55, 10);
  const wl = new THREE.Mesh(wingGeo, wingMat);
  wl.scale.set(0.6, 1.3, 1);
  wl.position.set(-0.45, 0.45, 0);
  wl.rotation.set(-Math.PI / 2, 0, 0.4);
  const wr = wl.clone();
  wr.position.x = 0.45;
  wr.rotation.z = -0.4;
  g.add(wl, wr);
  g.userData.wings = [wl, wr];
  const glow = new THREE.PointLight('#ffb703', 2.2, 12);
  glow.position.y = 0.6;
  g.add(glow);
  return g;
}
