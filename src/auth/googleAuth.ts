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

/**
 * Request an access token via the OAuth token flow.
 * @param interactive when false, attempts a silent refresh (prompt: 'none').
 */
export async function requestAccessToken(interactive: boolean): Promise<AccessGrant> {
  await loadGis();
  const oauth2 = window.google!.accounts.oauth2;

  return new Promise<AccessGrant>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: AUTH_SCOPES,
      callback: (resp) => {
        if (resp.error) {
          reject(new Error(resp.error_description || resp.error));
          return;
        }
        resolve({
          accessToken: resp.access_token,
          // Refresh a minute early to avoid mid-request expiry.
          expiresAt: Date.now() + (resp.expires_in - 60) * 1000,
          scope: resp.scope,
        });
      },
      error_callback: (err) => reject(new Error(err.type)),
    });
    client.requestAccessToken({ prompt: interactive ? 'consent' : 'none' });
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
