// What the two scripted runs of stage 17 (scripts/stage-17-jar-run.ts and scripts/stage-17-loan-run.ts) need to know
// of the chain they run on: the local node in regtest mode, or chipnet. As in run B (scripts/run-b.ts), only what a
// chain needs differs: where the first coins come from, the servers, and how blocks and the chain's clock come about.
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { hexToBin } from '@bitauth/libauth';
import { type KeyPair, type Utxo, keyPairFromPrivateKey } from '@grandmas-wallet/core';
import { XO_SUPPORTED_NETWORKS, resolveElectrumServersForNetwork } from '@xo-cash/engine';

import type { Electrum } from '../packages/chipnet/src/electrum.js';
// @ts-expect-error a plain script: the engine's settings for the local chain
import { regtestServers } from '../spikes/xo-engine/regtest.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

export type ChainName = 'local' | 'chipnet';

export interface RunArguments {
  chainName: ChainName;
  local: boolean;
  /** The part this process carries out; none for the process that drives the parts. */
  phase: string | undefined;
  /** Read the chain and say what a run would need, and send nothing (chipnet only). */
  dry: boolean;
  /** Start a new run. */
  fresh: boolean;
}

/**
 * The run's arguments: `[local|chipnet] [part] [--new] [--dry]`. Without a chain the run is on the local node, as
 * it always was. A part not among the run's own ends the process with the usage.
 */
export const runArguments = (phases: string[], script: string): RunArguments => {
  const words = process.argv.slice(2).filter((word) => !word.startsWith('--'));
  const named = words[0] === 'local' || words[0] === 'chipnet' ? words[0] : undefined;
  const [phase, ...rest] = named === undefined ? words : words.slice(1);
  if ((phase !== undefined && !phases.includes(phase)) || rest.length > 0) {
    console.error(`usage: npx tsx ../../scripts/${script} [local|chipnet] [--new] [--dry]`);
    process.exit(2);
  }
  const chainName = named ?? 'local';
  const dry = process.argv.includes('--dry');
  if (dry && chainName !== 'chipnet') {
    console.error('--dry reads chipnet; on the local node a run costs nothing and is simply run.');
    process.exit(2);
  }
  return { chainName, local: chainName === 'local', phase, dry, fresh: process.argv.includes('--new') };
};

/**
 * `--new`: the earlier run's file and stores are put aside. On the local node they are removed. On chipnet the file
 * holds the words of wallets that may still hold coins, so a new run is refused until every part of the earlier one
 * has finished, and the earlier file is then kept under another name, with its stores.
 */
export const startOver = (local: boolean, stateFile: string, storeDirectory: string, phases: string[]): void => {
  if (!existsSync(stateFile)) return;
  if (local) {
    rmSync(stateFile, { force: true });
    rmSync(storeDirectory, { recursive: true, force: true });
    return;
  }
  const earlier = JSON.parse(readFileSync(stateFile, 'utf8')) as { startedAt: string; finished: string[] };
  const unfinished = phases.filter((phase) => !earlier.finished.includes(phase));
  if (unfinished.length > 0) {
    console.error(`The run started ${earlier.startedAt} has not finished ("${unfinished[0]}" is next), and its wallets may hold coins. Continue it with the same command without --new.`);
    process.exit(1);
  }
  const stamp = earlier.startedAt.replace(/[^0-9]/g, '').slice(0, 14);
  renameSync(stateFile, stateFile.replace(/\.json$/, `-${stamp}.json`));
  if (existsSync(storeDirectory)) renameSync(storeDirectory, `${storeDirectory}-${stamp}`);
};

/** The Electrum server the run reads the chain from and sends to. */
export const electrumEndpoint = (local: boolean): string => (local ? 'ws://127.0.0.1:60403' : 'wss://chipnet.9500.cash:443');

/** The servers the engine is given. */
export const engineServers = async (local: boolean): Promise<ReturnType<typeof resolveElectrumServersForNetwork>> => {
  if (local) return (await regtestServers()) as ReturnType<typeof resolveElectrumServersForNetwork>;
  const [first] = resolveElectrumServersForNetwork(XO_SUPPORTED_NETWORKS.chipnet);
  if (first === undefined) throw new Error('the engine names no chipnet server');
  // One server. With several, the engine's network package takes the first answer to a request for a new block's
  // header, and a server that has not seen the block yet answers first, with nothing: the process ends (run B).
  return [{ host: 'chipnet.9500.cash', version: first.version, transports: { wss: 443 }, blockchain: first.blockchain }];
};

/** The saved funding key that pays for a run on chipnet and gets everything back. */
export const chipnetFunder = (): KeyPair => keyPairFromPrivateKey(hexToBin((JSON.parse(readFileSync(`${root}.chipnet/funder-design-2.json`, 'utf8')) as { privateKey: string }).privateKey));

/**
 * The coins a payment of the funder spends. On the local node all of them, as before. On chipnet, where the key
 * holds many coins and other runs pay from it too, as few as cover the payment, the largest first.
 */
export const coinsFor = (local: boolean, coins: Utxo[], paying: bigint): Utxo[] => {
  if (local) return coins;
  const chosen: Utxo[] = [];
  let held = 0n;
  for (const coin of coins.slice().sort((a, b) => (a.output.valueSatoshis > b.output.valueSatoshis ? -1 : a.output.valueSatoshis < b.output.valueSatoshis ? 1 : 0))) {
    if (held >= paying + 5_000n) break;
    chosen.push(coin);
    held += coin.output.valueSatoshis;
  }
  return chosen;
};

/** The chain's clock at a height: the median of the times of the last eleven blocks. */
export const medianTime = async (server: Electrum, height: number): Promise<number> => {
  const times = await Promise.all(Array.from({ length: 11 }, (_, back) => server.headerTime(Math.max(height - back, 0))));
  return times.sort((a, b) => a - b)[5] as number;
};

/** A time as the record shows it. */
export const iso = (seconds: number): string => new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');
