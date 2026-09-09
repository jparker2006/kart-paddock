import "./style.css";
import { Game } from "./game.js";

// All routes, storage keys, and share links are derived from the configured
// base path (import.meta.env.BASE_URL), so the game works at / and nested
// under prefixes like /games/a/. No hostnames are hard-coded.
const game = new Game();
game.run();

// Test hook for automated browser verification (also handy for debugging):
// window.__cpr = { game, setAutopilot(bool), teleportToT(t), state() }
(game as unknown as { __test: unknown }).__test;
const w = window as unknown as {
  __cpr: {
    game: Game;
    setAutopilot: (on: boolean) => void;
    teleportToT: (t: number) => void;
    drive: (input: { throttle: number; steer: number; drift: boolean } | null, ms?: number) => void;
    useItem: () => void;
    respawn: () => void;
    state: () => Record<string, unknown>;
  };
};
w.__cpr = {
  game,
  setAutopilot: (on: boolean) => {
    (game as unknown as { autopilot: boolean }).autopilot = on;
  },
  teleportToT: (t: number) => {
    game.debugTeleport(t);
  },
  drive: (input, ms = 0) => {
    game.debugDrive(input, ms);
  },
  useItem: () => {
    game.debugUseItem();
  },
  respawn: () => {
    game.debugRespawn();
  },
  state: () => game.debugState(),
};
