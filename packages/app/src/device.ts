import { hexToBin } from '@bitauth/libauth';
import { type ArchiveStore, type RestoreReport, restore } from '@grandmas-wallet/archive';
import { readControllerHistory } from '@grandmas-wallet/core';

import type { XoAccount } from './account.js';
import { type Eligibility, recoveryEligibility } from './eligibility.js';
import { type WalletDependencies, OwnerWallet, walletKeys } from './owner.js';
import { positionKinds } from './positions.js';
import type { RecoveryTicket } from './recoverer.js';
import { type AppChain, hex } from './support.js';

/**
 * A new device taking a wallet over: it makes the key that is to become the
 * owner, hands its hash to the recoverer inside the recovery request, and
 * once the request has run its course, rebuilds the wallet from the chain and
 * the archive.
 */

/** What the new device keeps while the recovery runs. */
export interface TakeoverRecord {
  version: 1;
  wallet: Omit<RecoveryTicket, 'invitation' | 'version'>;
  /** Hash of the key this device made, as hex. */
  proposedOwnerKeyHash: string;
  /** The request with this device's key named, for the recoverer. */
  joinedInvitation: string;
  /** Whether the request as sent has been taken in. */
  requestReceived: boolean;
  startedAt: number;
}

export type TakeoverProgress =
  /** The recoverer has not sent the request yet, or it names another key. */
  | { stage: 'waiting-for-request' }
  /** The request is on chain and the delay is running. */
  | { stage: 'waiting-for-delay'; requestedIn: string; eligibility: Eligibility }
  /** The wallet names this device's key as owner. */
  | { stage: 'ready' }
  /** The request was cancelled, or the wallet went to another key. */
  | { stage: 'not-proceeding'; reason: string };

/** Join the recoverer's request, making this device's owner key if it has none yet. */
export const joinRecovery = async (account: XoAccount, ticket: RecoveryTicket, now = Math.floor(Date.now() / 1000)): Promise<TakeoverRecord> => {
  if (ticket.version !== 1) throw new Error('This link was made by a newer version of the recoverer\'s software.');
  const firstTime = !(await account.hasKey('ownerKey'));
  const joined = await account.join({
    invitation: ticket.invitation,
    role: 'owner',
    // The device creates its owner key on its first request and names the same key on any later one.
    ...(firstTime ? { generate: ['ownerKey'] } : {}),
    derive: { proposedOwnerKeyHash: 'ownerKey' },
  });
  const proposed = joined.derived['proposedOwnerKeyHash'];
  if (typeof proposed !== 'string') throw new Error('This device could not make its key.');
  const { network, identity, genesisTransactionId, archive } = ticket;
  return {
    version: 1,
    wallet: { network, identity, genesisTransactionId, archive },
    proposedOwnerKeyHash: proposed,
    joinedInvitation: joined.invitation,
    requestReceived: false,
    startedAt: now,
  };
};

/** Take in the request as the recoverer sent it, which is how the device's engine learns of the wallet's controller. */
export const receiveRequest = async (account: XoAccount, takeover: TakeoverRecord, invitation: string): Promise<void> => {
  await account.continue({ invitation });
  takeover.requestReceived = true;
};

/** Where the takeover stands, read from the chain. */
export const takeoverProgress = async (chain: AppChain, takeover: TakeoverRecord, mnemonic: string): Promise<TakeoverProgress> => {
  const history = await readControllerHistory(chain, hexToBin(takeover.wallet.identity), takeover.wallet.genesisTransactionId);
  const { state } = history.current;
  const mine = new Set(walletKeys(mnemonic, takeover.wallet.network).map((key) => hex(key.keyHash)));
  if (mine.has(hex(state.ownerKeyHash))) return { stage: 'ready' };
  if (state.proposedOwnerKeyHash !== undefined) {
    if (mine.has(hex(state.proposedOwnerKeyHash))) {
      const requestedIn = history.transactions.at(-1)?.transactionId ?? '';
      const entries = await chain.getHistory(history.current.utxo.output.lockingBytecode);
      const height = entries.find((entry) => entry.transactionId === requestedIn)?.height ?? 0;
      return { stage: 'waiting-for-delay', requestedIn, eligibility: await recoveryEligibility(chain, height, state.challengeDelay) };
    }
    return { stage: 'not-proceeding', reason: 'A recovery request is open for this wallet, but to a different device.' };
  }
  // Active under the earlier owner: either the request has not been sent, or it was sent and cancelled.
  const requestedBefore = history.transitions.some((transition) => transition.state.proposedOwnerKeyHash !== undefined && mine.has(hex(transition.state.proposedOwnerKeyHash)));
  return requestedBefore
    ? { stage: 'not-proceeding', reason: 'The recovery request was cancelled by the wallet\'s current owner.' }
    : { stage: 'waiting-for-request' };
};

/** Read the wallet from the chain and the archive into this device's own copy. */
export const restoreForTakeover = (account: XoAccount, chain: AppChain, takeover: TakeoverRecord, stores: ArchiveStore[], local: ArchiveStore): Promise<RestoreReport> =>
  restore({
    network: takeover.wallet.network,
    identity: takeover.wallet.identity,
    genesisTransactionId: takeover.wallet.genesisTransactionId,
    archiveId: hexToBin(takeover.wallet.archive.archiveId),
    contentKey: hexToBin(takeover.wallet.archive.contentKey),
    chain,
    stores,
    local,
    kinds: positionKinds(account),
  });

/** Finish the takeover once the wallet names this device's key: restore, and open the wallet here. */
export const completeTakeover = async (deps: WalletDependencies, takeover: TakeoverRecord): Promise<{ wallet: OwnerWallet; report: RestoreReport }> => {
  const report = await restoreForTakeover(deps.account, deps.chain, takeover, takeover.wallet.archive.stores.map(deps.openStore), deps.local);
  const wallet = await OwnerWallet.takeOver(deps, takeover.wallet, report);
  return { wallet, report };
};
