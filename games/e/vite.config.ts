import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig(() => {
  const basePath = process.env.BASE_PATH || '/';
  const clientPort = parseInt(process.env.CLIENT_PORT || '5173', 10);
  const previewPort = parseInt(process.env.PREVIEW_PORT || '4173', 10);

  return {
    base: basePath,
    root: '.',
    publicDir: 'public',
    server: {
      port: clientPort,
      strictPort: true,
      host: process.env.HOST || '0.0.0.0',
    },
    preview: {
      port: previewPort,
      strictPort: true,
      host: process.env.HOST || '0.0.0.0',
    },
    build: {
      outDir: 'dist/client',
      emptyOutDir: true,
      assetsDir: 'assets',
    },
    resolve: {
      alias: {
        '@shared': path.resolve(import.meta.dirname, './src/shared'),
      }
    }
  };
});
