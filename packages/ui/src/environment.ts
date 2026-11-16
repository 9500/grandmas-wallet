import type { AppChain } from '@grandmas-wallet/app';
import { linkKind } from '@grandmas-wallet/app/links';
import { Electrum } from '@grandmas-wallet/chipnet/electrum';
import { ChainPool } from '@grandmas-wallet/chipnet/pool';
import type { ChainReader } from '@grandmas-wallet/core';

/**
 * Where an application finds everything outside itself. Read from
 * `config.json` next to the page, so the same build runs in any environment.
 */
export interface Environment {
  network: string;
  /** The three applications, each on its own origin. */
  walletUrl: string;
  recovererUrl: string;
  jarUrl: string;
  /** Backup stores a new wallet uses. One is enough. */
  stores: string[];
  /** Electrum servers, the first being the one actions are checked against. Two or more for monitoring. */
  chain: string[];
  /** Relays for connections between the wallet and applications. */
  relays: string[];
  /** Address of a block explorer page for a transaction, to which the transaction's identifier is appended. */
  explorer: string;
  /** Seconds between blocks on this network, for working out when a waiting period counted in blocks ends. */
  secondsPerBlock: number;
}

export const loadEnvironment = async (): Promise<Environment> => {
  const response = await fetch('/config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('This site is not configured: config.json is missing.');
  return (await response.json()) as Environment;
};

export interface ChainConnection {
  /** All reachable servers read as one. */
  chain: AppChain;
  /** Each reachable server by itself, for the monitor. */
  servers: ChainReader[];
}

/** Connect to the configured servers. One that cannot be reached is left out; at least one is needed. */
export const connectChain = async (endpoints: string[], secondsPerBlock = 600): Promise<ChainConnection> => {
  const attempts = await Promise.allSettled(endpoints.map((endpoint) => Electrum.connect(endpoint)));
  const servers = attempts.flatMap((attempt) => (attempt.status === 'fulfilled' ? [attempt.value] : []));
  const [first] = servers;
  if (first === undefined) throw new Error('None of the network\'s servers could be reached. Check the connection and reload.');
  const pool = new ChainPool(servers);
  const chain: AppChain = {
    getTransaction: (transactionId) => pool.getTransaction(transactionId),
    getHistory: (lockingBytecode) => pool.getHistory(lockingBytecode),
    listUnspent: (lockingBytecode) => pool.listUnspent(lockingBytecode),
    tip: () => first.tip(),
    headerTime: (height) => first.headerTime(height),
    blocksPerDelayBlock: Math.max(1, Math.round(600 / secondsPerBlock)),
  };
  return { chain, servers };
};

/**
 * A link opened in a tab that already shows the page changes only the part after `#`, which does not
 * load the page again. The page is loaded again then, so that the link is dealt with from the start.
 */
export const reloadOnLink = (): void => {
  window.addEventListener('hashchange', () => {
    if (linkKind(window.location.href) !== undefined) window.location.reload();
  });
};
