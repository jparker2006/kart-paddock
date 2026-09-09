import { KartColorId, KartColorInfo } from './types.js';

export const TOTAL_LAPS = 3;
export const MIN_PLAYERS_TO_START = 2;
export const MAX_PLAYERS = 8;
export const COUNTDOWN_SECONDS = 3;
export const SERVER_TICK_RATE = 30; // 30Hz

export const KART_COLORS: Record<KartColorId, KartColorInfo> = {
  cyan: {
    id: 'cyan',
    name: 'Nova Cyan',
    primary: 0x00f3ff,
    secondary: 0x0a192f,
    glow: 0x00f3ff,
  },
  crimson: {
    id: 'crimson',
    name: 'Crimson Comet',
    primary: 0xff0055,
    secondary: 0x220510,
    glow: 0xff3366,
  },
  lime: {
    id: 'lime',
    name: 'Neon Viper',
    primary: 0x39ff14,
    secondary: 0x052205,
    glow: 0x55ff33,
  },
  yellow: {
    id: 'yellow',
    name: 'Solar Flare',
    primary: 0xffd700,
    secondary: 0x2b2200,
    glow: 0xffea00,
  },
  violet: {
    id: 'violet',
    name: 'Void Phantom',
    primary: 0x8a2be2,
    secondary: 0x1a052b,
    glow: 0xa855f7,
  },
  magenta: {
    id: 'magenta',
    name: 'Cyber Coral',
    primary: 0xff00aa,
    secondary: 0x2a001a,
    glow: 0xff33cc,
  },
  frost: {
    id: 'frost',
    name: 'Frost Byte',
    primary: 0xe0f7fa,
    secondary: 0x102027,
    glow: 0x80deea,
  },
  onyx: {
    id: 'onyx',
    name: 'Shadow Stealth',
    primary: 0x263238,
    secondary: 0xff6600,
    glow: 0xff6600,
  },
};

export const PHYSICS_CONFIG = {
  maxSpeed: 42.0,            // Normal top speed m/s
  boostSpeed: 58.0,          // Top speed during Nitro/Boost Pad
  reverseMaxSpeed: 14.0,     // Reverse top speed
  acceleration: 24.0,        // m/s^2
  boostAcceleration: 45.0,
  braking: 35.0,             // m/s^2
  drag: 0.12,                // Air resistance
  rollingFriction: 3.5,      // Ground resistance
  offroadSpeedMultiplier: 0.45,
  steerSpeed: 2.5,           // Rad/s turning rate
  steerGrip: 8.0,            // Lateral friction grip
  driftSteerMultiplier: 1.45,
  driftMinSpeed: 8.0,
  gravity: 28.0,             // Downward gravity
  jumpForce: 13.0,           // Launch ramp impulse
  driftTier1Time: 0.75,      // Blue sparks
  driftTier2Time: 1.6,       // Orange sparks
  driftTier3Time: 2.5,       // Purple sparks
  driftBoost1Duration: 1.0,
  driftBoost2Duration: 1.8,
  driftBoost3Duration: 2.6,
  spinOutDuration: 1.5,
  shieldDuration: 6.0,
  boostItemDuration: 2.4,
  respawnInvulnerableDuration: 2.0,
};

export const GRID_POSITIONS = [
  { x: -3.0, z: -8.0 },
  { x: 3.0, z: -8.0 },
  { x: -3.0, z: -16.0 },
  { x: 3.0, z: -16.0 },
  { x: -3.0, z: -24.0 },
  { x: 3.0, z: -24.0 },
  { x: -3.0, z: -32.0 },
  { x: 3.0, z: -32.0 },
];
