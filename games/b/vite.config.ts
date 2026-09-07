import { defineConfig, loadEnv } from 'vite';

/**
 * Normalises BASE_PATH so it always starts and ends with a slash
 * (e.g. "games/a" -> "/games/a/", "" -> "/").
 */
function normaliseBasePath(raw: string | undefined): string {
  let base = (raw ?? '/').trim();
  if (base === '' || base === '/') return '/';
  if (!base.startsWith('/')) base = '/' + base;
  if (!base.endsWith('/')) base = base + '/';
  return base;
}

function parsePort(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
}

export default defineConfig(({ mode }) => {
  // Load every variable from .env files (empty prefix) so BASE_PATH / ports are visible here.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env } as Record<string, string | undefined>;
  const base = normaliseBasePath(env.BASE_PATH);
  const clientPort = parsePort(env.CLIENT_PORT, 5173);
  const previewPort = parsePort(env.PREVIEW_PORT, 4173);

  return {
    base,
    // Only VITE_* variables are exposed to the browser bundle.
    envPrefix: 'VITE_',
    build: {
      outDir: 'dist/client',
      emptyOutDir: true,
      sourcemap: false,
      target: 'es2022',
      // three.js is one big dependency; the whole game is a single ~180 kB gzip chunk.
      chunkSizeWarningLimit: 900,
    },
    server: {
      port: clientPort,
      strictPort: true, // report a conflict instead of silently picking another port
      host: true,
    },
    preview: {
      port: previewPort,
      strictPort: true,
      host: true,
    },
  };
});
