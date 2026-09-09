import * as THREE from 'three';
import { KartColorId, KartColorInfo } from '../../shared/types.js';
import { KART_COLORS } from '../../shared/constants.js';

export class KartModel {
  public mesh: THREE.Group;
  public chassisGroup: THREE.Group;
  public frontWheels: THREE.Group[] = [];
  public rearWheels: THREE.Group[] = [];
  public exhaustFlames: THREE.Mesh[] = [];
  public driftSparksLeft!: THREE.Points;
  public driftSparksRight!: THREE.Points;

  private nameSprite?: THREE.Sprite;
  private primaryColor: number;
  private secondaryColor: number;
  private glowColor: number;
  private wheelRotation: number = 0;
  private spinAngle: number = 0;
  private shieldMesh?: THREE.Mesh;

  constructor(colorId: KartColorId, playerName: string) {
    this.mesh = new THREE.Group();
    this.chassisGroup = new THREE.Group();
    this.mesh.add(this.chassisGroup);

    const colorInfo: KartColorInfo = KART_COLORS[colorId] || KART_COLORS.cyan;
    this.primaryColor = colorInfo.primary;
    this.secondaryColor = colorInfo.secondary;
    this.glowColor = colorInfo.glow;

    this.buildChassis();
    this.buildWheels();
    this.buildExhaustAndFlames();
    this.buildDriftSparks();
    this.buildShieldSphere();
    this.buildNamePlate(playerName);
  }

  private buildChassis() {
    const mainMat = new THREE.MeshStandardMaterial({
      color: this.primaryColor,
      metalness: 0.6,
      roughness: 0.3,
    });

    const darkMat = new THREE.MeshStandardMaterial({
      color: this.secondaryColor,
      metalness: 0.7,
      roughness: 0.4,
    });

    const glowMat = new THREE.MeshBasicMaterial({
      color: this.glowColor,
    });

    // Main Cockpit Body
    const bodyGeo = new THREE.BoxGeometry(1.4, 0.45, 2.2);
    const bodyMesh = new THREE.Mesh(bodyGeo, mainMat);
    bodyMesh.position.y = 0.38;
    this.chassisGroup.add(bodyMesh);

    // Aerodynamic Nose
    const noseGeo = new THREE.ConeGeometry(0.7, 1.2, 4);
    const noseMesh = new THREE.Mesh(noseGeo, mainMat);
    noseMesh.rotation.x = Math.PI / 2;
    noseMesh.rotation.y = Math.PI / 4;
    noseMesh.position.set(0, 0.35, 1.5);
    noseMesh.scale.set(1.0, 1.0, 0.5);
    this.chassisGroup.add(noseMesh);

    // Front Bumper with Neon Trim
    const bumperGeo = new THREE.BoxGeometry(1.7, 0.18, 0.3);
    const bumperMesh = new THREE.Mesh(bumperGeo, glowMat);
    bumperMesh.position.set(0, 0.25, 1.9);
    this.chassisGroup.add(bumperMesh);

    // Side Pods
    for (const side of [-1, 1]) {
      const podGeo = new THREE.BoxGeometry(0.35, 0.35, 1.4);
      const podMesh = new THREE.Mesh(podGeo, darkMat);
      podMesh.position.set(side * 0.85, 0.35, 0);
      this.chassisGroup.add(podMesh);

      // Neon side accents
      const neonStrip = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.1, 1.2),
        glowMat
      );
      neonStrip.position.set(side * 1.02, 0.35, 0);
      this.chassisGroup.add(neonStrip);
    }

    // Cockpit Windshield (tinted glass)
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x112233,
      metalness: 0.1,
      roughness: 0.1,
      transmission: 0.85,
      transparent: true,
      opacity: 0.9,
    });
    const glassGeo = new THREE.BoxGeometry(0.9, 0.35, 0.7);
    const glassMesh = new THREE.Mesh(glassGeo, glassMat);
    glassMesh.position.set(0, 0.7, 0.2);
    this.chassisGroup.add(glassMesh);

    // Racer Helmet / Head
    const helmetMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.2,
      metalness: 0.8,
    });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), helmetMat);
    helmet.position.set(0, 0.85, -0.05);
    this.chassisGroup.add(helmet);

    // Visor
    const visorMat = new THREE.MeshBasicMaterial({ color: this.glowColor });
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.25), visorMat);
    visor.position.set(0, 0.86, 0.15);
    this.chassisGroup.add(visor);

    // Rear Wing / Spoiler
    const wingStrutMat = darkMat;
    for (const side of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.12), wingStrutMat);
      strut.position.set(side * 0.55, 0.65, -1.0);
      this.chassisGroup.add(strut);
    }

    const wingMesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.45), mainMat);
    wingMesh.position.set(0, 0.9, -1.0);
    this.chassisGroup.add(wingMesh);
  }

  private buildWheels() {
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x151515,
      roughness: 0.8,
      metalness: 0.1,
    });

    const rimMat = new THREE.MeshBasicMaterial({
      color: this.glowColor,
    });

    const wheelPositions = [
      { x: -0.95, y: 0.32, z: 1.0, isFront: true },
      { x: 0.95, y: 0.32, z: 1.0, isFront: true },
      { x: -0.98, y: 0.36, z: -0.95, isFront: false },
      { x: 0.98, y: 0.36, z: -0.95, isFront: false },
    ];

    for (const wp of wheelPositions) {
      const wheelMount = new THREE.Group();
      wheelMount.position.set(wp.x, wp.y, wp.z);

      const wheelRot = new THREE.Group();
      wheelMount.add(wheelRot);

      // Tire cylinder
      const radius = wp.isFront ? 0.32 : 0.36;
      const width = wp.isFront ? 0.28 : 0.35;
      const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 16);
      tireGeo.rotateZ(Math.PI / 2);
      const tireMesh = new THREE.Mesh(tireGeo, tireMat);
      wheelRot.add(tireMesh);

      // Glowing rim cap
      const rimGeo = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.02, 12);
      rimGeo.rotateZ(Math.PI / 2);
      const rimMesh = new THREE.Mesh(rimGeo, rimMat);
      wheelRot.add(rimMesh);

      this.mesh.add(wheelMount);

      if (wp.isFront) {
        this.frontWheels.push(wheelMount);
      } else {
        this.rearWheels.push(wheelMount);
      }
    }
  }

  private buildExhaustAndFlames() {
    const exhaustMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      metalness: 0.9,
      roughness: 0.2,
    });

    const flameMat = new THREE.MeshBasicMaterial({
      color: 0x00f3ff,
      transparent: true,
      opacity: 0.8,
    });

    for (const side of [-1, 1]) {
      // Pipe
      const pipeGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.4, 8);
      pipeGeo.rotateX(Math.PI / 2);
      const pipe = new THREE.Mesh(pipeGeo, exhaustMat);
      pipe.position.set(side * 0.35, 0.35, -1.15);
      this.chassisGroup.add(pipe);

      // Flame cone
      const flameGeo = new THREE.ConeGeometry(0.14, 0.7, 8);
      flameGeo.rotateX(-Math.PI / 2);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(side * 0.35, 0.35, -1.55);
      flame.visible = false;
      this.chassisGroup.add(flame);
      this.exhaustFlames.push(flame);
    }
  }

  private buildDriftSparks() {
    const sparkCount = 30;
    const sparkGeoLeft = new THREE.BufferGeometry();
    const sparkGeoRight = new THREE.BufferGeometry();
    const posLeft = new Float32Array(sparkCount * 3);
    const posRight = new Float32Array(sparkCount * 3);

    sparkGeoLeft.setAttribute('position', new THREE.BufferAttribute(posLeft, 3));
    sparkGeoRight.setAttribute('position', new THREE.BufferAttribute(posRight, 3));

    const sparkMat = new THREE.PointsMaterial({
      size: 0.4,
      color: 0x00f3ff,
      transparent: true,
      opacity: 0.9,
    });

    this.driftSparksLeft = new THREE.Points(sparkGeoLeft, sparkMat.clone());
    this.driftSparksRight = new THREE.Points(sparkGeoRight, sparkMat.clone());

    this.driftSparksLeft.visible = false;
    this.driftSparksRight.visible = false;

    this.mesh.add(this.driftSparksLeft);
    this.mesh.add(this.driftSparksRight);
  }

  private buildShieldSphere() {
    const shieldGeo = new THREE.SphereGeometry(1.8, 16, 16);
    const shieldMat = new THREE.MeshBasicMaterial({
      color: 0xffea00,
      wireframe: true,
      transparent: true,
      opacity: 0.6,
    });
    this.shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
    this.shieldMesh.position.y = 0.5;
    this.shieldMesh.visible = false;
    this.mesh.add(this.shieldMesh);
  }

  private buildNamePlate(playerName: string) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgba(10, 12, 28, 0.75)';
    ctx.roundRect(10, 8, 236, 48, 10);
    ctx.fill();

    ctx.strokeStyle = `#${this.glowColor.toString(16).padStart(6, '0')}`;
    ctx.lineWidth = 4;
    ctx.roundRect(10, 8, 236, 48, 10);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(playerName, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    this.nameSprite = new THREE.Sprite(spriteMat);
    this.nameSprite.position.set(0, 2.2, 0);
    this.nameSprite.scale.set(2.4, 0.6, 1);
    this.mesh.add(this.nameSprite);
  }

  public update(
    speed: number,
    steerAngle: number,
    driftLevel: number,
    isBoosting: boolean,
    isShielded: boolean,
    isSpunOut: boolean,
    dt: number
  ) {
    // Wheel spin based on speed
    this.wheelRotation += (speed * dt) / 0.35;
    for (const w of this.frontWheels) {
      w.rotation.y = steerAngle;
      w.children[0].rotation.x = this.wheelRotation;
    }
    for (const w of this.rearWheels) {
      w.children[0].rotation.x = this.wheelRotation;
    }

    // Chassis lean / tilt on turns
    const targetRoll = -steerAngle * 0.25;
    this.chassisGroup.rotation.z = THREE.MathUtils.lerp(
      this.chassisGroup.rotation.z,
      targetRoll,
      dt * 10
    );

    // Spin out handling
    if (isSpunOut) {
      this.spinAngle += dt * 15.0;
      this.chassisGroup.rotation.y = this.spinAngle;
    } else {
      this.spinAngle = 0;
      this.chassisGroup.rotation.y = 0;
    }

    // Exhaust flames
    const showFlames = isBoosting || speed > 35;
    for (const f of this.exhaustFlames) {
      f.visible = showFlames;
      if (showFlames) {
        f.scale.set(
          1 + Math.random() * 0.4,
          1 + Math.random() * 0.4,
          isBoosting ? 1.8 + Math.random() * 0.5 : 1.0 + Math.random() * 0.3
        );
        (f.material as THREE.MeshBasicMaterial).color.setHex(
          isBoosting ? 0xff00aa : 0x00f3ff
        );
      }
    }

    // Drift Sparks
    const hasSparks = driftLevel > 0;
    this.driftSparksLeft.visible = hasSparks;
    this.driftSparksRight.visible = hasSparks;

    if (hasSparks) {
      let sparkColor = 0x00f3ff; // Tier 1 Blue
      if (driftLevel === 2) sparkColor = 0xff8800; // Tier 2 Orange
      if (driftLevel === 3) sparkColor = 0xbb00ff; // Tier 3 Purple

      (this.driftSparksLeft.material as THREE.PointsMaterial).color.setHex(sparkColor);
      (this.driftSparksRight.material as THREE.PointsMaterial).color.setHex(sparkColor);

      this.updateSparkPositions(this.driftSparksLeft, -0.9, -0.95);
      this.updateSparkPositions(this.driftSparksRight, 0.9, -0.95);
    }

    // Shield bubble
    if (this.shieldMesh) {
      this.shieldMesh.visible = isShielded;
      if (isShielded) {
        this.shieldMesh.rotation.y += dt * 3.0;
        this.shieldMesh.rotation.x += dt * 2.0;
      }
    }
  }

  private updateSparkPositions(points: THREE.Points, baseX: number, baseZ: number) {
    const attr = points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = baseX + (Math.random() - 0.5) * 0.5;
      arr[i + 1] = 0.2 + Math.random() * 0.4;
      arr[i + 2] = baseZ - Math.random() * 0.8;
    }
    attr.needsUpdate = true;
  }
}
