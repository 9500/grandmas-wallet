import { binToHex } from '@bitauth/libauth';
import {
  type ChainReader,
  type ControllerUpdate,
  type KeyPair,
  type TemplateNumbers,
  buildTransaction,
  controllerInput,
  controllerSuccessor,
  deriveCredentialKeys,
  deriveSeedKeys,
  p2pkhInput,
  p2pkhLockingBytecode,
  readControllerHistory,
} from '@grandmas-wallet/core';
import { SimulatedChain, TestWallet } from '@grandmas-wallet/testing';

/** What the tests of this package share: seeds, a credential, and a wallet on the simulated chain. */

export const numbers: TemplateNumbers = { controller: 11, givenOut: 22, change: 33, standardWallet: 44 };
export const WORDS_A = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export const WORDS_B = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
export const WORDS_C = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';
export const CREDENTIAL_WORDS = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
export const OTHER_CREDENTIAL_WORDS = 'army van defense carry jealous true garbage claim echo media make crunch';

export const seedOf = (words: string) => deriveSeedKeys(words, 'testnet', numbers);
export const credential = deriveCredentialKeys(CREDENTIAL_WORDS, 'testnet', numbers);
export const otherCredential = deriveCredentialKeys(OTHER_CREDENTIAL_WORDS, 'testnet', numbers);
export const hex = binToHex;

/** A wallet owned by seed A, with the credential's recovery key as its recoverer. */
export const setup = () => {
  const chain = new SimulatedChain();
  const seedA = seedOf(WORDS_A);
  const wallet = TestWallet.create(chain, { owner: seedA.controllerKey, recovererKeyHash: credential.recoveryKey.keyHash });
  const history = (reader: ChainReader = chain) => readControllerHistory(reader, wallet.identity, wallet.genesisTransactionId);
  return { chain, wallet, seedA, history, identity: wallet.identityHex };
};

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

/** A server that reports everything as not yet in a block. */
export const unconfirmed = (chain: SimulatedChain): ChainReader => ({
  getTransaction: (id) => chain.getTransaction(id),
  listUnspent: (script) => chain.listUnspent(script),
  getHistory: async (script) => (await chain.getHistory(script)).map((entry) => ({ ...entry, height: 0 })),
});
