// Google OAuth 2.0 for a browser-only app, driven by top-level redirects.
//
// Why redirects and not the Google Identity Services popup/iframe: the silent
// renewal GIS performs happens in a hidden third-party iframe, and Safari, iOS
// home-screen apps and browsers with third-party cookies blocked all refuse
// the Google session cookie there — so every launch fell back to the sign-in
// page. A top-level navigation to accounts.google.com is first-party in every
// browser and in installed PWAs, so `prompt=none` returns a fresh token in
// about a second, and the interactive sign-in works in standalone mode too.
//
// Flow (implicit grant, response_type=token — no client secret, no backend):
//   app ──► accounts.google.com/o/oauth2/v2/auth?...&state=<nonce>
//       ◄── <redirect_uri>#access_token=…&expires_in=…&scope=…&state=<nonce>
//        or <redirect_uri>#error=login_required|…&state=<nonce>

import { AUTH_SCOPES, DRIVE_SCOPE, GOOGLE_CLIENT_ID } from '../config';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const PENDING_KEY = 'vault.auth.pending';

export interface AccessGrant {
  accessToken: string;
  /** Epoch millis when the token should be considered expired. */
  expiresAt: number;
  scope: string;
}

export interface GoogleProfile {
  email: string;
  name: string;
  picture: string;
}

export type AuthMode = 'silent' | 'interactive';

/** What we remember (in localStorage) while the browser is away at Google. */
export interface PendingRedirect {
  nonce: string;
  mode: AuthMode;
  /** Same-origin path to land on afterwards (deep links survive the bounce). */
  returnTo: string;
  at: number;
}

export type AuthRedirectResult =
  | { ok: true; mode: AuthMode; grant: AccessGrant; returnTo: string }
  | { ok: false; mode: AuthMode; error: string; returnTo: string };

/** Exact redirect URI — must be registered on the OAuth client in Google Cloud. */
export function redirectUri(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}

export function buildAuthUrl(opts: { mode: AuthMode; nonce: string; loginHint?: string }): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: AUTH_SCOPES,
    include_granted_scopes: 'true',
    state: opts.nonce,
  });
  if (opts.mode === 'silent') {
    // Never show UI: succeed from the Google session cookie or fail fast.
    params.set('prompt', 'none');
  } else if (!opts.loginHint) {
    params.set('prompt', 'select_account');
  }
  if (opts.loginHint) params.set('login_hint', opts.loginHint);
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function readPendingRedirect(): PendingRedirect | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const p = raw ? (JSON.parse(raw) as PendingRedirect) : null;
    return p && typeof p.nonce === 'string' ? p : null;
  } catch {
    return null;
  }
}

export function clearPendingRedirect(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

/** Only ever land on a path inside this app (tampered storage must not redirect elsewhere). */
function safeReturnTo(path: string | undefined): string {
  const base = import.meta.env.BASE_URL;
  return path && path.startsWith(base) && !path.startsWith('//') ? path : base;
}

/**
 * Leave for Google. The page unloads; `consumeAuthRedirect()` picks the result
 * up on the way back. `navigate` is injectable for tests.
 */
export function startAuthRedirect(
  opts: { mode: AuthMode; loginHint?: string; returnTo?: string },
  navigate: (url: string) => void = (url) => window.location.assign(url),
): void {
  const nonce = randomNonce();
  const returnTo = safeReturnTo(
    opts.returnTo ?? `${window.location.pathname}${window.location.search}`,
  );
  const pending: PendingRedirect = { nonce, mode: opts.mode, returnTo, at: Date.now() };
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Without storage we cannot verify `state` on return; the result will be
    // rejected as a mismatch and the user can sign in again.
  }
  navigate(buildAuthUrl({ mode: opts.mode, nonce, loginHint: opts.loginHint }));
}

/**
 * If the current URL carries Google's response, parse it, scrub the token from
 * the URL/history (replaceState to the remembered path) and return the result.
 * Returns null when the URL is not an auth response.
 */
export function consumeAuthRedirect(): AuthRedirectResult | null {
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return null;
  const params = new URLSearchParams(hash.slice(1));
  const state = params.get('state');
  const token = params.get('access_token');
  const error = params.get('error');
  if (!state || (!token && !error)) return null;

  const pending = readPendingRedirect();
  clearPendingRedirect();
  const mode: AuthMode = pending?.mode ?? 'interactive';
  const returnTo = safeReturnTo(pending?.returnTo);
  // First thing: get the token out of the address bar and history.
  window.history.replaceState(null, '', returnTo);

  if (!pending || pending.nonce !== state) {
    return { ok: false, mode, error: 'state_mismatch', returnTo };
  }
  if (error) return { ok: false, mode, error, returnTo };

  const scope = params.get('scope') ?? '';
  if (!scope.split(' ').includes(DRIVE_SCOPE)) {
    // The user unticked Drive on the consent screen — the app cannot work.
    return { ok: false, mode, error: 'access_denied', returnTo };
  }
  const expiresIn = Number(params.get('expires_in')) || 3600;
  return {
    ok: true,
    mode,
    returnTo,
    grant: {
      accessToken: token!,
      // Treat as expired a minute early to avoid mid-request expiry.
      expiresAt: Date.now() + (expiresIn - 60) * 1000,
      scope,
    },
  };
}

/** Fetch basic profile using the granted access token (email/profile scopes). */
export async function fetchProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`);
  const data = await res.json();
  return { email: data.email, name: data.name, picture: data.picture };
}

/** Revoke the token with Google (best-effort, never throws). */
export async function revokeToken(accessToken: string): Promise<void> {
  try {
    await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(accessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch {
    // Offline or blocked — the token expires on its own within the hour.
  }
}
