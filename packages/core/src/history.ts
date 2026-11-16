import { type TransactionCommon, binToHex, decodeTransactionBch, hashTransactionUiOrder, hexToBin } from '@bitauth/libauth';

import { controllerScript } from './controller.js';
import {
  type ControllerSnapshot,
  type ControllerTransition,
  IdentityValidationError,
  followController,
  validateGenesis,
} from './genesis.js';

/**
 * Reading a wallet's controller from the chain.
 *
 * Each wallet's controller has its own address, so the transactions at that
 * address are the controller's history. Starting from the transaction that
 * created the identity, each spend is followed to the current state. Nothing
 * a server says is trusted beyond the transactions themselves, each of which
 * is checked against the one before it.
 */

export interface UnspentOutputEntry {
  transactionId: string;
  index: number;
  valueSatoshis: bigint;
  /** 0 or less while unconfirmed. */
  height: number;
  hasToken: boolean;
}

export interface HistoryEntry {
  transactionId: string;
  /** 0 or less while unconfirmed. */
  height: number;
}

/** What reading a wallet from the chain needs from a server. */
export interface ChainReader {
  /** The raw transaction as hex, or `undefined` if unknown. */
  getTransaction(transactionId: string): Promise<string | undefined>;
  /** Every transaction that created or spent an output of the script. */
  getHistory(lockingBytecode: Uint8Array): Promise<HistoryEntry[]>;
  listUnspent(lockingBytecode: Uint8Array): Promise<UnspentOutputEntry[]>;
}

/** One owner of the wallet: the key in control during an owner epoch. */
export interface OwnerPeriod {
  ownerEpoch: number;
  ownerKeyHash: Uint8Array;
  /** The transaction that put this owner in control. */
  sinceTransactionId: string;
}

export interface ControllerHistoryTransaction {
  transactionId: string;
  transaction: TransactionCommon;
  confirmed: boolean;
}

export interface ControllerHistory {
  genesis: ControllerSnapshot;
  transitions: ControllerTransition[];
  current: ControllerSnapshot;
  /** Whether the transaction holding the current state is in a block. */
  currentConfirmed: boolean;
  owners: OwnerPeriod[];
  /** The genesis and every later controller transaction, oldest first. */
  transactions: ControllerHistoryTransaction[];
}

const outpointKey = (transactionId: string, index: number): string => `${transactionId}:${index}`;

/**
 * Read and check a wallet's controller history.
 *
 * @param identity - the wallet identity, in the byte order shown by explorers
 * @param genesisTransactionId - when known, the transaction expected to have created the identity
 * @throws IdentityValidationError if the genesis or any step is not valid
 */
export const readControllerHistory = async (
  chain: ChainReader,
  identity: Uint8Array,
  genesisTransactionId?: string,
): Promise<ControllerHistory> => {
  const { lockingBytecode } = controllerScript(identity);
  const entries = await chain.getHistory(lockingBytecode);
  const identityHex = binToHex(identity);

  const decoded = new Map<string, ControllerHistoryTransaction>();
  for (const entry of entries) {
    const hex = await chain.getTransaction(entry.transactionId);
    if (hex === undefined) {
      // A step that cannot be read would be mistaken for the end of the history.
      throw new IdentityValidationError(`Transaction ${entry.transactionId} from the controller's history is not available from the server.`);
    }
    const encoded = hexToBin(hex);
    const transaction = decodeTransactionBch(encoded);
    if (typeof transaction === 'string' || binToHex(hashTransactionUiOrder(encoded)) !== entry.transactionId) {
      throw new IdentityValidationError(`The server returned something else in place of transaction ${entry.transactionId}.`);
    }
    decoded.set(entry.transactionId, { transactionId: entry.transactionId, transaction, confirmed: entry.height > 0 });
  }

  // The genesis is the transaction that spends output 0 of the transaction the identity is named after.
  const creators = [...decoded.values()].filter(({ transaction }) =>
    transaction.inputs.some((input) => input.outpointIndex === 0 && binToHex(input.outpointTransactionHash) === identityHex),
  );
  const [creator] = creators;
  if (creator === undefined) {
    throw new IdentityValidationError('No transaction creating this identity was found at its controller address.');
  }
  if (genesisTransactionId !== undefined && creator.transactionId !== genesisTransactionId) {
    throw new IdentityValidationError('The identity was created by a different transaction than the one expected.');
  }
  const genesis = validateGenesis(creator.transaction, hexToBin(creator.transactionId), identity);

  const bySpentController = new Map<string, ControllerHistoryTransaction>();
  for (const item of decoded.values()) {
    const [first] = item.transaction.inputs;
    if (first !== undefined) bySpentController.set(outpointKey(binToHex(first.outpointTransactionHash), first.outpointIndex), item);
  }

  const transitions: ControllerTransition[] = [];
  const transactions: ControllerHistoryTransaction[] = [creator];
  const owners: OwnerPeriod[] = [
    { ownerEpoch: genesis.state.ownerEpoch, ownerKeyHash: genesis.state.ownerKeyHash, sinceTransactionId: creator.transactionId },
  ];
  let current: ControllerSnapshot = genesis;
  let currentConfirmed = creator.confirmed;
  for (;;) {
    const next = bySpentController.get(outpointKey(binToHex(current.utxo.transactionHash), current.utxo.index));
    if (next === undefined) break;
    const transition = followController(current, next.transaction, hexToBin(next.transactionId));
    transitions.push(transition);
    transactions.push(next);
    if (transition.state.ownerEpoch !== current.state.ownerEpoch) {
      owners.push({
        ownerEpoch: transition.state.ownerEpoch,
        ownerKeyHash: transition.state.ownerKeyHash,
        sinceTransactionId: next.transactionId,
      });
    }
    current = transition;
    currentConfirmed = next.confirmed;
  }

  return { genesis, transitions, current, currentConfirmed, owners, transactions };
};
