/** Namespaced local storage so we never collide with other embedded apps. */
const NS = 'harvest-rush:';

export function loadStr(key: string): string | null {
  try {
    return localStorage.getItem(NS + key);
  } catch {
    return null;
  }
}

export function saveStr(key: string, value: string): void {
  try {
    localStorage.setItem(NS + key, value);
  } catch {
    /* private mode etc. */
  }
}

export function loadSession(key: string): string | null {
  try {
    return sessionStorage.getItem(NS + key);
  } catch {
    return null;
  }
}

export function saveSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(NS + key, value);
  } catch {
    /* ignore */
  }
}

export function clearSession(key: string): void {
  try {
    sessionStorage.removeItem(NS + key);
  } catch {
    /* ignore */
  }
}
