import { type Output, encodeTransactionOutput } from '@bitauth/libauth';

import { type Utxo, DEFAULT_FEE_RATE, InsufficientFundsError, requiredFee, smallestOutputValue } from './builder.js';

/**
 * Choosing coins (proposal section 8).
 *
 * At a constant fee rate every coin costs its bytes once, whenever it is spent, so spending a coin now
 * instead of later costs nothing. What a choice of coins can save is the change output: its bytes now and
 * the bytes of spending it later. And it can avoid leaving an amount to the fee.
 *
 * Signatures and scripts have fixed lengths, so the size of a transaction follows exactly from the kinds of
 * its inputs and from its outputs. The fee worked out here is the one the builder arrives at by measuring.
 */

/** The size in bytes of an input, by what is spent and how. */
export const INPUT_BYTES = {
  /** An ordinary single-key coin. */
  p2pkh: 141,
  /** A coin at a recoverable address, spent by its key. */
  byKey: 296,
  /** A coin at a recoverable address, released through the controller. */
  swept: 260,
  /** A coin at a vault address. */
  vault: 217,
  /** The controller approving, completing or closing. */
  controller: 637,
  /** The controller taking a request. */
  controllerRequest: 658,
  /** The controller changing its settings. */
  controllerUpdate: 683,
} as const;

/** The largest transaction nodes relay. */
export const LARGEST_TRANSACTION_BYTES = 100_000;

const countBytes = (count: number): number => (count < 0xfd ? 1 : count <= 0xffff ? 3 : 5);
const outputBytes = (output: Output): number => encodeTransactionOutput(output).length;

/** The size of a transaction with inputs of the given sizes and the given outputs. */
export const transactionBytes = (inputs: number[], outputs: Output[]): number =>
  4 + countBytes(inputs.length) + inputs.reduce((sum, bytes) => sum + bytes, 0) + countBytes(outputs.length) + outputs.reduce((sum, output) => sum + outputBytes(output), 0) + 4;

/** A coin the wallet may spend, with the size of the input that spends it. */
export interface SpendableCoin {
  utxo: Utxo;
  inputBytes: number;
}

export interface CoinChoiceRequest {
  /** Coins without a token that may pay. Coins with tokens are never chosen here: a fee never comes from one. */
  available: SpendableCoin[];
  /** The outputs the transaction must have, with their values. */
  outputs: Output[];
  /** Inputs the transaction has in any case, such as the controller or a coin whose token is being moved. */
  fixedInputs?: SpendableCoin[];
  /** Where change would go. */
  changeLockingBytecode: Uint8Array;
  /** The size of the input that will one day spend the change. */
  changeSpendBytes?: number;
  feeRate?: number;
}

export interface CoinChoice {
  /** The coins chosen from those available, besides the fixed inputs. */
  coins: SpendableCoin[];
  /** The change, or `undefined` when the choice needs none. */
  changeSatoshis?: bigint;
  /** What the transaction pays: the required fee and, without change, the remainder. */
  feeSatoshis: bigint;
  /** The part of the fee that was too small to return as change. The wallet shows it. */
  remainderSatoshis: bigint;
  /** The size of the transaction in bytes. */
  bytes: number;
}

const valueOf = (coins: SpendableCoin[]): bigint => coins.reduce((sum, { utxo }) => sum + utxo.output.valueSatoshis, 0n);
const SEARCH_LIMIT = 20_000;

/**
 * Choose coins for a payment.
 *
 * A choice that needs no change is preferred. When something is left that is too small to return, leaving
 * it to the fee is compared with adding a coin so that change becomes possible, and the cheaper is taken:
 * a change output costs its own bytes now and the bytes of spending it later.
 *
 * @throws InsufficientFundsError when the coins do not cover the outputs and the fee
 */
export const chooseCoins = (request: CoinChoiceRequest): CoinChoice => {
  const feeRate = request.feeRate ?? DEFAULT_FEE_RATE;
  if (request.available.some(({ utxo }) => utxo.output.token !== undefined)) {
    throw new Error('A coin that carries a token cannot be chosen to pay: a fee never comes from one.');
  }
  const fixed = request.fixedInputs ?? [];
  const fixedBytes = fixed.map(({ inputBytes }) => inputBytes);
  const outputTotal = request.outputs.reduce((sum, { valueSatoshis }) => sum + valueSatoshis, 0n);
  const changeOutput: Output = { lockingBytecode: request.changeLockingBytecode, valueSatoshis: 0n };
  const smallestChange = smallestOutputValue(changeOutput);
  /** What a change output costs: its bytes now and the bytes of the input that spends it later. */
  const changeCost = requiredFee(outputBytes(changeOutput) + (request.changeSpendBytes ?? INPUT_BYTES.byKey), feeRate);
  // A coin that holds no more than its own input costs adds nothing.
  const useful = request.available
    .filter(({ utxo, inputBytes }) => utxo.output.valueSatoshis > requiredFee(inputBytes, feeRate))
    .sort((a, b) => (a.utxo.output.valueSatoshis > b.utxo.output.valueSatoshis ? -1 : a.utxo.output.valueSatoshis < b.utxo.output.valueSatoshis ? 1 : 0));

  const outcome = (coins: SpendableCoin[]): { withoutChange?: CoinChoice; withChange?: CoinChoice } => {
    const inputs = [...fixedBytes, ...coins.map(({ inputBytes }) => inputBytes)];
    const total = valueOf(fixed) + valueOf(coins);
    const plainBytes = transactionBytes(inputs, request.outputs);
    const plainFee = requiredFee(plainBytes, feeRate);
    const left = total - outputTotal - plainFee;
    const changeBytes = transactionBytes(inputs, [...request.outputs, changeOutput]);
    const change = total - outputTotal - requiredFee(changeBytes, feeRate);
    return {
      // Without change, what is left goes to the fee. It may not reach what could have been returned.
      ...(left >= 0n && change < smallestChange ? { withoutChange: { coins, feeSatoshis: plainFee + left, remainderSatoshis: left, bytes: plainBytes } } : {}),
      ...(change >= smallestChange ? { withChange: { coins, changeSatoshis: change, feeSatoshis: requiredFee(changeBytes, feeRate), remainderSatoshis: 0n, bytes: changeBytes } } : {}),
    };
  };
  /** What a choice costs beyond the bytes of its coins, which are paid once in any case. */
  const cost = (choice: CoinChoice): bigint => (choice.changeSatoshis === undefined ? choice.remainderSatoshis : changeCost);
  const better = (a: CoinChoice | undefined, b: CoinChoice): CoinChoice => {
    if (a === undefined) return b;
    if (cost(a) !== cost(b)) return cost(a) < cost(b) ? a : b;
    // The same cost: fewer coins tie fewer addresses together.
    return b.coins.length < a.coins.length ? b : a;
  };

  let best: CoinChoice | undefined;
  const consider = (coins: SpendableCoin[]): void => {
    const { withoutChange, withChange } = outcome(coins);
    if (withoutChange !== undefined) best = better(best, withoutChange);
    if (withChange !== undefined) best = better(best, withChange);
  };

  // No coins at all, when the fixed inputs already pay.
  consider([]);
  // The fewest coins that suffice, taking the largest first: the plain choice, with change.
  for (let count = 1; count <= useful.length; count++) {
    consider(useful.slice(0, count));
    if (best !== undefined && best.changeSatoshis !== undefined) break;
  }
  // A search for a choice that leaves little or nothing, so that no change is needed.
  let steps = 0;
  const search = (from: number, chosen: SpendableCoin[]): void => {
    if (steps >= SEARCH_LIMIT || (best !== undefined && cost(best) === 0n)) return;
    for (let index = from; index < useful.length; index++) {
      steps += 1;
      const next = [...chosen, useful[index] as SpendableCoin];
      const { withoutChange } = outcome(next);
      if (withoutChange !== undefined) best = better(best, withoutChange);
      // More coins only help while the outputs are not yet covered.
      const total = valueOf(fixed) + valueOf(next);
      if (total - outputTotal - requiredFee(transactionBytes([...fixedBytes, ...next.map(({ inputBytes }) => inputBytes)], request.outputs), feeRate) < 0n) search(index + 1, next);
      if (steps >= SEARCH_LIMIT) return;
    }
  };
  search(0, []);

  if (best === undefined) {
    const everything = [...fixedBytes, ...useful.map(({ inputBytes }) => inputBytes)];
    const fee = requiredFee(transactionBytes(everything, request.outputs), feeRate);
    throw new InsufficientFundsError(valueOf(fixed) + valueOf(useful), fee, outputTotal + fee, 'the wallet\'s coins do not cover the outputs and the fee.');
  }
  return best;
};

export interface SendEverythingRequest {
  /** Every coin without a token. */
  coins: SpendableCoin[];
  /** The output everything goes to; its value is ignored. */
  destination: Output;
  /**
   * Inputs and outputs that every transaction carries besides the coins, such as the controller and its
   * successor when a coin needs the controller. The value of these outputs is kept.
   */
  fixedInputs?: SpendableCoin[];
  fixedOutputs?: Output[];
  feeRate?: number;
}

export interface SendEverythingPart {
  coins: SpendableCoin[];
  /** What the destination receives from this transaction. */
  sentSatoshis: bigint;
  feeSatoshis: bigint;
  bytes: number;
}

export interface SendEverythingPlan {
  parts: SendEverythingPart[];
  /** Coins that hold no more than it costs to spend them. They are left where they are and listed. */
  leftOut: SpendableCoin[];
  /** What arrives in all. */
  sentSatoshis: bigint;
  feeSatoshis: bigint;
}

/**
 * Plan sending every coin without a token to one output: no change, the exact fee, and as many
 * transactions as the coins need.
 *
 * @throws InsufficientFundsError when what is left after the fee is below what the destination output must hold
 */
export const planSendEverything = (request: SendEverythingRequest): SendEverythingPlan => {
  const feeRate = request.feeRate ?? DEFAULT_FEE_RATE;
  if (request.coins.some(({ utxo }) => utxo.output.token !== undefined)) {
    throw new Error('Sending everything moves coins without a token only. The satoshis under a token stay with it.');
  }
  const fixedInputs = request.fixedInputs ?? [];
  const fixedOutputs = request.fixedOutputs ?? [];
  const fixedOut = fixedOutputs.reduce((sum, { valueSatoshis }) => sum + valueSatoshis, 0n);
  const outputs = [...fixedOutputs, { ...request.destination, valueSatoshis: 0n }];
  const smallest = smallestOutputValue(request.destination);
  const sizeWith = (coins: SpendableCoin[]): number => transactionBytes([...fixedInputs, ...coins].map(({ inputBytes }) => inputBytes), outputs);

  const worth = request.coins.filter(({ utxo, inputBytes }) => utxo.output.valueSatoshis > requiredFee(inputBytes, feeRate));
  const leftOut = request.coins.filter((coin) => !worth.includes(coin));
  // The largest coins first, so that a last, small transaction is the one that may not be worth sending.
  const ordered = [...worth].sort((a, b) => (a.utxo.output.valueSatoshis > b.utxo.output.valueSatoshis ? -1 : 1));

  const groups: SpendableCoin[][] = [];
  let current: SpendableCoin[] = [];
  for (const coin of ordered) {
    if (current.length > 0 && sizeWith([...current, coin]) > LARGEST_TRANSACTION_BYTES) {
      groups.push(current);
      current = [];
    }
    current.push(coin);
  }
  if (current.length > 0 || groups.length === 0) groups.push(current);

  const parts: SendEverythingPart[] = [];
  for (const coins of groups) {
    const bytes = sizeWith(coins);
    const fee = requiredFee(bytes, feeRate);
    const total = valueOf(fixedInputs) + valueOf(coins);
    const sent = total - fixedOut - fee;
    if (sent < smallest) {
      // A last group too small to send on its own is left where it is; a whole wallet too small is refused.
      if (parts.length > 0) {
        leftOut.push(...coins);
        continue;
      }
      throw new InsufficientFundsError(total, fee, fixedOut + fee + smallest, `what is left after the fee is below the ${smallest} satoshis the receiving output must hold.`);
    }
    parts.push({ coins, sentSatoshis: sent, feeSatoshis: fee, bytes });
  }
  return {
    parts,
    leftOut,
    sentSatoshis: parts.reduce((sum, part) => sum + part.sentSatoshis, 0n),
    feeSatoshis: parts.reduce((sum, part) => sum + part.feeSatoshis, 0n),
  };
};
