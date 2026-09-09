export type KartColorId =
  | 'cyan'
  | 'crimson'
  | 'lime'
  | 'yellow'
  | 'violet'
  | 'magenta'
  | 'frost'
  | 'onyx';

export interface KartColorInfo {
  id: KartColorId;
  name: string;
  primary: number; // Hex color
  secondary: number;
  glow: number;
}

export type ItemType = 'rocket' | 'mine' | 'boost' | 'shield';

export interface PlayerInput {
  throttle: number; // -1 to 1
  steer: number;    // -1 to 1
  drift: boolean;
  useItem: boolean;
  respawn: boolean;
}

export interface KartTransform {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vy: number;
  vz: number;
  speed: number;
  steerAngle: number;
  driftLevel: number; // 0=none, 1=blue, 2=orange, 3=purple
  driftDirection: number; // -1, 0, 1
  isBoosting: boolean;
  isShielded: boolean;
  isSpunOut: boolean;
  isAirborne: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  color: KartColorId;
  isHost: boolean;
  isReady: boolean;
  isSpectator: boolean;
  connected: boolean;
  transform: KartTransform;
  currentLap: number;
  lastCheckpoint: number;
  progressDistance: number;
  placement: number;
  heldItem: ItemType | null;
  lapTimes: number[];
  finishTime: number | null;
  finished: boolean;
}

export type RoomStatus = 'lobby' | 'countdown' | 'racing' | 'finished';

export interface RoomState {
  code: string;
  status: RoomStatus;
  hostId: string;
  players: Record<string, PlayerState>;
  countdownSeconds: number;
  raceStartTime: number;
  winnerName: string | null;
}

export interface ItemBoxState {
  id: number;
  x: number;
  y: number;
  z: number;
  active: boolean;
  respawnTimer: number;
}

export interface ActiveProjectile {
  id: string;
  type: ItemType;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  targetId?: string;
  lifeTime: number;
}

export interface ActiveMine {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  z: number;
}

export interface CheckpointData {
  index: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number; // Track direction forward normal
  width: number;
}

export interface RaceResultEntry {
  placement: number;
  playerId: string;
  playerName: string;
  color: KartColorId;
  totalTime: number;
  lapTimes: number[];
}

// Socket event payloads
export interface ServerToClientEvents {
  joined_room: (data: { roomCode: string; playerId: string; reconnectToken: string }) => void;
  room_state: (state: RoomState) => void;
  player_joined: (player: PlayerState) => void;
  player_left: (playerId: string) => void;
  race_countdown: (seconds: number) => void;
  race_start: (startTime: number) => void;
  race_sync: (players: Record<string, KartTransform>) => void;
  item_spawn: (boxes: ItemBoxState[]) => void;
  item_collected: (data: { boxId: number; playerId: string; item: ItemType }) => void;
  item_used: (data: { playerId: string; item: ItemType; x: number; y: number; z: number }) => void;
  projectile_spawn: (projectile: ActiveProjectile) => void;
  mine_spawn: (mine: ActiveMine) => void;
  player_hit: (data: { targetId: string; attackerId?: string; itemType: ItemType }) => void;
  lap_completed: (data: { playerId: string; lap: number; lapTime: number }) => void;
  race_finish: (results: RaceResultEntry[]) => void;
  rematch_vote: (data: { votes: number; needed: number }) => void;
  error_message: (message: string) => void;
}

export interface ClientToServerEvents {
  create_room: (data: { playerName: string; color: KartColorId }) => void;
  join_room: (data: { roomCode: string; playerName: string; color: KartColorId; reconnectToken?: string }) => void;
  rejoin_room: (data: { roomCode: string; playerId: string; reconnectToken: string }) => void;
  select_color: (color: KartColorId) => void;
  start_race: () => void;
  kart_update: (transform: KartTransform & { currentLap: number; lastCheckpoint: number; progressDistance: number }) => void;
  collect_item_box: (boxId: number) => void;
  use_item: (data: { item: ItemType; x: number; y: number; z: number; forwardX: number; forwardZ: number }) => void;
  mine_triggered: (mineId: string) => void;
  respawn_request: () => void;
  request_rematch: () => void;
}
