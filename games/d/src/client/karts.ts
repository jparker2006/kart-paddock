// Kart meshes, name tags, item boxes, oil slicks.
import * as THREE from "three";

export function makeNameSprite(name: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(10,8,14,0.72)";
  const w = Math.min(250, 20 + name.length * 15);
  roundRect(g, 128 - w / 2, 6, w, 44, 12);
  g.fill();
  g.fillStyle = "#fff";
  g.font = "bold 26px Trebuchet MS, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(name.slice(0, 14), 128, 29);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(6.4, 1.6, 1);
  sp.position.y = 2.6;
  sp.renderOrder = 5;
  return sp;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export interface KartMesh {
  group: THREE.Group;
  wheels: THREE.Mesh[];
  sparkLeft: THREE.Points;
  sparkRight: THREE.Points;
  setDriftSparks: (on: boolean) => void;
}

export function makeKartMesh(color: string, name: string, isLocal: boolean): KartMesh {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.8 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.9), paint);
  body.position.y = 0.62;
  body.castShadow = true;
  group.add(body);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.9), paint);
  nose.position.set(0, 0.5, 1.8);
  nose.castShadow = true;
  group.add(nose);

  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 1.0), dark);
  seat.position.set(0, 1.0, -0.5);
  group.add(seat);

  // driver helmet
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xf2ede2, roughness: 0.3 }),
  );
  helmet.position.set(0, 1.55, -0.4);
  helmet.castShadow = true;
  group.add(helmet);
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.22, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x101018, roughness: 0.2, metalness: 0.6 }),
  );
  visor.position.set(0, 1.58, -0.02);
  group.add(visor);

  // spoiler
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.5), paint);
  wing.position.set(0, 1.45, -1.75);
  group.add(wing);
  for (const sx of [-0.8, 0.8]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.3), dark);
    strut.position.set(sx, 1.15, -1.75);
    group.add(strut);
  }

  // headlights
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
  for (const sx of [-0.45, 0.45]) {
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), lightMat);
    hl.position.set(sx, 0.55, 2.26);
    group.add(hl);
  }

  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.36, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.9 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xccccd6, roughness: 0.4, metalness: 0.5 });
  const wheels: THREE.Mesh[] = [];
  for (const [wx, wz] of [[-0.95, 1.05], [0.95, 1.05], [-0.95, -1.05], [0.95, -1.05]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(wx, 0.42, wz);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.38, 8), hubMat);
    hub.rotation.z = Math.PI / 2;
    w.add(hub);
    group.add(w);
    wheels.push(w);
  }

  // local player gets a floating marker arrow
  if (isLocal) {
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 0.8, 4),
      new THREE.MeshBasicMaterial({ color: 0xffd23e }),
    );
    arrow.rotation.x = Math.PI;
    arrow.position.y = 3.6;
    arrow.name = "local-arrow";
    group.add(arrow);
  }

  const tag = makeNameSprite(name);
  group.add(tag);

  // drift sparks (hidden unless drifting)
  function sparkCloud(): THREE.Points {
    const n = 26;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (Math.random() - 0.5) * 1.4;
      p[i * 3 + 1] = Math.random() * 0.7;
      p[i * 3 + 2] = (Math.random() - 0.5) * 1.4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0xffd23e, size: 0.28, transparent: true, opacity: 0.95 }),
    );
    pts.visible = false;
    return pts;
  }
  const sparkLeft = sparkCloud();
  sparkLeft.position.set(-1.1, 0.3, -1.1);
  group.add(sparkLeft);
  const sparkRight = sparkCloud();
  sparkRight.position.set(1.1, 0.3, -1.1);
  group.add(sparkRight);

  return {
    group,
    wheels,
    sparkLeft,
    sparkRight,
    setDriftSparks(on: boolean) {
      sparkLeft.visible = on;
      sparkRight.visible = on;
    },
  };
}

function questionTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(20,40,60,0.85)";
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "#ffd23e";
  g.lineWidth = 6;
  g.strokeRect(4, 4, 120, 120);
  g.fillStyle = "#ffd23e";
  g.font = "bold 84px Trebuchet MS, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("?", 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let sharedQTex: THREE.CanvasTexture | null = null;

export function makeItemBoxMesh(): THREE.Mesh {
  if (!sharedQTex) sharedQTex = questionTexture();
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.6, 1.6),
    new THREE.MeshStandardMaterial({
      map: sharedQTex,
      transparent: true,
      opacity: 0.92,
      emissive: 0x2e7de6,
      emissiveIntensity: 0.35,
    }),
  );
  m.castShadow = true;
  return m;
}

export function makeHazardMesh(): THREE.Group {
  const g = new THREE.Group();
  const slick = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 20),
    new THREE.MeshStandardMaterial({ color: 0x150a2e, roughness: 0.25, metalness: 0.4 }),
  );
  slick.rotation.x = -Math.PI / 2;
  slick.position.y = 0.06;
  g.add(slick);
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(1.5, 1.9, 20),
    new THREE.MeshBasicMaterial({ color: 0x9b2ee6, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.07;
  g.add(glow);
  return g;
}
