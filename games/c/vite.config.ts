import { defineConfig } from 'vite';
import { readEnvFile, normalizeBasePath } from './scripts/env.ts';

const env = { ...readEnvFile(), ...process.env };

const basePath = normalizeBasePath(env.BASE_PATH ?? '/');
const clientPort = Number(env.CLIENT_PORT ?? 5173);
const previewPort = Number(env.PREVIEW_PORT ?? 4173);

export default defineConfig({
  base: basePath,
  plugins: [],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: clientPort,
    strictPort: true,
    host: 'localhost',
  },
  preview: {
    port: previewPort,
    strictPort: true,
    host: 'localhost',
  },
});
