import { type Output, type TransactionCommon, binToHex } from '@bitauth/libauth';
import { type ReadTemplate, type TemplateValues, type Utxo, TemplateError, templateLockingBytecode } from '@grandmas-wallet/core';

/**
 * What the wallet worked out for a transaction, held against what it is given or what was built: the same rules
 * for an action the wallet carries out alone (`Applications`) and for one another participant joins
 * (`checkOtherParticipant`, `planSharedFinish`). Nothing here knows any template.
 */

const hex = binToHex;

export const sameToken = (a: Output['token'], b: Output['token']): boolean =>
  a !== undefined && b !== undefined && hex(a.category) === hex(b.category) && a.amount === b.amount && a.nft?.capability === b.nft?.capability && hex(a.nft?.commitment ?? new Uint8Array()) === hex(b.nft?.commitment ?? new Uint8Array());

/** Two outputs alike in script, value and token. */
export const sameOutput = (a: Output, b: Output): boolean =>
  hex(a.lockingBytecode) === hex(b.lockingBytecode) && a.valueSatoshis === b.valueSatoshis && (a.token === undefined ? b.token === undefined : sameToken(a.token, b.token));

/** The bytes of an input with the given unlocking. */
export const inputBytes = (unlocking: Uint8Array): number => 32 + 4 + (unlocking.length < 0xfd ? 1 : 3) + unlocking.length + 4;

/**
 * Which of a template's locking scripts a coin sits at, for one of the template's inputs: the coin's locking bytecode
 * is compared with each script the template gives, made with the action's values; the script whose unlocking is the
 * input's is tried first. `values` may differ by script, as the values a request gives for a script's state do.
 * @returns `undefined` when the coin is at no script of the template
 */
export const coinScriptOf = (definition: ReadTemplate['definition'], input: string, lockingBytecode: Uint8Array, values: TemplateValues | ((lockingScript: string) => TemplateValues)): string | undefined => {
  const unlocking = (definition.inputs?.[input] as { unlockingScript?: string } | undefined)?.unlockingScript;
  const scripts = Object.entries(definition.lockingScripts ?? {})
    .map(([identifier, script]) => ({ identifier, first: (script as { unlockingBytecode?: string }).unlockingBytecode === unlocking }))
    .sort((a, b) => Number(b.first) - Number(a.first))
    .map(({ identifier }) => identifier);
  return scripts.find((candidate) => {
    try {
      return hex(templateLockingBytecode(definition, candidate, typeof values === 'function' ? values(candidate) : values)) === hex(lockingBytecode);
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      return false;
    }
  });
}

/** A transaction as the wallet worked it out, in the order it is to be built. */
export interface PlannedTransaction {
  locktime: number;
  /** `application`: a coin that is not the wallet's, put in with the unlocking and sequence number the wallet worked out. */
  inputs: { coin: { utxo: Utxo }; kind: string; unlocking?: Uint8Array; sequence?: number }[];
  outputs: { output: Output }[];
}

/**
 * How what was built differs from what the wallet worked out, if it does: its lock time, each output whole, each input's
 * coin, and how each coin that is not the wallet's is unlocked. The wallet's own inputs are signed by the key holder.
 * @returns the first difference, in words, or `undefined` when there is none
 */
export const builtDifference = (planned: PlannedTransaction, transaction: TransactionCommon): string | undefined => {
  if (transaction.locktime !== planned.locktime) return 'its lock time';
  if (transaction.outputs.length !== planned.outputs.length) return 'the number of its outputs';
  const output = planned.outputs.findIndex(({ output: wanted }, index) => !sameOutput(wanted, transaction.outputs[index] as Output));
  if (output >= 0) return `output ${output}`;
  if (transaction.inputs.length !== planned.inputs.length) return 'the number of its inputs';
  for (const [index, input] of planned.inputs.entries()) {
    const built = transaction.inputs[index];
    if (built === undefined || hex(built.outpointTransactionHash) !== hex(input.coin.utxo.transactionHash) || built.outpointIndex !== input.coin.utxo.index) return `input ${index}`;
    if (input.kind === 'application' && (built.sequenceNumber !== input.sequence || hex(built.unlockingBytecode) !== hex(input.unlocking ?? new Uint8Array()))) return `how input ${index} is unlocked`;
  }
  return undefined;
};
