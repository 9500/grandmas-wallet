import { binToHex, hexToBin, sha256 } from '@bitauth/libauth';
import {
  type ArchiveStore,
  type JsonValue,
  type SignedMessage,
  blobIdOf,
  canonicalJson,
  collectBlobs,
  decodeBlob,
  encodeBlob,
  keyHashOf,
  seal,
  signMessage,
  unseal,
  verifyMessage,
} from '@grandmas-wallet/archive';
import {
  type ChainReader,
  type ControllerHistory,
  type KeyPair,
  controllerScript,
  deriveXoTemplateKey,
  readControllerHistory,
} from '@grandmas-wallet/core';

import { type EnrollmentPackage, EnrollmentError, packageHash, parsePackage, verifyPackageSignature } from './package.js';

/**
 * The recoverer's side of enrollment: checking a package against the chain
 * before relying on it, and telling the owner it arrived.
 */

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, index) => byte === b[index]);

/** The recovery key a package's credential stands for. */
export const recoveryKeyOf = (enrollment: EnrollmentPackage): KeyPair => {
  const { templateIdentifier, keyIndex } = enrollment.recovery.derivation;
  return deriveXoTemplateKey(enrollment.recovery.mnemonic, templateIdentifier, keyIndex, enrollment.network === 'mainnet' ? 'mainnet' : 'testnet');
};

export interface VerifiedEnrollment {
  enrollment: EnrollmentPackage;
  controller: ControllerHistory;
  recoveryKey: KeyPair;
  /** Whether the package's recovery key is the wallet's recoverer right now. */
  credentialAuthorized: boolean;
  /** Whether the package was signed by the wallet's present owner, or by an earlier one. */
  signedBy: 'current-owner' | 'earlier-owner';
  /** Differences between what the package states and what the chain shows. Empty when they agree. */
  differences: string[];
}

/**
 * Check an opened package before keeping it.
 *
 * @param expectedNetwork - the network the recoverer operates on
 * @throws EnrollmentError if the package is not what it claims to be;
 *   IdentityValidationError if the wallet cannot be found or is not valid on chain
 */
export const verifyEnrollment = async (signed: SignedMessage, chain: ChainReader, expectedNetwork: string): Promise<VerifiedEnrollment> => {
  if (!verifyPackageSignature(signed)) throw new EnrollmentError('The package signature is not valid.');
  const enrollment = parsePackage(signed.message);
  if (enrollment.network !== expectedNetwork) {
    throw new EnrollmentError(`The package is for ${enrollment.network}, not ${expectedNetwork}.`);
  }
  const identity = hexToBin(enrollment.identity);
  if (binToHex(sha256.hash(controllerScript(identity).redeemBytecode)) !== enrollment.controller.scriptHash) {
    throw new EnrollmentError('The wallet uses a controller this software does not know.');
  }

  const controller = await readControllerHistory(chain, identity, enrollment.genesisTransactionId);
  const signer = keyHashOf(signed.publicKey);
  const current = controller.current.state;
  if (!controller.owners.some((owner) => sameBytes(owner.ownerKeyHash, signer))) {
    throw new EnrollmentError('The package was not signed by an owner of this wallet.');
  }

  const recoveryKey = recoveryKeyOf(enrollment);
  const differences: string[] = [];
  if (enrollment.policy.ownerKeyHash !== binToHex(signer)) differences.push('The package names a different owner key than the one that signed it.');
  if (enrollment.policy.recovererKeyHash !== binToHex(recoveryKey.keyHash)) {
    differences.push('The recovery credential does not match the recoverer the package names.');
  }
  if (enrollment.policy.recovererKeyHash !== binToHex(current.recovererKeyHash)) differences.push('The wallet now names a different recoverer.');
  if (enrollment.policy.challengeDelay.unit !== current.challengeDelay.unit || enrollment.policy.challengeDelay.value !== current.challengeDelay.value) {
    differences.push('The wallet now has a different challenge delay.');
  }
  return {
    enrollment,
    controller,
    recoveryKey,
    credentialAuthorized: sameBytes(recoveryKey.keyHash, current.recovererKeyHash),
    signedBy: sameBytes(signer, current.ownerKeyHash) ? 'current-owner' : 'earlier-owner',
    differences,
  };
};

const ACKNOWLEDGMENT_FORMAT = 'grandmas-wallet/enrollment-acknowledgment';
const ACKNOWLEDGMENT_PURPOSE = 'grandmas-wallet/enrollment-acknowledgment/v1';

/**
 * Tell the owner the package arrived. The note is signed with the recovery
 * key, which only someone who opened the package can have, and is left in
 * the wallet's archive, where the owner's wallet looks for it.
 *
 * @throws if no store accepted the note
 */
export const acknowledgeEnrollment = async (signed: SignedMessage, stores: ArchiveStore[], now = Math.floor(Date.now() / 1000)): Promise<void> => {
  const enrollment = parsePackage(signed.message);
  const message: JsonValue = { format: ACKNOWLEDGMENT_FORMAT, version: 1, identity: enrollment.identity, package: packageHash(signed), receivedAt: now };
  const note = signMessage(ACKNOWLEDGMENT_PURPOSE, canonicalJson(message), recoveryKeyOf(enrollment));
  const archiveId = hexToBin(enrollment.archive.archiveId);
  const sealed = seal(hexToBin(enrollment.archive.contentKey), archiveId, encodeBlob({ type: 'acknowledgment', signed: note }));
  const results = await Promise.allSettled(stores.map((store) => store.put(enrollment.archive.archiveId, sealed)));
  if (!results.some((result) => result.status === 'fulfilled' && result.value === blobIdOf(sealed))) {
    throw new Error('No backup store accepted the acknowledgment.');
  }
};

/**
 * - `package-created`: the owner has made the package; nothing shows the recoverer has it
 * - `recoverer-confirmed`: the recoverer opened this exact package and said so
 */
export type EnrollmentStatus = { status: 'package-created' } | { status: 'recoverer-confirmed'; receivedAt: number };

/** The owner's view: has the recoverer confirmed this package? */
export const enrollmentStatus = async (signed: SignedMessage, stores: ArchiveStore[]): Promise<EnrollmentStatus> => {
  const enrollment = parsePackage(signed.message);
  const archiveId = hexToBin(enrollment.archive.archiveId);
  const contentKey = hexToBin(enrollment.archive.contentKey);
  const { blobs } = await collectBlobs(stores, enrollment.archive.archiveId);
  for (const sealed of blobs.values()) {
    try {
      const blob = decodeBlob(unseal(contentKey, archiveId, sealed));
      if (blob.type !== 'acknowledgment' || !verifyMessage(ACKNOWLEDGMENT_PURPOSE, blob.signed)) continue;
      if (binToHex(keyHashOf(blob.signed.publicKey)) !== enrollment.policy.recovererKeyHash) continue;
      const note = JSON.parse(blob.signed.message) as { format?: unknown; identity?: unknown; package?: unknown; receivedAt?: unknown };
      if (note.format !== ACKNOWLEDGMENT_FORMAT || note.identity !== enrollment.identity || note.package !== packageHash(signed)) continue;
      if (typeof note.receivedAt === 'number') return { status: 'recoverer-confirmed', receivedAt: note.receivedAt };
    } catch {
      // Not an acknowledgment this wallet can read; other blobs are not its concern here.
    }
  }
  return { status: 'package-created' };
};

