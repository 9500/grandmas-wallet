import { readFileSync } from 'node:fs';

import { type Output, binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { Applications, applicationArchive, applicationConnector } from '@grandmas-wallet/app';
import { type Channel, type Proposal, type XoMessage, DappRequests, RequestRefusedError } from '@grandmas-wallet/connect';
import { decodeLoanState, decodePriceState } from '@grandmas-wallet/paryon';
import { describe, expect, it } from 'vitest';

import { type Device, deviceWith, finishCopying, seedOf } from '../../../test/support/applications.js';
import { CHIPNET_DESK, CONTRACTS, DEFAULT_PERCENT, LOAN_TEMPLATE, borrowPlan, partRepayment, periodNeed } from '../src/loan.js';
import { type PageChain, readMarket } from '../src/market.js';
import { type KeptKey, type PendingRequest, XoLoans, memoryKept, xoProblem } from '../src/xo.js';
import { type InMemoryService, inMemoryService } from './service.js';

/**
 * The loan page with this project's wallet: the page's own functions against the wallet's library, over a
 * connection in memory, on a simulated chain that holds Paryon's live chipnet outputs as they were recorded.
 * The page builds no transaction; it asks for actions of its template, version 3, alone, in requests of `xo_v1` that
 * carry only what the borrower decides. The wallet carries each out with Paryon's loan service, here in memory
 * (`service.ts`), which brings Paryon's coins and what is read from them. The page reads the chain for Paryon's
 * contracts, prices and loans, for what it shows and checks (proposal section 15.3).
 */

const PAGE = 'https://loan.example/';

interface RecordedOutput {
  transactionId: string;
  index: number;
  valueSatoshis: string;
  lockingBytecode: string;
  token?: { category: string; amount: string; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string } };
}
const recorded = JSON.parse(readFileSync(new URL('../../../packages/paryon/test/fixtures/chipnet-live.json', import.meta.url), 'utf8')) as Record<'borrowing' | 'price' | 'loanKeyFactory' | 'manage' | 'changeInterest', RecordedOutput[]> & { tip: { height: number } };
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

/**
 * The wallet's side of sessions on a device, and the page connected to it under one pairing, with what the page
 * kept between visits. The user approves, or declines, what the wallet shows.
 */
/**
 * The device's wallet with a way to Paryon's service, as the wallet is on a network where it speaks to services: on the
 * device's archive, so that what it records is in the device's backup.
 */
const withService = (device: Device, service: InMemoryService, seedIndex = 0): Applications =>
  new Applications(device.wallet.parts, {
    archive: applicationArchive({ arrangement: () => device.arrangement, storeAt: (address) => device.stores.get(address) as never, seed: seedOf(seedIndex), identity: device.identity, chain: device.chain }),
    now: () => 1_795_000_000,
    service: { network: 'chipnet', kind: 'public', fetch: service.fetch },
  });

const connectPage = (wallet: Applications, chain: PageChain, pending = memoryKept<PendingRequest>(), keys = memoryKept<KeptKey>()) => {
  let proposals: Proposal[] = [];
  // Here the user's approval carries the tick (a token made from the wallet's coin that goes into Paryon's contract,
  // when a key is made) where the test says so.
  let ticks = false;
  const user = Object.create(wallet) as Applications;
  user.carryOut = (request, onStage, consent) => wallet.carryOut(request, onStage, { ...consent, ...(ticks ? { tokensLeave: true } : {}) });
  const connector = applicationConnector(user, { onProposals: (open) => (proposals = open) });
  /** The page, loaded (again) and connected. */
  const page = () => {
    const wires = link();
    connector.attach('loan page', wires.walletEnd);
    const requests = new DappRequests();
    requests.attach(wires.dappEnd);
    return { loans: new XoLoans(requests, chain, pending, keys, PAGE), requests, sentToWallet: wires.sentToWallet };
  };
  /** Approve in the wallet, or decline; `tick`: the user also ticks that a token made now goes into Paryon's contract. */
  const answer = async <T>(asked: Promise<T>, approve = true, tick = false): Promise<T> => {
    await settle();
    const [proposal] = proposals;
    if (proposal === undefined) throw new Error('the wallet shows nothing to approve');
    ticks = tick;
    try {
      await (approve ? proposal.approve() : proposal.decline());
    } finally {
      ticks = false;
    }
    return asked;
  };
  return { page, answer, proposals: () => proposals, connector };
};

/** The wallet with Paryon's outputs on its chain, and the page connected to it. The user approves what the wallet shows. */
const setUp = async (satoshis = 70_000_000n) => {
  const device: Device = await deviceWith([satoshis]);
  device.chain.adopt([...recorded.borrowing, ...recorded.price, ...recorded.loanKeyFactory, ...recorded.manage, ...recorded.changeInterest].map((entry) => ({ transactionId: entry.transactionId, index: entry.index, output: outputOf(entry) })));
  // Ten blocks past the recording: the freshest borrowing contract is then two periods behind.
  const chain: PageChain = {
    getTransaction: (transactionId) => device.chain.getTransaction(transactionId),
    // The simulated chain lists a token's category only; without token data the page reads each output itself.
    listUnspent: async (lockingBytecode) => (await device.chain.listUnspent(lockingBytecode)).map(({ token: _token, ...rest }) => rest),
    tip: async () => ({ height: recorded.tip.height + 100 }),
  };
  const pending = memoryKept<PendingRequest>();
  const keys = memoryKept<KeptKey>();
  const paryon = inMemoryService(CHIPNET_DESK, chain);
  const wallet = withService(device, paryon);
  const { page, answer, proposals, connector } = connectPage(wallet, chain, pending, keys);
  const first = page();
  const { loans } = first;
  const market = () => readMarket(chain, 'chipnet', async () => ({ price: ORACLE, time: 1_795_000_000 }));
  const decoded = async (transactionId: string) => {
    const transaction = decodeTransactionBch(hexToBin((await device.chain.getTransaction(transactionId)) ?? ''));
    if (typeof transaction === 'string') throw new Error(transaction);
    return transaction;
  };
  return { device, wallet, paryon, chain, loans, page, first, answer, market, pending, keys, sentToWallet: first.sentToWallet, decoded, proposals, connector };
};

/** The page's requests to the wallet for an action, in order. */
type ActionRequest = Extract<XoMessage, { action: 'xo_action_request' }>;
const requestsFor = (sentToWallet: XoMessage[], action?: string): ActionRequest[] =>
  sentToWallet.filter((message): message is ActionRequest => message.action === 'xo_action_request' && (action === undefined || message.templateAction === action));

/** A loan of 100 PUSD, opened from the page: a key, the contracts brought up to date where needed, and the loan. */
const openLoan = async ({ loans, answer, market }: Awaited<ReturnType<typeof setUp>>) => {
  await answer(loans.createKey(), true, true);
  const [key] = await loans.waitingKeys();
  const now = await market();
  const need = periodNeed(now);
  if (need.needed === true) await answer(loans.movePeriod());
  const ready = await market();
  const current = periodNeed(ready);
  if (current.needed !== false) throw new Error('the contracts are still behind');
  const plan = borrowPlan(100_00n, DEFAULT_PERCENT, ready);
  await answer(loans.borrow(key as never, plan));
  return { category: key?.category as string, plan };
};

/**
 * For the next `times` broadcasts: after the wallet has worked out the action and the user approved it, and just
 * before the transaction reaches the network, `meddle` runs, as someone else spending a coin the action names.
 */
const beforeBroadcasts = (device: Device, times: number, meddle: (transactionHex: string) => undefined | Promise<{ accepted: false; reason: string }>) => {
  const original = device.chain.broadcast;
  let left = times;
  device.chain.broadcast = async (transactionHex) => {
    left -= 1;
    if (left <= 0) device.chain.broadcast = original;
    const answered = await meddle(transactionHex);
    return answered ?? original(transactionHex);
  };
};

describe('the loan page with a wallet that carries out actions itself (PY02)', () => {
  it('works only with such a wallet, of version 2, on its own network, that gives the addresses the template asks for', () => {
    const both = { version: 2, network: 'chipnet', bindings: ['receive', 'change', 'return', 'lasting'] };
    expect(xoProblem(undefined, 'chipnet')).toMatch(/does not carry out actions/);
    expect(xoProblem({ ...both, network: 'mainnet' }, 'chipnet')).toMatch(/on mainnet/);
    expect(xoProblem({ ...both, bindings: ['receive'] }, 'chipnet')).toMatch(/kinds of address/);
    expect(xoProblem({ ...both, version: 1 }, 'chipnet')).toMatch(/another version of XO requests/);
    expect(xoProblem(both, 'chipnet')).toBeUndefined();
  });

  it('makes a key, brings the contracts up to date, borrows 100 PUSD at 125% of the lower price, sees the loan, adds collateral and closes it, naming no coin of Paryon\'s', { timeout: 60_000 }, async () => {
    const { loans, answer, market, keys, sentToWallet, decoded, device, wallet, paryon, chain } = await setUp();

    // Before anything: the wallet reports nothing for a template the user has not trusted with this page.
    expect(await loans.list()).toEqual({ trusted: false, loans: [] });

    // A key. The first request goes without the texts; the wallet asks for them, and the same request goes again with
    // them, the template alone. The key is made from the wallet's coin and waits in Paryon's contract: without the
    // user's tick the wallet refuses.
    const refused = await answer(loans.createKey()).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(RequestRefusedError);
    expect((refused as Error).message).toMatch(/The new loan key, waiting/);
    const made = await answer(loans.createKey(), true, true);
    const requests = requestsFor(sentToWallet);
    expect(requests.slice(0, 2).map((message) => message.definition)).toEqual([undefined, { template: LOAN_TEMPLATE.texts.template }]);
    expect(requests.every((message) => Object.keys(message.template).sort().join() === 'contentHash,identifier' && message.page === PAGE)).toBe(true);
    expect(requests.at(-1)).toMatchObject({ templateAction: 'createKey', creates: 'keyCategory', variables: {} });
    expect(requests.at(-1)).not.toHaveProperty('inputs');
    // The wallet carried it out with Paryon's service, which the template names.
    expect(paryon.calls).toContain('xo_service_join_request');
    expect(keys.get().map((key) => key.transactionId)).toEqual([made.transactionId]);
    const [key] = await loans.waitingKeys();
    expect(key?.category).toBe(binToHex((await decoded(made.transactionId as string)).inputs[0]?.outpointTransactionHash as Uint8Array));

    // The contracts are two periods behind: they are brought up to date first. The service chooses which and the lock time.
    const before = await market();
    expect(before.lower).toBe(ORACLE);
    expect(before.withoutOracle).toBeUndefined();
    // Without an oracle, as for a deployment on a chain of one's own, the stored price is the only one.
    const alone = await readMarket(chain, 'chipnet', undefined);
    expect(alone).toMatchObject({ withoutOracle: true, lower: alone.stored });
    expect(alone.oracle).toBeUndefined();
    const need = periodNeed(before);
    if (need.needed !== true) throw new Error(`expected the contracts to need bringing up to date: ${JSON.stringify(need.needed)}`);
    await answer(loans.movePeriod());
    expect(requestsFor(sentToWallet, 'movePeriod').at(-1)).toMatchObject({ variables: {}, page: PAGE });
    const after = await market();
    const ready = periodNeed(after);
    if (ready.needed !== false) throw new Error('the contracts are still behind');
    expect(ready.thread.period).toBe(after.period);

    // The loan: the debt, the collateral and no interest, about the key waiting in Paryon's contract.
    const plan = borrowPlan(100_00n, DEFAULT_PERCENT, after);
    expect(plan.ratioAtLower).toBe(125);
    const opened = await answer(loans.borrow(key as never, plan));
    expect(requestsFor(sentToWallet, 'borrow').at(-1)).toMatchObject({
      about: { category: key?.category, spent: false },
      bindings: { keyHolder: 'receive', tokensHolder: 'receive' },
      variables: { debt: '10000', collateral: String(plan.collateral), startingRate: 0 },
    });
    const borrowed = await decoded(opened.transactionId as string);
    expect(borrowed.outputs[2]?.valueSatoshis).toBe(plan.collateral);
    expect(decodeLoanState(borrowed.outputs[2]?.token?.nft?.commitment as Uint8Array)).toMatchObject({ borrowed: 100_00n, currentInterestRate: 0, lastPeriodInterestPaid: after.period });
    expect(borrowed.outputs[4]?.valueSatoshis).toBe(plan.fee);
    // The key is used: the page no longer offers it.
    expect(keys.get()).toEqual([]);
    expect(await loans.waitingKeys()).toEqual([]);
    // The wallet recorded the key when it arrived, with the page's address, and names no script: the loan is at
    // Paryon's shared contracts.
    expect(wallet.positionRecords.map(({ token, lockingScriptIdentifier, applicationPage }) => [token?.category, token?.capability, lockingScriptIdentifier, applicationPage])).toEqual([[key?.category, 'minting', undefined, PAGE]]);

    // The loan, found through the wallet's answer and read from the chain.
    const listed = await loans.list();
    expect(listed.trusted).toBe(true);
    expect(listed.loans.map(({ category, status, debt, satoshis }) => ({ category, status, debt, satoshis }))).toEqual([{ category: key?.category, status: 'open', debt: 100_00n, satoshis: plan.collateral }]);
    expect(partRepayment(listed.loans[0] as never)).toBeUndefined();

    // More collateral: the page gives the amount the loan then holds and which loan, by its key; the key goes back where it was.
    const added = await answer(loans.manage(key?.category as string, plan.collateral + 100_000n));
    const manageSent = requestsFor(sentToWallet, 'manage').at(-1);
    expect(manageSent).toMatchObject({ about: { category: key?.category, spent: true }, bindings: { keyHolder: 'return' }, variables: { collateral: String(plan.collateral + 100_000n) }, page: PAGE });
    expect(Object.keys(manageSent?.variables ?? {})).toEqual(['collateral']);
    expect(manageSent).not.toHaveProperty('inputs');
    const managed = await decoded(added.transactionId as string);
    expect(managed.outputs[1]?.valueSatoshis).toBe(plan.collateral + 100_000n);
    expect(binToHex(managed.outputs[4]?.lockingBytecode as Uint8Array)).toBe(binToHex(borrowed.outputs[5]?.lockingBytecode as Uint8Array));
    expect((await loans.list()).loans[0]?.satoshis).toBe(plan.collateral + 100_000n);

    // Repay and close: the collateral comes back to the wallet, the PUSD are gone.
    const balance = (await device.wallet.balance()).recoverable;
    await answer(loans.close(key?.category as string));
    expect(requestsFor(sentToWallet, 'close').at(-1)).toMatchObject({ about: { category: key?.category, spent: true }, bindings: { keyHolder: 'receive' }, variables: {} });
    expect((await loans.list()).loans.map(({ status }) => status)).toEqual(['closed']);
    expect((await device.wallet.balance()).recoverable - balance).toBeGreaterThan(plan.collateral);
    expect((await device.wallet.balance()).tokens.some((coin) => binToHex(coin.utxo.output.token?.category ?? new Uint8Array()) === binToHex(CONTRACTS.paryonCategory))).toBe(false);
    // No request of the page named a coin.
    expect(requestsFor(sentToWallet).some((message) => 'inputs' in message)).toBe(false);
  });

  it('changes a loan\'s interest rate: the page gives the rate and the loan; the service brings Paryon\'s coins; the key goes back where it was; the page reads the new rate', { timeout: 60_000 }, async () => {
    const context = await setUp();
    const { loans, answer, sentToWallet, decoded } = context;
    const { category, plan } = await openLoan(context);
    const sent = sentToWallet.length;
    await expect(loans.changeInterest(category, 40_000)).rejects.toThrow(/from 0 to 32,767/);
    expect(sentToWallet.length).toBe(sent);
    const changed = await answer(loans.changeInterest(category, 1_096));
    const request = requestsFor(sentToWallet, 'changeInterest').at(-1);
    expect(request).toMatchObject({ about: { category, spent: true }, bindings: { keyHolder: 'return' }, page: PAGE, variables: { interestRate: 1_096 } });
    expect(Object.keys(request?.variables ?? {})).toEqual(['interestRate']);
    expect(request).not.toHaveProperty('inputs');
    const transaction = await decoded(changed.transactionId as string);
    expect(decodeLoanState(transaction.outputs[0]?.token?.nft?.commitment as Uint8Array)).toMatchObject({ borrowed: 100_00n, currentInterestRate: 0, nextInterestRate: 1_096 });
    const [loan] = (await loans.list()).loans;
    expect(loan).toMatchObject({ status: 'open', interestRate: 0, nextInterestRate: 1_096, satoshis: plan.collateral });
  });

  it('refuses before asking the wallet: too little collateral, a repayment Paryon does not take, or a second request like one still waiting; passes on the wallet\'s refusal of a loan it does not hold', async () => {
    const { loans, answer, market, sentToWallet, proposals } = await setUp();
    const made = await answer(loans.createKey(), true, true);
    expect(made.transactionId).toMatch(/^[0-9a-f]{64}$/);
    const [key] = await loans.waitingKeys();
    const now = await market();
    const plan = borrowPlan(100_00n, 110, now);
    const sent = sentToWallet.length;
    await expect(loans.borrow(key as never, plan)).rejects.toThrow(/less than 115%/);
    await expect(loans.repay({ category: 'ab'.repeat(32), status: 'open', satoshis: 1n, debt: 150_00n }, 100_00n)).rejects.toThrow(/too small to repay in part/);
    expect(sentToWallet.length).toBe(sent);
    // A key the wallet does not hold: the page no longer reads the key's coin for its request, so it asks, and the
    // wallet says why it does not carry it out.
    const refused = await answer(loans.manage('ab'.repeat(32), 1n)).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(RequestRefusedError);
    expect((refused as Error).message).toMatch(/does not offer "Change the collateral" for this token now/);
    expect(requestsFor(sentToWallet, 'manage')).toHaveLength(1);
    // A request the user has not decided yet blocks another of the same kind.
    const waiting = loans.createKey();
    await settle();
    await expect(loans.createKey()).rejects.toThrow(/still waiting/);
    expect(proposals()).toHaveLength(1);
    void waiting.catch(() => undefined);
  });

  it('sends a request again after the page is loaded again, and the wallet answers with what became of it, carrying it out once', async () => {
    const { first, page, answer, pending, device } = await setUp();
    const asked = first.loans.createKey();
    await settle();
    // The page is closed before the wallet's answer reaches it; the request stays kept.
    first.requests.detach();
    const approved = answer(Promise.resolve(), true, true);
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

  it('forgets a request kept from before that names another template, such as an earlier version of it', async () => {
    const { first, pending } = await setUp();
    const earlier: PendingRequest = { id: 'loan-earlier', action: 'close', startedAt: 1, details: { template: { identifier: 'ee'.repeat(32), contentHash: 'ff'.repeat(32) }, templateAction: 'close', role: 'borrower', variables: {} } };
    const current: PendingRequest = { ...earlier, id: 'loan-current', details: { ...earlier.details, template: LOAN_TEMPLATE.names } };
    pending.set([earlier, current]);
    expect(first.loans.pending().map(({ id }) => id)).toEqual(['loan-current']);
    expect(pending.get().map(({ id }) => id)).toEqual(['loan-current']);
  });

  it('keeps a key just made while a server does not list its outputs yet, and forgets it once they are spent', async () => {
    const { first, answer, keys, chain } = await setUp();
    await answer(first.loans.createKey(), true, true);
    let now = Math.floor(Date.now() / 1000);
    const blind: PageChain = { ...chain, listUnspent: async () => [] };
    const page = new XoLoans(first.requests, blind, memoryKept<PendingRequest>(), keys, PAGE, () => now);
    expect(await page.waitingKeys()).toHaveLength(1);
    now += 3_600;
    expect(await page.waitingKeys()).toEqual([]);
    expect(keys.get()).toEqual([]);
  });
});

describe('the loan page on a new phone, after the loss of the device (PR20)', () => {
  it('the wallet reports the swept key from the earlier seed\'s record once the user allows the page; the page finds the loan itself and closes it', { timeout: 120_000 }, async () => {
    const context = await setUp();
    const { device, chain, paryon } = context;
    const { category, plan } = await openLoan(context);

    // The phone is lost. The recoverer requests, waits and completes; the new phone takes over, sweeps, copies the
    // earlier archive, reads the backup, trusts the template the earlier owner stored, and checks the records.
    await device.recover();
    const taken = await device.takeOver();
    const newWallet = withService(taken, paryon, 1);
    await taken.wallet.search();
    await taken.wallet.sweepEarlier();
    await finishCopying(taken);
    await newWallet.readBackup();
    for (const suggested of newWallet.suggestions) await newWallet.trust(suggested, undefined);
    await newWallet.confirmRecords();

    // The page on the new phone, connected afresh. The template came from the backup: nothing is reported until
    // the user allows this page.
    const { page, answer: answerNew } = connectPage(newWallet, chain);
    const { loans: fresh, sentToWallet } = page();
    expect(await fresh.list()).toEqual({ trusted: false, loans: [] });
    newWallet.allow(LOAN_TEMPLATE.names.identifier, 'loan page');
    const listed = await fresh.list();
    expect(listed.loans.map(({ category: listedKey, status, debt, satoshis, keySatoshis }) => ({ listedKey, status, debt, satoshis, keySatoshis }))).toEqual([{ listedKey: category, status: 'open', debt: 100_00n, satoshis: plan.collateral, keySatoshis: expect.any(BigInt) as bigint }]);

    // Closing, from the page's request: the collateral comes back to the new seed's addresses, the key stays.
    const before = (await taken.wallet.balance()).recoverable;
    await answerNew(fresh.close(category));
    const request = requestsFor(sentToWallet, 'close').at(-1);
    expect(request).toMatchObject({ about: { category, spent: true }, page: PAGE, variables: {} });
    expect(request).not.toHaveProperty('inputs');
    expect((await fresh.list()).loans.map(({ status }) => status)).toEqual(['closed']);
    expect((await taken.wallet.balance()).recoverable - before).toBeGreaterThan(plan.collateral);
    expect((await taken.wallet.balance()).tokens.map((coin) => binToHex(coin.utxo.output.token?.category ?? new Uint8Array()))).toEqual([category]);
  });
});

describe('the loan page when someone else uses one of Paryon\'s coins first', () => {
  it('the wallet says why in a code, its own coins are free again, and the page says so in plain words without asking again; asked again, the service brings the current coins', { timeout: 120_000 }, async () => {
    const context = await setUp();
    const { device, loans, answer, sentToWallet, connector, pending, proposals } = context;
    const { category, plan } = await openLoan(context);
    const balance = await device.wallet.balance();

    // Between the user's look at the review and the broadcast, another user spends the coin of Paryon's function
    // contract the service brought (input 3 of a closing), and remakes it elsewhere.
    let taken = '';
    beforeBroadcasts(device, 1, (transactionHex) => {
      const transaction = decodeTransactionBch(hexToBin(transactionHex));
      if (typeof transaction === 'string') throw new Error(transaction);
      const input = transaction.inputs[3];
      taken = `${binToHex(input?.outpointTransactionHash as Uint8Array)}:${input?.outpointIndex}`;
      device.chain.spendElsewhere(taken);
      return undefined;
    });
    const closing = loans.close(category);
    await answer(Promise.resolve());
    await expect(closing).rejects.toThrow('Someone else used one of Paryon\'s coins first. Nothing was sent. Try again in a moment.');
    const [refused] = connector.ledger.filter((entry) => entry.templateAction === 'close');
    expect(refused).toMatchObject({ status: 'failed', code: 'inputs-spent' });
    // Nothing was sent, and the wallet's own coins in the refused action are free again: its balance is as it was.
    expect((await device.wallet.balance()).recoverable).toBe(balance.recoverable);
    expect((await device.wallet.balance()).tokens.length).toBe(balance.tokens.length);
    // The page does not ask again by itself.
    await settle();
    expect(proposals()).toEqual([]);
    expect(pending.get()).toEqual([]);
    expect(requestsFor(sentToWallet, 'close')).toHaveLength(1);

    // Asked again, with the same request: the service brings the coins as they are now.
    await answer(loans.close(category));
    const transactions = device.chain.broadcasts;
    expect(transactions).toBeGreaterThan(0);
    expect(connector.ledger.filter((entry) => entry.templateAction === 'close').map(({ status }) => status)).toEqual(['failed', 'done']);
    expect((await loans.list()).loans.map(({ status }) => status)).toEqual(['closed']);
    expect((await device.wallet.balance()).recoverable - balance.recoverable).toBeGreaterThan(plan.collateral);
  });
});
