import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rootDir = dirname(fileURLToPath(import.meta.url));

function withTrailingSlash(p: string): string {
  if (!p) return "/";
  let out = p;
  if (!out.startsWith("/")) out = "/" + out;
  if (!out.endsWith("/")) out = out + "/";
  return out;
}

const base = withTrailingSlash(process.env.BASE_PATH ?? "/");
const clientPort = Number(process.env.CLIENT_PORT ?? 5173);
const previewPort = Number(process.env.PREVIEW_PORT ?? 4173);

export default defineConfig({
  base,
  root: "src/client",
  publicDir: "../../public",
  envPrefix: ["VITE_"],
  server: {
    port: clientPort,
    strictPort: true,
  },
  preview: {
    port: previewPort,
    strictPort: true,
  },
  build: {
    outDir: join(rootDir, "dist/client"),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
