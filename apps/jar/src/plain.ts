import {
  type Output,
  type TransactionCommon,
  bigIntToVmNumber,
  binToHex,
  decodeHdPublicKey,
  decodeTransactionBch,
  deriveHdPublicNodeChild,
  encodeDataPush,
  encodeLockingBytecodeP2pkh,
  encodeLockingBytecodeP2sh32,
  encodeTransactionBch,
  flattenBinArray,
  hash160,
  hash256,
  hexToBin,
  utf8ToBin,
  vmNumberToBigInt,
} from '@bitauth/libauth';
import { keyJarArtifact, keyJarBytecodeHex } from '@grandmas-wallet/contracts/keyJar';
import { verifyTransaction } from '@grandmas-wallet/core';

/**
 * Savings jars for an ordinary wallet.
 *
 * The wallet shares the public keys of its address chains and signs what it
 * is asked to; everything else happens here. This application finds the
 * wallet's coins, builds each transaction, asks the wallet for signatures,
 * checks what comes back and sends it.
 *
 * A jar is a script that pays to one of the wallet's keys after a time. Each
 * deposit carries a small note saying when its jar unlocks, so that the jars
 * can be found again from the wallet's history alone.
 */

/** The names a wallet gives its address chains in a WizardConnect session. */
export type PathName = 'receive' | 'change' | 'defi';
export type WalletPaths = Record<PathName, string>;

/** The key every jar of a wallet is locked to. */
export const JAR_KEY: { path: PathName; index: number } = { path: 'defi', index: 0 };

/** What this application needs from a server. */
export interface PlainChain {
  getTransaction(transactionId: string): Promise<string | undefined>;
  getHistory(lockingBytecode: Uint8Array): Promise<{ transactionId: string; height: number }[]>;
  listUnspent(lockingBytecode: Uint8Array): Promise<{ transactionId: string; index: number; valueSatoshis: bigint; height: number; hasToken: boolean }[]>;
  broadcast(transactionHex: string): Promise<{ accepted: true; transactionId: string } | { accepted: false; reason: string }>;
}

export interface Coin {
  transactionId: string;
  index: number;
  valueSatoshis: bigint;
  lockingBytecode: Uint8Array;
  path: PathName;
  addressIndex: number;
}

export interface PlainJar {
  unlockTime: number;
  lockingBytecode: Uint8Array;
  redeemBytecode: Uint8Array;
  /** Unspent outputs at the jar's address. */
  outputs: { transactionId: string; index: number; valueSatoshis: bigint }[];
  held: bigint;
}

/** One input the wallet is asked to sign, as WizardConnect names it: input, chain, address number. */
export type InputPath = [number, PathName, number];

/** A request for signatures, in the form wallets expect on the wire: bytes as hex, amounts as `<bigint: Nn>`. */
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

const DUST = 546n;
/** Signature (65) and public key (33), each with its length byte. Wallets that sign with ECDSA need a few bytes more. */
const SIGNED_INPUT_BYTES = 100;
const SIGNATURE_ALLOWANCE = 8n;
const NOTE_TAG = utf8ToBin('SJAR');
const GAP = 20;
const LOCKTIME_ENABLED = 0xfffffffe;
/** Before this, a transaction's lock time is a block height and not a time. */
const EARLIEST_TIME = 500_000_000;

const SIGNATURE_PLACEHOLDER = new Uint8Array(65);
const PUBLIC_KEY_PLACEHOLDER = new Uint8Array(33);

/** The smallest jar: it has to pay the fee for emptying it and leave something worth having. */
export const SMALLEST_JAR = 2_000n;

export const readPaths = (paths: { name: string; xpub: string }[]): WalletPaths => {
  const find = (name: PathName): string => {
    const found = paths.find((path) => path.name === name)?.xpub;
    if (found === undefined) throw new Error(`The wallet did not share its "${name}" addresses.`);
    return found;
  };
  return { receive: find('receive'), change: find('change'), defi: find('defi') };
};

/** Whether the wallet's keys are for the main network or a test network. */
export const networkOf = (paths: WalletPaths): 'mainnet' | 'testnet' => {
  const decoded = decodeHdPublicKey(paths.receive);
  if (typeof decoded === 'string') throw new Error(`The wallet's public key cannot be read: ${decoded}`);
  return decoded.network;
};

export const publicKeyAt = (xpub: string, index: number): Uint8Array => {
  const decoded = decodeHdPublicKey(xpub);
  if (typeof decoded === 'string') throw new Error(`The wallet's public key cannot be read: ${decoded}`);
  const child = deriveHdPublicNodeChild(decoded.node, index);
  if (typeof child === 'string') throw new Error(child);
  return child.publicKey;
};

export const addressScriptAt = (xpub: string, index: number): Uint8Array => encodeLockingBytecodeP2pkh(hash160(publicKeyAt(xpub, index)));

/** The jar of a key for an unlock time. */
export const jarScript = (ownerPublicKey: Uint8Array, unlockTime: number): { redeemBytecode: Uint8Array; lockingBytecode: Uint8Array } => {
  if (!Number.isInteger(unlockTime) || unlockTime < EARLIEST_TIME || unlockTime > 0xffffffff) throw new Error('The unlock time is not a time this network can enforce.');
  // The compiled contract preceded by its arguments, last argument first.
  const redeemBytecode = flattenBinArray([encodeDataPush(bigIntToVmNumber(BigInt(unlockTime))), encodeDataPush(hash160(ownerPublicKey)), hexToBin(keyJarBytecodeHex)]);
  return { redeemBytecode, lockingBytecode: encodeLockingBytecodeP2sh32(hash256(redeemBytecode)) };
};

export const jarKey = (paths: WalletPaths): Uint8Array => publicKeyAt(paths[JAR_KEY.path], JAR_KEY.index);

/** The note a deposit carries: which unlock time its jar has. */
const noteFor = (unlockTime: number): Uint8Array =>
  flattenBinArray([Uint8Array.of(0x6a), encodeDataPush(NOTE_TAG), encodeDataPush(bigIntToVmNumber(BigInt(unlockTime)))]);

const readNote = (lockingBytecode: Uint8Array): number | undefined => {
  const prefix = flattenBinArray([Uint8Array.of(0x6a), encodeDataPush(NOTE_TAG)]);
  if (lockingBytecode.length <= prefix.length + 1 || !prefix.every((byte, index) => lockingBytecode[index] === byte)) return undefined;
  const length = lockingBytecode[prefix.length] ?? 0;
  const body = lockingBytecode.slice(prefix.length + 1);
  if (length < 1 || length > 5 || body.length !== length) return undefined;
  const value = vmNumberToBigInt(body, { requireMinimalEncoding: false });
  return typeof value === 'string' || value < BigInt(EARLIEST_TIME) || value > 0xffffffffn ? undefined : Number(value);
};

export interface Scan {
  coins: Coin[];
  balance: bigint;
  /** The first address of each chain that has never been used. */
  next: { receive: number; change: number };
  /** Every transaction seen at the wallet's addresses, newest last. */
  history: string[];
}

/** Find the wallet's coins by walking its address chains until twenty in a row have never been used. */
export const scanWallet = async (chain: PlainChain, paths: WalletPaths): Promise<Scan> => {
  const coins: Coin[] = [];
  const seen = new Map<string, number>();
  const next = { receive: 0, change: 0 };
  for (const path of ['receive', 'change'] as const) {
    let unused = 0;
    let firstUnused: number | undefined;
    for (let index = 0; unused < GAP; index += GAP) {
      const batch = Array.from({ length: GAP }, (_, offset) => index + offset);
      const found = await Promise.all(
        batch.map(async (addressIndex) => {
          const lockingBytecode = addressScriptAt(paths[path], addressIndex);
          const history = await chain.getHistory(lockingBytecode);
          return { addressIndex, lockingBytecode, history, unspent: history.length === 0 ? [] : await chain.listUnspent(lockingBytecode) };
        }),
      );
      for (const { addressIndex, lockingBytecode, history, unspent } of found) {
        if (history.length === 0) {
          firstUnused ??= addressIndex;
          unused += 1;
          continue;
        }
        firstUnused = undefined;
        unused = 0;
        for (const entry of history) seen.set(entry.transactionId, entry.height > 0 ? entry.height : Number.MAX_SAFE_INTEGER);
        for (const entry of unspent) {
          // Tokens are left alone: this application only moves plain coins.
          if (!entry.hasToken) coins.push({ transactionId: entry.transactionId, index: entry.index, valueSatoshis: entry.valueSatoshis, lockingBytecode, path, addressIndex });
        }
      }
    }
    next[path] = firstUnused ?? 0;
  }
  return {
    coins,
    balance: coins.reduce((sum, coin) => sum + coin.valueSatoshis, 0n),
    next,
    history: [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([transactionId]) => transactionId),
  };
};

/**
 * Unlock times of the jars this wallet paid into, read from the notes in its own transactions.
 * @param limit - how many of the newest transactions to read
 */
export const findUnlockTimes = async (chain: PlainChain, paths: WalletPaths, history: string[], limit = 400): Promise<number[]> => {
  const key = jarKey(paths);
  const found = new Set<number>();
  for (const transactionId of history.slice(-limit)) {
    const hex = await chain.getTransaction(transactionId);
    const transaction = hex === undefined ? 'unknown' : decodeTransactionBch(hexToBin(hex));
    if (typeof transaction === 'string') continue;
    for (const output of transaction.outputs) {
      const unlockTime = readNote(output.lockingBytecode);
      if (unlockTime === undefined) continue;
      // The note counts only next to a payment to the jar it speaks of.
      const jar = binToHex(jarScript(key, unlockTime).lockingBytecode);
      if (transaction.outputs.some((other) => binToHex(other.lockingBytecode) === jar)) found.add(unlockTime);
    }
  }
  return [...found].sort((a, b) => a - b);
};

export const loadJar = async (chain: PlainChain, paths: WalletPaths, unlockTime: number): Promise<PlainJar> => {
  const { redeemBytecode, lockingBytecode } = jarScript(jarKey(paths), unlockTime);
  const outputs = (await chain.listUnspent(lockingBytecode)).filter((entry) => !entry.hasToken).map(({ transactionId, index, valueSatoshis }) => ({ transactionId, index, valueSatoshis }));
  return { unlockTime, lockingBytecode, redeemBytecode, outputs, held: outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n) };
};

const amount = (satoshis: bigint): string => `<bigint: ${satoshis}n>`;

interface Spend {
  transactionId: string;
  index: number;
  valueSatoshis: bigint;
  lockingBytecode: Uint8Array;
  /** What stands in for the unlocking script until the wallet has signed. */
  unlockingBytecode: Uint8Array;
  /** Bytes the unlocking script will have once signed. */
  signedBytes: number;
  path: InputPath[1];
  addressIndex: number;
  contract?: { redeemBytecode: Uint8Array };
}

/** @returns the request, and the size in bytes the transaction will have once signed */
const assemble = (spends: Spend[], outputs: Output[], locktime: number, userPrompt: string): Prepared & { size: bigint } => {
  const transaction: TransactionCommon = {
    version: 2,
    locktime,
    inputs: spends.map((spend) => ({
      outpointTransactionHash: hexToBin(spend.transactionId),
      outpointIndex: spend.index,
      sequenceNumber: LOCKTIME_ENABLED,
      unlockingBytecode: spend.unlockingBytecode,
    })),
    outputs,
  };
  const sourceOutputs: Output[] = spends.map((spend) => ({ lockingBytecode: spend.lockingBytecode, valueSatoshis: spend.valueSatoshis }));
  const unsigned = encodeTransactionBch(transaction).length;
  const size = BigInt(unsigned + spends.reduce((sum, spend) => sum + spend.signedBytes - spend.unlockingBytecode.length, 0));
  const fee = sourceOutputs.reduce((sum, output) => sum + output.valueSatoshis, 0n) - outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n);
  return {
    transaction,
    sourceOutputs,
    fee,
    size,
    request: {
      transaction: {
        transaction: binToHex(encodeTransactionBch(transaction)),
        sourceOutputs: spends.map((spend) => ({
          outpointIndex: spend.index,
          outpointTransactionHash: spend.transactionId,
          sequenceNumber: LOCKTIME_ENABLED,
          unlockingBytecode: binToHex(spend.unlockingBytecode),
          lockingBytecode: binToHex(spend.lockingBytecode),
          valueSatoshis: amount(spend.valueSatoshis),
          ...(spend.contract === undefined
            ? {}
            : { contract: { abiFunction: keyJarArtifact.abi[0], redeemScript: binToHex(spend.contract.redeemBytecode), artifact: keyJarArtifact } }),
        })),
        broadcast: false,
        userPrompt,
      },
      inputPaths: spends.map((spend, index) => [index, spend.path, spend.addressIndex]),
    },
  };
};

/** The fee a transaction of these inputs and outputs needs, from its size once signed. */
const feeFor = (spends: Spend[], outputs: Output[], locktime: number): bigint => assemble(spends, outputs, locktime, '').size + SIGNATURE_ALLOWANCE * BigInt(spends.length);

const coinSpend = (coin: Coin): Spend => ({ ...coin, unlockingBytecode: new Uint8Array(), signedBytes: SIGNED_INPUT_BYTES });

const when = (unlockTime: number): string => `${new Date(unlockTime * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/**
 * A payment from the wallet's coins into a jar.
 * @throws if the coins do not cover the amount and the fee
 */
export const prepareDeposit = (paths: WalletPaths, scan: Scan, satoshis: bigint, unlockTime: number, label = 'Savings jar'): Prepared => {
  if (satoshis < SMALLEST_JAR) throw new Error(`A jar needs at least ${SMALLEST_JAR} satoshis, so that it can pay the network fee when it is emptied.`);
  const jar = jarScript(jarKey(paths), unlockTime);
  const change = addressScriptAt(paths.change, scan.next.change);
  const prompt = `Put ${satoshis} satoshis into the savings jar "${label}", locked until ${when(unlockTime)}`;
  const paid: Output[] = [
    { lockingBytecode: jar.lockingBytecode, valueSatoshis: satoshis },
    { lockingBytecode: noteFor(unlockTime), valueSatoshis: 0n },
  ];
  const coins = [...scan.coins].sort((a, b) => (a.valueSatoshis < b.valueSatoshis ? 1 : a.valueSatoshis > b.valueSatoshis ? -1 : 0));
  // Take the largest coins first until the amount and the fee are covered.
  for (let count = 1; count <= coins.length; count++) {
    const chosen = coins.slice(0, count).map(coinSpend);
    const left = chosen.reduce((sum, coin) => sum + coin.valueSatoshis, 0n) - satoshis;
    if (left < 0n) continue;
    const returned = left - feeFor(chosen, [...paid, { lockingBytecode: change, valueSatoshis: DUST }], 0);
    if (returned >= DUST) return assemble(chosen, [...paid, { lockingBytecode: change, valueSatoshis: returned }], 0, prompt);
    // Too little would come back to be worth an output; it goes to the fee, if it covers one.
    if (left >= feeFor(chosen, paid, 0)) return assemble(chosen, paid, 0, prompt);
  }
  throw new Error(`The wallet's coins (${scan.balance} satoshis) do not cover ${satoshis} satoshis and the network fee.`);
};

/**
 * Empty a jar into the wallet's next receiving address.
 * @throws if the jar holds too little to pay the fee
 */
export const prepareWithdrawal = (paths: WalletPaths, scan: Pick<Scan, 'next'>, jar: PlainJar, label = 'Savings jar'): Prepared => {
  if (jar.outputs.length === 0) throw new Error('The savings jar is empty.');
  const unlockingBytecode = flattenBinArray([encodeDataPush(SIGNATURE_PLACEHOLDER), encodeDataPush(PUBLIC_KEY_PLACEHOLDER), encodeDataPush(jar.redeemBytecode)]);
  const spends: Spend[] = jar.outputs.slice(0, 40).map((output) => ({
    ...output,
    lockingBytecode: jar.lockingBytecode,
    unlockingBytecode,
    signedBytes: unlockingBytecode.length,
    path: JAR_KEY.path,
    addressIndex: JAR_KEY.index,
    contract: { redeemBytecode: jar.redeemBytecode },
  }));
  const total = spends.reduce((sum, spend) => sum + spend.valueSatoshis, 0n);
  const destination = addressScriptAt(paths.receive, scan.next.receive);
  const received = total - feeFor(spends, [{ lockingBytecode: destination, valueSatoshis: DUST }], jar.unlockTime);
  if (received < DUST) throw new Error('The savings jar holds too little to pay the network fee for emptying it.');
  return assemble(spends, [{ lockingBytecode: destination, valueSatoshis: received }], jar.unlockTime, `Empty the savings jar "${label}" (${total} satoshis) into your wallet`);
};

/** The network refused a transaction because its time has not yet come. */
export class TooEarlyError extends Error {
  constructor() {
    super('The network does not accept this yet. Its clock runs some minutes behind; please try again shortly.');
    this.name = 'TooEarlyError';
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, index) => b[index] === byte);

/**
 * Check what the wallet signed, then send it. The wallet may only have filled in unlocking scripts: the
 * coins spent and every output must be exactly what was asked for, and every input must pass the
 * network's script rules.
 *
 * @throws TooEarlyError if the network refuses it only because of a time lock
 */
export const checkAndSend = async (chain: PlainChain, prepared: Prepared, signedTransactionHex: string): Promise<string> => {
  const signed = decodeTransactionBch(hexToBin(signedTransactionHex));
  if (typeof signed === 'string') throw new Error(`The wallet returned something that is not a transaction: ${signed}`);
  const asked = prepared.transaction;
  const unchanged =
    signed.version === asked.version &&
    signed.locktime === asked.locktime &&
    signed.inputs.length === asked.inputs.length &&
    signed.outputs.length === asked.outputs.length &&
    signed.inputs.every((input, index) => {
      const wanted = asked.inputs[index];
      return wanted !== undefined && input.outpointIndex === wanted.outpointIndex && input.sequenceNumber === wanted.sequenceNumber && sameBytes(input.outpointTransactionHash, wanted.outpointTransactionHash);
    }) &&
    signed.outputs.every((output, index) => {
      const wanted = asked.outputs[index];
      return wanted !== undefined && output.token === undefined && output.valueSatoshis === wanted.valueSatoshis && sameBytes(output.lockingBytecode, wanted.lockingBytecode);
    });
  if (!unchanged) throw new Error('The wallet returned a different transaction from the one it was asked to sign. Nothing was sent.');
  const check = verifyTransaction({ transaction: signed, sourceOutputs: prepared.sourceOutputs });
  if (check !== true) throw new Error(`The signed transaction does not pass the network's rules: ${check}`);
  const size = BigInt(signedTransactionHex.length / 2);
  if (prepared.fee < size) throw new Error(`The fee of ${prepared.fee} satoshis is too low for a transaction of ${size} bytes.`);
  const sent = await chain.broadcast(signedTransactionHex);
  if (!sent.accepted) {
    if (/non-?final/i.test(sent.reason)) throw new TooEarlyError();
    // A transaction the network already has was sent before, for example by the wallet itself.
    if (!/already (in|known)|txn-already/i.test(sent.reason)) throw new Error(`The network refused the transaction: ${sent.reason}`);
  }
  return binToHex(hash256(hexToBin(signedTransactionHex)).reverse());
};
