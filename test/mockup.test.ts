import { addressOf, lockingBytecodeOf } from '@grandmas-wallet/app';
import { setTestAddressPrefix, testAddressPrefix } from '@grandmas-wallet/core';
import { DATABASE_SPACE, MOCKUP, isOwnChain, keepDatabasesApart, networkName, networkWords, onMockup, readEnvironment, sideOfName, storageNetworkOf } from '@grandmas-wallet/ui';
import { afterEach, describe, expect, it } from 'vitest';

import { isEngineHeaderStore } from '../packages/ui/src/engine-headers.js';

/**
 * The mockup: a third network a deployment may offer, a chain of its own with play coins and a clock that can be
 * moved on. In the browser it is kept apart from chipnet and from mainnet, and its addresses are written so that
 * they are not taken for chipnet's. Nothing here reaches a server.
 */

const deployment = {
  network: 'chipnet',
  mainnetEnabled: true,
  walletUrl: 'https://wallet.example/',
  recovererUrl: 'https://recoverer.example/',
  stores: ['https://store.example'],
  relays: ['wss://relay.example'],
  networks: {
    chipnet: { chain: ['wss://chipnet.example'], explorer: '', secondsPerBlock: 60 },
    mainnet: { chain: ['wss://mainnet.example'], explorer: '', secondsPerBlock: 600 },
    mockup: { chain: ['wss://mockup.example'], explorer: '', secondsPerBlock: 600, mockupService: 'https://mockup-api.example' },
  },
};

describe('a deployment may offer the mockup', () => {
  it('it is offered beside the others, and a page that chose it gets its chain and its service', () => {
    const chosen = readEnvironment(deployment, MOCKUP);
    expect(chosen.network).toBe('mockup');
    expect(chosen.chain).toEqual(['wss://mockup.example']);
    expect(chosen.choice?.networks).toEqual(['chipnet', 'mainnet', 'mockup']);
    expect(onMockup(chosen)).toBe(true);
  });

  it('the play coins and the moved clock are offered on the mockup only', () => {
    expect(onMockup(readEnvironment(deployment))).toBe(false);
    expect(onMockup(readEnvironment(deployment, 'mainnet'))).toBe(false);
    expect(onMockup({ network: 'mockup' })).toBe(false);
  });

  it('it is named as what it is', () => {
    expect(networkWords(MOCKUP)).toEqual({ name: 'Mockup', coins: 'play coins' });
    expect(isOwnChain(MOCKUP)).toBe(true);
    expect(isOwnChain('regtest')).toBe(true);
    expect(isOwnChain('chipnet')).toBe(false);
  });
});

describe('three sides of the browser, never mixed', () => {
  it('the mockup has names of its own; chipnet keeps today\'s', () => {
    expect(storageNetworkOf(MOCKUP)).toBe('mockup');
    expect(storageNetworkOf('regtest')).toBe('test');
    expect(networkName('gw2-wallet', 'mockup')).toBe('gw2-wallet-mockup');
    expect(networkName('gw2-wallet', 'test')).toBe('gw2-wallet');
    expect(networkName('gw2-wallet', 'mainnet')).toBe('gw2-wallet-mainnet');
    expect(sideOfName('gw2-wallet-mockup:state')).toBe('mockup');
    expect(sideOfName('gw2-wallet:state')).toBe('test');
    expect(sideOfName('gw2-wallet-mainnet:state')).toBe('mainnet');
  });

  it('the engine is made for chipnet on the mockup, so its databases get a name of the mockup\'s own', () => {
    const opened: string[] = [];
    const deleted: string[] = [];
    const factory = {
      prototype: {
        open: (name: string) => (opened.push(name), {} as IDBOpenDBRequest),
        deleteDatabase: (name: string) => (deleted.push(name), {} as IDBOpenDBRequest),
      },
    };
    keepDatabasesApart(factory);
    factory.prototype.open('Electrum-chipnet-headers');
    factory.prototype.open(`${DATABASE_SPACE}XO-chipnet-1234`);
    factory.prototype.deleteDatabase('Electrum-chipnet-headers');
    expect(opened).toEqual(['mockup:Electrum-chipnet-headers', 'mockup:XO-chipnet-1234']);
    expect(deleted).toEqual(['mockup:Electrum-chipnet-headers']);
    expect(sideOfName(opened[0] as string)).toBe('mockup');
  });

  it('a stuck header check on one side resets that side\'s header store only', () => {
    expect(isEngineHeaderStore('mockup:Electrum-chipnet-headers', false, 'mockup')).toBe(true);
    expect(isEngineHeaderStore('Electrum-chipnet-headers', false, 'mockup')).toBe(false);
    expect(isEngineHeaderStore('mockup:Electrum-chipnet-headers', false, 'test')).toBe(false);
    expect(isEngineHeaderStore('Electrum-chipnet-headers', false, 'test')).toBe(true);
    expect(isEngineHeaderStore('mockup:XO-chipnet-1234', false, 'mockup')).toBe(false);
  });
});

describe('the mockup\'s addresses are not taken for chipnet\'s', () => {
  afterEach(() => setTestAddressPrefix('bchtest'));
  const locking = `76a914${'5a'.repeat(20)}88ac`;

  it('they are written with bchreg, and read back', () => {
    const chipnet = addressOf(locking);
    setTestAddressPrefix('bchreg');
    expect(testAddressPrefix()).toBe('bchreg');
    const mockup = addressOf(locking);
    expect(chipnet.startsWith('bchtest:')).toBe(true);
    expect(mockup.startsWith('bchreg:')).toBe(true);
    expect(lockingBytecodeOf(mockup)).toEqual(lockingBytecodeOf(mockup.split(':')[1] as string));
    expect(() => lockingBytecodeOf(chipnet)).toThrow('another network');
  });

  it('mainnet\'s are untouched', () => {
    setTestAddressPrefix('bchreg');
    expect(addressOf(locking, 'mainnet').startsWith('bitcoincash:')).toBe(true);
  });
});
