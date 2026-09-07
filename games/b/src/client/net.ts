import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServer,
  JoinAck,
  KartStateMsg,
  RaceEvent,
  RespawnAck,
  RoomState,
  ServerToClient,
  Snapshot,
} from '../shared/protocol.ts';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

type GameSocket = Socket<ServerToClient, ClientToServer>;

export interface NetHandlers {
  onStatus(status: ConnectionStatus, detail: string): void;
  onRoomState(state: RoomState): void;
  onSnapshot(snap: Snapshot): void;
  onEvent(ev: RaceEvent): void;
  onKicked(reason: string): void;
  /** fired after every (re)connect so the app can resume its seat */
  onConnected(): void;
}

/** Resolves the backend URL from the public build configuration. */
export function resolveServerUrl(): string {
  const raw = (import.meta.env.VITE_GAME_SERVER_URL as string | undefined)?.trim();
  const url = raw && raw.length > 0 ? raw : 'http://localhost:3001';
  return url.replace(/\/+$/, '');
}

export class Net {
  readonly socket: GameSocket;
  readonly serverUrl: string;
  status: ConnectionStatus = 'connecting';
  /** serverTime - clientTime (ms) */
  private offset = 0;
  private offsetSamples: number[] = [];
  private everConnected = false;

  constructor(private handlers: NetHandlers) {
    this.serverUrl = resolveServerUrl();
    this.socket = io(this.serverUrl, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 400,
      reconnectionDelayMax: 3000,
      timeout: 8000,
      withCredentials: false,
    });
    const s = this.socket;
    s.on('connect', () => {
      this.everConnected = true;
      this.setStatus('connected', 'Connected');
      void this.syncTime();
      this.handlers.onConnected();
    });
    s.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') return;
      const why =
        reason === 'io server disconnect'
          ? 'the server closed the connection'
          : reason === 'ping timeout'
            ? 'no reply from the server'
            : 'the connection dropped';
      this.setStatus('reconnecting', `Connection lost - ${why}. Reconnecting…`);
    });
    s.on('connect_error', (err) => {
      const detail = this.everConnected
        ? `Reconnecting to the game server… (${err.message})`
        : `Cannot reach the game server at ${this.serverUrl} (${err.message}). Retrying…`;
      this.setStatus(this.everConnected ? 'reconnecting' : 'offline', detail);
    });
    s.io.on('reconnect_attempt', () => {
      if (this.status !== 'reconnecting') this.setStatus('reconnecting', 'Reconnecting…');
    });
    s.on('room:state', (state) => this.handlers.onRoomState(state));
    s.on('race:snapshot', (snap) => this.handlers.onSnapshot(snap));
    s.on('race:event', (ev) => this.handlers.onEvent(ev));
    s.on('room:kicked', (reason) => this.handlers.onKicked(reason));
  }

  connect(): void {
    this.setStatus('connecting', `Connecting to ${this.serverUrl}…`);
    this.socket.connect();
  }

  private setStatus(status: ConnectionStatus, detail: string): void {
    this.status = status;
    this.handlers.onStatus(status, detail);
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  /** Current estimate of the server clock. */
  serverNow(): number {
    return Date.now() + this.offset;
  }

  private async syncTime(): Promise<void> {
    this.offsetSamples = [];
    for (let i = 0; i < 4; i++) {
      const t0 = Date.now();
      const serverTime = await this.emitAck<number>((ack) => this.socket.emit('time:ping', t0, ack), 3000).catch(
        () => null,
      );
      if (serverTime === null) continue;
      const t1 = Date.now();
      this.offsetSamples.push(serverTime - (t0 + t1) / 2);
    }
    if (this.offsetSamples.length) {
      const sorted = [...this.offsetSamples].sort((a, b) => a - b);
      this.offset = sorted[Math.floor(sorted.length / 2)];
    }
  }

  private emitAck<T>(fn: (ack: (r: T) => void) => void, timeoutMs = 8000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The server did not answer in time.')), timeoutMs);
      fn((r) => {
        clearTimeout(timer);
        resolve(r);
      });
    });
  }

  createRoom(name: string): Promise<JoinAck> {
    return this.emitAck<JoinAck>((ack) => this.socket.emit('room:create', { name }, ack));
  }

  joinRoom(name: string, code: string): Promise<JoinAck> {
    return this.emitAck<JoinAck>((ack) => this.socket.emit('room:join', { name, code }, ack));
  }

  resume(token: string): Promise<JoinAck> {
    return this.emitAck<JoinAck>((ack) => this.socket.emit('room:resume', { token }, ack));
  }

  leaveRoom(): void {
    this.socket.emit('room:leave');
  }

  startRace(): Promise<{ ok: boolean; message?: string }> {
    return this.emitAck((ack) => this.socket.emit('race:start', ack));
  }

  rematch(): Promise<{ ok: boolean; message?: string }> {
    return this.emitAck((ack) => this.socket.emit('race:rematch', ack));
  }

  backToLobby(): void {
    this.socket.emit('race:lobby');
  }

  sendKart(msg: KartStateMsg): void {
    if (this.socket.connected) this.socket.volatile.emit('kart:state', msg);
  }

  respawn(): Promise<RespawnAck> {
    return this.emitAck<RespawnAck>((ack) => this.socket.emit('kart:respawn', ack), 4000);
  }

  useItem(): void {
    this.socket.emit('item:use');
  }
}
