import {
  ActiveMine,
  ActiveProjectile,
  ItemBoxState,
  ItemType,
  KartColorId,
  KartTransform,
  PlayerState,
  RaceResultEntry,
  RoomState,
  RoomStatus,
} from '../shared/types.js';
import {
  COUNTDOWN_SECONDS,
  GRID_POSITIONS,
  MIN_PLAYERS_TO_START,
  MAX_PLAYERS,
  TOTAL_LAPS,
} from '../shared/constants.js';
import { trackCircuit } from '../shared/trackData.js';
import { Server, Socket } from 'socket.io';

interface ReconnectSession {
  playerId: string;
  token: string;
  disconnectTimeout?: NodeJS.Timeout;
}

export class RaceRoom {
  public code: string;
  public status: RoomStatus = 'lobby';
  public hostId: string;
  public players: Map<string, PlayerState> = new Map();
  public socketToPlayer: Map<string, string> = new Map();
  public playerToSocket: Map<string, string> = new Map();
  public reconnectTokens: Map<string, ReconnectSession> = new Map();

  private io: Server;
  private countdownTimer?: NodeJS.Timeout;
  private countdownValue: number = COUNTDOWN_SECONDS;
  private raceStartTime: number = 0;
  private winnerName: string | null = null;
  private itemBoxes: ItemBoxState[] = [];
  private activeProjectiles: Map<string, ActiveProjectile> = new Map();
  private activeMines: Map<string, ActiveMine> = new Map();
  private rematchVotes: Set<string> = new Set();
  private finishTimeout?: NodeJS.Timeout;

  constructor(code: string, hostId: string, io: Server) {
    this.code = code;
    this.hostId = hostId;
    this.io = io;
    this.initItemBoxes();
  }

  private initItemBoxes() {
    this.itemBoxes = trackCircuit.itemBoxes.map((b) => ({ ...b }));
  }

  public getPlayerCount(): number {
    return this.players.size;
  }

  public getConnectedPlayerCount(): number {
    let count = 0;
    for (const p of this.players.values()) {
      if (p.connected && !p.isSpectator) count++;
    }
    return count;
  }

  public addPlayer(
    socketId: string,
    playerId: string,
    name: string,
    color: KartColorId,
    reconnectToken: string
  ): PlayerState {
    const isHost = this.players.size === 0;
    if (isHost) {
      this.hostId = playerId;
    }

    const isSpectator = this.status === 'racing' || this.status === 'countdown';
    const gridIndex = Math.min(this.players.size, GRID_POSITIONS.length - 1);
    const gridPos = GRID_POSITIONS[gridIndex];

    const initialTransform: KartTransform = {
      x: gridPos.x,
      y: 0.1,
      z: gridPos.z,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      vx: 0,
      vy: 0,
      vz: 0,
      speed: 0,
      steerAngle: 0,
      driftLevel: 0,
      driftDirection: 0,
      isBoosting: false,
      isShielded: false,
      isSpunOut: false,
      isAirborne: false,
    };

    const player: PlayerState = {
      id: playerId,
      name: name.slice(0, 16).trim() || `Racer ${this.players.size + 1}`,
      color,
      isHost,
      isReady: true,
      isSpectator,
      connected: true,
      transform: initialTransform,
      currentLap: 1,
      lastCheckpoint: 0,
      progressDistance: 0,
      placement: this.players.size + 1,
      heldItem: null,
      lapTimes: [],
      finishTime: null,
      finished: false,
    };

    this.players.set(playerId, player);
    this.socketToPlayer.set(socketId, playerId);
    this.playerToSocket.set(playerId, socketId);
    this.reconnectTokens.set(playerId, { playerId, token: reconnectToken });

    return player;
  }

  public reconnectPlayer(socketId: string, playerId: string, token: string): PlayerState | null {
    const session = this.reconnectTokens.get(playerId);
    if (!session || session.token !== token) {
      return null;
    }

    if (session.disconnectTimeout) {
      clearTimeout(session.disconnectTimeout);
      session.disconnectTimeout = undefined;
    }

    const player = this.players.get(playerId);
    if (!player) return null;

    // Remove old socket mapping
    const oldSocketId = this.playerToSocket.get(playerId);
    if (oldSocketId) {
      this.socketToPlayer.delete(oldSocketId);
    }

    player.connected = true;
    this.socketToPlayer.set(socketId, playerId);
    this.playerToSocket.set(playerId, socketId);

    return player;
  }

  public handleDisconnect(socketId: string) {
    const playerId = this.socketToPlayer.get(socketId);
    if (!playerId) return;

    const player = this.players.get(playerId);
    if (!player) return;

    player.connected = false;
    this.socketToPlayer.delete(socketId);

    // If still in lobby, remove immediately or transfer host
    if (this.status === 'lobby') {
      this.removePlayer(playerId);
      return;
    }

    // During race, give a 60-second grace window to reconnect
    const session = this.reconnectTokens.get(playerId);
    if (session) {
      session.disconnectTimeout = setTimeout(() => {
        this.removePlayer(playerId);
      }, 60000);
    }
  }

  public removePlayer(playerId: string) {
    const player = this.players.get(playerId);
    if (!player) return;

    const socketId = this.playerToSocket.get(playerId);
    if (socketId) {
      this.socketToPlayer.delete(socketId);
      this.playerToSocket.delete(playerId);
    }
    this.reconnectTokens.delete(playerId);
    this.players.delete(playerId);
    this.rematchVotes.delete(playerId);

    // If host left, elect new host if players remain
    if (player.isHost && this.players.size > 0) {
      const nextHost = this.players.values().next().value;
      if (nextHost) {
        nextHost.isHost = true;
        this.hostId = nextHost.id;
      }
    }

    this.broadcastRoomState();
  }

  public startCountdown(): boolean {
    if (this.status !== 'lobby') return false;
    const connectedCount = this.getConnectedPlayerCount();
    if (connectedCount < MIN_PLAYERS_TO_START) return false;

    this.status = 'countdown';
    this.countdownValue = COUNTDOWN_SECONDS;
    this.rematchVotes.clear();
    this.winnerName = null;

    // Reset grid positions for all active players
    let i = 0;
    for (const player of this.players.values()) {
      if (player.connected) {
        player.isSpectator = false;
        player.currentLap = 1;
        player.lastCheckpoint = 0;
        player.progressDistance = 0;
        player.finished = false;
        player.finishTime = null;
        player.lapTimes = [];
        player.heldItem = null;

        const pos = GRID_POSITIONS[i % GRID_POSITIONS.length];
        player.transform.x = pos.x;
        player.transform.y = 0.1;
        player.transform.z = pos.z;
        player.transform.vx = 0;
        player.transform.vy = 0;
        player.transform.vz = 0;
        player.transform.speed = 0;
        player.transform.steerAngle = 0;
        player.transform.isBoosting = false;
        player.transform.isShielded = false;
        player.transform.isSpunOut = false;
        player.transform.isAirborne = false;
        i++;
      }
    }

    this.broadcastRoomState();

    this.countdownTimer = setInterval(() => {
      this.countdownValue--;
      this.io.to(this.code).emit('race_countdown', this.countdownValue);

      if (this.countdownValue <= 0) {
        if (this.countdownTimer) clearInterval(this.countdownTimer);
        this.startRace();
      }
    }, 1000);

    return true;
  }

  private startRace() {
    this.status = 'racing';
    this.raceStartTime = Date.now();
    this.io.to(this.code).emit('race_start', this.raceStartTime);
    this.broadcastRoomState();
  }

  public updatePlayerTransform(
    playerId: string,
    transform: KartTransform & { currentLap: number; lastCheckpoint: number; progressDistance: number }
  ) {
    const player = this.players.get(playerId);
    if (!player || player.finished) return;

    player.transform = transform;
    player.progressDistance = transform.progressDistance;

    // Lap & Checkpoint authoritative progression
    const totalCP = trackCircuit.checkpoints.length;
    const clientCP = transform.lastCheckpoint;

    // Only accept advancement in sequential order (or wrap around from totalCP-1 to 0)
    if (clientCP === (player.lastCheckpoint + 1) % totalCP) {
      player.lastCheckpoint = clientCP;

      // Completed a full circuit
      if (clientCP === 0 && player.lastCheckpoint === 0) {
        // Lap increment
        const now = Date.now();
        const prevTime =
          player.lapTimes.length > 0
            ? player.lapTimes.reduce((a, b) => a + b, 0)
            : 0;
        const lapTime = (now - this.raceStartTime - prevTime * 1000) / 1000;
        player.lapTimes.push(Math.max(1, lapTime));

        this.io.to(this.code).emit('lap_completed', {
          playerId,
          lap: player.currentLap,
          lapTime,
        });

        if (player.currentLap >= TOTAL_LAPS) {
          player.finished = true;
          player.finishTime = (now - this.raceStartTime) / 1000;
          if (!this.winnerName) {
            this.winnerName = player.name;
          }

          this.checkRaceEnd();
        } else {
          player.currentLap++;
        }
      }
    }

    this.updatePlacements();
  }

  private updatePlacements() {
    // Sort players by: finished players by finishTime ascending, active players by progress score descending
    const sorted = Array.from(this.players.values()).sort((a, b) => {
      if (a.finished && b.finished) {
        return (a.finishTime || 9999) - (b.finishTime || 9999);
      }
      if (a.finished) return -1;
      if (b.finished) return 1;

      const scoreA = (a.currentLap - 1) * 100000 + a.progressDistance;
      const scoreB = (b.currentLap - 1) * 100000 + b.progressDistance;
      return scoreB - scoreA;
    });

    sorted.forEach((p, idx) => {
      p.placement = idx + 1;
    });
  }

  public collectItemBox(playerId: string, boxId: number) {
    const box = this.itemBoxes.find((b) => b.id === boxId);
    if (!box || !box.active) return;

    const player = this.players.get(playerId);
    if (!player || player.heldItem) return;

    box.active = false;
    box.respawnTimer = 5.0; // 5 seconds respawn

    // Weighted item generation based on rank
    const rank = player.placement;
    let chosenItem: ItemType;
    const roll = Math.random();

    if (rank === 1) {
      // 1st place: Mostly Mines or Shields
      chosenItem = roll < 0.6 ? 'mine' : roll < 0.85 ? 'shield' : 'boost';
    } else if (rank <= 3) {
      // 2nd - 3rd place: Boosts, Rockets, Mines
      chosenItem = roll < 0.4 ? 'rocket' : roll < 0.7 ? 'boost' : 'shield';
    } else {
      // 4th+ place: Rockets & Nitro Boosts
      chosenItem = roll < 0.5 ? 'rocket' : roll < 0.85 ? 'boost' : 'shield';
    }

    player.heldItem = chosenItem;

    this.io.to(this.code).emit('item_collected', {
      boxId,
      playerId,
      item: chosenItem,
    });
  }

  public useItem(
    playerId: string,
    data: { item: ItemType; x: number; y: number; z: number; forwardX: number; forwardZ: number }
  ) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.heldItem = null;

    if (data.item === 'mine') {
      const mineId = `mine_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const mine: ActiveMine = {
        id: mineId,
        ownerId: playerId,
        x: data.x - data.forwardX * 3.0,
        y: data.y,
        z: data.z - data.forwardZ * 3.0,
      };
      this.activeMines.set(mineId, mine);
      this.io.to(this.code).emit('mine_spawn', mine);
    } else if (data.item === 'rocket') {
      const projId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      // Find target: next player ahead
      let targetPlayer: PlayerState | undefined;
      for (const p of this.players.values()) {
        if (p.id !== playerId && p.placement === player.placement - 1 && !p.finished) {
          targetPlayer = p;
          break;
        }
      }

      const proj: ActiveProjectile = {
        id: projId,
        type: 'rocket',
        ownerId: playerId,
        x: data.x + data.forwardX * 3.0,
        y: data.y + 0.5,
        z: data.z + data.forwardZ * 3.0,
        vx: data.forwardX * 55,
        vy: 0,
        vz: data.forwardZ * 55,
        targetId: targetPlayer?.id,
        lifeTime: 6.0,
      };
      this.activeProjectiles.set(projId, proj);
      this.io.to(this.code).emit('projectile_spawn', proj);
    } else if (data.item === 'boost') {
      player.transform.isBoosting = true;
      this.io.to(this.code).emit('item_used', {
        playerId,
        item: 'boost',
        x: data.x,
        y: data.y,
        z: data.z,
      });
    } else if (data.item === 'shield') {
      player.transform.isShielded = true;
      this.io.to(this.code).emit('item_used', {
        playerId,
        item: 'shield',
        x: data.x,
        y: data.y,
        z: data.z,
      });
    }
  }

  public triggerMine(mineId: string, triggeringPlayerId: string) {
    const mine = this.activeMines.get(mineId);
    if (!mine) return;

    this.activeMines.delete(mineId);
    const target = this.players.get(triggeringPlayerId);
    if (target && !target.transform.isShielded) {
      target.transform.isSpunOut = true;
      this.io.to(this.code).emit('player_hit', {
        targetId: triggeringPlayerId,
        attackerId: mine.ownerId,
        itemType: 'mine',
      });
    }
  }

  public updateTick(dt: number) {
    if (this.status !== 'racing') return;

    // Update item box respawn timers
    let boxesChanged = false;
    for (const box of this.itemBoxes) {
      if (!box.active) {
        box.respawnTimer -= dt;
        if (box.respawnTimer <= 0) {
          box.active = true;
          boxesChanged = true;
        }
      }
    }
    if (boxesChanged) {
      this.io.to(this.code).emit('item_spawn', this.itemBoxes);
    }

    // Update active projectiles
    for (const [id, proj] of this.activeProjectiles) {
      proj.lifeTime -= dt;
      if (proj.lifeTime <= 0) {
        this.activeProjectiles.delete(id);
        continue;
      }

      if (proj.targetId) {
        const target = this.players.get(proj.targetId);
        if (target) {
          const dx = target.transform.x - proj.x;
          const dy = target.transform.y - proj.y;
          const dz = target.transform.z - proj.z;
          const dist = Math.hypot(dx, dy, dz);

          if (dist < 3.0) {
            // Impact!
            if (!target.transform.isShielded) {
              target.transform.isSpunOut = true;
              this.io.to(this.code).emit('player_hit', {
                targetId: target.id,
                attackerId: proj.ownerId,
                itemType: 'rocket',
              });
            }
            this.activeProjectiles.delete(id);
            continue;
          }

          // Steer toward target
          const speed = 55;
          proj.vx = (dx / dist) * speed;
          proj.vz = (dz / dist) * speed;
        }
      }

      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      proj.z += proj.vz * dt;
    }
  }

  private checkRaceEnd() {
    let allFinished = true;
    for (const p of this.players.values()) {
      if (p.connected && !p.isSpectator && !p.finished) {
        allFinished = false;
        break;
      }
    }

    if (allFinished) {
      this.finishRace();
    } else if (!this.finishTimeout) {
      // First place finished: give remaining players 30s to finish
      this.finishTimeout = setTimeout(() => {
        this.finishRace();
      }, 30000);
    }
  }

  private finishRace() {
    if (this.status === 'finished') return;
    this.status = 'finished';
    if (this.finishTimeout) {
      clearTimeout(this.finishTimeout);
      this.finishTimeout = undefined;
    }

    this.updatePlacements();

    const results: RaceResultEntry[] = Array.from(this.players.values())
      .filter((p) => !p.isSpectator)
      .sort((a, b) => a.placement - b.placement)
      .map((p) => ({
        placement: p.placement,
        playerId: p.id,
        playerName: p.name,
        color: p.color,
        totalTime: p.finishTime || (Date.now() - this.raceStartTime) / 1000,
        lapTimes: p.lapTimes,
      }));

    this.io.to(this.code).emit('race_finish', results);
    this.broadcastRoomState();
  }

  public voteRematch(playerId: string) {
    this.rematchVotes.add(playerId);
    const needed = Math.max(1, Math.ceil(this.getConnectedPlayerCount() * 0.5));
    this.io.to(this.code).emit('rematch_vote', {
      votes: this.rematchVotes.size,
      needed,
    });

    const player = this.players.get(playerId);
    // If host votes rematch or majority votes rematch, reset to lobby
    if (player?.isHost || this.rematchVotes.size >= needed) {
      this.resetToLobby();
    }
  }

  public resetToLobby() {
    this.status = 'lobby';
    this.rematchVotes.clear();
    this.winnerName = null;
    this.activeMines.clear();
    this.activeProjectiles.clear();
    this.initItemBoxes();

    let i = 0;
    for (const p of this.players.values()) {
      p.finished = false;
      p.finishTime = null;
      p.lapTimes = [];
      p.currentLap = 1;
      p.lastCheckpoint = 0;
      p.progressDistance = 0;
      p.isSpectator = false;
      p.heldItem = null;

      const pos = GRID_POSITIONS[i % GRID_POSITIONS.length];
      p.transform.x = pos.x;
      p.transform.y = 0.1;
      p.transform.z = pos.z;
      p.transform.vx = 0;
      p.transform.vy = 0;
      p.transform.vz = 0;
      p.transform.speed = 0;
      p.transform.isBoosting = false;
      p.transform.isShielded = false;
      p.transform.isSpunOut = false;
      p.transform.isAirborne = false;
      i++;
    }

    this.broadcastRoomState();
  }

  public getRoomState(): RoomState {
    const playersObj: Record<string, PlayerState> = {};
    for (const [id, p] of this.players) {
      playersObj[id] = p;
    }

    return {
      code: this.code,
      status: this.status,
      hostId: this.hostId,
      players: playersObj,
      countdownSeconds: this.countdownValue,
      raceStartTime: this.raceStartTime,
      winnerName: this.winnerName,
    };
  }

  public broadcastRoomState() {
    this.io.to(this.code).emit('room_state', this.getRoomState());
  }

  public broadcastSync() {
    if (this.status !== 'racing') return;
    const transforms: Record<string, KartTransform> = {};
    for (const [id, p] of this.players) {
      if (p.connected) {
        transforms[id] = p.transform;
      }
    }
    this.io.to(this.code).emit('race_sync', transforms);
  }
}
