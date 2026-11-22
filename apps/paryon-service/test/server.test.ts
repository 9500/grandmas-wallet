import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { type Output, binToHex, hexToBin } from '@bitauth/libauth';
import {
  type ServiceRequest,
  type ServiceToken,
  buildServiceHello,
  buildServiceJoinRequest,
  buildServicePossibleRequest,
  readInvitationOutline,
  serviceExchange,
} from '@grandmas-wallet/connect';
import { type Utxo, keyPairFromPrivateKey, p2pkhInput, p2pkhLockingBytecode, readTemplate } from '@grandmas-wallet/core';
import {
  CHIPNET_FAST_PERIODS_6,
  PARYON_SERVICE_SPLIT,
  borrow,
  borrowerShare,
  closeLoan,
  collateralAtRatio,
  createLoanKey,
  decodePriceState,
  paryonChipnetTemplateTextV2,
  paryonContracts,
  paryonMainnetTemplateTextV3,
  serviceShare,
} from '@grandmas-wallet/paryon';
import type { XOInvitation } from '@xo-cash/types';
import { serializeInvitation } from '@xo-cash/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FixtureChain, outputOf, recordedDeployment, recordedOutputs } from '../../../packages/paryon/test/fixture-chain.js';
import type { EngineShare } from '../src/engine.js';
import { type EnginePart, type ServedNetwork, type ServiceConfig, Gate, RateLimit, createServiceServer, itemRef, paryonServiceHandlers, servedNetworks } from '../src/server.js';

/**
 * Paryon's service app: the networks a configuration has it serve, its answers to each message against Paryon's chipnet
 * deployment as recorded (packages/paryon/test/fixtures), the limits of its HTTP server and what it logs. The engine's
 * part of a join runs in a child process with an engine that must reach an Electrum server; here a stand-in takes its
 * place (it takes every invitation and appends a commit of its own), and the local run (spikes/xo-engine/39) carries
 * every action out with the real one.
 */

const production = JSON.parse(readFileSync(new URL('../../../deploy/config/production.json', import.meta.url), 'utf8')) as ServiceConfig;
const { served } = servedNetworks(production);
const chipnet = served.find(({ network }) => network === 'chipnet') as ServedNetwork;
const contracts = paryonContracts(CHIPNET_FAST_PERIODS_6);
const recorded = recordedDeployment('chipnet');
const chain = new FixtureChain(recordedOutputs(recorded), recorded.tip.height);

const key = keyPairFromPrivateKey(Uint8Array.from({ length: 32 }, () => 9));
const WALLET = p2pkhLockingBytecode(key.keyHash);
const WALLET_HEX = binToHex(WALLET);
let coins = 0;
const walletCoin = (satoshis: bigint): Utxo => {
  coins += 1;
  const utxo = { transactionHash: hexToBin(coins.toString(16).padStart(2, '0').repeat(32)), index: 0, output: { lockingBytecode: WALLET, valueSatoshis: satoshis } };
  chain.adopt(utxo);
  return utxo;
};
const utxoOf = (entry: (typeof recorded.borrowing)[number]): Utxo => ({ transactionHash: hexToBin(entry.transactionId), index: entry.index, output: outputOf(entry) });
const at = (built: { transactionHash: Uint8Array; transaction: { outputs: Output[] } }, index: number): Utxo => ({ transactionHash: built.transactionHash, index, output: built.transaction.outputs[index] as Output });
const outpoint = (utxo: Utxo): string => `${binToHex(utxo.transactionHash)}:${utxo.index}`;
const tokenOf = (utxo: Utxo, category: string): ServiceToken => ({ category, commitment: '', capability: 'minting', outpoint: outpoint(utxo) });

/** A wallet's invitation as XO serializes it: one commit in the borrower's role, with its values and coins. Signatures are the engine's to check. */
let invitations = 0;
const invitationText = (action: string, variables: Record<string, string>, inputs: string[], more: { templateIdentifier?: string; role?: string; commits?: XOInvitation['commits'] } = {}): string => {
  invitations += 1;
  const commit = {
    commitIdentifier: `c${invitations}`.padEnd(32, '0'),
    previousCommitIdentifier: undefined,
    entityIdentifier: 'tpubWallet',
    createdAtTimestamp: 1_795_000_000_000,
    data: {
      roleIdentifier: more.role ?? 'borrower',
      variables: Object.entries(variables).map(([variableIdentifier, value]) => ({ variableIdentifier, value, roleIdentifier: more.role ?? 'borrower' })),
      inputs: inputs.map((text) => ({ outpointTransactionHash: hexToBin(text.split(':')[0] as string), outpointIndex: Number(text.split(':')[1]) })),
    },
    signature: '00',
    expiresAtTimestamp: 1_795_000_900_000,
  };
  const invitation = { invitationIdentifier: `i${invitations}`.padEnd(32, '0'), createdAtTimestamp: 1_795_000_000_000, templateIdentifier: more.templateIdentifier ?? chipnet.template.identifier, actionIdentifier: action, commits: more.commits ?? [commit] };
  return serializeInvitation(invitation as unknown as XOInvitation);
};

/** The engine's part, stood in for: takes every invitation (or refuses, when told), and appends one commit of the service's. */
const shares: EngineShare[] = [];
const standIn =
  (options: { refuse?: string; hold?: Promise<void> } = {}): EnginePart =>
  ({ invitation }) => ({
    checked: (options.hold ?? Promise.resolve()).then(() => (options.refuse === undefined ? { ok: true as const } : { ok: false as const, reason: options.refuse })),
    join: async (share) => {
      shares.push(share);
      const parsed = JSON.parse(invitation) as { commits: Record<string, unknown>[] };
      parsed.commits.push({ commitIdentifier: 'service'.padEnd(32, '0'), entityIdentifier: 'tpubService', data: { roleIdentifier: 'service' } });
      return JSON.stringify(parsed);
    },
    stop: () => undefined,
  });

const chainOf = (network: string) => {
  if (network !== 'chipnet') throw new Error(`no chain for ${network} in this test`);
  return chain;
};
const handlersWith = (engine: EnginePart) => paryonServiceHandlers(served, { chainOf, engine, pick: () => 0 });

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/service/v1`;
};
const close = (server: Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

const template = chipnet.template;
const fields = (id: string) => ({ network: 'chipnet', id, template, role: 'borrower' });
let ids = 0;
const nextId = () => `t${(ids += 1)}`;

// The course on the recorded chain: a key made, a loan opened with it, the loan closed; with a moment kept of each.
const DEBT = 200_00n;
const STORED_PRICE = recorded.price.map((entry) => decodePriceState(hexToBin(entry.token?.nft?.commitment ?? '')).price).reduce((a, b) => (a > b ? a : b));
const priceEntry = recorded.price.find((entry) => decodePriceState(hexToBin(entry.token?.nft?.commitment ?? '')).price === STORED_PRICE) as (typeof recorded.price)[number];
const COLLATERAL = collateralAtRatio(DEBT, STORED_PRICE, 125n);
const defining = walletCoin(COLLATERAL + 10_000_000n);
const keyCategory = binToHex(defining.transactionHash);

describe('the networks a configuration has the service serve', () => {
  it('production: chipnet and mainnet with the frozen texts of version 3, and the mockup network with a template made for its deployment, naming the service beside the loan page', () => {
    expect(served.map(({ network }) => network)).toEqual(['chipnet', 'mainnet', 'mockup']);
    expect(chipnet.template.identifier).toBe('160a451f5398db649de7d660855db24113b774559534361f8334cbfe9a583e20');
    expect(served[1]?.template).toEqual({ identifier: readTemplate(paryonMainnetTemplateTextV3).identifier, contentHash: readTemplate(paryonMainnetTemplateTextV3).contentHash });
    const mockup = served[2] as ServedNetwork;
    expect(mockup.ownChain).toBe(true);
    expect(mockup.engineNetwork).toBe('chipnet');
    expect((JSON.parse(mockup.templateText) as { resources: { name: string; url: string }[] }).resources.map(({ url }) => url)).toEqual(['https://paryon.9500.cash/service/v1', 'https://paryon.9500.cash/']);
    expect(served[1]?.engineNetwork).toBe('mainnet');
  });

  it('the identifiers deploy/check-public.mjs expects of the public service are those of the frozen texts of version 3', () => {
    const check = readFileSync(new URL('../../../deploy/check-public.mjs', import.meta.url), 'utf8');
    for (const network of served.filter(({ ownChain }) => !ownChain)) {
      expect(check).toContain(`${network.network}: { identifier: '${network.template.identifier}', contentHash: '${network.template.contentHash}' }`);
    }
  });

  it('mainnet only where the configuration allows it, exactly as the pages decide it', () => {
    const { mainnetEnabled: _, ...withoutMainnet } = production;
    expect(servedNetworks(withoutMainnet).served.map(({ network }) => network)).toEqual(['chipnet', 'mockup']);
    const mainnetAlone = JSON.parse(readFileSync(new URL('../../../deploy/config/mainnet.example.json', import.meta.url), 'utf8')) as ServiceConfig;
    expect(servedNetworks(mainnetAlone).served.map(({ network }) => network)).toEqual(['mainnet']);
    expect(() => servedNetworks({ ...mainnetAlone, mainnetEnabled: false })).toThrow(/does not allow it/);
  });

  it('a network without a deployment of Paryon\'s, or without servers, is not served', () => {
    const regtest = JSON.parse(readFileSync(new URL('../../../deploy/config/local-regtest.json', import.meta.url), 'utf8')) as ServiceConfig;
    expect(servedNetworks(regtest)).toEqual({ served: [], skipped: [{ network: 'regtest', reason: expect.stringMatching(/no deployment/) as unknown }] });
    expect(servedNetworks({ ...regtest, paryon: production.networks?.['mockup']?.paryon }).served.map(({ network, ownChain }) => [network, ownChain])).toEqual([['regtest', true]]);
    expect(servedNetworks({ network: 'chipnet', chain: [] }).skipped).toEqual([{ network: 'chipnet', reason: expect.stringMatching(/no server/) as unknown }]);
  });
});

describe('the messages', () => {
  let server: Server;
  let url: string;
  const lines: string[] = [];
  beforeAll(async () => {
    server = createServiceServer({ handlers: handlersWith(standIn()), log: (line) => lines.push(line) });
    url = await listen(server);
  });
  afterAll(() => close(server));
  const ask = async <R extends ServiceRequest>(message: R) => {
    const outcome = await serviceExchange(url, message);
    if (!outcome.carried) throw new Error(`not carried: ${JSON.stringify(outcome)}`);
    return outcome.answer;
  };

  it('hello: the template it serves on the message\'s network, in the role of the service; any other template or role, or another network, not', async () => {
    expect(await ask(buildServiceHello(fields(nextId())))).toMatchObject({ ok: true, serves: [{ template, role: 'service' }] });
    const v2 = readTemplate(paryonChipnetTemplateTextV2);
    expect(await ask(buildServiceHello({ ...fields(nextId()), template: { identifier: v2.identifier, contentHash: v2.contentHash } }))).toMatchObject({ ok: false, code: 'unknown-template' });
    expect(await ask(buildServiceHello({ ...fields(nextId()), role: 'service' }))).toMatchObject({ ok: false, code: 'unknown-template' });
    // The mockup network's template is another, made for its deployment.
    expect(await ask(buildServiceHello({ ...fields(nextId()), network: 'mockup' }))).toMatchObject({ ok: false, code: 'unknown-template' });
    expect(await ask(buildServiceHello({ ...fields(nextId()), network: 'testnet4' }))).toMatchObject({ ok: false, code: 'wrong-network' });
  });

  it('possible, and join, through the course of a loan: each item with a ref; refusals with the library\'s plain reasons; a join adds exactly one commit', async () => {
    // Nothing held: the starting actions.
    const nothing = await ask(buildServicePossibleRequest({ ...fields(nextId()), tokens: [], made: [] }));
    expect(nothing).toMatchObject({ ok: true, height: recorded.tip.height, items: [] });
    expect(nothing.ok && nothing.start.map(({ action }) => action)).toEqual(['createKey', 'movePeriod']);

    // A key made: the borrowing, with a ref, the script the key waits at, as hex, and the coin.
    const factory = utxoOf(recorded.loanKeyFactory[0] as (typeof recorded.loanKeyFactory)[number]);
    const created = createLoanKey({ contracts, factory, defining: p2pkhInput(defining, key), changeTo: WALLET }).built;
    chain.add(created);
    const waiting = await ask(buildServicePossibleRequest({ ...fields(nextId()), tokens: [], made: [{ category: keyCategory, transactionId: created.transactionId }] }));
    expect(waiting.ok && waiting.items).toEqual([
      {
        ref: itemRef('borrow', keyCategory),
        category: keyCategory,
        action: 'borrow',
        lockingScript: binToHex(contracts.loanKeyOriginEnforcer.lockingBytecode),
        coin: `${created.transactionId}:2`,
        about: { category: keyCategory, spent: false },
        bindings: { keyHolder: 'receive', tokensHolder: 'receive' },
      },
    ]);
    expect(itemRef('changeInterest', keyCategory).length).toBeLessThanOrEqual(128);

    // A loan opened: its four actions, each with its ref.
    const funding = walletCoin(COLLATERAL + 10_000_000n);
    const opened = borrow({
      contracts,
      borrowing: utxoOf(recorded.borrowing[0] as (typeof recorded.borrowing)[number]),
      price: utxoOf(priceEntry),
      enforcer: at(created, 2),
      proof: at(created, 3),
      wallet: [p2pkhInput(funding, key)],
      debt: DEBT,
      collateral: COLLATERAL,
      startingInterest: 256,
      keyTo: WALLET,
      tokensTo: WALLET,
      changeTo: WALLET,
    }).built;
    chain.add(opened);
    const keyCoin = at(opened, 5);
    const open = await ask(buildServicePossibleRequest({ ...fields(nextId()), tokens: [tokenOf(keyCoin, keyCategory)], made: [] }));
    expect(open.ok && open.items.map(({ action, ref, coin, lockingScript }) => [action, ref, coin, lockingScript])).toEqual(
      ['manage', 'repay', 'close', 'changeInterest'].map((action) => [action, itemRef(action, keyCategory), `${opened.transactionId}:2`, binToHex(contracts.loan.lockingBytecode)]),
    );

    // Joins on the open loan: below 110%, refused with the library's reason; enough, joined with exactly one commit.
    const manage = borrowerShare('manage', { keyCategory, collateral: 1_000n, keyHolder: WALLET_HEX });
    const below = await ask(buildServiceJoinRequest({ network: 'chipnet', id: nextId(), ref: itemRef('manage', keyCategory), invitation: invitationText('manage', manage, [outpoint(keyCoin)]) }));
    expect(below).toMatchObject({ ok: false, code: 'not-possible', error: expect.stringMatching(/below 110% of the debt/) as unknown });
    const sent = invitationText('manage', { ...manage, collateral: String(COLLATERAL + 100_000n) }, [outpoint(keyCoin)]);
    const joined = await ask(buildServiceJoinRequest({ network: 'chipnet', id: nextId(), ref: itemRef('manage', keyCategory), invitation: sent }));
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(readInvitationOutline(joined.invitation).commits.length).toBe(readInvitationOutline(sent).commits.length + 1);
    const share = shares.at(-1) as EngineShare;
    expect(Object.keys(share.variables)).toEqual([...PARYON_SERVICE_SPLIT.manage.service]);
    expect(share.inputs.map(({ inputIdentifier }) => inputIdentifier)).toEqual(['priceInput', 'loanInput', 'sidecarInput', 'manageInput']);
    // A ref of another item is refused.
    expect(await ask(buildServiceJoinRequest({ network: 'chipnet', id: nextId(), ref: itemRef('close', keyCategory), invitation: sent }))).toMatchObject({ ok: false, code: 'bad-invitation' });

    // The loan closed: nothing possible for the key; a join refused with the library's reason.
    const closing = await serviceShare(chipnet.service, 'close', { variables: borrowerShare('close', { keyCategory, keyHolder: WALLET_HEX }), inputs: [outpoint(keyCoin)] }, chain, { pick: () => 0 });
    if (!closing.ok) throw new Error(closing.reason);
    const coinOf = (input: string) => closing.inputs.find(({ inputIdentifier }) => inputIdentifier === input)?.coin as Utxo;
    const closed = closeLoan({
      contracts,
      price: coinOf('priceInput'),
      loan: coinOf('loanInput'),
      sidecar: coinOf('sidecarInput'),
      manageFunction: coinOf('repayInput'),
      key: p2pkhInput(keyCoin, key),
      wallet: [p2pkhInput(at(opened, 6), key), p2pkhInput(walletCoin(1_000_000n), key)],
      keyTo: WALLET,
      changeTo: WALLET,
    }).built;
    chain.add(closed);
    const after = await ask(buildServicePossibleRequest({ ...fields(nextId()), tokens: [tokenOf(at(closed, 4), keyCategory)], made: [] }));
    expect(after.ok && after.items).toEqual([]);
    const late = await ask(buildServiceJoinRequest({ network: 'chipnet', id: nextId(), invitation: invitationText('manage', { ...manage, collateral: String(COLLATERAL) }, [outpoint(at(closed, 4))]) }));
    expect(late).toEqual(expect.objectContaining({ ok: false, code: 'not-possible', error: 'This key has no open loan: it was closed, or it never opened one.' }));
  });

  it('join: refuses an invitation it cannot read, of another template, of an action outside the template, or with commits not the wallet\'s alone', async () => {
    const join = (invitation: string) => ask(buildServiceJoinRequest({ network: 'chipnet', id: nextId(), invitation }));
    const variables = borrowerShare('createKey', { keyCategory });
    // Not an invitation at all: the parser refuses the message.
    const notJson = await serviceExchange(url, { action: 'xo_service_join_request', version: 1, network: 'chipnet', id: nextId(), time: 1, invitation: 'not an invitation' } as never);
    expect(notJson).toMatchObject({ carried: true, answer: { ok: false, code: 'bad-invitation' } });
    expect(await join(invitationText('createKey', variables, [], { templateIdentifier: 'ab'.repeat(32) }))).toMatchObject({ ok: false, code: 'unknown-template' });
    expect(await join(invitationText('liquidate', variables, []))).toMatchObject({ ok: false, code: 'bad-invitation', error: expect.stringMatching(/not an action of the template/) as unknown });
    expect(await join(invitationText('createKey', variables, [], { role: 'service' }))).toMatchObject({ ok: false, code: 'bad-invitation' });
    const two = JSON.parse(invitationText('createKey', variables, [])) as { commits: Record<string, unknown>[] };
    two.commits.push({ ...two.commits[0], commitIdentifier: 'other'.padEnd(32, '0'), entityIdentifier: 'tpubSomeoneElse' });
    expect(await join(JSON.stringify(two))).toMatchObject({ ok: false, code: 'bad-invitation', error: expect.stringMatching(/more than one participant/) as unknown });
  });

  it('join: an invitation the engine does not take is refused with its reason', async () => {
    const strict = createServiceServer({ handlers: handlersWith(standIn({ refuse: 'The invitation does not pass the engine\'s checks: a signature does not verify' })), log: () => undefined });
    const address = await listen(strict);
    try {
      const answer = await serviceExchange(address, buildServiceJoinRequest({ network: 'chipnet', id: nextId(), invitation: invitationText('createKey', borrowerShare('createKey', { keyCategory }), [outpoint(defining)]) }));
      expect(answer).toMatchObject({ carried: true, answer: { ok: false, code: 'bad-invitation', error: expect.stringMatching(/signature/) as unknown } });
    } finally {
      await close(strict);
    }
  });

  it('logs one line per message: its kind, its network, what became of it and how long it took; no address, token, coin or value', () => {
    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) expect(line).toMatch(/^(hello|possible|join|unreadable) (chipnet|mainnet|mockup|regtest|testnet3|testnet4|-) [a-z0-9-]+ \d+ms$/);
    expect(lines).toContain(lines.find((line) => /^join chipnet not-possible \d+ms$/.test(line)));
    const secrets = [keyCategory, ...shares.flatMap((share) => share.inputs.map(({ outpoint: coin }) => coin.split(':')[0] as string)), '127.0.0.1', WALLET_HEX];
    for (const secret of secrets) expect(lines.join('\n')).not.toContain(secret.slice(0, 16));
  });
});

describe('the limits', () => {
  it('per address and hour, in memory, by the address the proxy adds last to X-Forwarded-For: then 429 too-many with retry-after', async () => {
    const lines: string[] = [];
    const server = createServiceServer({ handlers: handlersWith(standIn()), limit: new RateLimit({ hello: 2, possible: 1, join: 1 }, () => 1_000_000), log: (line) => lines.push(line) });
    const url = await listen(server);
    try {
      const hello = (client: string) =>
        fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.1, ${client}` }, body: JSON.stringify({ xo_service_v1: buildServiceHello(fields(nextId())) }) });
      expect((await hello('203.0.113.7')).status).toBe(200);
      expect((await hello('203.0.113.7')).status).toBe(200);
      const third = await hello('203.0.113.7');
      expect(third.status).toBe(429);
      expect(third.headers.get('retry-after')).toBe('3600');
      expect(third.headers.get('access-control-allow-origin')).toBe('*');
      expect(((await third.json()) as { xo_service_v1: { code: string } }).xo_service_v1.code).toBe('too-many');
      expect((await hello('203.0.113.8')).status).toBe(200);
      expect(lines.at(-2)).toMatch(/^hello chipnet http-429 \d+ms$/);
      expect(lines.join('\n')).not.toContain('203.0.113');
    } finally {
      await close(server);
    }
  });

  it('joins at once and waiting are few: beyond them 429 too-many with retry-after', async () => {
    let release = (): void => undefined;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const server = createServiceServer({ handlers: handlersWith(standIn({ hold })), joins: new Gate(1, 0), joinWaitMs: 50, log: () => undefined });
    const url = await listen(server);
    try {
      const invitation = invitationText('createKey', borrowerShare('createKey', { keyCategory }), [outpoint(defining)]);
      const first = serviceExchange(url, buildServiceJoinRequest({ network: 'chipnet', id: nextId(), invitation }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      const second = await serviceExchange(url, buildServiceJoinRequest({ network: 'chipnet', id: nextId(), invitation }));
      expect(second).toMatchObject({ carried: false, failure: 'status', status: 429, retryAfter: 5, code: 'too-many' });
      release();
      expect(await first).toMatchObject({ carried: true, answer: { ok: true } });
    } finally {
      release();
      await close(server);
    }
  });

  it('a body larger than the protocol allows is refused with 413; another path is not the service', async () => {
    const server = createServiceServer({ handlers: handlersWith(standIn()), log: () => undefined });
    const url = await listen(server);
    try {
      const large = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(70_000) }).catch(() => undefined);
      // The server answers before it has read the whole body and closes the connection; a client sees 413 or a closed connection.
      if (large !== undefined) expect(large.status).toBe(413);
      expect((await fetch(url.replace('/service/v1', '/other'))).status).toBe(404);
      const preflight = await fetch(url, { method: 'OPTIONS' });
      expect([preflight.status, preflight.headers.get('access-control-allow-methods')]).toEqual([204, 'POST, OPTIONS']);
    } finally {
      await close(server);
    }
  });
});
