import { AUTH_SCOPES, GOOGLE_CLIENT_ID } from '../config';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

let gisReady: Promise<void> | null = null;

/** Load the Google Identity Services script exactly once. */
export function loadGis(): Promise<void> {
  if (gisReady) return gisReady;
  gisReady = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
  return gisReady;
}

export interface AccessGrant {
  accessToken: string;
  /** Epoch millis when the token expires. */
  expiresAt: number;
  scope: string;
}

// Google recommends creating ONE token client and reusing it. A single shared
// callback resolves whichever request is currently pending; starting a new
// request supersedes any stale one so overlapping calls (e.g. silent restore
// then an interactive tap) can never wedge GIS into an unresolved state.
let tokenClient: TokenClient | null = null;
let pending: { resolve: (g: AccessGrant) => void; reject: (e: Error) => void } | null =
  null;

function settle(fn: (p: NonNullable<typeof pending>) => void): void {
  if (!pending) return;
  const p = pending;
  pending = null;
  fn(p);
}

async function ensureClient(): Promise<TokenClient> {
  await loadGis();
  if (tokenClient) return tokenClient;
  const oauth2 = window.google!.accounts.oauth2;
  tokenClient = oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: AUTH_SCOPES,
    callback: (resp) =>
      settle((p) => {
        if (resp.error) {
          p.reject(new Error(resp.error_description || resp.error));
        } else {
          p.resolve({
            accessToken: resp.access_token,
            // Refresh a minute early to avoid mid-request expiry.
            expiresAt: Date.now() + (resp.expires_in - 60) * 1000,
            scope: resp.scope,
          });
        }
      }),
    error_callback: (err) => settle((p) => p.reject(new Error(err.type))),
  });
  return tokenClient;
}

/**
 * Request an access token via the OAuth token flow.
 * @param interactive when false, attempts a silent token (prompt: 'none').
 */
export async function requestAccessToken(interactive: boolean): Promise<AccessGrant> {
  const client = await ensureClient();
  // Abandon any in-flight request before starting a new one.
  settle((p) => p.reject(new Error('superseded')));
  return new Promise<AccessGrant>((resolve, reject) => {
    pending = { resolve, reject };
    // Interactive uses '' (no forced re-consent once granted); silent uses 'none'.
    client.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

export interface GoogleProfile {
  email: string;
  name: string;
  picture: string;
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

/** Revoke the token with Google (best-effort). */
export function revokeToken(accessToken: string): void {
  window.google?.accounts.oauth2.revoke(accessToken);
}
