import * as THREE from 'three';

/**
 * A chunky low-poly bee-buggy built from primitives (no external assets).
 * The group is oriented so that its nose points down -Z, matching the
 * three.js yaw convention used by the physics.
 */
export class KartMesh {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private frontWheels: THREE.Mesh[] = [];
  private flame: THREE.Mesh;
  private flameMat: THREE.MeshBasicMaterial;
  private sparks: THREE.Points;
  private sparkMat: THREE.PointsMaterial;
  private label: THREE.Sprite | null = null;
  private wingL: THREE.Mesh;
  private wingR: THREE.Mesh;
  private shadow: THREE.Mesh;
  private time = 0;

  constructor(colorHex: string, name: string, isLocal: boolean) {
    const color = new THREE.Color(colorHex);
    const darker = color.clone().multiplyScalar(0.55);
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x24211f, roughness: 0.8 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: darker, roughness: 0.6 });

    // chassis
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.45, 2.7), bodyMat);
    chassis.position.y = 0.5;
    chassis.castShadow = true;
    this.body.add(chassis);
    // rounded nose
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.8, 14, 10), bodyMat);
    nose.scale.set(1.05, 0.55, 1.1);
    nose.position.set(0, 0.55, -1.25);
    nose.castShadow = true;
    this.body.add(nose);
    // bee stripes across the back
    for (let i = 0; i < 2; i++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.47, 0.28), stripeMat);
      stripe.position.set(0, 0.5, 0.45 + i * 0.6);
      this.body.add(stripe);
    }
    // seat back / spoiler
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.5), darkMat);
    spoiler.position.set(0, 1.1, 1.25);
    this.body.add(spoiler);
    const spoilerPostL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), darkMat);
    spoilerPostL.position.set(-0.6, 0.9, 1.25);
    const spoilerPostR = spoilerPostL.clone();
    spoilerPostR.position.x = 0.6;
    this.body.add(spoilerPostL, spoilerPostR);

    // driver: a round bee with goggles
    const driverMat = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.6 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), driverMat);
    head.position.set(0, 1.25, 0.15);
    head.castShadow = true;
    this.body.add(head);
    const gogglesMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.3 });
    const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.2), gogglesMat);
    goggles.position.set(0, 1.3, -0.22);
    this.body.add(goggles);
    const antennaMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b });
    for (const sx of [-1, 1]) {
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 6), antennaMat);
      antenna.position.set(sx * 0.18, 1.75, 0.1);
      antenna.rotation.z = -sx * 0.4;
      this.body.add(antenna);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), bodyMat);
      tip.position.set(sx * 0.27, 1.95, 0.1);
      this.body.add(tip);
    }
    // wings (flutter while boosting / airborne)
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      roughness: 0.2,
      side: THREE.DoubleSide,
    });
    const wingGeo = new THREE.CircleGeometry(0.5, 12);
    this.wingL = new THREE.Mesh(wingGeo, wingMat);
    this.wingL.scale.set(0.6, 1.2, 1);
    this.wingL.position.set(-0.45, 1.05, 0.7);
    this.wingL.rotation.set(-Math.PI / 2, 0, 0.3);
    this.wingR = new THREE.Mesh(wingGeo, wingMat);
    this.wingR.scale.set(0.6, 1.2, 1);
    this.wingR.position.set(0.45, 1.05, 0.7);
    this.wingR.rotation.set(-Math.PI / 2, 0, -0.3);
    this.body.add(this.wingL, this.wingR);

    // wheels
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.36, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.38, 8);
    hubGeo.rotateZ(Math.PI / 2);
    const hubMat = new THREE.MeshStandardMaterial({ color: 0xf1e9d2, roughness: 0.5 });
    for (const [wx, wz] of [
      [-0.95, -0.95],
      [0.95, -0.95],
      [-0.95, 0.95],
      [0.95, 0.95],
    ]) {
      const wheel = new THREE.Mesh(wheelGeo, darkMat);
      wheel.position.set(wx, 0.42, wz);
      wheel.castShadow = true;
      const hub = new THREE.Mesh(hubGeo, hubMat);
      wheel.add(hub);
      this.group.add(wheel);
      this.wheels.push(wheel);
      if (wz < 0) this.frontWheels.push(wheel);
    }

    // exhaust flame (boost)
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xffa726, transparent: true, opacity: 0.9 });
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.2, 10), this.flameMat);
    this.flame.rotation.x = -Math.PI / 2;
    this.flame.position.set(0, 0.55, 1.9);
    this.flame.visible = false;
    this.body.add(this.flame);

    // drift sparks
    const sparkCount = 24;
    const positions = new Float32Array(sparkCount * 3);
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.sparkMat = new THREE.PointsMaterial({ color: 0x4cc9f0, size: 0.28, transparent: true, opacity: 0.9 });
    this.sparks = new THREE.Points(sparkGeo, this.sparkMat);
    this.sparks.visible = false;
    this.group.add(this.sparks);

    // soft blob shadow (cheap, always visible even without shadow maps)
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 });
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1.35, 16), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.03;
    this.group.add(this.shadow);

    this.group.add(this.body);

    if (!isLocal) {
      this.label = makeLabel(name, colorHex);
      this.label.position.set(0, 2.45, 0);
      this.group.add(this.label);
    }
  }

  setLabelSuffix(suffix: string, name: string, colorHex: string): void {
    if (!this.label) return;
    const sprite = makeLabel(suffix ? `${name} ${suffix}` : name, colorHex);
    sprite.position.copy(this.label.position);
    this.group.remove(this.label);
    this.label.material.map?.dispose();
    this.label.material.dispose();
    this.label = sprite;
    this.group.add(sprite);
  }

  /**
   * @param speed signed forward speed
   * @param steer -1..1 steering for front wheel angle
   * @param opts visual flags
   */
  update(
    dt: number,
    speed: number,
    steer: number,
    opts: { boosting: boolean; drifting: number; spinning: boolean; airborne: boolean; lean: number; hop: number; spinAngle: number; groundY: number },
  ): void {
    this.time += dt;
    const rot = (speed * dt) / 0.42;
    for (const w of this.wheels) w.rotation.x += rot;
    for (const w of this.frontWheels) w.rotation.y = steer * 0.45;
    this.body.rotation.z = opts.lean;
    this.body.rotation.y = opts.spinning ? opts.spinAngle : 0;
    this.body.position.y = opts.hop;
    // flame
    this.flame.visible = opts.boosting;
    if (opts.boosting) {
      const s = 0.8 + Math.sin(this.time * 40) * 0.25;
      this.flame.scale.set(s, 1 + Math.random() * 0.4, s);
      this.flameMat.color.setHSL(0.08 + Math.random() * 0.04, 1, 0.55);
    }
    // sparks
    this.sparks.visible = opts.drifting !== 0 && !opts.airborne;
    if (this.sparks.visible) {
      const pos = this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const side = opts.drifting > 0 ? 1 : -1;
        pos.setXYZ(
          i,
          side * (0.7 + Math.random() * 0.6),
          0.1 + Math.random() * 0.5,
          0.6 + Math.random() * 1.6,
        );
      }
      pos.needsUpdate = true;
    }
    // wings flutter faster when boosting or in the air
    const flutter = opts.airborne || opts.boosting ? 40 : 8;
    const angle = Math.sin(this.time * flutter) * 0.5;
    this.wingL.rotation.z = 0.3 + angle;
    this.wingR.rotation.z = -0.3 - angle;
    // ground shadow stays on the road while airborne
    this.shadow.position.y = opts.groundY - this.group.position.y + 0.03;
    const airFade = Math.max(0.1, 0.28 - Math.max(0, this.group.position.y - opts.groundY) * 0.03);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = airFade;
  }

  setSparkColor(hex: number): void {
    this.sparkMat.color.setHex(hex);
  }

  setOpacity(alpha: number): void {
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = (o as THREE.Mesh).material as THREE.Material;
        m.transparent = alpha < 1 || m.transparent;
        m.opacity = alpha;
      }
    });
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
  }
}

function makeLabel(text: string, colorHex: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 56px "Trebuchet MS", "Segoe UI", sans-serif';
  const w = Math.min(500, ctx.measureText(text).width + 60);
  ctx.fillStyle = 'rgba(20, 18, 16, 0.72)';
  roundRect(ctx, 256 - w / 2, 20, w, 88, 28);
  ctx.fill();
  ctx.fillStyle = colorHex;
  ctx.fillRect(256 - w / 2 + 18, 44, 40, 40);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, 256 - w / 2 + 72, 66);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.6, 0.65, 1);
  return sprite;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
