// What a scripted course in a browser did on the local node, read from the chain afterwards: every transaction of
// the run, with its size and fee, and where every coin it made ended up. Nobody else uses the local chain while a
// course runs, so every transaction in the blocks made since the course started, and in the node's pool, is the
// run's own. The course names what it can; the rest is named here from the addresses it touches.
import { execFileSync } from 'node:child_process';

import { binToHex, decodeTransactionBch, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';

import { Electrum } from '../packages/chipnet/src/electrum.js';
import { root } from './browser-course.js';

const cli = (...parameters: string[]): string => execFileSync(`${root}deploy/regtest/regtest.sh`, ['cli', ...parameters], { encoding: 'utf8' }).trim();

/** The height of the local chain's last block. */
export const localHeight = (): number => Number(cli('getblockcount'));

export interface LedgerOutput {
  index: number;
  valueSatoshis: bigint;
  lockingBytecode: string;
  token?: { category: string; amount: bigint; nft?: { capability: string; commitment: string } };
  /** Whether the output was still unspent when the ledger was read, with the node's pool counted. */
  unspent: boolean;
}

export interface LedgerInput {
  outpoint: string;
  valueSatoshis: bigint;
  lockingBytecode: string;
  token?: LedgerOutput['token'];
}

export interface LedgerTransaction {
  transactionId: string;
  /** The block that holds it; 0 for one still in the node's pool. */
  height: number;
  bytes: number;
  feeSatoshis: bigint;
  inputs: LedgerInput[];
  outputs: LedgerOutput[];
}

const tokenOf = (token: { category: Uint8Array; amount: bigint; nft?: { capability: string; commitment: Uint8Array } } | undefined): LedgerOutput['token'] =>
  token === undefined ? undefined : { category: binToHex(token.category), amount: token.amount, ...(token.nft === undefined ? {} : { nft: { capability: token.nft.capability, commitment: binToHex(token.nft.commitment) } }) };

/**
 * Every transaction of the run that is not a block reward: those in the blocks after `afterHeight`, then those in the
 * node's pool, in the order of the chain.
 */
export const runTransactions = async (afterHeight: number): Promise<LedgerTransaction[]> => {
  const server = await Electrum.connect('ws://127.0.0.1:60403');
  try {
    const decoded = new Map<string, ReturnType<typeof decodeTransactionBch>>();
    const read = async (transactionId: string) => {
      const known = decoded.get(transactionId);
      if (known !== undefined) return known;
      const text = await server.getTransaction(transactionId);
      if (text === undefined) throw new Error(`the server does not know ${transactionId}`);
      const transaction = decodeTransactionBch(hexToBin(text));
      if (typeof transaction === 'string') throw new Error(transaction);
      decoded.set(transactionId, transaction);
      return transaction;
    };
    const listed: { transactionId: string; height: number }[] = [];
    const tip = localHeight();
    for (let height = afterHeight + 1; height <= tip; height += 1) {
      const block = JSON.parse(cli('getblock', cli('getblockhash', String(height)), '1')) as { tx: string[] };
      for (const transactionId of block.tx.slice(1)) listed.push({ transactionId, height });
    }
    for (const transactionId of JSON.parse(cli('getrawmempool')) as string[]) listed.push({ transactionId, height: 0 });
    const ledger: LedgerTransaction[] = [];
    for (const { transactionId, height } of listed) {
      const transaction = await read(transactionId);
      if (typeof transaction === 'string') throw new Error(transaction);
      const inputs: LedgerInput[] = [];
      for (const input of transaction.inputs) {
        const from = binToHex(input.outpointTransactionHash);
        const earlier = await read(from);
        if (typeof earlier === 'string') throw new Error(earlier);
        const spent = earlier.outputs[input.outpointIndex];
        if (spent === undefined) throw new Error(`${transactionId} spends an output that does not exist`);
        const token = tokenOf(spent.token);
        inputs.push({ outpoint: `${from}:${input.outpointIndex}`, valueSatoshis: spent.valueSatoshis, lockingBytecode: binToHex(spent.lockingBytecode), ...(token === undefined ? {} : { token }) });
      }
      const outputs = transaction.outputs.map((output, index): LedgerOutput => {
        const token = tokenOf(output.token);
        const unspent = cli('gettxout', transactionId, String(index), 'true') !== '';
        return { index, valueSatoshis: output.valueSatoshis, lockingBytecode: binToHex(output.lockingBytecode), ...(token === undefined ? {} : { token }), unspent };
      });
      const paid = outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n);
      const spent = inputs.reduce((sum, input) => sum + input.valueSatoshis, 0n);
      const text = (await server.getTransaction(transactionId)) as string;
      ledger.push({ transactionId, height, bytes: text.length / 2, feeSatoshis: spent - paid, inputs, outputs });
    }
    return ledger;
  } finally {
    await server.disconnect();
  }
};

/** A locking bytecode as a regtest address, for the record. */
export const addressOf = (lockingBytecode: string): string => {
  const made = lockingBytecodeToCashAddress({ prefix: 'bchreg', bytecode: hexToBin(lockingBytecode) });
  return typeof made === 'string' ? `script ${lockingBytecode.slice(0, 16)}…` : made.address;
};

const sat = (value: bigint): string => `${value.toLocaleString('en-US')} sat`;

/** A token, briefly. */
export const tokenWords = (token: LedgerOutput['token']): string =>
  token === undefined ? '' : `${token.nft === undefined ? '' : `an NFT (${token.nft.capability}${token.nft.commitment === '' ? '' : `, commitment ${token.nft.commitment.slice(0, 16)}${token.nft.commitment.length > 16 ? '…' : ''}`})`}${token.nft !== undefined && token.amount > 0n ? ' and ' : ''}${token.amount > 0n ? `${token.amount} units` : ''} of category ${token.category.slice(0, 12)}…`;

/**
 * The record's part about the transactions and the coins: a table of every transaction, what came into the run
 * from outside it, and where every output that is still unspent sits, by the names `placeOf` gives.
 * @param labelOf - what a transaction was, as the course knew it; `undefined` where it did not
 * @param placeOf - whose a locking bytecode is; `undefined` where nobody of the run knows it
 */
export const ledgerSection = (ledger: LedgerTransaction[], labelOf: (transaction: LedgerTransaction) => string | undefined, placeOf: (lockingBytecode: string) => string | undefined): string[] => {
  const made = new Set(ledger.map((transaction) => transaction.transactionId));
  const lines: string[] = [
    '| # | What | Transaction | Block | Bytes | Fee (sat) | Sat per byte |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...ledger.map((transaction, index) => `| ${index + 1} | ${labelOf(transaction) ?? '(not named)'} | \`${transaction.transactionId}\` | ${transaction.height === 0 ? 'not in a block' : transaction.height} | ${transaction.bytes} | ${transaction.feeSatoshis} | ${(Number(transaction.feeSatoshis) / transaction.bytes).toFixed(2)} |`),
    '',
    `${ledger.length} transactions, ${ledger.reduce((sum, transaction) => sum + transaction.bytes, 0)} bytes, ${sat(ledger.reduce((sum, transaction) => sum + transaction.feeSatoshis, 0n))} in fees.`,
    '',
  ];
  // What came in: inputs that no transaction of the run made.
  const cameIn = new Map<string, bigint>();
  for (const transaction of ledger) {
    for (const input of transaction.inputs) {
      if (made.has(input.outpoint.split(':')[0] as string)) continue;
      const place = placeOf(input.lockingBytecode) ?? addressOf(input.lockingBytecode);
      cameIn.set(place, (cameIn.get(place) ?? 0n) + input.valueSatoshis);
    }
  }
  const inTotal = [...cameIn.values()].reduce((sum, value) => sum + value, 0n);
  lines.push('What came into the run, from coins no transaction of the run made:', '', ...[...cameIn].map(([place, value]) => `- ${sat(value)} from ${place}`), '');
  // Where it went: every output of the run still unspent, by place.
  const left = new Map<string, { value: bigint; coins: number; tokens: string[] }>();
  for (const transaction of ledger) {
    for (const output of transaction.outputs) {
      if (!output.unspent) continue;
      const place = placeOf(output.lockingBytecode) ?? `${addressOf(output.lockingBytecode)} (not named)`;
      const entry = left.get(place) ?? { value: 0n, coins: 0, tokens: [] };
      entry.value += output.valueSatoshis;
      entry.coins += 1;
      if (output.token !== undefined) entry.tokens.push(tokenWords(output.token));
      left.set(place, entry);
    }
  }
  const outTotal = [...left.values()].reduce((sum, entry) => sum + entry.value, 0n);
  const fees = ledger.reduce((sum, transaction) => sum + transaction.feeSatoshis, 0n);
  lines.push(
    'Where every coin went: the outputs of the run that nothing has spent, by whose they are:',
    '',
    '| Where | Coins | Value | Tokens on them |',
    '| --- | --- | --- | --- |',
    ...[...left].map(([place, entry]) => `| ${place} | ${entry.coins} | ${sat(entry.value)} | ${entry.tokens.length === 0 ? '' : entry.tokens.join('; ')} |`),
    '',
    `${sat(inTotal)} came in; ${sat(outTotal)} is in these outputs and ${sat(fees)} went to fees${inTotal === outTotal + fees ? ', which adds up' : `, which does NOT add up (${sat(inTotal - outTotal - fees)} unaccounted)`}.`,
    '',
  );
  return lines;
};
