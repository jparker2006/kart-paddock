import * as THREE from 'three';
import { SceneManager } from './gfx/SceneManager.js';
import { TrackRenderer } from './gfx/TrackRenderer.js';
import { KartModel } from './gfx/KartModel.js';
import { ItemRenderer } from './gfx/ItemRenderer.js';
import { soundSystem } from './audio/SoundSystem.js';
import { UIManager } from './ui/UIManager.js';
import { Minimap } from './ui/Minimap.js';
import { KartController } from './game/KartController.js';
import { CheckpointTracker } from './game/CheckpointTracker.js';
import { ItemManager } from './game/ItemManager.js';
import { networkClient } from './net/NetworkClient.js';
import { ActiveMine, ActiveProjectile, ItemBoxState, ItemType, PlayerInput, RoomState } from '../shared/types.js';
import { GRID_POSITIONS, TOTAL_LAPS } from '../shared/constants.js';

class HyperKartApp {
  private canvas: HTMLCanvasElement;
  private minimapCanvas: HTMLCanvasElement;

  private sceneManager: SceneManager;
  private trackRenderer: TrackRenderer;
  private itemRenderer: ItemRenderer;
  private uiManager: UIManager;
  private minimap: Minimap;
  private kartController: KartController;
  private checkpointTracker: CheckpointTracker;
  private itemManager: ItemManager;

  private localKartModel?: KartModel;
  private remoteKartModels: Map<string, KartModel> = new Map();
  private isRacingActive: boolean = false;

  private activeProjectiles: ActiveProjectile[] = [];
  private activeMines: ActiveMine[] = [];

  private keyStates: Record<string, boolean> = {};
  private lastFrameTime: number = performance.now();
  private networkUpdateTimer: number = 0;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;

    this.sceneManager = new SceneManager(this.canvas);
    this.trackRenderer = new TrackRenderer(this.sceneManager.scene);
    this.itemRenderer = new ItemRenderer(this.sceneManager.scene);
    this.uiManager = new UIManager();
    this.minimap = new Minimap(this.minimapCanvas);
    this.kartController = new KartController();
    this.checkpointTracker = new CheckpointTracker();
    this.itemManager = new ItemManager();

    this.setupInputListeners();
    this.setupUIListeners();
    this.setupNetworkListeners();

    // Check for room code in URL hash or query string
    this.checkUrlRoomCode();

    // Connect to server
    networkClient.connect().then(() => {
      console.log('Connected to HyperKart Server');
    });

    // Start render loop
    requestAnimationFrame(this.gameLoop.bind(this));
  }

  private checkUrlRoomCode() {
    const hash = window.location.hash;
    const search = window.location.search;
    let code: string | null = null;

    if (hash.includes('room=')) {
      const match = hash.match(/room=([A-Za-z0-9]+)/);
      if (match) code = match[1];
    } else if (search.includes('room=')) {
      const match = search.match(/room=([A-Za-z0-9]+)/);
      if (match) code = match[1];
    }

    if (code) {
      const roomInput = document.getElementById('room-code-input') as HTMLInputElement;
      if (roomInput) roomInput.value = code.toUpperCase();
    }
  }

  private setupInputListeners() {
    window.addEventListener('keydown', (e) => {
      soundSystem.resume();
      this.keyStates[e.code] = true;

      // Single action hotkeys
      if (e.code === 'KeyM') {
        const muted = soundSystem.toggleMute();
        const btnMute = document.getElementById('btn-mute');
        if (btnMute) btnMute.innerText = muted ? '🔇' : '🔊';
      } else if (e.code === 'KeyC') {
        this.sceneManager.cycleCameraMode();
      } else if (e.code === 'KeyE' || e.code === 'Enter') {
        this.tryUseItem();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keyStates[e.code] = false;
    });

    this.canvas.addEventListener('click', () => {
      this.canvas.focus();
      soundSystem.resume();
    });
  }

  private pollInput(): PlayerInput {
    if (!this.isRacingActive) {
      return { throttle: 0, steer: 0, drift: false, useItem: false, respawn: false };
    }

    let throttle = 0;
    if (this.keyStates['KeyW'] || this.keyStates['ArrowUp']) throttle += 1;
    if (this.keyStates['KeyS'] || this.keyStates['ArrowDown']) throttle -= 1;

    let steer = 0;
    if (this.keyStates['KeyA'] || this.keyStates['ArrowLeft']) steer += 1;
    if (this.keyStates['KeyD'] || this.keyStates['ArrowRight']) steer -= 1;

    const drift = !!(this.keyStates['Space'] || this.keyStates['ShiftLeft'] || this.keyStates['ShiftRight']);
    const useItem = !!(this.keyStates['KeyE'] || this.keyStates['Enter']);
    const respawn = !!this.keyStates['KeyR'];

    return { throttle, steer, drift, useItem, respawn };
  }

  private tryUseItem() {
    if (!this.itemManager.heldItem || !this.isRacingActive) return;

    const item = this.itemManager.heldItem;
    this.itemManager.heldItem = null;
    this.uiManager.updateItemSlot(null, false);

    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.kartController.quaternion);

    if (item === 'boost') {
      this.kartController.applyBoost(3.0);
    } else if (item === 'shield') {
      this.kartController.applyShield(6.0);
    }

    networkClient.useItem(
      item,
      this.kartController.position.x,
      this.kartController.position.y,
      this.kartController.position.z,
      fwd.x,
      fwd.z
    );
  }

  private setupUIListeners() {
    this.uiManager.onCreateRoom = (name, color) => {
      networkClient.createRoom(name, color);
    };

    this.uiManager.onJoinRoom = (code, name, color) => {
      networkClient.joinRoom(code, name, color);
    };

    this.uiManager.onColorChanged = (color) => {
      networkClient.selectColor(color);
    };

    this.uiManager.onStartRace = () => {
      networkClient.startRace();
    };

    this.uiManager.onCameraToggle = () => {
      this.sceneManager.cycleCameraMode();
    };

    this.uiManager.onRematch = () => {
      networkClient.requestRematch();
    };

    this.uiManager.onLeaveRoom = () => {
      networkClient.clearSession();
      window.location.reload();
    };
  }

  private setupNetworkListeners() {
    networkClient.onRoomStateChanged = (state: RoomState) => {
      const effectiveId = networkClient.localPlayerId || '';
      const localPlayer = state.players[effectiveId];

      if (state.status === 'lobby') {
        this.isRacingActive = false;
        this.uiManager.showLobbyView(state, effectiveId);
      } else if (state.status === 'countdown') {
        this.isRacingActive = false;
        this.uiManager.showGameHUD(localPlayer?.isSpectator);
        this.syncGridStartingPositions(state);
      } else if (state.status === 'racing') {
        this.uiManager.showGameHUD(localPlayer?.isSpectator);
        this.isRacingActive = !localPlayer?.isSpectator;
      } else if (state.status === 'finished') {
        this.isRacingActive = false;
      }

      this.syncRemoteKartMeshes(state);
    };

    networkClient.onCountdown = (sec: number) => {
      soundSystem.playCountdown(false);
      this.uiManager.showAnnouncement(String(sec), 0.9);
    };

    networkClient.onRaceStart = (startTime: number) => {
      soundSystem.playCountdown(true);
      this.uiManager.showAnnouncement('GO!', 1.4);
      this.isRacingActive = true;
      this.checkpointTracker.reset(startTime);
    };

    networkClient.onItemSpawn = (boxes: ItemBoxState[]) => {
      this.itemRenderer.syncItemBoxes(boxes);
    };

    networkClient.onItemCollected = (boxId: number, playerId: string, item: ItemType) => {
      if (playerId === networkClient.localPlayerId) {
        this.itemManager.startRoulette(
          item,
          (spinItem) => this.uiManager.updateItemSlot(spinItem, true),
          (finalItem) => this.uiManager.updateItemSlot(finalItem, false)
        );
      }
    };

    networkClient.onProjectileSpawn = (proj: ActiveProjectile) => {
      soundSystem.playRocketFire();
      this.activeProjectiles.push(proj);
      this.itemRenderer.syncProjectiles(this.activeProjectiles);
    };

    networkClient.onMineSpawn = (mine: ActiveMine) => {
      this.activeMines.push(mine);
      this.itemRenderer.syncMines(this.activeMines);
    };

    networkClient.onPlayerHit = (targetId: string, attackerId?: string, itemType?: ItemType) => {
      if (targetId === networkClient.localPlayerId) {
        this.kartController.triggerHit();
        this.uiManager.showAnnouncement('SPUN OUT!', 1.2);
      }
    };

    networkClient.onRaceFinish = (results) => {
      this.isRacingActive = false;
      this.uiManager.showResults(results);
    };

    networkClient.onRematchVote = (votes, needed) => {
      this.uiManager.updateRematchStatus(votes, needed);
    };

    networkClient.onError = (msg) => {
      this.uiManager.showError('Notice', msg);
    };

    networkClient.onConnectionStatus = (connected, msg) => {
      this.uiManager.showConnectionStatus(connected, msg);
    };
  }

  private syncGridStartingPositions(state: RoomState) {
    const localId = networkClient.localPlayerId;
    if (!localId) return;

    const players = Object.values(state.players);
    const index = players.findIndex((p) => p.id === localId);
    if (index >= 0) {
      const pos = GRID_POSITIONS[index % GRID_POSITIONS.length];
      this.kartController.resetPosition(pos.x, 0.1, pos.z, 0);
    }
  }

  private syncRemoteKartMeshes(state: RoomState) {
    const localId = networkClient.localPlayerId;

    // Create local kart model if missing
    if (localId && state.players[localId] && !this.localKartModel) {
      const lp = state.players[localId];
      this.localKartModel = new KartModel(lp.color, lp.name);
      this.sceneManager.scene.add(this.localKartModel.mesh);
    }

    // Sync remote players
    const currentRemoteIds = new Set<string>();
    for (const [id, player] of Object.entries(state.players)) {
      if (id === localId) continue;
      currentRemoteIds.add(id);

      let model = this.remoteKartModels.get(id);
      if (!model) {
        model = new KartModel(player.color, player.name);
        this.sceneManager.scene.add(model.mesh);
        this.remoteKartModels.set(id, model);
      }
    }

    // Remove disconnected karts
    for (const [id, model] of this.remoteKartModels) {
      if (!currentRemoteIds.has(id)) {
        this.sceneManager.scene.remove(model.mesh);
        this.remoteKartModels.delete(id);
      }
    }
  }

  private gameLoop() {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = now;

    // 1. Process Input and update Local Kart Physics
    const input = this.pollInput();
    this.kartController.setInput(input);
    this.kartController.update(dt);

    // 2. Local Lap & Checkpoint Tracking
    if (this.isRacingActive) {
      const cpResult = this.checkpointTracker.update(this.kartController.position);
      this.kartController.currentLap = this.checkpointTracker.currentLap;
      this.kartController.lastCheckpoint = this.checkpointTracker.lastCheckpointIndex;
      this.kartController.progressDistance = this.checkpointTracker.totalProgressDistance;

      if (cpResult.lapCompleted) {
        if (cpResult.finished) {
          this.uiManager.showAnnouncement('FINISH!', 2.5);
          soundSystem.playFinishFanfare();
        } else if (this.checkpointTracker.currentLap === TOTAL_LAPS) {
          this.uiManager.showAnnouncement('FINAL LAP!', 1.8);
          soundSystem.playFinishFanfare();
        } else {
          this.uiManager.showAnnouncement(`LAP ${this.checkpointTracker.currentLap}/${TOTAL_LAPS}`, 1.4);
        }
      }

      // Check item box pickups
      const hitBoxId = this.itemManager.checkItemBoxCollision(this.kartController.position);
      if (hitBoxId !== null) {
        networkClient.collectItemBox(hitBoxId);
      }

      // Check mine collisions
      for (const mine of this.activeMines) {
        const dx = this.kartController.position.x - mine.x;
        const dy = this.kartController.position.y - mine.y;
        const dz = this.kartController.position.z - mine.z;
        if (dx * dx + dy * dy + dz * dz < 2.0 * 2.0) {
          networkClient.triggerMine(mine.id);
          break;
        }
      }
    }

    // 3. Update Local Kart 3D Mesh
    if (this.localKartModel) {
      this.localKartModel.mesh.position.copy(this.kartController.position);
      this.localKartModel.mesh.quaternion.copy(this.kartController.quaternion);
      this.localKartModel.update(
        this.kartController.speed,
        this.kartController.steerAngle,
        this.kartController.driftLevel,
        this.kartController.isBoosting,
        this.kartController.isShielded,
        this.kartController.isSpunOut,
        dt
      );
    }

    // 4. Update Remote Players (Interpolation & 3D Meshes)
    networkClient.updateInterpolation(dt);
    for (const [id, model] of this.remoteKartModels) {
      const trans = networkClient.remoteTransforms.get(id);
      if (trans) {
        model.mesh.position.set(trans.x, trans.y, trans.z);
        model.mesh.quaternion.set(trans.qx, trans.qy, trans.qz, trans.qw);
        model.update(
          trans.speed,
          trans.steerAngle,
          trans.driftLevel,
          trans.isBoosting,
          trans.isShielded,
          trans.isSpunOut,
          dt
        );
      }
    }

    // 5. Update Camera
    this.sceneManager.updateCamera(
      this.kartController.position,
      this.kartController.quaternion,
      this.kartController.speed,
      this.kartController.isBoosting,
      dt
    );

    // 6. Update Graphics & Particles
    this.trackRenderer.update(dt);
    this.itemRenderer.update(dt);

    // 7. Network Transmit (25Hz update rate)
    this.networkUpdateTimer += dt;
    if (this.networkUpdateTimer >= 0.04) {
      this.networkUpdateTimer = 0;
      if (networkClient.currentRoomState?.status === 'racing' && !this.checkpointTracker.isFinished) {
        const trans = this.kartController.getTransform();
        networkClient.sendKartUpdate({
          ...trans,
          currentLap: this.kartController.currentLap,
          lastCheckpoint: this.kartController.lastCheckpoint,
          progressDistance: this.kartController.progressDistance,
        });
      }
    }

    // 8. Update HUD & Minimap
    if (networkClient.currentRoomState) {
      const localId = networkClient.localPlayerId || '';
      const localPlayer = networkClient.currentRoomState.players[localId];
      const allPlayers = Object.values(networkClient.currentRoomState.players);

      this.uiManager.updateHUD(
        this.kartController.speed,
        localPlayer?.placement || 1,
        allPlayers.length,
        this.kartController.currentLap,
        this.kartController.driftLevel
      );
      this.uiManager.updateStandings(allPlayers, localId);

      this.minimap.render(
        localId,
        networkClient.currentRoomState.players,
        networkClient.remoteTransforms
      );
    }

    // 9. Render Three.js Scene
    this.sceneManager.render();

    requestAnimationFrame(this.gameLoop.bind(this));
  }
}

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  const app = new HyperKartApp();
  (window as any).__HYPERKART_APP__ = app;
});
