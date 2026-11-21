import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { walletTemplateNumbers } from '@grandmas-wallet/app';
import { ADDRESS_KIND, deriveSeedKeys, walletAddress } from '@grandmas-wallet/core';
import { MAINNET_CONFIRMED_KEY, MAINNET_STATEMENT, MainnetNotEnabledError, engineNetwork, keyNetwork, loadEnvironment, mainnetGate, onMainnet, readAddress, readEnvironment } from '@grandmas-wallet/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deskFor } from '../apps/loan/src/loan.js';
import { defaultChallengeDelay, delaysFor } from '../apps/recoverer/src/delays.js';

/**
 * Mainnet is turned on by the configuration a page is served with, and only with the parameter that allows it
 * (plan, stage 20). Nothing here sends a transaction or reaches a server.
 */

const CHIPNET = JSON.parse(readFileSync('deploy/config/local.json', 'utf8')) as Record<string, unknown>;
const EXAMPLE = JSON.parse(readFileSync('deploy/config/mainnet.example.json', 'utf8')) as Record<string, unknown>;
const WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const marks = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial));
  return { getItem: (name: string) => items.get(name) ?? null, setItem: (name: string, value: string) => void items.set(name, value), items };
};

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sourceFiles(join(directory, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(directory, entry.name)] : []));

describe('a configuration without the parameter cannot bring a page to mainnet', () => {
  const withoutParameter = { ...EXAMPLE, mainnetEnabled: undefined };

  it('is refused, with the reason', () => {
    expect(() => readEnvironment(withoutParameter)).toThrow(MainnetNotEnabledError);
    expect(() => readEnvironment(withoutParameter)).toThrow(/"mainnetEnabled": true/);
    for (const value of ['true', 1, 'yes', false, null]) expect(() => readEnvironment({ ...EXAMPLE, mainnetEnabled: value })).toThrow(MainnetNotEnabledError);
  });

  it('is taken with it; chipnet needs nothing and is unchanged', () => {
    expect(readEnvironment(EXAMPLE).network).toBe('mainnet');
    expect(readEnvironment(CHIPNET)).toEqual(CHIPNET);
    expect(CHIPNET['mainnetEnabled']).toBeUndefined();
  });

  it('every page reads its configuration through the one check', () => {
    // The wallet, the recoverer's page, the Savings Jar and the loan page.
    const readers = ['apps/wallet/src/session.ts', 'apps/recoverer/src/session.ts', 'apps/jar/src/main.tsx', 'apps/loan/src/main.tsx'];
    for (const reader of readers) expect(readFileSync(reader, 'utf8'), reader).toMatch(/loadEnvironment\(\)/);
    const elsewhere = ['apps/wallet/src', 'apps/recoverer/src', 'apps/jar/src', 'apps/loan/src', 'packages/ui/src', 'packages/app/src']
      .flatMap(sourceFiles)
      .filter((file) => !file.endsWith('environment.ts') && /fetch\(['"`]\/?config\.json/.test(readFileSync(file, 'utf8')));
    expect(elsewhere).toEqual([]);
  });

  it('a page asked to load such a configuration does not start', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(withoutParameter), { status: 200 }));
    await expect(loadEnvironment()).rejects.toThrow(MainnetNotEnabledError);
  });

  it('the server and the deployment scripts refuse it too', () => {
    expect(readFileSync('deploy/serve.mjs', 'utf8')).toMatch(/config\.network === 'mainnet' && config\.mainnetEnabled !== true/);
    for (const script of ['deploy/preview.sh', 'deploy/install-services.sh']) expect(readFileSync(script, 'utf8'), script).toMatch(/c\.mainnetEnabled === true \? "mainnet" : "refused"/);
  });

  it('nothing in a page sets the parameter', () => {
    const setting = ['apps/wallet/src', 'apps/recoverer/src', 'apps/jar/src', 'apps/loan/src', 'packages/ui/src'].flatMap(sourceFiles).filter((file) => /mainnetEnabled\s*[:=]/.test(readFileSync(file, 'utf8').replace(/\/\*\*[\s\S]*?\*\//g, '')));
    expect(setting).toEqual([]);
  });
});

describe('with the parameter, the warning shows and must be confirmed', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says what the owner asked for', () => {
    const text = [MAINNET_STATEMENT.lead, ...MAINNET_STATEMENT.points].join(' ');
    expect(text).toMatch(/only to meet the requirements of BCH Blaze/);
    expect(text).toMatch(/Nothing here has been audited/);
    expect(text).toMatch(/Coins can be lost/);
    expect(text).toMatch(/does not recommend enabling it/);
  });

  it('is asked before the page goes on, then kept for this browser', async () => {
    const kept = marks();
    let answer: (() => void) | undefined;
    const asked = vi.fn(() => new Promise<void>((resolve) => (answer = resolve)));
    let through = false;
    const gate = mainnetGate(kept, asked).then(() => (through = true));
    await Promise.resolve();
    expect(asked).toHaveBeenCalledTimes(1);
    expect(through).toBe(false);
    expect(kept.items.has(MAINNET_CONFIRMED_KEY)).toBe(false);
    answer?.();
    await gate;
    expect(through).toBe(true);
    expect(onMainnet()).toBe(true);
    // The next load in the same browser is not asked again.
    const again = vi.fn(async () => undefined);
    await mainnetGate(kept, again);
    expect(again).not.toHaveBeenCalled();
  });

  it('a browser that keeps nothing is asked each time', async () => {
    const asked = vi.fn(async () => undefined);
    await mainnetGate(undefined, asked);
    await mainnetGate(undefined, asked);
    expect(asked).toHaveBeenCalledTimes(2);
  });

  it('a page loading a mainnet configuration goes through the gate', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(EXAMPLE), { status: 200 }));
    vi.stubGlobal('window', { localStorage: marks({ [MAINNET_CONFIRMED_KEY]: '1' }) });
    await expect(loadEnvironment()).resolves.toMatchObject({ network: 'mainnet', secondsPerBlock: 600 });
  });
});

describe('what mainnet changes', () => {
  const environment = readEnvironment(EXAMPLE);

  it('keys, addresses and the engine are for mainnet', () => {
    expect(keyNetwork(environment)).toBe('mainnet');
    expect(engineNetwork(environment)).toBe('mainnet');
    expect(engineNetwork({ network: 'chipnet' })).toBe('chipnet');
    expect(engineNetwork({ network: 'regtest' })).toBe('chipnet');
    const seed = deriveSeedKeys(WORDS, keyNetwork(environment), walletTemplateNumbers());
    const address = walletAddress(new Uint8Array(32).fill(1), seed.viewingKey, ADDRESS_KIND.givenOut, 0);
    expect(address.address).toMatch(/^bitcoincash:p/);
    expect(address.tokenAddress).toMatch(/^bitcoincash:r/);
    expect(readAddress(address.tokenAddress, 'mainnet').tokenAware).toBe(true);
    expect(() => readAddress('bchtest:qr95sy3j9xwd2ap32xkykttr4cvcu7as4ytjg7p7mc', 'mainnet')).toThrow(/test network/);
    const chipnetSeed = deriveSeedKeys(WORDS, 'testnet', walletTemplateNumbers());
    expect(walletAddress(new Uint8Array(32).fill(1), chipnetSeed.viewingKey, ADDRESS_KIND.givenOut, 0).address).toMatch(/^bchtest:/);
  });

  it('blocks come every ten minutes', () => {
    expect(environment.secondsPerBlock).toBe(600);
  });

  it('the waiting periods are the mainnet ones', () => {
    expect(defaultChallengeDelay('mainnet')).toEqual({ unit: 'time512', value: 169 });
    expect(defaultChallengeDelay('chipnet')).toEqual({ unit: 'time512', value: 1 });
    expect(delaysFor('mainnet').map((entry) => entry.delay.value)).toEqual([7, 169, 1182]);
    expect(delaysFor('chipnet').map((entry) => entry.delay.value)).toEqual([1, 7, 169, 1182]);
  });

  it('the loan page is off on mainnet, also for a deployment its configuration names', () => {
    expect(deskFor(environment)).toBeUndefined();
    expect(deskFor({ network: 'mainnet', paryon: { name: 'x', tokenIds: { paryon: 'aa', loanKeyFactory: 'bb' } } })).toBeUndefined();
    expect(deskFor({ network: 'chipnet' })).toBeDefined();
  });

  it('the example configuration is clearly an example', () => {
    expect(String(EXAMPLE['about'])).toMatch(/^AN EXAMPLE/);
    expect(JSON.stringify(EXAMPLE)).toMatch(/example\.org/);
  });
});
