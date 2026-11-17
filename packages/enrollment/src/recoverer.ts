import { binToHex, hash160, hexToBin } from '@bitauth/libauth';
import {
  type ArchiveContents,
  type RecoveryStatus,
  type SignedMessage,
  type ViewingKeyRecord,
  readViewingKeyRecord,
  recoveryStatus,
  signReceipt,
  viewingKeyRecordHash,
} from '@grandmas-wallet/archive';
import {
  type ChainReader,
  type ControllerHistory,
  type ControllerState,
  type KeyPair,
  type XoNetwork,
  IdentityValidationError,
  afterOwnerUpdate,
  encodeControllerState,
  readControllerHistory,
} from '@grandmas-wallet/core';

import { EnrollmentError } from './envelope.js';
import { type KitArchive, type ReadKit, type RecoveryKit, type SignedJson, credentialKeys, messageHash, toSignedJson } from './kit.js';
import { type ReadTakeover, type ReadUpdate, readHandOver, signHandOver } from './messages.js';

/**
 * The recoverer's side (proposal sections 9.5, 9.7 and 11.1): checking what it is sent against the chain,
 * keeping the kit, leaving receipts, and handing over after a recovery. And the new device's check of what
 * it is handed.
 */

const fail = (message: string): never => {
  throw new EnrollmentError(message);
};
const hex = binToHex;

/** Read a wallet's history, or say that the wallet is not there. */
const historyOf = async (chain: ChainReader, identity: string, creationTransactionId: string): Promise<ControllerHistory> => {
  try {
    return await readControllerHistory(chain, hexToBin(identity), creationTransactionId);
  } catch (error) {
    if (error instanceof IdentityValidationError) return fail(`The wallet is not on chain as the message describes it: ${error.message}`);
    throw error;
  }
};

/** The kit as the recoverer keeps it. It grows when the wallet gets a new seed. */
export interface KeptKit {
  kit: RecoveryKit;
  /** Every viewing-key record the recoverer holds: the current seed's last. */
  viewingKeyRecords: SignedJson[];
  /** The access to every archive: the current one last. */
  archives: KitArchive[];
  /** The hash of the latest message the recoverer has answered with a receipt. */
  answered: string;
  /** The hash of the latest receipt it left. It compares this with what a store returns. */
  latestReceiptHash?: string;
  /** A takeover message it has saved, for a recovery that is not complete yet. */
  pending?: { messageHash: string; proposedKeyHash: string; viewingKeyRecord: SignedJson; archive: KitArchive; answerKey: string };
}

export interface CheckedEnrollment {
  kept: KeptKit;
  history: ControllerHistory;
  /** Whether the controller's current state is in a block. */
  confirmed: boolean;
  /**
   * For a kit given to a recoverer that the controller does not name yet: the output the change is to
   * spend and the state it is to produce, for a prepared receipt.
   */
  prepared?: { controllerOutput: { transactionId: string; index: number }; state: string };
}

const sameDelay = (a: ControllerState['challengeDelay'], b: ControllerState['challengeDelay']): boolean => a.unit === b.unit && a.value === b.value;

/**
 * Check an enrollment message against the chain before relying on it (section 9.5):
 *
 * - it is for this network and its signature is valid (which reading the kit has established);
 * - the identity's creation is valid and the controller can be followed to a current state;
 * - the signer's key hash is the owner in that state, and the viewing-key record is signed by the same key;
 * - the credential's recovery key hash is the recoverer in that state;
 * - the waiting period is the one the message states.
 *
 * A kit for a new recoverer cannot meet the last two before the owner has made the change. It is checked
 * for what can be checked, and the result says what a prepared receipt has to name.
 *
 * @param fetched - viewing-key records fetched from the stores, for a kit that only refers to them. The
 * kit is complete, and can be confirmed, only when every record it refers to is among them.
 * @throws EnrollmentError with the reason
 */
export const checkEnrollment = async (
  read: ReadKit,
  chain: ChainReader,
  options: { forNewRecoverer?: boolean; fetched?: SignedMessage[] } = {},
): Promise<CheckedEnrollment> => {
  const { kit } = read;
  const history = await historyOf(chain, kit.identity, kit.creationTransactionId);
  if (history.closed !== undefined) return fail('The wallet has been closed by its owner.');
  const { state } = history.current;
  if (hex(state.ownerKeyHash) !== kit.policy.ownerKeyHash) return fail('The message is not signed by the key that owns the wallet on chain.');

  // The records the kit carries whole, and those it refers to, which have to have been fetched.
  const fetched = new Map((options.fetched ?? []).map((record) => [viewingKeyRecordHash(record), record]));
  const records: { record: ViewingKeyRecord; signed: SignedMessage }[] = [];
  const missing: string[] = [];
  let whole = 0;
  for (const entry of kit.viewingKeyRecords) {
    if (!('reference' in entry)) {
      records.push(read.viewingKeys[whole++] as ReadKit['viewingKeys'][number]);
      continue;
    }
    const record = fetched.get(entry.reference);
    if (record === undefined) missing.push(entry.reference);
    else records.push({ record: readViewingKeyRecord(record, kit.network), signed: record });
  }
  if (missing.length > 0) {
    return fail(`The kit refers to ${missing.length} viewing-key record${missing.length === 1 ? '' : 's'} that ${missing.length === 1 ? 'has' : 'have'} not been fetched and saved: ${missing.map((hash) => `${hash.slice(0, 12)}…`).join(', ')}. A reference is not the thing itself.`);
  }
  const [current] = records;
  if (current === undefined || hex(hash160(current.record.controllerPublicKey)) !== kit.policy.ownerKeyHash) {
    return fail('The viewing-key record of the current seed is not signed by the key that signed the message.');
  }
  // Every record has to be of a seed that owns or owned the wallet.
  const owners = new Set(history.owners.map((period) => hex(period.ownerKeyHash)));
  for (const { record } of records) {
    if (!owners.has(hex(hash160(record.controllerPublicKey)))) return fail('The kit carries a viewing-key record of a seed that has never owned this wallet.');
  }

  let prepared: CheckedEnrollment['prepared'];
  if (options.forNewRecoverer === true) {
    const intended = afterOwnerUpdate(state, { recovererKeyHash: hexToBin(kit.policy.recovererKeyHash), challengeDelay: kit.policy.challengeDelay });
    prepared = { controllerOutput: { transactionId: hex(history.current.utxo.transactionHash), index: history.current.utxo.index }, state: hex(encodeControllerState(intended)) };
  } else {
    if (hex(state.recovererKeyHash) !== kit.policy.recovererKeyHash) return fail('The credential\'s recovery key is not the recoverer the controller names.');
    if (!sameDelay(state.challengeDelay, kit.policy.challengeDelay)) return fail('The waiting period on chain is not the one the message states.');
  }
  return {
    kept: {
      kit,
      // Oldest first, the current seed's last.
      viewingKeyRecords: records.map(({ signed }) => toSignedJson(signed)).reverse(),
      archives: [...kit.archives].reverse(),
      answered: read.hash,
    },
    history,
    confirmed: history.currentConfirmed,
    ...(prepared === undefined ? {} : { prepared }),
  };
};

/** The viewing-key records an archive holds, for a kit that refers to them by hash. */
export const viewingKeyRecordsIn = (contents: ArchiveContents): SignedMessage[] => contents.blobs.filter(({ blob }) => blob.type === 'viewing-key').map(({ blob }) => blob.signed);

/** The recovery key of a kit: from the credential's words, or the recoverer's own. */
export const recoveryKeyOf = (kit: RecoveryKit, own?: KeyPair): KeyPair => {
  const key = 'words' in kit.credential ? credentialKeys(kit.credential.words, kit.network, kit.rules.templates).recoveryKey : own;
  if (key === undefined) return fail('The recoverer holds its own key for this wallet, and it was not given.');
  return key;
};

/**
 * The recoverer's receipt for the kit as it now stands (section 9.5): it names the message it answers and
 * the hash of every viewing-key record the recoverer holds. It is left on the backup stores.
 *
 * @returns the receipt, and the kit with the receipt's hash kept
 */
export const receiptFor = (kept: KeptKit, recoveryKey: KeyPair, prepared?: CheckedEnrollment['prepared']): { receipt: SignedMessage; kept: KeptKit } => {
  const receipt = signReceipt(
    {
      network: kept.kit.network,
      identity: kept.kit.identity,
      answers: kept.answered,
      viewingKeyRecords: kept.viewingKeyRecords.map((record) => viewingKeyRecordHash(record)),
      recoveryKeyHash: hex(recoveryKey.keyHash),
      ...(prepared === undefined ? {} : { prepared }),
    },
    recoveryKey,
  );
  return { receipt, kept: { ...kept, latestReceiptHash: messageHash(receipt) } };
};

/**
 * Save a takeover message (section 11.1, step 1). The new device's viewing-key record and archive access
 * are with the recoverer from here on, before any request is made, and nothing of the wallet has been
 * given to the new device.
 */
export const saveTakeover = (kept: KeptKit, takeover: ReadTakeover): KeptKit => {
  if (takeover.takeover.network !== kept.kit.network) return fail('The takeover message is for another network.');
  return {
    ...kept,
    pending: {
      messageHash: takeover.hash,
      proposedKeyHash: takeover.takeover.proposedKeyHash,
      viewingKeyRecord: takeover.takeover.viewingKeyRecord,
      archive: takeover.takeover.archive,
      answerKey: takeover.takeover.answerKey,
    },
  };
};

/**
 * Take a saved takeover into the kit once its key has owned the wallet. A device may be lost between the
 * completion and the hand-over; its viewing-key record and archive must not be dropped when the next
 * takeover message arrives. One whose key never owned the wallet is left as it is, to be replaced.
 */
export const settlePending = (kept: KeptKit, history: ControllerHistory): KeptKit => {
  const { pending, ...rest } = kept;
  if (pending === undefined || !history.owners.some((period) => hex(period.ownerKeyHash) === pending.proposedKeyHash)) return kept;
  return { ...rest, viewingKeyRecords: [...kept.viewingKeyRecords, pending.viewingKeyRecord], archives: [...kept.archives, pending.archive], answered: pending.messageHash };
};

/**
 * Hand over to the new device after completion (section 11.1, step 6): the identity, the transaction that
 * created it, the viewing-key record of every earlier seed, the access to earlier archives, and the
 * recoverer's receipt for the kit as it now stands.
 *
 * Earlier viewing keys read the wallet. They are handed over only once the chain shows the proposed key
 * as the owner.
 *
 * @returns the hand-over to seal to the device's answer key, the receipt to leave on the stores, and the kit as it now stands
 * @throws EnrollmentError before the recovery is complete
 */
export const handOver = async (kept: KeptKit, chain: ChainReader, recoveryKey: KeyPair): Promise<{ handOver: SignedMessage; receipt: SignedMessage; answerKey: Uint8Array; kept: KeptKit }> => {
  const { pending } = kept;
  if (pending === undefined) return fail('No takeover message has been saved for this wallet.');
  const history = await historyOf(chain, kept.kit.identity, kept.kit.creationTransactionId);
  if (hex(history.current.state.ownerKeyHash) !== pending.proposedKeyHash) {
    return fail('The proposed key is not the owner on chain. The earlier viewing keys are handed over only after the recovery is complete.');
  }
  if (!history.currentConfirmed) return fail('The completion is not confirmed yet.');
  const earlier = { viewingKeyRecords: kept.viewingKeyRecords, archives: kept.archives };
  const { pending: _done, ...rest } = kept;
  const grown: KeptKit = {
    ...rest,
    viewingKeyRecords: [...kept.viewingKeyRecords, pending.viewingKeyRecord],
    archives: [...kept.archives, pending.archive],
    answered: pending.messageHash,
  };
  const { receipt, kept: after } = receiptFor(grown, recoveryKey);
  const signed = signHandOver(
    { network: kept.kit.network, identity: kept.kit.identity, creationTransactionId: kept.kit.creationTransactionId, viewingKeyRecords: earlier.viewingKeyRecords, archives: earlier.archives, receipt: toSignedJson(receipt) },
    recoveryKey,
  );
  return { handOver: signed, receipt, answerKey: hexToBin(pending.answerKey), kept: after };
};

/**
 * Check an update message (section 9.7) and take in what it brings. The message has to be signed by the
 * key that owns the wallet on chain. The recoverer then leaves a prepared receipt, which names the output
 * the change is to spend and the state it is to produce; only after that does the owner make the change.
 */
export const takeUpdate = async (kept: KeptKit, update: ReadUpdate, chain: ChainReader): Promise<{ kept: KeptKit; prepared: NonNullable<CheckedEnrollment['prepared']> }> => {
  if (update.update.identity !== kept.kit.identity) return fail('The update message is for another wallet.');
  const history = await historyOf(chain, kept.kit.identity, kept.kit.creationTransactionId);
  const { state } = history.current;
  if (hex(state.ownerKeyHash) !== update.signerKeyHash) return fail('The update message is not signed by the key that owns the wallet on chain.');
  const { newSeed, challengeDelay } = update.update;
  const intended = afterOwnerUpdate(state, {
    ...(newSeed === undefined ? {} : { ownerKeyHash: hexToBin(newSeed.proposedKeyHash) }),
    ...(challengeDelay === undefined ? {} : { challengeDelay }),
  });
  return {
    kept: {
      ...kept,
      viewingKeyRecords: newSeed === undefined ? kept.viewingKeyRecords : [...kept.viewingKeyRecords, newSeed.viewingKeyRecord],
      archives: newSeed === undefined ? kept.archives : [...kept.archives, newSeed.archive],
      answered: update.hash,
    },
    prepared: { controllerOutput: { transactionId: hex(history.current.utxo.transactionHash), index: history.current.utxo.index }, state: hex(encodeControllerState(intended)) },
  };
};

/** What a new device learns from a hand-over, after checking it against the chain itself. */
export interface CheckedHandOver {
  identity: string;
  creationTransactionId: string;
  history: ControllerHistory;
  /** The viewing keys of earlier seeds: what finds the coins to sweep. */
  earlier: { record: ViewingKeyRecord; signed: SignedMessage }[];
  archives: KitArchive[];
  receipt: SignedMessage;
  /**
   * What the recoverer should hold and did not hand over. The device says so; it does not report an empty
   * wallet because a viewing key is missing.
   */
  missing: string[];
  /** Whether recovery is on again: the recoverer's receipt names this device's viewing-key record. */
  recovery: RecoveryStatus;
}

/**
 * The new device's check of a hand-over (section 11.1, step 6). It reads the identity's history itself and
 * sees its own key as the owner; it takes nothing about the chain on the recoverer's word.
 *
 * @param own - this device's controller key, the hash of its viewing-key record, and the hash of the takeover message it sent
 * @throws EnrollmentError if the hand-over is not from the wallet's recoverer or this device is not the owner
 */
export const checkHandOver = async (
  signed: SignedMessage,
  chain: ChainReader,
  network: XoNetwork,
  own: { controllerKeyHash: Uint8Array; viewingKeyRecordHash: string; takeoverHash: string },
): Promise<CheckedHandOver> => {
  const read = readHandOver(signed, network);
  const history = await historyOf(chain, read.handOver.identity, read.handOver.creationTransactionId);
  const ownerKeyHash = hex(own.controllerKeyHash);
  if (hex(history.current.state.ownerKeyHash) !== ownerKeyHash) return fail('This device\'s key is not the owner of the wallet the hand-over names.');
  if (hex(history.current.state.recovererKeyHash) !== read.signerKeyHash) return fail('The hand-over is not signed by the wallet\'s recoverer.');

  const earlierOwners = history.owners.filter((period) => hex(period.ownerKeyHash) !== ownerKeyHash);
  const earlier: CheckedHandOver['earlier'] = [];
  const missing: string[] = [];
  const held = new Set<string>();
  for (const record of read.viewingKeyRecords) {
    try {
      const viewingKey = readViewingKeyRecord(record, network);
      const seed = hex(hash160(viewingKey.controllerPublicKey));
      if (earlierOwners.some((period) => hex(period.ownerKeyHash) === seed)) {
        earlier.push({ record: viewingKey, signed: record });
        held.add(seed);
      }
    } catch {
      missing.push('A viewing-key record in the hand-over could not be read.');
    }
  }
  for (const period of earlierOwners) {
    if (!held.has(hex(period.ownerKeyHash))) {
      missing.push(`The viewing key of the seed that owned the wallet in epoch ${period.ownerEpoch} was not handed over: coins at its addresses cannot be found.`);
    }
  }
  const recovery = recoveryStatus(
    [read.receipt],
    { messageHash: own.takeoverHash, viewingKeyRecordHash: own.viewingKeyRecordHash, recoveryKeyHash: read.signerKeyHash, ownerKeyHash },
    history,
    network,
  );
  return {
    identity: read.handOver.identity,
    creationTransactionId: read.handOver.creationTransactionId,
    history,
    earlier,
    archives: read.handOver.archives,
    receipt: read.receipt,
    missing,
    recovery,
  };
};
