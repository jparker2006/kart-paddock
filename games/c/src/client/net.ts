import { io, type Socket } from 'socket.io-client';
import {
  type Ack,
  type CharacterMsg,
  type CreateMsg,
  type FinishMsg,
  type HitMsg,
  type JoinAck,
  type JoinMsg,
  type KartState,
  type PickupAck,
  type PickupMsg,
  type RaceSnapshot,
  type RoomView,
  type StateBatch,
  type UseItemMsg,
} from '../shared/protocol';

type Listener = (payload: any) => void;

export type ConnState = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'down';

/**
 * Thin typed wrapper around the socket connection with reconnection
 * bookkeeping. The socket URL comes from build-time env so the client can be
 * hosted statically anywhere.
 */
export class Net {
  socket: Socket | null = null;
  connState: ConnState = 'idle';
  onConn: ((s: ConnState, detail?: string) => void) | null = null;
  onRoom: Listener | null = null;
  onStateBatch: Listener | null = null;
  onSnapshot: Listener | null = null;
  onEvent: Listener | null = null; // generic passthrough for race events

  private serverUrl: string = (import.meta.env.VITE_GAME_SERVER_URL as string) || 'http://localhost:3001';
  private everConnected = false;
  private whenConnected: Promise<void> = Promise.resolve();

  connect(): void {
    if (this.socket) return;
    this.setConn('connecting');
    this.socket = io(this.serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 600,
      reconnectionDelayMax: 4000,
      timeout: 8000,
    });
    this.whenConnected = new Promise<void>((resolve, reject) => {
      const s = this.socket!;
      s.once('connect', () => resolve());
      s.once('connect_error', () => reject(new Error('connect_error')));
    });
    const s = this.socket;
    s.on('connect', () => {
      const wasDown = this.connState === 'reconnecting' || this.connState === 'down';
      this.everConnected = true;
      this.setConn('online');
      if (wasDown) this.onEvent?.({ ev: 'reconnected' });
    });
    s.on('disconnect', (reason: string) => {
      if (reason === 'io server disconnect') {
        // server told us to go; do not auto-reconnect
        this.setConn('down', 'The server closed the connection.');
      } else {
        this.setConn('reconnecting');
      }
    });
    s.on('connect_error', (err: Error) => {
      // Surface a clear message instead of a silently stale screen.
      if (!this.everConnected) {
        this.setConn('down', `Could not reach the game server at ${this.serverUrl}. ${err.message}`);
      }
    });
    s.on('room', (v: RoomView) => this.onRoom?.(v));
    s.on('s', (b: StateBatch) => this.onStateBatch?.(b));
    s.on('race:snapshot', (snap: RaceSnapshot) => this.onSnapshot?.(snap));
    for (const ev of [
      'race:start',
      'box',
      'item',
      'proj',
      'slick',
      'fx',
      'gone',
      'finish',
      'results',
      'shutdown',
      'kick',
    ]) {
      s.on(ev, (payload: unknown) => this.onEvent?.({ ev, payload }));
    }
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.everConnected = false;
    this.setConn('idle');
  }

  create(msg: CreateMsg): Promise<JoinAck> {
    return this.emit('room:create', msg);
  }
  join(msg: JoinMsg): Promise<JoinAck> {
    return this.emit('room:join', msg);
  }
  setCharacter(msg: CharacterMsg): void {
    this.socket?.emit('room:character', msg);
  }
  start(): Promise<Ack> {
    return this.emit('room:start');
  }
  rematch(): Promise<Ack> {
    return this.emit('room:rematch');
  }
  backToLobby(): Promise<Ack> {
    return this.emit('room:lobby');
  }
  leave(): void {
    this.socket?.emit('room:leave');
  }
  sendState(s: KartState): void {
    this.socket?.emit('state', s);
  }
  pickup(msg: PickupMsg): Promise<PickupAck> {
    return this.emit('pickup', msg);
  }
  useItem(msg: UseItemMsg): void {
    this.socket?.emit('item:use', msg);
  }
  hit(msg: HitMsg): void {
    this.socket?.emit('item:hit', msg);
  }
  finish(msg: FinishMsg): void {
    this.socket?.emit('race:finish', msg);
  }

  private async emit<T>(event: string, msg?: unknown): Promise<T> {
    try {
      await this.whenConnected;
    } catch {
      return { ok: false, error: 'Could not reach the game server.' } as T;
    }
    if (!this.socket?.connected) {
      return { ok: false, error: 'Not connected.' } as T;
    }
    return new Promise((resolve) => {
      this.socket!.timeout(6000).emit(event, msg, (err: unknown, resp: T) => {
        if (err) resolve({ ok: false, error: 'The server did not respond.' } as T);
        else resolve(resp);
      });
    });
  }

  private setConn(s: ConnState, detail?: string): void {
    this.connState = s;
    this.onConn?.(s, detail);
  }
}
