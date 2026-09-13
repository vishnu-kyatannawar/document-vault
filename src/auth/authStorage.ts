// On-device auth cache. The access token is short-lived (1 h), limited to the
// drive.file scope, cleared on sign-out, and stored so reopening the app does
// not require a round trip to Google every time. See README "Security model".

import type { AccessGrant, GoogleProfile } from './googleAuth';

const SESSION_KEY = 'vault.auth';
const SILENT_AT_KEY = 'vault.auth.silentAt';

export interface StoredSession {
  grant: AccessGrant;
  profile: GoogleProfile | null;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode, quota) — the app still works,
    // it just has to renew via Google on the next launch.
  }
}

export function loadSession(): StoredSession | null {
  const s = read<StoredSession>(SESSION_KEY);
  if (!s || typeof s.grant?.accessToken !== 'string' || typeof s.grant?.expiresAt !== 'number') {
    return null;
  }
  return s;
}

export function saveSession(session: StoredSession): void {
  write(SESSION_KEY, session);
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

/** Record that a silent renewal redirect was just started (loop guard). */
export function markSilentAttempt(now = Date.now()): void {
  write(SILENT_AT_KEY, now);
}

export function lastSilentAttemptAt(): number {
  return read<number>(SILENT_AT_KEY) ?? 0;
}
