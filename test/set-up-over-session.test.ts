import { hexToBin } from '@bitauth/libauth';
import { MemoryStore } from '@grandmas-wallet/archive';
import {
  type OwnerWalletState,
  type SetUpRecord,
  RecovererFunds,
  SetUpDesk,
  finishSetUp,
  firstAddressFor,
  requestSetUp,
  setUpForRequest,
  walletTemplateNumbers,
} from '@grandmas-wallet/app';
import { type Particulars, type RecovererChannel, type RecovererMessage, ENROLL_ANSWER, RecovererSilentError, SealedCourier, SealedDesk, SealedRefusedError, readRecovererMessage } from '@grandmas-wallet/connect/recoverer';
import { type WalletBackend, controllerScript, deriveSeedKeys } from '@grandmas-wallet/core';
import { type KeptKit, generateRecipientKeyPair } from '@grandmas-wallet/enrollment';
import { KeyBackend, SimulatedChain } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

/**
 * A phone and the recoverer's page setting a wallet up over the session of the recoverer's code (proposal section
 * 14.4, tests RC14 and CR08): the pages' own code for the request, the creation and the answer, with the session as
 * a pair of queues, the simulated chain and stores in memory. Either page may be loaded again at any moment, and an
 * answer may be lost.
 */

const numbers = walletTemplateNumbers();
const PHONE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FUNDS = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';
const DELAY = { unit: 'time512', value: 1 } as const;
const STORES = ['https://store1.example'];
const OFFER = { challengeDelay: DELAY, startingSatoshis: 20_000n };

/** A session: messages of this extension only, checked, delivered as copies; answers to the phone can be lost. */
const session = () => {
  const toDesk: ((message: unknown) => void)[] = [];
  const toWallet: ((message: unknown) => void)[] = [];
  const state = { losingAnswers: 0 };
  const end = (out: ((message: unknown) => void)[], incoming: ((message: unknown) => void)[], toPhone: boolean): RecovererChannel => ({
    send: async (message: RecovererMessage) => {
      if (toPhone && message.action === ENROLL_ANSWER && message.status === 'created' && state.losingAnswers > 0) {
        state.losingAnswers -= 1;
        return;
      }
      for (const handler of [...out]) handler(JSON.parse(JSON.stringify(message)));
    },
    onMessage: (handler) => {
      const listener = (message: unknown) => {
        const read = readRecovererMessage(message);
        if (read !== undefined) handler(read);
      };
      incoming.push(listener);
      return () => void incoming.splice(incoming.indexOf(listener), 1);
    },
  });
  return { desk: () => end(toWallet, toDesk, true), wallet: () => end(toDesk, toWallet, false), state, clearDesk: () => void toDesk.splice(0) };
};

/** A key holder that stops, as a page does that is loaded again, right after its n-th transaction went out. */
const stoppingAfter = (inner: KeyBackend, at: number): WalletBackend => {
  let sends = 0;
  const send = async (prepared: Parameters<KeyBackend['send']>[0]): Promise<string> => {
    const sent = await inner.send(prepared);
    sends += 1;
    if (sends === at) throw new Error('the page was loaded again');
    return sent;
  };
  return new Proxy(inner, { get: (target, name) => (name === 'send' ? send : (Reflect.get(target, name) as unknown)) });
};

const start = async (options: { balance?: bigint } = {}) => {
  const chain = new SimulatedChain();
  const stores = new Map(STORES.map((address) => [address, new MemoryStore(address)]));
  const storeAt = (address: string): MemoryStore => stores.get(address) as MemoryStore;
  const recovererKey = await generateRecipientKeyPair();
  const particulars: Particulars = { name: 'Example Bank', page: 'https://recoverer.example/', publicKey: Buffer.from(recovererKey.publicKey).toString('hex'), offer: { challengeDelay: DELAY, startingSatoshis: '20000' } };
  const fundsSeed = deriveSeedKeys(FUNDS, 'testnet', numbers);
  chain.fund(await new KeyBackend(chain, fundsSeed).ordinaryAddress(), options.balance ?? 200_000n, 1);
  const wires = session();

  /** What the recoverer's page keeps in the browser: it outlives a reload. */
  const records = new Map<string, SetUpRecord>();
  const kits = new Map<string, KeptKit>();
  let creations = 0;
  let current: SealedDesk | undefined;
  /** The recoverer's page, as loaded now: its own account of the funds, its desk on the session. */
  const loadPage = async (mode: { automatic: boolean; backend?: (inner: KeyBackend) => WalletBackend }) => {
    const inner = new KeyBackend(chain, fundsSeed);
    const funds = await RecovererFunds.open({ backend: mode.backend?.(inner) ?? inner, chain });
    const sealedDesk: SealedDesk = new SealedDesk({ particulars: () => particulars, onSealed: () => undefined, onEnroll: ({ id, sealed }) => void desk.received(id, sealed) });
    const desk: SetUpDesk = new SetUpDesk({
      records: { get: (id) => records.get(id), set: (record) => void records.set(record.requestId, record), all: () => [...records.values()] },
      network: 'testnet',
      privateKey: recovererKey.privateKey,
      reply: (id, reply) => sealedDesk.answerEnroll(id, reply),
      create: async (read, record, save) => {
        creations += 1;
        const made = await setUpForRequest({ read, funds, chain, storeAt, offer: OFFER, record: record.creation, save, reserved: desk.reserved(record.requestId), label: record.label, madeAt: 1, keepKit: (kept) => void kits.set(kept.kit.identity, kept) });
        return made.answer;
      },
      automatic: () => mode.automatic,
      name: () => particulars.name,
      label: () => 'Customer 7',
    });
    sealedDesk.attach(wires.desk());
    current = sealedDesk;
    return { desk, funds };
  };

  /** The phone: its request is kept, and sent again after a reload. */
  const phone = deriveSeedKeys(PHONE, 'testnet', numbers);
  let state: OwnerWalletState | undefined;
  const pending = await requestSetUp({ seed: phone, stores: STORES, storeAt, recovererPublicKey: recovererKey.publicKey, challengeDelay: DELAY, firstAddress: firstAddressFor(state) });
  const ask = (options: { silentMs?: number; timeoutMs?: number } = {}) => {
    const courier = new SealedCourier(wires.wallet());
    // The phone has joined: the page says who it is, as it does when a phone connects.
    void current?.introduce();
    return courier.enroll({ expected: particulars, id: pending.requestId, sealed: hexToBin(pending.sealed), silentMs: options.silentMs ?? 2_000, timeoutMs: options.timeoutMs ?? 5_000, resendMs: 100 });
  };
  const open = async (created: Awaited<ReturnType<typeof ask>>) =>
    finishSetUp({ answer: created, pending, seed: phone, backend: new KeyBackend(chain, phone), chain, save: (next) => (state = next) });
  return { chain, storeAt, wires, records, kits, loadPage, ask, open, pending, creations: () => creations };
};

const oneWallet = (chain: SimulatedChain, identity: string): void => expect(chain.outputsAt(controllerScript(hexToBin(identity)).lockingBytecode)).toHaveLength(1);

describe('a bank sets the wallet up without anybody saying yes', () => {
  it('RC14: the phone asks over the session; the bank creates the wallet and answers; the phone opens it with its starting balance', async () => {
    const { chain, loadPage, ask, open, records, pending } = await start();
    await loadPage({ automatic: true });
    const created = await ask();
    oneWallet(chain, created.identity);
    expect(records.get(pending.requestId)).toMatchObject({ label: 'Customer 7', approved: true, answer: created });
    const { wallet, startingSatoshis } = await open(created);
    expect(startingSatoshis).toBe(20_000n);
    expect((await wallet.balance()).recoverable).toBe(20_000n);
  });

  it('CR08: the bank\'s page is loaded again after it created the wallet and before it answered: the request, sent again, gets the same wallet', async () => {
    const { chain, wires, loadPage, ask, open, records, pending, creations } = await start();
    // The self-payment and the creation go out; the page is loaded again right after the creation.
    await loadPage({ automatic: true, backend: (inner) => stoppingAfter(inner, 2) });
    await expect(ask({ silentMs: 1_000, timeoutMs: 1_000 })).rejects.toThrow(SealedRefusedError);
    const kept = records.get(pending.requestId);
    expect(kept?.creation.createTransactionId).toBeDefined();
    expect(kept?.answer).toBeUndefined();
    // The page that was loaded again: what it kept, a new account, the same session.
    wires.clearDesk();
    const page = await loadPage({ automatic: true });
    await page.desk.resume();
    const created = await ask();
    expect(created.creationTransactionId).toBe(kept?.creation.createTransactionId);
    oneWallet(chain, created.identity);
    expect(creations()).toBe(2);
    expect((await open(created)).wallet.created).toBe(true);
  });

  it('CR08: the answer is lost, and the phone is loaded again: the same request gets the same wallet, created once', async () => {
    const { chain, wires, loadPage, ask, open, creations } = await start();
    await loadPage({ automatic: true });
    wires.state.losingAnswers = 1_000;
    await expect(ask({ silentMs: 1_000, timeoutMs: 800 })).rejects.toBeInstanceOf(RecovererSilentError);
    // The phone is loaded again and sends its kept request again; this time the answer arrives.
    wires.state.losingAnswers = 0;
    const created = await ask();
    oneWallet(chain, created.identity);
    expect(creations()).toBe(1);
    expect((await open(created)).wallet.created).toBe(true);
  });

  it('CR07: a bank with too little on its balance: both pages say so, and the same request goes through once coins arrive', async () => {
    const { chain, loadPage, ask, records, pending } = await start({ balance: 2_000n });
    const page = await loadPage({ automatic: true });
    await expect(ask()).rejects.toThrow(new SealedRefusedError('Example Bank cannot set up a wallet just now: their balance is too low. Ask them to add coins, then try again.'));
    expect(records.get(pending.requestId)?.problem).toMatch(/^Your balance is 2,000 satoshis and setting up a wallet takes [\d,]+\. Send at least [\d,]+ satoshis to your address\.$/);
    chain.fund(await page.funds.address(), 100_000n);
    const created = await ask();
    oneWallet(chain, created.identity);
    expect(records.get(pending.requestId)?.problem).toBeUndefined();
  });
});

describe('a friend says yes first', () => {
  it('RC14: the request waits for one tap; the phone is told it has arrived meanwhile, and the wallet follows the tap', async () => {
    const { chain, loadPage, ask, records, pending } = await start();
    const page = await loadPage({ automatic: false });
    const asking = ask({ timeoutMs: 10_000 });
    for (let attempt = 0; attempt < 50 && records.get(pending.requestId) === undefined; attempt++) await new Promise((done) => setTimeout(done, 20));
    expect(records.get(pending.requestId)).toMatchObject({ approved: false });
    expect(records.get(pending.requestId)?.creation.identity).toBeUndefined();
    await page.desk.approve(pending.requestId, 'Grandma');
    const created = await asking;
    oneWallet(chain, created.identity);
    expect(records.get(pending.requestId)?.label).toBe('Grandma');
  });

  it('RC14: a friend who says no: the phone is told, and nothing is created', async () => {
    const { loadPage, ask, records, pending } = await start();
    const page = await loadPage({ automatic: false });
    const asking = ask({ timeoutMs: 10_000 });
    for (let attempt = 0; attempt < 50 && records.get(pending.requestId) === undefined; attempt++) await new Promise((done) => setTimeout(done, 20));
    await page.desk.decline(pending.requestId);
    await expect(asking).rejects.toThrow(new SealedRefusedError('The recoverer did not set the wallet up.'));
    expect(records.get(pending.requestId)?.creation.identity).toBeUndefined();
  });
});
