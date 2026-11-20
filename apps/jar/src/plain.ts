import {
  type Output,
  type TransactionCommon,
  binToHex,
  decodeHdPublicKey,
  decodeTransactionBch,
  deriveHdPublicNodeChild,
  encodeLockingBytecodeP2pkh,
  encodeTransactionBch,
  hash160,
  hashTransactionUiOrder,
  hexToBin,
} from '@bitauth/libauth';
import { smallestOutputValue, verifyTransaction } from '@grandmas-wallet/core';
import { type SavingsJarScript, WITHDRAW_SEQUENCE, savingsJarScript, unlockTimeBytes } from '@grandmas-wallet/savings-jar';

import { type JarView, KEY_SATOSHIS, TOO_EARLY, dateOnKey, isTooEarly } from './jar.js';

/**
 * Savings jars for an ordinary wallet.
 *
 * The wallet shares the public keys of its address chains and signs the inputs it is told to; everything
 * else happens here. This page finds the wallet's coins and keys from those public keys and the chain,
 * builds each transaction, asks the wallet for signatures, checks what comes back and sends it.
 *
 * A jar is the same for every wallet: its key is a token whose category is the jar's and whose
 * commitment is the jar's date, and the jar's address follows from the two. The page finds the wallet's
 * jars the way any wallet would: from the keys the wallet holds. No note in a transaction and no server of
 * the application is involved.
 */

/** The names a wallet gives its address chains in a WizardConnect session. */
export type ChainName = 'receive' | 'change';
export type WalletPaths = Record<ChainName, string>;

/** What this page needs from a server. */
export interface PlainChain {
  getTransaction(transactionId: string): Promise<string | undefined>;
  getHistory(lockingBytecode: Uint8Array): Promise<{ transactionId: string; height: number }[]>;
  listUnspent(lockingBytecode: Uint8Array): Promise<{ transactionId: string; index: number; valueSatoshis: bigint; height: number; hasToken: boolean }[]>;
  broadcast(transactionHex: string): Promise<{ accepted: true; transactionId: string } | { accepted: false; reason: string }>;
}

/** An unspent output, with everything signing it needs. */
export interface Outpoint {
  /** In the byte order explorers show. */
  transactionId: string;
  index: number;
  output: Output;
}

/** A coin at an address of the wallet. */
export interface Coin extends Outpoint {
  chain: ChainName;
  addressIndex: number;
}

export interface Scan {
  /** Coins without tokens: what pays for things. */
  coins: Coin[];
  /** Coins that carry tokens. Moved only on purpose. */
  tokens: Coin[];
  /** What the coins without tokens hold. */
  balance: bigint;
  /** The first address of each chain after the last one used. */
  next: Record<ChainName, number>;
}

/** A jar whose key the wallet holds. */
export interface PlainJar extends JarView {
  key: Coin;
  script: SavingsJarScript;
  /** Unspent outputs at the jar's address, without tokens. */
  coins: Outpoint[];
}

/** One input the wallet is asked to sign, as WizardConnect names it: input, chain, address number. */
export type InputPath = [number, ChainName, number];

/** A request for signatures in the form it travels in: bytes as hex, amounts as `<bigint: Nn>`. */
export interface SignRequest {
  transaction: {
    transaction: string;
    sourceOutputs: Record<string, unknown>[];
    broadcast: false;
    userPrompt: string;
  };
  inputPaths: InputPath[];
}

/** A transaction ready to be signed, with what is needed to check the answer. */
export interface Prepared {
  request: SignRequest;
  transaction: TransactionCommon;
  sourceOutputs: Output[];
  fee: bigint;
}

/** How far apart used addresses may be before the rest of a chain is taken to be unused. */
const GAP = 20;
/** Signature (65) and public key (33), each with its length byte. */
const SIGNED_INPUT_BYTES = 100;
/** A wallet that signs with ECDSA makes a signature up to this many bytes longer than a Schnorr one. */
const SIGNATURE_ALLOWANCE = 8n;
/** An input that does not enable a lock time. */
const FINAL = 0xffffffff;
/** The most coins of one jar emptied in one transaction; the rest stay for the next. */
const MOST_JAR_COINS = 60;

// ------------------------------------------------------------------ keys and addresses

export const readPaths = (paths: { name: string; xpub: string }[]): WalletPaths => {
  const find = (name: ChainName): string => {
    const found = paths.find((path) => path.name === name)?.xpub;
    if (found === undefined) throw new Error(`The wallet did not share its "${name}" addresses.`);
    return found;
  };
  return { receive: find('receive'), change: find('change') };
};

/** Whether the wallet's keys are for the main network or a test network. */
export const networkOf = (paths: WalletPaths): 'mainnet' | 'testnet' => {
  const decoded = decodeHdPublicKey(paths.receive);
  if (typeof decoded === 'string') throw new Error(`The wallet's public key cannot be read: ${decoded}`);
  return decoded.network;
};

export const addressScriptAt = (xpub: string, index: number): Uint8Array => {
  const decoded = decodeHdPublicKey(xpub);
  if (typeof decoded === 'string') throw new Error(`The wallet's public key cannot be read: ${decoded}`);
  const child = deriveHdPublicNodeChild(decoded.node, index);
  if (typeof child === 'string') throw new Error(child);
  return encodeLockingBytecodeP2pkh(hash160(child.publicKey));
};

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, index) => b[index] === byte);
const outpointName = (outpoint: { transactionId: string; index: number }): string => `${outpoint.transactionId}:${outpoint.index}`;

// ------------------------------------------------------------------ finding coins and jars

/**
 * Find the wallet's coins by walking its address chains until twenty addresses in a row have never been
 * used. Coins that carry tokens are read in full from their transactions: the server's list only says
 * that they carry one.
 *
 * @param skip - outpoints this page has just spent, which a server may still list
 */
export const scanWallet = async (chain: PlainChain, paths: WalletPaths, skip: ReadonlySet<string> = new Set()): Promise<Scan> => {
  const coins: Coin[] = [];
  const tokens: Coin[] = [];
  const next: Record<ChainName, number> = { receive: 0, change: 0 };
  const transactions = new Map<string, Promise<TransactionCommon | undefined>>();
  const transaction = (transactionId: string) => {
    let read = transactions.get(transactionId);
    if (read === undefined) {
      read = chain.getTransaction(transactionId).then((hex) => {
        const decoded = hex === undefined ? 'unknown' : decodeTransactionBch(hexToBin(hex));
        return typeof decoded === 'string' ? undefined : decoded;
      });
      transactions.set(transactionId, read);
    }
    return read;
  };
  for (const name of ['receive', 'change'] as const) {
    let unused = 0;
    let firstUnused: number | undefined;
    for (let start = 0; unused < GAP; start += GAP) {
      const found = await Promise.all(
        Array.from({ length: GAP }, async (_, offset) => {
          const addressIndex = start + offset;
          const lockingBytecode = addressScriptAt(paths[name], addressIndex);
          const history = await chain.getHistory(lockingBytecode);
          return { addressIndex, lockingBytecode, used: history.length > 0, unspent: history.length === 0 ? [] : await chain.listUnspent(lockingBytecode) };
        }),
      );
      for (const { addressIndex, lockingBytecode, used, unspent } of found) {
        if (!used) {
          firstUnused ??= addressIndex;
          unused += 1;
          continue;
        }
        firstUnused = undefined;
        unused = 0;
        for (const entry of unspent) {
          if (skip.has(outpointName(entry))) continue;
          if (!entry.hasToken) {
            coins.push({ transactionId: entry.transactionId, index: entry.index, output: { lockingBytecode, valueSatoshis: entry.valueSatoshis }, chain: name, addressIndex });
            continue;
          }
          const output = (await transaction(entry.transactionId))?.outputs[entry.index];
          // Only what the transaction itself says counts; an output that is not where the server put it is left alone.
          if (output?.token === undefined || !sameBytes(output.lockingBytecode, lockingBytecode)) continue;
          tokens.push({ transactionId: entry.transactionId, index: entry.index, output, chain: name, addressIndex });
        }
      }
    }
    next[name] = firstUnused ?? 0;
  }
  return { coins, tokens, balance: coins.reduce((sum, coin) => sum + coin.output.valueSatoshis, 0n), next };
};

/**
 * The jars whose keys the wallet holds: every token it holds with no capability and no fungible amount,
 * whose commitment reads as a date, and whose jar address (from its category and that date) has a history
 * on chain. An ordinary wallet keeps no record of its jars; the key's category and date are enough to find them.
 */
export const findJars = async (chain: PlainChain, scan: Pick<Scan, 'tokens'>, skip: ReadonlySet<string> = new Set()): Promise<PlainJar[]> => {
  const candidates = new Map<string, { key: Coin; category: string; unlockTime: number; script: SavingsJarScript }>();
  for (const key of scan.tokens) {
    const token = key.output.token;
    if (token?.nft === undefined || token.nft.capability !== 'none' || token.amount !== 0n) continue;
    const unlockTime = dateOnKey(binToHex(token.nft.commitment));
    if (unlockTime === undefined) continue;
    const category = binToHex(token.category);
    const script = savingsJarScript(token.category, unlockTime);
    const address = binToHex(script.lockingBytecode);
    if (!candidates.has(address)) candidates.set(address, { key, category, unlockTime, script });
  }
  const jars = await Promise.all(
    [...candidates.entries()].map(async ([address, candidate]): Promise<PlainJar | undefined> => {
      const history = await chain.getHistory(candidate.script.lockingBytecode);
      if (history.length === 0) return undefined;
      const unspent = await chain.listUnspent(candidate.script.lockingBytecode);
      const coins: Outpoint[] = unspent
        .filter((entry) => !entry.hasToken && !skip.has(outpointName(entry)))
        .map((entry) => ({ transactionId: entry.transactionId, index: entry.index, output: { lockingBytecode: candidate.script.lockingBytecode, valueSatoshis: entry.valueSatoshis } }));
      const satoshis = coins.reduce((sum, coin) => sum + coin.output.valueSatoshis, 0n);
      return { ...candidate, lockingBytecode: address, coins, satoshis, status: satoshis > 0n ? 'open' : 'empty' };
    }),
  );
  return jars.filter((jar): jar is PlainJar => jar !== undefined).sort((a, b) => a.unlockTime - b.unlockTime || a.category.localeCompare(b.category));
};

// ------------------------------------------------------------------ building transactions

interface Spend {
  coin: Outpoint;
  sequence: number;
  /** The unlocking script as it is sent to the wallet: empty for an input the wallet signs. */
  unlocking: Uint8Array;
  /** Bytes the unlocking script will have once signed. */
  signedBytes: number;
  /** For an input the wallet signs: its chain and address number. */
  path?: [ChainName, number];
}

const walletSpend = (coin: Coin, sequence = FINAL): Spend => ({ coin, sequence, unlocking: new Uint8Array(), signedBytes: SIGNED_INPUT_BYTES, path: [coin.chain, coin.addressIndex] });

const onWire = (satoshis: bigint): string => `<bigint: ${satoshis}n>`;

const tokenOnWire = (token: NonNullable<Output['token']>) => ({
  category: binToHex(token.category),
  amount: onWire(token.amount),
  ...(token.nft === undefined ? {} : { nft: { capability: token.nft.capability, commitment: binToHex(token.nft.commitment) } }),
});

const transactionOf = (spends: Spend[], outputs: Output[], locktime: number): TransactionCommon => ({
  version: 2,
  locktime,
  inputs: spends.map((spend) => ({
    outpointTransactionHash: hexToBin(spend.coin.transactionId),
    outpointIndex: spend.coin.index,
    sequenceNumber: spend.sequence,
    unlockingBytecode: spend.unlocking,
  })),
  outputs,
});

/** The fee at one satoshi per byte for the transaction once signed, with room for longer signatures. */
const feeFor = (spends: Spend[], outputs: Output[], locktime: number): bigint => {
  const unsigned = encodeTransactionBch(transactionOf(spends, outputs, locktime)).length;
  const signedBytes = spends.reduce((sum, spend) => sum + spend.signedBytes - spend.unlocking.length, 0);
  const signers = spends.filter((spend) => spend.path !== undefined).length;
  // A length prefix grows by two bytes past 252: one more byte per input covers it with room to spare.
  return BigInt(unsigned + signedBytes + spends.length) + SIGNATURE_ALLOWANCE * BigInt(signers);
};

const assemble = (spends: Spend[], outputs: Output[], locktime: number, userPrompt: string): Prepared => {
  const transaction = transactionOf(spends, outputs, locktime);
  const sourceOutputs = spends.map((spend) => spend.coin.output);
  const total = (list: Output[]) => list.reduce((sum, output) => sum + output.valueSatoshis, 0n);
  outputs.forEach((output, index) => {
    const smallest = smallestOutputValue(output);
    if (output.valueSatoshis < smallest) throw new Error(`Output ${index} would hold ${output.valueSatoshis} satoshis; the network takes no such output below ${smallest}.`);
  });
  return {
    transaction,
    sourceOutputs,
    fee: total(sourceOutputs) - total(outputs),
    request: {
      transaction: {
        transaction: binToHex(encodeTransactionBch(transaction)),
        sourceOutputs: spends.map((spend) => ({
          outpointIndex: spend.coin.index,
          outpointTransactionHash: spend.coin.transactionId,
          sequenceNumber: spend.sequence,
          unlockingBytecode: binToHex(spend.unlocking),
          lockingBytecode: binToHex(spend.coin.output.lockingBytecode),
          valueSatoshis: onWire(spend.coin.output.valueSatoshis),
          ...(spend.coin.output.token === undefined ? {} : { token: tokenOnWire(spend.coin.output.token) }),
        })),
        broadcast: false,
        userPrompt,
      },
      inputPaths: spends.flatMap((spend, index): InputPath[] => (spend.path === undefined ? [] : [[index, spend.path[0], spend.path[1]]])),
    },
  };
};

/** The wallet's coins do not cover what was asked and the fee. */
export class NotEnoughError extends Error {
  constructor(balance: bigint, wanted: bigint) {
    super(`Your wallet has ${balance.toLocaleString('en-US')} satoshis in coins it can spend here. That does not cover ${wanted.toLocaleString('en-US')} satoshis and the network fee.`);
    this.name = 'NotEnoughError';
  }
}

/**
 * Pay for `outputs` from the wallet's coins, with change. The largest coins are taken first, after
 * `first` if one is given, which becomes input 0.
 */
const paid = (scan: Pick<Scan, 'coins' | 'balance'>, outputs: Output[], change: Uint8Array, prompt: string, first?: Coin): Prepared => {
  const others = [...scan.coins]
    .filter((coin) => first === undefined || outpointName(coin) !== outpointName(first))
    .sort((a, b) => (a.output.valueSatoshis < b.output.valueSatoshis ? 1 : a.output.valueSatoshis > b.output.valueSatoshis ? -1 : 0));
  const wanted = outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n);
  for (let count = first === undefined ? 1 : 0; count <= others.length; count++) {
    const chosen = [...(first === undefined ? [] : [first]), ...others.slice(0, count)].map((coin) => walletSpend(coin));
    const left = chosen.reduce((sum, spend) => sum + spend.coin.output.valueSatoshis, 0n) - wanted;
    if (left < 0n) continue;
    const changeOutput: Output = { lockingBytecode: change, valueSatoshis: 0n };
    const returned = left - feeFor(chosen, [...outputs, changeOutput], 0);
    if (returned >= smallestOutputValue(changeOutput)) return assemble(chosen, [...outputs, { ...changeOutput, valueSatoshis: returned }], 0, prompt);
    // Too little would come back to be worth an output: it goes to the fee, if it covers one.
    if (left >= feeFor(chosen, outputs, 0)) return assemble(chosen, outputs, 0, prompt);
  }
  throw new NotEnoughError(scan.balance, wanted);
};

const when = (unlockTime: number): string => new Date(unlockTime * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const sat = (satoshis: bigint): string => `${satoshis.toLocaleString('en-US')} satoshis`;

/** The key output of a jar: one token of the category, no capability, the date as its commitment. */
export const keyOutput = (lockingBytecode: Uint8Array, category: Uint8Array, unlockTime: number, valueSatoshis = KEY_SATOSHIS): Output => ({
  lockingBytecode,
  valueSatoshis,
  token: { category, amount: 0n, nft: { capability: 'none', commitment: unlockTimeBytes(unlockTime) } },
});

/** A coin of the wallet that can start a key: output 0 of its transaction, without a token. The largest such. */
export const genesisCoin = (scan: Pick<Scan, 'coins'>): Coin | undefined =>
  scan.coins.filter((coin) => coin.index === 0).sort((a, b) => (a.output.valueSatoshis < b.output.valueSatoshis ? 1 : a.output.valueSatoshis > b.output.valueSatoshis ? -1 : 0))[0];

/**
 * The opening transaction: the jar with the first savings (output 0), its key to the wallet's next
 * receiving address (output 1), change. Input 0 spends output 0 of an earlier transaction, whose
 * identifier becomes the key's category.
 *
 * @throws if the wallet has no coin that can start a key, or too little
 */
export const prepareOpen = (paths: WalletPaths, scan: Pick<Scan, 'coins' | 'balance' | 'next'>, satoshis: bigint, unlockTime: number): Prepared & { category: string } => {
  const first = genesisCoin(scan);
  if (first === undefined) throw new Error('The wallet has no coin that can start a key: one that is the first output of its transaction.');
  const category = first.transactionId;
  const script = savingsJarScript(hexToBin(category), unlockTime);
  const outputs = [{ lockingBytecode: script.lockingBytecode, valueSatoshis: satoshis }, keyOutput(addressScriptAt(paths.receive, scan.next.receive), hexToBin(category), unlockTime)];
  const prompt = `Open a savings jar with ${sat(satoshis)}, until ${when(unlockTime)}. The jar's key, a token, comes to your wallet.`;
  return { ...paid(scan, outputs, addressScriptAt(paths.change, scan.next.change), prompt, first), category };
};

/**
 * A payment from the wallet to itself whose first output can start a key: it holds what opening the jar
 * will need, so that the opening transaction can spend it alone.
 */
export const prepareSelfPayment = (paths: WalletPaths, scan: Pick<Scan, 'coins' | 'balance' | 'next'>, satoshis: bigint, unlockTime: number): Prepared => {
  const target = addressScriptAt(paths.change, scan.next.change);
  // What the opening transaction will cost, measured on a stand-in for the coin it will spend.
  const standIn: Coin = { transactionId: '00'.repeat(32), index: 0, output: { lockingBytecode: target, valueSatoshis: 0n }, chain: 'change', addressIndex: scan.next.change };
  const category = new Uint8Array(32);
  const openOutputs = [{ lockingBytecode: savingsJarScript(category, unlockTime).lockingBytecode, valueSatoshis: satoshis }, keyOutput(addressScriptAt(paths.receive, scan.next.receive), category, unlockTime)];
  const needed = satoshis + KEY_SATOSHIS + feeFor([walletSpend(standIn)], openOutputs, 0);
  return paid(scan, [{ lockingBytecode: target, valueSatoshis: needed }], addressScriptAt(paths.change, scan.next.change + 1), `Move ${sat(needed)} to another address of your wallet, to prepare a savings jar.`);
};

/** An ordinary payment from the wallet's coins to a jar. Anyone could make it. */
export const prepareDeposit = (paths: WalletPaths, scan: Pick<Scan, 'coins' | 'balance' | 'next'>, jar: Pick<JarView, 'lockingBytecode' | 'unlockTime'>, satoshis: bigint): Prepared =>
  paid(scan, [{ lockingBytecode: hexToBin(jar.lockingBytecode), valueSatoshis: satoshis }], addressScriptAt(paths.change, scan.next.change), `Pay ${sat(satoshis)} into a savings jar that opens on ${when(jar.unlockTime)}.`);

/**
 * Empty a jar. Input 0 is the key, signed by the wallet; the jar's coins follow and need no signature,
 * because the key's signature covers every input and output. The key goes back to the wallet first: a jar
 * whose key is gone can never be emptied again. The savings, less the fee, go to the wallet after it.
 * The lock time is the jar's date.
 *
 * @throws if the jar holds too little to pay for emptying it
 */
export const prepareWithdrawal = (paths: WalletPaths, scan: Pick<Scan, 'next'>, jar: PlainJar): Prepared => {
  const coins = jar.coins.slice(0, MOST_JAR_COINS);
  if (coins.length === 0) throw new Error('This jar is empty.');
  const keyUnlockIndex = 0;
  const jarUnlocking = jar.script.unlock(keyUnlockIndex);
  const spends: Spend[] = [
    walletSpend(jar.key, WITHDRAW_SEQUENCE),
    ...coins.map((coin): Spend => ({ coin, sequence: WITHDRAW_SEQUENCE, unlocking: jarUnlocking, signedBytes: jarUnlocking.length })),
  ];
  const token = jar.key.output.token;
  if (token === undefined) throw new Error('The jar\'s key carries no token.');
  const keyBack: Output = { lockingBytecode: addressScriptAt(paths.receive, scan.next.receive), valueSatoshis: jar.key.output.valueSatoshis, token };
  const payout: Output = { lockingBytecode: addressScriptAt(paths.receive, scan.next.receive + 1), valueSatoshis: 0n };
  const total = coins.reduce((sum, coin) => sum + coin.output.valueSatoshis, 0n);
  const value = total - feeFor(spends, [keyBack, payout], jar.unlockTime);
  if (value < smallestOutputValue(payout)) throw new Error(`This jar holds ${sat(total)}, too little to pay the fee for emptying it.`);
  return assemble(spends, [keyBack, { ...payout, valueSatoshis: value }], jar.unlockTime, `Empty a savings jar: ${sat(value)} come to your wallet, after a fee. The jar's key comes back to your wallet too.`);
};

// ------------------------------------------------------------------ what comes back

/** The network refused a transaction only because its lock time has not passed yet. */
export class TooEarlyError extends Error {
  constructor() {
    super(TOO_EARLY);
    this.name = 'TooEarlyError';
  }
}

/**
 * Check what the wallet signed. It must be the transaction that was asked for, with only the unlocking
 * scripts of the inputs it was asked to sign filled in, and it must pass the network's rules and pay at
 * least one satoshi per byte.
 * @returns the transaction as it will be sent
 * @throws if anything else changed or it would not be accepted
 */
export const checkSigned = (prepared: Prepared, signedTransactionHex: string): TransactionCommon => {
  const signed = /^([0-9a-f]{2})+$/i.test(signedTransactionHex) ? decodeTransactionBch(hexToBin(signedTransactionHex)) : 'not hex';
  if (typeof signed === 'string') throw new Error(`The wallet returned something that is not a transaction (${signed}). Nothing was sent.`);
  const named = new Set(prepared.request.inputPaths.map(([index]) => index));
  // The signed transaction with the wallet's own unlocking scripts taken out again must be the one asked for, byte for byte.
  const asked = prepared.transaction;
  const stripped: TransactionCommon = {
    ...signed,
    inputs: signed.inputs.map((input, index) => (named.has(index) ? { ...input, unlockingBytecode: asked.inputs[index]?.unlockingBytecode ?? input.unlockingBytecode } : input)),
  };
  if (!sameBytes(encodeTransactionBch(stripped), encodeTransactionBch(asked))) {
    throw new Error('The wallet returned a different transaction from the one it was asked to sign. Nothing was sent.');
  }
  const check = verifyTransaction({ transaction: signed, sourceOutputs: prepared.sourceOutputs });
  if (check !== true) throw new Error(`The signed transaction does not pass the network's rules, so nothing was sent: ${check}`);
  const size = BigInt(signedTransactionHex.length / 2);
  if (prepared.fee < size) throw new Error(`The fee of ${prepared.fee} satoshis is too low for a signed transaction of ${size} bytes. Nothing was sent.`);
  return signed;
};

/**
 * Check what the wallet signed (`checkSigned`), then send it.
 * @returns the transaction's identifier
 * @throws TooEarlyError if the network refuses it only because of its lock time
 */
export const checkAndSend = async (chain: PlainChain, prepared: Prepared, signedTransactionHex: string): Promise<string> => {
  checkSigned(prepared, signedTransactionHex);
  const transactionId = binToHex(hashTransactionUiOrder(hexToBin(signedTransactionHex)));
  const sent = await chain.broadcast(signedTransactionHex);
  if (!sent.accepted) {
    if (isTooEarly(sent.reason)) throw new TooEarlyError();
    // A transaction the network already has was sent before, for example by the wallet itself.
    if (!/already (in|known)|txn-already/i.test(sent.reason)) throw new Error(`The network refused the transaction: ${sent.reason}`);
  }
  return transactionId;
};

// ------------------------------------------------------------------ a wallet as this page works with it

export type Signer = (request: SignRequest) => Promise<string>;

/**
 * An ordinary wallet as this page works with it: its keys, a server, and a way to ask it for signatures.
 * Remembers the coins it has just spent, so that a server that has not caught up does not offer them again.
 */
export class PlainWallet {
  private readonly spent = new Set<string>();
  /** Outputs this page has just made at the wallet's addresses, which a server may not list yet. */
  private readonly made = new Map<string, Coin>();

  constructor(
    readonly chain: PlainChain,
    readonly paths: WalletPaths,
    private readonly sign: Signer,
  ) {}

  async scan(): Promise<Scan> {
    const scan = await scanWallet(this.chain, this.paths, this.spent);
    const listed = new Set([...scan.coins, ...scan.tokens].map(outpointName));
    const extra = [...this.made.values()].filter((coin) => !listed.has(outpointName(coin)) && !this.spent.has(outpointName(coin)));
    const coins = [...scan.coins, ...extra.filter((coin) => coin.output.token === undefined)];
    const tokens = [...scan.tokens, ...extra.filter((coin) => coin.output.token !== undefined)];
    const next = { ...scan.next };
    for (const coin of extra) next[coin.chain] = Math.max(next[coin.chain], coin.addressIndex + 1);
    return { coins, tokens, next, balance: coins.reduce((sum, coin) => sum + coin.output.valueSatoshis, 0n) };
  }

  async jars(scan?: Scan): Promise<PlainJar[]> {
    return findJars(this.chain, scan ?? (await this.scan()), this.spent);
  }

  /** Ask the wallet to sign, check what it signed, send it, and remember what it spent and made. */
  private async carry(prepared: Prepared, scan: Scan, progress: (step: string) => void, signing: string): Promise<string> {
    progress(signing);
    const signed = await this.sign(prepared.request);
    progress('Checking what your wallet signed, and sending it');
    const transactionId = await checkAndSend(this.chain, prepared, signed);
    for (const input of prepared.transaction.inputs) this.spent.add(`${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`);
    // The outputs at the wallet's own addresses, so that the next step can use them before a server lists them.
    const own = new Map<string, [ChainName, number]>();
    for (const name of ['receive', 'change'] as const) {
      for (let index = scan.next[name]; index < scan.next[name] + 3; index++) own.set(binToHex(addressScriptAt(this.paths[name], index)), [name, index]);
    }
    prepared.transaction.outputs.forEach((output, index) => {
      const at = own.get(binToHex(output.lockingBytecode));
      if (at !== undefined) this.made.set(`${transactionId}:${index}`, { transactionId, index, output, chain: at[0], addressIndex: at[1] });
    });
    return transactionId;
  }

  /**
   * Open a jar. If the wallet has no coin that can start a key, it is first asked to pay itself, and then
   * to sign the opening.
   * @returns the opening transaction and the key's category
   */
  async open(satoshis: bigint, unlockTime: number, progress: (step: string) => void = () => undefined): Promise<{ transactionId: string; category: string; prepared: boolean }> {
    progress('Looking at your wallet\'s coins');
    let scan = await this.scan();
    let preparedFirst = false;
    if (genesisCoin(scan) === undefined) {
      await this.carry(prepareSelfPayment(this.paths, scan, satoshis, unlockTime), scan, progress, 'Step 1 of 2: your wallet is asked to move some of its coins to another of its addresses. A jar\'s key can only be made from a coin that is the first output of its transaction, and your wallet has none.');
      preparedFirst = true;
      scan = await this.scan();
    }
    const opening = prepareOpen(this.paths, scan, satoshis, unlockTime);
    const transactionId = await this.carry(opening, scan, progress, preparedFirst ? 'Step 2 of 2: approve the opening of the jar in your wallet' : 'Approve the opening of the jar in your wallet');
    return { transactionId, category: opening.category, prepared: preparedFirst };
  }

  async deposit(jar: Pick<JarView, 'lockingBytecode' | 'unlockTime'>, satoshis: bigint, progress: (step: string) => void = () => undefined): Promise<string> {
    progress('Looking at your wallet\'s coins');
    const scan = await this.scan();
    return this.carry(prepareDeposit(this.paths, scan, jar, satoshis), scan, progress, 'Approve the payment in your wallet');
  }

  /** Empty a jar whose key the wallet holds, as it stands on chain now. */
  async withdraw(category: string, progress: (step: string) => void = () => undefined): Promise<string> {
    progress('Reading the jar');
    const scan = await this.scan();
    const jar = (await this.jars(scan)).find((candidate) => candidate.category === category);
    if (jar === undefined) throw new Error('The key of this jar is no longer in your wallet.');
    return this.carry(prepareWithdrawal(this.paths, scan, jar), scan, progress, 'Approve emptying the jar in your wallet');
  }
}
