import * as THREE from 'three';
import { ROAD_HALF_WIDTH, buildRoadMesh, buildStartLine, type Track } from './track';
import { valueNoise } from './noise';

/** Autumn farm world: terrain, sky, trees, windmill, barn, creek, leaves. */
export function buildWorld(scene: THREE.Scene, track: Track): { update: (t: number, dt: number) => void } {
  // ---- sky ----
  const skyGeo = new THREE.SphereGeometry(700, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x8fb7dd) },
      mid: { value: new THREE.Color(0xf2c98c) },
      bot: { value: new THREE.Color(0xe89a5d) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
      void main(){
        float h = normalize(vP).y;
        vec3 c = h > 0.18 ? mix(mid, top, smoothstep(0.18, 0.7, h)) : mix(bot, mid, smoothstep(-0.25, 0.18, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog(0xf0c48c, 180, 620);

  // ---- lights ----
  scene.add(new THREE.HemisphereLight(0xfff2d9, 0x6b7c3f, 1.05));
  const sun = new THREE.DirectionalLight(0xffe0b0, 1.5);
  sun.position.set(-180, 220, 120);
  scene.add(sun);

  // ---- terrain ----
  const SIZE = 680;
  const SEG = 110;
  const terrGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  terrGeo.rotateX(-Math.PI / 2);
  const pos = terrGeo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color(0x7ea34f);
  const cGrass2 = new THREE.Color(0x9cb45a);
  const cAutumn = new THREE.Color(0xc98a3b);
  const cSand = new THREE.Color(0xd9c489);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = track.terrainAt(x, z);
    pos.setY(i, h);
    const n = valueNoise(x * 0.03 + 40, z * 0.03 - 17);
    const col = cGrass.clone().lerp(cGrass2, n);
    if (n > 0.62) col.lerp(cAutumn, (n - 0.62) * 1.8);
    if (track.inCreek(x, z) > 0.3 && h < -1.5) col.lerp(cSand, 0.8);
    if (h > 5.5) col.lerp(cAutumn, Math.min((h - 5.5) / 6, 0.55));
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  terrGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrGeo.computeVertexNormals();
  const terr = new THREE.Mesh(terrGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(terr);

  // ---- creek water ----
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 62),
    new THREE.MeshBasicMaterial({ color: 0x59a7b8, transparent: true, opacity: 0.82 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(-6.5, -3.1, 106);
  scene.add(water);

  // ---- road ----
  scene.add(buildRoadMesh(track));
  scene.add(buildStartLine(track));

  // ---- helpers ----
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x8a5a30 });
  const woodLight = new THREE.MeshLambertMaterial({ color: 0xb9834a });

  // distance-to-road helper via coarse scan (build-time only)
  const distToRoad = (x: number, z: number): number => {
    let best = Infinity;
    for (let i = 0; i < track.samples.length; i += 3) {
      const sm = track.samples[i];
      if (!sm.road) continue;
      const d = Math.hypot(sm.x - x, sm.z - z) - ROAD_HALF_WIDTH;
      if (d < best) best = d;
    }
    return best;
  };

  // ---- trees (instanced) ----
  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.4, 2.2, 7);
  const canopyGeo = new THREE.IcosahedronGeometry(1.9, 0);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4423 });
  const canopyColors = [0xd97b29, 0xc9541f, 0xe0a33a, 0x8fae3c, 0xb8632a];
  const TREES = 170;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TREES);
  const canopies = new THREE.InstancedMesh(canopyGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), TREES);
  const dummy = new THREE.Object3D();
  const cColor = new THREE.Color();
  let placed = 0;
  let guard = 0;
  while (placed < TREES && guard++ < 4000) {
    const x = (Math.random() - 0.5) * 560;
    const z = (Math.random() - 0.5) * 560;
    if (distToRoad(x, z) < 7) continue;
    if (track.inCreek(x, z) > 0.15) continue;
    if (Math.hypot(x, z) > 300) continue;
    const h = track.terrainAt(x, z);
    if (h < -1.2) continue;
    const s = 0.8 + Math.random() * 1.1;
    dummy.position.set(x, h + 1.1 * s, z);
    dummy.scale.setScalar(s);
    dummy.rotation.y = Math.random() * Math.PI;
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);
    dummy.position.y = h + (2.6 + Math.random() * 0.7) * s;
    dummy.scale.set(s * (0.85 + Math.random() * 0.4), s * (0.9 + Math.random() * 0.5), s * (0.85 + Math.random() * 0.4));
    dummy.updateMatrix();
    canopies.setMatrixAt(placed, dummy.matrix);
    cColor.setHex(canopyColors[Math.floor(Math.random() * canopyColors.length)]);
    canopies.setColorAt(placed, cColor);
    placed++;
  }
  trunks.count = placed;
  canopies.count = placed;
  scene.add(trunks, canopies);

  // ---- pumpkins in the infield ----
  const pumpkinGeo = new THREE.SphereGeometry(0.55, 10, 8);
  const pumpkinMat = new THREE.MeshLambertMaterial({ color: 0xe07b28 });
  const pumpkins = new THREE.InstancedMesh(pumpkinGeo, pumpkinMat, 46);
  let pp = 0;
  guard = 0;
  while (pp < 46 && guard++ < 800) {
    const x = (Math.random() - 0.5) * 220;
    const z = (Math.random() - 0.5) * 200 - 40;
    if (distToRoad(x, z) < 8) continue;
    const h = track.terrainAt(x, z);
    if (h < 0.5) continue;
    dummy.position.set(x, h + 0.35, z);
    dummy.scale.setScalar(0.7 + Math.random() * 0.9);
    dummy.rotation.set(0, Math.random() * 3, 0);
    dummy.updateMatrix();
    pumpkins.setMatrixAt(pp++, dummy.matrix);
  }
  pumpkins.count = pp;
  scene.add(pumpkins);

  // ---- barn ----
  const barn = new THREE.Group();
  const barnBody = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 10), new THREE.MeshLambertMaterial({ color: 0xb04a32 }));
  barnBody.position.y = 4;
  barn.add(barnBody);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 7.6, 5.4, 4, 1), new THREE.MeshLambertMaterial({ color: 0x7c3b22 }));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1.05, 1, 0.78);
  roof.position.y = 10.2;
  barn.add(roof);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(4, 5), new THREE.MeshLambertMaterial({ color: 0xf2e3c2 }));
  door.position.set(0, 2.5, 5.01);
  barn.add(door);
  const barnX = -20;
  const barnZ = -60;
  barn.position.set(barnX, track.terrainAt(barnX, barnZ), barnZ);
  barn.rotation.y = 0.7;
  scene.add(barn);

  // ---- windmill beside the overpass ----
  const mill = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.7, 11, 10), new THREE.MeshLambertMaterial({ color: 0xd8cbb2 }));
  tower.position.y = 5.5;
  mill.add(tower);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2, 10), new THREE.MeshLambertMaterial({ color: 0x8a4a2a }));
  cap.position.y = 12;
  mill.add(cap);
  const blades = new THREE.Group();
  const bladeGeo = new THREE.BoxGeometry(0.5, 7.5, 0.12);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(bladeGeo, woodLight);
    b.position.y = 3.75;
    const holder = new THREE.Group();
    holder.rotation.z = (i * Math.PI) / 2;
    holder.add(b);
    blades.add(holder);
  }
  blades.position.set(0, 10.6, 1.9);
  mill.add(blades);
  const millX = -44;
  const millZ = -26;
  mill.position.set(millX, track.terrainAt(millX, millZ) - 0.4, millZ);
  scene.add(mill);

  // ---- bridge pillars wherever the road floats ----
  const pillarGeo = new THREE.CylinderGeometry(0.55, 0.75, 1, 8);
  const pillarMats: THREE.Matrix4[] = [];
  for (let i = 0; i < track.samples.length; i += 16) {
    const sm = track.samples[i];
    if (!sm.road) continue;
    const base = track.terrainAt(sm.x, sm.z);
    if (sm.y - base < 2.4) continue;
    const px = -sm.tz;
    const pz = sm.tx;
    for (const side of [-1, 1]) {
      const ox = sm.x + px * side * (ROAD_HALF_WIDTH + 0.8);
      const oz = sm.z + pz * side * (ROAD_HALF_WIDTH + 0.8);
      const ob = track.terrainAt(ox, oz);
      // skip pillars that would land on another part of the track
      let onRoad = false;
      for (let j = 0; j < track.samples.length; j += 2) {
        const sm2 = track.samples[j];
        if (!sm2.road || Math.abs(sm2.y - sm.y) < 2.5) continue;
        const dx = ox - sm2.x;
        const dz = oz - sm2.z;
        if (
          Math.abs(dx * sm2.tz - dz * sm2.tx) < ROAD_HALF_WIDTH + 1.4 &&
          Math.abs(dx * sm2.tx + dz * sm2.tz) < 2
        ) {
          onRoad = true;
          break;
        }
      }
      if (onRoad) continue;
      const height = Math.max(sm.y - ob, 0.6);
      const m = new THREE.Matrix4();
      m.compose(
        new THREE.Vector3(ox, ob + height / 2, oz),
        new THREE.Quaternion(),
        new THREE.Vector3(1, height, 1)
      );
      pillarMats.push(m);
    }
  }
  const pillarMesh = new THREE.InstancedMesh(pillarGeo, woodMat, Math.max(pillarMats.length, 1));
  pillarMats.forEach((m, i) => pillarMesh.setMatrixAt(i, m));
  pillarMesh.count = pillarMats.length;
  scene.add(pillarMesh);

  // ---- fence posts along the start straight ----
  const fenceGeo = new THREE.BoxGeometry(0.16, 1.1, 0.16);
  const fenceMats: THREE.Matrix4[] = [];
  for (let i = 0; i < 26; i++) {
    const x = -62 + i * 5;
    for (const z of [-7.4, 7.4]) {
      const h = track.terrainAt(x, z);
      const m = new THREE.Matrix4();
      m.compose(new THREE.Vector3(x, h + 0.55, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      fenceMats.push(m);
    }
  }
  const fenceMesh = new THREE.InstancedMesh(fenceGeo, woodLight, fenceMats.length);
  fenceMats.forEach((m, i) => fenceMesh.setMatrixAt(i, m));
  scene.add(fenceMesh);

  // ---- distant hills ----
  const hillGeo = new THREE.ConeGeometry(90, 60, 7);
  const hillMat = new THREE.MeshLambertMaterial({ color: 0x9a7b52 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const hill = new THREE.Mesh(hillGeo, hillMat);
    hill.position.set(Math.cos(a) * 480, 8, Math.sin(a) * 480);
    hill.scale.setScalar(0.7 + ((i * 37) % 10) / 14);
    scene.add(hill);
  }

  // ---- clouds ----
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xfff4e0, transparent: true, opacity: 0.85, fog: false });
  const clouds: THREE.Mesh[] = [];
  for (let i = 0; i < 9; i++) {
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(9 + (i % 3) * 4, 8, 6), cloudMat);
    cloud.scale.y = 0.4;
    cloud.position.set((Math.random() - 0.5) * 700, 90 + Math.random() * 60, (Math.random() - 0.5) * 700);
    scene.add(cloud);
    clouds.push(cloud);
  }

  // ---- falling leaves ----
  const LEAVES = 140;
  const leafPos = new Float32Array(LEAVES * 3);
  const leafSeed = new Float32Array(LEAVES * 2);
  for (let i = 0; i < LEAVES; i++) {
    leafPos[i * 3] = (Math.random() - 0.5) * 300;
    leafPos[i * 3 + 1] = 4 + Math.random() * 26;
    leafPos[i * 3 + 2] = (Math.random() - 0.5) * 300;
    leafSeed[i * 2] = Math.random() * Math.PI * 2;
    leafSeed[i * 2 + 1] = 0.5 + Math.random();
  }
  const leafGeo = new THREE.BufferGeometry();
  leafGeo.setAttribute('position', new THREE.BufferAttribute(leafPos, 3));
  const leafColors = new Float32Array(LEAVES * 3);
  const lc = new THREE.Color();
  for (let i = 0; i < LEAVES; i++) {
    lc.setHex(canopyColors[i % canopyColors.length]);
    leafColors[i * 3] = lc.r;
    leafColors[i * 3 + 1] = lc.g;
    leafColors[i * 3 + 2] = lc.b;
  }
  leafGeo.setAttribute('color', new THREE.BufferAttribute(leafColors, 3));
  const leafMat = new THREE.PointsMaterial({ size: 0.5, vertexColors: true, sizeAttenuation: true });
  const leaves = new THREE.Points(leafGeo, leafMat);
  scene.add(leaves);

  function update(time: number, dt: number): void {
    blades.rotation.z += 1.4 * dt;
    for (const c of clouds) {
      c.position.x += dt * 1.2;
      if (c.position.x > 380) c.position.x = -380;
    }
    const p = leafGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < LEAVES; i++) {
      let y = p.getY(i) - dt * (1.1 + leafSeed[i * 2 + 1]);
      const x = p.getX(i) + Math.sin(time * 0.001 + leafSeed[i * 2]) * dt * 1.6;
      const z = p.getZ(i) + Math.cos(time * 0.0013 + leafSeed[i * 2]) * dt * 1.2;
      if (y < 0) {
        y = 24 + Math.random() * 8;
        p.setX(i, (Math.random() - 0.5) * 300);
        p.setZ(i, (Math.random() - 0.5) * 300);
      }
      p.setY(i, y);
      p.setX(i, x);
      p.setZ(i, z);
    }
    p.needsUpdate = true;
  }

  return { update };
}
