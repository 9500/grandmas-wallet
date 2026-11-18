import { binToHex, hexToBin } from '@bitauth/libauth';
import { type ChainReader, type ControllerHistory, INPUT_BYTES, p2pkhInput, p2pkhLockingBytecode, readControllerHistory } from '@grandmas-wallet/core';
import { type KeptKit, credentialKeys, recoveryKeyOf } from '@grandmas-wallet/enrollment';

import type { GivenInput } from './recoverer-funds.js';
import { kitTemplates } from './recovery-flow.js';

/**
 * What a recoverer reads from the chain about a wallet it looks after: where the controller stands (proposal
 * section 11.1), and coins an earlier version of this software left at the wallet's fee address (section 9.6).
 * A recoverer that looks after several wallets shows all of them this way.
 */

const hex = binToHex;

export type RecovererStanding =
  /** The owner is in charge and nothing is asked. */
  | { kind: 'quiet' }
  | { kind: 'requested'; proposedKeyHash: string; confirmed: boolean }
  /** The controller names another recoverer: this one was replaced, or is not named yet. */
  | { kind: 'not named'; ownerKeyHash: string }
  | { kind: 'closed' };

export interface RecovererView {
  history: ControllerHistory;
  standing: RecovererStanding;
  /** The owner on chain is the key that a takeover this recoverer saved or handed over proposed. */
  takenOver: boolean;
}

export const viewAsRecoverer = async (chain: ChainReader, kept: KeptKit): Promise<RecovererView> => {
  const history = await readControllerHistory(chain, hexToBin(kept.kit.identity), kept.kit.creationTransactionId);
  const { state } = history.current;
  let standing: RecovererStanding;
  if (history.closed !== undefined) standing = { kind: 'closed' };
  else if (hex(state.recovererKeyHash) !== hex(recoveryKeyOf(kept.kit).keyHash)) standing = { kind: 'not named', ownerKeyHash: hex(state.ownerKeyHash) };
  else if (state.proposedOwnerKeyHash !== undefined) standing = { kind: 'requested', proposedKeyHash: hex(state.proposedOwnerKeyHash), confirmed: history.currentConfirmed };
  else standing = { kind: 'quiet' };
  const proposed = kept.pending?.proposedKeyHash ?? kept.handedOver?.proposedKeyHash;
  return { history, standing, takenOver: proposed !== undefined && hex(state.ownerKeyHash) === proposed };
};

/**
 * Coins at the fee address of a wallet's credential. Until 18 November 2026 the recoverer kept a reserve for its
 * fees there; since then every fee is paid from its balance. What is still there is the recoverer's own, and its
 * page brings it into the balance: each coin comes back ready to be spent with the credential's fee key.
 *
 * A kit whose recoverer holds a key of its own has no such address.
 */
export const earlierFeeCoins = async (chain: ChainReader, kept: KeptKit): Promise<GivenInput[]> => {
  if (!('words' in kept.kit.credential)) return [];
  const { feeKey } = credentialKeys(kept.kit.credential.words, kept.kit.network, kitTemplates());
  const lockingBytecode = p2pkhLockingBytecode(feeKey.keyHash);
  return (await chain.listUnspent(lockingBytecode))
    .filter((coin) => !coin.hasToken)
    .map((coin) => ({ ...p2pkhInput({ transactionHash: hexToBin(coin.transactionId), index: coin.index, output: { lockingBytecode, valueSatoshis: coin.valueSatoshis } }, feeKey), inputBytes: INPUT_BYTES.p2pkh }));
};
