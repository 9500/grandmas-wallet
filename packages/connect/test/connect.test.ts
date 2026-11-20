import { describe, expect, it } from 'vitest';

import {
  type ActionDetails,
  type Channel,
  type LedgerEntry,
  type Proposal,
  type RecordedPositionReport,
  type TemplateName,
  type TemplateTexts,
  type XoMessage,
  ACTION_REQUEST,
  DappRequests,
  NO_PLAIN_SIGNING,
  ProtocolError,
  RequestRefusedError,
  WalletConnector,
  WalletSilentError,
  XO_EXTENSION,
  readAdvertisement,
  refusalOfStandardRequest,
  temporaryLedger,
} from '../src/index.js';
import { pairingOf } from '../src/wizard.js';

/**
 * The messages between an application and a wallet, and the wallet's rule that a request is carried out at
 * most once. The wallet in these tests names a template by the first line of its text; what a real wallet
 * checks about a template is tested with the wallet (`test/applications-session.test.ts`).
 */
const hash = (seed: string): string => seed.repeat(32);
const TEXTS: TemplateTexts = { template: `${hash('aa')}\nSample application` };
const TEMPLATE: TemplateName = { identifier: hash('a1'), contentHash: hash('aa') };
const OTHER: TemplateName = { identifier: hash('b1'), contentHash: hash('bb') };
const POSITION: RecordedPositionReport = { category: hash('c1'), commitment: '01', capability: 'none', satoshis: '1000', status: 'open', lockingScript: 'jar', variables: { key: hash('c1') } };

/** What the application asks for. */
const ask = (variables: ActionDetails['variables'] = { amount: '5000' }, more: Partial<ActionDetails> = {}): ActionDetails => ({
  template: TEMPLATE,
  templateAction: 'deposit',
  role: 'saver',
  variables,
  ...more,
});

/** Two ends of a connection in memory. Everything sent is kept, so that it can be delivered again. */
const link = () => {
  const toWallet: ((message: unknown) => void)[] = [];
  const toDapp: ((message: unknown) => void)[] = [];
  const sentToWallet: XoMessage[] = [];
  const sentToDapp: XoMessage[] = [];
  let sequence = 0;
  const end = (out: ((message: unknown) => void)[], log: XoMessage[], incoming: ((message: unknown) => void)[]): Channel => ({
    send: async (message) => {
      log.push(message);
      // Delivered as a copy, as over a network.
      for (const handler of [...out]) handler(JSON.parse(JSON.stringify(message)));
    },
    onMessage: (handler) => {
      incoming.push(handler);
      return () => void incoming.splice(incoming.indexOf(handler), 1);
    },
    nextSequence: () => (sequence += 2),
  });
  return { dapp: end(toWallet, sentToWallet, toDapp), wallet: end(toDapp, sentToDapp, toWallet), sentToWallet, sentToDapp, deliverToWallet: (message: unknown) => toWallet.forEach((handler) => handler(message)) };
};

const settle = () => new Promise((done) => setTimeout(done, 0));

const setup = (options: { fail?: boolean; storage?: ReturnType<typeof temporaryLedger>; now?: () => number; trusted?: boolean; unreadable?: boolean } = {}) => {
  const wires = link();
  const executed: LedgerEntry[] = [];
  const trusted: TemplateName[] = options.trusted === true ? [TEMPLATE] : [];
  let proposals: Proposal[] = [];
  const connector = new WalletConnector({
    has: (template) => trusted.some((known) => known.identifier === template.identifier && known.contentHash === template.contentHash),
    check: (template, texts) => {
      if (!texts.template.startsWith(template.contentHash)) throw new Error('The template sent with the request is not the one the request names.');
    },
    positions: async (template, application) => {
      if (!trusted.some((known) => known.identifier === template) || application !== 'application') return undefined;
      if (options.unreadable === true) throw new Error('The network could not be reached.');
      return [POSITION];
    },
    ...(options.storage === undefined ? {} : { storage: options.storage }),
    ...(options.now === undefined ? {} : { now: options.now }),
    execute: async (entry, stage) => {
      executed.push({ ...entry });
      if (options.fail === true) throw new Error('Not enough funds.');
      // Approving a request for a template the wallet did not have is what trusts it.
      if (!entry.templateKnown) trusted.push(entry.template);
      stage('recorded');
      stage('sent');
      return { transactionId: `tx-${executed.length}` };
    },
    onProposals: (open) => {
      proposals = open;
    },
  });
  connector.attach('application', wires.wallet);
  const dapp = new DappRequests(options.now);
  dapp.attach(wires.dapp);
  return { ...wires, connector, dapp, executed, trusted, proposals: () => proposals };
};

describe('announcing the extension', () => {
  const offered = { version: 2, network: 'chipnet', bindings: ['receive', 'change', 'return', 'lasting'] };

  it('reads what a wallet offers: the version, the network and the kinds of output, and nothing else', () => {
    expect(readAdvertisement({ chunk: {}, [XO_EXTENSION]: { ...offered, templates: [TEMPLATE], profiles: ['recoverable-app-v1'], versions: [1, 2] } })).toEqual(offered);
  });

  it('finds nothing in a wallet that does not offer the extension', () => {
    expect(readAdvertisement({ chunk: {} })).toBeUndefined();
    expect(readAdvertisement(undefined)).toBeUndefined();
  });

  it('refuses another version rather than guessing, the earlier one included', () => {
    expect(() => readAdvertisement({ [XO_EXTENSION]: { ...offered, version: 1, profiles: ['recoverable-app-v1'], versions: [1, 2] } })).toThrow(ProtocolError);
    expect(() => readAdvertisement({ [XO_EXTENSION]: { ...offered, version: 3 } })).toThrow(ProtocolError);
    expect(() => readAdvertisement({ [XO_EXTENSION]: 'yes' })).toThrow(ProtocolError);
  });
});

describe('a standard request for signatures', () => {
  it('AP13: is refused with a reason', () => {
    const refusal = refusalOfStandardRequest({ action: 'sign_transaction_request', time: 1, sequence: 14, transaction: {}, inputPaths: [] }, 1_795_000_000);
    expect(refusal).toEqual({ action: 'sign_transaction_response', time: 1_795_000_000, sequence: 14, signedTransaction: '', error: NO_PLAIN_SIGNING });
    expect(NO_PLAIN_SIGNING).toContain('does not sign a transaction that an application built');
    // Nothing else is answered that way.
    expect(refusalOfStandardRequest({ action: ACTION_REQUEST, sequence: 2 }, 1)).toBeUndefined();
  });
});

describe('the name of a pairing', () => {
  it('is the same whenever an application comes back with its address, and differs between applications', () => {
    expect(pairingOf('wiz://one')).toBe(pairingOf('wiz://one'));
    expect(pairingOf('wiz://one')).not.toBe(pairingOf('wiz://two'));
    expect(pairingOf('wiz://one')).not.toContain('one');
  });
});

describe('a request from an application', () => {
  it('is carried out after the user approves, with progress reported', async () => {
    const { dapp, executed, proposals } = setup({ trusted: true });
    const stages: string[] = [];
    const result = dapp.request(ask({ amount: '5000', unlockTime: 1_900_000_000 }, { bindings: { holder: 'receive' }, creates: 'key', about: { category: hash('c1'), spent: false }, page: 'https://jar.example/' }), TEXTS, (stage) => stages.push(stage));
    await settle();
    expect(executed).toHaveLength(0);
    expect(proposals().map(({ entry }) => [entry.application, entry.templateAction, entry.role, entry.variables, entry.bindings, entry.creates, entry.about, entry.page])).toEqual([
      ['application', 'deposit', 'saver', { amount: '5000', unlockTime: 1_900_000_000 }, { holder: 'receive' }, 'key', { category: hash('c1'), spent: false }, 'https://jar.example/'],
    ]);
    await proposals()[0]?.approve();
    expect(await result).toEqual({ transactionId: 'tx-1' });
    expect(stages).toEqual(['sent', 'accepted', 'approved', 'recorded', 'on-network']);
    expect(proposals()).toEqual([]);
  });

  it('is not carried out when the user declines', async () => {
    const { dapp, executed, proposals } = setup({ trusted: true });
    const result = dapp.request(ask());
    await settle();
    await proposals()[0]?.decline();
    await expect(result).rejects.toBeInstanceOf(RequestRefusedError);
    expect(executed).toHaveLength(0);
  });

  it('reports a failure in the wallet to the application', async () => {
    const { dapp, proposals } = setup({ trusted: true, fail: true });
    const result = dapp.request(ask());
    await settle();
    await proposals()[0]?.approve();
    await expect(result).rejects.toThrow('Not enough funds.');
  });

  it('is refused when it is not in a form the wallet accepts', async () => {
    const { dapp, proposals } = setup({ trusted: true });
    await expect(dapp.request(ask({ nested: { a: 1 } as unknown as string }))).rejects.toThrow('does not accept');
    await expect(dapp.request({ ...ask(), role: '' })).rejects.toThrow('missing something');
    await expect(dapp.request({ ...ask(), template: { identifier: 'sample', contentHash: hash('aa') } })).rejects.toThrow('does not name its template');
    await expect(dapp.request(ask(undefined, { about: { category: 'the key', spent: true } }))).rejects.toThrow('position it is about');
    await expect(dapp.request(ask(undefined, { page: 'javascript:alert(1)' }))).rejects.toThrow('application\'s page');
    await expect(dapp.request(ask(undefined, { inputs: { factory: 'the factory' } }))).rejects.toThrow('names coins');
    expect(proposals()).toEqual([]);
  });
});

describe('a template the wallet does not have', () => {
  it('is asked for, sent whole, and trusted only by the user approving', async () => {
    const { dapp, executed, trusted, proposals, sentToWallet, sentToDapp } = setup();
    const result = dapp.request(ask(), TEXTS);
    await settle();
    // The first request names the template; the wallet answers that it does not have it; the texts follow.
    expect((sentToWallet[0] as ActionDetails).definition).toBeUndefined();
    expect(sentToDapp[0]).toMatchObject({ accepted: false, templateNeeded: true });
    expect((sentToWallet[1] as ActionDetails).definition).toEqual(TEXTS);
    expect((sentToWallet[1] as { id?: string }).id).toBe((sentToWallet[0] as { id?: string }).id);
    // The user is shown the request together with the template it would trust.
    expect(proposals()[0]?.entry.templateKnown).toBe(false);
    expect(proposals()[0]?.entry.definition).toEqual(TEXTS);
    expect(trusted).toEqual([]);
    await proposals()[0]?.approve();
    await result;
    expect(trusted).toEqual([TEMPLATE]);
    expect(executed[0]?.definition).toEqual(TEXTS);
  });

  it('is not trusted when the user declines', async () => {
    const { dapp, trusted, proposals } = setup();
    const result = dapp.request(ask(), TEXTS);
    await settle();
    await proposals()[0]?.decline();
    await expect(result).rejects.toBeInstanceOf(RequestRefusedError);
    expect(trusted).toEqual([]);
  });

  it('is not asked for again once trusted', async () => {
    const { dapp, proposals, sentToWallet } = setup();
    const first = dapp.request(ask(), TEXTS);
    await settle();
    await proposals()[0]?.approve();
    await first;
    const before = sentToWallet.length;
    const second = dapp.request(ask({ amount: '700' }), TEXTS);
    await settle();
    expect(sentToWallet.length).toBe(before + 1);
    expect(proposals()[0]?.entry.templateKnown).toBe(true);
    expect(proposals()[0]?.entry.definition).toBeUndefined();
    await proposals()[0]?.approve();
    expect(await second).toEqual({ transactionId: 'tx-2' });
  });

  it('is refused when the application has no template to send', async () => {
    const { dapp, proposals } = setup();
    await expect(dapp.request(ask())).rejects.toThrow('does not have that template');
    expect(proposals()).toEqual([]);
  });

  it('is refused when what was sent is not what the request names', async () => {
    const { dapp, proposals } = setup();
    await expect(dapp.request(ask(), { template: `${hash('bb')}\nAnother application` })).rejects.toThrow('not the one the request names');
    expect(proposals()).toEqual([]);
  });

  it('does not keep the texts that came with a request once the request is decided', async () => {
    const storage = temporaryLedger();
    const { dapp, proposals } = setup({ storage });
    const result = dapp.request(ask(), TEXTS);
    await settle();
    expect(storage.load()[0]?.definition).toEqual(TEXTS);
    await proposals()[0]?.approve();
    await result;
    expect(storage.load()[0]?.definition).toBeUndefined();
  });
});

describe('positions', () => {
  it('are reported for a template the user trusted with this application, without asking the user', async () => {
    const { dapp, proposals } = setup({ trusted: true });
    expect(await dapp.recordedPositions(TEMPLATE.identifier)).toEqual({ trusted: true, positions: [POSITION] });
    expect(proposals()).toEqual([]);
  });

  it('are not said to be none when the wallet could not read them', async () => {
    const { dapp } = setup({ trusted: true, unreadable: true });
    await expect(dapp.recordedPositions(TEMPLATE.identifier)).rejects.toThrow('could not read what it holds: The network could not be reached.');
  });

  it('are not said to be none when the wallet does not answer', async () => {
    const wires = link();
    const dapp = new DappRequests();
    dapp.attach(wires.dapp);
    await expect(dapp.recordedPositions(TEMPLATE.identifier, 2, 5)).rejects.toBeInstanceOf(WalletSilentError);
    // Asked twice, as the same question.
    expect(wires.sentToWallet.map((message) => (message as { id?: string }).id)).toEqual([expect.any(String), expect.any(String)]);
    expect(new Set(wires.sentToWallet.map((message) => (message as { id?: string }).id)).size).toBe(1);
  });

  it('are asked for again when the first asking gets no answer', async () => {
    const { dapp, wallet, connector } = setup({ trusted: true });
    // The wallet's first answer is lost on the way.
    const send = wallet.send.bind(wallet);
    let lost = 0;
    wallet.send = async (message) => {
      if (message.action === 'xo_positions' && lost === 0) {
        lost += 1;
        return;
      }
      await send(message);
    };
    void connector;
    expect((await dapp.recordedPositions(TEMPLATE.identifier, 3, 5)).positions).toHaveLength(1);
    expect(lost).toBe(1);
  });

  it('are not reported for a template the wallet does not trust, or trusts with another application', async () => {
    const { dapp } = setup();
    expect(await dapp.recordedPositions(TEMPLATE.identifier)).toEqual({ trusted: false, positions: [] });
    expect(await dapp.recordedPositions(OTHER.identifier)).toEqual({ trusted: false, positions: [] });
    const second = setup({ trusted: true });
    const wires = link();
    second.connector.attach('another application', wires.wallet);
    const other = new DappRequests();
    other.attach(wires.dapp);
    expect(await other.recordedPositions(TEMPLATE.identifier)).toEqual({ trusted: false, positions: [] });
    expect(await second.dapp.recordedPositions(TEMPLATE.identifier)).toEqual({ trusted: true, positions: [POSITION] });
  });
});

describe('requests delivered more than once', () => {
  it('AP03: a request is carried out once however often it arrives', async () => {
    const { dapp, executed, proposals, sentToWallet, deliverToWallet } = setup({ trusted: true });
    const result = dapp.request(ask());
    await settle();
    const [original] = sentToWallet;
    // Delivered again while the user has not decided: still one proposal.
    deliverToWallet(original);
    await settle();
    expect(proposals()).toHaveLength(1);
    await proposals()[0]?.approve();
    await result;
    // Replayed after it was carried out, twice.
    deliverToWallet(original);
    deliverToWallet({ ...original, sequence: 99, time: (original?.time ?? 0) + 5 });
    await settle();
    expect(executed).toHaveLength(1);
    expect(proposals()).toEqual([]);
  });

  it('AP03: an application that reconnects and asks again is given the stored outcome', async () => {
    const { dapp, executed, proposals, sentToDapp } = setup({ trusted: true });
    const first = dapp.request(ask(), undefined, undefined, 'request-1');
    await settle();
    await proposals()[0]?.approve();
    await first;
    const before = sentToDapp.length;
    // The application lost its state and asks with the identifier it had saved.
    expect(await dapp.request(ask(), undefined, undefined, 'request-1')).toEqual({ transactionId: 'tx-1' });
    expect(executed).toHaveLength(1);
    expect(sentToDapp.length).toBeGreaterThan(before);
  });

  it('AP03: the same identifier with other content is refused', async () => {
    const { dapp, executed, proposals } = setup({ trusted: true });
    const first = dapp.request(ask(), undefined, undefined, 'request-1');
    await settle();
    await proposals()[0]?.approve();
    await first;
    await expect(dapp.request(ask({ amount: '900000' }), undefined, undefined, 'request-1')).rejects.toThrow('different request');
    await expect(dapp.request(ask(undefined, { about: { category: hash('c1'), spent: true } }), undefined, undefined, 'request-1')).rejects.toThrow('different request');
    await expect(dapp.request(ask(undefined, { inputs: { factory: `${hash('f0')}:1` } }), undefined, undefined, 'request-1')).rejects.toThrow('different request');
    await expect(dapp.request(ask(undefined, { bindings: { holder: 'lasting' } }), undefined, undefined, 'request-1')).rejects.toThrow('different request');
    await expect(dapp.request(ask(undefined, { creates: 'key' }), undefined, undefined, 'request-1')).rejects.toThrow('different request');
    expect(executed).toHaveLength(1);
  });

  it('keeps a decline final', async () => {
    const { dapp, executed, proposals } = setup({ trusted: true });
    const first = dapp.request(ask(), undefined, undefined, 'request-1');
    await settle();
    await proposals()[0]?.decline();
    await expect(first).rejects.toBeInstanceOf(RequestRefusedError);
    await expect(dapp.request(ask(), undefined, undefined, 'request-1')).rejects.toBeInstanceOf(RequestRefusedError);
    expect(proposals()).toEqual([]);
    expect(executed).toHaveLength(0);
  });

  it('refuses a request recorded long ago and replayed to a wallet that no longer remembers it', async () => {
    const clock = { now: 2_000_000_000 };
    const { connector, proposals, sentToDapp } = setup({ trusted: true, now: () => clock.now });
    await connector.receive('application', { action: ACTION_REQUEST, time: clock.now - 3_600, sequence: 2, id: 'old', ...ask() });
    expect(proposals()).toEqual([]);
    expect(sentToDapp.at(-1)).toMatchObject({ accepted: false, reason: expect.stringContaining('too old') as unknown });
  });

  it('does not run again a request that was under way when the wallet closed', async () => {
    const storage = temporaryLedger();
    storage.save([{ id: 'request-1', application: 'application', ...ask(), templateKnown: true, receivedAt: Math.floor(Date.now() / 1000), status: 'working' }]);
    const { dapp, executed } = setup({ trusted: true, storage });
    await expect(dapp.request(ask(), undefined, undefined, 'request-1')).rejects.toThrow('was closed while');
    expect(executed).toHaveLength(0);
  });

  it('sends an unanswered request again when the connection returns', async () => {
    const first = link();
    const dapp = new DappRequests();
    dapp.attach(first.dapp);
    // Nobody is listening on the first connection.
    const result = dapp.request(ask());
    await settle();
    const second = link();
    const executed: string[] = [];
    const connector = new WalletConnector({
      has: () => true,
      check: () => undefined,
      positions: async () => [],
      execute: async (entry) => {
        executed.push(entry.id);
        return { done: true };
      },
      onProposals: (open) => void open[0]?.approve(),
    });
    connector.attach('application', second.wallet);
    dapp.attach(second.dapp);
    expect(await result).toEqual({ done: true });
    expect(executed).toHaveLength(1);
    expect((first.sentToWallet[0] as { id?: string }).id).toBe((second.sentToWallet[0] as { id?: string }).id);
  });

  it('two applications that choose the same identifier do not meet', async () => {
    const { dapp, connector, executed, proposals } = setup({ trusted: true });
    const first = dapp.request(ask(), undefined, undefined, 'request-1');
    await settle();
    await proposals()[0]?.approve();
    await first;
    const wires = link();
    connector.attach('another application', wires.wallet);
    const other = new DappRequests();
    other.attach(wires.dapp);
    const second = other.request(ask({ amount: '900000' }), undefined, undefined, 'request-1');
    await settle();
    expect(proposals()[0]?.entry).toMatchObject({ application: 'another application', variables: { amount: '900000' } });
    await proposals()[0]?.approve();
    expect(await second).toEqual({ transactionId: 'tx-2' });
    expect(executed).toHaveLength(2);
  });
});
