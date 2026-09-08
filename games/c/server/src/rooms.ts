import type { Server, Socket } from 'socket.io';
import {
  MAX_PLAYERS,
  CODE_LEN,
  CODE_ALPHABET,
  CHARACTER_COUNT,
  MAX_NAME_LEN,
  DISCONNECT_GRACE_MS,
  type PlayerInfo,
  type Phase,
  type RoomView,
  type ItemKind,
  type KartState,
} from '../../src/shared/protocol.js';
import type { Race } from './race.js';

const MAX_ROOMS = 400;

export interface Player {
  id: string;
  name: string;
  character: number;
  isHost: boolean;
  token: string;
  socketId: string | null;
  connected: boolean;
  waiting: boolean;
  joinedAt: number;
  disconnectAt: number | null;
  // race bookkeeping (server-side mirror of progress)
  lastState: KartState | null;
  item: ItemKind | null;
  place: number | null;
  finishTimeMs: number | null;
}

export class Room {
  code: string;
  players = new Map<string, Player>();
  phase: Phase = 'lobby';
  race: Race | null = null;
  createdAt = Date.now();
  emptySince: number | null = null;

  constructor(code: string) {
    this.code = code;
  }

  info(forPlayerId: string): RoomView {
    const players: PlayerInfo[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      character: p.character,
      isHost: p.isHost,
      connected: p.connected,
      waiting: p.waiting,
    }));
    const view: RoomView = {
      code: this.code,
      phase: this.phase,
      players,
      hostId: [...this.players.values()].find((p) => p.isHost)?.id ?? '',
      youId: forPlayerId,
      serverNow: Date.now(),
    };
    if (this.phase === 'countdown' || this.phase === 'racing') {
      view.startAt = this.race?.startAt;
    }
    if (this.phase === 'results' && this.race) {
      view.results = this.race.results;
      view.startAt = this.race.startAt;
    }
    return view;
  }

  connectedPlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.connected);
  }

  racingPlayers(): Player[] {
    return [...this.players.values()].filter((p) => !p.waiting);
  }

  broadcast(io: Server, event: string, payload?: unknown): void {
    io.to(this.code).emit(event, payload);
  }

  emitRoom(io: Server): void {
    for (const p of this.players.values()) {
      io.to(p.socketId ?? '').emit('room', this.info(p.id));
    }
  }
}

function randomCode(): string {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

function randomToken(): string {
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Date.now().toString(36)
  );
}

export class RoomManager {
  rooms = new Map<string, Room>();
  tokenIndex = new Map<string, { room: Room; player: Player }>();

  constructor(private io: Server) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  get playerCount(): number {
    let n = 0;
    for (const r of this.rooms.values()) n += r.players.size;
    return n;
  }

  createRoom(name: string, character: number): { room: Room; player: Player } | { error: string } {
    if (this.rooms.size >= MAX_ROOMS) return { error: 'The game server is busy right now. Try again in a minute.' };
    let code = randomCode();
    let tries = 0;
    while (this.rooms.has(code) && tries++ < 50) code = randomCode();
    if (this.rooms.has(code)) return { error: 'Could not allocate a room code. Try again.' };
    const room = new Room(code);
    this.rooms.set(code, room);
    const player = this.addPlayer(room, name, character);
    player.isHost = true;
    return { room, player };
  }

  joinRoom(code: string, name: string, character: number, token?: string, newSocketId?: string): { room: Room; player: Player } | { error: string } {
    if (token) return this.rejoin(token, newSocketId);
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: `No room found with code ${code.toUpperCase()}.` };
    if (room.players.size >= MAX_PLAYERS) return { error: 'That room is full (8 racers max).' };
    const player = this.addPlayer(room, name, character);
    if (room.phase === 'countdown' || room.phase === 'racing' || room.phase === 'results') {
      player.waiting = true;
    }
    return { room, player };
  }

  private rejoin(token: string, newSocketId?: string): { room: Room; player: Player } | { error: string } {
    const hit = this.tokenIndex.get(token);
    if (!hit) return { error: 'Your session expired. Join the room again with its code.' };
    const { room, player } = hit;
    if (!room.players.has(player.id)) return { error: 'Your session expired. Join the room again with its code.' };
    if (player.connected && player.socketId) {
      // A live seat exists (e.g. a quick page reload before the old socket
      // timed out): take the seat over from the stale socket.
      const old = this.io.sockets.sockets.get(player.socketId);
      if (old && newSocketId && old.id !== newSocketId) old.disconnect(true);
      player.connected = false;
    }
    player.connected = true;
    player.disconnectAt = null;
    player.waiting = player.waiting && (room.phase === 'racing' || room.phase === 'countdown' || room.phase === 'results');
    return { room, player };
  }

  private addPlayer(room: Room, name: string, character: number): Player {
    const player: Player = {
      id: 'p' + randomToken().slice(0, 10),
      name: sanitizeName(name),
      character: normalizeCharacter(character),
      isHost: false,
      token: randomToken(),
      socketId: null,
      connected: true,
      waiting: false,
      joinedAt: Date.now(),
      disconnectAt: null,
      lastState: null,
      item: null,
      place: null,
      finishTimeMs: null,
    };
    room.players.set(player.id, player);
    this.tokenIndex.set(player.token, { room, player });
    return player;
  }

  leaveRoom(socketId: string): void {
    for (const room of this.rooms.values()) {
      for (const p of room.players.values()) {
        if (p.socketId === socketId) {
          this.disconnectPlayer(room, p, true);
          return;
        }
      }
    }
  }

  /** Player's socket dropped. left=true means voluntary (remove faster). */
  disconnectPlayer(room: Room, player: Player, left: boolean): void {
    player.connected = false;
    player.socketId = null;
    player.disconnectAt = Date.now();
    if (left) {
      // Voluntary leave: drop from lobby instantly; from a race, keep the seat
      // briefly in case of an accidental tab close, but mark DNF-able.
      if (room.phase === 'lobby' || room.phase === 'results') {
        this.removePlayer(room, player);
        room.emitRoom(this.io);
        return;
      }
    }
    // Keep the seat for reconnect grace; the sweeper finalizes removal.
    room.emitRoom(this.io);
  }

  removePlayer(room: Room, player: Player): void {
    room.players.delete(player.id);
    this.tokenIndex.delete(player.token);
    if (player.isHost) this.migrateHost(room);
  }

  migrateHost(room: Room): void {
    const candidates = [...room.players.values()].sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      return a.joinedAt - b.joinedAt;
    });
    if (candidates[0]) {
      candidates[0].isHost = true;
    }
  }

  attach(socket: Socket, room: Room, player: Player): void {
    player.socketId = socket.id;
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);
  }

  /** Periodic cleanup: remove stale disconnected players and dead rooms. */
  sweep(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      let changed = false;
      for (const p of [...room.players.values()]) {
        if (!p.connected && p.disconnectAt && now - p.disconnectAt > DISCONNECT_GRACE_MS) {
          this.removePlayer(room, p);
          changed = true;
        }
      }
      const anyConnected = room.players.size > 0 && room.connectedPlayers().length > 0;
      if (!anyConnected) {
        if (room.emptySince === null) room.emptySince = now;
        if (now - room.emptySince > 30000) {
          for (const p of room.players.values()) this.tokenIndex.delete(p.token);
          this.rooms.delete(code);
          continue;
        }
      } else {
        room.emptySince = null;
      }
      if (changed) {
        if (room.phase === 'racing' || room.phase === 'countdown') {
          room.race?.checkAllFinished(room, this.io);
        }
        room.emitRoom(this.io);
      }
    }
  }
}

export function sanitizeName(name: string): string {
  const t = String(name ?? '')
    .replace(/[^\p{L}\p{N} _'-.]/gu, '')
    .trim()
    .slice(0, MAX_NAME_LEN);
  return t.length ? t : 'Racer';
}

export function normalizeCharacter(c: number): number {
  const n = Math.floor(Number(c));
  if (!Number.isFinite(n) || n < 0 || n >= CHARACTER_COUNT) return 0;
  return n;
}
