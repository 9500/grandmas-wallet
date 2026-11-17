import { binToHex, hash160, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';
import { type ControllerHistory, type ControllerState, type KeyPair, type XoNetwork, decodeControllerState, encodeControllerState } from '@grandmas-wallet/core';

import { type JsonValue, canonicalJson } from './canonical.js';
import { type SignedMessage, signMessage, verifyMessage } from './signing.js';

/**
 * The recoverer's receipt (proposal section 9.5): its signed statement of what it holds for a wallet.
 *
 * It is left on the backup stores, where the wallet finds it, so no channel from the recoverer back to
 * the owner is needed. A store's answer that something was uploaded is not a receipt. The wallet says that
 * recovery is on only when a receipt matches what it sent and the controller's confirmed state matches both.
 *
 * A receipt given before a change takes effect (a new seed, a new recoverer) is a prepared receipt. It
 * also names the controller output it was prepared against and the state the change is to produce, and it
 * counts only once the chain shows exactly that change.
 */

export const RECEIPT_FORMAT = 'grandmas-wallet/receipt';
export const RECEIPT_VERSION = 1;
const RECEIPT_PURPOSE = 'grandmas-wallet/receipt/v1';

export class ReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptError';
  }
}

const fail = (message: string): never => {
  throw new ReceiptError(message);
};

export interface ReceiptFields {
  network: XoNetwork;
  /** Wallet identity, in the byte order shown by explorers. */
  identity: string;
  /** The hash of the message this receipt answers: an enrollment, takeover or update message. */
  answers: string;
  /** The hash of every viewing-key record the recoverer now holds. */
  viewingKeyRecords: string[];
  /** hash160 of the recovery key, as hex. The receipt is signed with that key. */
  recoveryKeyHash: string;
  /** Present in a prepared receipt. */
  prepared?: {
    /** The controller output the change is to spend. */
    controllerOutput: { transactionId: string; index: number };
    /** The 69 bytes of state the change is to produce, as hex. */
    state: string;
  };
}

/** A receipt that was read: its form and its signature are right. Whether it counts is decided against the chain. */
export interface Receipt extends ReceiptFields {
  /** SHA-256 of the signed text: what the device and the recoverer keep of the latest receipt. */
  hash: string;
}

/** Sign a receipt with the recovery key. */
export const signReceipt = (fields: ReceiptFields, recoveryKey: KeyPair): SignedMessage => {
  if (binToHex(recoveryKey.keyHash) !== fields.recoveryKeyHash) throw new ReceiptError('A receipt is signed with the recovery key it names.');
  const body: JsonValue = {
    format: RECEIPT_FORMAT,
    version: RECEIPT_VERSION,
    network: fields.network,
    identity: fields.identity,
    answers: fields.answers,
    viewingKeyRecords: [...fields.viewingKeyRecords].sort(),
    recoveryKeyHash: fields.recoveryKeyHash,
    ...(fields.prepared === undefined ? {} : { prepared: { controllerOutput: { ...fields.prepared.controllerOutput }, state: fields.prepared.state } }),
  };
  return signMessage(RECEIPT_PURPOSE, canonicalJson(body), recoveryKey);
};

export const receiptHash = (signed: Pick<SignedMessage, 'message'>): string => binToHex(sha256.hash(utf8ToBin(signed.message)));

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isHex = (value: unknown, bytes: number): value is string => typeof value === 'string' && value.length === bytes * 2 && /^[0-9a-f]*$/.test(value);

/**
 * Read a receipt: its form, its one encoding, and that it is signed with the recovery key it names.
 *
 * @throws ReceiptError
 */
export const readReceipt = (signed: SignedMessage, network: XoNetwork): Receipt => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(signed.message);
  } catch {
    return fail('The receipt cannot be read.');
  }
  if (!isObject(parsed) || canonicalJson(parsed as JsonValue) !== signed.message) return fail('The receipt is not in its canonical form.');
  if (parsed['format'] !== RECEIPT_FORMAT) return fail('This is not a receipt.');
  if (parsed['version'] !== RECEIPT_VERSION) return fail(`Receipts of version ${String(parsed['version'])} are not known.`);
  if (parsed['network'] !== network) return fail(`The receipt is for ${String(parsed['network'])}, not for ${network}.`);
  const { identity, answers, viewingKeyRecords, recoveryKeyHash, prepared } = parsed;
  if (!isHex(identity, 32) || !isHex(answers, 32) || !isHex(recoveryKeyHash, 20)) return fail('The receipt is incomplete.');
  if (!Array.isArray(viewingKeyRecords) || !viewingKeyRecords.every((hash) => isHex(hash, 32))) return fail('The receipt does not list the viewing-key records it stands for.');
  let preparedFor: ReceiptFields['prepared'];
  if (prepared !== undefined) {
    const output = isObject(prepared) ? prepared['controllerOutput'] : undefined;
    if (!isObject(prepared) || !isObject(output) || !isHex(output['transactionId'], 32) || typeof output['index'] !== 'number' || !isHex(prepared['state'], 69)) {
      return fail('The prepared receipt does not say what it was prepared for.');
    }
    preparedFor = { controllerOutput: { transactionId: output['transactionId'], index: output['index'] }, state: prepared['state'] };
  }
  if (binToHex(hash160(signed.publicKey)) !== recoveryKeyHash) return fail('The receipt is not signed with the recovery key it names.');
  if (!verifyMessage(RECEIPT_PURPOSE, signed)) return fail('The receipt\'s signature is not valid.');
  return { network, identity, answers, viewingKeyRecords: viewingKeyRecords as string[], recoveryKeyHash, ...(preparedFor === undefined ? {} : { prepared: preparedFor }), hash: receiptHash(signed) };
};

/** What the wallet sent, and holds a receipt against. */
export interface Sent {
  /** The hash of the message the receipt is to answer. */
  messageHash: string;
  /** The hash of the viewing-key record of the seed the wallet now runs on. */
  viewingKeyRecordHash: string;
  /** The recovery key hash the wallet named, as hex. */
  recoveryKeyHash: string;
  /** hash160 of this device's controller key, as hex. */
  ownerKeyHash: string;
}

export interface RecoveryStatus {
  /** Whether the wallet may say that recovery is on. */
  on: boolean;
  /** The receipt that makes it so. */
  receipt?: Receipt;
  /** Why not, one entry for each receipt that was looked at, or one saying that there is none. */
  reasons: string[];
}

const hex = binToHex;

/** Why a receipt does not count against what was sent and the chain; `undefined` when it does. */
const whyNot = (receipt: Receipt, sent: Sent, history: ControllerHistory): string | undefined => {
  if (receipt.identity !== hex(history.genesis.identity)) return 'it is for another wallet';
  if (receipt.answers !== sent.messageHash) return 'it answers another message than the one this wallet sent';
  if (receipt.recoveryKeyHash !== sent.recoveryKeyHash) return 'it is signed with another recovery key than the one this wallet named';
  if (!receipt.viewingKeyRecords.includes(sent.viewingKeyRecordHash)) return 'it does not name this seed\'s viewing-key record';
  if (history.closed !== undefined) return 'the wallet is closed';
  const { state } = history.current;
  if (receipt.prepared === undefined) {
    if (hex(state.recovererKeyHash) !== receipt.recoveryKeyHash) return 'the controller names another recoverer';
    if (hex(state.ownerKeyHash) !== sent.ownerKeyHash) return 'the controller names another owner than this device';
    if (!history.currentConfirmed) return 'the controller\'s state is not confirmed yet';
    return undefined;
  }
  // A prepared receipt counts only once the chain shows exactly the change it was prepared for.
  let intended;
  try {
    intended = decodeControllerState(hexToBin(receipt.prepared.state));
  } catch {
    return 'the state it was prepared for is not a controller state';
  }
  if (hex(intended.recovererKeyHash) !== receipt.recoveryKeyHash) return 'it is not signed with the recovery key the change installs';
  if (hex(intended.ownerKeyHash) !== sent.ownerKeyHash) return 'the change it was prepared for installs another owner than this device';
  const before = [history.genesis, ...history.transitions];
  const change = history.transitions.findIndex((transition, index) => {
    const spent = before[index]?.utxo;
    return (
      spent !== undefined &&
      hex(spent.transactionHash) === receipt.prepared?.controllerOutput.transactionId &&
      spent.index === receipt.prepared.controllerOutput.index &&
      hex(encodeControllerState(transition.state)) === receipt.prepared.state
    );
  });
  if (change < 0) return 'the chain does not show the change it was prepared for';
  if (history.transactions[change + 1]?.confirmed !== true) return 'the change it was prepared for is not confirmed yet';
  // The controller may have moved on since (an approval, a request); the settings must still be the ones prepared for.
  if (hex(state.ownerKeyHash) !== hex(intended.ownerKeyHash) || hex(state.recovererKeyHash) !== hex(intended.recovererKeyHash)) return 'the controller\'s settings have changed since';
  if (state.challengeDelay.unit !== intended.challengeDelay.unit || state.challengeDelay.value !== intended.challengeDelay.value) return 'the waiting period has changed since';
  return undefined;
};

/**
 * Whether recovery is on (proposal sections 9.5 and 10.5): a receipt matches what the wallet sent, and the
 * controller's confirmed state matches both.
 *
 * @param receipts - what the stores returned as receipts; unreadable ones do not count
 */
export const recoveryStatus = (receipts: SignedMessage[], sent: Sent, history: ControllerHistory, network: XoNetwork): RecoveryStatus => {
  const reasons: string[] = [];
  for (const signed of receipts) {
    let receipt: Receipt;
    try {
      receipt = readReceipt(signed, network);
    } catch (error) {
      reasons.push(`A receipt does not count: ${(error as Error).message}`);
      continue;
    }
    const reason = whyNot(receipt, sent, history);
    if (reason === undefined) return { on: true, receipt, reasons: [] };
    reasons.push(`A receipt does not count: ${reason}.`);
  }
  return { on: false, reasons: reasons.length > 0 ? reasons : ['The recoverer has left no receipt.'] };
};

/**
 * Whether the recoverer's prepared receipt is in place for a change the owner is about to make (section
 * 9.7): it answers the message that announced the change, names the viewing-key record and the recovery
 * key that are to apply, and was prepared against the controller's present output for exactly the state the
 * change produces. The owner signs the change only after this; if the controller has moved since, the
 * receipt has to be prepared again.
 *
 * @param sent - what was sent about the change: the message, the record and the keys that are to apply after it
 * @param intended - the state the change is to produce
 */
export const preparedReceipt = (receipts: SignedMessage[], sent: Sent, history: ControllerHistory, intended: ControllerState, network: XoNetwork): RecoveryStatus => {
  const reasons: string[] = [];
  const state = hex(encodeControllerState(intended));
  const { utxo } = history.current;
  for (const signed of receipts) {
    let receipt: Receipt;
    try {
      receipt = readReceipt(signed, network);
    } catch (error) {
      reasons.push(`A receipt does not count: ${(error as Error).message}`);
      continue;
    }
    const reason = ((): string | undefined => {
      if (receipt.identity !== hex(history.genesis.identity)) return 'it is for another wallet';
      if (receipt.answers !== sent.messageHash) return 'it answers another message than the one that announced this change';
      if (receipt.recoveryKeyHash !== sent.recoveryKeyHash || hex(intended.recovererKeyHash) !== sent.recoveryKeyHash) return 'it is not signed with the recovery key that is to apply';
      if (hex(intended.ownerKeyHash) !== sent.ownerKeyHash) return 'the change does not install the owner key that was announced';
      if (!receipt.viewingKeyRecords.includes(sent.viewingKeyRecordHash)) return 'it does not name the viewing-key record that is to apply';
      if (receipt.prepared === undefined) return 'it was not prepared for a change';
      if (receipt.prepared.controllerOutput.transactionId !== hex(utxo.transactionHash) || receipt.prepared.controllerOutput.index !== utxo.index) return 'it was prepared against another controller output than the present one';
      if (receipt.prepared.state !== state) return 'it was prepared for other settings';
      return undefined;
    })();
    if (reason === undefined) return { on: true, receipt, reasons: [] };
    reasons.push(`A receipt does not count: ${reason}.`);
  }
  return { on: false, reasons: reasons.length > 0 ? reasons : ['The recoverer has left no receipt.'] };
};
