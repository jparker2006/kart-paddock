import { Server } from 'socket.io';
import { RaceRoom } from './RaceRoom.js';

export class RoomManager {
  private rooms: Map<string, RaceRoom> = new Map();
  private io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  public generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let attempts = 0; attempts < 100; attempts++) {
      code = '';
      for (let i = 0; i < 5; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    return `KART${Math.floor(100 + Math.random() * 900)}`;
  }

  public createRoom(hostId: string): RaceRoom {
    const code = this.generateRoomCode();
    const room = new RaceRoom(code, hostId, this.io);
    this.rooms.set(code, room);
    return room;
  }

  public getRoom(code: string): RaceRoom | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  public deleteRoom(code: string) {
    this.rooms.delete(code.toUpperCase());
  }

  public getRoomCount(): number {
    return this.rooms.size;
  }

  public updateTick(dt: number) {
    for (const [code, room] of this.rooms) {
      if (room.getPlayerCount() === 0) {
        this.rooms.delete(code);
      } else {
        room.updateTick(dt);
        room.broadcastSync();
      }
    }
  }
}
