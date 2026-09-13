import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the OAuth redirect layer so no navigation/network is involved.
const startAuthRedirect = vi.fn();
const consumeAuthRedirect = vi.fn();
const fetchProfile = vi.fn();
const revokeToken = vi.fn();

vi.mock('../src/auth/googleAuth', () => ({
  startAuthRedirect: (...a: unknown[]) => startAuthRedirect(...a),
  consumeAuthRedirect: (...a: unknown[]) => consumeAuthRedirect(...a),
  fetchProfile: (...a: unknown[]) => fetchProfile(...a),
  revokeToken: (...a: unknown[]) => revokeToken(...a),
}));

import { SILENT_RETRY_MS, _resetAuthStoreForTests, useAuthStore } from '../src/store/authStore';
import { loadSession, saveSession } from '../src/auth/authStorage';

const HOUR = 3600_000;
const grant = (expiresAt: number) => ({ accessToken: 'tok', expiresAt, scope: 'drive.file' });
const profile = { email: 'a@b.com', name: 'A', picture: 'p' };

describe('authStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    _resetAuthStoreForTests();
    consumeAuthRedirect.mockReturnValue(null);
    fetchProfile.mockResolvedValue(profile);
    revokeToken.mockResolvedValue(undefined);
    useAuthStore.setState({ status: 'restoring', profile: null, grant: null, error: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('restore', () => {
    it('uses a cached, still-valid token without touching the network', async () => {
      saveSession({ grant: grant(Date.now() + HOUR), profile });

      await useAuthStore.getState().restore();

      const s = useAuthStore.getState();
      expect(s.status).toBe('authenticated');
      expect(s.profile?.email).toBe('a@b.com');
      expect(startAuthRedirect).not.toHaveBeenCalled();
      expect(fetchProfile).not.toHaveBeenCalled();
    });

    it('renews silently (redirect with login_hint) when the cached token is stale', async () => {
      saveSession({ grant: grant(Date.now() - 1), profile });

      await useAuthStore.getState().restore();

      expect(startAuthRedirect).toHaveBeenCalledWith({
        mode: 'silent',
        loginHint: 'a@b.com',
        returnTo: undefined,
      });
      // Page is navigating away — keep the splash, never flash the sign-in page.
      expect(useAuthStore.getState().status).toBe('restoring');
    });

    it('shows the sign-in page when nobody has signed in before', async () => {
      await useAuthStore.getState().restore();

      expect(useAuthStore.getState().status).toBe('idle');
      expect(startAuthRedirect).not.toHaveBeenCalled();
    });

    it('does not redirect while offline; explains instead', async () => {
      saveSession({ grant: grant(Date.now() - 1), profile });
      vi.stubGlobal('navigator', { onLine: false });

      await useAuthStore.getState().restore();

      expect(startAuthRedirect).not.toHaveBeenCalled();
      expect(useAuthStore.getState().status).toBe('idle');
      expect(useAuthStore.getState().error).toMatch(/offline/i);
    });

    it('applies a successful redirect result and caches it', async () => {
      const g = grant(Date.now() + HOUR);
      consumeAuthRedirect.mockReturnValue({ ok: true, mode: 'interactive', grant: g, returnTo: '/' });

      await useAuthStore.getState().restore();

      const s = useAuthStore.getState();
      expect(s.status).toBe('authenticated');
      expect(s.grant?.accessToken).toBe('tok');
      expect(s.profile).toEqual(profile);
      expect(loadSession()).toEqual({ grant: g, profile });
    });

    it('signs in even if the profile lookup fails', async () => {
      consumeAuthRedirect.mockReturnValue({
        ok: true,
        mode: 'interactive',
        grant: grant(Date.now() + HOUR),
        returnTo: '/',
      });
      fetchProfile.mockRejectedValue(new Error('userinfo failed: 500'));

      await useAuthStore.getState().restore();

      expect(useAuthStore.getState().status).toBe('authenticated');
      expect(useAuthStore.getState().profile?.name).toBe('Signed in');
    });

    it('falls back to the sign-in page quietly when a silent renewal fails', async () => {
      saveSession({ grant: grant(Date.now() - 1), profile });
      consumeAuthRedirect.mockReturnValue({
        ok: false,
        mode: 'silent',
        error: 'login_required',
        returnTo: '/',
      });

      await useAuthStore.getState().restore();

      expect(useAuthStore.getState().status).toBe('idle');
      expect(useAuthStore.getState().error).toBeNull();
      // Identity dropped so the next launch doesn't bounce to Google again.
      expect(loadSession()).toBeNull();
      expect(startAuthRedirect).not.toHaveBeenCalled();
    });

    it('shows a friendly error when the user denies Drive access', async () => {
      consumeAuthRedirect.mockReturnValue({
        ok: false,
        mode: 'interactive',
        error: 'access_denied',
        returnTo: '/',
      });

      await useAuthStore.getState().restore();

      expect(useAuthStore.getState().status).toBe('error');
      expect(useAuthStore.getState().error).toMatch(/Drive access/);
    });

    it('runs only once per page load (StrictMode double effect)', async () => {
      saveSession({ grant: grant(Date.now() - 1), profile });
      const { restore } = useAuthStore.getState();

      await Promise.all([restore(), restore()]);

      expect(startAuthRedirect).toHaveBeenCalledTimes(1);
    });
  });

  it('signIn redirects interactively, hinting the last account', async () => {
    saveSession({ grant: grant(0), profile });

    await useAuthStore.getState().signIn();

    expect(useAuthStore.getState().status).toBe('signing-in');
    expect(startAuthRedirect).toHaveBeenCalledWith({ mode: 'interactive', loginHint: 'a@b.com' });
  });

  it('signOut revokes, clears the cache and returns to idle', () => {
    saveSession({ grant: grant(Date.now() + HOUR), profile });
    useAuthStore.setState({ status: 'authenticated', grant: grant(Date.now() + HOUR), profile });

    useAuthStore.getState().signOut();

    expect(revokeToken).toHaveBeenCalledWith('tok');
    expect(loadSession()).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({ status: 'idle', grant: null, profile: null });
  });

  describe('getAccessToken', () => {
    it('returns the cached token while valid without redirecting', async () => {
      useAuthStore.setState({ status: 'authenticated', grant: grant(Date.now() + HOUR), profile });

      await expect(useAuthStore.getState().getAccessToken()).resolves.toBe('tok');
      expect(startAuthRedirect).not.toHaveBeenCalled();
    });

    it('starts one silent redirect for many concurrent callers when expired', () => {
      useAuthStore.setState({ status: 'authenticated', grant: grant(Date.now() - 1), profile });
      const { getAccessToken } = useAuthStore.getState();

      // Never settles in the happy path (the page navigates away).
      void getAccessToken().catch(() => undefined);
      void getAccessToken().catch(() => undefined);

      expect(startAuthRedirect).toHaveBeenCalledTimes(1);
      expect(startAuthRedirect).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'silent', loginHint: 'a@b.com' }),
      );
    });

    it('rejects while offline without redirecting', async () => {
      useAuthStore.setState({ status: 'authenticated', grant: grant(Date.now() - 1), profile });
      vi.stubGlobal('navigator', { onLine: false });

      await expect(useAuthStore.getState().getAccessToken()).rejects.toThrow(/offline/i);
      expect(startAuthRedirect).not.toHaveBeenCalled();
    });

    it('breaks a renewal loop: a second silent attempt within the guard window signs out', async () => {
      // A silent renewal happened moments ago, yet the token is rejected again.
      saveSession({ grant: grant(Date.now() - 1), profile });
      useAuthStore.setState({ status: 'authenticated', grant: null, profile });
      localStorage.setItem('vault.auth.silentAt', JSON.stringify(Date.now() - SILENT_RETRY_MS / 2));

      await expect(useAuthStore.getState().getAccessToken()).rejects.toThrow(/sign in again/i);
      expect(startAuthRedirect).not.toHaveBeenCalled();
      expect(useAuthStore.getState().status).toBe('idle');
      expect(loadSession()).toBeNull();
    });
  });

  it('invalidateToken keeps the identity but never reuses the bad token', () => {
    saveSession({ grant: grant(Date.now() + HOUR), profile });
    useAuthStore.setState({ status: 'authenticated', grant: grant(Date.now() + HOUR), profile });

    useAuthStore.getState().invalidateToken();

    expect(useAuthStore.getState().grant).toBeNull();
    expect(loadSession()?.grant.expiresAt).toBe(0);
    expect(loadSession()?.profile?.email).toBe('a@b.com');
  });

  describe('renewIfStale', () => {
    it('renews ahead of expiry on resume', () => {
      useAuthStore.setState({ status: 'authenticated', grant: grant(Date.now() + 30_000), profile });

      useAuthStore.getState().renewIfStale();

      expect(startAuthRedirect).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'silent', loginHint: 'a@b.com' }),
      );
      expect(useAuthStore.getState().status).toBe('restoring');
    });

    it('leaves a healthy token alone', () => {
      useAuthStore.setState({ status: 'authenticated', grant: grant(Date.now() + HOUR), profile });

      useAuthStore.getState().renewIfStale();

      expect(startAuthRedirect).not.toHaveBeenCalled();
      expect(useAuthStore.getState().status).toBe('authenticated');
    });
  });
});
