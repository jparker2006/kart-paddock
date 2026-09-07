/**
 * Browser storage namespaced by the deployment base path so several embedded
 * apps on one origin never collide.  sessionStorage keeps each tab a separate
 * racer; localStorage remembers friendly preferences.
 */
const PREFIX = `bumble-rally:${import.meta.env.BASE_URL}:`;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export const session = {
  get(key: string): string | null {
    return safe(() => window.sessionStorage.getItem(PREFIX + key), null);
  },
  set(key: string, value: string): void {
    safe(() => window.sessionStorage.setItem(PREFIX + key, value), undefined);
  },
  remove(key: string): void {
    safe(() => window.sessionStorage.removeItem(PREFIX + key), undefined);
  },
};

export const local = {
  get(key: string): string | null {
    return safe(() => window.localStorage.getItem(PREFIX + key), null);
  },
  set(key: string, value: string): void {
    safe(() => window.localStorage.setItem(PREFIX + key, value), undefined);
  },
};
