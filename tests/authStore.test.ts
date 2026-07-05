import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the GIS wrapper so no real network/script is involved.
const requestAccessToken = vi.fn();
const fetchProfile = vi.fn();
const revokeToken = vi.fn();

vi.mock('../src/auth/googleAuth', () => ({
  requestAccessToken: (...a: unknown[]) => requestAccessToken(...a),
  fetchProfile: (...a: unknown[]) => fetchProfile(...a),
  revokeToken: (...a: unknown[]) => revokeToken(...a),
}));

import { useAuthStore } from '../src/store/authStore';

describe('authStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ status: 'idle', profile: null, grant: null, error: null });
  });

  it('signIn stores the grant and profile on success', async () => {
    requestAccessToken.mockResolvedValue({
      accessToken: 'tok',
      expiresAt: Date.now() + 3600_000,
      scope: 'drive.file',
    });
    fetchProfile.mockResolvedValue({ email: 'a@b.com', name: 'A', picture: 'p' });

    await useAuthStore.getState().signIn();

    const s = useAuthStore.getState();
    expect(s.status).toBe('authenticated');
    expect(s.profile?.email).toBe('a@b.com');
    expect(requestAccessToken).toHaveBeenCalledWith(true);
  });

  it('signIn reports an error status on failure', async () => {
    requestAccessToken.mockRejectedValue(new Error('denied'));
    await useAuthStore.getState().signIn();
    expect(useAuthStore.getState().status).toBe('error');
    expect(useAuthStore.getState().error).toBe('denied');
  });

  it('getAccessToken returns the cached token while valid', async () => {
    useAuthStore.setState({
      grant: { accessToken: 'cached', expiresAt: Date.now() + 60_000, scope: '' },
    });
    const token = await useAuthStore.getState().getAccessToken();
    expect(token).toBe('cached');
    expect(requestAccessToken).not.toHaveBeenCalled();
  });

  it('getAccessToken silently refreshes an expired token', async () => {
    useAuthStore.setState({
      grant: { accessToken: 'old', expiresAt: Date.now() - 1000, scope: '' },
    });
    requestAccessToken.mockResolvedValue({
      accessToken: 'new',
      expiresAt: Date.now() + 3600_000,
      scope: '',
    });

    const token = await useAuthStore.getState().getAccessToken();
    expect(token).toBe('new');
    expect(requestAccessToken).toHaveBeenCalledWith(false);
  });

  it('deduplicates concurrent silent refreshes into one GIS request', async () => {
    useAuthStore.setState({
      grant: { accessToken: 'old', expiresAt: Date.now() - 1000, scope: '' },
    });
    let release!: (g: unknown) => void;
    requestAccessToken.mockReturnValue(new Promise((r) => (release = r)));

    const p1 = useAuthStore.getState().getAccessToken();
    const p2 = useAuthStore.getState().getAccessToken();
    release({ accessToken: 'new', expiresAt: Date.now() + 3600_000, scope: '' });

    expect(await p1).toBe('new');
    expect(await p2).toBe('new');
    expect(requestAccessToken).toHaveBeenCalledTimes(1);
  });

  it('returns to the sign-in screen when a silent refresh fails', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      grant: { accessToken: 'old', expiresAt: Date.now() - 1000, scope: '' },
    });
    requestAccessToken.mockRejectedValue(new Error('no session'));

    await expect(useAuthStore.getState().getAccessToken()).rejects.toThrow(
      /sign in again/i,
    );
    expect(useAuthStore.getState().status).toBe('idle');
    expect(useAuthStore.getState().grant).toBeNull();
  });
});
