import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import {
  type JsonValue,
  type PositionDescription,
  type SignedMessage,
  type TemplateReference,
  canonicalJson,
  parseRecord,
  signMessage,
  verifyMessage,
} from '@grandmas-wallet/archive';
import type { ChallengeDelay, KeyPair } from '@grandmas-wallet/core';

/**
 * The enrollment package: everything a recoverer needs, given once.
 *
 * It names the wallet and where it was created, carries the recovery
 * credential, and says where the wallet's restoration archive is kept and
 * how to read it. Records written after enrollment are found through the
 * archive, so no second package is needed as the wallet is used.
 *
 * The package is signed by the wallet's owner key. Whoever reads it can see
 * the wallet's retained history through the archive key; it gives no power
 * to spend.
 */

export const PACKAGE_FORMAT = 'grandmas-wallet/enrollment';
export const PACKAGE_VERSION = 1;
const PACKAGE_PURPOSE = 'grandmas-wallet/enrollment/v1';

export interface EnrollmentPackage {
  format: typeof PACKAGE_FORMAT;
  version: typeof PACKAGE_VERSION;
  network: string;
  /** Wallet identity, in the byte order shown by explorers. */
  identity: string;
  /** The transaction that created the identity. */
  genesisTransactionId: string;
  controller: {
    /** Version of the recovery rules the controller follows. */
    schemeVersion: number;
    /** Version of the owner-approval interface the wallet's funds use. */
    interfaceVersion: number;
    /** SHA-256 of this wallet's controller script. */
    scriptHash: string;
    /** The template the wallet is operated with; the full text is in the archive. */
    template: TemplateReference;
  };
  recovery: {
    /** A mnemonic made for the recoverer alone. Unrelated to the owner's keys. */
    mnemonic: string;
    /** How the recovery key follows from the mnemonic. */
    derivation: { scheme: 'xo-template'; templateIdentifier: string; keyIndex: number };
  };
  archive: {
    /** Addresses of the backup stores. */
    stores: string[];
    archiveId: string;
    /** Lets the holder read the archive. */
    contentKey: string;
  };
  /** Positions that existed when the package was made. The wallet's ordinary funds need no entry. */
  manifest: PositionDescription[];
  /** What the owner agreed to, for the recoverer to compare with the chain. */
  policy: {
    ownerKeyHash: string;
    recovererKeyHash: string;
    challengeDelay: ChallengeDelay;
    /** Who the package is for, as the owner saw it, e.g. the recoverer's host name. */
    recoverer: string;
    /** Unix seconds. */
    createdAt: number;
  };
}

export class EnrollmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnrollmentError';
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isHex = (value: unknown, bytes: number): value is string => typeof value === 'string' && value.length === bytes * 2 && /^[0-9a-f]*$/.test(value);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const fail = (message: string): never => {
  throw new EnrollmentError(message);
};

/** Positions in the manifest are described exactly as in archive records, so they are checked the same way. */
const parseManifest = (value: unknown, network: string, identity: string): PositionDescription[] => {
  if (!Array.isArray(value)) return fail('The package has no manifest.');
  return value.map((position) => {
    const record = parseRecord(
      JSON.stringify({
        format: 'grandmas-wallet/archive-record', version: 1, network, identity, sequence: 0, previous: null, ownerEpoch: 0, createdAt: 0,
        entry: { type: 'position', status: 'confirmed', position },
      }),
    );
    return (record.entry as { position: PositionDescription }).position;
  });
};

/** @throws EnrollmentError if the text is not a package of this format and version */
export const parsePackage = (message: string): EnrollmentPackage => {
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    return fail('The package is not readable.');
  }
  if (!isObject(value) || value['format'] !== PACKAGE_FORMAT) return fail('This is not an enrollment package.');
  if (value['version'] !== PACKAGE_VERSION) return fail(`Enrollment package version ${String(value['version'])} is not supported.`);
  const { network, identity, genesisTransactionId, controller, recovery, archive, manifest, policy } = value;
  if (typeof network !== 'string' || !isHex(identity, 32) || !isHex(genesisTransactionId, 32)) {
    return fail('The package does not name a wallet.');
  }
  if (
    !isObject(controller) || !isCount(controller['schemeVersion']) || !isCount(controller['interfaceVersion']) ||
    !isHex(controller['scriptHash'], 32) || !isObject(controller['template']) ||
    typeof controller['template']['identifier'] !== 'string' || !isHex(controller['template']['contentHash'], 32)
  ) {
    return fail('The package does not describe the controller.');
  }
  const derivation = isObject(recovery) ? recovery['derivation'] : undefined;
  if (
    !isObject(recovery) || typeof recovery['mnemonic'] !== 'string' || !isObject(derivation) || derivation['scheme'] !== 'xo-template' ||
    !isHex(derivation['templateIdentifier'], 32) || !isCount(derivation['keyIndex'])
  ) {
    return fail('The package carries no usable recovery credential.');
  }
  if (
    !isObject(archive) || !Array.isArray(archive['stores']) || archive['stores'].length === 0 ||
    archive['stores'].some((store) => typeof store !== 'string') || !isHex(archive['archiveId'], 16) || !isHex(archive['contentKey'], 32)
  ) {
    return fail('The package does not say where the archive is.');
  }
  const delay = isObject(policy) ? policy['challengeDelay'] : undefined;
  if (
    !isObject(policy) || !isHex(policy['ownerKeyHash'], 20) || !isHex(policy['recovererKeyHash'], 20) || !isObject(delay) ||
    (delay['unit'] !== 'blocks' && delay['unit'] !== 'time512') || !isCount(delay['value']) ||
    typeof policy['recoverer'] !== 'string' || !isCount(policy['createdAt'])
  ) {
    return fail('The package does not state the recovery policy.');
  }
  return {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    network,
    identity,
    genesisTransactionId,
    controller: {
      schemeVersion: controller['schemeVersion'],
      interfaceVersion: controller['interfaceVersion'],
      scriptHash: controller['scriptHash'],
      template: { identifier: controller['template']['identifier'], contentHash: controller['template']['contentHash'] },
    },
    recovery: {
      mnemonic: recovery['mnemonic'],
      derivation: { scheme: 'xo-template', templateIdentifier: derivation['templateIdentifier'], keyIndex: derivation['keyIndex'] },
    },
    archive: { stores: archive['stores'] as string[], archiveId: archive['archiveId'], contentKey: archive['contentKey'] },
    manifest: parseManifest(manifest, network, identity),
    policy: {
      ownerKeyHash: policy['ownerKeyHash'],
      recovererKeyHash: policy['recovererKeyHash'],
      challengeDelay: { unit: delay['unit'], value: delay['value'] },
      recoverer: policy['recoverer'],
      createdAt: policy['createdAt'],
    },
  };
};

/** Sign a package with the wallet's owner key. */
export const signPackage = (enrollment: EnrollmentPackage, ownerKey: KeyPair): SignedMessage => {
  // Parsing first means a package that could not be read back is never signed.
  const checked = parsePackage(JSON.stringify(enrollment));
  return signMessage(PACKAGE_PURPOSE, canonicalJson(checked as unknown as JsonValue), ownerKey);
};

/** Whether the signature is valid for the key the package carries. Whose key it is, is checked against the chain. */
export const verifyPackageSignature = (signed: SignedMessage): boolean => verifyMessage(PACKAGE_PURPOSE, signed);

/** Names one exact package, for an acknowledgment to refer to. */
export const packageHash = (signed: SignedMessage): string => binToHex(sha256.hash(utf8ToBin(signed.message)));
