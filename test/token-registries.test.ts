import { readFileSync } from 'node:fs';

import { type Output, type TransactionCommon, binToHex, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';
import { type RegistriesConfig, type RegistryFetch, type RegistryState, Applications, REGISTRY_LIMITS, TokenRegistries, formatUnits, parseUnits } from '@grandmas-wallet/app';
import { type ChainReader, currentSnapshot, isReservedSymbol, p2pkhLockingBytecode, readPublication, readRegistry, registryUrl, shownSymbol } from '@grandmas-wallet/core';
import { type SimulatedChain, testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { type Device, deviceWith } from './support/applications.js';

/**
 * Acceptance tests TR01 to TR14 (docs/token-registries.md, section 7): a token's name, symbol and decimals from its
 * registry, checked against the chain. On the simulated chain, with registry files served from memory. The issuers
 * and their tokens are made here; no application's token is named in the wallet's code (TR13 is in
 * wallet-knows-no-application.test.ts).
 */

const hex = binToHex;
const issuerScript = p2pkhLockingBytecode(testKey(0xb1).keyHash);
const CHAIN: RegistriesConfig = { mode: 'chain' };
const NOW = Date.parse('2027-01-01T00:00:00Z');
let made = 0;

const push = (data: Uint8Array): Uint8Array => (data.length <= 75 ? Uint8Array.of(data.length, ...data) : Uint8Array.of(0x4c, data.length, ...data));
const publicationOutput = (hash: Uint8Array, ...uris: string[]): Output => ({
  lockingBytecode: Uint8Array.of(0x6a, ...push(utf8ToBin('BCMR')), ...push(hash), ...uris.flatMap((uri) => [...push(utf8ToBin(uri))])),
  valueSatoshis: 0n,
});

/** A registry file for a category, as an issuer writes it. */
const registryFile = (category: string, token: { name?: string; symbol?: string; decimals?: unknown; category?: string; snapshots?: Record<string, { name: string; symbol: string; decimals?: number }>; types?: Record<string, string> } = {}): Uint8Array => {
  const snapshot = (name: string, symbol: string, decimals: unknown) => ({
    name,
    token: { category: token.category ?? category, symbol, ...(decimals === undefined ? {} : { decimals }), ...(token.types === undefined ? {} : { nfts: { parse: { types: Object.fromEntries(Object.entries(token.types).map(([commitment, name]) => [commitment, { name }])) } } }) },
  });
  const snapshots = token.snapshots === undefined ? { '2026-01-01T00:00:00.000Z': snapshot(token.name ?? 'Example Dollar', token.symbol ?? 'XDOL', 'decimals' in token ? token.decimals : 2) } : Object.fromEntries(Object.entries(token.snapshots).map(([at, value]) => [at, snapshot(value.name, value.symbol, value.decimals)]));
  return utf8ToBin(JSON.stringify({ $schema: 'https://cashtokens.org/bcmr-v2.schema.json', version: { major: 1, minor: 0, patch: 0 }, latestRevision: '2026-01-01T00:00:00.000Z', registryIdentity: { name: 'Example' }, identities: { [category]: snapshots } }, null, 2));
};

/** Files served from memory, with a count of the requests. */
class Files {
  readonly served = new Map<string, Uint8Array>();
  requests: string[] = [];
  readonly fetch: RegistryFetch = async (url) => {
    this.requests.push(url);
    return this.served.get(url);
  };
}

/** The chain as the resolver reads it, with a count of the requests. */
const counted = (chain: ChainReader): ChainReader & { requests: number } => {
  const wrapped = {
    requests: 0,
    getTransaction: (id: string) => ((wrapped.requests += 1), chain.getTransaction(id)),
    getHistory: (script: Uint8Array) => ((wrapped.requests += 1), chain.getHistory(script)),
    listUnspent: (script: Uint8Array) => ((wrapped.requests += 1), chain.listUnspent(script)),
  };
  return wrapped;
};

const transaction = (inputs: { transactionId: string; index: number }[], outputs: Output[]): TransactionCommon => ({
  version: 2,
  locktime: 0,
  inputs: inputs.map(({ transactionId, index }) => ({ outpointTransactionHash: hexToBin(transactionId), outpointIndex: index, sequenceNumber: 0, unlockingBytecode: new Uint8Array() })),
  outputs,
});

/** An issuer: an authbase, whose identifier is the token's category, and the authchain it extends. */
interface Issuer {
  category: string;
  head: string;
  /** Add a link to the authchain, with a publication or not. */
  extend: (publication?: Output) => string;
  /** Spend the identity output into a data output: the identity is burned. */
  burn: () => void;
}

const issuer = (chain: SimulatedChain, options: { publication?: Output; to?: { lockingBytecode: Uint8Array; amount?: bigint; commitment?: string }[] } = {}): Issuer => {
  made += 1;
  const funding = new Uint8Array(32).fill(made).map((byte, index) => (index === 0 ? 0xee : byte));
  const authbase = chain.include(transaction([{ transactionId: hex(funding), index: 0 }], [{ lockingBytecode: issuerScript, valueSatoshis: 10_000n }]));
  // The genesis spends output 0 of the authbase and makes the tokens; its own output 0 carries the identity on.
  const genesis = chain.include(
    transaction(
      [{ transactionId: authbase, index: 0 }],
      [
        { lockingBytecode: issuerScript, valueSatoshis: 1_000n },
        ...(options.to ?? []).map(({ lockingBytecode, amount, commitment }) => ({
          lockingBytecode,
          valueSatoshis: 1_000n,
          token: { category: hexToBin(authbase), amount: amount ?? 0n, ...(commitment === undefined ? {} : { nft: { capability: 'none' as const, commitment: hexToBin(commitment) } }) },
        })),
        ...(options.publication === undefined ? [] : [options.publication]),
      ],
    ),
  );
  const self: Issuer = {
    category: authbase,
    head: genesis,
    extend: (publication) => {
      self.head = chain.include(transaction([{ transactionId: self.head, index: 0 }], [{ lockingBytecode: issuerScript, valueSatoshis: 1_000n }, ...(publication === undefined ? [] : [publication])]));
      return self.head;
    },
    burn: () => void chain.include(transaction([{ transactionId: self.head, index: 0 }], [{ lockingBytecode: Uint8Array.of(0x6a), valueSatoshis: 0n }])),
  };
  return self;
};

/** A token whose authchain publishes the given file at the given host, and the file served there. */
const published = (chain: SimulatedChain, files: Files, file: (category: string) => Uint8Array, to: { lockingBytecode: Uint8Array; amount?: bigint; commitment?: string }[] = [], host = `issuer${made + 1}.example`): Issuer => {
  // The file names the category, which is known only once the authbase is made: the publication goes on the next link.
  const made_ = issuer(chain, { to });
  const bytes = file(made_.category);
  files.served.set(`https://${host}/.well-known/bitcoin-cash-metadata-registry.json`, bytes);
  made_.extend(publicationOutput(sha256.hash(bytes), host));
  return made_;
};

const resolver = (chain: ChainReader, files: Files, config: RegistriesConfig | 'absent' = CHAIN, start?: RegistryState) => {
  let state: RegistryState | undefined = start;
  const registries = new TokenRegistries({ chain, fetch: files.fetch, kept: () => state, store: (next) => void (state = next), ...(config === 'absent' ? {} : { config }), now: () => NOW });
  return { registries, state: () => state };
};

const withRegistries = (device: Device, registries: TokenRegistries): Applications => new Applications(device.wallet.parts, { registry: (category) => registries.known(category) });
const fresh = async (device: Device): Promise<Uint8Array> => (await device.wallet.receiveAddress()).address.lockingBytecode;

describe('reading a registry (pure)', () => {
  it('reads the chipnet registry of a real token as published, and finds its hash', () => {
    const bytes = readFileSync(new URL('./vectors/bcmr-chipnet-pusd.json', import.meta.url));
    expect(hex(sha256.hash(bytes))).toBe('dc40ba13c4914d1daebd1f423633262804f82d40f92df93404e22ec316e54389');
    const reading = readRegistry(bytes.toString('utf8'), 'e7979ccdae259293c7d0bee45ce8b7ad7660ea99477f802ed6a5161b0d30e6b8', NOW);
    expect(reading).toMatchObject({ ok: true, token: { name: 'ParyonUSD (chipnet-fast-periods-6)', symbol: 'PUSDTEST', decimals: 2 } });
    // Its NFT types are parsable, which the first version leaves out.
    expect(reading.ok && reading.token.nftTypes).toBe(undefined);
  });

  it('reads the publication output as chipnet carries it', () => {
    const script = hexToBin(`6a0442434d5220dc40ba13c4914d1daebd1f423633262804f82d40f92df93404e22ec316e5438924${hex(utf8ToBin('chipnet-fast-periods-6.paryonusd.com'))}`);
    const publication = readPublication([{ lockingBytecode: Uint8Array.of(0x76) }, { lockingBytecode: script }]);
    expect(publication && hex(publication.hash)).toBe('dc40ba13c4914d1daebd1f423633262804f82d40f92df93404e22ec316e54389');
    expect(publication?.uris).toEqual(['chipnet-fast-periods-6.paryonusd.com']);
    expect(readPublication([{ lockingBytecode: Uint8Array.of(0x6a, 0x04, 0x42, 0x43, 0x4d, 0x52, 0x01, 0x00) }])).toBe(undefined);
  });

  it('turns addresses into the URLs fetched', () => {
    expect(registryUrl('example.com')).toBe('https://example.com/.well-known/bitcoin-cash-metadata-registry.json');
    expect(registryUrl('https://example.com')).toBe('https://example.com/.well-known/bitcoin-cash-metadata-registry.json');
    expect(registryUrl('example.com/files/r.json')).toBe('https://example.com/files/r.json');
    expect(registryUrl('http://example.com/r.json')).toBe(undefined);
    expect(registryUrl('ipfs://bafyexample')).toBe(undefined);
    expect(registryUrl('ipfs://bafyexample', 'https://gateway.example/ipfs/')).toBe('https://gateway.example/ipfs/bafyexample');
  });

  it('TR07: the latest snapshot reached; the oldest when none is reached', () => {
    const snapshots = { '2026-01-01T00:00:00Z': 'a', '2026-06-01T00:00:00Z': 'b', '2028-01-01T00:00:00Z': 'c' };
    expect(currentSnapshot(snapshots, NOW)).toBe('b');
    expect(currentSnapshot(snapshots, Date.parse('2025-01-01T00:00:00Z'))).toBe('a');
    const category = 'aa'.repeat(32);
    const file = registryFile(category, { snapshots: { '2026-01-01T00:00:00Z': { name: 'Old', symbol: 'OLD', decimals: 0 }, '2026-06-01T00:00:00Z': { name: 'Now', symbol: 'NOW', decimals: 4 }, '2030-01-01T00:00:00Z': { name: 'Later', symbol: 'LATER', decimals: 8 } } });
    expect(readRegistry(new TextDecoder().decode(file), category, NOW)).toMatchObject({ ok: true, token: { name: 'Now', symbol: 'NOW', decimals: 4 } });
  });

  it('TR03: another category, a symbol that breaks the rule, decimals of 19: nothing', () => {
    const category = 'bb'.repeat(32);
    const read = (file: Uint8Array) => readRegistry(new TextDecoder().decode(file), category, NOW).ok;
    expect(read(registryFile(category))).toBe(true);
    expect(read(registryFile(category, { category: 'cc'.repeat(32) }))).toBe(false);
    expect(read(registryFile(category, { symbol: 'x-dol' }))).toBe(false);
    expect(read(registryFile(category, { symbol: '-XDOL' }))).toBe(false);
    expect(read(registryFile(category, { decimals: 19 }))).toBe(false);
    expect(read(registryFile(category, { decimals: 1.5 }))).toBe(false);
    expect(read(registryFile('dd'.repeat(32)))).toBe(false);
  });

  it('writes names and symbols as plain text, and knows the reserved symbols', () => {
    expect(shownSymbol('PUSDTEST-STAKE')).toBe('PUSDTEST');
    expect(isReservedSymbol('BCH')).toBe(true);
    expect(isReservedSymbol('USD')).toBe(true);
    expect(isReservedSymbol('USD-X')).toBe(true);
    expect(isReservedSymbol('XDOL')).toBe(false);
    const category = 'ee'.repeat(32);
    const reading = readRegistry(new TextDecoder().decode(registryFile(category, { name: 'Line one\u202e\u0007\nline two' })), category, NOW);
    expect(reading.ok && reading.token.name).toBe('Line one');
  });
});

describe('resolving a token on the simulated chain', () => {
  it('TR01: a category whose authchain publishes a file with the published hash: name, symbol and decimals are kept and shown', async () => {
    const device = await deviceWith([20_000n]);
    const files = new Files();
    const token = published(device.chain, files, (category) => registryFile(category, { name: 'Example Dollar', symbol: 'XDOL', decimals: 2 }), [{ lockingBytecode: await fresh(device), amount: 12_345n }]);
    const { registries, state } = resolver(device.chain, files);
    const applications = withRegistries(device, registries);
    // tokens() never waits: before a look, the token is in raw units.
    expect((await applications.tokens()).find((held) => held.category === token.category)?.registry).toBe(undefined);
    await registries.refresh([token.category]);
    expect(state()?.entries[0]).toMatchObject({ category: token.category, token: { name: 'Example Dollar', symbol: 'XDOL', decimals: 2 }, source: { authhead: token.head, uri: `issuer${made}.example` } });
    const held = (await applications.tokens()).find((candidate) => candidate.category === token.category);
    expect(held?.registry).toEqual({ name: 'Example Dollar', symbol: 'XDOL', decimals: 2 });
    expect(`${formatUnits(held?.amount ?? 0n, held?.registry?.decimals ?? 0)} ${held?.registry?.symbol}`).toBe('123.45 XDOL');
    expect(files.requests).toHaveLength(1);
  });

  it('TR02: another hash, a host that is down, a file too large: nothing is shown, and it is tried again next session', async () => {
    const device = await deviceWith([]);
    const files = new Files();
    const wrongHash = published(device.chain, files, (category) => registryFile(category));
    files.served.set(`https://issuer${made}.example/.well-known/bitcoin-cash-metadata-registry.json`, registryFile(wrongHash.category, { name: 'Changed' }));
    const down = published(device.chain, files, (category) => registryFile(category));
    files.served.delete(`https://issuer${made}.example/.well-known/bitcoin-cash-metadata-registry.json`);
    const large = new Uint8Array(REGISTRY_LIMITS.bytes + 1).fill(0x20);
    const big = issuer(device.chain);
    big.extend(publicationOutput(sha256.hash(large), 'big.example'));
    files.served.set('https://big.example/.well-known/bitcoin-cash-metadata-registry.json', large);
    const { registries, state } = resolver(device.chain, files);
    await registries.refresh([wrongHash.category, down.category, big.category]);
    expect(state()?.entries.map((entry) => [entry.token, entry.unresolved])).toEqual([
      [undefined, 'The registry file is not the one the chain publishes: its hash differs.'],
      [undefined, 'The registry file could not be fetched.'],
      [undefined, 'The registry file is too large.'],
    ]);
    for (const category of [wrongHash.category, down.category, big.category]) expect(registries.known(category)).toBe(undefined);
    // The same session does not ask again; the next one does.
    const asked = files.requests.length;
    await registries.refresh([wrongHash.category, down.category, big.category]);
    expect(files.requests.length).toBe(asked);
    const next = resolver(device.chain, files, CHAIN, state());
    await next.registries.refresh([wrongHash.category, down.category, big.category]);
    expect(files.requests.length).toBe(asked + 3);
  });

  it('TR03: the registry names another category, breaks the symbol rule, or gives 19 decimals: nothing is shown', async () => {
    const device = await deviceWith([]);
    const files = new Files();
    const tokens = [
      published(device.chain, files, () => registryFile('cc'.repeat(32), { category: 'cc'.repeat(32) })),
      published(device.chain, files, (category) => registryFile(category, { symbol: 'lower' })),
      published(device.chain, files, (category) => registryFile(category, { decimals: 19 })),
    ];
    const { registries, state } = resolver(device.chain, files);
    await registries.refresh(tokens.map((token) => token.category));
    expect(state()?.entries.map((entry) => entry.token)).toEqual([undefined, undefined, undefined]);
    expect(state()?.entries.every((entry) => entry.unresolved !== undefined)).toBe(true);
  });

  it('TR04: a second publication later on the authchain replaces the kept result after the next look', async () => {
    const device = await deviceWith([]);
    const files = new Files();
    const token = published(device.chain, files, (category) => registryFile(category, { name: 'First', symbol: 'ONE' }));
    const { registries, state } = resolver(device.chain, files);
    await registries.refresh([token.category]);
    expect(registries.known(token.category)?.symbol).toBe('ONE');
    // Looking again with nothing new costs one request of the chain and no fetch.
    const chain = counted(device.chain);
    const again = resolver(chain, files, CHAIN, state());
    const before = files.requests.length;
    await again.registries.refresh([token.category]);
    expect([chain.requests, files.requests.length - before]).toEqual([2, 0]);
    const second = registryFile(token.category, { name: 'Second', symbol: 'TWO', decimals: 0 });
    files.served.set('https://second.example/r.json', second);
    token.extend(publicationOutput(sha256.hash(second), 'https://second.example/r.json'));
    token.extend();
    // Until the next look, the kept result stands.
    expect(again.registries.known(token.category)?.symbol).toBe('ONE');
    await again.registries.refresh([token.category], true);
    expect(again.registries.known(token.category)).toMatchObject({ name: 'Second', symbol: 'TWO', decimals: 0 });
    expect(again.state()?.entries[0]?.source).toMatchObject({ authhead: token.head, uri: 'https://second.example/r.json' });
  });

  it('TR05: an authchain of 25 links is resolved over three passes; a link at a busy script is left unresolved, never at a link that is not the head', async () => {
    const device = await deviceWith([]);
    const files = new Files();
    const token = published(device.chain, files, (category) => registryFile(category, { symbol: 'LONG' }));
    // 25 links in all: the authbase, the genesis, the publishing link, and 22 more.
    for (let link = 0; link < 22; link += 1) token.extend();
    const { registries, state } = resolver(device.chain, files);
    await registries.refresh([token.category]);
    expect(registries.known(token.category)).toBe(undefined);
    expect(state()?.entries[0]?.unresolved).toMatch(/longer than one look/);
    await registries.refresh([token.category], true);
    expect(registries.known(token.category)).toBe(undefined);
    await registries.refresh([token.category], true);
    expect(registries.known(token.category)?.symbol).toBe('LONG');
    expect(state()?.entries[0]?.source?.authhead).toBe(token.head);

    // A script with 5,000 history entries at a link: unresolved, never resolved at that link.
    const busy = published(device.chain, files, (category) => registryFile(category, { symbol: 'BUSY' }));
    busy.extend();
    const crowded: ChainReader = {
      getTransaction: (id) => device.chain.getTransaction(id),
      listUnspent: (script) => device.chain.listUnspent(script),
      getHistory: async (script) => [...(await device.chain.getHistory(script)), ...Array.from({ length: 5_000 }, (_, index) => ({ transactionId: index.toString(16).padStart(64, '0'), height: 1 }))],
    };
    const crowdedResolver = resolver(crowded, files);
    await crowdedResolver.registries.refresh([busy.category]);
    expect(crowdedResolver.registries.known(busy.category)).toBe(undefined);
    expect(crowdedResolver.state()?.entries[0]).toMatchObject({ reachedLink: busy.category, unresolved: expect.stringMatching(/too many transactions/) });
  });

  it('TR06: a burned identity: nothing is shown', async () => {
    const device = await deviceWith([]);
    const files = new Files();
    const token = published(device.chain, files, (category) => registryFile(category));
    const { registries, state } = resolver(device.chain, files);
    await registries.refresh([token.category]);
    expect(registries.known(token.category)).not.toBe(undefined);
    token.burn();
    await registries.refresh([token.category], true);
    expect(registries.known(token.category)).toBe(undefined);
    expect(state()?.entries[0]?.unresolved).toBe('The identity was burned.');
  });

  it('TR08: an amount typed with the token\'s decimals is sent exactly; one with too many places is refused', async () => {
    const device = await deviceWith([20_000n]);
    const files = new Files();
    const token = published(device.chain, files, (category) => registryFile(category, { decimals: 2 }), [{ lockingBytecode: await fresh(device), amount: 12_345n }]);
    const { registries } = resolver(device.chain, files);
    await registries.refresh([token.category]);
    const held = (await withRegistries(device, registries).tokens()).find((candidate) => candidate.category === token.category);
    const decimals = held?.registry?.decimals ?? 0;
    expect(parseUnits('100.07', decimals)).toBe(10_007n);
    expect(parseUnits('100.071', decimals)).toMatch(/2 decimals; the amount has more. Nothing is rounded/);
    const to = p2pkhLockingBytecode(testKey(0x45).keyHash);
    const sent = await device.wallet.sendTokens({ kind: 'fungible', category: token.category, amount: parseUnits('100.07', decimals) as bigint, to });
    const arrived = device.chain.outputsAt(to).find((coin) => hex(coin.transactionHash) === sent.transactionId);
    expect(arrived?.output.token?.amount).toBe(10_007n);
  });

  it('TR09: two held categories with the same symbol are marked; a reserved symbol is not shown', async () => {
    const device = await deviceWith([]);
    const files = new Files();
    const one = published(device.chain, files, (category) => registryFile(category, { symbol: 'TWIN' }), [{ lockingBytecode: await fresh(device), amount: 5n }]);
    const two = published(device.chain, files, (category) => registryFile(category, { symbol: 'TWIN-B' }), [{ lockingBytecode: await fresh(device), amount: 6n }]);
    const reserved = published(device.chain, files, (category) => registryFile(category, { symbol: 'BCH', name: 'Bitcoin Cash' }), [{ lockingBytecode: await fresh(device), amount: 7n }]);
    const { registries } = resolver(device.chain, files);
    await registries.refresh([one.category, two.category, reserved.category]);
    const held = await withRegistries(device, registries).tokens();
    const of = (category: string) => held.find((token) => token.category === category)?.registry;
    expect([of(one.category)?.symbol, of(one.category)?.sameSymbol, of(two.category)?.symbol, of(two.category)?.sameSymbol]).toEqual(['TWIN', true, 'TWIN', true]);
    expect(registries.known(reserved.category)?.symbol).toBe('BCH');
    expect(of(reserved.category)).toBe(undefined);
  });

  it('TR10 and sequential NFT types: a position\'s NFT keeps the template\'s name; another NFT takes the registry\'s name for its type', async () => {
    const device = await deviceWith([]);
    const files = new Files();
    const token = published(device.chain, files, (category) => registryFile(category, { symbol: 'TICKET', name: 'Tickets', types: { '01': 'Front row' } }), [
      { lockingBytecode: await fresh(device), commitment: '01' },
      { lockingBytecode: await fresh(device), commitment: '02' },
    ]);
    const { registries } = resolver(device.chain, files);
    await registries.refresh([token.category]);
    const held = (await withRegistries(device, registries).tokens()).filter((candidate) => candidate.category === token.category);
    expect(held.map((nft) => [nft.commitment, nft.meaning, nft.registry?.nftType, nft.registry?.name])).toEqual([
      ['01', 'unknown', 'Front row', 'Tickets'],
      ['02', 'unknown', undefined, 'Tickets'],
    ]);
  });

  it('TR12: after a recovery the new device resolves again and shows the same; nothing of it was in the backup', async () => {
    const device = await deviceWith([20_000n]);
    const files = new Files();
    const token = published(device.chain, files, (category) => registryFile(category, { name: 'Recovered Dollar', symbol: 'RDOL', decimals: 2 }), [{ lockingBytecode: await fresh(device), amount: 2_500n }]);
    const archiveId = device.arrangement.archive.archiveId;
    const blobs = async () => Promise.all([...device.stores.values()].map((store) => store.list(archiveId)));
    const stored = await blobs();
    const { registries } = resolver(device.chain, files);
    await registries.refresh([token.category]);
    const before = (await withRegistries(device, registries).tokens()).find((held) => held.category === token.category)?.registry;
    expect(before?.symbol).toBe('RDOL');
    // Resolving wrote nothing to the backup stores, and nothing of it is in the wallet's own state, which the backup is made from.
    expect(await blobs()).toEqual(stored);
    expect(JSON.stringify(device.state(), (_, value: unknown) => (typeof value === 'bigint' ? value.toString() : value))).not.toMatch(/Recovered Dollar|RDOL/);
    await device.recover();
    const next = await device.takeOver();
    await next.wallet.search();
    await next.wallet.sweepEarlier();
    const fresh_ = resolver(next.chain, files);
    expect((await withRegistries(next, fresh_.registries).tokens()).find((held) => held.category === token.category)?.registry).toBe(undefined);
    await fresh_.registries.refresh((await next.applications.tokens()).map((held) => held.category));
    expect((await withRegistries(next, fresh_.registries).tokens()).find((held) => held.category === token.category)?.registry).toEqual(before);
  }, 60_000);

  it('TR14: with the mode off or absent, nothing is asked and the token stays in raw units', async () => {
    const device = await deviceWith([]);
    const files = new Files();
    const token = published(device.chain, files, (category) => registryFile(category), [{ lockingBytecode: await fresh(device), amount: 9n }]);
    for (const config of [{ mode: 'off' } as RegistriesConfig, 'absent' as const]) {
      const chain = counted(device.chain);
      const { registries, state } = resolver(chain, files, config);
      await registries.refresh([token.category], true);
      expect([chain.requests, files.requests.length, state()]).toEqual([0, 0, undefined]);
      expect((await withRegistries(device, registries).tokens()).find((held) => held.category === token.category)?.registry).toBe(undefined);
    }
  });
});

describe('what the screens write', () => {
  it('TR11: a registry that resolves while a review is open does not change the review', async () => {
    const { frozenNames, tokenUnits } = await import('../apps/wallet/src/token-words.js');
    const category = 'ab'.repeat(32);
    const kept: { token?: { name: string; symbol: string; decimals: number } } = {};
    const live = (asked: string) => (asked === category ? kept.token : undefined);
    const review = frozenNames(live, [category]);
    kept.token = { name: 'Example Dollar', symbol: 'XDOL', decimals: 2 };
    expect(tokenUnits(12_345n, review(category))).toBe('12,345 units');
    // A review opened after it resolved shows the token's units.
    expect(tokenUnits(12_345n, frozenNames(live, [category])(category))).toBe('123.45 XDOL');
  });
});
