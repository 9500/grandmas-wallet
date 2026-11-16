import { describe, expect, it } from 'vitest';

import {
  type ActionDetails,
  type Channel,
  type LedgerEntry,
  type Proposal,
  type XoMessage,
  ACTION_REQUEST,
  DappRequests,
  ProtocolError,
  RequestRefusedError,
  WalletConnector,
  WalletSilentError,
  XO_EXTENSION,
  readAdvertisement,
  temporaryLedger,
} from '../src/index.js';

/** A template as an application would present it. The wallet in these tests names a template by two of its fields. */
const DEFINITION = { name: 'Sample application', identifier: 'sample-template', contentHash: 'aa'.repeat(32) };
const TEMPLATE = { identifier: DEFINITION.identifier, contentHash: DEFINITION.contentHash };
const OTHER = { name: 'Another application', identifier: 'other-template', contentHash: 'bb'.repeat(32) };

/** What the application asks for, with its template sent along as it would be the first time. */
const ask = (variables: ActionDetails['variables'] = { amount: '5000' }, more: Partial<ActionDetails> = {}): ActionDetails => ({
  template: TEMPLATE,
  definition: DEFINITION,
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
  const trusted = options.trusted === true ? [TEMPLATE] : [];
  let proposals: Proposal[] = [];
  const connector = new WalletConnector({
    trusted: () => trusted,
    identify: (definition) => {
      const { identifier, contentHash } = definition as Partial<typeof DEFINITION>;
      if (typeof identifier !== 'string' || typeof contentHash !== 'string') throw new Error('not a template');
      return { identifier, contentHash };
    },
    positions: async (template) => {
      if (options.unreadable === true) throw new Error('The network could not be reached.');
      return [{ position: 'p-1', label: 'First', output: 'kept', variables: { template }, satoshis: '5000' }];
    },
    ...(options.storage === undefined ? {} : { storage: options.storage }),
    ...(options.now === undefined ? {} : { now: options.now }),
    execute: async (entry, stage) => {
      executed.push({ ...entry });
      if (options.fail === true) throw new Error('Not enough funds.');
      // Approving a request for a template not yet trusted is what trusts it.
      if (!entry.templateTrusted) trusted.push(entry.template);
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

describe('advertising XO requests (X02)', () => {
  const offered = { version: 2, network: 'chipnet', interfaceVersion: 2, bindings: ['identity'], templates: [TEMPLATE] };

  it('reads what a wallet offers', () => {
    expect(readAdvertisement({ chunk: {}, [XO_EXTENSION]: offered })).toEqual(offered);
  });

  it('finds nothing in a wallet that does not offer them', () => {
    expect(readAdvertisement({ chunk: {} })).toBeUndefined();
    expect(readAdvertisement(undefined)).toBeUndefined();
  });

  it('refuses a version it does not know rather than guessing', () => {
    expect(() => readAdvertisement({ [XO_EXTENSION]: { ...offered, version: 1 } })).toThrow(ProtocolError);
    expect(() => readAdvertisement({ [XO_EXTENSION]: { ...offered, version: 3 } })).toThrow(ProtocolError);
    expect(() => readAdvertisement({ [XO_EXTENSION]: 'yes' })).toThrow(ProtocolError);
  });
});

describe('a request from an application', () => {
  it('is carried out after the user approves, with progress reported', async () => {
    const { dapp, executed, proposals } = setup({ trusted: true });
    const stages: string[] = [];
    const result = dapp.request(ask({ amount: '5000', unlockTime: 1_900_000_000 }, { bindings: { identity: 'identity' }, label: 'Holiday' }), (stage) => stages.push(stage));
    await settle();
    expect(executed).toHaveLength(0);
    expect(proposals().map(({ entry }) => [entry.templateAction, entry.role, entry.variables, entry.bindings, entry.label])).toEqual([
      ['deposit', 'saver', { amount: '5000', unlockTime: 1_900_000_000 }, { identity: 'identity' }, 'Holiday'],
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

  it('is refused when a value is of a kind the wallet does not accept', async () => {
    const { dapp, proposals } = setup({ trusted: true });
    await expect(dapp.request(ask({ nested: { a: 1 } as unknown as string }))).rejects.toThrow('does not accept');
    await expect(dapp.request({ ...ask(), role: '' })).rejects.toThrow('missing something');
    expect(proposals()).toEqual([]);
  });
});

describe('a template the wallet has not seen', () => {
  it('comes with the request, and is trusted only by the user approving', async () => {
    const { dapp, executed, trusted, proposals } = setup();
    const result = dapp.request(ask());
    await settle();
    // The user is shown the request together with the template it would trust.
    expect(proposals()[0]?.entry.templateTrusted).toBe(false);
    expect(proposals()[0]?.entry.definition).toEqual(DEFINITION);
    expect(trusted).toEqual([]);
    await proposals()[0]?.approve();
    await result;
    expect(trusted).toEqual([TEMPLATE]);
    expect(executed[0]?.definition).toEqual(DEFINITION);
  });

  it('is not trusted when the user declines', async () => {
    const { dapp, trusted, proposals } = setup();
    const result = dapp.request(ask());
    await settle();
    await proposals()[0]?.decline();
    await expect(result).rejects.toBeInstanceOf(RequestRefusedError);
    expect(trusted).toEqual([]);
  });

  it('is not asked about again once trusted, and need not be sent again', async () => {
    const { dapp, proposals } = setup();
    const first = dapp.request(ask());
    await settle();
    await proposals()[0]?.approve();
    await first;
    const { definition: _definition, ...withoutTemplate } = ask({ amount: '700' });
    const second = dapp.request(withoutTemplate);
    await settle();
    expect(proposals()[0]?.entry.templateTrusted).toBe(true);
    expect(proposals()[0]?.entry.definition).toBeUndefined();
    await proposals()[0]?.approve();
    expect(await second).toEqual({ transactionId: 'tx-2' });
  });

  it('is refused without the template itself', async () => {
    const { dapp, proposals } = setup();
    const { definition: _definition, ...withoutTemplate } = ask();
    await expect(dapp.request(withoutTemplate)).rejects.toThrow('does not know that template');
    expect(proposals()).toEqual([]);
  });

  it('is refused when the template sent is not the one the request names, or is not a template', async () => {
    const { dapp, proposals } = setup();
    await expect(dapp.request({ ...ask(), definition: OTHER })).rejects.toThrow('not the one the request names');
    await expect(dapp.request({ ...ask(), definition: { name: 'Something else' } })).rejects.toThrow('cannot be used');
    expect(proposals()).toEqual([]);
  });

  it('does not keep the template that came with a request once the request is decided', async () => {
    const storage = temporaryLedger();
    const { dapp, proposals } = setup({ storage });
    const result = dapp.request(ask());
    await settle();
    expect(storage.load()[0]?.definition).toEqual(DEFINITION);
    await proposals()[0]?.approve();
    await result;
    expect(storage.load()[0]?.definition).toBeUndefined();
  });
});

describe('positions', () => {
  it('are reported for a template the wallet trusts, without asking the user', async () => {
    const { dapp, proposals } = setup({ trusted: true });
    expect(await dapp.positions(TEMPLATE.identifier)).toEqual([{ position: 'p-1', label: 'First', output: 'kept', variables: { template: TEMPLATE.identifier }, satoshis: '5000' }]);
    expect(proposals()).toEqual([]);
  });

  it('are not said to be none when the wallet could not read them', async () => {
    const { dapp } = setup({ trusted: true, unreadable: true });
    await expect(dapp.positions(TEMPLATE.identifier)).rejects.toThrow('could not read what it holds: The network could not be reached.');
  });

  it('are not said to be none when the wallet does not answer', async () => {
    const wires = link();
    const dapp = new DappRequests();
    dapp.attach(wires.dapp);
    await expect(dapp.positions(TEMPLATE.identifier, 2, 5)).rejects.toBeInstanceOf(WalletSilentError);
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
    expect(await dapp.positions(TEMPLATE.identifier, 3, 5)).toHaveLength(1);
    expect(lost).toBe(1);
  });

  it('are not reported to an application whose template the wallet does not trust', async () => {
    const { dapp } = setup();
    expect(await dapp.positions(TEMPLATE.identifier)).toEqual([]);
    expect(await dapp.positions(OTHER.identifier)).toEqual([]);
  });
});

describe('requests delivered more than once (X03)', () => {
  it('carries out a request once however often it arrives', async () => {
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

  it('gives the outcome again to an application that asks again', async () => {
    const { dapp, executed, proposals, sentToDapp } = setup({ trusted: true });
    const first = dapp.request(ask(), undefined, 'request-1');
    await settle();
    await proposals()[0]?.approve();
    await first;
    const before = sentToDapp.length;
    // The application lost its state and asks with the identifier it had saved.
    expect(await dapp.request(ask(), undefined, 'request-1')).toEqual({ transactionId: 'tx-1' });
    expect(executed).toHaveLength(1);
    expect(sentToDapp.length).toBeGreaterThan(before);
  });

  it('refuses a different request under an identifier already used', async () => {
    const { dapp, executed, proposals } = setup({ trusted: true });
    const first = dapp.request(ask(), undefined, 'request-1');
    await settle();
    await proposals()[0]?.approve();
    await first;
    await expect(dapp.request(ask({ amount: '900000' }), undefined, 'request-1')).rejects.toThrow('different request');
    await expect(dapp.request(ask(undefined, { position: 'p-1' }), undefined, 'request-1')).rejects.toThrow('different request');
    await expect(dapp.request(ask(undefined, { bindings: { owner: 'identity' } }), undefined, 'request-1')).rejects.toThrow('different request');
    expect(executed).toHaveLength(1);
  });

  it('keeps a decline final', async () => {
    const { dapp, executed, proposals } = setup({ trusted: true });
    const first = dapp.request(ask(), undefined, 'request-1');
    await settle();
    await proposals()[0]?.decline();
    await expect(first).rejects.toBeInstanceOf(RequestRefusedError);
    await expect(dapp.request(ask(), undefined, 'request-1')).rejects.toBeInstanceOf(RequestRefusedError);
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
    const { definition: _definition, ...details } = ask();
    storage.save([{ id: 'request-1', ...details, templateTrusted: true, receivedAt: Math.floor(Date.now() / 1000), status: 'working' }]);
    const { dapp, executed } = setup({ trusted: true, storage });
    await expect(dapp.request(ask(), undefined, 'request-1')).rejects.toThrow('was closed while');
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
      trusted: () => [TEMPLATE],
      identify: () => TEMPLATE,
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
});
