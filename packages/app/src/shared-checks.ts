import { type Output, binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import {
  type ChainReader,
  type CommitPart,
  type ReadTemplate,
  type TemplateValues,
  type Utxo,
  TemplateError,
  templateOutput,
  templateSequenceNumber,
  templateTransaction,
  templateUnlockingBytecode,
  typedValues,
} from '@grandmas-wallet/core';

import { coinScriptOf } from './planned.js';

/**
 * The wallet's checks of what another participant added to an invitation the wallet started, before anything is
 * signed (docs/xo-service.md, "What a wallet must check before signing", points 1 and 3 to 6). The engine checks
 * signatures and history and nothing of this: it lets the last writer of a value win, lets a role tag override the
 * template's assignment, builds another participant's outputs as given, and does not enforce a commit's expiry.
 *
 * Everything is judged against the template, the chain and the wallet's own commits; nothing the other participant
 * says about a coin is taken on trust. Nothing here knows any template or application.
 */

/**
 * Why the wallet refuses what came back. Stable, for tests and for the screens to choose words by.
 * - `late`: the answer came after the wallet's own time limit.
 * - `not-started`: the wallet holds no such invitation.
 * - `commit-count`: not exactly one commit was appended.
 * - `changed-invitation`: the invitation is not the one sent with a commit appended, or that commit names another template or action.
 * - `not-valid`: the engine refused it: a signature, the history, a value an earlier commit set.
 * - `participant`: the commit is not that of one other participant in the expected role.
 * - `role-tag`: a value or an item tagged with a role other than the other participant's.
 * - `merges-with`: an item that extends an item of an earlier commit.
 * - `resolution`: a signature, public key or other resolution.
 * - `transaction-fields`: a transaction version or lock time other than the template's.
 * - `restated-variable`: a value the wallet set, stated again.
 * - `wallet-variable`: a value the template assigns to the wallet's role.
 * - `foreign-variable`: a value the template does not assign to the other participant's role for this action.
 * - `variable-value`: a value the wallet cannot read as the template's type.
 * - `not-template-input`, `input-incomplete`: an input that is not one of the action's template inputs, or names no coin.
 * - `item-twice`: the same value, template item or coin twice, or a coin the wallet brings.
 * - `placement`: an item given a place other than the template's.
 * - `coin-not-found`, `coin-spent`, `coin-script`: the coin is not on the chain, is spent, or is not at the template's script for its input.
 * - `unlocking`, `sequence`: the coin's unlocking or sequence number differs from what the template compiles.
 * - `free-output`, `not-template-output`, `output-differs`: an output that names no template output, one that is not the action's, or one that differs from what the template compiles.
 * - `cannot-compile`: the template cannot be worked out with the values given.
 */
export const SHARED_REFUSAL_CODES = [
  'late',
  'not-started',
  'commit-count',
  'changed-invitation',
  'not-valid',
  'participant',
  'role-tag',
  'merges-with',
  'resolution',
  'transaction-fields',
  'restated-variable',
  'wallet-variable',
  'foreign-variable',
  'variable-value',
  'not-template-input',
  'input-incomplete',
  'item-twice',
  'placement',
  'coin-not-found',
  'coin-spent',
  'coin-script',
  'unlocking',
  'sequence',
  'free-output',
  'not-template-output',
  'output-differs',
  'cannot-compile',
] as const;
export type SharedRefusalCode = (typeof SHARED_REFUSAL_CODES)[number];

/** A refusal: nothing is signed, and the invitation is put aside. */
export interface SharedRefusal {
  ok: false;
  code: SharedRefusalCode;
  /** In plain words, naming the template's items by their names. */
  reason: string;
}

/** A coin of the other participant's as the wallet read it from the chain, with how the template unlocks it. */
export interface CheckedSharedInput {
  inputIdentifier: string;
  /** The template's locking script the coin sits at. */
  lockingScript: string;
  utxo: Utxo;
  unlocking: Uint8Array;
  sequence: number;
  /** The template's place for it. */
  index?: number;
}

/** An output the other participant added, as the template compiles it. */
export interface CheckedSharedOutput {
  outputIdentifier: string;
  output: Output;
  index?: number;
}

export interface SharedAccepted {
  ok: true;
  /** Every value of the action: the wallet's and the other participant's, as the template's types read them. */
  values: TemplateValues;
  theirInputs: CheckedSharedInput[];
  theirOutputs: CheckedSharedOutput[];
  /** The action's template inputs and outputs that neither the wallet's commits nor the other participant's hold: the wallet's to add, if any. */
  left: { inputs: string[]; outputs: string[] };
}

export type SharedVerdict = SharedAccepted | SharedRefusal;

export interface OtherParticipantCheck {
  template: ReadTemplate['definition'];
  action: string;
  walletRole: string;
  /** The role the other participant takes, as its service named it. */
  otherRole: string;
  /** The wallet's own commits, as in the invitation taken back. */
  committed: CommitPart[];
  /** What the other participant added. */
  added: CommitPart[];
  chain: Pick<ChainReader, 'getTransaction' | 'listUnspent'>;
  /** Now, in milliseconds. */
  now: number;
  /** The wallet's own time limit for the answer, in milliseconds: the engine does not enforce a commit's expiry. */
  answerBy: number;
}

const hex = binToHex;

const refuse = (code: SharedRefusalCode, reason: string): SharedRefusal => ({ ok: false, code, reason });

/** The variables the template assigns to a role in an action. */
const roleVariables = (template: ReadTemplate['definition'], action: string, role: string): Set<string> =>
  new Set((template.actions?.[action]?.roles?.[role] as { requirements?: { variables?: string[] } } | undefined)?.requirements?.variables ?? []);

/** The same bytes, or both absent. */
const sameBytes = (a: Uint8Array | undefined, b: Uint8Array | undefined): boolean => (a === undefined) === (b === undefined) && (a === undefined || hex(a) === hex(b as Uint8Array));

/**
 * Check what another participant added to the wallet's invitation, in the order of the specification. The first
 * failure is the answer.
 * @returns the values of the action and the other participant's items as the template compiles them, or a refusal
 */
export const checkOtherParticipant = async (check: OtherParticipantCheck): Promise<SharedVerdict> => {
  const { template, action, walletRole, otherRole, committed, added, chain } = check;
  const nameOfInput = (input: string): string => template.inputs?.[input]?.name ?? input;
  const nameOfOutput = (output: string): string => template.outputs?.[output]?.name ?? output;
  const nameOfVariable = (variable: string): string => template.variables?.[variable]?.name ?? variable;

  if (check.now > check.answerBy) return refuse('late', 'The service answered after the time the wallet waits. Nothing was signed.');
  if (added.length !== 1) return refuse('commit-count', `The service added ${added.length} commits; it must add exactly one.`);
  const commit = added[0] as CommitPart;

  // One other participant, in the role its service named, that the template's action has.
  const roles = template.actions?.[action]?.roles ?? {};
  if (otherRole === walletRole || roles[otherRole] === undefined) return refuse('participant', `The action has no role "${otherRole}" for another participant.`);
  if (committed.some((own) => own.entityIdentifier === commit.entityIdentifier)) return refuse('participant', 'The added commit is made in the wallet\'s own name.');
  if (commit.role !== otherRole) return refuse('participant', `The service's commit does not take the role "${otherRole}".`);
  if (commit.actionReference !== undefined && commit.actionReference.actionIdentifier !== action) return refuse('changed-invitation', 'The service\'s commit names another action.');

  if (commit.resolutions > 0 || commit.inputs.some((input) => input.resolutions > 0)) return refuse('resolution', 'The service added a signature or another resolution; it has nothing of its own to sign here.');
  if ([...commit.variables, ...commit.inputs, ...commit.outputs].some((item) => item.mergesWith)) return refuse('merges-with', 'The service extended an item of an earlier commit.');
  const tagged = [...commit.variables, ...commit.inputs, ...commit.outputs].find((item) => item.roleIdentifier !== undefined && item.roleIdentifier !== otherRole);
  if (tagged !== undefined) return refuse('role-tag', `The service tagged something with the role "${tagged.roleIdentifier ?? ''}", which is not its own.`);

  // The values: none of the wallet's touched, only the other participant's own stated.
  const own: TemplateValues = {};
  for (const part of committed) for (const variable of part.variables) own[variable.variableIdentifier] = typeof variable.value === 'boolean' ? String(variable.value) : variable.value;
  const walletVariables = roleVariables(template, action, walletRole);
  const theirVariables = roleVariables(template, action, otherRole);
  const theirs: TemplateValues = {};
  for (const { variableIdentifier, value } of commit.variables) {
    const name = nameOfVariable(variableIdentifier);
    if (walletVariables.has(variableIdentifier)) return refuse('wallet-variable', `The service stated "${name}", which is the wallet's to state.`);
    if (Object.hasOwn(own, variableIdentifier)) return refuse('restated-variable', `The service stated "${name}" again, which the wallet set.`);
    if (!theirVariables.has(variableIdentifier)) return refuse('foreign-variable', `The service stated "${name}", which the template does not give to its role in this action.`);
    if (Object.hasOwn(theirs, variableIdentifier)) return refuse('item-twice', `The service stated "${name}" twice.`);
    if (typeof value === 'boolean') return refuse('variable-value', `The service's value for "${name}" is not one the template's type reads.`);
    theirs[variableIdentifier] = value;
  }
  let values: TemplateValues;
  let shape: ReturnType<typeof templateTransaction>;
  try {
    values = typedValues(template, { ...own, ...theirs });
  } catch (error) {
    if (!(error instanceof TemplateError)) throw error;
    return refuse('variable-value', error.message);
  }
  try {
    shape = templateTransaction(template, action, values);
  } catch (error) {
    if (!(error instanceof TemplateError)) throw error;
    return refuse('cannot-compile', error.message);
  }
  if ((commit.transactionVersion !== undefined && commit.transactionVersion !== shape.version) || (commit.transactionLocktime !== undefined && commit.transactionLocktime !== shape.locktime)) {
    return refuse('transaction-fields', 'The service set a transaction version or lock time other than the template\'s.');
  }

  // Every input the template's, read from the chain, unlocked exactly as the template compiles.
  const inputPlaces = new Map(shape.inputs.map(({ input, index }) => [input, index]));
  const ownCoins = new Set(committed.flatMap((part) => part.inputs.map((input) => `${input.transactionId ?? ''}:${input.index ?? -1}`)));
  const seenCoins = new Set<string>();
  const seenInputs = new Set<string>();
  const theirInputs: CheckedSharedInput[] = [];
  for (const input of commit.inputs) {
    if (input.inputIdentifier === undefined || !inputPlaces.has(input.inputIdentifier)) return refuse('not-template-input', `The service added a coin that is not one of this action's template inputs${input.inputIdentifier === undefined ? '' : ` ("${input.inputIdentifier}")`}.`);
    const name = nameOfInput(input.inputIdentifier);
    if (input.transactionId === undefined || input.index === undefined) return refuse('input-incomplete', `The service's coin for "${name}" names no coin.`);
    const outpoint = `${input.transactionId}:${input.index}`;
    if (ownCoins.has(outpoint) || seenCoins.has(outpoint) || seenInputs.has(input.inputIdentifier)) return refuse('item-twice', `The service's coin for "${name}" is given twice, or is a coin the wallet brings.`);
    seenCoins.add(outpoint);
    seenInputs.add(input.inputIdentifier);
    const place = inputPlaces.get(input.inputIdentifier);
    if (input.transactionIndex !== undefined && input.transactionIndex !== place) return refuse('placement', `The service put the coin for "${name}" at place ${input.transactionIndex}, not where the template puts it.`);
    const text = await chain.getTransaction(input.transactionId);
    const source = text === undefined ? undefined : decodeTransactionBch(hexToBin(text));
    const output = source === undefined || typeof source === 'string' ? undefined : source.outputs[input.index];
    if (output === undefined) return refuse('coin-not-found', `The service's coin for "${name}" is not on the chain.`);
    const unspent = (await chain.listUnspent(output.lockingBytecode)).some((listed) => listed.transactionId === input.transactionId && listed.index === input.index);
    if (!unspent) return refuse('coin-spent', `The service's coin for "${name}" is spent.`);
    const lockingScript = coinScriptOf(template, input.inputIdentifier, output.lockingBytecode, values);
    if (lockingScript === undefined) return refuse('coin-script', `The service's coin for "${name}" is at no script of the template, made with the values of this action.`);
    let unlocking: Uint8Array;
    let sequence: number;
    try {
      unlocking = templateUnlockingBytecode(template, lockingScript, input.inputIdentifier, values);
      sequence = templateSequenceNumber(template, input.inputIdentifier, values) ?? 0;
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      return refuse('cannot-compile', error.message);
    }
    if (!sameBytes(input.unlockingBytecode, unlocking)) return refuse('unlocking', `The service unlocks its coin for "${name}" otherwise than the template does.`);
    // The engine's sequence number for an input that states none is 0.
    if ((input.sequenceNumber ?? 0) !== sequence) return refuse('sequence', `The service gives its coin for "${name}" the sequence number ${input.sequenceNumber ?? 0}; the template gives ${sequence}.`);
    theirInputs.push({ inputIdentifier: input.inputIdentifier, lockingScript, utxo: { transactionHash: hexToBin(input.transactionId), index: input.index, output }, unlocking, sequence, ...(place === undefined ? {} : { index: place }) });
  }

  // Every output the template's, as it compiles from the values; nothing else.
  const outputPlaces = new Map(shape.outputs.map(({ output, index }) => [output, index]));
  const seenOutputs = new Set<string>();
  const theirOutputs: CheckedSharedOutput[] = [];
  for (const output of commit.outputs) {
    if (output.outputIdentifier === undefined) return refuse('free-output', 'The service added an output that is none of the template\'s.');
    if (!outputPlaces.has(output.outputIdentifier)) return refuse('not-template-output', `The service added the output "${nameOfOutput(output.outputIdentifier)}", which is not one of this action's.`);
    const name = nameOfOutput(output.outputIdentifier);
    if (seenOutputs.has(output.outputIdentifier)) return refuse('item-twice', `The service added "${name}" twice.`);
    seenOutputs.add(output.outputIdentifier);
    const place = outputPlaces.get(output.outputIdentifier);
    if (output.transactionIndex !== undefined && output.transactionIndex !== place) return refuse('placement', `The service put "${name}" at place ${output.transactionIndex}, not where the template puts it.`);
    let expected: Output;
    try {
      expected = templateOutput(template, output.outputIdentifier, values);
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      return refuse('cannot-compile', error.message);
    }
    // What the commit leaves out, the engine works out from the template; what it states must be the template's.
    if (output.lockingBytecode !== undefined && hex(output.lockingBytecode) !== hex(expected.lockingBytecode)) return refuse('output-differs', `The service's "${name}" pays to another script than the template's.`);
    if (output.valueSatoshis !== undefined && output.valueSatoshis !== expected.valueSatoshis) return refuse('output-differs', `The service's "${name}" holds ${output.valueSatoshis} satoshis; the template's holds ${expected.valueSatoshis}.`);
    if (output.token !== undefined && !sameStatedToken(output.token, expected.token)) return refuse('output-differs', `The service's "${name}" carries another token than the template's.`);
    if (output.secretIdentifier !== undefined) return refuse('output-differs', `The service's "${name}" asks for a key of its own.`);
    theirOutputs.push({ outputIdentifier: output.outputIdentifier, output: expected, ...(place === undefined ? {} : { index: place }) });
  }

  const ownInputs = new Set(committed.flatMap((part) => part.inputs.flatMap((input) => (input.inputIdentifier === undefined ? [] : [input.inputIdentifier]))));
  const ownOutputs = new Set(committed.flatMap((part) => part.outputs.flatMap((output) => (output.outputIdentifier === undefined ? [] : [output.outputIdentifier]))));
  return {
    ok: true,
    values,
    theirInputs,
    theirOutputs,
    left: {
      inputs: shape.inputs.map(({ input }) => input).filter((input) => !seenInputs.has(input) && !ownInputs.has(input)),
      outputs: shape.outputs.map(({ output }) => output).filter((output) => !seenOutputs.has(output) && !ownOutputs.has(output)),
    },
  };
};

/** A token as a commit states it, against the template's: every field it states has to be the template's. */
const sameStatedToken = (stated: NonNullable<CommitPart['outputs'][number]['token']>, expected: Output['token']): boolean => {
  if (expected === undefined) return false;
  if (stated.category !== undefined && hex(stated.category) !== hex(expected.category)) return false;
  if (stated.amount !== undefined && stated.amount !== expected.amount) return false;
  // A stated token without an NFT carries fungible tokens only.
  if (stated.nft === undefined) return expected.nft === undefined;
  if (expected.nft === undefined) return false;
  if (stated.nft.capability !== undefined && stated.nft.capability !== expected.nft.capability) return false;
  return stated.nft.commitment === undefined || hex(stated.nft.commitment) === hex(expected.nft.commitment);
};
