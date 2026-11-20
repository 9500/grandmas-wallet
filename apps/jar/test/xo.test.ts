import { hexToBin } from '@bitauth/libauth';
import { applicationConnector, walletAnnouncement } from '@grandmas-wallet/app';
import { type Channel, type Proposal, type XoMessage, DappRequests, RequestRefusedError } from '@grandmas-wallet/connect';
import { savingsJarScript, unlockTimeBytes } from '@grandmas-wallet/savings-jar';
import { describe, expect, it } from 'vitest';

import { deviceWith } from '../../../test/support/applications.js';
import { JAR_TEMPLATE } from '../src/jar.js';
import { type PendingStore, STAGE_WORDS, XoJars, jarOfPosition, memoryStore, xoProblem } from '../src/xo.js';

/**
 * The Savings Jar page with this project's wallet: the page's own functions against the wallet's library,
 * over a connection in memory. The page builds no transaction; it asks for actions of its template, version 4,
 * with requests of version 2 of `xo_v1`: no recovery declaration is named or sent (proposal section 15.3).
 */

const PAGE = 'https://jar.example/';

/** A pair of queues between the page and the wallet. Everything goes through JSON and back, as it travels. */
const link = () => {
  const toWallet: ((message: unknown) => void)[] = [];
  const toDapp: ((message: unknown) => void)[] = [];
  const sentToWallet: XoMessage[] = [];
  let sequence = 0;
  const end = (out: ((message: unknown) => void)[], incoming: ((message: unknown) => void)[], log?: XoMessage[]): Channel => ({
    send: async (message) => {
      log?.push(message);
      for (const handler of [...out]) handler(JSON.parse(JSON.stringify(message)));
    },
    onMessage: (handler) => {
      incoming.push(handler);
      return () => void incoming.splice(incoming.indexOf(handler), 1);
    },
    nextSequence: () => (sequence += 2),
  });
  return { dappEnd: end(toWallet, toDapp, sentToWallet), walletEnd: end(toDapp, toWallet), sentToWallet };
};

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn++) await new Promise((done) => setTimeout(done, 0));
};

/** The wallet with its side of sessions; the user approves whatever the wallet shows, unless told not to. */
const setUp = async () => {
  const device = await deviceWith([100_000n, 60_000n]);
  let proposals: Proposal[] = [];
  const connector = applicationConnector(device.applications, { onProposals: (open) => (proposals = open) });
  /** The page, loaded (again) and connected under one pairing. */
  const page = (store: PendingStore) => {
    const wires = link();
    connector.attach('savings jar page', wires.walletEnd);
    const requests = new DappRequests();
    requests.attach(wires.dappEnd);
    // The page reads each jar's balance from the chain itself.
    return { jars: new XoJars(requests, store, { listUnspent: (lockingBytecode) => device.chain.listUnspent(lockingBytecode) }, PAGE), requests, sentToWallet: wires.sentToWallet };
  };
  /** Wait for the wallet to show the request, then approve or decline it as the user. */
  const answer = async <T>(asked: Promise<T>, approve = true): Promise<T> => {
    await settle();
    const [proposal] = proposals;
    if (proposal === undefined) throw new Error('the wallet shows nothing to approve');
    await (approve ? proposal.approve() : proposal.decline());
    return asked;
  };
  return { device, page, answer, proposals: () => proposals };
};

describe('savings jars with a wallet that speaks xo_v1', () => {
  it('the page works with what this wallet announces, version 2, and says why it cannot with another network, or with a wallet of another version', () => {
    const offered = walletAnnouncement('chipnet');
    expect(offered).toEqual({ version: 2, network: 'chipnet', bindings: ['receive', 'change', 'return', 'lasting'] });
    expect(xoProblem(offered, 'chipnet')).toBeUndefined();
    expect(xoProblem(offered, 'regtest')).toContain('Your wallet is on chipnet; this page is on regtest');
    expect(xoProblem({ version: 1, network: 'chipnet', bindings: ['receive', 'change', 'return', 'lasting'] }, 'chipnet')).toMatch(/another version of XO requests/);
  });

  it('opens a jar, lists it, takes a payment in, refuses to empty it before its date in the wallet\'s words, empties it after, and lists the empty jar with its key kept', async () => {
    const { device, page, answer } = await setUp();
    const { jars, sentToWallet } = page(memoryStore());

    // Before the page was used with this wallet: an empty start, not an error.
    expect(await jars.list()).toEqual({ trusted: false, jars: [] });

    const unlockTime = Math.floor(device.chain.nowMs / 1000) + 3_600;
    const stages: string[] = [];
    const opened = await answer(jars.open(40_000n, unlockTime, (stage) => stages.push(stage)));
    expect(stages).toEqual(['sent', 'accepted', 'approved', 'recorded', 'on-network']);
    expect(stages.every((stage) => STAGE_WORDS[stage as keyof typeof STAGE_WORDS] !== undefined)).toBe(true);
    expect(opened.transactionId).toMatch(/^[0-9a-f]{64}$/);
    const category = opened.category as string;
    const script = savingsJarScript(hexToBin(category), unlockTime);
    expect(device.chain.balanceOf(script.lockingBytecode)).toBe(40_000n);
    // The template went along only once the wallet said it did not have it, alone; the page sent no transaction.
    const requests = sentToWallet.filter((message) => message.action === 'xo_action_request');
    expect(requests.filter((message) => message.definition !== undefined).map((message) => message.definition)).toEqual([{ template: JAR_TEMPLATE.texts.template }]);
    expect(requests.every((message) => Object.keys(message.template).sort().join() === 'contentHash,identifier' && message.page === PAGE)).toBe(true);
    // The wallet's record of the jar keeps the page's address.
    expect(device.applications.positionRecords.map(({ token, applicationPage }) => [token?.category, applicationPage])).toEqual([[category, PAGE]]);

    expect(await jars.list()).toEqual({ trusted: true, jars: [{ category, unlockTime, satoshis: 40_000n, lockingBytecode: Buffer.from(script.lockingBytecode).toString('hex'), status: 'open' }] });

    // Paying in through the wallet, and by anyone with an ordinary payment to the jar's address.
    await answer(jars.deposit(category, 6_000n));
    expect(sentToWallet.at(-1)).toMatchObject({ templateAction: 'deposit', variables: { savedSatoshis: 6_000 }, about: { category, spent: false } });
    device.chain.fund(script.lockingBytecode, 4_000n);
    expect((await jars.list()).jars[0]?.satoshis).toBe(50_000n);

    // Before its date: the wallet's own words come back, and nothing moves.
    const early = jars.withdraw(category);
    const refused = await answer(early).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(RequestRefusedError);
    expect((refused as Error).message).toContain('non-final');
    expect(device.chain.balanceOf(script.lockingBytecode)).toBe(50_000n);
    expect(jars.pending()).toEqual([]);

    device.chain.nowMs += 3_700 * 1000;
    const before = (await device.wallet.balance()).recoverable;
    await answer(jars.withdraw(category));
    // Emptying names the jar's key, and that it is spent; nothing else.
    expect(sentToWallet.filter((message) => message.action === 'xo_action_request').at(-1)).toMatchObject({ templateAction: 'withdraw', variables: {}, about: { category, spent: true } });
    expect(device.chain.balanceOf(script.lockingBytecode)).toBe(0n);
    expect((await device.wallet.balance()).recoverable).toBeGreaterThan(before + 49_000n);
    expect(await jars.list()).toMatchObject({ trusted: true, jars: [{ category, satoshis: 0n, status: 'empty' }] });

    // Someone pays in again; the key the wallet kept empties it.
    device.chain.fund(script.lockingBytecode, 9_000n);
    expect((await jars.list()).jars[0]).toMatchObject({ satoshis: 9_000n, status: 'open' });
    await answer(jars.withdraw(category));
    expect(device.chain.balanceOf(script.lockingBytecode)).toBe(0n);
  }, 60_000);

  it('a request the network refuses because a coin was spent first ends with the wallet\'s code and words, is not kept and not asked again, and the wallet\'s coins are free for the next', async () => {
    const { device, page, answer, proposals } = await setUp();
    const { jars, sentToWallet } = page(memoryStore());
    const unlockTime = Math.floor(device.chain.nowMs / 1000) + 3_600;
    const { category } = await answer(jars.open(20_000n, unlockTime));
    const before = await device.wallet.balance();
    // The node's words, as a server passes them on.
    const original = device.chain.broadcast;
    device.chain.broadcast = async () => {
      device.chain.broadcast = original;
      return { accepted: false, reason: 'the transaction was rejected by network rules.\n\ntxn-mempool-conflict (code 18)' };
    };
    const refused = await answer(jars.deposit(category as string, 6_000n)).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(RequestRefusedError);
    expect(refused).toMatchObject({ code: 'inputs-spent', message: expect.stringContaining('txn-mempool-conflict') as string });
    expect(jars.pending()).toEqual([]);
    await settle();
    expect(proposals()).toEqual([]);
    expect(sentToWallet.filter((message) => message.action === 'xo_action_request' && message.templateAction === 'deposit')).toHaveLength(1);
    expect((await device.wallet.balance()).recoverable).toBe(before.recoverable);
    // The same coins pay for the next request.
    await answer(jars.deposit(category as string, 6_000n));
    expect(device.chain.balanceOf(savingsJarScript(hexToBin(category as string), unlockTime).lockingBytecode)).toBe(26_000n);
  }, 60_000);

  it('a request survives a reload of the page: sent again under its identifier, it gets the outcome the wallet stored, and nothing is done twice', async () => {
    const { device, page, answer, proposals } = await setUp();
    const store = memoryStore();
    const first = page(store);
    const unlockTime = Math.floor(device.chain.nowMs / 1000) + 600;
    const asked = first.jars.open(20_000n, unlockTime);
    await settle();
    expect(store.get()).toHaveLength(1);
    // The page is closed while the user approves in the wallet: no one hears the outcome.
    first.requests.detach();
    await proposals()[0]?.approve();
    void asked.catch(() => undefined);
    const broadcasts = device.chain.broadcasts;

    // Loaded again, the page finds the request it kept and sends it once more.
    const again = page(store);
    const [kept] = again.jars.pending();
    if (kept === undefined) throw new Error('the request was not kept');
    const outcome = await again.jars.resume(kept);
    expect(outcome.category).toMatch(/^[0-9a-f]{64}$/);
    expect(device.chain.broadcasts).toBe(broadcasts);
    expect(store.get()).toEqual([]);
    expect((await again.jars.list()).jars).toHaveLength(1);

    // A request the user declines is refused in the wallet's words, and is not kept.
    const declined = await answer(again.jars.open(20_000n, unlockTime + 60), false).catch((error: unknown) => error);
    expect(declined).toBeInstanceOf(RequestRefusedError);
    expect(store.get()).toEqual([]);
    // The template is named by its hashes, as the page computes them from the texts.
    expect(JAR_TEMPLATE.names.identifier).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);

  it('shows a jar from the wallet\'s answer only where the record\'s script is the jar the key names; one the wallet does not confirm is shown as such', () => {
    const category = 'c1'.repeat(32);
    const unlockTime = 1_900_000_000;
    const commitment = Buffer.from(unlockTimeBytes(unlockTime)).toString('hex');
    const reported = { category, commitment, capability: 'none', satoshis: '1000', status: 'open' as const, lockingScript: 'savingsJarLockingScript', variables: { keyCategory: category, unlockTime: String(unlockTime) } };
    expect(jarOfPosition(reported, 5_000n)).toMatchObject({ category, unlockTime, satoshis: 5_000n, status: 'open' });
    expect(jarOfPosition({ ...reported, status: 'closed' }, 0n)).toMatchObject({ status: 'empty' });
    expect(jarOfPosition({ ...reported, status: 'unconfirmed' }, 5_000n)).toMatchObject({ status: 'unconfirmed' });
    // A record whose values are not those the key carries names another script: it is not this page's jar.
    expect(jarOfPosition({ ...reported, variables: { keyCategory: category, unlockTime: String(unlockTime + 1) } }, 5_000n)).toBeUndefined();
    expect(jarOfPosition({ ...reported, variables: { keyCategory: 'ab'.repeat(32), unlockTime: String(unlockTime) } }, 5_000n)).toBeUndefined();
  });
});
