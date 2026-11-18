import { RecovererFunds, RecovererWallet, walletTemplateNumbers } from '@grandmas-wallet/app';
import { type KeyPair, deriveSeedKeys, p2pkhLockingBytecode } from '@grandmas-wallet/core';
import { KeyBackend, type SimulatedChain } from '@grandmas-wallet/testing';

/**
 * A recoverer on the simulated chain: its one balance, from which it pays every fee, and its side of a wallet.
 * The balance is a seed of its own; the key for a wallet's controller comes from that wallet's credential.
 */

export const FUNDS_WORDS = 'ozone drill grab fiber curtain grace pudding thank cruise elder eight picnic';

export interface TestFunds {
  funds: RecovererFunds;
  /** The key of the balance's address. */
  key: KeyPair;
  address: Uint8Array;
}

/** A recoverer's balance, holding one coin of `satoshis` unless that is zero. */
export const recovererFunds = async (chain: SimulatedChain, satoshis = 20_000n, words = FUNDS_WORDS): Promise<TestFunds> => {
  const keys = deriveSeedKeys(words, 'testnet', walletTemplateNumbers());
  const address = p2pkhLockingBytecode(keys.fundingKey.keyHash);
  if (satoshis > 0n) chain.fund(address, satoshis);
  return { funds: await RecovererFunds.open({ backend: new KeyBackend(chain, keys), chain }), key: keys.fundingKey, address };
};

/** The recoverer's side of a wallet, paid from a balance: the given one, or a new one that holds 20,000 satoshis. */
export const recovererOf = async (chain: SimulatedChain, identity: Uint8Array, recoveryKey: KeyPair, funds?: RecovererFunds): Promise<RecovererWallet> =>
  RecovererWallet.open({ funds: funds ?? (await recovererFunds(chain)).funds, chain, identity, recoveryKey });
