import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAINNET_CONFIRMED_KEY,
  MainnetNotEnabledError,
  NETWORK_CHOICE_KEY,
  Vault,
  chooseNetwork,
  eraseDevice,
  followWallet,
  loadEnvironment,
  networkName,
  readEnvironment,
  resetStorageNetwork,
  setMainnetChoiceAsk,
  settleStorageNetwork,
  storageNetwork,
} from '@grandmas-wallet/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { walletNetworkOf } from '../apps/jar/src/source.js';
import { headerResetMark, isEngineHeaderStore, markHeadersForReset } from '../packages/ui/src/engine-headers.js';

/**
 * A deployment may describe chipnet and mainnet; where it allows mainnet, a person chooses on the page, and each
 * network's data stays on its own side of the browser. Nothing here reaches a server.
 */

const PRODUCTION = JSON.parse(readFileSync('deploy/config/production.json', 'utf8')) as Record<string, unknown>;
const LOCAL = JSON.parse(readFileSync('deploy/config/local.json', 'utf8')) as Record<string, unknown>;
const MAINNET = JSON.parse(readFileSync('deploy/config/mainnet.example.json', 'utf8')) as Record<string, unknown>;
const BOTH = JSON.parse(readFileSync('deploy/config/both.example.json', 'utf8')) as Record<string, unknown> & { networks: Record<string, Record<string, unknown>> };

/** A browser's storage, as the pages use it. */
const storage = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial));
  const store = {
    getItem: (name: string) => items.get(name) ?? null,
    setItem: (name: string, value: string) => void items.set(name, String(value)),
    removeItem: (name: string) => void items.delete(name),
    clear: () => items.clear(),
    items,
  };
  // `Object.keys(localStorage)` lists the names kept.
  return new Proxy(store, { ownKeys: () => [...items.keys()], getOwnPropertyDescriptor: (_target, key) => (typeof key === 'string' && items.has(key) ? { enumerable: true, configurable: true, value: items.get(key) } : undefined) });
};

const browser = (initial: Record<string, string> = {}) => {
  const local = storage(initial);
  const reload = vi.fn();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('window', { localStorage: local, location: { reload } });
  return { local, reload };
};

afterEach(() => {
  vi.unstubAllGlobals();
  resetStorageNetwork();
});

describe('the configuration describes one network or both', () => {
  it('a configuration of one network is read as before and offers no choice', () => {
    expect(readEnvironment(PRODUCTION)).toEqual(PRODUCTION);
    expect(readEnvironment(PRODUCTION, 'mainnet')).toEqual(PRODUCTION);
    expect(readEnvironment(LOCAL).choice).toBeUndefined();
    expect(readEnvironment(MAINNET, 'chipnet')).toMatchObject({ network: 'mainnet', secondsPerBlock: 600 });
    expect(readEnvironment(MAINNET).choice).toBeUndefined();
  });

  it('both networks: the page starts on the configuration\'s network, takes a choice it allows, and gets that network\'s servers', () => {
    const start = readEnvironment(BOTH);
    expect(start).toMatchObject({ network: 'chipnet', secondsPerBlock: 60, chain: BOTH.networks['chipnet']?.['chain'], walletUrl: BOTH['walletUrl'], stores: BOTH['stores'] });
    expect(start.choice).toEqual({ starting: 'chipnet', networks: ['chipnet', 'mainnet'] });
    expect(start).not.toHaveProperty('networks');
    const chosen = readEnvironment(BOTH, 'mainnet');
    expect(chosen).toMatchObject({ network: 'mainnet', secondsPerBlock: 600, chain: BOTH.networks['mainnet']?.['chain'], explorer: BOTH.networks['mainnet']?.['explorer'] });
    expect(readEnvironment(BOTH, 'testnet4').network).toBe('chipnet');
  });

  it('each network may name its own stores, or anything else of the configuration', () => {
    const own = { ...BOTH, networks: { ...BOTH.networks, mainnet: { ...BOTH.networks['mainnet'], stores: ['https://store.mainnet.example.org'], registries: ['https://r.example.org'] } } };
    expect(readEnvironment(own, 'mainnet')).toMatchObject({ stores: ['https://store.mainnet.example.org'], registries: ['https://r.example.org'] });
    expect(readEnvironment(own, 'chipnet').stores).toEqual(BOTH['stores']);
  });

  it('without "mainnetEnabled": true mainnet is not offered, not even when chosen before', () => {
    const without = { ...BOTH, mainnetEnabled: undefined };
    expect(readEnvironment(without).choice).toBeUndefined();
    expect(readEnvironment(without, 'mainnet').network).toBe('chipnet');
    expect(() => readEnvironment({ ...without, network: 'mainnet' })).toThrow(MainnetNotEnabledError);
  });

  it('a starting network that is not described is refused', () => {
    expect(() => readEnvironment({ ...BOTH, network: 'testnet4' })).toThrow(/does not describe it/);
  });

  it('the production configuration is not changed by this', () => {
    expect(PRODUCTION['networks']).toBeUndefined();
    expect(PRODUCTION['mainnetEnabled']).toBeUndefined();
    expect(String(BOTH['about'])).toMatch(/^AN EXAMPLE/);
  });

  it('the server allows connections to both networks\' servers', () => {
    const serve = readFileSync('deploy/serve.mjs', 'utf8');
    expect(serve).toMatch(/config\.networks === undefined/);
    expect(serve).toMatch(/name !== 'mainnet' \|\| config\.mainnetEnabled === true/);
  });
});

describe('the page loads on the remembered network', () => {
  it('a deployment of one chipnet network keeps nothing new and does not load again', async () => {
    const { local, reload } = browser();
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(PRODUCTION), { status: 200 }));
    await expect(loadEnvironment()).resolves.toMatchObject({ network: 'chipnet' });
    expect([...local.items.keys()]).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('mainnet chosen before: the page is on mainnet, under mainnet\'s names', async () => {
    browser({ [NETWORK_CHOICE_KEY]: 'mainnet', [MAINNET_CONFIRMED_KEY]: '1' });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(BOTH), { status: 200 }));
    await expect(loadEnvironment()).resolves.toMatchObject({ network: 'mainnet', choice: { networks: ['chipnet', 'mainnet'] } });
    expect(storageNetwork()).toBe('mainnet');
  });

  it('a page that read chipnet\'s names before it knew it was on mainnet loads again', () => {
    const { local, reload } = browser();
    expect(networkName('gw2-wallet')).toBe('gw2-wallet');
    expect(settleStorageNetwork('mainnet')).toBe(false);
    expect(local.items.get(NETWORK_CHOICE_KEY)).toBe('mainnet');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a browser that keeps nothing cannot be brought to mainnet\'s names, and says so', () => {
    vi.stubGlobal('window', { localStorage: undefined, location: { reload: vi.fn() } });
    expect(networkName('gw2-wallet')).toBe('gw2-wallet');
    expect(() => settleStorageNetwork('mainnet')).toThrow(/keeps nothing/);
  });
});

describe('choosing a network', () => {
  beforeEach(() => resetStorageNetwork());
  const environment = readEnvironment(BOTH);

  it('mainnet shows the statement every time it is chosen; going back keeps the page where it is', async () => {
    const { local, reload } = browser({ [MAINNET_CONFIRMED_KEY]: '1' });
    const ask = vi.fn(async () => false);
    setMainnetChoiceAsk(ask);
    expect(await chooseNetwork(environment, 'mainnet')).toBe(false);
    expect(await chooseNetwork(environment, 'mainnet')).toBe(false);
    expect(ask).toHaveBeenCalledTimes(2);
    expect(local.items.has(NETWORK_CHOICE_KEY)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    ask.mockImplementation(async () => true);
    expect(await chooseNetwork(environment, 'mainnet')).toBe(true);
    expect(ask).toHaveBeenCalledTimes(3);
    expect(local.items.get(NETWORK_CHOICE_KEY)).toBe('mainnet');
    expect(local.items.get(MAINNET_CONFIRMED_KEY)).toBe('1');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('chipnet needs no confirmation', async () => {
    const { local, reload } = browser({ [NETWORK_CHOICE_KEY]: 'mainnet' });
    const ask = vi.fn(async () => true);
    setMainnetChoiceAsk(ask);
    expect(await chooseNetwork(readEnvironment(BOTH, 'mainnet'), 'chipnet')).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(local.items.get(NETWORK_CHOICE_KEY)).toBe('chipnet');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a network the deployment does not offer cannot be chosen', async () => {
    const { reload } = browser();
    setMainnetChoiceAsk(async () => true);
    expect(await chooseNetwork(readEnvironment(PRODUCTION), 'mainnet')).toBe(false);
    expect(await chooseNetwork(readEnvironment({ ...BOTH, mainnetEnabled: undefined }), 'mainnet')).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('the wallet and the recoverer\'s page offer the choice in their header; the applications do not', () => {
    const offering = ['apps/wallet/src/main.tsx', 'apps/wallet/src/OwnerApp.tsx', 'apps/recoverer/src/main.tsx'];
    for (const file of offering) expect(readFileSync(file, 'utf8'), file).toMatch(/environment=\{session\.environment\} networkChoice/);
    for (const file of ['apps/jar/src/main.tsx', 'apps/loan/src/main.tsx']) expect(readFileSync(file, 'utf8'), file).not.toMatch(/networkChoice/);
  });
});

describe('two wallets side by side, never mixed', () => {
  it('chipnet keeps today\'s names; mainnet has its own', () => {
    browser();
    resetStorageNetwork('test');
    for (const base of ['gw2-wallet', 'gw2-recoverer', 'jar', 'loan']) new Vault(base).set('state', { a: 1 });
    expect(headerResetMark()).toBe('gw2-engine-headers');
    expect([...(localStorage as unknown as ReturnType<typeof storage>).items.keys()].sort()).toEqual(['gw2-recoverer:state', 'gw2-wallet:state', 'jar:state', 'loan:state']);
    resetStorageNetwork('mainnet');
    for (const base of ['gw2-wallet', 'gw2-recoverer', 'jar', 'loan']) expect(new Vault(base).get('state')).toBeUndefined();
    new Vault('gw2-wallet').set('state', { b: 2 });
    expect(localStorage.getItem('gw2-wallet-mainnet:state')).toBe('{"b":2}');
    expect(headerResetMark()).toBe('gw2-engine-headers-mainnet');
    resetStorageNetwork('test');
    expect(new Vault('gw2-wallet').get('state')).toEqual({ a: 1 });
    expect(new Vault('gw2-wallet').names()).toEqual(['state']);
  });

  it('the engine\'s header stores are reset for the page\'s network only', () => {
    browser();
    resetStorageNetwork('mainnet');
    expect(isEngineHeaderStore('Electrum-mainnet-4302fd')).toBe(true);
    expect(isEngineHeaderStore('Electrum-chipnet-4302fd')).toBe(false);
    expect(markHeadersForReset(sessionStorage)).toBe(true);
    expect(sessionStorage.getItem('gw2-engine-headers')).toBeNull();
    resetStorageNetwork('test');
    expect(isEngineHeaderStore('Electrum-chipnet-4302fd')).toBe(true);
    expect(isEngineHeaderStore('Electrum-mainnet-4302fd')).toBe(false);
  });

  it('erasing the device on one network leaves the other\'s side and the choice', async () => {
    const { local } = browser({ 'gw2-wallet:words': 'a', 'gw2-wallet-mainnet:words': 'b', [NETWORK_CHOICE_KEY]: 'mainnet', [MAINNET_CONFIRMED_KEY]: '1' });
    const deleted: string[] = [];
    vi.stubGlobal('indexedDB', {
      databases: async () => [{ name: 'XO-chipnet-aa' }, { name: 'XO-mainnet-aa' }, { name: 'Electrum-mainnet-aa' }],
      deleteDatabase: (name: string) => {
        deleted.push(name);
        const request: { onsuccess?: () => void } = {};
        setTimeout(() => request.onsuccess?.(), 0);
        return request;
      },
    });
    resetStorageNetwork('mainnet');
    await eraseDevice();
    expect([...local.items.keys()].sort()).toEqual([NETWORK_CHOICE_KEY, 'gw2-wallet:words'].sort());
    expect(deleted).toEqual(['XO-mainnet-aa', 'Electrum-mainnet-aa']);
  });

  /**
   * Every place that keeps something in the browser. A new one fails here until its names are made with the
   * network (`networkName`, or a `Vault`, which does that) and it is added to this list.
   */
  const KEEPING: Record<string, number> = {
    // Vault: names made with networkName; DeviceStore: its database name too; eraseDevice: the page's network's side only.
    'packages/ui/src/storage.ts': 9,
    // The choice of network itself (NETWORK_CHOICE_KEY), the one name kept for the page's address, not per network.
    'packages/ui/src/network.ts': 2,
    // The mark that the mainnet statement was confirmed: about mainnet alone.
    'packages/ui/src/mainnet.tsx': 2,
    // The header-store mark (headerResetMark, per network) and the engine's databases, which the engine names per network.
    'packages/ui/src/engine.ts': 5,
  };

  const sourceFiles = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sourceFiles(join(directory, entry.name)) : /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [join(directory, entry.name)] : []));

  it('no storage name is added without the network in it', () => {
    const roots = ['apps', 'packages'].flatMap((top) => readdirSync(top).map((name) => join(top, name, 'src')).filter((path) => { try { return readdirSync(path).length > 0; } catch { return false; } }));
    const found: Record<string, number> = {};
    for (const file of roots.flatMap(sourceFiles)) {
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const uses = code.match(/\b(localStorage|sessionStorage|indexedDB)\b/g)?.length ?? 0;
      if (uses > 0) found[file] = uses;
    }
    expect(found).toEqual(KEEPING);
    // Every Vault takes the page's network into its names; none is given a name with a network already in it.
    const vaults = roots.flatMap(sourceFiles).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/new Vault\('([^']+)'/g)].map((match) => match[1]));
    expect(vaults.sort()).toEqual(['gw2-recoverer', 'gw2-wallet', 'jar', 'loan']);
  });
});

describe('applications follow the wallet', () => {
  const both = readEnvironment(BOTH);

  it('a page on chipnet changes to mainnet for a mainnet wallet where the deployment offers it', () => {
    expect(followWallet(both, 'chipnet')).toEqual({ kind: 'same' });
    expect(followWallet(both, 'mainnet')).toEqual({ kind: 'switch', network: 'mainnet' });
    expect(followWallet(readEnvironment(BOTH, 'mainnet'), 'chipnet')).toEqual({ kind: 'switch', network: 'chipnet' });
  });

  it('and refuses, in a plain sentence, where it does not', () => {
    const refusal = followWallet(readEnvironment(PRODUCTION), 'mainnet');
    expect(refusal).toEqual({ kind: 'refuse', reason: 'Your wallet is on Mainnet, and this page works on Chipnet only. Switch the wallet to Chipnet and connect again.' });
    expect(followWallet(readEnvironment({ ...BOTH, mainnetEnabled: undefined }), 'mainnet').kind).toBe('refuse');
  });

  it('the loan page stays off on mainnet: it does not change to it', () => {
    expect(followWallet(both, 'mainnet', ['mainnet'])).toEqual({ kind: 'refuse', reason: 'Your wallet is on Mainnet, and this page works on Chipnet only. Switch the wallet to Chipnet and connect again.' });
    expect(readFileSync('apps/loan/src/main.tsx', 'utf8')).toMatch(/followWallet\(environment, walletNetwork, \['mainnet'\]\)/);
  });

  it('the wallet\'s network is the one its announcement names', () => {
    const xo = { network: 'mainnet', version: 1, bindings: ['receive'] } as never;
    expect(walletNetworkOf({ paths: [], xo }, 'chipnet')).toBe('mainnet');
    expect(walletNetworkOf({ paths: [] }, 'chipnet')).toBeUndefined();
  });

  it('the session goes over to the new network\'s side, so the page on the other network takes it up', async () => {
    const { local, reload } = browser({ 'jar:credentials': '{"walletPublicKey":"aa"}' });
    resetStorageNetwork('test');
    setMainnetChoiceAsk(async () => true);
    const vault = new Vault('jar');
    await chooseNetwork(both, 'mainnet', (side) => {
      vault.on(side).set('credentials', vault.get('credentials'));
      vault.remove('credentials');
    });
    expect(local.items.get('jar-mainnet:credentials')).toBe('{"walletPublicKey":"aa"}');
    expect(local.items.has('jar:credentials')).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
