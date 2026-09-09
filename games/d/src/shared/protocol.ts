// Socket.IO protocol shared between client and server (types only).

export type RoomPhase = "lobby" | "countdown" | "racing" | "finished";

export interface PlayerInfo {
  playerId: string;
  name: string;
  color: string;
  connected: boolean;
  isHost: boolean;
  /** present while racing */
  progress?: ProgressInfo;
}

export interface ProgressInfo {
  lap: number; // laps completed (0..3)
  nextCp: number; // next checkpoint index expected (1..15, 0 = finish line)
  t: number; // track fraction 0..1
  finished: boolean;
  finishTimeMs?: number;
}

export interface StandingEntry {
  playerId: string;
  name: string;
  color: string;
  lap: number;
  nextCp: number;
  t: number;
  finished: boolean;
  finishTimeMs?: number;
  position: number;
  connected: boolean;
}

export interface RoomSnapshot {
  code: string;
  phase: RoomPhase;
  players: PlayerInfo[];
  countdownEndsAt?: number;
  raceStartedAt?: number;
  raceEndsAt?: number;
  serverNow: number;
  message?: string;
}

export interface KartReport {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  /** client-computed track fraction; server adopts it when far from its hint
      (respawn/reconnect), otherwise tracks locally for level-aware validation */
  t?: number;
}

export type ItemKind = "boost" | "slick";

export interface ServerToClientEvents {
  "room:snapshot": (snap: RoomSnapshot) => void;
  "race:countdown": (payload: { startsAt: number; serverNow: number }) => void;
  "race:started": (payload: { startedAt: number; serverNow: number }) => void;
  "race:standings": (standings: StandingEntry[]) => void;
  "race:results": (standings: StandingEntry[]) => void;
  "race:message": (payload: { text: string }) => void;
  "item:granted": (payload: { kind: ItemKind }) => void;
  "item:boxes": (taken: number[]) => void;
  "hazard:new": (payload: { id: string; ownerId: string; x: number; y: number; z: number }) => void;
  "hazard:gone": (payload: { id: string }) => void;
  "kart:peers": (peers: Record<string, KartReport & { name: string; color: string }>) => void;
  "room:error": (payload: { message: string }) => void;
}

export interface ClientToServerEvents {
  "room:create": (payload: { name: string; playerId?: string }) => void;
  "room:join": (payload: { code: string; name: string; playerId?: string }) => void;
  "room:leave": () => void;
  "race:start": () => void;
  "race:rematch": () => void;
  "kart:state": (report: KartReport) => void;
  "item:request": (payload: { boxId: number; x: number; y: number; z: number }) => void;
  "item:use": (payload: { kind: ItemKind; x: number; y: number; z: number }) => void;
}

export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
