import { type Output, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { SERVICE_LIMITS, checkJoinedInvitation, readInvitationOutline } from '@grandmas-wallet/connect';
import {
  type AccountCoin,
  type PreparedTransaction,
  type ReadTemplate,
  type SharedActionBackend,
  type SharedActionFinish,
  type SharedInvitationStarted,
  type SharedInvitationTaken,
  InvitationNotTakenError,
  chooseCoins,
  templateOutput,
  templateTransaction,
} from '@grandmas-wallet/core';

import { type PlannedTransaction, builtDifference, inputBytes } from './planned.js';
import type { SharedAccepted, SharedRefusal } from './shared-checks.js';

/**
 * An action another participant joins, around the backend's steps (`SharedActionBackend`): taking the invitation back
 * with the checks that need no chain, and working out the wallet's part after the other participant's to the satoshi,
 * so that what is built can be held against it as for an action the wallet carries out alone. The order of a whole
 * action: `startShared`, send, `takeJoinedInvitation`, `checkOtherParticipant`, `planSharedFinish`, `finishShared`,
 * `builtAsPlanned`, then the user's approval and `send`; `abandonShared` on any refusal. Nothing here knows any
 * template or application.
 */

/** How long the wallet waits for another participant's answer, by default: the protocol's limit for a join. */
export const SHARED_ANSWER_LIMIT_MS = SERVICE_LIMITS.joinTimeoutMs;

/**
 * Take back the invitation another participant joined (docs/xo-service.md, "What a wallet must check before signing",
 * points 1 and 2): it is the one that was sent, with exactly one commit appended that names no other template or
 * action; then the backend lets the engine check every signature and the history. Nothing the other participant
 * added is judged here: that is `checkOtherParticipant`. On a refusal the invitation stays started; the caller puts it
 * aside with `abandonShared`.
 */
export const takeJoinedInvitation = async (backend: SharedActionBackend, sent: SharedInvitationStarted, text: string): Promise<{ ok: true; taken: SharedInvitationTaken } | SharedRefusal> => {
  let commits: { sent: number; received: number };
  try {
    commits = { sent: readInvitationOutline(sent.text).commits.length, received: readInvitationOutline(text).commits.length };
  } catch (error) {
    return { ok: false, code: 'changed-invitation', reason: (error as Error).message };
  }
  if (commits.received !== commits.sent + 1) return { ok: false, code: 'commit-count', reason: `The service added ${commits.received - commits.sent} commits; it must add exactly one.` };
  const joined = checkJoinedInvitation(sent.text, text);
  if (!joined.ok) return { ok: false, code: 'changed-invitation', reason: joined.reason };
  try {
    return { ok: true, taken: await backend.takeShared(sent.invitationIdentifier, text) };
  } catch (error) {
    if (!(error instanceof InvitationNotTakenError)) throw error;
    return { ok: false, code: error.code === 'changed' ? 'changed-invitation' : error.code, reason: error.message };
  }
};

export interface SharedFinishPlanRequest {
  template: ReadTemplate['definition'];
  action: string;
  invitationIdentifier: string;
  /** The coins of the wallet's first commit, in the order given to `startShared`, each with the bytes of its input. */
  committed: { coin: AccountCoin; inputIdentifier?: string; bytes: number }[];
  /** What `checkOtherParticipant` accepted. */
  accepted: SharedAccepted;
  /** The wallet's own outputs, in order: a template output in the wallet's role by name, or an output given whole. */
  outputs: ({ outputIdentifier: string } | Output)[];
  /** Coins without a token that may pay, each with the bytes of its input. */
  available: { coin: AccountCoin; bytes: number }[];
  /** Where what is left over goes. */
  change: Uint8Array;
  feeRate: number;
}

export interface SharedFinishPlan {
  ok: true;
  /** What to give `finishShared`. */
  finish: SharedActionFinish;
  /** The transaction as it is to be built, in order: what `builtAsPlanned` holds the built one against. */
  planned: PlannedTransaction;
  feeSatoshis: bigint;
  /** The part of the fee too small to return as change. */
  remainderSatoshis: bigint;
  bytes: number;
}

/**
 * The wallet's part after the other participant's, to the satoshi (proposal section 8): the coins that pay and the
 * change at the exact fee, from the exact size of every input (the other participant's unlockings are known; the
 * wallet's are of fixed length). And the transaction as the engine will build it: an item the template places goes
 * where the template says, the others follow in the order they were committed (the wallet's first commit, the other
 * participant's, the wallet's last). A template that leaves a place to fill that this order does not fill is refused
 * (`placement`): the engine would not put the item there.
 * @throws InsufficientFundsError when the wallet's coins do not cover the outputs and the fee
 */
export const planSharedFinish = (request: SharedFinishPlanRequest): SharedFinishPlan | SharedRefusal => {
  const { template, action, accepted } = request;
  const shape = templateTransaction(template, action, accepted.values);
  const inputPlace = new Map(shape.inputs.map(({ input, index }) => [input, index]));
  const outputPlace = new Map(shape.outputs.map(({ output, index }) => [output, index]));
  const own = request.outputs.map((output) =>
    'outputIdentifier' in output ? { output: templateOutput(template, output.outputIdentifier, accepted.values), place: outputPlace.get(output.outputIdentifier) } : { output, place: undefined },
  );
  const choice = chooseCoins({
    available: request.available.map(({ coin, bytes }) => ({ utxo: coin.utxo, inputBytes: bytes })),
    fixedInputs: [...accepted.theirInputs.map(({ utxo, unlocking }) => ({ utxo, inputBytes: inputBytes(unlocking) })), ...request.committed.map(({ coin, bytes }) => ({ utxo: coin.utxo, inputBytes: bytes }))],
    outputs: [...accepted.theirOutputs.map(({ output }) => output), ...own.map(({ output }) => output)],
    changeLockingBytecode: request.change,
    feeRate: request.feeRate,
  });
  const paying = choice.coins.map(({ utxo }) => request.available.find(({ coin }) => coin.utxo === utxo)?.coin as AccountCoin);
  const change: Output[] = choice.changeSatoshis === undefined ? [] : [{ lockingBytecode: request.change, valueSatoshis: choice.changeSatoshis }];

  type Placed<Item> = { item: Item; place: number | undefined };
  const order = <Item>(items: Placed<Item>[], what: string): Item[] | string => {
    const sorted = items.map((entry, at) => ({ entry, at })).sort((a, b) => (a.entry.place ?? Infinity) - (b.entry.place ?? Infinity) || a.at - b.at);
    const misplaced = sorted.findIndex(({ entry }, index) => entry.place !== undefined && entry.place !== index);
    if (misplaced >= 0) return `The template puts ${what} ${sorted[misplaced]?.entry.place} where nothing of this action can stand before it.`;
    return sorted.map(({ entry }) => entry.item);
  };
  const inputs = order<PlannedTransaction['inputs'][number]>(
    [
      ...request.committed.map(({ coin, inputIdentifier }) => ({ item: { coin, kind: 'own' }, place: inputIdentifier === undefined ? undefined : inputPlace.get(inputIdentifier) })),
      ...accepted.theirInputs.map(({ utxo, unlocking, sequence, index }) => ({ item: { coin: { utxo }, kind: 'application', unlocking, sequence }, place: index })),
      ...paying.map((coin) => ({ item: { coin, kind: 'own' }, place: undefined })),
    ],
    'an input at',
  );
  const outputs = order<PlannedTransaction['outputs'][number]>(
    [...accepted.theirOutputs.map(({ output, index }) => ({ item: { output }, place: index })), ...own.map(({ output, place }) => ({ item: { output }, place })), ...change.map((output) => ({ item: { output }, place: undefined }))],
    'an output at',
  );
  if (typeof inputs === 'string') return { ok: false, code: 'placement', reason: inputs };
  if (typeof outputs === 'string') return { ok: false, code: 'placement', reason: outputs };
  return {
    ok: true,
    finish: {
      invitationIdentifier: request.invitationIdentifier,
      inputs: paying.map((coin) => ({ coin })),
      outputs: [...request.outputs, ...change],
      theirCoins: accepted.theirInputs.map(({ utxo }) => utxo),
    },
    planned: { locktime: shape.locktime, inputs, outputs },
    feeSatoshis: choice.feeSatoshis,
    remainderSatoshis: choice.remainderSatoshis,
    bytes: choice.bytes,
  };
};

/**
 * What the backend built has to be the transaction the wallet worked out: the same comparison as for an action the
 * wallet carries out alone. The backend has already run the check before sending on it.
 * @returns the first difference in words, or `undefined`
 */
export const builtAsPlanned = (planned: PlannedTransaction, prepared: PreparedTransaction): string | undefined => {
  const transaction = decodeTransactionBch(hexToBin(prepared.transactionHex));
  if (typeof transaction === 'string') return `what was built is not a transaction: ${transaction}`;
  return builtDifference(planned, transaction);
};
