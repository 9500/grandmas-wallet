import { type Output, binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import type { Utxo } from '@grandmas-wallet/core';

import type { ParyonContracts } from './deployment.js';
import { type LoanState, type PriceState, CHANGE_INTEREST_FUNCTION_COMMITMENT, MANAGE_FUNCTION_COMMITMENT, SIDECAR_COMMITMENT, decodeBorrowingPeriod, decodeLoanState, decodePriceState } from './state.js';

/**
 * Reading a deployment's shared outputs and a borrower's loan from a server. A server's listing is used only
 * to find candidates; every output is then read from its own transaction and checked there.
 */

/** An unspent output as a server lists it. The token data, when given, only narrows the search. */
export interface ListedOutput {
  transactionId: string;
  index: number;
  valueSatoshis: bigint;
  /** 0 or less while unconfirmed. */
  height: number;
  token?: { category: string; amount: bigint; nft?: { capability: string; commitment: string } };
}

/** What reading needs from a server. This project's Electrum connection has both. */
export interface ParyonChain {
  getTransaction(transactionId: string): Promise<string | undefined>;
  listUnspent(lockingBytecode: Uint8Array): Promise<ListedOutput[]>;
}

/** An unspent output, read from its transaction. */
export interface LiveOutput extends Utxo {
  height: number;
}

export interface BorrowingThread extends LiveOutput {
  /** The period loans opened from it start in. */
  period: number;
  /** PUSD it can still lend, in cents. */
  supply: bigint;
}

export interface PriceThread extends LiveOutput {
  state: PriceState;
}

export interface ParyonState {
  borrowing: BorrowingThread[];
  price: PriceThread[];
  loanKeyFactory: LiveOutput[];
  manage: LiveOutput[];
}

const same = (a: Uint8Array, b: Uint8Array): boolean => binToHex(a) === binToHex(b);

/** Reads transactions once each. */
export class TransactionReader {
  private readonly cache = new Map<string, Output[]>();
  constructor(private readonly chain: Pick<ParyonChain, 'getTransaction'>) {}

  async output(transactionId: string, index: number): Promise<Output> {
    let outputs = this.cache.get(transactionId);
    if (outputs === undefined) {
      const text = await this.chain.getTransaction(transactionId);
      if (text === undefined) throw new Error(`The server does not know transaction ${transactionId}.`);
      const transaction = decodeTransactionBch(hexToBin(text));
      if (typeof transaction === 'string') throw new Error(`Transaction ${transactionId} cannot be read: ${transaction}`);
      outputs = transaction.outputs;
      this.cache.set(transactionId, outputs);
    }
    const output = outputs[index];
    if (output === undefined) throw new Error(`Transaction ${transactionId} has no output ${index}.`);
    return output;
  }
}

/** The unspent outputs at a script that pass a check, read from their transactions. */
const outputsAt = async (
  chain: ParyonChain,
  reader: TransactionReader,
  lockingBytecode: Uint8Array,
  candidate: (listed: ListedOutput) => boolean,
  genuine: (output: Output) => boolean,
): Promise<LiveOutput[]> => {
  const found: LiveOutput[] = [];
  for (const listed of await chain.listUnspent(lockingBytecode)) {
    if (!candidate(listed)) continue;
    const output = await reader.output(listed.transactionId, listed.index);
    if (!same(output.lockingBytecode, lockingBytecode) || !genuine(output)) continue;
    found.push({ transactionHash: hexToBin(listed.transactionId), index: listed.index, output, height: listed.height });
  }
  return found;
};

/** Whether a listed token can be the one wanted; a listing without token data is read to find out. */
const listedAs = (category: Uint8Array, capability?: string) => (listed: ListedOutput): boolean =>
  listed.token === undefined || (listed.token.category === binToHex(category) && (capability === undefined || listed.token.nft?.capability === capability));

const hasNft = (output: Output, category: Uint8Array, capability: 'none' | 'mutable' | 'minting'): boolean =>
  output.token !== undefined && same(output.token.category, category) && output.token.nft?.capability === capability;

/** The deployment's shared outputs a borrower's transactions spend: Borrowing and price threads, factories, manage NFTs. */
export const readParyonState = async (chain: ParyonChain, contracts: ParyonContracts, reader = new TransactionReader(chain)): Promise<ParyonState> => {
  const P = contracts.paryonCategory;
  const borrowing = (await outputsAt(chain, reader, contracts.borrowing.lockingBytecode, listedAs(P, 'minting'), (output) => hasNft(output, P, 'minting'))).map((thread) => ({
    ...thread,
    period: decodeBorrowingPeriod(thread.output.token?.nft?.commitment as Uint8Array),
    supply: thread.output.token?.amount ?? 0n,
  }));
  const price = (await outputsAt(chain, reader, contracts.price.lockingBytecode, listedAs(P, 'mutable'), (output) => hasNft(output, P, 'mutable') && output.token?.nft?.commitment[0] === 0x00)).map((thread) => ({
    ...thread,
    state: decodePriceState(thread.output.token?.nft?.commitment as Uint8Array),
  }));
  const F = contracts.loanKeyFactoryCategory;
  const loanKeyFactory = await outputsAt(chain, reader, contracts.loanKeyFactory.lockingBytecode, listedAs(F, 'minting'), (output) => hasNft(output, F, 'minting') && output.token?.nft?.commitment.length === 0);
  const manage = await outputsAt(chain, reader, contracts.manage.lockingBytecode, listedAs(P, 'none'), (output) => hasNft(output, P, 'none') && same(output.token?.nft?.commitment as Uint8Array, MANAGE_FUNCTION_COMMITMENT));
  return { borrowing, price, loanKeyFactory, manage };
};

/**
 * The coins of Paryon's interest function (`changeInterest.cash`), which an action that changes a loan's interest rate
 * spends and makes again. They are not read with the rest of the deployment's shared outputs: only that action needs them.
 */
export const readInterestFunctions = async (chain: ParyonChain, contracts: ParyonContracts, reader = new TransactionReader(chain)): Promise<LiveOutput[]> => {
  const P = contracts.paryonCategory;
  return outputsAt(chain, reader, contracts.changeInterest.lockingBytecode, listedAs(P, 'none'), (output) => hasNft(output, P, 'none') && same(output.token?.nft?.commitment as Uint8Array, CHANGE_INTEREST_FUNCTION_COMMITMENT));
};

const outpointOf = (utxo: Utxo): string => `${binToHex(utxo.transactionHash)}:${utxo.index}`;
/** One of a function's coins, by its place among them in the order of their outpoints; out of range is held to the list. */
const picked = (coins: LiveOutput[], pick: (count: number) => number): LiveOutput | undefined => {
  const sorted = coins.slice().sort((a, b) => (outpointOf(a) < outpointOf(b) ? -1 : 1));
  return sorted[Math.min(Math.max(pick(sorted.length), 0), sorted.length - 1)];
};

/** A loan, found from its key. */
export interface FoundLoan {
  loan: LiveOutput;
  sidecar: LiveOutput;
  state: LoanState;
  /** The loan key's category, explorer order. */
  keyCategory: Uint8Array;
}

/**
 * Find the loan a key opens (the procedure of the research dossier, section 3):
 *
 * 1. At the sidecar script, which is the same for every deployment, take the unspent outputs that hold an
 *    NFT of the key's category without capability and with commitment `01`.
 * 2. For each, output `index − 1` of the same transaction must be unspent, at the Loan script, and hold a
 *    mutable NFT of this deployment's category with a loan's state. Only Paryon's contracts can put such an
 *    NFT there, so a look-alike sidecar that a key holder minted cannot stand next to a genuine loan.
 *
 * Returns `undefined` when the key opens no open loan (it was closed, or never opened one).
 */
export const findLoan = async (chain: ParyonChain, contracts: ParyonContracts, keyCategory: Uint8Array, reader = new TransactionReader(chain)): Promise<FoundLoan | undefined> => {
  const sidecars = await outputsAt(chain, reader, contracts.loanSidecar.lockingBytecode, listedAs(keyCategory, 'none'), (output) => hasNft(output, keyCategory, 'none') && same(output.token?.nft?.commitment as Uint8Array, SIDECAR_COMMITMENT));
  if (sidecars.length === 0) return undefined;
  const loansUnspent = new Set((await chain.listUnspent(contracts.loan.lockingBytecode)).map((listed) => `${listed.transactionId}:${listed.index}`));
  const found: FoundLoan[] = [];
  for (const sidecar of sidecars) {
    if (sidecar.index === 0) continue;
    const transactionId = binToHex(sidecar.transactionHash);
    if (!loansUnspent.has(`${transactionId}:${sidecar.index - 1}`)) continue;
    const output = await reader.output(transactionId, sidecar.index - 1);
    if (!same(output.lockingBytecode, contracts.loan.lockingBytecode) || !hasNft(output, contracts.paryonCategory, 'mutable')) continue;
    const commitment = output.token?.nft?.commitment as Uint8Array;
    if (commitment.length !== 27 || commitment[0] !== 0x01) continue;
    found.push({ loan: { transactionHash: sidecar.transactionHash, index: sidecar.index - 1, output, height: sidecar.height }, sidecar, state: decodeLoanState(commitment), keyCategory });
  }
  if (found.length > 1) throw new Error(`The key ${binToHex(keyCategory)} opens ${found.length} loans; one is expected.`);
  return found[0];
};

/**
 * What an action on an open loan spends, as the loan's page names it in a request
 * (`page-requests.ts`): the loan and its sidecar found from the key (`findLoan`), the price thread with the highest
 * price, which Paryon's contracts reckon the collateral at, and one of the manage function's coins, taken at random. The key's coin is the
 * wallet's: what it holds comes from the wallet's answer to a positions request.
 *
 * Returns `undefined` when the key opens no open loan.
 * @throws when Paryon's shared contracts cannot be found
 */
export const loanCoins = async (
  chain: ParyonChain,
  contracts: ParyonContracts,
  keyCategory: Uint8Array,
  keySatoshis: bigint,
  reader = new TransactionReader(chain),
  /** Which of the manage function's coins to take, by its place among them in the order of their outpoints. */
  pick: (count: number) => number = (count) => Math.floor(Math.random() * count),
): Promise<(FoundLoan & { price: PriceThread; manageFunction: LiveOutput; keySatoshis: bigint }) | undefined> => {
  const found = await findLoan(chain, contracts, keyCategory, reader);
  if (found === undefined) return undefined;
  const state = await readParyonState(chain, contracts, reader);
  const [price] = state.price.slice().sort((a, b) => (b.state.price > a.state.price ? 1 : b.state.price < a.state.price ? -1 : outpointOf(a) < outpointOf(b) ? -1 : 1));
  // Anyone may spend a manage function's coin in an action of their own, which puts a new one in its place. Taking one at
  // random among those listed, rather than always the first, makes it unlikely that someone else spends the same coin
  // while the user looks at the request, which the network would then refuse as a conflict.
  const manageFunction = picked(state.manage, pick);
  if (price === undefined) throw new Error('Paryon\'s price contract could not be found on the chain just now.');
  if (manageFunction === undefined) throw new Error('Paryon\'s manage function could not be found on the chain just now.');
  return { ...found, price, manageFunction, keySatoshis };
};

/**
 * What an action that changes a loan's interest rate spends, as the loan's page names it in a request
 * (`changeInterestRequestAlone`): the loan and its sidecar found from the key, and one of the interest function's coins,
 * taken at random as for the manage function. No price is needed: the rate does not depend on it.
 *
 * Returns `undefined` when the key opens no open loan.
 * @throws when Paryon's interest function cannot be found
 */
export const interestCoins = async (
  chain: ParyonChain,
  contracts: ParyonContracts,
  keyCategory: Uint8Array,
  keySatoshis: bigint,
  reader = new TransactionReader(chain),
  pick: (count: number) => number = (count) => Math.floor(Math.random() * count),
): Promise<(FoundLoan & { interestFunction: LiveOutput; keySatoshis: bigint }) | undefined> => {
  const found = await findLoan(chain, contracts, keyCategory, reader);
  if (found === undefined) return undefined;
  const interestFunction = picked(await readInterestFunctions(chain, contracts, reader), pick);
  if (interestFunction === undefined) throw new Error('Paryon\'s interest function could not be found on the chain just now.');
  return { ...found, interestFunction, keySatoshis };
};

// ------------------------------------------------------------------------- a coin, a factory, a waiting key

/** `<transaction id>:<output index>` read into its two parts. */
export const parseOutpoint = (outpoint: string): { transactionId: string; index: number } | undefined => {
  const match = /^([0-9a-f]{64}):(\d{1,6})$/.exec(outpoint);
  return match === null ? undefined : { transactionId: match[1] as string, index: Number(match[2]) };
};

/**
 * A coin as the chain shows it: read from its transaction, and whether the server lists it as unspent at its script.
 * Returns `undefined` when the server does not know the transaction or it has no such output.
 */
export const readCoin = async (chain: ParyonChain, outpoint: string, reader = new TransactionReader(chain)): Promise<{ coin: LiveOutput; unspent: boolean } | undefined> => {
  const at = parseOutpoint(outpoint);
  if (at === undefined) return undefined;
  let output: Output;
  try {
    output = await reader.output(at.transactionId, at.index);
  } catch {
    return undefined;
  }
  const listed = (await chain.listUnspent(output.lockingBytecode)).find((entry) => entry.transactionId === at.transactionId && entry.index === at.index);
  return { coin: { transactionHash: hexToBin(at.transactionId), index: at.index, output, height: listed?.height ?? 0 }, unspent: listed !== undefined };
};

/** The coin of Paryon's key factories a loan key is made with: the first by outpoint. */
export const firstFactory = (state: Pick<ParyonState, 'loanKeyFactory'>): LiveOutput | undefined => state.loanKeyFactory.slice().sort((a, b) => (outpointOf(a) < outpointOf(b) ? -1 : 1))[0];

/** The Borrowing thread a loan of this debt is opened from: one that can lend it, the most recent period first, then the most it can still lend. */
export const borrowingFor = (threads: BorrowingThread[], debt: bigint): BorrowingThread | undefined =>
  threads.filter((thread) => thread.supply >= debt).sort((a, b) => b.period - a.period || (b.supply > a.supply ? 1 : b.supply < a.supply ? -1 : 0))[0];

/** A loan key that was made and waits in Paryon's contract (the origin enforcer) until its loan is opened. */
export interface MadeKey {
  /** The key's category, explorer order, hex. */
  category: string;
  /** The transaction that made it. */
  transactionId: string;
  /** Outputs 2 and 3 of that transaction: the new key, waiting in Paryon's contract, and its proof of origin. */
  enforcer: Utxo;
  proof: Utxo;
}

/** The key a transaction made: its category is the identifier of the transaction whose output the wallet spent first. */
export const readMadeKey = async (chain: Pick<ParyonChain, 'getTransaction'>, transactionId: string): Promise<MadeKey> => {
  const text = await chain.getTransaction(transactionId);
  if (text === undefined) throw new Error('The transaction that made the loan key is not known to the server yet.');
  const transaction = decodeTransactionBch(hexToBin(text));
  if (typeof transaction === 'string') throw new Error(transaction);
  const [first] = transaction.inputs;
  if (first === undefined) throw new Error('The transaction that made the loan key has no inputs.');
  const at = (index: number): Utxo => ({ transactionHash: hexToBin(transactionId), index, output: transaction.outputs[index] as Output });
  return { category: binToHex(first.outpointTransactionHash), transactionId, enforcer: at(2), proof: at(3) };
};

/** Whether a key that was made is still waiting to be used: its two outputs unspent. */
export const keyWaiting = async (chain: ParyonChain, key: MadeKey): Promise<boolean> => {
  const listed = async (utxo: Utxo): Promise<boolean> =>
    (await chain.listUnspent(utxo.output.lockingBytecode)).some((entry: ListedOutput) => entry.transactionId === binToHex(utxo.transactionHash) && entry.index === utxo.index);
  const [enforcer, proof] = await Promise.all([listed(key.enforcer), listed(key.proof)]);
  return enforcer && proof;
};

/**
 * The loan key of a category waiting in Paryon's contract, found on chain: an unspent output at the origin enforcer's
 * script that holds the minting NFT of the category, and beside it, the next output of the same transaction, the
 * unspent proof of origin of Paryon's factory. Returns `undefined` when no key of the category waits (it was never made,
 * or a loan was opened with it).
 */
export const findWaitingKey = async (chain: ParyonChain, contracts: ParyonContracts, keyCategory: Uint8Array, reader = new TransactionReader(chain)): Promise<MadeKey | undefined> => {
  const enforcers = await outputsAt(chain, reader, contracts.loanKeyOriginEnforcer.lockingBytecode, listedAs(keyCategory, 'minting'), (output) => hasNft(output, keyCategory, 'minting') && output.token?.nft?.commitment.length === 0);
  if (enforcers.length === 0) return undefined;
  const proofsUnspent = new Set((await chain.listUnspent(contracts.loanKeyOriginProof.lockingBytecode)).map((listed) => `${listed.transactionId}:${listed.index}`));
  for (const enforcer of enforcers) {
    const transactionId = binToHex(enforcer.transactionHash);
    if (!proofsUnspent.has(`${transactionId}:${enforcer.index + 1}`)) continue;
    const proof = await reader.output(transactionId, enforcer.index + 1);
    if (!same(proof.lockingBytecode, contracts.loanKeyOriginProof.lockingBytecode) || !hasNft(proof, contracts.loanKeyFactoryCategory, 'none')) continue;
    return { category: binToHex(keyCategory), transactionId, enforcer, proof: { transactionHash: enforcer.transactionHash, index: enforcer.index + 1, output: proof } };
  }
  return undefined;
};
