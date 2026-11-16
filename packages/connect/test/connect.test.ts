import { describe, expect, it } from 'vitest';

import {
  type Channel,
  type LedgerEntry,
  type Proposal,
  type XoMessage,
  ACTION_REQUEST,
  DappRequests,
  ProtocolError,
  RequestRefusedError,
  WalletConnector,
  XO_EXTENSION,
  readAdvertisement,
  temporaryLedger,
} from '../src/index.js';

const TEMPLATE = { identifier: 'jar-template', contentHash: 'aa'.repeat(32), operations: ['open', 'empty', 'list'] };

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

const setup = (options: { fail?: boolean; storage?: ReturnType<typeof temporaryLedger>; now?: () => number } = {}) => {
  const wires = link();
  const executed: LedgerEntry[] = [];
  let proposals: Proposal[] = [];
  const connector = new WalletConnector({
    templates: [TEMPLATE],
    readOnly: ['list'],
    ...(options.storage === undefined ? {} : { storage: options.storage }),
    ...(options.now === undefined ? {} : { now: options.now }),
    execute: async (entry, stage) => {
      executed.push(entry);
      if (options.fail === true) throw new Error('Not enough funds.');
      stage('recorded');
      stage('sent');
      return { transactionId: `tx-${executed.length}` };
    },
    onProposals: (open) => {
      proposals = open;
    },
  });
  connector.attach('jar', wires.wallet);
  const dapp = new DappRequests(options.now);
  dapp.attach(wires.dapp);
  return { ...wires, connector, dapp, executed, proposals: () => proposals };
};

describe('advertising XO requests (X02)', () => {
  const offered = { version: 1, network: 'chipnet', interfaceVersion: 2, templates: [TEMPLATE] };

  it('reads what a wallet offers', () => {
    expect(readAdvertisement({ chunk: {}, [XO_EXTENSION]: offered })).toEqual(offered);
  });

  it('finds nothing in a wallet that does not offer them', () => {
    expect(readAdvertisement({ chunk: {} })).toBeUndefined();
    expect(readAdvertisement(undefined)).toBeUndefined();
  });

  it('refuses a version it does not know rather than guessing', () => {
    expect(() => readAdvertisement({ [XO_EXTENSION]: { ...offered, version: 2 } })).toThrow(ProtocolError);
    expect(() => readAdvertisement({ [XO_EXTENSION]: 'yes' })).toThrow(ProtocolError);
  });
});

describe('a request from an application', () => {
  it('is carried out after the user approves, with progress reported', async () => {
    const { dapp, executed, proposals } = setup();
    const stages: string[] = [];
    const result = dapp.request(TEMPLATE.identifier, 'open', { satoshis: '5000', unlockTime: 1_900_000_000 }, (stage) => stages.push(stage));
    await settle();
    expect(executed).toHaveLength(0);
    expect(proposals().map(({ entry }) => entry.parameters)).toEqual([{ satoshis: '5000', unlockTime: 1_900_000_000 }]);
    await proposals()[0]?.approve();
    expect(await result).toEqual({ transactionId: 'tx-1' });
    expect(stages).toEqual(['sent', 'accepted', 'approved', 'recorded', 'on-network']);
    expect(proposals()).toEqual([]);
  });

  it('is not carried out when the user declines', async () => {
    const { dapp, executed, proposals } = setup();
    const result = dapp.request(TEMPLATE.identifier, 'open', { satoshis: '5000' });
    await settle();
    await proposals()[0]?.decline();
    await expect(result).rejects.toBeInstanceOf(RequestRefusedError);
    expect(executed).toHaveLength(0);
  });

  it('reports a failure in the wallet to the application', async () => {
    const { dapp, proposals } = setup({ fail: true });
    const result = dapp.request(TEMPLATE.identifier, 'open', { satoshis: '5000' });
    await settle();
    await proposals()[0]?.approve();
    await expect(result).rejects.toThrow('Not enough funds.');
  });

  it('is answered without asking when it only reads', async () => {
    const { dapp, executed, proposals } = setup();
    expect(await dapp.request(TEMPLATE.identifier, 'list', {})).toEqual({ transactionId: 'tx-1' });
    expect(proposals()).toEqual([]);
    expect(executed).toHaveLength(1);
  });

  it('is refused for a template the wallet has not reviewed, or an operation it does not offer', async () => {
    const { dapp, proposals } = setup();
    await expect(dapp.request('some-other-template', 'open', {})).rejects.toThrow('has not reviewed');
    await expect(dapp.request(TEMPLATE.identifier, 'drain', {})).rejects.toThrow('does not offer');
    expect(proposals()).toEqual([]);
  });

  it('is refused when a value is of a kind the wallet does not accept', async () => {
    const { dapp, proposals } = setup();
    await expect(dapp.request(TEMPLATE.identifier, 'open', { nested: { a: 1 } as unknown as string })).rejects.toThrow('does not accept');
    expect(proposals()).toEqual([]);
  });
});

describe('requests delivered more than once (X03)', () => {
  it('carries out a request once however often it arrives', async () => {
    const { dapp, executed, proposals, sentToWallet, deliverToWallet } = setup();
    const result = dapp.request(TEMPLATE.identifier, 'open', { satoshis: '5000' });
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
    const { dapp, executed, proposals, sentToDapp } = setup();
    const first = dapp.request(TEMPLATE.identifier, 'open', { satoshis: '5000' }, undefined, 'request-1');
    await settle();
    await proposals()[0]?.approve();
    await first;
    const before = sentToDapp.length;
    // The application lost its state and asks with the identifier it had saved.
    expect(await dapp.request(TEMPLATE.identifier, 'open', { satoshis: '5000' }, undefined, 'request-1')).toEqual({ transactionId: 'tx-1' });
    expect(executed).toHaveLength(1);
    expect(sentToDapp.length).toBeGreaterThan(before);
  });

  it('refuses a different request under an identifier already used', async () => {
    const { dapp, executed, proposals } = setup();
    const first = dapp.request(TEMPLATE.identifier, 'open', { satoshis: '5000' }, undefined, 'request-1');
    await settle();
    await proposals()[0]?.approve();
    await first;
    await expect(dapp.request(TEMPLATE.identifier, 'open', { satoshis: '900000' }, undefined, 'request-1')).rejects.toThrow('different request');
    expect(executed).toHaveLength(1);
  });

  it('keeps a decline final', async () => {
    const { dapp, executed, proposals } = setup();
    const first = dapp.request(TEMPLATE.identifier, 'open', { satoshis: '5000' }, undefined, 'request-1');
    await settle();
    await proposals()[0]?.decline();
    await expect(first).rejects.toBeInstanceOf(RequestRefusedError);
    await expect(dapp.request(TEMPLATE.identifier, 'open', { satoshis: '5000' }, undefined, 'request-1')).rejects.toBeInstanceOf(RequestRefusedError);
    expect(proposals()).toEqual([]);
    expect(executed).toHaveLength(0);
  });

  it('refuses a request recorded long ago and replayed to a wallet that no longer remembers it', async () => {
    const clock = { now: 2_000_000_000 };
    const { connector, proposals, sentToDapp } = setup({ now: () => clock.now });
    await connector.receive('jar', { action: ACTION_REQUEST, time: clock.now - 3_600, sequence: 2, id: 'old', template: TEMPLATE.identifier, operation: 'open', parameters: {} });
    expect(proposals()).toEqual([]);
    expect(sentToDapp.at(-1)).toMatchObject({ accepted: false, reason: expect.stringContaining('too old') as unknown });
  });

  it('does not run again a request that was under way when the wallet closed', async () => {
    const storage = temporaryLedger();
    storage.save([{ id: 'request-1', template: TEMPLATE.identifier, operation: 'open', parameters: { satoshis: '5000' }, receivedAt: Math.floor(Date.now() / 1000), status: 'working' }]);
    const { dapp, executed } = setup({ storage });
    await expect(dapp.request(TEMPLATE.identifier, 'open', { satoshis: '5000' }, undefined, 'request-1')).rejects.toThrow('was closed while');
    expect(executed).toHaveLength(0);
  });

  it('sends an unanswered request again when the connection returns', async () => {
    const first = link();
    const dapp = new DappRequests();
    dapp.attach(first.dapp);
    // Nobody is listening on the first connection.
    const result = dapp.request(TEMPLATE.identifier, 'list', {});
    await settle();
    const second = link();
    const executed: string[] = [];
    const connector = new WalletConnector({
      templates: [TEMPLATE],
      readOnly: ['list'],
      execute: async (entry) => {
        executed.push(entry.id);
        return { positions: [] };
      },
      onProposals: () => undefined,
    });
    connector.attach('jar', second.wallet);
    dapp.attach(second.dapp);
    expect(await result).toEqual({ positions: [] });
    expect(executed).toHaveLength(1);
    expect(first.sentToWallet[0]?.id).toBe(second.sentToWallet[0]?.id);
  });
});
