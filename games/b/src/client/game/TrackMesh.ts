import * as THREE from 'three';
import { TRACK, type TrackDef, type TrackSample } from '../../shared/track.ts';

/** Accumulates coloured triangles for a single BufferGeometry. */
class MeshBuilder {
  positions: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];
  private c = new THREE.Color();

  quad(
    a: THREE.Vector3Like,
    b: THREE.Vector3Like,
    c: THREE.Vector3Like,
    d: THREE.Vector3Like,
    color: THREE.ColorRepresentation,
    uv?: [number, number, number, number],
  ): void {
    // a-b along the far edge (left to right), d-c along the near edge.  Emitted
    // as (a, c, b) + (a, d, c) so the face normal points up (+y) for a road
    // quad, i.e. towards the side the racers see.
    this.tri(a, c, b, color, uv ? [uv[0], uv[1], uv[2], uv[3], uv[2], uv[1]] : undefined);
    this.tri(a, d, c, color, uv ? [uv[0], uv[1], uv[0], uv[3], uv[2], uv[3]] : undefined);
  }

  tri(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, color: THREE.ColorRepresentation, uv?: number[]): void {
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.c.set(color);
    for (let i = 0; i < 3; i++) this.colors.push(this.c.r, this.c.g, this.c.b);
    if (uv) this.uvs.push(...uv);
    else this.uvs.push(0, 0, 1, 0, 1, 1);
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geo.computeVertexNormals();
    return geo;
  }
}

export interface BridgeZone {
  fromS: number;
  toS: number;
}

/** Finds the stretch of elevated track that passes over a lower stretch. */
export function findBridgeZone(track: TrackDef): BridgeZone | null {
  let min = Infinity;
  let max = -Infinity;
  for (const a of track.samples) {
    if (a.y < 5) continue;
    for (const b of track.samples) {
      if (b.y > a.y - 5) continue;
      if (Math.hypot(a.x - b.x, a.z - b.z) < track.shoulderHalfWidth + 6) {
        min = Math.min(min, a.s);
        max = Math.max(max, a.s);
      }
    }
  }
  if (!Number.isFinite(min)) return null;
  return { fromS: min - 26, toS: max + 26 };
}

const ROAD_THICKNESS = 0.7;

function edgePoint(s: TrackSample, lateral: number, up = 0): THREE.Vector3 {
  return new THREE.Vector3(s.x + s.rx * lateral, s.y + up, s.z + s.rz * lateral);
}

export interface TrackVisual {
  group: THREE.Group;
  boostPadMaterial: THREE.MeshBasicMaterial;
  bridgeZone: BridgeZone | null;
}

export function buildTrackMesh(track: TrackDef = TRACK): TrackVisual {
  const group = new THREE.Group();
  const S = track.samples;
  const n = S.length;
  const hw = track.halfWidth;
  const sw = track.shoulderHalfWidth;
  const bridge = findBridgeZone(track);
  const inBridge = (s: number) => bridge !== null && s >= bridge.fromS && s <= bridge.toS;

  const road = new MeshBuilder();
  const sides = new MeshBuilder();
  const skirt = new MeshBuilder();
  const hedge = new MeshBuilder();

  const asphalt = new THREE.Color('#5d5a66');
  const asphaltAlt = new THREE.Color('#57545f');
  const curbA = new THREE.Color('#f25f5c');
  const curbB = new THREE.Color('#fffaf0');
  const shoulderCol = new THREE.Color('#8a6a3d');
  const shoulderAlt = new THREE.Color('#7f6238');
  const underside = new THREE.Color('#3b3841');
  const finishA = new THREE.Color('#111111');
  const finishB = new THREE.Color('#f5f5f5');
  const grassTop = new THREE.Color('#5aa63a');
  const grassBottom = new THREE.Color('#3f7d2a');
  const hedgeCol = new THREE.Color('#1f5c33');
  const hedgeTop = new THREE.Color('#2f7a44');
  const bridgeDeck = new THREE.Color('#7d5a3a');
  const bridgeDeckAlt = new THREE.Color('#74533a');
  const rampYellow = new THREE.Color('#f2c14e');
  const rampBlack = new THREE.Color('#2b2724');

  const rampStart = track.gaps[0] ? track.gaps[0].from - 14 : -1;

  for (let i = 0; i < n; i++) {
    const a = S[i];
    const b = S[(i + 1) % n];
    if (a.gap || b.gap) continue; // no floor here
    const onBridge = inBridge(a.s);
    const onRamp = rampStart >= 0 && a.s >= rampStart && a.s <= track.gaps[0].to;
    const stripe = Math.floor(a.s / 4) % 2 === 0;
    let roadCol: THREE.Color = stripe ? asphalt : asphaltAlt;
    if (onBridge) roadCol = stripe ? bridgeDeck : bridgeDeckAlt;

    const finishBand = i < 3 || i >= n - 1;
    if (finishBand) {
      // checkered finish line: 8 squares across
      const cells = 8;
      for (let c = 0; c < cells; c++) {
        const l0 = -hw + (c / cells) * hw * 2;
        const l1 = -hw + ((c + 1) / cells) * hw * 2;
        const col = (c + i) % 2 === 0 ? finishA : finishB;
        road.quad(edgePoint(b, l0), edgePoint(b, l1), edgePoint(a, l1), edgePoint(a, l0), col);
      }
    } else {
      if (onRamp) {
        // the bumblebee ramp: bold yellow/black chevron stripes so the jump is unmistakable
        const stripes = 6;
        for (let c = 0; c < stripes; c++) {
          const l0 = -hw + 0.6 + (c / stripes) * (hw * 2 - 1.2);
          const l1 = -hw + 0.6 + ((c + 1) / stripes) * (hw * 2 - 1.2);
          const col = (c + Math.floor(a.s / 2)) % 2 === 0 ? rampYellow : rampBlack;
          road.quad(edgePoint(b, l0), edgePoint(b, l1), edgePoint(a, l1), edgePoint(a, l0), col);
        }
      } else {
        road.quad(edgePoint(b, -hw + 0.6), edgePoint(b, hw - 0.6), edgePoint(a, hw - 0.6), edgePoint(a, -hw + 0.6), roadCol);
      }
      // curbs
      const curb = Math.floor(a.s / 3) % 2 === 0 ? curbA : curbB;
      road.quad(edgePoint(b, -hw), edgePoint(b, -hw + 0.6), edgePoint(a, -hw + 0.6), edgePoint(a, -hw), curb);
      road.quad(edgePoint(b, hw - 0.6), edgePoint(b, hw), edgePoint(a, hw), edgePoint(a, hw - 0.6), curb);
    }
    // shoulders (soil flower beds)
    const shCol = stripe ? shoulderCol : shoulderAlt;
    road.quad(edgePoint(b, -sw), edgePoint(b, -hw), edgePoint(a, -hw), edgePoint(a, -sw), shCol);
    road.quad(edgePoint(b, hw), edgePoint(b, sw), edgePoint(a, sw), edgePoint(a, hw), shCol);

    // underside + side faces so the bridge and ramps read as solid slabs
    const ua = edgePoint(a, -sw, -ROAD_THICKNESS);
    const ub = edgePoint(a, sw, -ROAD_THICKNESS);
    const uc = edgePoint(b, sw, -ROAD_THICKNESS);
    const ud = edgePoint(b, -sw, -ROAD_THICKNESS);
    sides.quad(ua, ub, uc, ud, underside);
    sides.quad(edgePoint(a, -sw), edgePoint(b, -sw), ud, ua, underside);
    sides.quad(edgePoint(b, sw), edgePoint(a, sw), ub, uc, underside);

    // embankment down to the ground (not under the bridge span)
    if (!onBridge && a.y > -0.5) {
      const spread = 1.35;
      for (const side of [-1, 1]) {
        const topA = edgePoint(a, side * sw, -ROAD_THICKNESS);
        const topB = edgePoint(b, side * sw, -ROAD_THICKNESS);
        const ha = Math.max(0, a.y + 0.9);
        const hb = Math.max(0, b.y + 0.9);
        const botA = new THREE.Vector3(a.x + a.rx * side * (sw + ha * spread), -0.95, a.z + a.rz * side * (sw + ha * spread));
        const botB = new THREE.Vector3(b.x + b.rx * side * (sw + hb * spread), -0.95, b.z + b.rz * side * (sw + hb * spread));
        if (side < 0) skirt.quad(topA, topB, botB, botA, grassTop);
        else skirt.quad(topB, topA, botA, botB, grassTop);
        // a darker lower band gives the slope some depth
        void grassBottom;
      }
    }

    // hedges on closed edges (bridge gets railings instead)
    if (!a.open && !onBridge) {
      const h = 1.1;
      for (const side of [-1, 1]) {
        const inner = side * (sw + 0.15);
        const outer = side * (sw + 0.95);
        const iA = edgePoint(a, inner);
        const iB = edgePoint(b, inner);
        const oA = edgePoint(a, outer);
        const oB = edgePoint(b, outer);
        const iAt = edgePoint(a, inner, h);
        const iBt = edgePoint(b, inner, h);
        const oAt = edgePoint(a, outer, h);
        const oBt = edgePoint(b, outer, h);
        const c = Math.floor(a.s / 2) % 2 === 0 ? hedgeCol : hedgeCol.clone().offsetHSL(0, 0, 0.03);
        if (side < 0) {
          hedge.quad(iAt, iBt, iB, iA, c); // inner wall
          hedge.quad(oBt, oAt, oA, oB, c); // outer wall
          hedge.quad(oAt, oBt, iBt, iAt, hedgeTop);
        } else {
          hedge.quad(iBt, iAt, iA, iB, c);
          hedge.quad(oAt, oBt, oB, oA, c);
          hedge.quad(iAt, iBt, oBt, oAt, hedgeTop);
        }
      }
    }
  }

  // Double-sided so no track surface can ever be culled, whatever the local winding.
  const roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const roadMesh = new THREE.Mesh(road.build(), roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  const sideMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(sides.build(), sideMat));

  const skirtMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  const skirtMesh = new THREE.Mesh(skirt.build(), skirtMat);
  skirtMesh.receiveShadow = true;
  group.add(skirtMesh);

  const hedgeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  const hedgeMesh = new THREE.Mesh(hedge.build(), hedgeMat);
  hedgeMesh.castShadow = true;
  group.add(hedgeMesh);

  // ---- bridge: pillars + railings (a garden hose slung across the straight)
  if (bridge) {
    const pillarMat = new THREE.MeshStandardMaterial({ color: '#a97c50', roughness: 0.8 });
    const railMat = new THREE.MeshStandardMaterial({ color: '#f2c14e', roughness: 0.5 });
    const postMat = new THREE.MeshStandardMaterial({ color: '#8d5a2b', roughness: 0.7 });
    let lastPillarS = -Infinity;
    let lastPostS = -Infinity;
    const railPts: THREE.Vector3[][] = [[], []];
    for (const s of S) {
      if (!inBridge(s.s)) continue;
      // pillars every 12 m, only where the ground below is free of the lower road
      if (s.s - lastPillarS >= 12) {
        lastPillarS = s.s;
        const clear = !S.some((o) => o.y < s.y - 4 && Math.hypot(o.x - s.x, o.z - s.z) < sw + 3);
        if (clear) {
          for (const side of [-1, 1]) {
            const p = edgePoint(s, side * (hw - 1));
            const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, s.y, 10), pillarMat);
            pillar.position.set(p.x, s.y / 2 - ROAD_THICKNESS, p.z);
            pillar.castShadow = true;
            group.add(pillar);
          }
        }
      }
      if (s.s - lastPostS >= 3) {
        lastPostS = s.s;
        for (const side of [-1, 1]) {
          const p = edgePoint(s, side * (sw + 0.3), 0.7);
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.4, 0.22), postMat);
          post.position.copy(p);
          group.add(post);
        }
      }
      railPts[0].push(edgePoint(s, -(sw + 0.3), 1.35));
      railPts[1].push(edgePoint(s, sw + 0.3, 1.35));
    }
    for (const pts of railPts) {
      if (pts.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length, 0.12, 8, false), railMat);
      group.add(tube);
    }
  }

  // ---- finish gate
  const start = S[0];
  const gateMat = new THREE.MeshStandardMaterial({ color: '#f2c14e', roughness: 0.5 });
  // front faces only: the second plane below shows the readable text from behind
  const bannerMat = new THREE.MeshBasicMaterial({ map: makeBannerTexture('FINISH'), side: THREE.FrontSide });
  for (const side of [-1, 1]) {
    const p = edgePoint(start, side * (sw + 0.6));
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 7.5, 12), gateMat);
    post.position.set(p.x, start.y + 3.75, p.z);
    post.castShadow = true;
    group.add(post);
  }
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(sw * 2 + 1.2, 1.8), bannerMat);
  const centre = edgePoint(start, 0, 6.8);
  banner.position.copy(centre);
  banner.rotation.y = Math.atan2(start.tx, start.tz);
  banner.scale.x = -1; // readable for racers approaching the line
  group.add(banner);
  const bannerBack = banner.clone();
  bannerBack.rotation.y += Math.PI;
  bannerBack.scale.x = 1; // readable from behind the gate
  group.add(bannerBack);

  // ---- checkpoint bunting (small flags on both sides so racers know where the sectors are)
  const flagMat = new THREE.MeshStandardMaterial({ color: '#4cc9f0', roughness: 0.6, side: THREE.DoubleSide });
  const poleMat = new THREE.MeshStandardMaterial({ color: '#f1e9d2' });
  for (const cp of track.checkpoints) {
    if (cp.index === 0) continue;
    const s = S[cp.index];
    for (const side of [-1, 1]) {
      const p = edgePoint(s, side * (sw + 1.6));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 6), poleMat);
      pole.position.set(p.x, s.y + 1.6, p.z);
      group.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), flagMat);
      flag.position.set(p.x + s.tx * 0.55, s.y + 2.85, p.z + s.tz * 0.55);
      flag.rotation.y = Math.atan2(s.rx, s.rz);
      group.add(flag);
    }
  }

  // ---- boost pads (animated chevrons)
  const padTex = makeChevronTexture();
  const boostPadMaterial = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const pads = new MeshBuilder();
  for (let i = 0; i < n; i++) {
    const a = S[i];
    const b = S[(i + 1) % n];
    if (!a.boost || !b.boost) continue;
    const w = hw - 1.2;
    const v0 = a.s / 4;
    const v1 = b.s / 4;
    pads.quad(edgePoint(b, -w, 0.06), edgePoint(b, w, 0.06), edgePoint(a, w, 0.06), edgePoint(a, -w, 0.06), '#ffffff', [
      0,
      v1,
      1,
      v0,
    ]);
  }
  const padMesh = new THREE.Mesh(pads.build(), boostPadMaterial);
  group.add(padMesh);

  return { group, boostPadMaterial, bridgeZone: bridge };
}

function makeBannerTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const cell = 32;
  for (let x = 0; x < canvas.width / cell; x++) {
    for (let y = 0; y < canvas.height / cell; y++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#111' : '#f5f5f5';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  ctx.fillStyle = 'rgba(255, 183, 3, 0.95)';
  ctx.fillRect(220, 14, 584, 100);
  ctx.fillStyle = '#1d1d1b';
  ctx.font = 'bold 84px "Trebuchet MS", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 512, 66);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeChevronTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(255, 140, 0, 0.55)';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#fff3b0';
  ctx.beginPath();
  ctx.moveTo(10, 90);
  ctx.lineTo(64, 30);
  ctx.lineTo(118, 90);
  ctx.lineTo(118, 118);
  ctx.lineTo(64, 60);
  ctx.lineTo(10, 118);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
