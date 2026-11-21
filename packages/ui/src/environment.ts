import type { AppChain, RegistriesConfig } from '@grandmas-wallet/app';
import { linkKind } from '@grandmas-wallet/app/links';
import { Electrum } from '@grandmas-wallet/chipnet/electrum';
import { ChainPool } from '@grandmas-wallet/chipnet/pool';
import type { ChainReader } from '@grandmas-wallet/core';

import { confirmMainnet } from './mainnet.js';

/**
 * Where an application finds everything outside itself. Read from
 * `config.json` next to the page, so the same build runs in any environment.
 */
export interface Environment {
  network: string;
  /** The wallet and the recoverer, each on its own origin. */
  walletUrl: string;
  recovererUrl: string;
  /** Backup stores a new wallet uses. One is enough. */
  stores: string[];
  /** Electrum servers, the first being the one actions are checked against. Two or more for monitoring. */
  chain: string[];
  /** Relays for connections between the wallet and applications, and between the wallet and a recoverer's page. */
  relays: string[];
  /** Address of a block explorer page for a transaction, to which the transaction's identifier is appended. */
  explorer: string;
  /** Seconds between blocks on this network, for working out when a waiting period counted in blocks ends. */
  secondsPerBlock: number;
  /**
   * Allows `"network": "mainnet"`. Without it a page configured for mainnet does not start. Only the configuration
   * file a page is served with carries it; nothing on the page turns it on.
   */
  mainnetEnabled?: boolean;
  /** Token names from registries checked against the chain (`chain`), or none (`off`, or no entry). */
  registries?: RegistriesConfig;
}

/** A configuration for mainnet that does not carry the parameter allowing it. */
export class MainnetNotEnabledError extends Error {
  constructor() {
    super('This page is configured for the main network of Bitcoin Cash, where coins have real value, but its configuration does not allow it ("mainnetEnabled": true). It does not start.');
    this.name = 'MainnetNotEnabledError';
  }
}

/**
 * Check a page's configuration as read from `config.json`.
 *
 * @throws MainnetNotEnabledError for `"network": "mainnet"` without `"mainnetEnabled": true`
 */
export const readEnvironment = (config: unknown): Environment => {
  if (typeof config !== 'object' || config === null) throw new Error('This site is not configured: config.json is not an object.');
  const environment = config as Environment;
  if (typeof environment.network !== 'string') throw new Error('This site is not configured: config.json names no network.');
  if (environment.network === 'mainnet' && environment.mainnetEnabled !== true) throw new MainnetNotEnabledError();
  return environment;
};

/** Read the page's configuration. On mainnet, the user confirms the warning first (see mainnet.tsx). */
export const loadEnvironment = async (): Promise<Environment> => {
  const response = await fetch('/config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('This site is not configured: config.json is missing.');
  const environment = readEnvironment(await response.json());
  if (environment.network === 'mainnet') await confirmMainnet();
  return environment;
};

export interface ChainConnection {
  /** All reachable servers read as one. */
  chain: AppChain;
  /** Each reachable server by itself, for the monitor. */
  servers: ChainReader[];
  /** Send a transaction through the first server that takes it. A refusal by the network is returned, not thrown. */
  broadcast(transactionHex: string): Promise<{ accepted: true; transactionId: string } | { accepted: false; reason: string }>;
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
  const broadcast: ChainConnection['broadcast'] = async (transactionHex) => {
    let refusal: { accepted: false; reason: string } = { accepted: false, reason: 'No server could be reached.' };
    for (const server of servers) {
      const result = await server.broadcast(transactionHex).catch((error: unknown) => ({ accepted: false as const, reason: (error as Error).message }));
      if (result.accepted) return result;
      refusal = result;
    }
    return refusal;
  };
  return { chain, servers, broadcast };
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
