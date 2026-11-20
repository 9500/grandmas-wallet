// What a scripted course in a browser did, read from the chain afterwards: every transaction of the run, with its
// size and fee, and where every coin it made ended up. Nobody else uses the local chain while a course runs, so there
// every transaction in the blocks made since the course started, and in the node's pool, is the run's own. On chipnet
// others use the chain too: there the run's transactions are those since it started that touch an address of the run.
// The course names what it can; the rest is named here from the addresses it touches.
import { execFileSync } from 'node:child_process';

import { binToHex, decodeTransactionBch, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';

import { Electrum } from '../packages/chipnet/src/electrum.js';
import { chipnet, config, root } from './browser-course.js';

const cli = (...parameters: string[]): string => execFileSync(`${root}deploy/regtest/regtest.sh`, ['cli', ...parameters], { encoding: 'utf8' }).trim();

/** The height of the local chain's last block. */
export const localHeight = (): number => Number(cli('getblockcount'));

/** The chain's server the course reads: the local node's, or the first the configuration names on chipnet. */
export const chainServer = (): Promise<Electrum> => Electrum.connect(chipnet ? (config.chain[0] as string) : 'ws://127.0.0.1:60403');

/** The height of the chain's last block, on the local node or on chipnet. */
export const chainHeight = async (): Promise<number> => {
  if (!chipnet) return localHeight();
  const server = await chainServer();
  try {
    return (await server.tip()).height;
  } finally {
    await server.disconnect();
  }
};

/** The time of the chain's last block and the median time of the last eleven, which a transaction's lock time is compared with. */
export const chainClock = async (): Promise<{ tip: number; median: number }> => {
  const server = await chainServer();
  try {
    const { height } = await server.tip();
    const times = await Promise.all(Array.from({ length: 11 }, (_, back) => server.headerTime(height - back)));
    return { tip: times[0] as number, median: [...times].sort((a, b) => a - b)[5] as number };
  } finally {
    await server.disconnect();
  }
};

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
 * node's pool, in the order of the chain. On chipnet, those after `afterHeight` or not yet in a block that touch one
 * of `places` (locking bytecodes as hex), read from the server's history of each.
 */
export const runTransactions = async (afterHeight: number, places: string[] = []): Promise<LedgerTransaction[]> => {
  const server = await chainServer();
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
    if (chipnet) {
      const found = new Map<string, number>();
      for (const place of new Set(places.filter((bytecode) => bytecode !== ''))) {
        for (const entry of await server.getHistory(hexToBin(place))) {
          if (entry.height > afterHeight || entry.height <= 0) found.set(entry.transactionId, entry.height <= 0 ? 0 : entry.height);
        }
      }
      // In the order of the chain: by block, those not in a block last, and within a block a transaction after those it spends.
      const ids = [...found.keys()];
      const byBlock = (a: string, b: string): number => ((found.get(a) || Infinity) as number) - ((found.get(b) || Infinity) as number);
      ids.sort(byBlock);
      const ordered: string[] = [];
      const visit = async (transactionId: string, seen: Set<string>): Promise<void> => {
        if (ordered.includes(transactionId) || seen.has(transactionId)) return;
        seen.add(transactionId);
        const transaction = await read(transactionId);
        if (typeof transaction === 'string') throw new Error(transaction);
        for (const input of transaction.inputs) {
          const from = binToHex(input.outpointTransactionHash);
          if (found.has(from) && found.get(from) === found.get(transactionId)) await visit(from, seen);
        }
        ordered.push(transactionId);
      };
      for (const transactionId of ids) await visit(transactionId, new Set());
      for (const transactionId of ordered) listed.push({ transactionId, height: found.get(transactionId) as number });
    } else {
      const tip = localHeight();
      for (let height = afterHeight + 1; height <= tip; height += 1) {
        const block = JSON.parse(cli('getblock', cli('getblockhash', String(height)), '1')) as { tx: string[] };
        for (const transactionId of block.tx.slice(1)) listed.push({ transactionId, height });
      }
      for (const transactionId of JSON.parse(cli('getrawmempool')) as string[]) listed.push({ transactionId, height: 0 });
    }
    /** What is unspent at a locking bytecode, as the server lists it, for the chipnet ledger. */
    const unspentAt = new Map<string, Set<string>>();
    const isUnspent = async (transactionId: string, index: number, lockingBytecode: Uint8Array): Promise<boolean> => {
      if (!chipnet) return cli('gettxout', transactionId, String(index), 'true') !== '';
      const key = binToHex(lockingBytecode);
      let known = unspentAt.get(key);
      if (known === undefined) {
        known = new Set((await server.listUnspent(lockingBytecode)).map((entry) => `${entry.transactionId}:${entry.index}`));
        unspentAt.set(key, known);
      }
      return known.has(`${transactionId}:${index}`);
    };
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
      const outputs: LedgerOutput[] = [];
      for (const [index, output] of transaction.outputs.entries()) {
        const token = tokenOf(output.token);
        // A data output can never be spent, and is not listed by a server.
        const unspent = output.lockingBytecode[0] === 0x6a ? false : await isUnspent(transactionId, index, output.lockingBytecode);
        outputs.push({ index, valueSatoshis: output.valueSatoshis, lockingBytecode: binToHex(output.lockingBytecode), ...(token === undefined ? {} : { token }), unspent });
      }
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

/** A locking bytecode as an address of the course's chain, for the record. */
export const addressOf = (lockingBytecode: string): string => {
  const made = lockingBytecodeToCashAddress({ prefix: chipnet ? 'bchtest' : 'bchreg', bytecode: hexToBin(lockingBytecode) });
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
  // Where it went: every output that no transaction of the run spent, by place: still unspent, or spent since by a
  // transaction that is not the run's (on chipnet, the funding address spends its change in its next payment).
  const spentByRun = new Set(ledger.flatMap((transaction) => transaction.inputs.map((input) => input.outpoint)));
  const left = new Map<string, { value: bigint; coins: number; tokens: string[] }>();
  for (const transaction of ledger) {
    for (const output of transaction.outputs) {
      if (spentByRun.has(`${transaction.transactionId}:${output.index}`) || output.lockingBytecode.startsWith('6a')) continue;
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
    'Where every coin went: the outputs that no transaction of the run spent, by whose they are (an output at the funding address may have been spent since by its next payment):',
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
