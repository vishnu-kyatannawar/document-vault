import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAuthUrl,
  consumeAuthRedirect,
  readPendingRedirect,
  redirectUri,
  startAuthRedirect,
} from '../src/auth/googleAuth';
import { DRIVE_SCOPE } from '../src/config';

const BASE = import.meta.env.BASE_URL; // '/' under vitest

describe('googleAuth — redirect flow', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', BASE);
  });
  afterEach(() => vi.restoreAllMocks());

  it('builds the Google auth URL with the exact redirect URI and scopes', () => {
    const url = new URL(buildAuthUrl({ mode: 'interactive', nonce: 'n1' }));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('redirect_uri')).toBe(redirectUri());
    expect(redirectUri()).toBe(`${window.location.origin}${BASE}`);
    expect(url.searchParams.get('response_type')).toBe('token');
    expect(url.searchParams.get('scope')).toContain(DRIVE_SCOPE);
    expect(url.searchParams.get('state')).toBe('n1');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    // No known account → let the user pick one.
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.get('login_hint')).toBeNull();
  });

  it('silent mode never shows UI and hints the account', () => {
    const url = new URL(buildAuthUrl({ mode: 'silent', nonce: 'n2', loginHint: 'a@b.com' }));
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(url.searchParams.get('login_hint')).toBe('a@b.com');
  });

  it('interactive mode with a known account re-uses consent (no forced prompt)', () => {
    const url = new URL(buildAuthUrl({ mode: 'interactive', nonce: 'n3', loginHint: 'a@b.com' }));
    expect(url.searchParams.get('prompt')).toBeNull();
    expect(url.searchParams.get('login_hint')).toBe('a@b.com');
  });

  it('startAuthRedirect remembers nonce + return path, then navigates', () => {
    window.history.replaceState(null, '', `${BASE}documents/abc?x=1`);
    const navigate = vi.fn();

    startAuthRedirect({ mode: 'silent', loginHint: 'a@b.com' }, navigate);

    const pending = readPendingRedirect();
    expect(pending?.mode).toBe('silent');
    expect(pending?.returnTo).toBe(`${BASE}documents/abc?x=1`);
    expect(pending?.nonce).toMatch(/^[0-9a-f]{32}$/);
    const url = new URL(navigate.mock.calls[0][0] as string);
    expect(url.searchParams.get('state')).toBe(pending?.nonce);
  });

  it('never returns to a path outside the app', () => {
    const navigate = vi.fn();
    startAuthRedirect({ mode: 'interactive', returnTo: 'https://evil.example/' }, navigate);
    expect(readPendingRedirect()?.returnTo).toBe(BASE);
  });

  it('returns null when the URL is not an auth response', () => {
    expect(consumeAuthRedirect()).toBeNull();
    window.history.replaceState(null, '', `${BASE}#section`);
    expect(consumeAuthRedirect()).toBeNull();
  });

  it('parses a successful response, verifies state, and scrubs the URL', () => {
    const navigate = vi.fn();
    startAuthRedirect({ mode: 'silent', returnTo: `${BASE}documents/abc` }, navigate);
    const nonce = readPendingRedirect()!.nonce;
    window.history.replaceState(
      null,
      '',
      `${BASE}#access_token=tok123&token_type=Bearer&expires_in=3599&scope=${encodeURIComponent(
        `openid email ${DRIVE_SCOPE}`,
      )}&state=${nonce}`,
    );
    const before = Date.now();

    const result = consumeAuthRedirect();

    expect(result).toMatchObject({ ok: true, mode: 'silent', returnTo: `${BASE}documents/abc` });
    if (!result?.ok) throw new Error('expected success');
    expect(result.grant.accessToken).toBe('tok123');
    // expires_in minus a one-minute safety margin
    expect(result.grant.expiresAt).toBeGreaterThanOrEqual(before + 3539_000);
    expect(result.grant.expiresAt).toBeLessThanOrEqual(Date.now() + 3539_000);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe(`${BASE}documents/abc`);
    expect(readPendingRedirect()).toBeNull();
  });

  it('rejects a response whose state does not match', () => {
    startAuthRedirect({ mode: 'interactive' }, vi.fn());
    window.history.replaceState(null, '', `${BASE}#access_token=tok&expires_in=3599&scope=${DRIVE_SCOPE}&state=forged`);

    expect(consumeAuthRedirect()).toMatchObject({ ok: false, error: 'state_mismatch' });
    expect(window.location.hash).toBe('');
  });

  it('passes Google errors through', () => {
    startAuthRedirect({ mode: 'silent' }, vi.fn());
    const nonce = readPendingRedirect()!.nonce;
    window.history.replaceState(null, '', `${BASE}#error=login_required&state=${nonce}`);

    expect(consumeAuthRedirect()).toMatchObject({ ok: false, mode: 'silent', error: 'login_required' });
  });

  it('treats a grant without the Drive scope as denied', () => {
    startAuthRedirect({ mode: 'interactive' }, vi.fn());
    const nonce = readPendingRedirect()!.nonce;
    window.history.replaceState(null, '', `${BASE}#access_token=tok&expires_in=3599&scope=openid%20email&state=${nonce}`);

    expect(consumeAuthRedirect()).toMatchObject({ ok: false, error: 'access_denied' });
  });
});
