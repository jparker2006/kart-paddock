import * as THREE from 'three';

export type CameraMode = 'chase' | 'close' | 'cockpit';

export class SceneManager {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public cameraMode: CameraMode = 'chase';

  private targetCamPos = new THREE.Vector3();
  private targetLookAt = new THREE.Vector3();
  private currentCamPos = new THREE.Vector3();
  private currentLookAt = new THREE.Vector3();
  private baseFOV = 65;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060714);
    this.scene.fog = new THREE.FogExp2(0x070818, 0.002);

    this.camera = new THREE.PerspectiveCamera(
      this.baseFOV,
      window.innerWidth / window.innerHeight,
      0.1,
      1200
    );
    this.camera.position.set(0, 10, -20);

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        powerPreference: 'high-performance',
      });
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.15;
    } catch (e) {
      console.warn('WebGLRenderer unavailable, using fallback mock:', e);
      this.renderer = {
        render: () => {},
        setSize: () => {},
        setPixelRatio: () => {},
      } as any;
    }

    this.setupLighting();
    this.setupCosmicSky();

    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  private setupLighting() {
    const ambient = new THREE.AmbientLight(0xddeeff, 0.6);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffeedd, 1.4);
    sun.position.set(80, 150, 60);
    this.scene.add(sun);

    // Cosmic rim lights
    const rimLight1 = new THREE.DirectionalLight(0x00f3ff, 0.8);
    rimLight1.position.set(-100, 40, -100);
    this.scene.add(rimLight1);

    const rimLight2 = new THREE.DirectionalLight(0xff00aa, 0.7);
    rimLight2.position.set(100, -20, 100);
    this.scene.add(rimLight2);
  }

  private setupCosmicSky() {
    // Starfield particle system
    const starCount = 2000;
    const starGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const radius = 600 + Math.random() * 300;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);

      starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = radius * Math.cos(phi);
      starPositions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

      const colorRoll = Math.random();
      if (colorRoll < 0.3) {
        starColors[i * 3] = 0.5;
        starColors[i * 3 + 1] = 0.9;
        starColors[i * 3 + 2] = 1.0;
      } else if (colorRoll < 0.6) {
        starColors[i * 3] = 1.0;
        starColors[i * 3 + 1] = 0.4;
        starColors[i * 3 + 2] = 0.8;
      } else {
        starColors[i * 3] = 1.0;
        starColors[i * 3 + 1] = 1.0;
        starColors[i * 3 + 2] = 1.0;
      }
    }

    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));

    const starMaterial = new THREE.PointsMaterial({
      size: 2.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
    });

    const starField = new THREE.Points(starGeometry, starMaterial);
    this.scene.add(starField);
  }

  public cycleCameraMode() {
    if (this.cameraMode === 'chase') {
      this.cameraMode = 'close';
    } else if (this.cameraMode === 'close') {
      this.cameraMode = 'cockpit';
    } else {
      this.cameraMode = 'chase';
    }
  }

  public updateCamera(
    kartPos: THREE.Vector3,
    kartQuat: THREE.Quaternion,
    speed: number,
    isBoosting: boolean,
    dt: number
  ) {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(kartQuat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(kartQuat);

    let offsetDist = 9.0;
    let offsetHeight = 3.8;
    let lookAheadDist = 8.0;
    let lookHeight = 1.2;

    if (this.cameraMode === 'close') {
      offsetDist = 6.0;
      offsetHeight = 2.6;
      lookAheadDist = 6.0;
      lookHeight = 0.9;
    } else if (this.cameraMode === 'cockpit') {
      offsetDist = -0.5;
      offsetHeight = 1.1;
      lookAheadDist = 12.0;
      lookHeight = 0.8;
    }

    // Dynamic FOV based on speed and boost
    const targetFOV = this.baseFOV + (speed / 50.0) * 16.0 + (isBoosting ? 12.0 : 0.0);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFOV, dt * 6.0);
    this.camera.updateProjectionMatrix();

    this.targetCamPos.copy(kartPos).sub(forward.clone().multiplyScalar(offsetDist)).add(up.clone().multiplyScalar(offsetHeight));
    this.targetLookAt.copy(kartPos).add(forward.clone().multiplyScalar(lookAheadDist)).add(up.clone().multiplyScalar(lookHeight));

    // Smooth lerp
    const lerpSpeed = this.cameraMode === 'cockpit' ? 25.0 : 10.0;
    this.currentCamPos.lerp(this.targetCamPos, dt * lerpSpeed);
    this.currentLookAt.lerp(this.targetLookAt, dt * lerpSpeed);

    this.camera.position.copy(this.currentCamPos);
    this.camera.lookAt(this.currentLookAt);
  }

  public onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  public render() {
    this.renderer.render(this.scene, this.camera);
  }
}
