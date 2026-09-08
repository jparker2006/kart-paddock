/**
 * Shared protocol between the Harvest Rush client and server.
 * Kept dependency-free so both the Vite client build and the Node
 * server build can consume it.
 */

export const MAX_PLAYERS = 8;
export const TOTAL_LAPS = 3;
export const CODE_LEN = 4;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const COUNTDOWN_MS = 4600;
export const MIN_RACE_MS = 25000; // a valid 3-lap finish cannot be quicker
export const DISCONNECT_GRACE_MS = 60000; // how long a disconnected seat is kept
export const RESULTS_TIMEOUT_MS = 60000; // after first finisher, DNF the rest
export const STATE_RATE_HZ = 15;
export const MAX_NAME_LEN = 16;

export type ItemKind = 'boost' | 'slick' | 'rocket';
export type Phase = 'lobby' | 'countdown' | 'racing' | 'results';

export const CHARACTERS = [
  { name: 'Pumpkin', color: 0xff8a2a },
  { name: 'Berry', color: 0xe23b3b },
  { name: 'Corn', color: 0xf2c53d },
  { name: 'Cabbage', color: 0x63b04b },
  { name: 'Plum', color: 0x9a5bd0 },
  { name: 'Blueberry', color: 0x3b6fd6 },
  { name: 'Peach', color: 0xf28ba8 },
  { name: 'Turnip', color: 0xe8e2d0 },
] as const;
export const CHARACTER_COUNT = CHARACTERS.length;

export interface PlayerInfo {
  id: string;
  name: string;
  character: number;
  isHost: boolean;
  connected: boolean;
  /** Joined while a race was running; waits for the next one. */
  waiting: boolean;
}

export interface ResultRow {
  id: string;
  name: string;
  character: number;
  place: number; // 1-based; DNF rows sort last
  timeMs: number | null; // null = DNF
}

export interface RoomView {
  code: string;
  phase: Phase;
  players: PlayerInfo[];
  hostId: string;
  youId: string;
  serverNow: number;
  /** Server-clock timestamp the race starts (countdown target). */
  startAt?: number;
  results?: ResultRow[];
}

export interface JoinAck {
  ok: boolean;
  error?: string;
  token?: string;
  room?: RoomView;
}

/** Per-kart state the owning client broadcasts (~15 Hz). */
export interface KartState {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** signed forward speed (u/s) */
  sp: number;
  /** completed laps */
  lap: number;
  /** checkpoints collected in current lap (0..CP_COUNT) */
  cps: number;
  /** fractional progress toward next checkpoint (0..1) */
  prog: number;
  /** drifting */
  dr: 0 | 1;
  /** teleport counter (increments on respawn) */
  tp: number;
  /** boosting */
  bo: 0 | 1;
}

export interface StateBatch {
  p: KartState[];
  /** player ids sorted by race position (finished first, then progress) */
  order: string[];
}

export interface GridSlot {
  id: string;
  slot: number;
}

/** Snapshot sent to a client that reconnects mid-race. */
export interface RaceSnapshot {
  startAt: number;
  grid: GridSlot[];
  order: string[];
  yourLap: number;
  yourCps: number;
  yourItem: ItemKind | null;
  boxes: { box: number; until: number }[];
  slicks: SlickInfo[];
  projs: ProjInfo[];
  finished: { id: string; place: number; timeMs: number }[];
  serverNow: number;
}

export interface SlickInfo {
  id: number;
  owner: string;
  x: number;
  y: number;
  z: number;
  until: number;
}

export interface ProjInfo {
  id: number;
  owner: string;
  kind: 'rocket';
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  born: number;
}

// ---------- Client -> Server ----------

export interface CreateMsg {
  name: string;
  character: number;
}
export interface JoinMsg extends CreateMsg {
  code: string;
  token?: string;
}
export interface CharacterMsg {
  character: number;
}
export interface PickupMsg {
  box: number;
}
export interface PickupAck {
  ok: boolean;
  item?: ItemKind;
  cooldownUntil?: number;
}
export interface UseItemMsg {
  kind: ItemKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
}
export interface HitMsg {
  kind: 'spin' | 'slip';
  by?: string;
  proj?: number;
}
export interface FinishMsg {
  lap: number;
}
export interface Ack<T = void> {
  ok: boolean;
  error?: string;
  data?: T;
}

// ---------- Server -> Client ----------

export interface RaceStartMsg {
  startAt: number;
  grid: GridSlot[];
  serverNow: number;
}
export interface BoxMsg {
  box: number;
  until: number;
}
export interface ItemGrantMsg {
  kind: ItemKind;
}
export interface ProjSpawnMsg extends ProjInfo {}
export interface SlickSpawnMsg extends SlickInfo {}
export interface FxMsg {
  kart: string;
  kind: 'spin' | 'slip' | 'boost';
  until: number;
  proj?: number;
}
export interface GoneMsg {
  proj: number;
}
export interface FinishOneMsg {
  id: string;
  place: number;
  timeMs: number;
}
export interface ResultsMsg {
  rows: ResultRow[];
}
export interface ShutdownMsg {
  reason: string;
}
export interface KickMsg {
  reason: string;
}
