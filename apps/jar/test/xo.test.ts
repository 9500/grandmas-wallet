import { hexToBin } from '@bitauth/libauth';
import { applicationConnector, walletAnnouncement } from '@grandmas-wallet/app';
import { type Channel, type Proposal, type XoMessage, DappRequests, RequestRefusedError } from '@grandmas-wallet/connect';
import { savingsJarScript } from '@grandmas-wallet/savings-jar';
import { describe, expect, it } from 'vitest';

import { deviceWith } from '../../../test/support/applications.js';
import { JAR_TEMPLATE } from '../src/jar.js';
import { type PendingStore, STAGE_WORDS, XoJars, memoryStore, xoProblem } from '../src/xo.js';

/**
 * The Savings Jar page with this project's wallet: the page's own functions against the wallet's library,
 * over a connection in memory. The page builds no transaction; it asks for actions of its template.
 */

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
    return { jars: new XoJars(requests, store), requests, sentToWallet: wires.sentToWallet };
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
  it('the page works with what this wallet announces, and says why it cannot with another network', () => {
    const offered = walletAnnouncement('chipnet');
    expect(xoProblem(offered, 'chipnet')).toBeUndefined();
    expect(xoProblem(offered, 'regtest')).toContain('Your wallet is on chipnet; this page is on regtest');
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
    // The template went along only once the wallet said it did not have it; the page sent no transaction.
    expect(sentToWallet.filter((message) => message.action === 'xo_action_request' && message.definition !== undefined)).toHaveLength(1);

    expect(await jars.list()).toEqual({ trusted: true, jars: [{ category, unlockTime, satoshis: 40_000n, lockingBytecode: Buffer.from(script.lockingBytecode).toString('hex'), status: 'open' }] });

    // Paying in through the wallet, and by anyone with an ordinary payment to the jar's address.
    await answer(jars.deposit(category, 6_000n));
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
    expect(device.chain.balanceOf(script.lockingBytecode)).toBe(0n);
    expect((await device.wallet.balance()).recoverable).toBeGreaterThan(before + 49_000n);
    expect(await jars.list()).toMatchObject({ trusted: true, jars: [{ category, satoshis: 0n, status: 'empty' }] });

    // Someone pays in again; the key the wallet kept empties it.
    device.chain.fund(script.lockingBytecode, 9_000n);
    expect((await jars.list()).jars[0]).toMatchObject({ satoshis: 9_000n, status: 'open' });
    await answer(jars.withdraw(category));
    expect(device.chain.balanceOf(script.lockingBytecode)).toBe(0n);
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
});
