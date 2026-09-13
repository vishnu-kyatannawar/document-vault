import { create } from 'zustand';
import {
  AccessGrant,
  GoogleProfile,
  consumeAuthRedirect,
  fetchProfile,
  revokeToken,
  startAuthRedirect,
} from '../auth/googleAuth';
import {
  clearSession,
  lastSilentAttemptAt,
  loadSession,
  markSilentAttempt,
  saveSession,
} from '../auth/authStorage';
import { logger } from '../services/logger';

type AuthStatus = 'restoring' | 'idle' | 'signing-in' | 'authenticated' | 'error';

/** A cached token must have at least this long left to be used as-is. */
const TOKEN_MARGIN_MS = 60_000;
/** On resume, renew proactively when this close to expiry (cheaper than mid-upload). */
const RENEW_AHEAD_MS = 2 * 60_000;
/** Minimum gap between silent redirects — breaks any Google ⇄ app loop. */
export const SILENT_RETRY_MS = 30_000;
/** If the page has not unloaded this long after starting a redirect, give up. */
const REDIRECT_GRACE_MS = 10_000;

const PLACEHOLDER_PROFILE: GoogleProfile = { email: '', name: 'Signed in', picture: '' };
const SESSION_EXPIRED = 'Session expired — please sign in again.';
const OFFLINE = 'You’re offline — connect to the internet to sign in.';

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

function friendlyAuthError(code: string): string {
  if (/access_denied/i.test(code)) return 'Access was denied. Grant Drive access to continue.';
  if (/state_mismatch/i.test(code)) return 'Sign-in could not be verified. Please try again.';
  if (/login_required|interaction_required|consent_required/i.test(code)) {
    return 'Please sign in to continue.';
  }
  return code;
}

// One in-flight renewal shared by all callers — parallel Drive calls on an
// expired token must trigger a single redirect, not several.
let refreshPromise: Promise<string> | null = null;
// restore() runs once per page load (React StrictMode invokes effects twice).
let restorePromise: Promise<void> | null = null;

/** Test hook: forget module-level memoisation between cases. */
export function _resetAuthStoreForTests(): void {
  refreshPromise = null;
  restorePromise = null;
}

/**
 * Leave for Google to renew the token without UI. Returns false when that is
 * not possible right now (offline, or a silent attempt was made moments ago).
 */
function beginSilentRedirect(email: string | undefined, returnTo?: string): boolean {
  if (!isOnline()) return false;
  if (Date.now() - lastSilentAttemptAt() < SILENT_RETRY_MS) return false;
  markSilentAttempt();
  startAuthRedirect({ mode: 'silent', loginHint: email || undefined, returnTo });
  return true;
}

interface AuthState {
  status: AuthStatus;
  profile: GoogleProfile | null;
  error: string | null;
  grant: AccessGrant | null;
  /** On app load: apply a returning redirect, reuse the cached token, or renew silently. */
  restore: () => Promise<void>;
  /** Interactive sign-in: navigates to Google; the page unloads. */
  signIn: () => Promise<void>;
  signOut: () => void;
  /** Returns a currently-valid access token, silently renewing (via redirect) if needed. */
  getAccessToken: () => Promise<string>;
  /** Drop the cached token (e.g. after a 401) so the next call renews. */
  invalidateToken: () => void;
  /** On resume: renew ahead of expiry so a bounce never lands mid-task. */
  renewIfStale: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => {
  async function applyGrant(grant: AccessGrant): Promise<void> {
    const cached = loadSession()?.profile ?? null;
    set({ grant, profile: cached ?? PLACEHOLDER_PROFILE, status: 'authenticated', error: null });
    saveSession({ grant, profile: cached });
    // The profile is cosmetic — never let a failed userinfo call block sign-in,
    // and never overwrite a good cached profile with a placeholder.
    try {
      const profile = await fetchProfile(grant.accessToken);
      set({ profile });
      saveSession({ grant, profile });
    } catch (e) {
      logger.warn('Could not load profile', e as Error);
    }
  }

  return {
    // Start in 'restoring' so the app shows a splash instead of flashing the
    // sign-in screen before the cached session is checked.
    status: 'restoring',
    profile: null,
    error: null,
    grant: null,

    restore: () => {
      if (restorePromise) return restorePromise;
      restorePromise = (async () => {
        set({ status: 'restoring', error: null });

        // 1. Coming back from Google?
        const result = consumeAuthRedirect();
        if (result) {
          if (result.ok) {
            await applyGrant(result.grant);
            return;
          }
          logger.warn(`Google auth (${result.mode}) returned ${result.error}`);
          // Drop the cached identity so we don't bounce to Google on every
          // launch once the Google session is really gone.
          clearSession();
          set({
            status: result.mode === 'interactive' ? 'error' : 'idle',
            error: result.mode === 'interactive' ? friendlyAuthError(result.error) : null,
          });
          return;
        }

        // 2. Cached token still good → straight in, no network.
        const session = loadSession();
        if (session && session.grant.expiresAt - Date.now() > TOKEN_MARGIN_MS) {
          set({
            grant: session.grant,
            profile: session.profile ?? PLACEHOLDER_PROFILE,
            status: 'authenticated',
          });
          return;
        }

        // 3. Known user with a stale token → renew silently (page navigates away).
        const email = session?.profile?.email;
        if (session && beginSilentRedirect(email)) return;

        // 4. Nobody signed in (or offline) → sign-in page.
        set({ status: 'idle', error: session && !isOnline() ? OFFLINE : null });
      })();
      return restorePromise;
    },

    signIn: async () => {
      if (!isOnline()) {
        set({ status: 'error', error: OFFLINE });
        return;
      }
      set({ status: 'signing-in', error: null });
      const email = loadSession()?.profile?.email;
      startAuthRedirect({ mode: 'interactive', loginHint: email || undefined });
    },

    signOut: () => {
      const { grant } = get();
      if (grant) void revokeToken(grant.accessToken);
      clearSession();
      set({ status: 'idle', profile: null, grant: null, error: null });
    },

    getAccessToken: async () => {
      const { grant, profile } = get();
      if (grant && grant.expiresAt > Date.now()) return grant.accessToken;

      if (!refreshPromise) {
        refreshPromise = new Promise<string>((_, reject) => {
          if (!isOnline()) {
            reject(new Error(OFFLINE));
            return;
          }
          const email = profile?.email || loadSession()?.profile?.email;
          if (!beginSilentRedirect(email)) {
            // A silent renewal just happened and Drive still rejects the token:
            // stop looping and ask the user to sign in.
            logger.warn('Silent renewal refused (loop guard) — signing out');
            clearSession();
            set({ status: 'idle', grant: null, profile: null });
            reject(new Error(SESSION_EXPIRED));
            return;
          }
          // The page is navigating away; if it somehow doesn't, fail the call.
          setTimeout(() => reject(new Error(SESSION_EXPIRED)), REDIRECT_GRACE_MS);
        }).finally(() => {
          refreshPromise = null;
        });
      }
      return refreshPromise;
    },

    invalidateToken: () => {
      const session = loadSession();
      // Keep the identity (email → login_hint) but never reuse the bad token.
      if (session) saveSession({ ...session, grant: { ...session.grant, expiresAt: 0 } });
      set({ grant: null });
    },

    renewIfStale: () => {
      const { status, grant, profile } = get();
      if (status !== 'authenticated' || !grant) return;
      if (grant.expiresAt - Date.now() > RENEW_AHEAD_MS || !isOnline()) return;
      set({ status: 'restoring' }); // splash while we bounce through Google
      if (!beginSilentRedirect(profile?.email)) set({ status: 'authenticated' });
    },
  };
});
