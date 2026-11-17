import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { type SignedMessage, signViewingKeyRecord } from '@grandmas-wallet/archive';
import {
  type ChainReader,
  type ControllerUpdate,
  type KeyPair,
  type SeedKeys,
  buildTransaction,
  controllerInput,
  controllerSuccessor,
  deriveCredentialKeys,
  deriveSeedKeys,
  p2pkhInput,
  p2pkhLockingBytecode,
  xoTemplateIndex,
} from '@grandmas-wallet/core';
import { SimulatedChain, TestWallet } from '@grandmas-wallet/testing';

import { type KitArchive, type KitInput, type TemplateReference, toSignedJson } from '../src/index.js';

/** What the tests of this package share: the wallet's templates by reference, seeds, a credential, a wallet on the simulated chain. */

const named = (text: string): string => binToHex(sha256.hash(utf8ToBin(text)));
/** Five templates, as the wallet has: the identifier the engine gives each and the hash of its text. */
export const templates: TemplateReference[] = ['controller', 'givenOut', 'change', 'actions', 'coins'].map((name) => ({ name, identifier: named(`identifier of ${name}`), contentHash: named(`text of ${name}`) }));
const numberOf = (name: string): number => xoTemplateIndex(templates.find((template) => template.name === name)?.identifier ?? '');
export const numbers = { controller: numberOf('controller'), givenOut: numberOf('givenOut'), change: numberOf('change'), standardWallet: numberOf('coins') };

export const WORDS_A = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export const WORDS_B = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
export const WORDS_C = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';
export const CREDENTIAL_WORDS = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
export const OTHER_CREDENTIAL_WORDS = 'army van defense carry jealous true garbage claim echo media make crunch';

export const seedOf = (words: string) => deriveSeedKeys(words, 'testnet', numbers);
export const credential = deriveCredentialKeys(CREDENTIAL_WORDS, 'testnet', numbers);
export const otherCredential = deriveCredentialKeys(OTHER_CREDENTIAL_WORDS, 'testnet', numbers);
export const hex = binToHex;
export const DELAY = { unit: 'time512', value: 1 } as const;
export const RECOVERER_PAGE = 'https://recoverer.9500.cash/';

export const archiveAt = (fill: number): KitArchive => ({ stores: ['https://store1.9500.cash', 'https://store2.9500.cash'], archiveId: binToHex(new Uint8Array(16).fill(fill)), contentKey: binToHex(new Uint8Array(32).fill(fill + 1)) });

/** A wallet owned by seed A, with the credential's recovery key as its recoverer. */
export const setup = () => {
  const chain = new SimulatedChain();
  const seedA = seedOf(WORDS_A);
  const wallet = TestWallet.create(chain, { owner: seedA.controllerKey, recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: DELAY });
  return { chain, wallet, seedA, identity: wallet.identityHex };
};

/** The kit the owner makes for a wallet: one seed, one archive, the credential's words. */
export const kitInput = (wallet: TestWallet, seed: Pick<SeedKeys, 'network' | 'viewingKey' | 'controllerKey'>, change: Partial<KitInput> = {}): KitInput => ({
  network: 'testnet',
  identity: wallet.identityHex,
  creationTransactionId: wallet.genesisTransactionId,
  rules: { controller: 1, addressScheme: 1, templates },
  credential: { words: CREDENTIAL_WORDS },
  viewingKeyRecords: [toSignedJson(signViewingKeyRecord(seed))],
  archives: [archiveAt(0x30)],
  policy: { challengeDelay: DELAY, recipient: 'recoverer.9500.cash', madeAt: 1_794_950_000 },
  ...change,
});

/** The owner changes the wallet's settings: a new owner key, a new recoverer, a new waiting period. */
export const ownerUpdate = (chain: SimulatedChain, wallet: TestWallet, owner: KeyPair, update: ControllerUpdate): string => {
  const { utxo, state } = wallet.controller();
  const action = { kind: 'ownerUpdate' as const, update };
  const feeLocking = p2pkhLockingBytecode(owner.keyHash);
  const feeId = chain.fund(feeLocking, 5_000n);
  const [fee] = chain.outputsAt(feeLocking).filter((coin) => binToHex(coin.transactionHash) === feeId);
  if (fee === undefined) throw new Error('fee coin missing');
  return wallet.send(
    buildTransaction({ inputs: [controllerInput(utxo, state, action, owner), p2pkhInput(fee, owner)], outputs: [controllerSuccessor(utxo, state, action)], changeLockingBytecode: feeLocking }),
  );
};

export const reader = (chain: SimulatedChain): ChainReader => chain;
export type { SignedMessage };
