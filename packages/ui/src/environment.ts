import type { AppChain, RegistriesConfig } from '@grandmas-wallet/app';
import { linkKind } from '@grandmas-wallet/app/links';
import { Electrum } from '@grandmas-wallet/chipnet/electrum';
import { ChainPool } from '@grandmas-wallet/chipnet/pool';
import { type ChainReader, setTestAddressPrefix } from '@grandmas-wallet/core';

import { confirmMainnet } from './mainnet.js';
import { claimTab } from './tab.js';
import { MOCKUP, keepDatabasesApart, rememberedNetwork, settleStorageNetwork, storageNetwork } from './network.js';

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
  /** On the mockup: the address of its service, which gives play coins and moves the chain's clock on (docs/mockup.md). */
  mockupService?: string;
  /** Token names from registries checked against the chain (`chain`), or none (`off`, or no entry). */
  registries?: RegistriesConfig;
  /**
   * Where the deployment describes more than one network and allows more than one: the networks a person may
   * choose between on the page, and the one a new visitor starts on. Absent where there is no choice.
   */
  choice?: NetworkChoice;
}

export interface NetworkChoice {
  starting: string;
  networks: string[];
}

/**
 * What differs by network, in a configuration that describes more than one (`networks`). Any entry of the
 * configuration may be given there; these are the usual ones.
 */
export interface NetworkPart {
  chain: string[];
  explorer: string;
  secondsPerBlock: number;
  stores?: string[];
  relays?: string[];
  [entry: string]: unknown;
}

/** A configuration for mainnet that does not carry the parameter allowing it. */
export class MainnetNotEnabledError extends Error {
  constructor() {
    super('This page is configured for the main network of Bitcoin Cash, where coins have real value, but its configuration does not allow it ("mainnetEnabled": true). It does not start.');
    this.name = 'MainnetNotEnabledError';
  }
}

/**
 * Check a page's configuration as read from `config.json`, and resolve the network the page runs on.
 *
 * A configuration of one network names it in `network` and gives its servers beside it. A configuration of more
 * than one gives what differs by network under `networks` (`{ "chipnet": {…}, "mainnet": {…} }`), and `network`
 * names the one a new visitor starts on; `chosen`, the network remembered in this browser, is taken where the
 * deployment allows it. Mainnet is allowed only with `"mainnetEnabled": true`, in either shape.
 *
 * @throws MainnetNotEnabledError for a page that would start on mainnet without `"mainnetEnabled": true`
 */
export const readEnvironment = (config: unknown, chosen?: string): Environment => {
  if (typeof config !== 'object' || config === null) throw new Error('This site is not configured: config.json is not an object.');
  const environment = config as Environment & { networks?: unknown };
  if (typeof environment.network !== 'string') throw new Error('This site is not configured: config.json names no network.');
  if (environment.network === 'mainnet' && environment.mainnetEnabled !== true) throw new MainnetNotEnabledError();
  if (environment.networks === undefined) return environment;
  const { networks, ...shared } = environment;
  if (typeof networks !== 'object' || networks === null) throw new Error('This site is not configured: "networks" in config.json is not an object.');
  const parts = networks as Record<string, NetworkPart>;
  const starting = environment.network;
  if (parts[starting] === undefined) throw new Error(`This site is not configured: config.json starts on ${starting} but does not describe it under "networks".`);
  const allowed = Object.keys(parts).filter((name) => !(name === 'mainnet' && environment.mainnetEnabled !== true));
  const network = chosen !== undefined && allowed.includes(chosen) ? chosen : starting;
  const resolved: Environment = { ...shared, ...parts[network], network } as Environment;
  if (allowed.length > 1) resolved.choice = { starting, networks: allowed };
  return resolved;
};

/**
 * Read the page's configuration, on the network chosen in this browser where the deployment allows a choice. On
 * mainnet, the user confirms the warning first (see mainnet.tsx).
 */
export const loadEnvironment = async (): Promise<Environment> => {
  const response = await fetch('/config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('This site is not configured: config.json is missing.');
  const environment = readEnvironment(await response.json(), rememberedNetwork());
  // The page keeps its data under the names of the network it runs on; it loads again if it began with others.
  if (!settleStorageNetwork(environment.network)) return new Promise<Environment>(() => undefined);
  // One tab of the page at a time on each network: this one takes its turn before it opens anything (tab.tsx).
  await claimTab(storageNetwork());
  if (storageNetwork() === 'mockup') keepDatabasesApart();
  // The mockup's addresses are written so that they are not taken for chipnet's.
  if (environment.network === MOCKUP) setTestAddressPrefix('bchreg');
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
