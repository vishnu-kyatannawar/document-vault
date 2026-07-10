// Password protection for exported bundles.
//
// Layout: MAGIC("DVLT1") | salt(16) | iv(12) | AES-GCM ciphertext.
// Key = PBKDF2-SHA256(password, salt, 200k iterations). WebCrypto only —
// nothing here touches the network or persists key material.

const MAGIC = new TextEncoder().encode('DVLT1');
const SALT_LEN = 16;
const IV_LEN = 12;
const PBKDF2_ITERATIONS = 200_000;

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** True when the bytes carry the encrypted-bundle magic header. */
export function isEncrypted(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC.length) return false;
  return MAGIC.every((b, i) => bytes[i] === b);
}

/** Seal zip bytes with a password. */
export async function encryptBundle(data: Uint8Array, password: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(password, salt);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      data as BufferSource,
    ),
  );

  const out = new Uint8Array(MAGIC.length + SALT_LEN + IV_LEN + ciphertext.length);
  out.set(MAGIC, 0);
  out.set(salt, MAGIC.length);
  out.set(iv, MAGIC.length + SALT_LEN);
  out.set(ciphertext, MAGIC.length + SALT_LEN + IV_LEN);
  return out;
}

/** Open a sealed bundle. Throws a friendly error on wrong password/bad input. */
export async function decryptBundle(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  if (!isEncrypted(bytes)) {
    throw new Error('This file is not an encrypted vault bundle.');
  }
  const salt = bytes.slice(MAGIC.length, MAGIC.length + SALT_LEN);
  const iv = bytes.slice(MAGIC.length + SALT_LEN, MAGIC.length + SALT_LEN + IV_LEN);
  const ciphertext = bytes.slice(MAGIC.length + SALT_LEN + IV_LEN);
  const key = await deriveKey(password, salt);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        ciphertext as BufferSource,
      ),
    );
  } catch {
    // AES-GCM auth failure — almost always a wrong password.
    throw new Error('Wrong password for this bundle.');
  }
}
