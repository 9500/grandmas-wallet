import { binToHex, hexToBin } from '@bitauth/libauth';
import { type ChainReader, type ControllerHistory, p2pkhLockingBytecode, readControllerHistory } from '@grandmas-wallet/core';
import { type KeptKit, credentialKeys, recoveryKeyOf } from '@grandmas-wallet/enrollment';

import { type FeeReadiness, feeReadinessOf } from './recoverer-wallet.js';
import { kitTemplates } from './recovery-flow.js';
import { addressOf } from './support.js';

/**
 * What a recoverer reads from the chain about a wallet it looks after, without opening an account for it:
 * where the controller stands, and what the fee address holds (proposal sections 9.6 and 11.1). A
 * recoverer that looks after several wallets shows all of them this way.
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

/** The fee address of a wallet's credential, and whether it holds what a recovery takes. */
export interface FeeView extends FeeReadiness {
  address: string;
}

/**
 * @returns `undefined` for a kit whose recoverer holds a key of its own, not a credential: its fee coins are wherever it keeps them
 */
export const feeView = async (chain: ChainReader, kept: KeptKit, feeRate = 1): Promise<FeeView | undefined> => {
  if (!('words' in kept.kit.credential)) return undefined;
  const locking = p2pkhLockingBytecode(credentialKeys(kept.kit.credential.words, kept.kit.network, kitTemplates()).feeKey.keyHash);
  const coins = await chain.listUnspent(locking);
  const holds = coins.filter((coin) => !coin.hasToken).reduce((sum, coin) => sum + coin.valueSatoshis, 0n);
  return { address: addressOf(locking, kept.kit.network === 'mainnet' ? 'mainnet' : 'chipnet'), ...feeReadinessOf(holds, feeRate) };
};
