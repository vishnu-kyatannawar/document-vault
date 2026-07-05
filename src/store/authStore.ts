import { create } from 'zustand';
import {
  AccessGrant,
  GoogleProfile,
  fetchProfile,
  requestAccessToken,
  revokeToken,
} from '../auth/googleAuth';

type AuthStatus = 'restoring' | 'idle' | 'signing-in' | 'authenticated' | 'error';

async function loadProfile(accessToken: string): Promise<GoogleProfile> {
  // The profile is cosmetic — never let a failed userinfo call block sign-in.
  try {
    return await fetchProfile(accessToken);
  } catch {
    return { email: '', name: 'Signed in', picture: '' };
  }
}

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
      // No active Google session / consent → user must sign in interactively.
      set({ status: 'idle' });
    }
  },

  signIn: async () => {
    set({ status: 'signing-in', error: null });
    try {
      const grant = await requestAccessToken(true);
      const profile = await loadProfile(grant.accessToken);
      set({ grant, profile, status: 'authenticated' });
    } catch (e) {
      set({ status: 'error', error: (e as Error).message });
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
    // Expired or missing → silent refresh.
    const fresh = await requestAccessToken(false);
    set({ grant: fresh });
    return fresh.accessToken;
  },
}));
