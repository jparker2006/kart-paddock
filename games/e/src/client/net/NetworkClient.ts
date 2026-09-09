import { io, Socket } from 'socket.io-client';
import {
  ActiveMine,
  ActiveProjectile,
  ClientToServerEvents,
  ItemBoxState,
  ItemType,
  KartColorId,
  KartTransform,
  PlayerState,
  RaceResultEntry,
  RoomState,
  ServerToClientEvents,
} from '../../shared/types.js';

export interface RemotePlayerInterpolation {
  current: KartTransform;
  target: KartTransform;
  lastUpdateTime: number;
}

export class NetworkClient {
  public socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  public localPlayerId: string | null = null;
  public currentRoomState: RoomState | null = null;
  public remoteTransforms: Map<string, KartTransform> = new Map();
  public interpolationTargets: Map<string, RemotePlayerInterpolation> = new Map();

  // Callbacks
  public onRoomStateChanged?: (state: RoomState) => void;
  public onCountdown?: (seconds: number) => void;
  public onRaceStart?: (startTime: number) => void;
  public onItemSpawn?: (boxes: ItemBoxState[]) => void;
  public onItemCollected?: (boxId: number, playerId: string, item: ItemType) => void;
  public onProjectileSpawn?: (proj: ActiveProjectile) => void;
  public onMineSpawn?: (mine: ActiveMine) => void;
  public onPlayerHit?: (targetId: string, attackerId?: string, itemType?: ItemType) => void;
  public onRaceFinish?: (results: RaceResultEntry[]) => void;
  public onRematchVote?: (votes: number, needed: number) => void;
  public onError?: (message: string) => void;
  public onConnectionStatus?: (connected: boolean, message?: string) => void;

  private serverUrl: string;

  constructor() {
    // Resolve server URL from env or fallback
    const metaEnvUrl = (import.meta as any).env?.VITE_GAME_SERVER_URL;
    this.serverUrl = metaEnvUrl || 'http://localhost:3001';
  }

  public connect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket && this.socket.connected) {
        return resolve();
      }

      this.socket = io(this.serverUrl, {
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        transports: ['websocket', 'polling'],
      });

      this.socket.on('connect', () => {
        this.onConnectionStatus?.(true);
        // Check if we have an active saved session to rejoin
        this.checkAutoRejoin();
        resolve();
      });

      this.socket.on('disconnect', (reason) => {
        this.onConnectionStatus?.(false, 'Disconnected from server. Reconnecting...');
      });

      this.socket.on('connect_error', (err) => {
        this.onConnectionStatus?.(false, 'Cannot reach server. Retrying...');
      });

      this.socket.on('joined_room', ({ roomCode, playerId, reconnectToken }) => {
        this.localPlayerId = playerId;
        this.saveSession(roomCode, playerId, reconnectToken);
        if (this.currentRoomState) {
          this.onRoomStateChanged?.(this.currentRoomState);
        }
      });

      this.socket.on('room_state', (state) => {
        this.currentRoomState = state;
        // Find local player ID if not set
        if (!this.localPlayerId && this.socket?.id) {
          const session = this.getSession();
          if (session?.playerId && state.players[session.playerId]) {
            this.localPlayerId = session.playerId;
          }
        }
        this.onRoomStateChanged?.(state);
      });

      this.socket.on('race_countdown', (sec) => {
        this.onCountdown?.(sec);
      });

      this.socket.on('race_start', (startTime) => {
        this.onRaceStart?.(startTime);
      });

      this.socket.on('race_sync', (transforms) => {
        const now = performance.now();
        for (const [id, trans] of Object.entries(transforms)) {
          if (id === this.localPlayerId) continue;

          let interp = this.interpolationTargets.get(id);
          if (!interp) {
            interp = {
              current: { ...trans },
              target: { ...trans },
              lastUpdateTime: now,
            };
            this.interpolationTargets.set(id, interp);
            this.remoteTransforms.set(id, interp.current);
          } else {
            interp.current = { ...interp.target };
            interp.target = { ...trans };
            interp.lastUpdateTime = now;
          }
        }
      });

      this.socket.on('item_spawn', (boxes) => {
        this.onItemSpawn?.(boxes);
      });

      this.socket.on('item_collected', ({ boxId, playerId, item }) => {
        this.onItemCollected?.(boxId, playerId, item);
      });

      this.socket.on('projectile_spawn', (proj) => {
        this.onProjectileSpawn?.(proj);
      });

      this.socket.on('mine_spawn', (mine) => {
        this.onMineSpawn?.(mine);
      });

      this.socket.on('player_hit', ({ targetId, attackerId, itemType }) => {
        this.onPlayerHit?.(targetId, attackerId, itemType);
      });

      this.socket.on('race_finish', (results) => {
        this.onRaceFinish?.(results);
      });

      this.socket.on('rematch_vote', ({ votes, needed }) => {
        this.onRematchVote?.(votes, needed);
      });

      this.socket.on('error_message', (msg) => {
        this.onError?.(msg);
      });
    });
  }

  private getSession(): { roomCode: string; playerId: string; reconnectToken: string } | null {
    try {
      const raw = sessionStorage.getItem('hyperkart_session');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private saveSession(roomCode: string, playerId: string, reconnectToken: string) {
    try {
      sessionStorage.setItem(
        'hyperkart_session',
        JSON.stringify({ roomCode, playerId, reconnectToken })
      );
    } catch (e) {
      console.warn('Could not save session:', e);
    }
  }

  public clearSession() {
    try {
      sessionStorage.removeItem('hyperkart_session');
    } catch {}
  }

  private checkAutoRejoin() {
    const session = this.getSession();
    if (session && session.roomCode && session.playerId && session.reconnectToken) {
      this.localPlayerId = session.playerId;
      this.socket?.emit('rejoin_room', {
        roomCode: session.roomCode,
        playerId: session.playerId,
        reconnectToken: session.reconnectToken,
      });
    }
  }

  public createRoom(playerName: string, color: KartColorId) {
    if (!this.socket) return;
    this.socket.emit('create_room', { playerName, color });
  }

  public joinRoom(roomCode: string, playerName: string, color: KartColorId) {
    if (!this.socket) return;
    this.socket.emit('join_room', { roomCode, playerName, color });
  }

  public selectColor(color: KartColorId) {
    this.socket?.emit('select_color', color);
  }

  public startRace() {
    this.socket?.emit('start_race');
  }

  public sendKartUpdate(
    transform: KartTransform & { currentLap: number; lastCheckpoint: number; progressDistance: number }
  ) {
    this.socket?.emit('kart_update', transform);
  }

  public collectItemBox(boxId: number) {
    this.socket?.emit('collect_item_box', boxId);
  }

  public useItem(item: ItemType, x: number, y: number, z: number, forwardX: number, forwardZ: number) {
    this.socket?.emit('use_item', { item, x, y, z, forwardX, forwardZ });
  }

  public triggerMine(mineId: string) {
    this.socket?.emit('mine_triggered', mineId);
  }

  public requestRematch() {
    this.socket?.emit('request_rematch');
  }

  public updateInterpolation(dt: number) {
    const lerpFactor = Math.min(1.0, dt * 15.0);

    for (const [id, interp] of this.interpolationTargets) {
      const cur = interp.current;
      const tgt = interp.target;

      cur.x += (tgt.x - cur.x) * lerpFactor;
      cur.y += (tgt.y - cur.y) * lerpFactor;
      cur.z += (tgt.z - cur.z) * lerpFactor;

      cur.speed = tgt.speed;
      cur.steerAngle = tgt.steerAngle;
      cur.driftLevel = tgt.driftLevel;
      cur.isBoosting = tgt.isBoosting;
      cur.isShielded = tgt.isShielded;
      cur.isSpunOut = tgt.isSpunOut;

      this.remoteTransforms.set(id, cur);
    }
  }
}

export const networkClient = new NetworkClient();
