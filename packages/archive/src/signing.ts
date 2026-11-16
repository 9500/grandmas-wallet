import { flattenBinArray, hash160, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import type { KeyPair } from '@grandmas-wallet/core';

/**
 * Signatures over messages, each bound to a purpose so that a signature made
 * for one kind of message is never valid for another, or for a transaction.
 */

export interface SignedMessage {
  message: string;
  publicKey: Uint8Array;
  signature: Uint8Array;
}

const digest = (purpose: string, message: string): Uint8Array =>
  sha256.hash(flattenBinArray([sha256.hash(utf8ToBin(purpose)), utf8ToBin(message)]));

export const signMessage = (purpose: string, message: string, key: KeyPair): SignedMessage => {
  const signature = secp256k1.signMessageHashSchnorr(key.privateKey, digest(purpose, message));
  if (typeof signature === 'string') throw new Error(`Signing failed: ${signature}`);
  return { message, publicKey: key.publicKey, signature };
};

/** Whether the signature is valid for the message and its key. Says nothing about whose key it is. */
export const verifyMessage = (purpose: string, signed: SignedMessage): boolean =>
  secp256k1.verifySignatureSchnorr(signed.signature, signed.publicKey, digest(purpose, signed.message));

export const keyHashOf = (publicKey: Uint8Array): Uint8Array => hash160(publicKey);
