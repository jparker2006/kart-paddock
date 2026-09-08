import { readEnvFile, normalizeBasePath } from '../../scripts/env.js';

const fileEnv = readEnvFile();

function val(key: string, def: string): string {
  const v = process.env[key] ?? fileEnv[key];
  return v === undefined || v === '' ? def : v;
}

export const config = {
  port: Number(val('PORT', '3001')),
  host: val('HOST', '0.0.0.0'),
  basePath: normalizeBasePath(val('BASE_PATH', '/')),
  allowedOrigins: val(
    'ALLOWED_ORIGINS',
    'http://localhost:5173,http://localhost:4173'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
