import { base64ToBin, binToBase64, binToHex, binToUtf8, flattenBinArray, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';
import { type SignedMessage, canonicalBytes } from '@grandmas-wallet/archive';
import { Chacha20Poly1305 } from '@hpke/chacha20poly1305';
import { CipherSuite } from '@hpke/core';
import { DhkemX25519HkdfSha256, HkdfSha256 } from '@hpke/dhkem-x25519';

export class EnrollmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnrollmentError';
  }
}

/**
 * Sealing a package to the recoverer.
 *
 * The owner encrypts the signed package to the recoverer's public encryption
 * key and sends it once, in a link or a QR code. Anyone may see it in
 * transit; only the holder of the matching private key can open it. The
 * scheme is HPKE (RFC 9180) in base mode with X25519, HKDF-SHA256 and
 * ChaCha20-Poly1305. Who made the package is settled by the owner's
 * signature inside it, not by the encryption.
 */

const ENVELOPE_VERSION = 0x01;
const INFO = utf8ToBin('grandmas-wallet/enrollment/v1');
const ENCAPSULATED_KEY_LENGTH = 32;
const LINK_FIELD = 'enroll';

const suite = (): CipherSuite => new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305() });

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer;

/** The recoverer's encryption key. Not a wallet key: it can open packages and nothing else. */
export interface RecipientKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export const generateRecipientKeyPair = async (): Promise<RecipientKeyPair> => {
  const { kem } = suite();
  const pair = await kem.generateKeyPair();
  return {
    publicKey: new Uint8Array(await kem.serializePublicKey(pair.publicKey)),
    privateKey: new Uint8Array(await kem.serializePrivateKey(pair.privateKey)),
  };
};

/** A short form of a recipient key for people to compare, e.g. `3f9a 01bc 77d2 e480`. */
export const recipientKeyFingerprint = (publicKey: Uint8Array): string =>
  (binToHex(sha256.hash(publicKey)).slice(0, 16).match(/.{4}/g) ?? []).join(' ');

/** Encrypt a signed package to the recoverer. */
export const sealPackage = async (signed: SignedMessage, recipientPublicKey: Uint8Array): Promise<Uint8Array> => {
  const hpke = suite();
  const plaintext = canonicalBytes({ message: signed.message, publicKey: binToHex(signed.publicKey), signature: binToHex(signed.signature) });
  const { enc, ct } = await hpke.seal(
    { recipientPublicKey: await hpke.kem.deserializePublicKey(toArrayBuffer(recipientPublicKey)), info: toArrayBuffer(INFO) },
    toArrayBuffer(plaintext),
    toArrayBuffer(Uint8Array.of(ENVELOPE_VERSION)),
  );
  return flattenBinArray([Uint8Array.of(ENVELOPE_VERSION), new Uint8Array(enc), new Uint8Array(ct)]);
};

/**
 * Open an envelope with the recoverer's private key.
 * @throws EnrollmentError if the envelope is not for this key or was altered
 */
export const openPackage = async (envelope: Uint8Array, recipientPrivateKey: Uint8Array): Promise<SignedMessage> => {
  if (envelope[0] !== ENVELOPE_VERSION) throw new EnrollmentError('This kind of enrollment envelope is not supported.');
  if (envelope.length <= 1 + ENCAPSULATED_KEY_LENGTH) throw new EnrollmentError('The enrollment envelope is incomplete.');
  const hpke = suite();
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await hpke.open(
        {
          recipientKey: await hpke.kem.deserializePrivateKey(toArrayBuffer(recipientPrivateKey)),
          enc: toArrayBuffer(envelope.slice(1, 1 + ENCAPSULATED_KEY_LENGTH)),
          info: toArrayBuffer(INFO),
        },
        toArrayBuffer(envelope.slice(1 + ENCAPSULATED_KEY_LENGTH)),
        toArrayBuffer(Uint8Array.of(ENVELOPE_VERSION)),
      ),
    );
  } catch {
    throw new EnrollmentError('The enrollment envelope cannot be opened with this key.');
  }
  const value = JSON.parse(binToUtf8(plaintext)) as { message?: unknown; publicKey?: unknown; signature?: unknown };
  if (typeof value.message !== 'string' || typeof value.publicKey !== 'string' || typeof value.signature !== 'string') {
    throw new EnrollmentError('The enrollment envelope does not hold a signed package.');
  }
  return { message: value.message, publicKey: hexToBin(value.publicKey), signature: hexToBin(value.signature) };
};

const toBase64Url = (bytes: Uint8Array): string => binToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (text: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new EnrollmentError('The enrollment link is damaged.');
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBin(padded + '='.repeat((4 - (padded.length % 4)) % 4));
};

/**
 * A link that hands the envelope to the recoverer's page. The envelope is in
 * the part after `#`, which browsers do not send to the server.
 */
export const enrollmentLink = (recovererPage: string, envelope: Uint8Array): string => {
  const url = new URL(recovererPage);
  url.hash = `${LINK_FIELD}=${toBase64Url(envelope)}`;
  return url.toString();
};

/** @throws EnrollmentError if the link carries no envelope */
export const envelopeFromLink = (link: string): Uint8Array => {
  const fragment = new URL(link).hash.replace(/^#/, '');
  const value = new URLSearchParams(fragment).get(LINK_FIELD);
  if (value === null || value === '') throw new EnrollmentError('The link carries no enrollment package.');
  return fromBase64Url(value);
};
