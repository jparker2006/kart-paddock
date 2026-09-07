import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads KEY=VALUE pairs from a local `.env` file *without* overriding values
 * already present in the process environment (so the hosting provider's PORT
 * etc. always win).  Silently does nothing when the file does not exist.
 */
export function loadDotEnv(file = '.env'): void {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export interface ServerConfig {
  port: number;
  host: string;
  allowedOrigins: string[];
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`Invalid PORT value "${raw}" - expected an integer between 0 and 65535`);
  }
  return n;
}

export function readConfig(): ServerConfig {
  const allowed = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return {
    port: parsePort(process.env.PORT, 3001),
    host: process.env.HOST?.trim() || '0.0.0.0',
    allowedOrigins: allowed,
  };
}

/**
 * Origin check used for both plain HTTP and the WebSocket handshake.
 * `*` allows everything (handy for LAN testing).  Requests without an Origin
 * header (curl, health checks) are allowed - they cannot be browsers.
 */
export function isOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  if (allowed.includes('*')) return true;
  const normalised = origin.replace(/\/+$/, '').toLowerCase();
  return allowed.some((a) => a.toLowerCase() === normalised);
}
