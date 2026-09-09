import * as THREE from 'three';
import { ActiveMine, ActiveProjectile, ItemBoxState } from '../../shared/types.js';

export class ItemRenderer {
  public group: THREE.Group;
  private boxMeshes: Map<number, THREE.Group> = new Map();
  private projectileMeshes: Map<string, THREE.Group> = new Map();
  private mineMeshes: Map<string, THREE.Group> = new Map();
  private particles: { mesh: THREE.Points; life: number; maxLife: number; vels: Float32Array }[] = [];

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  private createItemBoxMesh(): THREE.Group {
    const boxGroup = new THREE.Group();

    // Outer translucent cube
    const outerGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
    const outerMat = new THREE.MeshStandardMaterial({
      color: 0xffea00,
      metalness: 0.1,
      roughness: 0.1,
      transparent: true,
      opacity: 0.75,
    });
    const outerCube = new THREE.Mesh(outerGeo, outerMat);
    boxGroup.add(outerCube);

    // Glowing wireframe
    const wireGeo = new THREE.BoxGeometry(1.65, 1.65, 1.65);
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
    });
    const wireCube = new THREE.Mesh(wireGeo, wireMat);
    boxGroup.add(wireCube);

    // Inner question mark (?) canvas texture
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff00aa';
    ctx.font = 'bold 90px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 64, 64);

    const qTex = new THREE.CanvasTexture(canvas);
    const qMat = new THREE.MeshBasicMaterial({ map: qTex, transparent: true });
    const qPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), qMat);
    boxGroup.add(qPlane);

    return boxGroup;
  }

  public syncItemBoxes(boxes: ItemBoxState[]) {
    for (const b of boxes) {
      let mesh = this.boxMeshes.get(b.id);
      if (!mesh) {
        mesh = this.createItemBoxMesh();
        mesh.position.set(b.x, b.y, b.z);
        this.boxMeshes.set(b.id, mesh);
        this.group.add(mesh);
      }
      mesh.visible = b.active;
    }
  }

  public syncProjectiles(projectiles: ActiveProjectile[]) {
    const currentIds = new Set(projectiles.map((p) => p.id));

    // Remove old
    for (const [id, mesh] of this.projectileMeshes) {
      if (!currentIds.has(id)) {
        this.group.remove(mesh);
        this.projectileMeshes.delete(id);
      }
    }

    // Add or update
    for (const p of projectiles) {
      let mesh = this.projectileMeshes.get(p.id);
      if (!mesh) {
        mesh = new THREE.Group();
        // Plasma core
        const core = new THREE.Mesh(
          new THREE.SphereGeometry(0.5, 16, 16),
          new THREE.MeshBasicMaterial({ color: 0xff0055 })
        );
        // Outer aura
        const aura = new THREE.Mesh(
          new THREE.SphereGeometry(0.7, 12, 12),
          new THREE.MeshBasicMaterial({ color: 0xffaa00, wireframe: true })
        );
        mesh.add(core);
        mesh.add(aura);
        this.projectileMeshes.set(p.id, mesh);
        this.group.add(mesh);
      }
      mesh.position.set(p.x, p.y, p.z);
    }
  }

  public syncMines(mines: ActiveMine[]) {
    const currentIds = new Set(mines.map((m) => m.id));

    for (const [id, mesh] of this.mineMeshes) {
      if (!currentIds.has(id)) {
        this.group.remove(mesh);
        this.mineMeshes.delete(id);
      }
    }

    for (const m of mines) {
      let mesh = this.mineMeshes.get(m.id);
      if (!mesh) {
        mesh = new THREE.Group();
        // Floating spike mine
        const body = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.7, 0),
          new THREE.MeshStandardMaterial({ color: 0xff0033, roughness: 0.3, metalness: 0.8 })
        );
        const beacon = new THREE.Mesh(
          new THREE.SphereGeometry(0.3, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        beacon.position.y = 0.5;
        mesh.add(body);
        mesh.add(beacon);
        this.mineMeshes.set(m.id, mesh);
        this.group.add(mesh);
      }
      mesh.position.set(m.x, m.y + 0.5, m.z);
    }
  }

  public spawnExplosion(x: number, y: number, z: number, color: number = 0xff0055) {
    const count = 40;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vels = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;

      const speed = 5 + Math.random() * 15;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      vels[i * 3] = speed * Math.sin(phi) * Math.cos(theta);
      vels[i * 3 + 1] = speed * Math.cos(phi) + 4.0;
      vels[i * 3 + 2] = speed * Math.sin(phi) * Math.sin(theta);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.6,
      color,
      transparent: true,
      opacity: 1.0,
    });

    const mesh = new THREE.Points(geo, mat);
    this.group.add(mesh);
    this.particles.push({ mesh, life: 0, maxLife: 0.8, vels });
  }

  public update(dt: number) {
    const t = Date.now() * 0.003;

    // Rotate and bob item boxes
    for (const mesh of this.boxMeshes.values()) {
      if (mesh.visible) {
        mesh.rotation.y = t * 1.5;
        mesh.rotation.x = Math.sin(t) * 0.2;
        mesh.position.y += Math.sin(t * 3.0) * 0.004;
      }
    }

    // Pulse mines
    for (const mesh of this.mineMeshes.values()) {
      mesh.rotation.y += dt * 2.0;
      const scale = 1.0 + Math.sin(t * 5.0) * 0.1;
      mesh.scale.set(scale, scale, scale);
    }

    // Update explosion particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.group.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }

      const progress = p.life / p.maxLife;
      (p.mesh.material as THREE.PointsMaterial).opacity = 1.0 - progress;

      const attr = p.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const pos = attr.array as Float32Array;
      for (let j = 0; j < pos.length / 3; j++) {
        pos[j * 3] += p.vels[j * 3] * dt;
        pos[j * 3 + 1] += p.vels[j * 3 + 1] * dt;
        pos[j * 3 + 2] += p.vels[j * 3 + 2] * dt;
        p.vels[j * 3 + 1] -= 20.0 * dt; // gravity
      }
      attr.needsUpdate = true;
    }
  }
}
