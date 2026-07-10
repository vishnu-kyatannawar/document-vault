import { beforeAll, describe, expect, it, vi } from 'vitest';

// jsdom lacks SubtleCrypto — back the global with Node's WebCrypto.
beforeAll(async () => {
  if (!globalThis.crypto?.subtle) {
    const { webcrypto } = await import('node:crypto');
    vi.stubGlobal('crypto', webcrypto);
  }
});

describe('crypto bundle helpers', () => {
  it('encrypt → decrypt round-trips the exact bytes', async () => {
    const { encryptBundle, decryptBundle } = await import('../src/services/crypto');
    const data = new Uint8Array([1, 2, 3, 250, 251, 252, 0, 42]);

    const sealed = await encryptBundle(data, 'hunter2');
    expect(sealed).not.toEqual(data);

    const opened = await decryptBundle(sealed, 'hunter2');
    expect(Array.from(opened)).toEqual(Array.from(data));
  });

  it('rejects a wrong password with a friendly error', async () => {
    const { encryptBundle, decryptBundle } = await import('../src/services/crypto');
    const sealed = await encryptBundle(new Uint8Array([9, 9, 9]), 'right');

    await expect(decryptBundle(sealed, 'wrong')).rejects.toThrow(/password/i);
  });

  it('rejects bytes that are not an encrypted bundle', async () => {
    const { decryptBundle } = await import('../src/services/crypto');
    await expect(
      decryptBundle(new Uint8Array([0x50, 0x4b, 3, 4, 5, 6, 7, 8]), 'x'),
    ).rejects.toThrow(/not .*encrypted/i);
  });

  it('isEncrypted sniffs the magic header', async () => {
    const { encryptBundle, isEncrypted } = await import('../src/services/crypto');
    const sealed = await encryptBundle(new Uint8Array([1]), 'pw');

    expect(isEncrypted(sealed)).toBe(true);
    expect(isEncrypted(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe(false); // plain zip
    expect(isEncrypted(new Uint8Array([]))).toBe(false);
  });
});
