/** Gameplay constants shared by client and server. */

export const GAME_NAME = 'Bumble Rally';
export const TOTAL_LAPS = 3;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

/** How often clients report their kart and the server broadcasts (Hz). */
export const NET_RATE = 20;
export const NET_INTERVAL_MS = 1000 / NET_RATE;

/** Countdown before the lights go green (ms). */
export const COUNTDOWN_MS = 4000;
/** Once the first racer finishes, everyone else has this long (ms). */
export const FINISH_GRACE_MS = 60_000;
/** A disconnected player may reconnect for this long (ms). */
export const RECONNECT_GRACE_MS = 90_000;
/** Rooms with nobody in them are deleted after this long (ms). */
export const EMPTY_ROOM_TTL_MS = 60_000;

/** Item box respawn time (ms). */
export const ITEM_BOX_RESPAWN_MS = 6000;

export type ItemKind = 'nectar' | 'honey' | 'wasp';

export const ITEM_INFO: Record<ItemKind, { label: string; hint: string; emoji: string }> = {
  nectar: { label: 'Nectar Boost', hint: 'A big burst of speed.', emoji: '🍯' },
  honey: { label: 'Honey Puddle', hint: 'Drops a sticky puddle behind you. Anyone who drives through it spins out.', emoji: '🫠' },
  wasp: { label: 'Angry Wasp', hint: 'Flies up the track and stings the next racer ahead.', emoji: '🐝' },
};

/** Kart handling (client-side physics; server only needs a few of these). */
export const KART = {
  maxSpeed: 34,
  maxReverse: 9,
  accel: 22,
  brake: 34,
  coast: 6,
  boostMaxSpeed: 48,
  boostAccel: 45,
  shoulderSpeedFactor: 0.55,
  gravity: 24,
  radius: 1.4,
  // steering (rad/s) at zero speed and at max speed
  steerLow: 2.3,
  steerHigh: 1.35,
  driftSteerMult: 1.55,
  driftMinSpeed: 12,
  driftChargeTime: 1.6,
  miniBoostTime: 0.8,
  superBoostTime: 1.6,
  nectarBoostTime: 2.2,
  padBoostTime: 1.3,
  spinTime: 1.3,
  honeySpinTime: 1.0,
  wallBounce: 0.45,
} as const;

export const WASP = {
  speed: 62,
  lifetimeMs: 7000,
  hitRadius: 3.2,
  /** ms before it can hit its own shooter */
  armDelayMs: 600,
} as const;

export const HONEY = {
  radius: 2.4,
  lifetimeMs: 90_000,
  maxPerRoom: 24,
} as const;

/** Kart colour palette (one per grid slot; players are assigned the first free one). */
export const KART_COLORS = [
  '#ffb703', // honey yellow
  '#ef476f', // raspberry
  '#06d6a0', // mint
  '#4cc9f0', // sky
  '#b5179e', // plum
  '#ff7b00', // tangerine
  '#8ac926', // leaf
  '#f4f1de', // cream
] as const;
