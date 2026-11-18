import { readFileSync } from 'node:fs';

import { type Output, binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { applicationConnector } from '@grandmas-wallet/app';
import { type Channel, type Proposal, type XoMessage, DappRequests } from '@grandmas-wallet/connect';
import { decodeLoanState, decodePriceState } from '@grandmas-wallet/paryon';
import { describe, expect, it } from 'vitest';

import { type Device, deviceWith } from '../../../test/support/applications.js';
import { CONTRACTS, DEFAULT_PERCENT, borrowPlan, partRepayment, periodNeed } from '../src/loan.js';
import { type PageChain, readMarket } from '../src/market.js';
import { type KeptKey, type PendingRequest, XoLoans, memoryKept, xoProblem } from '../src/xo.js';

/**
 * The loan page with this project's wallet: the page's own functions against the wallet's library, over a
 * connection in memory, on a simulated chain that holds Paryon's live chipnet outputs as they were recorded.
 * The page builds no transaction; it asks for actions of its template, and reads the chain for Paryon's
 * contracts, prices and loans.
 */

interface RecordedOutput {
  transactionId: string;
  index: number;
  valueSatoshis: string;
  lockingBytecode: string;
  token?: { category: string; amount: string; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string } };
}
const recorded = JSON.parse(readFileSync(new URL('../../../packages/paryon/test/fixtures/chipnet-live.json', import.meta.url), 'utf8')) as Record<'borrowing' | 'price' | 'loanKeyFactory' | 'manage', RecordedOutput[]> & { tip: { height: number } };
const outputOf = (entry: RecordedOutput): Output => ({
  lockingBytecode: hexToBin(entry.lockingBytecode),
  valueSatoshis: BigInt(entry.valueSatoshis),
  ...(entry.token === undefined
    ? {}
    : { token: { category: hexToBin(entry.token.category), amount: BigInt(entry.token.amount), ...(entry.token.nft === undefined ? {} : { nft: { capability: entry.token.nft.capability, commitment: hexToBin(entry.token.nft.commitment) } }) } }),
});
const STORED = recorded.price.map((entry) => decodePriceState(hexToBin(entry.token?.nft?.commitment ?? '')).price).reduce((low, price) => (price < low ? price : low));
/** The oracle, a quarter below the stored price, as on chipnet while Paryon's keepers are stopped. */
const ORACLE = (STORED * 3n) / 4n;

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
  for (let turn = 0; turn < 40; turn++) await new Promise((done) => setTimeout(done, 0));
};

/** The wallet with Paryon's outputs on its chain, and the page connected to it. The user approves what the wallet shows. */
const setUp = async (satoshis = 70_000_000n) => {
  const device: Device = await deviceWith([satoshis]);
  device.chain.adopt([...recorded.borrowing, ...recorded.price, ...recorded.loanKeyFactory, ...recorded.manage].map((entry) => ({ transactionId: entry.transactionId, index: entry.index, output: outputOf(entry) })));
  // Ten blocks past the recording: the freshest borrowing contract is then two periods behind.
  const chain: PageChain = {
    getTransaction: (transactionId) => device.chain.getTransaction(transactionId),
    // The simulated chain lists a token's category only; without token data the page reads each output itself.
    listUnspent: async (lockingBytecode) => (await device.chain.listUnspent(lockingBytecode)).map(({ token: _token, ...rest }) => rest),
    tip: async () => ({ height: recorded.tip.height + 100 }),
  };
  let proposals: Proposal[] = [];
  const connector = applicationConnector(device.applications, { onProposals: (open) => (proposals = open) });
  const pending = memoryKept<PendingRequest>();
  const keys = memoryKept<KeptKey>();
  /** The page, loaded (again) and connected under one pairing, with what it kept between visits. */
  const page = () => {
    const wires = link();
    connector.attach('loan page', wires.walletEnd);
    const requests = new DappRequests();
    requests.attach(wires.dappEnd);
    return { loans: new XoLoans(requests, chain, pending, keys), requests, sentToWallet: wires.sentToWallet };
  };
  const first = page();
  const { loans } = first;
  const answer = async <T>(asked: Promise<T>, approve = true): Promise<T> => {
    await settle();
    const [proposal] = proposals;
    if (proposal === undefined) throw new Error('the wallet shows nothing to approve');
    await (approve ? proposal.approve() : proposal.decline());
    return asked;
  };
  const market = () => readMarket(chain, 'chipnet', async () => ({ price: ORACLE, time: 1_795_000_000 }));
  const decoded = async (transactionId: string) => {
    const transaction = decodeTransactionBch(hexToBin((await device.chain.getTransaction(transactionId)) ?? ''));
    if (typeof transaction === 'string') throw new Error(transaction);
    return transaction;
  };
  return { device, chain, loans, page, first, answer, market, pending, keys, sentToWallet: first.sentToWallet, decoded, proposals: () => proposals };
};

describe('the loan page with a wallet that carries out actions itself (PY02)', () => {
  it('works only with such a wallet, on its own network, that gives the addresses the template asks for', () => {
    expect(xoProblem(undefined, 'chipnet')).toMatch(/does not carry out actions/);
    expect(xoProblem({ version: 1, network: 'mainnet', profiles: ['recoverable-app-v1'], bindings: ['receive', 'change', 'return', 'lasting'] }, 'chipnet')).toMatch(/on mainnet/);
    expect(xoProblem({ version: 1, network: 'chipnet', profiles: ['recoverable-app-v1'], bindings: ['receive'] }, 'chipnet')).toMatch(/kinds of address/);
    expect(xoProblem({ version: 1, network: 'chipnet', profiles: ['recoverable-app-v1'], bindings: ['receive', 'change', 'return', 'lasting'] }, 'chipnet')).toBeUndefined();
  });

  it('makes a key, brings the contracts up to date, borrows 100 PUSD at 125% of the lower price, sees the loan, adds collateral and closes it', { timeout: 60_000 }, async () => {
    const { loans, answer, market, keys, sentToWallet, decoded, device } = await setUp();

    // Before anything: the wallet reports nothing for a template the user has not trusted with this page.
    expect(await loans.list()).toEqual({ trusted: false, loans: [] });

    // A key. The first request goes without the texts; the wallet asks for them, and the same request goes again with them.
    const made = await answer(loans.createKey());
    expect(sentToWallet.filter((message) => message.action === 'xo_action_request').map((message) => 'definition' in message && message.definition !== undefined)).toEqual([false, true]);
    expect(keys.get().map((key) => key.transactionId)).toEqual([made.transactionId]);
    const [key] = await loans.waitingKeys();
    expect(key?.category).toBe(binToHex((await decoded(made.transactionId as string)).inputs[0]?.outpointTransactionHash as Uint8Array));

    // The contracts are two periods behind: they are brought up to date first.
    const before = await market();
    expect(before.lower).toBe(ORACLE);
    const need = periodNeed(before);
    if (need.needed !== true) throw new Error(`expected the contracts to need bringing up to date: ${JSON.stringify(need.needed)}`);
    await answer(loans.movePeriod(need.thread, before.lockHeight));
    const after = await market();
    const ready = periodNeed(after);
    if (ready.needed !== false) throw new Error('the contracts are still behind');
    expect(ready.thread.period).toBe(after.period);

    // The loan.
    const plan = borrowPlan(100_00n, DEFAULT_PERCENT, after);
    expect(plan.ratioAtLower).toBe(125);
    const opened = await answer(loans.borrow(key as never, ready.thread, after, plan));
    const borrowed = await decoded(opened.transactionId as string);
    expect(borrowed.outputs[2]?.valueSatoshis).toBe(plan.collateral);
    expect(decodeLoanState(borrowed.outputs[2]?.token?.nft?.commitment as Uint8Array)).toMatchObject({ borrowed: 100_00n, currentInterestRate: 0, lastPeriodInterestPaid: after.period });
    expect(borrowed.outputs[4]?.valueSatoshis).toBe(plan.fee);
    // The key is used: the page no longer offers it.
    expect(keys.get()).toEqual([]);
    expect(await loans.waitingKeys()).toEqual([]);

    // The loan, found through the wallet's answer and read from the chain.
    const listed = await loans.list();
    expect(listed.trusted).toBe(true);
    expect(listed.loans.map(({ category, status, debt, satoshis }) => ({ category, status, debt, satoshis }))).toEqual([{ category: key?.category, status: 'open', debt: 100_00n, satoshis: plan.collateral }]);
    expect(partRepayment(listed.loans[0] as never)).toBeUndefined();

    // More collateral: the page names the loan and the amount; the key goes back where it was.
    const added = await answer(loans.manage(key?.category as string, plan.collateral + 100_000n));
    const managed = await decoded(added.transactionId as string);
    expect(managed.outputs[1]?.valueSatoshis).toBe(plan.collateral + 100_000n);
    expect(binToHex(managed.outputs[4]?.lockingBytecode as Uint8Array)).toBe(binToHex(borrowed.outputs[5]?.lockingBytecode as Uint8Array));
    expect((await loans.list()).loans[0]?.satoshis).toBe(plan.collateral + 100_000n);

    // Repay and close: the collateral comes back to the wallet, the PUSD are gone.
    const balance = (await device.wallet.balance()).recoverable;
    await answer(loans.close(key?.category as string));
    expect((await loans.list()).loans.map(({ status }) => status)).toEqual(['closed']);
    expect((await device.wallet.balance()).recoverable - balance).toBeGreaterThan(plan.collateral);
    expect((await device.wallet.balance()).tokens.some((coin) => binToHex(coin.utxo.output.token?.category ?? new Uint8Array()) === binToHex(CONTRACTS.paryonCategory))).toBe(false);
  });

  it('refuses before asking the wallet: too little collateral, or a second request like one still waiting', async () => {
    const { loans, answer, market, sentToWallet, proposals } = await setUp();
    const made = await answer(loans.createKey());
    expect(made.transactionId).toMatch(/^[0-9a-f]{64}$/);
    const [key] = await loans.waitingKeys();
    const now = await market();
    const plan = borrowPlan(100_00n, 110, now);
    const sent = sentToWallet.length;
    await expect(loans.borrow(key as never, now.borrowing[0] as never, now, plan)).rejects.toThrow(/less than 115%/);
    expect(sentToWallet.length).toBe(sent);
    // A request the user has not decided yet blocks another of the same kind.
    const waiting = loans.manage('ab'.repeat(32), 1n);
    await settle();
    await expect(loans.manage('ab'.repeat(32), 2n)).rejects.toThrow(/still waiting/);
    expect(proposals()).toHaveLength(1);
    void waiting.catch(() => undefined);
  });

  it('sends a request again after the page is loaded again, and the wallet answers with what became of it, carrying it out once', async () => {
    const { first, page, answer, pending, device } = await setUp();
    const asked = first.loans.createKey();
    await settle();
    // The page is closed before the wallet's answer reaches it; the request stays kept.
    first.requests.detach();
    const approved = answer(Promise.resolve());
    await approved;
    await settle();
    expect(pending.get()).toHaveLength(1);
    const broadcasts = device.chain.broadcasts;
    const again = page();
    const [kept] = again.loans.pending();
    const outcome = await again.loans.resume(kept as PendingRequest);
    expect(outcome.transactionId).toMatch(/^[0-9a-f]{64}$/);
    expect(device.chain.broadcasts).toBe(broadcasts);
    expect(pending.get()).toEqual([]);
    expect(await again.loans.waitingKeys()).toHaveLength(1);
    void asked;
  });

  it('keeps a key just made while a server does not list its outputs yet, and forgets it once they are spent', async () => {
    const { first, answer, keys, chain } = await setUp();
    await answer(first.loans.createKey());
    let now = Math.floor(Date.now() / 1000);
    const blind: PageChain = { ...chain, listUnspent: async () => [] };
    const page = new XoLoans(first.requests, blind, memoryKept<PendingRequest>(), keys, () => now);
    expect(await page.waitingKeys()).toHaveLength(1);
    now += 3_600;
    expect(await page.waitingKeys()).toEqual([]);
    expect(keys.get()).toEqual([]);
  });
});
