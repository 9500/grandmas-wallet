import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { p2pkhLockingBytecode } from '@grandmas-wallet/core';

import { type BroadcastResult, Electrum } from './electrum.js';
import type { Chain } from './lifecycle.js';
import { type NodeRpc, nodeRpc, settingsFromBitcoinConf } from './node-rpc.js';

/**
 * The local node as a chain for a run: Fulcrum for reading and sending, the
 * node itself for making blocks and moving its clock (docs/local-node.md).
 *
 * Nothing confirms by itself on a local chain, so a block is made after every
 * transaction that is accepted, and letting time pass means moving the node's
 * clock and making blocks at the new time.
 */

export const REGTEST_PREFIX = 'bchreg';
const DEFAULT_DIRECTORY = join(homedir(), '.local/share/grandmas-wallet/regtest');
/** Blocks go to an address nobody holds, apart from the one that funds a run. */
const NOBODY = p2pkhLockingBytecode(new Uint8Array(20));
/** A block reward can be spent after this many further blocks. */
const MATURITY = 100;
/** Six of the last eleven blocks decide the chain's median time. */
const BLOCKS_TO_MOVE_MEDIAN_TIME = 6;

const regtestAddress = (lockingBytecode: Uint8Array): string => {
  const result = lockingBytecodeToCashAddress({ prefix: REGTEST_PREFIX, bytecode: lockingBytecode });
  if (typeof result === 'string') throw new Error(result);
  return result.address;
};

const pause = (milliseconds: number): Promise<void> => new Promise((done) => setTimeout(done, milliseconds));

export class LocalNode implements Chain {
  /** The node's clock, Unix seconds. Set from the chain by `open`. */
  private clock = 0;

  private constructor(
    readonly electrum: Electrum,
    readonly rpc: NodeRpc,
    readonly endpoint: string,
  ) {}

  /** @param directory - where `deploy/regtest/regtest.sh` keeps the node and Fulcrum */
  static async open(directory = process.env['REGTEST_DIR'] ?? DEFAULT_DIRECTORY): Promise<LocalNode> {
    const rpc = nodeRpc(settingsFromBitcoinConf(readFileSync(join(directory, 'node/bitcoin.conf'), 'utf8')));
    const port = /^ws\s*=\s*([\d.]+):(\d+)/m.exec(readFileSync(join(directory, 'fulcrum/fulcrum.conf'), 'utf8'));
    if (port === null) throw new Error('Fulcrum\'s configuration names no WebSocket port.');
    const endpoint = `ws://${port[1] ?? '127.0.0.1'}:${port[2] ?? ''}`;
    const { chain } = await rpc<{ chain: string }>('getblockchaininfo');
    if (chain !== 'regtest') throw new Error(`The node at ${directory} is on "${chain}", not a local test chain.`);
    const node = new LocalNode(await Electrum.connect(endpoint), rpc, endpoint);
    await node.startClock();
    return node;
  }

  /**
   * Set the node's clock to now, or to just after the chain's median time when earlier runs have moved
   * the chain ahead of the real clock.
   */
  private async startClock(): Promise<void> {
    const { mediantime } = await this.rpc<{ mediantime: number }>('getblockchaininfo');
    this.clock = Math.max(Math.floor(Date.now() / 1000), mediantime + 1);
    await this.rpc('setmocktime', this.clock);
  }

  /** Return the node to the real clock and disconnect. */
  async close(): Promise<void> {
    await this.rpc('setmocktime', 0);
    await this.electrum.disconnect();
  }

  now = (): number => this.clock * 1000;

  /** Make blocks, and wait until Fulcrum has them. */
  async mine(count: number, to: Uint8Array = NOBODY): Promise<void> {
    await this.rpc('generatetoaddress', count, regtestAddress(to));
    const height = await this.rpc<number>('getblockcount');
    for (let attempt = 0; attempt < 200; attempt++) {
      if ((await this.electrum.tip()).height >= height) return;
      await pause(50);
    }
    throw new Error(`Fulcrum did not reach block ${height}.`);
  }

  /** Let time pass on the chain: move the node's clock and make blocks at the new time. */
  sleep = async (milliseconds: number): Promise<void> => {
    this.clock += Math.ceil(milliseconds / 1000);
    await this.rpc('setmocktime', this.clock);
    await this.mine(milliseconds >= 30_000 ? BLOCKS_TO_MOVE_MEDIAN_TIME : 1);
  };

  /** Pay a block's reward to a script and make it spendable. The coin is output 0 of its transaction. */
  async fund(lockingBytecode: Uint8Array): Promise<void> {
    await this.mine(1, lockingBytecode);
    await this.mine(MATURITY);
  }

  listUnspent = (lockingBytecode: Uint8Array) => this.electrum.listUnspent(lockingBytecode);
  getTransaction = (transactionId: string) => this.electrum.getTransaction(transactionId);
  getHistory = (lockingBytecode: Uint8Array) => this.electrum.getHistory(lockingBytecode);

  broadcast = async (transactionHex: string): Promise<BroadcastResult> => {
    const result = await this.electrum.broadcast(transactionHex);
    if (result.accepted) await this.mine(1);
    return result;
  };

  /** Versions of the node and of Fulcrum, for a run's log. */
  async software(): Promise<{ node: string; server: string }> {
    const { subversion } = await this.rpc<{ subversion: string }>('getnetworkinfo');
    return { node: subversion.replaceAll('/', ''), server: this.electrum.software };
  }
}
