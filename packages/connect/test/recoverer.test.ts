import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ACTION_REQUEST } from '../src/protocol.js';
import {
  type Particulars,
  type ReceivedSealed,
  type RecovererChannel,
  type RecovererMessage,
  OtherRecovererError,
  PARTICULARS,
  RECOVERER_EXTENSION,
  RecovererSilentError,
  SEALED,
  SealedCourier,
  SealedDesk,
  SealedRefusedError,
  readRecovererMessage,
} from '../src/recoverer.js';
import { joinDeskSession, openDeskSession } from '../src/recoverer-session.js';
import { type LinkStatus, newLinkKey, openWalletLink } from '../src/wizard.js';
import { type MemoryRelay, startMemoryRelay } from './memory-relay.js';

/**
 * A wallet and a recoverer's page handing a sealed message over a session (`gw_recoverer_v1`): first the
 * messages over a pair of queues, then both sides over a real WizardConnect session through a relay in memory.
 * What the recoverer's page does with what it receives, and that it is the kit the link carries, is tested
 * with the pages' own code (`test/kit-over-session.test.ts`).
 */

const ANNA: Particulars = { name: 'Anna', page: 'https://recoverer.example/', publicKey: 'a1'.repeat(32) };
const KIT = Uint8Array.from({ length: 1_000 }, (_, index) => (index * 7) % 256);

/** Two ends of a connection in memory; everything is delivered as a copy, as over a network, unless dropped. */
const queues = () => {
  const toDesk: ((message: unknown) => void)[] = [];
  const toWallet: ((message: unknown) => void)[] = [];
  const sentToDesk: RecovererMessage[] = [];
  const state = { dropping: false };
  const end = (out: ((message: unknown) => void)[], log: RecovererMessage[] | undefined, incoming: ((message: unknown) => void)[]): RecovererChannel => ({
    send: async (message) => {
      log?.push(message);
      if (state.dropping) return;
      for (const handler of [...out]) handler(JSON.parse(JSON.stringify(message)));
    },
    onMessage: (handler) => {
      // As the session does: only this extension's messages, checked, reach a listener.
      const listener = (message: unknown) => {
        const read = readRecovererMessage(message);
        if (read !== undefined) handler(read);
      };
      incoming.push(listener);
      return () => void incoming.splice(incoming.indexOf(listener), 1);
    },
  });
  return { desk: end(toWallet, undefined, toDesk), wallet: end(toDesk, sentToDesk, toWallet), sentToDesk, state, deliverToDesk: (message: unknown) => toDesk.forEach((handler) => handler(message)) };
};

const deskFor = (particulars = ANNA) => {
  const received: ReceivedSealed[] = [];
  const desk = new SealedDesk({ particulars: () => particulars, onSealed: (sealed) => received.push(sealed) });
  return { desk, received };
};

describe('the messages', () => {
  it('are read only in the form this version knows', () => {
    expect(readRecovererMessage({ action: PARTICULARS, time: 1, ...ANNA })).toEqual({ action: PARTICULARS, time: 1, ...ANNA });
    expect(readRecovererMessage({ action: PARTICULARS, time: 1, ...ANNA, publicKey: 'not a key' })).toBeUndefined();
    expect(readRecovererMessage({ action: PARTICULARS, time: 1, ...ANNA, page: 'javascript:alert(1)' })).toBeUndefined();
    expect(readRecovererMessage({ action: SEALED, time: 1, id: 'one', kind: 'enroll', sealed: 'abcd' })).toMatchObject({ kind: 'enroll', sealed: 'abcd' });
    expect(readRecovererMessage({ action: SEALED, time: 1, id: 'one', kind: 'update', sealed: 'abcd' })).toBeUndefined();
    expect(readRecovererMessage({ action: SEALED, time: 1, id: 'one', kind: 'enroll', sealed: 'abc' })).toBeUndefined();
  });

  it('of another extension are not taken: an application\'s request means nothing here', async () => {
    expect(readRecovererMessage({ action: ACTION_REQUEST, time: 1, sequence: 2, id: 'request', template: {}, templateAction: 'deposit', role: 'saver', variables: {} })).toBeUndefined();
    const wires = queues();
    const { desk, received } = deskFor();
    desk.attach(wires.desk);
    wires.deliverToDesk({ action: ACTION_REQUEST, time: 1, sequence: 2, id: 'request', sealed: 'abcd', kind: 'enroll' });
    wires.deliverToDesk({ action: 'sign_transaction_request', time: 1, sequence: 2, transaction: {}, inputPaths: [] });
    await new Promise((done) => setTimeout(done, 10));
    expect(received).toEqual([]);
  });
});

describe('a sealed message over a session', () => {
  it('reaches the recoverer\'s page byte for byte, which says that it has it and then that it kept it', async () => {
    const wires = queues();
    const { desk, received } = deskFor();
    const courier = new SealedCourier(wires.wallet);
    desk.attach(wires.desk);
    expect(await courier.particulars(1_000)).toEqual(ANNA);
    const answers: string[] = [];
    courier.onAnswer((answer) => answers.push(answer.status));
    const sending = courier.send({ expected: ANNA, kind: 'enroll', sealed: KIT, timeoutMs: 2_000 });
    await new Promise((done) => setTimeout(done, 20));
    expect(received).toHaveLength(1);
    expect(received[0]?.kind).toBe('enroll');
    expect(received[0]?.sealed).toEqual(KIT);
    await desk.answer(received[0]?.id ?? '', 'received');
    expect((await sending).status).toBe('received');
    await desk.answer(received[0]?.id ?? '', 'kept');
    expect(answers).toEqual(['received', 'kept']);
  });

  it('refused by the recoverer\'s page comes back with its reason', async () => {
    const wires = queues();
    const courier = new SealedCourier(wires.wallet);
    const refusing = new SealedDesk({ particulars: () => ANNA, onSealed: (sealed) => void refusing.answer(sealed.id, 'refused', 'This kit is for a wallet on another network.') });
    refusing.attach(wires.desk);
    await expect(courier.send({ expected: ANNA, kind: 'enroll', sealed: KIT, timeoutMs: 2_000 })).rejects.toThrow(new SealedRefusedError('This kit is for a wallet on another network.'));
  });

  it('is sent again until the page answers, and the page sees it once', async () => {
    const wires = queues();
    let answer: (() => Promise<void>) | undefined;
    const received: ReceivedSealed[] = [];
    const desk = new SealedDesk({ particulars: () => ANNA, onSealed: (sealed) => void (received.push(sealed), (answer = () => desk.answer(sealed.id, 'received'))) });
    const courier = new SealedCourier(wires.wallet);
    desk.attach(wires.desk);
    const sending = courier.send({ expected: ANNA, kind: 'takeover', sealed: KIT, timeoutMs: 3_000, resendMs: 100 });
    await new Promise((done) => setTimeout(done, 350));
    expect(wires.sentToDesk.filter((message) => message.action === SEALED).length).toBeGreaterThan(2);
    expect(received).toHaveLength(1);
    await answer?.();
    expect((await sending).status).toBe('received');
  });

  it('is not sent to a page that answers in the name of another recoverer', async () => {
    const wires = queues();
    const courier = new SealedCourier(wires.wallet);
    deskFor({ ...ANNA, publicKey: 'b2'.repeat(32) }).desk.attach(wires.desk);
    await expect(courier.send({ expected: ANNA, kind: 'enroll', sealed: KIT, timeoutMs: 1_000 })).rejects.toBeInstanceOf(OtherRecovererError);
    expect(wires.sentToDesk.filter((message) => message.action === SEALED)).toEqual([]);
  });

  it('to a page that does not answer gives up in time, so that the wallet shows the link instead', async () => {
    const wires = queues();
    const courier = new SealedCourier(wires.wallet);
    deskFor().desk.attach(wires.desk);
    await courier.particulars(1_000);
    // The page was closed: nothing arrives any more.
    wires.state.dropping = true;
    const started = Date.now();
    await expect(courier.send({ expected: ANNA, kind: 'enroll', sealed: KIT, timeoutMs: 600, resendMs: 100 })).rejects.toBeInstanceOf(RecovererSilentError);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('over a WizardConnect session, through a relay', () => {
  let relay: MemoryRelay;
  const closing: (() => void)[] = [];
  beforeEach(async () => {
    relay = await startMemoryRelay();
  });
  afterEach(async () => {
    for (const close of closing.splice(0)) close();
    // The sessions say goodbye and let go of the relay before it closes.
    await new Promise((done) => setTimeout(done, 300));
    await relay.close();
  });
  const until = async (what: () => boolean, timeout = 10_000): Promise<void> => {
    for (const end = Date.now() + timeout; !what() && Date.now() < end; ) await new Promise((done) => setTimeout(done, 20));
  };

  /** The recoverer's page offers a session; the wallet opens its address. */
  const connect = async () => {
    const deskStatus: LinkStatus[] = [];
    const walletStatus: LinkStatus[] = [];
    const received: ReceivedSealed[] = [];
    const desk: SealedDesk = new SealedDesk({ particulars: () => ANNA, onSealed: (sealed) => (received.push(sealed), void desk.answer(sealed.id, 'received')) });
    // The page says who it is when a wallet connects, as the recoverer's page does.
    const session = openDeskSession({ name: 'Anna', relays: [relay.url], onStatus: (status) => (deskStatus.push(status), status.state === 'connected' ? void desk.introduce() : undefined) });
    closing.push(() => session.close());
    desk.attach(session.channel);
    const joined = joinDeskSession({ uri: session.uri, privateKey: newLinkKey(), name: 'A wallet', onStatus: (status) => walletStatus.push(status) });
    closing.push(() => joined.close());
    const courier = new SealedCourier(joined.channel);
    return { session, desk, received, joined, courier, deskStatus, walletStatus };
  };

  it('hands a kit over: the particulars, then the sealed bytes, then the answer', async () => {
    const { courier, received, deskStatus, walletStatus, session } = await connect();
    expect(session.uri).toMatch(/^wiz:\/\/127\.0\.0\.1:\d+\?p=/);
    expect(await courier.particulars(10_000)).toEqual(ANNA);
    const answer = await courier.send({ expected: ANNA, kind: 'enroll', sealed: KIT, timeoutMs: 10_000 });
    expect(answer.status).toBe('received');
    expect(received).toHaveLength(1);
    expect(received[0]?.sealed).toEqual(KIT);
    expect(deskStatus.some((status) => status.state === 'connected' && status.peerName === 'A wallet')).toBe(true);
    expect(walletStatus.some((status) => status.state === 'connected' && status.peerName === 'Anna')).toBe(true);
  }, 30_000);

  it('hands over a sealed message too large for one relay message, in chunks', async () => {
    const { courier, received } = await connect();
    const large = Uint8Array.from({ length: 120_000 }, (_, index) => (index * 31) % 256);
    expect((await courier.send({ expected: ANNA, kind: 'enroll', sealed: large, timeoutMs: 20_000 })).status).toBe('received');
    expect(received[0]?.sealed).toEqual(large);
    // No single relay message carried the whole of it.
    expect(relay.published().largest).toBeLessThan(2 * large.length);
  }, 40_000);

  it('gives up on a recoverer\'s page that is gone, in time for the wallet to show the link', async () => {
    let state = 'connecting';
    const session = openDeskSession({ name: 'Anna', relays: [relay.url], onStatus: (status) => void (state = status.state) });
    const uri = session.uri;
    await until(() => state === 'waiting');
    // The recoverer closes the page before the wallet opens the address.
    session.close();
    await new Promise((done) => setTimeout(done, 300));
    const joined = joinDeskSession({ uri, privateKey: newLinkKey(), name: 'A wallet', onStatus: () => undefined });
    closing.push(() => joined.close());
    const started = Date.now();
    await expect(new SealedCourier(joined.channel).send({ expected: ANNA, kind: 'enroll', sealed: KIT, timeoutMs: 1_500 })).rejects.toBeInstanceOf(RecovererSilentError);
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 20_000);

  it('is not served to a wallet that does not announce the extension, such as one connecting as for an application', async () => {
    const deskStatus: LinkStatus[] = [];
    const received: ReceivedSealed[] = [];
    const session = openDeskSession({ name: 'Anna', relays: [relay.url], onStatus: (status) => deskStatus.push(status) });
    closing.push(() => session.close());
    new SealedDesk({ particulars: () => ANNA, onSealed: (sealed) => received.push(sealed) }).attach(session.channel);
    const application = openWalletLink({ uri: session.uri, privateKey: newLinkKey(), name: 'A wallet', offered: { version: 1, network: 'chipnet', profiles: [], bindings: [] }, onStatus: () => undefined });
    closing.push(() => application.close());
    for (let attempt = 0; attempt < 100 && !deskStatus.some((status) => status.reason !== undefined); attempt++) await new Promise((done) => setTimeout(done, 50));
    expect(deskStatus.at(-1)).toMatchObject({ state: 'disconnected', reason: expect.stringContaining('does not offer') as unknown });
    expect(deskStatus.some((status) => status.state === 'connected')).toBe(false);
    expect(RECOVERER_EXTENSION).toBe('gw_recoverer_v1');
  }, 20_000);

  it('takes no message of another extension that arrives on it', async () => {
    const { joined, courier, received } = await connect();
    await courier.particulars(10_000);
    // An application's request, sent on the recoverer's session: the page does not take it.
    await (joined.channel.send as (message: unknown) => Promise<void>)({ action: ACTION_REQUEST, time: Math.floor(Date.now() / 1000), sequence: 2, id: 'request', kind: 'enroll', sealed: 'abcd' });
    await new Promise((done) => setTimeout(done, 500));
    expect(received).toEqual([]);
    expect((await courier.send({ expected: ANNA, kind: 'takeover', sealed: KIT, timeoutMs: 10_000 })).status).toBe('received');
    expect(received.map((sealed) => sealed.kind)).toEqual(['takeover']);
  }, 30_000);
});
