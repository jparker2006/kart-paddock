import * as THREE from 'three';
import { TRACK, type TrackDef } from '../../shared/track.ts';

/** Small deterministic PRNG so every client sees the same garden. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Coarse occupancy grid of the track footprint (including embankments). */
class TrackFootprint {
  private cells = new Set<string>();
  private size = 8;
  constructor(track: TrackDef) {
    for (const s of track.samples) {
      const reach = track.shoulderHalfWidth + s.y * 1.35 + 6;
      const r = Math.ceil(reach / this.size);
      const cx = Math.floor(s.x / this.size);
      const cz = Math.floor(s.z / this.size);
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.hypot(dx * this.size, dz * this.size) <= reach + this.size) this.cells.add(`${cx + dx},${cz + dz}`);
        }
      }
    }
  }
  blocked(x: number, z: number): boolean {
    return this.cells.has(`${Math.floor(x / this.size)},${Math.floor(z / this.size)}`);
  }
}

export function buildScenery(track: TrackDef = TRACK): THREE.Group {
  const group = new THREE.Group();
  const rand = mulberry32(20260907);
  const footprint = new TrackFootprint(track);

  // bounds of the world we decorate
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of track.samples) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z);
    maxZ = Math.max(maxZ, s.z);
  }
  const pad = 110;
  minX -= pad;
  maxX += pad;
  minZ -= pad;
  maxZ += pad;

  // ---- ground
  const groundTex = makeGrassTexture();
  groundTex.repeat.set(60, 60);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(maxX - minX + 600, maxZ - minZ + 600),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((minX + maxX) / 2, -0.9, (minZ + maxZ) / 2);
  ground.receiveShadow = true;
  group.add(ground);

  // ---- distant rolling hills
  const hillMat = new THREE.MeshStandardMaterial({ color: '#4f9a3d', roughness: 1 });
  for (let i = 0; i < 26; i++) {
    const angle = (i / 26) * Math.PI * 2 + rand() * 0.2;
    const radius = 330 + rand() * 120;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(60 + rand() * 80, 16, 10), hillMat);
    hill.scale.set(1.6 + rand(), 0.35 + rand() * 0.3, 1.2 + rand());
    hill.position.set((minX + maxX) / 2 + Math.cos(angle) * radius, -12, (minZ + maxZ) / 2 + Math.sin(angle) * radius);
    group.add(hill);
  }

  // ---- clouds
  const cloudMat = new THREE.MeshBasicMaterial({ color: '#f7fbff', transparent: true, opacity: 0.92 });
  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(rand() * 3);
    for (let p = 0; p < puffs; p++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(8 + rand() * 8, 10, 8), cloudMat);
      puff.position.set(p * 9 - puffs * 4, rand() * 3, rand() * 4);
      puff.scale.y = 0.6;
      cloud.add(puff);
    }
    cloud.position.set(minX + rand() * (maxX - minX), 70 + rand() * 30, minZ + rand() * (maxZ - minZ));
    group.add(cloud);
  }

  const place = (count: number, fn: (x: number, z: number, r: () => number) => void, minGap = 0): void => {
    let tries = 0;
    let placed = 0;
    const taken: Array<[number, number]> = [];
    while (placed < count && tries < count * 30) {
      tries++;
      const x = minX + rand() * (maxX - minX);
      const z = minZ + rand() * (maxZ - minZ);
      if (footprint.blocked(x, z)) continue;
      if (minGap > 0 && taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < minGap)) continue;
      taken.push([x, z]);
      fn(x, z, rand);
      placed++;
    }
  };

  // ---- trees (instanced trunks + canopies)
  const treeCount = 90;
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.8, 6, 7);
  const canopyGeo = new THREE.SphereGeometry(4.5, 10, 8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#7a4b2a', roughness: 1 });
  const canopyMat = new THREE.MeshStandardMaterial({ roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);
  trunks.castShadow = true;
  canopies.castShadow = true;
  let ti = 0;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  place(
    treeCount,
    (x, z, r) => {
      const scale = 0.8 + r() * 1.1;
      m.compose(new THREE.Vector3(x, 3 * scale - 0.9, z), q, new THREE.Vector3(scale, scale, scale));
      trunks.setMatrixAt(ti, m);
      m.compose(new THREE.Vector3(x, 7.5 * scale, z), q, new THREE.Vector3(scale, scale * (0.9 + r() * 0.4), scale));
      canopies.setMatrixAt(ti, m);
      canopies.setColorAt(ti, col.setHSL(0.28 + r() * 0.08, 0.55, 0.32 + r() * 0.12));
      ti++;
    },
    14,
  );
  trunks.count = ti;
  canopies.count = ti;
  group.add(trunks, canopies);

  // ---- giant mushrooms
  const shroomCount = 45;
  const stemGeo = new THREE.CylinderGeometry(0.9, 1.3, 4, 10);
  const capGeo = new THREE.SphereGeometry(3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const stemMat = new THREE.MeshStandardMaterial({ color: '#f3e9d2', roughness: 0.9 });
  const capMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  const stems = new THREE.InstancedMesh(stemGeo, stemMat, shroomCount);
  const caps = new THREE.InstancedMesh(capGeo, capMat, shroomCount);
  caps.castShadow = true;
  let si = 0;
  const capPalette = ['#ef476f', '#ff7b00', '#ffd166', '#b5179e', '#f25f5c'];
  place(
    shroomCount,
    (x, z, r) => {
      const scale = 0.5 + r() * 1.3;
      m.compose(new THREE.Vector3(x, 2 * scale - 0.2, z), q, new THREE.Vector3(scale, scale, scale));
      stems.setMatrixAt(si, m);
      m.compose(new THREE.Vector3(x, 3.8 * scale - 0.2, z), q, new THREE.Vector3(scale, scale * 0.8, scale));
      caps.setMatrixAt(si, m);
      caps.setColorAt(si, col.set(capPalette[Math.floor(r() * capPalette.length)]));
      si++;
    },
    9,
  );
  stems.count = si;
  caps.count = si;
  group.add(stems, caps);

  // ---- flowers
  const flowerCount = 260;
  const flowerStemGeo = new THREE.CylinderGeometry(0.08, 0.1, 2.2, 5);
  const petalGeo = new THREE.SphereGeometry(0.75, 8, 6);
  const flowerStems = new THREE.InstancedMesh(flowerStemGeo, new THREE.MeshStandardMaterial({ color: '#3f9a3a' }), flowerCount);
  const petals = new THREE.InstancedMesh(petalGeo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), flowerCount);
  let fi = 0;
  place(flowerCount, (x, z, r) => {
    const scale = 0.7 + r() * 1.2;
    m.compose(new THREE.Vector3(x, 1.1 * scale - 0.2, z), q, new THREE.Vector3(scale, scale, scale));
    flowerStems.setMatrixAt(fi, m);
    m.compose(new THREE.Vector3(x, 2.3 * scale - 0.2, z), q, new THREE.Vector3(scale, scale * 0.55, scale));
    petals.setMatrixAt(fi, m);
    petals.setColorAt(fi, col.setHSL(r(), 0.75, 0.6));
    fi++;
  });
  flowerStems.count = fi;
  petals.count = fi;
  group.add(flowerStems, petals);

  // ---- rocks
  const rockCount = 40;
  const rockGeo = new THREE.DodecahedronGeometry(1.4, 0);
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: '#8f8b86', roughness: 1 }), rockCount);
  rocks.castShadow = true;
  let ri = 0;
  place(rockCount, (x, z, r) => {
    const scale = 0.6 + r() * 1.8;
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
    m.compose(new THREE.Vector3(x, scale * 0.5 - 0.3, z), rot, new THREE.Vector3(scale, scale * 0.7, scale));
    rocks.setMatrixAt(ri, m);
    ri++;
  });
  rocks.count = ri;
  group.add(rocks);

  // ---- a giant watering can as a landmark near the hill
  const canMat = new THREE.MeshStandardMaterial({ color: '#4cc9f0', roughness: 0.4, metalness: 0.3 });
  const can = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(9, 10, 16, 18), canMat);
  body.position.y = 8;
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2, 18, 10), canMat);
  spout.position.set(12, 12, 0);
  spout.rotation.z = -0.9;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(6, 0.9, 8, 18, Math.PI), canMat);
  handle.position.set(-8, 14, 0);
  handle.rotation.z = Math.PI / 2;
  can.add(body, spout, handle);
  can.position.set(215, -0.2, -120);
  can.traverse((o) => {
    o.castShadow = true;
  });
  group.add(can);

  return group;
}

function makeGrassTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#5faa45';
  ctx.fillRect(0, 0, 256, 256);
  const rand = mulberry32(42);
  for (let i = 0; i < 1400; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    const r = 2 + rand() * 6;
    const shade = 0.85 + rand() * 0.3;
    ctx.fillStyle = `rgb(${Math.round(95 * shade)}, ${Math.round(170 * shade)}, ${Math.round(69 * shade)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.6, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
