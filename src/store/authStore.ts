import { create } from 'zustand';
import {
  AccessGrant,
  GoogleProfile,
  fetchProfile,
  requestAccessToken,
  revokeToken,
} from '../auth/googleAuth';
import { logger } from '../services/logger';

type AuthStatus = 'restoring' | 'idle' | 'signing-in' | 'authenticated' | 'error';

async function loadProfile(accessToken: string): Promise<GoogleProfile> {
  // The profile is cosmetic — never let a failed userinfo call block sign-in.
  try {
    return await fetchProfile(accessToken);
  } catch {
    return { email: '', name: 'Signed in', picture: '' };
  }
}

function friendlyAuthError(message: string): string {
  if (/popup_closed|popup_failed_to_open/i.test(message)) {
    return 'The sign-in window was closed. Please try again.';
  }
  if (/access_denied/i.test(message)) {
    return 'Access was denied. Grant Drive access to continue.';
  }
  return message;
}

// One in-flight silent refresh shared by all callers — parallel Drive calls on
// an expired token must not fire competing GIS requests (they supersede each
// other and most would spuriously fail).
let refreshPromise: Promise<AccessGrant> | null = null;

interface AuthState {
  status: AuthStatus;
  profile: GoogleProfile | null;
  error: string | null;
  // Token kept in memory only — never persisted to storage.
  grant: AccessGrant | null;
  /** Silently restore a session on app load (no popup, no re-login). */
  restore: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => void;
  /** Returns a currently-valid access token, silently refreshing if needed. */
  getAccessToken: () => Promise<string>;
  /** Drop the cached token (e.g. after a 401) so the next call fetches fresh. */
  invalidateToken: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  // Start in 'restoring' so the app shows a splash instead of flashing the
  // sign-in screen before the silent token attempt resolves.
  status: 'restoring',
  profile: null,
  error: null,
  grant: null,

  restore: async () => {
    set({ status: 'restoring', error: null });
    try {
      // Guard against a silent request that never calls back on some browsers.
      const grant = await Promise.race([
        requestAccessToken(false), // prompt: 'none'
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('silent-timeout')), 8000),
        ),
      ]);
      const profile = await loadProfile(grant.accessToken);
      set({ grant, profile, status: 'authenticated' });
    } catch {
      // Only fall back to sign-in if nothing else changed the state meanwhile
      // (e.g. the user already tapped "Continue with Google", superseding us).
      if (get().status === 'restoring') set({ status: 'idle' });
    }
  },

  signIn: async () => {
    set({ status: 'signing-in', error: null });
    try {
      const grant = await requestAccessToken(true);
      const profile = await loadProfile(grant.accessToken);
      set({ grant, profile, status: 'authenticated' });
    } catch (e) {
      const message = (e as Error).message;
      if (message === 'superseded') return; // a newer request took over
      logger.error('Sign-in failed', e as Error);
      set({ status: 'error', error: friendlyAuthError(message) });
    }
  },

  signOut: () => {
    const { grant } = get();
    if (grant) revokeToken(grant.accessToken);
    set({ status: 'idle', profile: null, grant: null, error: null });
  },

  getAccessToken: async () => {
    const { grant } = get();
    if (grant && grant.expiresAt > Date.now()) return grant.accessToken;

    if (!refreshPromise) {
      refreshPromise = requestAccessToken(false).finally(() => {
        refreshPromise = null;
      });
    }
    try {
      const fresh = await refreshPromise;
      set({ grant: fresh });
      return fresh.accessToken;
    } catch (e) {
      // Silent refresh impossible → the Google session is gone. Return the app
      // to the sign-in screen instead of leaving every Drive call failing.
      logger.warn('Silent token refresh failed — signing out', e as Error);
      set({ status: 'idle', grant: null, profile: null });
      throw new Error('Session expired — please sign in again.');
    }
  },

  invalidateToken: () => set({ grant: null }),
}));
