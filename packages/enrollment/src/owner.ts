import { binToHex, generateBip39Mnemonic, sha256 } from '@bitauth/libauth';
import {
  type PositionDescription,
  type SignedMessage,
  type TemplateReference,
  generateArchiveId,
  generateContentKey,
} from '@grandmas-wallet/archive';
import { type ControllerState, type KeyPair, controllerScript, deriveXoTemplateKey } from '@grandmas-wallet/core';

import { type EnrollmentPackage, PACKAGE_FORMAT, PACKAGE_VERSION, signPackage } from './package.js';

/**
 * The owner's side of enrollment: making the recovery credential before the
 * wallet exists, and the package once it does.
 */

/** Version of the recovery rules the controller contract implements. */
export const RECOVERY_SCHEME_VERSION = 1;
/** Version of the owner-approval interface the wallet's funds and positions use. */
export const AUTHORIZATION_INTERFACE_VERSION = 2;

export interface RecoveryCredential {
  /** Made for the recoverer alone; the owner's wallet does not keep it after the package is made. */
  mnemonic: string;
  derivation: EnrollmentPackage['recovery']['derivation'];
  /** Goes into the wallet's controller as the recoverer. */
  keyHash: Uint8Array;
}

/**
 * Make a recovery credential: a fresh mnemonic, unrelated to the owner's,
 * and the key hash to name as the wallet's recoverer.
 */
export const createRecoveryCredential = (templateIdentifier: string, network: string): RecoveryCredential => {
  const mnemonic = generateBip39Mnemonic();
  const derivation = { scheme: 'xo-template' as const, templateIdentifier, keyIndex: 0 };
  const { keyHash } = deriveXoTemplateKey(mnemonic, templateIdentifier, 0, network === 'mainnet' ? 'mainnet' : 'testnet');
  return { mnemonic, derivation, keyHash };
};

/** Where a new wallet's archive will be, and the key to read it. */
export const createArchiveAccess = (stores: string[]): EnrollmentPackage['archive'] => ({
  stores,
  archiveId: binToHex(generateArchiveId()),
  contentKey: binToHex(generateContentKey()),
});

export interface PackageParameters {
  network: string;
  /** Wallet identity, in the byte order shown by explorers. */
  identity: Uint8Array;
  genesisTransactionId: string;
  /** The controller's state as the owner set it up. */
  state: ControllerState;
  template: TemplateReference;
  credential: Pick<RecoveryCredential, 'mnemonic' | 'derivation'>;
  archive: EnrollmentPackage['archive'];
  manifest?: PositionDescription[];
  /** Who the package is for, as shown to the owner. */
  recoverer: string;
  ownerKey: KeyPair;
  /** Unix seconds. */
  now?: number;
}

/** Make and sign the package for the recoverer. */
export const createEnrollmentPackage = (parameters: PackageParameters): SignedMessage =>
  signPackage(
    {
      format: PACKAGE_FORMAT,
      version: PACKAGE_VERSION,
      network: parameters.network,
      identity: binToHex(parameters.identity),
      genesisTransactionId: parameters.genesisTransactionId,
      controller: {
        schemeVersion: RECOVERY_SCHEME_VERSION,
        interfaceVersion: AUTHORIZATION_INTERFACE_VERSION,
        scriptHash: binToHex(sha256.hash(controllerScript(parameters.identity).redeemBytecode)),
        template: parameters.template,
      },
      recovery: { mnemonic: parameters.credential.mnemonic, derivation: parameters.credential.derivation },
      archive: parameters.archive,
      manifest: parameters.manifest ?? [],
      policy: {
        ownerKeyHash: binToHex(parameters.state.ownerKeyHash),
        recovererKeyHash: binToHex(parameters.state.recovererKeyHash),
        challengeDelay: parameters.state.challengeDelay,
        recoverer: parameters.recoverer,
        createdAt: parameters.now ?? Math.floor(Date.now() / 1000),
      },
    },
    parameters.ownerKey,
  );
