import { binToHex, flattenBinArray, sha256, utf8ToBin } from '@bitauth/libauth';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

/**
 * Encryption of everything kept in an archive.
 *
 * A store sees only sealed blobs. Each is named by the hash of its bytes, so
 * a store or a reader can tell a damaged blob from an intact one without
 * being able to read it. The content key lets its holder read; it does not
 * make a record valid, which takes the owner's signature.
 */

export const CONTENT_KEY_LENGTH = 32;
export const ARCHIVE_ID_LENGTH = 16;
const NONCE_LENGTH = 24;
const CONTEXT = utf8ToBin('grandmas-wallet/archive/v1');

export class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealError';
  }
}

const randomBytes = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length));

export const generateContentKey = (): Uint8Array => randomBytes(CONTENT_KEY_LENGTH);
export const generateArchiveId = (): Uint8Array => randomBytes(ARCHIVE_ID_LENGTH);

/** A blob's name: the hash of its sealed bytes. */
export const blobIdOf = (sealed: Uint8Array): string => binToHex(sha256.hash(sealed));

const associatedData = (archiveId: Uint8Array): Uint8Array => flattenBinArray([CONTEXT, archiveId]);

export const seal = (contentKey: Uint8Array, archiveId: Uint8Array, plaintext: Uint8Array): Uint8Array => {
  if (contentKey.length !== CONTENT_KEY_LENGTH) throw new SealError('The content key must be 32 bytes.');
  const nonce = randomBytes(NONCE_LENGTH);
  const ciphertext = xchacha20poly1305(contentKey, nonce, associatedData(archiveId)).encrypt(plaintext);
  return flattenBinArray([nonce, ciphertext]);
};

/** @throws SealError if the blob was not sealed with this key for this archive, or was altered */
export const unseal = (contentKey: Uint8Array, archiveId: Uint8Array, sealed: Uint8Array): Uint8Array => {
  if (contentKey.length !== CONTENT_KEY_LENGTH) throw new SealError('The content key must be 32 bytes.');
  if (sealed.length < NONCE_LENGTH + 16) throw new SealError('The blob is too short to be a sealed record.');
  try {
    return xchacha20poly1305(contentKey, sealed.slice(0, NONCE_LENGTH), associatedData(archiveId)).decrypt(sealed.slice(NONCE_LENGTH));
  } catch {
    throw new SealError('The blob cannot be opened with this archive key.');
  }
};
