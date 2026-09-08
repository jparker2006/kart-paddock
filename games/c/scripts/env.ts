import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Loads key=value pairs from the project .env file (no dependency needed). */
export function readEnvFile(): Record<string, string> {
  const out: Record<string, string> = {};
  const p = resolve(process.cwd(), '.env');
  if (!existsSync(p)) return out;
  const text = readFileSync(p, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** Normalizes a base path so it starts and ends with "/" (or is "/"). */
export function normalizeBasePath(bp: string): string {
  let s = bp.trim();
  if (!s || s === '/') return '/';
  if (!s.startsWith('/')) s = '/' + s;
  if (!s.endsWith('/')) s = s + '/';
  return s;
}
