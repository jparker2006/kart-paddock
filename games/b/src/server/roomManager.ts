import type { Server } from 'socket.io';
import { randomInt } from 'node:crypto';
import { Room, type GameSocket, type Player } from './room.ts';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  isValidRoomCode,
  normaliseRoomCode,
  sanitisePlayerName,
  type ClientToServer,
  type JoinAck,
  type ServerToClient,
} from '../shared/protocol.ts';
import { EMPTY_ROOM_TTL_MS } from '../shared/constants.ts';

type IO = Server<ClientToServer, ServerToClient>;

interface Seat {
  room: Room;
  player: Player;
}

/**
 * Owns every room on this backend instance.  Everything lives in memory: this
 * process must stay alive for the duration of a race, which is why the game is
 * designed around one persistent Node service rather than serverless functions.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private seats = new Map<string, Seat>(); // socket.id -> seat
  private io: IO | null = null;

  constructor() {
    setInterval(() => this.sweep(), 5000).unref();
  }

  count(): number {
    return this.rooms.size;
  }

  playerCount(): number {
    let n = 0;
    for (const r of this.rooms.values()) n += r.connectedPlayers().length;
    return n;
  }

  private generateCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('could not allocate a room code');
  }

  private sweep(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      room.reap(now);
      const empty = room.emptySince();
      if ((empty !== null && now - empty > EMPTY_ROOM_TTL_MS) || room.size === 0) {
        room.destroy();
        this.rooms.delete(code);
        console.log(`[rooms] deleted empty room ${code}; ${this.rooms.size} rooms remain`);
      }
    }
  }

  attach(socket: GameSocket): void {
    if (!this.io) this.io = socket.nsp.server as IO;
    const io = this.io;

    const seatOf = (): Seat | undefined => this.seats.get(socket.id);

    const leaveCurrent = (reason: string) => {
      const seat = seatOf();
      if (!seat) return;
      this.seats.delete(socket.id);
      seat.room.removePlayer(seat.player, reason);
    };

    socket.on('room:create', (data, ack) => {
      try {
        if (typeof ack !== 'function') return;
        const name = sanitisePlayerName(String(data?.name ?? ''));
        if (!name) return ack({ ok: false, code: 'bad_name', message: 'Please enter a name.' });
        leaveCurrent('created another room');
        const room = new Room(this.generateCode(), io);
        this.rooms.set(room.code, room);
        console.log(`[rooms] created ${room.code}; ${this.rooms.size} rooms`);
        const result = room.addPlayer(socket, name);
        this.seats.set(socket.id, { room, player: room.players.get(result.playerId)! });
        ack(result);
      } catch (err) {
        console.error('[rooms] create failed', err);
        if (typeof ack === 'function') ack({ ok: false, code: 'server', message: 'Server error creating the room.' });
      }
    });

    socket.on('room:join', (data, ack) => {
      try {
        if (typeof ack !== 'function') return;
        const name = sanitisePlayerName(String(data?.name ?? ''));
        if (!name) return ack({ ok: false, code: 'bad_name', message: 'Please enter a name.' });
        const code = normaliseRoomCode(String(data?.code ?? ''));
        if (!isValidRoomCode(code)) {
          return ack({ ok: false, code: 'bad_code', message: 'Room codes are 5 letters/digits, like "BZK7Q".' });
        }
        const room = this.rooms.get(code);
        if (!room) {
          return ack({
            ok: false,
            code: 'not_found',
            message: `Room ${code} does not exist (or was closed when the server restarted).`,
          });
        }
        if (room.isFull()) return ack({ ok: false, code: 'full', message: `Room ${code} is full (8 racers).` });
        leaveCurrent('joined another room');
        const result = room.addPlayer(socket, name);
        this.seats.set(socket.id, { room, player: room.players.get(result.playerId)! });
        ack(result);
      } catch (err) {
        console.error('[rooms] join failed', err);
        if (typeof ack === 'function') ack({ ok: false, code: 'server', message: 'Server error joining the room.' });
      }
    });

    socket.on('room:resume', (data, ack) => {
      try {
        if (typeof ack !== 'function') return;
        const token = String(data?.token ?? '');
        const code = token.split('.')[0] ?? '';
        const room = this.rooms.get(code);
        const player = room?.findByToken(token);
        if (!room || !player) {
          const fail: JoinAck = {
            ok: false,
            code: 'expired',
            message: 'Your previous room is gone - the server restarted or the room closed. Start a new room.',
          };
          return ack(fail);
        }
        // detach any old seat this socket held
        const old = seatOf();
        if (old && old.player.id !== player.id) leaveCurrent('resumed a different seat');
        const result = room.resumePlayer(player, socket);
        this.seats.set(socket.id, { room, player });
        ack(result);
      } catch (err) {
        console.error('[rooms] resume failed', err);
        if (typeof ack === 'function') ack({ ok: false, code: 'server', message: 'Server error resuming.' });
      }
    });

    socket.on('room:leave', () => leaveCurrent('left'));

    socket.on('race:start', (ack) => {
      const seat = seatOf();
      if (!seat) return void (typeof ack === 'function' && ack({ ok: false, message: 'Not in a room.' }));
      seat.room.startRace(seat.player, typeof ack === 'function' ? ack : undefined);
    });

    socket.on('race:rematch', (ack) => {
      const seat = seatOf();
      if (!seat) return void (typeof ack === 'function' && ack({ ok: false, message: 'Not in a room.' }));
      seat.room.startRace(seat.player, typeof ack === 'function' ? ack : undefined);
    });

    socket.on('race:lobby', () => {
      const seat = seatOf();
      seat?.room.backToLobby(seat.player);
    });

    socket.on('kart:state', (msg) => {
      const seat = seatOf();
      if (seat) seat.room.onKartState(seat.player, msg);
    });

    socket.on('kart:respawn', (ack) => {
      const seat = seatOf();
      if (seat && typeof ack === 'function') seat.room.onRespawn(seat.player, ack);
    });

    socket.on('item:use', () => {
      const seat = seatOf();
      seat?.room.onItemUse(seat.player);
    });

    socket.on('time:ping', (_clientTime, ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });

    socket.on('disconnect', () => {
      const seat = seatOf();
      this.seats.delete(socket.id);
      if (seat && seat.player.socket?.id === socket.id) seat.room.handleDisconnect(seat.player);
    });
  }
}
