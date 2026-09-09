export interface BackendConfig {
  port: number;
  host: string;
  allowedOrigins: string[];
}

function parseOrigins(raw: string | undefined): string[] {
  const fallback = "http://localhost:5173,http://localhost:4173";
  return (raw ?? fallback)
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter((s) => s.length > 0);
}

export function loadConfig(): BackendConfig {
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid PORT value: ${process.env.PORT}`);
  }
  return {
    port,
    host: process.env.HOST ?? "0.0.0.0",
    allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS),
  };
}
