import * as THREE from 'three';
import { trackCircuit, TRACK_WIDTH, HALF_WIDTH } from '../../shared/trackData.js';

export class TrackRenderer {
  public group: THREE.Group;
  private boostPadMaterials: THREE.MeshBasicMaterial[] = [];

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.buildRoadMesh();
    this.buildCurbsAndRails();
    this.buildOverpassPillars();
    this.buildJumpRampVisuals();
    this.buildBoostPads();
    this.buildStartFinishArch();
    this.buildCosmicEnvironment();
  }

  private createRoadTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // Dark asphalt base
    ctx.fillStyle = '#111222';
    ctx.fillRect(0, 0, 512, 512);

    // Subtle road texture noise
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }

    // Outer boundary neon lines
    ctx.fillStyle = '#00f3ff';
    ctx.fillRect(16, 0, 8, 512);
    ctx.fillRect(488, 0, 8, 512);

    // Center dashed white line
    ctx.fillStyle = '#ffffff';
    for (let y = 0; y < 512; y += 64) {
      ctx.fillRect(252, y, 8, 36);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 40);
    return texture;
  }

  private buildRoadMesh() {
    const samples = trackCircuit.samples;
    const numSamples = samples.length;

    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // Skip jump chasm gap (from sample 20 to 22)
    // To ensure physical visual gap at the jump!
    const jumpStartSample = Math.floor((20 / 30) * numSamples);
    const jumpEndSample = Math.floor((22 / 30) * numSamples);

    for (let i = 0; i < numSamples; i++) {
      const s = samples[i];
      const isChasm = i > jumpStartSample && i < jumpEndSample;

      // Left and right edges
      const lx = s.x - s.bx * HALF_WIDTH;
      const ly = isChasm ? -999 : s.y;
      const lz = s.z - s.bz * HALF_WIDTH;

      const rx = s.x + s.bx * HALF_WIDTH;
      const ry = isChasm ? -999 : s.y;
      const rz = s.z + s.bz * HALF_WIDTH;

      positions.push(lx, ly, lz);
      positions.push(rx, ry, rz);

      normals.push(s.nx, s.ny, s.nz);
      normals.push(s.nx, s.ny, s.nz);

      const v = s.distance / 20.0;
      uvs.push(0, v);
      uvs.push(1, v);
    }

    for (let i = 0; i < numSamples; i++) {
      const isChasm = (i >= jumpStartSample && i < jumpEndSample);
      if (isChasm) continue;

      const next = (i + 1) % numSamples;
      if (next === 0 && (i >= jumpStartSample && i < jumpEndSample)) continue;

      const i0 = i * 2;
      const i1 = i * 2 + 1;
      const i2 = next * 2;
      const i3 = next * 2 + 1;

      indices.push(i0, i2, i1);
      indices.push(i1, i2, i3);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    const material = new THREE.MeshStandardMaterial({
      map: this.createRoadTexture(),
      roughness: 0.6,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });

    const roadMesh = new THREE.Mesh(geometry, material);
    this.group.add(roadMesh);
  }

  private buildCurbsAndRails() {
    const samples = trackCircuit.samples;
    const numSamples = samples.length;

    const curbGeo = new THREE.BufferGeometry();
    const curbPos: number[] = [];
    const curbNorm: number[] = [];
    const curbColors: number[] = [];
    const curbIndices: number[] = [];

    const jumpStartSample = Math.floor((20 / 30) * numSamples);
    const jumpEndSample = Math.floor((22 / 30) * numSamples);

    for (let i = 0; i < numSamples; i++) {
      const s = samples[i];
      const isChasm = i > jumpStartSample && i < jumpEndSample;
      const yVal = isChasm ? -999 : s.y;

      // Left curb
      const l1x = s.x - s.bx * HALF_WIDTH;
      const l1z = s.z - s.bz * HALF_WIDTH;
      const l2x = s.x - s.bx * (HALF_WIDTH + 1.2);
      const l2z = s.z - s.bz * (HALF_WIDTH + 1.2);

      curbPos.push(l1x, yVal, l1z);
      curbPos.push(l2x, yVal + 0.15, l2z);

      // Alternating cyan/magenta curbs
      const colorAlt = Math.floor(s.distance / 3.0) % 2 === 0;
      const cr = colorAlt ? 0.0 : 1.0;
      const cg = colorAlt ? 0.95 : 0.0;
      const cb = colorAlt ? 1.0 : 0.66;

      curbColors.push(cr, cg, cb);
      curbColors.push(cr, cg, cb);

      curbNorm.push(s.nx, s.ny, s.nz);
      curbNorm.push(s.nx, s.ny, s.nz);
    }

    for (let i = 0; i < numSamples; i++) {
      if (i >= jumpStartSample && i < jumpEndSample) continue;
      const next = (i + 1) % numSamples;
      const i0 = i * 2;
      const i1 = i * 2 + 1;
      const i2 = next * 2;
      const i3 = next * 2 + 1;

      curbIndices.push(i0, i2, i1);
      curbIndices.push(i1, i2, i3);
    }

    curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(curbPos, 3));
    curbGeo.setAttribute('normal', new THREE.Float32BufferAttribute(curbNorm, 3));
    curbGeo.setAttribute('color', new THREE.Float32BufferAttribute(curbColors, 3));
    curbGeo.setIndex(curbIndices);

    const curbMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });

    const curbMesh = new THREE.Mesh(curbGeo, curbMat);
    this.group.add(curbMesh);
  }

  private buildOverpassPillars() {
    // Structural deck & pillars under the high bridge section
    // Overpass runs roughly at Point 9 through 12, elevation y = 14
    const pillarPositions = [
      { x: 35, z: -10 },
      { x: 15, z: -10 },
      { x: -15, z: -10 },
      { x: -35, z: -10 },
    ];

    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x1f2438,
      metalness: 0.8,
      roughness: 0.3,
    });

    const glowRingMat = new THREE.MeshBasicMaterial({
      color: 0x00f3ff,
      wireframe: true,
    });

    for (const pos of pillarPositions) {
      // Left and right support columns
      for (const side of [-1, 1]) {
        const pz = pos.z + side * (HALF_WIDTH + 1.0);
        const column = new THREE.Mesh(
          new THREE.CylinderGeometry(0.8, 1.2, 14, 12),
          pillarMat
        );
        column.position.set(pos.x, 7, pz);
        this.group.add(column);

        // Neon ring accents on pillars
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(1.3, 0.08, 8, 16),
          glowRingMat
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(pos.x, 7, pz);
        this.group.add(ring);
      }

      // Horizontal cross beam
      const crossBeam = new THREE.Mesh(
        new THREE.BoxGeometry(2.0, 1.2, TRACK_WIDTH + 4.0),
        pillarMat
      );
      crossBeam.position.set(pos.x, 13.2, pos.z);
      this.group.add(crossBeam);
    }
  }

  private buildJumpRampVisuals() {
    // Visual indicators for the jump ramp
    // Ramp lip is near x=-165, y=6.8, z=-15
    const lipMat = new THREE.MeshBasicMaterial({
      color: 0xff00aa,
    });

    const lipBar = new THREE.Mesh(
      new THREE.BoxGeometry(TRACK_WIDTH, 0.4, 1.5),
      lipMat
    );
    lipBar.position.set(-165, 6.8, -15);
    this.group.add(lipBar);

    // Glowing launch arrow signs on ramp surface
    const arrowMat = new THREE.MeshBasicMaterial({
      color: 0xffd700,
    });

    for (let i = 0; i < 3; i++) {
      const arrow = new THREE.Mesh(
        new THREE.ConeGeometry(1.5, 3.5, 3),
        arrowMat
      );
      arrow.rotation.x = -Math.PI / 2;
      arrow.rotation.z = Math.PI;
      arrow.position.set(-165, 4.0 + i * 1.0, 5 - i * 8);
      this.group.add(arrow);
    }
  }

  private createBoostPadTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#051805';
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = '#39ff14';
    ctx.lineWidth = 14;
    ctx.shadowColor = '#39ff14';
    ctx.shadowBlur = 15;

    // Glowing forward chevrons >>>
    for (let y = 40; y <= 200; y += 70) {
      ctx.beginPath();
      ctx.moveTo(40, y + 40);
      ctx.lineTo(128, y);
      ctx.lineTo(216, y + 40);
      ctx.stroke();
    }

    return new THREE.CanvasTexture(canvas);
  }

  private buildBoostPads() {
    const padTex = this.createBoostPadTexture();

    for (const pad of trackCircuit.boostPads) {
      const mat = new THREE.MeshBasicMaterial({
        map: padTex,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
      });
      this.boostPadMaterials.push(mat);

      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(pad.width, pad.length),
        mat
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = pad.angle;
      mesh.position.set(pad.x, pad.y, pad.z);
      this.group.add(mesh);
    }
  }

  private buildStartFinishArch() {
    // Start / Finish Line Arch at (0, 0, 0)
    const archGroup = new THREE.Group();

    // Checkered banner texture
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const size = 16;
    for (let x = 0; x < 256; x += size) {
      for (let y = 0; y < 64; y += size) {
        ctx.fillStyle = (x / size + y / size) % 2 === 0 ? '#ffffff' : '#0a0a14';
        ctx.fillRect(x, y, size, size);
      }
    }
    const checkTex = new THREE.CanvasTexture(canvas);

    // Overhead truss
    const archMat = new THREE.MeshStandardMaterial({
      color: 0x222638,
      metalness: 0.8,
      roughness: 0.2,
    });

    const bannerMat = new THREE.MeshBasicMaterial({
      map: checkTex,
    });

    // Left Column
    const colLeft = new THREE.Mesh(new THREE.BoxGeometry(1.4, 8.5, 1.4), archMat);
    colLeft.position.set(-HALF_WIDTH - 1, 4.25, 0);
    archGroup.add(colLeft);

    // Right Column
    const colRight = new THREE.Mesh(new THREE.BoxGeometry(1.4, 8.5, 1.4), archMat);
    colRight.position.set(HALF_WIDTH + 1, 4.25, 0);
    archGroup.add(colRight);

    // Horizontal Beam
    const topBeam = new THREE.Mesh(new THREE.BoxGeometry(TRACK_WIDTH + 3.8, 1.4, 1.4), archMat);
    topBeam.position.set(0, 8.5, 0);
    archGroup.add(topBeam);

    // Checkered Banner Board
    const banner = new THREE.Mesh(new THREE.BoxGeometry(TRACK_WIDTH, 1.8, 0.4), bannerMat);
    banner.position.set(0, 7.2, 0);
    archGroup.add(banner);

    // Checkered finish line on ground
    const finishLineMat = new THREE.MeshBasicMaterial({
      map: checkTex,
    });
    const finishLine = new THREE.Mesh(
      new THREE.PlaneGeometry(TRACK_WIDTH, 4.0),
      finishLineMat
    );
    finishLine.rotation.x = -Math.PI / 2;
    finishLine.position.set(0, 0.05, 0);
    archGroup.add(finishLine);

    this.group.add(archGroup);
  }

  private buildCosmicEnvironment() {
    // Cosmic grid ground at y = -25
    const gridHelper = new THREE.GridHelper(900, 45, 0x00f3ff, 0x121836);
    gridHelper.position.y = -25;
    this.group.add(gridHelper);

    // Distant floating decorative cosmic rings
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff00aa,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    });

    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(35 + i * 15, 0.5, 8, 32),
        ringMat
      );
      ring.position.set(-60 + i * 40, 30 + i * 10, -60);
      ring.rotation.x = 0.5 + i * 0.2;
      ring.rotation.y = 0.3 + i * 0.4;
      this.group.add(ring);
    }
  }

  public update(dt: number) {
    // Pulse boost pads
    const t = Date.now() * 0.005;
    for (const mat of this.boostPadMaterials) {
      mat.opacity = 0.8 + Math.sin(t) * 0.2;
    }
  }
}
