import { create } from 'zustand';
import {
  AccessGrant,
  GoogleProfile,
  fetchProfile,
  requestAccessToken,
  revokeToken,
} from '../auth/googleAuth';

type AuthStatus = 'idle' | 'signing-in' | 'authenticated' | 'error';

interface AuthState {
  status: AuthStatus;
  profile: GoogleProfile | null;
  error: string | null;
  // Token kept in memory only — never persisted to storage.
  grant: AccessGrant | null;
  signIn: () => Promise<void>;
  signOut: () => void;
  /** Returns a currently-valid access token, silently refreshing if needed. */
  getAccessToken: () => Promise<string>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  profile: null,
  error: null,
  grant: null,

  signIn: async () => {
    set({ status: 'signing-in', error: null });
    try {
      const grant = await requestAccessToken(true);
      // Auth succeeds as soon as we have a token. The profile is cosmetic, so a
      // failed userinfo call must NOT block sign-in.
      let profile = null;
      try {
        profile = await fetchProfile(grant.accessToken);
      } catch {
        profile = { email: '', name: 'Signed in', picture: '' };
      }
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
