// Static world: volcano island, track ribbon, bridge, jump gap, lava, decor.
import * as THREE from "three";
import {
  JUMP,
  NUM_SAMPLES,
  SAMPLES,
  TRACK_HALF_WIDTH,
  checkpointT,
} from "../shared/track.js";

export interface WorldHandles {
  scene: THREE.Scene;
  lavaTex: THREE.CanvasTexture;
  clouds: THREE.Group;
  smoke: THREE.Points;
  smokeVel: Float32Array;
  finishLineZ: number;
  update: (elapsed: number, dt: number) => void;
}

function lavaTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#c22e00";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const r = 2 + Math.random() * 7;
    g.fillStyle = Math.random() < 0.5 ? "#ff7a1e" : "#ffd23e";
    g.globalAlpha = 0.25 + Math.random() * 0.5;
    g.beginPath();
    g.arc(Math.random() * 256, Math.random() * 256, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function bannerTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1d1005";
  g.fillRect(0, 0, 1024, 128);
  g.strokeStyle = "#ff7a1e";
  g.lineWidth = 8;
  g.strokeRect(6, 6, 1012, 116);
  g.fillStyle = "#ffd23e";
  g.font = "bold 64px Trebuchet MS, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 512, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const STEP = 2;
const SEG_COUNT = NUM_SAMPLES / STEP;

function tOfSeg(i: number): number {
  return (i * STEP) / NUM_SAMPLES;
}

function inGapT(t: number): boolean {
  return t >= JUMP.gapT0 && t <= JUMP.gapT1;
}

export function buildWorld(scene: THREE.Scene): WorldHandles {
  // ---- sky / fog / lights ----
  scene.background = new THREE.Color(0x2a1a3e);
  scene.fog = new THREE.Fog(0x2a1a3e, 160, 520);

  const hemi = new THREE.HemisphereLight(0xffd9b0, 0x401f2b, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb36b, 1.7);
  sun.position.set(90, 130, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -130;
  sun.shadow.camera.right = 130;
  sun.shadow.camera.top = 130;
  sun.shadow.camera.bottom = -130;
  sun.shadow.camera.far = 400;
  scene.add(sun);

  // low sunset sun disc
  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(18, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd23e, fog: false }),
  );
  sunDisc.position.set(-260, 40, 180);
  scene.add(sunDisc);

  // ---- lava sea ----
  const lavaTex = lavaTexture();
  const lava = new THREE.Mesh(
    new THREE.PlaneGeometry(760, 760),
    new THREE.MeshBasicMaterial({ map: lavaTex }),
  );
  lava.rotation.x = -Math.PI / 2;
  lava.position.y = -3;
  scene.add(lava);

  // ---- island discs ----
  const sand = new THREE.Mesh(
    new THREE.CircleGeometry(1, 72),
    new THREE.MeshStandardMaterial({ color: 0x9c7040, roughness: 1 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.scale.set(108, 82, 1);
  sand.position.y = -0.6;
  sand.receiveShadow = true;
  scene.add(sand);

  const rockBase = new THREE.Mesh(
    new THREE.CircleGeometry(1, 72),
    new THREE.MeshStandardMaterial({ color: 0x4a2c22, roughness: 1 }),
  );
  rockBase.rotation.x = -Math.PI / 2;
  rockBase.scale.set(122, 96, 1);
  rockBase.position.y = -2.6;
  scene.add(rockBase);

  // ---- volcano ----
  const volcano = new THREE.Mesh(
    new THREE.ConeGeometry(26, 24, 24),
    new THREE.MeshStandardMaterial({ color: 0x5a4a52, roughness: 1, flatShading: true }),
  );
  volcano.position.set(-30, 11.4, -5);
  volcano.castShadow = true;
  scene.add(volcano);
  const crater = new THREE.Mesh(
    new THREE.CircleGeometry(7, 24),
    new THREE.MeshBasicMaterial({ color: 0xff5a1e }),
  );
  crater.rotation.x = -Math.PI / 2;
  crater.position.set(-30, 23.2, -5);
  scene.add(crater);
  const craterLight = new THREE.PointLight(0xff5a1e, 900, 120, 1.8);
  craterLight.position.set(-30, 26, -5);
  scene.add(craterLight);

  // smoke particles
  const SMOKE_N = 60;
  const smokePos = new Float32Array(SMOKE_N * 3);
  const smokeVel = new Float32Array(SMOKE_N);
  for (let i = 0; i < SMOKE_N; i++) {
    smokePos[i * 3] = -30 + (Math.random() - 0.5) * 8;
    smokePos[i * 3 + 1] = 24 + Math.random() * 30;
    smokePos[i * 3 + 2] = -5 + (Math.random() - 0.5) * 8;
    smokeVel[i] = 2 + Math.random() * 3;
  }
  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute("position", new THREE.BufferAttribute(smokePos, 3));
  const smoke = new THREE.Points(
    smokeGeo,
    new THREE.PointsMaterial({ color: 0x8a8a9a, size: 3.2, transparent: true, opacity: 0.55 }),
  );
  scene.add(smoke);

  // ---- track ribbon ----
  const roadGeo = new THREE.BufferGeometry();
  const verts: number[] = [];
  const colors: number[] = [];
  const idx: number[] = [];
  const asphalt = new THREE.Color(0x3d3d48);
  const asphalt2 = new THREE.Color(0x35353f);
  const startA = new THREE.Color(0xf2ede2);
  const startB = new THREE.Color(0x1c1c22);
  const rampC = new THREE.Color(0xb3541e);
  let vi = 0;
  const cumLen: number[] = [0];
  for (let i = 1; i <= SEG_COUNT; i++) {
    const a = SAMPLES[((i - 1) * STEP) % NUM_SAMPLES];
    const b = SAMPLES[(i * STEP) % NUM_SAMPLES];
    cumLen.push(cumLen[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  for (let i = 0; i < SEG_COUNT; i++) {
    const t = tOfSeg(i);
    if (inGapT(t)) continue; // the lava gap: no road surface
    const s = SAMPLES[i * STEP];
    const rx = -s.dz;
    const rz = s.dx;
    const hw = TRACK_HALF_WIDTH;
    verts.push(s.x + rx * hw, s.y, s.z + rz * hw);
    verts.push(s.x - rx * hw, s.y, s.z - rz * hw);
    const nearStart = t < 0.006 || t > 0.994;
    const onRamp = t >= JUMP.rampT0 && t <= JUMP.gapT0;
    let c: THREE.Color;
    if (nearStart) c = Math.floor(i / 2) % 2 === 0 ? startA : startB;
    else if (onRamp) c = rampC;
    else c = Math.floor(cumLen[i] / 8) % 2 === 0 ? asphalt : asphalt2;
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    void vi;
  }
  // Build index over consecutive kept quads — simpler: rebuild walk of kept segments
  const kept: number[] = [];
  for (let i = 0; i < SEG_COUNT; i++) if (!inGapT(tOfSeg(i))) kept.push(i);
  const remap = new Map<number, number>();
  kept.forEach((seg, k) => remap.set(seg, k));
  for (let k = 0; k < kept.length; k++) {
    const cur = kept[k];
    const nxt = kept[(k + 1) % kept.length];
    const consecutive =
      nxt === (cur + 1) % SEG_COUNT || (cur === kept[kept.length - 1] && nxt === kept[0]);
    if (!consecutive) continue; // don't stitch across the gap
    const a0 = remap.get(cur)! * 2;
    const b0 = remap.get(nxt)! * 2;
    idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
  }
  roadGeo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  roadGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  roadGeo.setIndex(idx);
  roadGeo.computeVertexNormals();
  const road = new THREE.Mesh(
    roadGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
  );
  road.receiveShadow = true;
  scene.add(road);

  // ---- curbs (red/white strips) ----
  function curbSide(side: 1 | -1): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    const v: number[] = [];
    const col: number[] = [];
    const index: number[] = [];
    const red = new THREE.Color(0xd23b2e);
    const white = new THREE.Color(0xf2ede2);
    let row = 0;
    const rows: number[] = [];
    for (let i = 0; i < SEG_COUNT; i++) {
      const t = tOfSeg(i);
      if (inGapT(t)) continue;
      const s = SAMPLES[i * STEP];
      const rx = -s.dz * side;
      const rz = s.dx * side;
      const hw = TRACK_HALF_WIDTH;
      v.push(s.x + rx * hw, s.y + 0.07, s.z + rz * hw);
      v.push(s.x + rx * (hw + 1.3), s.y + 0.07, s.z + rz * (hw + 1.3));
      const c = Math.floor(i / 3) % 2 === 0 ? red : white;
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      rows.push(i);
      row++;
    }
    for (let k = 0; k < rows.length; k++) {
      const cur = rows[k];
      const nxt = rows[(k + 1) % rows.length];
      const consecutive = nxt === (cur + 1) % SEG_COUNT || k === rows.length - 1;
      if (!consecutive && !(cur === rows[rows.length - 1] && nxt === rows[0])) continue;
      if (nxt !== (cur + 1) % SEG_COUNT) continue;
      const a0 = k * 2;
      const b0 = ((k + 1) % rows.length) * 2;
      if (side === 1) index.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
      else index.push(a0, a0 + 1, b0, b0, a0 + 1, b0 + 1);
    }
    void row;
    g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    const m = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
    );
    m.receiveShadow = true;
    return m;
  }
  scene.add(curbSide(1));
  scene.add(curbSide(-1));

  // ---- bridge railings + pillars (elevated t in [0.20, 0.44]) ----
  const railMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.8 });
  const railTopMat = new THREE.MeshStandardMaterial({
    color: 0xff7a1e,
    emissive: 0xff7a1e,
    emissiveIntensity: 0.7,
  });
  const railGeos: THREE.BufferGeometry[] = [];
  const postGeo = new THREE.BoxGeometry(0.35, 1.2, 0.35);
  const posts: THREE.Matrix4[] = [];
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < SEG_COUNT; i++) {
    const t = tOfSeg(i);
    if (t < 0.2 || t > 0.44) continue;
    if (inGapT(t)) continue;
    const s = SAMPLES[i * STEP];
    for (const side of [1, -1]) {
      const rx = -s.dz * side;
      const rz = s.dx * side;
      const hw = TRACK_HALF_WIDTH + 0.4;
      const px = s.x + rx * hw;
      const pz = s.z + rz * hw;
      m4.makeTranslation(px, s.y + 0.6, pz);
      posts.push(m4.clone());
      const top = new THREE.BoxGeometry(0.22, 0.22, 1);
      // rail segment toward next sample
      const n = SAMPLES[((i + 1) * STEP) % NUM_SAMPLES];
      const nx = n.x + -n.dz * side * hw;
      const nz = n.z + n.dx * side * hw;
      const len = Math.hypot(nx - px, nz - pz);
      if (len > 0.01 && len < 12) {
        const g = new THREE.BoxGeometry(0.22, 0.22, len + 0.3);
        g.translate(0, 0, 0);
        const yaw = Math.atan2(nx - px, nz - pz);
        const rot = new THREE.Matrix4().makeRotationY(yaw);
        const tr = new THREE.Matrix4().makeTranslation((px + nx) / 2, s.y + 1.2, (pz + nz) / 2);
        tr.multiply(rot);
        g.applyMatrix4(tr);
        railGeos.push(g);
      }
      void top;
    }
  }
  const postMesh = new THREE.InstancedMesh(postGeo, railMat, posts.length);
  posts.forEach((m, i) => postMesh.setMatrixAt(i, m));
  postMesh.castShadow = true;
  scene.add(postMesh);
  if (railGeos.length > 0) {
    // merge manually into one geometry via group of meshes is simpler; use a single merged BufferGeometry
    const merged = mergeGeometries(railGeos);
    const rails = new THREE.Mesh(merged, railTopMat);
    scene.add(rails);
  }
  for (const pt of [0.27, 0.31, 0.35, 0.39]) {
    const s = SAMPLES[Math.floor(pt * NUM_SAMPLES) % NUM_SAMPLES];
    const h = s.y + 0.6;
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.8, h, 10),
      new THREE.MeshStandardMaterial({ color: 0x3a2f3a, roughness: 1 }),
    );
    pillar.position.set(s.x, h / 2 - 0.6, s.z);
    pillar.castShadow = true;
    scene.add(pillar);
  }

  // ---- lava pool under the jump gap ----
  const gapMid = SAMPLES[Math.floor(((JUMP.gapT0 + JUMP.gapT1) / 2) * NUM_SAMPLES) % NUM_SAMPLES];
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(10, 28),
    new THREE.MeshBasicMaterial({ color: 0xff6a1e }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(gapMid.x, -2.7, gapMid.z);
  scene.add(pool);
  const gapLight = new THREE.PointLight(0xff7a1e, 600, 60, 1.8);
  gapLight.position.set(gapMid.x, 4, gapMid.z);
  scene.add(gapLight);

  // glowing gap edges
  for (const gt of [JUMP.gapT0, JUMP.gapT1]) {
    const s = SAMPLES[Math.floor(gt * NUM_SAMPLES) % NUM_SAMPLES];
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(TRACK_HALF_WIDTH * 2 + 2, 0.5, 1.2),
      new THREE.MeshStandardMaterial({
        color: 0xffd23e,
        emissive: 0xff7a1e,
        emissiveIntensity: 1.4,
      }),
    );
    edge.position.set(s.x, s.y + 0.1, s.z);
    edge.rotation.y = s.yaw;
    scene.add(edge);
  }

  // ---- start gantry ----
  const s0 = SAMPLES[0];
  const rx0 = -s0.dz;
  const rz0 = s0.dx;
  const postMat2 = new THREE.MeshStandardMaterial({ color: 0x2b2b33, roughness: 0.7 });
  for (const side of [1, -1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 9, 10), postMat2);
    post.position.set(s0.x + rx0 * side * (TRACK_HALF_WIDTH + 1.5), s0.y + 4.5, s0.z + rz0 * side * (TRACK_HALF_WIDTH + 1.5));
    post.castShadow = true;
    scene.add(post);
  }
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(TRACK_HALF_WIDTH * 2 + 4, 2.2, 0.6),
    new THREE.MeshStandardMaterial({ map: bannerTexture("🌋 CINDER PEAK RALLY"), emissive: 0xffffff, emissiveMap: bannerTexture("🌋 CINDER PEAK RALLY"), emissiveIntensity: 0.35 }),
  );
  banner.position.set(s0.x, s0.y + 8.4, s0.z);
  banner.rotation.y = s0.yaw + Math.PI / 2;
  scene.add(banner);

  // ---- trees & rocks (kept clear of the track) ----
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e8b4f, roughness: 1, flatShading: true });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6a6a72, roughness: 1, flatShading: true });
  function clearOfTrack(x: number, z: number, r: number): boolean {
    for (let i = 0; i < NUM_SAMPLES; i += 8) {
      const s = SAMPLES[i];
      if (Math.hypot(x - s.x, z - s.z) < r) return false;
    }
    return true;
  }
  let placed = 0;
  let guard = 0;
  while (placed < 26 && guard++ < 600) {
    const x = (Math.random() - 0.5) * 190;
    const z = (Math.random() - 0.5) * 140;
    if (Math.hypot(x + 30, z + 5) < 30) continue; // volcano
    if (!clearOfTrack(x, z, 13)) continue;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 4, 7), trunkMat);
    trunk.position.y = 2;
    trunk.castShadow = true;
    tree.add(trunk);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 0), leafMat);
    crown.position.y = 5.2;
    crown.castShadow = true;
    tree.add(crown);
    tree.position.set(x, -0.6, z);
    const sc = 0.8 + Math.random() * 0.9;
    tree.scale.setScalar(sc);
    scene.add(tree);
    placed++;
  }
  placed = 0;
  guard = 0;
  while (placed < 14 && guard++ < 400) {
    const x = (Math.random() - 0.5) * 200;
    const z = (Math.random() - 0.5) * 150;
    if (!clearOfTrack(x, z, 11)) continue;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1 + Math.random() * 2, 0), rockMat);
    rock.position.set(x, 0.2, z);
    rock.castShadow = true;
    scene.add(rock);
    placed++;
  }

  // ---- clouds ----
  const clouds = new THREE.Group();
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffd9c2, transparent: true, opacity: 0.75, fog: false });
  for (let i = 0; i < 9; i++) {
    const cl = new THREE.Group();
    for (let j = 0; j < 3; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(6 + Math.random() * 6, 12, 12), cloudMat);
      puff.position.set(j * 9 - 9, Math.random() * 2, Math.random() * 4);
      puff.scale.y = 0.45;
      cl.add(puff);
    }
    cl.position.set((Math.random() - 0.5) * 500, 90 + Math.random() * 40, (Math.random() - 0.5) * 500);
    clouds.add(cl);
  }
  scene.add(clouds);
  void checkpointT;

  return {
    scene,
    lavaTex,
    clouds,
    smoke,
    smokeVel,
    finishLineZ: 0,
    update: (elapsed: number, dt: number) => {
      lavaTex.offset.x = (elapsed * 0.008) % 1;
      lavaTex.offset.y = (elapsed * 0.005) % 1;
      clouds.rotation.y = elapsed * 0.004;
      const pos = smokeGeo.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < SMOKE_N; i++) {
        arr[i * 3 + 1] += smokeVel[i] * dt;
        if (arr[i * 3 + 1] > 58) {
          arr[i * 3 + 1] = 24;
          arr[i * 3] = -30 + (Math.random() - 0.5) * 8;
          arr[i * 3 + 2] = -5 + (Math.random() - 0.5) * 8;
        }
      }
      pos.needsUpdate = true;
      craterLight.intensity = 800 + Math.sin(elapsed * 3) * 200;
    },
  };
}

/** Minimal BufferGeometry merge (same attributes) to avoid an extra dependency. */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vCount = 0;
  let iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const norm = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const index = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    const u = g.attributes.uv as THREE.BufferAttribute;
    pos.set(p.array as Float32Array, vo * 3);
    if (n) norm.set(n.array as Float32Array, vo * 3);
    if (u) uv.set(u.array as Float32Array, vo * 2);
    if (g.index) {
      const gi = g.index.array as Uint32Array | Uint16Array;
      for (let k = 0; k < gi.length; k++) index[io + k] = gi[k] + vo;
      io += gi.length;
    } else {
      for (let k = 0; k < p.count; k++) index[io + k] = vo + k;
      io += p.count;
    }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(norm, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}
