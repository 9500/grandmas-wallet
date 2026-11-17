import { type Output, decodeTransactionBch, hexToBin } from '@bitauth/libauth';

import type { AddressKind } from './addresses.js';
import type { Utxo } from './builder.js';
import type { ChainReader } from './history.js';
import type { ViewingKey } from './keys.js';
import { type WalletAddress, ADDRESS_KINDS, ADDRESS_RANGE, ADDRESS_WINDOW, walletAddress } from './wallet-addresses.js';

/**
 * Finding a wallet's coins (proposal section 7.7) from its identity and the viewing key of each seed it has had.
 *
 * - The quick pass derives address 0, 1, 2 and so on of each kind, asks for each one's history, and stops
 *   after a run of unused addresses as long as the window.
 * - The full pass looks up every number of every range. It finds an address given out past a gap, which
 *   the quick pass misses.
 *
 * A pass that cannot finish says so with the reason and with where it stopped, and continues from there.
 * Nothing here ever reports a wallet as empty because a server did not answer.
 */

/** A coin of the wallet, with what is needed to spend it through the controller. */
export interface FoundCoin {
  address: WalletAddress;
  utxo: Utxo;
  /** 0 or less while unconfirmed. */
  height: number;
}

/** An address that has history, with what is unspent there now. */
export interface FoundAddress {
  address: WalletAddress;
  /** How many transactions touched the address. */
  transactions: number;
  coins: FoundCoin[];
}

/** For each kind, the next number to look up. A pass given this continues where the earlier one stopped. */
export type PassProgress = Record<AddressKind, number>;

export interface PassResult {
  pass: 'quick' | 'full';
  /** `complete` only when every address the pass covers was looked up and answered for. */
  status: 'complete' | 'incomplete';
  /** Why the pass is incomplete. */
  reason?: string;
  found: FoundAddress[];
  progress: PassProgress;
  /** How many addresses were looked up in this call. */
  lookups: number;
}

export interface PassOptions {
  /** Where an earlier, interrupted pass stopped, and what it had found. */
  resume?: Pick<PassResult, 'found' | 'progress'>;
  /** How many addresses are asked about at once. Servers refuse batches much above 300. */
  batchSize?: number;
  /** Called after each batch, so that a device can store where the pass stands. */
  onProgress?: (state: Pick<PassResult, 'found' | 'progress'>) => void;
}

const DEFAULT_BATCH = 300;

const startProgress = (): PassProgress => Object.fromEntries(ADDRESS_KINDS.map((kind) => [kind, 0])) as PassProgress;

/** Look one address up: its history, and what is unspent there with its tokens. `undefined` when it has no history. */
const lookUp = async (reader: ChainReader, address: WalletAddress): Promise<FoundAddress | undefined> => {
  const history = await reader.getHistory(address.lockingBytecode);
  if (history.length === 0) return undefined;
  const coins: FoundCoin[] = [];
  for (const entry of await reader.listUnspent(address.lockingBytecode)) {
    const hex = await reader.getTransaction(entry.transactionId);
    const transaction = hex === undefined ? undefined : decodeTransactionBch(hexToBin(hex));
    const output: Output | undefined = transaction === undefined || typeof transaction === 'string' ? undefined : transaction.outputs[entry.index];
    if (output === undefined) {
      throw new Error(`Output ${entry.transactionId}:${entry.index} is listed as unspent and its transaction cannot be read.`);
    }
    coins.push({ address, utxo: { transactionHash: hexToBin(entry.transactionId), index: entry.index, output }, height: entry.height });
  }
  return { address, transactions: history.length, coins };
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const run = async (
  pass: 'quick' | 'full',
  reader: ChainReader,
  identity: Uint8Array,
  viewingKey: ViewingKey,
  options: PassOptions,
): Promise<PassResult> => {
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const progress: PassProgress = { ...(options.resume?.progress ?? startProgress()) };
  const found: FoundAddress[] = [...(options.resume?.found ?? [])];
  let lookups = 0;

  for (const kind of ADDRESS_KINDS) {
    const range = ADDRESS_RANGE[kind];
    const window = ADDRESS_WINDOW[kind];
    // The quick pass stops after a run of unused addresses as long as the window.
    const lastUsed = (): number => found.filter((entry) => entry.address.kind === kind).reduce((highest, entry) => Math.max(highest, entry.address.number), -1);
    const end = (): number => (pass === 'full' ? range : Math.min(range, lastUsed() + window + 1));

    while (progress[kind] < end()) {
      const from = progress[kind];
      const numbers = Array.from({ length: Math.min(batchSize, end() - from) }, (_, offset) => from + offset);
      let results: (FoundAddress | undefined)[];
      try {
        results = await Promise.all(numbers.map((number) => lookUp(reader, walletAddress(identity, viewingKey, kind, number))));
      } catch (error) {
        return { pass, status: 'incomplete', reason: `A server did not answer for addresses ${from} to ${from + numbers.length - 1} of kind ${kind}: ${describe(error)}`, found, progress, lookups };
      }
      lookups += numbers.length;
      for (const result of results) {
        if (result !== undefined && !found.some((entry) => entry.address.kind === kind && entry.address.number === result.address.number)) found.push(result);
      }
      progress[kind] = from + numbers.length;
      options.onProgress?.({ found: [...found], progress: { ...progress } });
    }
  }
  return { pass, status: 'complete', found, progress, lookups };
};

/** The quick pass for one seed: like restoring an HD wallet, with a gap as long as the window of each kind. */
export const quickPass = (reader: ChainReader, identity: Uint8Array, viewingKey: ViewingKey, options: PassOptions = {}): Promise<PassResult> =>
  run('quick', reader, identity, viewingKey, options);

/** The full pass for one seed: every number of every range. */
export const fullPass = (reader: ChainReader, identity: Uint8Array, viewingKey: ViewingKey, options: PassOptions = {}): Promise<PassResult> =>
  run('full', reader, identity, viewingKey, options);

/** What a device knows of one seed the wallet has had. */
export type SeedView =
  | { label: string; viewingKey: ViewingKey }
  /** The wallet had this seed and the device holds no viewing key for it. */
  | { label: string; missing: true }
  /** Two different viewing keys are claimed for this seed and nothing settles which is right. */
  | { label: string; conflicting: ViewingKey[] };

export interface SeedSearch {
  label: string;
  quick?: PassResult;
  full?: PassResult;
}

export interface WalletSearch {
  /**
   * - `fully-found`: the full pass has finished for every seed the wallet has had.
   * - `searching`: nothing stands in the way, and a full pass has not finished for every seed yet.
   * - `incomplete`: something is missing or did not answer; what was found is not all there may be.
   */
  status: 'fully-found' | 'searching' | 'incomplete';
  /** Why the search is incomplete, one entry for each cause. */
  reasons: string[];
  seeds: SeedSearch[];
  /** Every coin found so far, over all seeds. */
  coins: FoundCoin[];
}

export interface WalletSearchOptions {
  /** Which passes to run in this call. The quick pass comes first so that a device can start acting on what it finds. */
  passes?: ('quick' | 'full')[];
  /** Where an earlier search stopped, by seed label. */
  resume?: SeedSearch[];
  batchSize?: number;
  onProgress?: (label: string, pass: 'quick' | 'full', state: Pick<PassResult, 'found' | 'progress'>) => void;
}

/**
 * Search for a wallet's coins over every seed it has had. The result says how much it can be relied on:
 * a wallet is fully found only after the full pass has finished for every seed.
 */
export const searchWallet = async (reader: ChainReader, identity: Uint8Array, seeds: SeedView[], options: WalletSearchOptions = {}): Promise<WalletSearch> => {
  const passes = options.passes ?? ['quick', 'full'];
  const reasons: string[] = [];
  const results: SeedSearch[] = [];
  for (const seed of seeds) {
    const earlier = options.resume?.find((entry) => entry.label === seed.label);
    const entry: SeedSearch = { label: seed.label, ...(earlier?.quick === undefined ? {} : { quick: earlier.quick }), ...(earlier?.full === undefined ? {} : { full: earlier.full }) };
    results.push(entry);
    if ('missing' in seed) {
      reasons.push(`The viewing key of ${seed.label} is missing: its addresses cannot be searched.`);
      continue;
    }
    if ('conflicting' in seed) {
      reasons.push(`${seed.conflicting.length} different viewing keys are claimed for ${seed.label}: its addresses are not searched until that is settled.`);
      continue;
    }
    for (const pass of passes) {
      const before = entry[pass];
      if (before?.status === 'complete') continue;
      const result = await (pass === 'quick' ? quickPass : fullPass)(reader, identity, seed.viewingKey, {
        ...(before === undefined ? {} : { resume: before }),
        ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
        onProgress: (state) => options.onProgress?.(seed.label, pass, state),
      });
      entry[pass] = result;
      if (result.status === 'incomplete') {
        reasons.push(`${seed.label}, ${pass} pass: ${result.reason ?? 'not finished'}`);
        break;
      }
    }
  }
  const coins = new Map<string, FoundCoin>();
  for (const entry of results) {
    for (const pass of [entry.quick, entry.full]) {
      for (const address of pass?.found ?? []) {
        for (const coin of address.coins) coins.set(`${coin.address.lockingBytecode.join(',')}:${coin.utxo.transactionHash.join(',')}:${coin.utxo.index}`, coin);
      }
    }
  }
  const everyFullPassDone = results.length > 0 && results.every((entry) => entry.full?.status === 'complete');
  return {
    status: reasons.length > 0 ? 'incomplete' : everyFullPassDone ? 'fully-found' : 'searching',
    reasons,
    seeds: results,
    coins: [...coins.values()],
  };
};
