import { hexToBin } from '@bitauth/libauth';
import { applicationConnector, walletAnnouncement } from '@grandmas-wallet/app';
import { textHash } from '@grandmas-wallet/core';
import { type ActionDetails, type Channel, type Proposal, type XoMessage, DappRequests, XO_EXTENSION, readAdvertisement } from '@grandmas-wallet/connect';
import { describe, expect, it } from 'vitest';

import { type Device, deviceWith, hex, keyedBox, seedOf, strongbox } from './support/applications.js';

/**
 * Acceptance tests AP01, AP03 and AP05 of the proposal: a session between an application and the wallet, with the
 * wallet's own handling of templates behind the messages. Positions requests are answered from the wallet's records
 * (PR18 has them after a recovery). The connection is a pair of
 * queues in memory; everything that crosses it is kept.
 */

const link = () => {
  const toWallet: ((message: unknown) => void)[] = [];
  const toDapp: ((message: unknown) => void)[] = [];
  const sentToWallet: XoMessage[] = [];
  const sentToDapp: XoMessage[] = [];
  let sequence = 0;
  const end = (out: ((message: unknown) => void)[], log: XoMessage[], incoming: ((message: unknown) => void)[]): Channel => ({
    send: async (message) => {
      log.push(message);
      for (const handler of [...out]) handler(JSON.parse(JSON.stringify(message)));
    },
    onMessage: (handler) => {
      incoming.push(handler);
      return () => void incoming.splice(incoming.indexOf(handler), 1);
    },
    nextSequence: () => (sequence += 2),
  });
  return { dappEnd: end(toWallet, sentToWallet, toDapp), wallet: end(toDapp, sentToDapp, toWallet), sentToWallet, sentToDapp };
};
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn++) await new Promise((done) => setTimeout(done, 0));
};

/** A wallet with its connector, and applications that connect to it, each with a pairing of its own. */
const session = async (values: bigint[] = [100_000n, 60_000n]) => {
  const device = await deviceWith(values);
  let proposals: Proposal[] = [];
  const connector = applicationConnector(device.applications, { onProposals: (open) => (proposals = open) });
  const connect = (pairing: string) => {
    const wires = link();
    connector.attach(pairing, wires.wallet);
    const dapp = new DappRequests();
    dapp.attach(wires.dappEnd);
    return { dapp, ...wires };
  };
  return { device, connector, connect, proposals: () => proposals };
};
const open = (presented: { names: ActionDetails['template'] }, variables: ActionDetails['variables'] = { amount: 30_000, label: '01' }): ActionDetails => ({
  template: presented.names,
  templateAction: 'open',
  role: 'holder',
  variables,
});
/** Everything a wallet knows that an application must never be sent. */
const secretsOf = (device: Device): string[] => {
  const seed = seedOf(0);
  return [hex(device.identity), hex(seed.viewingKey.blindingSeed), ...Object.values(seed.viewingKey.addressNodes).map((node) => String(node)), hex(seed.controllerKey.publicKey), hex(seed.controllerKey.keyHash)];
};

describe('a session with an application', () => {
  it('the wallet announces version 2 and the kinds of output it fills, and names no template and no profile', () => {
    const announced = walletAnnouncement('chipnet');
    expect(announced).toEqual({ version: 2, network: 'chipnet', bindings: ['receive', 'change', 'return', 'lasting'] });
    expect(readAdvertisement({ [XO_EXTENSION]: announced })).toEqual(announced);
  });

  it('AP01: an unknown template is shown with what the wallet can see of it, and trusted only on the user\'s word', async () => {
    const { device, connect, proposals } = await session();
    const { dapp } = connect('first application');
    const result = dapp.request(open(strongbox), strongbox.texts);
    await settle();
    const [proposal] = proposals();
    if (proposal === undefined) throw new Error('no proposal');
    // What the user is shown: the template's own words about itself, and what each of its actions would leave behind.
    expect(proposal.entry.templateKnown).toBe(false);
    const shown = device.applications.describe(proposal.entry.template, proposal.entry.definition);
    expect(shown).toMatchObject({ name: 'Strongbox', trusted: false });
    expect(shown).not.toHaveProperty('verdict');
    expect(shown.findings.map(({ finding }) => finding)).toEqual(['comes back', 'comes back', 'comes back']);
    expect(shown.actions.map(({ name }) => name)).toEqual(['Open a strongbox', 'Put coins in', 'Take everything out']);
    // Nothing is trusted, stored or sent before the user agrees.
    expect(device.applications.templates).toEqual([]);
    const broadcasts = device.chain.broadcasts;
    await proposal.approve();
    const outcome = (await result) as { transactionId: string; tokens: { category: string }[] };
    expect(device.chain.broadcasts).toBe(broadcasts + 1);
    expect(device.applications.templates).toMatchObject([{ name: 'Strongbox', applications: ['first application'], stored: true }]);
    expect(outcome.tokens).toHaveLength(1);
  });

  it('AP01: a template that the user declines is not trusted', async () => {
    const { device, connect, proposals } = await session();
    const { dapp } = connect('first application');
    const result = dapp.request(open(strongbox), strongbox.texts);
    await settle();
    await proposals()[0]?.decline();
    await expect(result).rejects.toThrow('declined');
    expect(device.applications.templates).toEqual([]);
  });

  it('AP01: a template that is not the one the request names by hash is refused', async () => {
    const { device, connect, proposals } = await session();
    const { dapp } = connect('first application');
    // Another template under the name of the first.
    await expect(dapp.request(open(strongbox), keyedBox.texts)).rejects.toThrow('not the one the request names');
    // The same template as another text: the same identifier, another content hash.
    const spaced = JSON.stringify(JSON.parse(strongbox.texts.template), undefined, 1);
    await expect(dapp.request(open(strongbox), { template: spaced })).rejects.toThrow('not the one the request names');
    expect(proposals()).toEqual([]);
    expect(device.applications.templates).toEqual([]);
  });

  it('AP01: a later text under the same identifier does not replace the template the user trusted without the user\'s word', async () => {
    const { device, connect, proposals } = await session();
    const { dapp } = connect('first application');
    const first = dapp.request(open(strongbox), strongbox.texts);
    await settle();
    await proposals()[0]?.approve();
    await first;
    // The same template comes again as another text: the same identifier, another content hash. The wallet does not
    // have it; it is shown as a template to be trusted, and the one the user trusted stays as it was.
    const text = JSON.stringify(JSON.parse(strongbox.texts.template), undefined, 1);
    const later = { identifier: strongbox.names.identifier, contentHash: textHash(text) };
    expect(later.contentHash).not.toBe(strongbox.names.contentHash);
    expect(device.applications.has(later)).toBe(false);
    const again = dapp.request({ ...open(strongbox), template: later }, { template: text });
    await settle();
    expect(proposals()).toHaveLength(1);
    expect(device.applications.describe(later, { template: text })).toMatchObject({ trusted: false });
    await proposals()[0]?.decline();
    await expect(again).rejects.toThrow('declined');
    expect(device.applications.templates).toHaveLength(1);
    expect(device.applications.templates[0]?.contentHash).toBe(strongbox.names.contentHash);
  });
  it('AP03: a request that is repeated, or asked again after a reconnect, is carried out once; the same id with other content is refused', async () => {
    const { device, connector, connect, proposals } = await session();
    const first = connect('first application');
    const result = first.dapp.request(open(strongbox), strongbox.texts, undefined, 'request-1');
    await settle();
    await proposals()[0]?.approve();
    const outcome = await result;
    const broadcasts = device.chain.broadcasts;
    // The application's page is loaded again and connects anew; it asks with the identifier it had saved.
    const again = link();
    connector.attach('first application', again.wallet);
    const returned = new DappRequests();
    returned.attach(again.dappEnd);
    expect(await returned.request(open(strongbox), strongbox.texts, undefined, 'request-1')).toEqual(outcome);
    await expect(returned.request(open(strongbox, { amount: 90_000, label: '01' }), strongbox.texts, undefined, 'request-1')).rejects.toThrow('different request');
    expect(device.chain.broadcasts).toBe(broadcasts);
    expect(await device.applications.tokens()).toHaveLength(1);
  });

  it('AP05: an application is never sent the identity, a viewing key or a list of the user\'s templates; only addresses of its own transactions', async () => {
    const { device, connect, proposals } = await session();
    // The user already deals with another application.
    const other = connect('another application');
    const elsewhere = other.dapp.request(open(strongbox), strongbox.texts);
    await settle();
    await proposals()[0]?.approve();
    const { tokens: otherTokens } = (await elsewhere) as { tokens: { category: string }[] };

    const { dapp, sentToDapp } = connect('first application');
    const opened = dapp.request(open(keyedBox), keyedBox.texts);
    await settle();
    await proposals()[0]?.approve();
    const { transactionId, tokens } = (await opened) as { transactionId: string; tokens: { category: string }[] };
    const held = await dapp.recordedPositions(keyedBox.names.identifier);
    expect(held.positions).toHaveLength(1);
    const taken = dapp.request({ template: keyedBox.names, templateAction: 'take', role: 'holder', variables: {}, about: { category: tokens[0]?.category ?? '', spent: true } }, keyedBox.texts);
    await settle();
    await proposals()[0]?.approve();
    const second = (await taken) as { transactionId: string };
    await dapp.recordedPositions(strongbox.names.identifier);
    await dapp.recordedPositions(keyedBox.names.identifier);

    const everything = JSON.stringify(sentToDapp);
    for (const secret of secretsOf(device)) expect(everything).not.toContain(secret);
    // Nothing about the other application: neither its template nor its tokens.
    expect(everything).not.toContain(strongbox.names.identifier);
    expect(everything).not.toContain(strongbox.names.contentHash);
    expect(everything).not.toContain(otherTokens[0]?.category);
    // Every address it was told appears in a transaction of its own. The answers to a positions request name a
    // script by the template's name and its values, not by its address: the application is told no address at all.
    const mine = new Set<string>();
    for (const id of [transactionId, second.transactionId]) {
      const raw = (await device.chain.getTransaction(id)) as string;
      for (const match of raw.matchAll(/aa20[0-9a-f]{64}87/g)) mine.add(match[0]);
    }
    const told = [...everything.matchAll(/aa20[0-9a-f]{64}87/g)].map((match) => match[0]);
    for (const address of told) expect(mine.has(address)).toBe(true);
    expect(told).toEqual([]);
  });

  it('a positions request is answered from the records for a template trusted in a session with this application, and refused otherwise', async () => {
    const { device, connect, proposals } = await session();
    const first = connect('first application');
    const opened = first.dapp.request(open(keyedBox), keyedBox.texts);
    await settle();
    await proposals()[0]?.approve();
    const { tokens } = (await opened) as { tokens: { category: string }[] };

    // Trusted in a session with this application: answered, from the record and the chain.
    const answer = await first.dapp.recordedPositions(keyedBox.names.identifier);
    expect(answer).toMatchObject({ trusted: true, positions: [{ category: tokens[0]?.category, status: 'open', satoshis: '1000', lockingScript: 'boxLockingScript', variables: { boxKey: tokens[0]?.category } }] });
    // Someone pays into the box behind the wallet's back; the position is still open, its record unchanged.
    const position = (await device.applications.recordedPositions())[0];
    device.chain.fund(hexToBin(position?.lockingBytecode ?? ''), 4_000n);
    expect((await device.applications.recordedPositions())[0]).toMatchObject({ status: 'open', satoshis: 34_000n });

    // Trusted with another application: refused, and nothing is said about what the wallet holds.
    const second = connect('another application');
    expect(await second.dapp.recordedPositions(keyedBox.names.identifier)).toEqual({ trusted: false, positions: [] });
    // Not trusted at all: refused in the same way.
    expect(await first.dapp.recordedPositions(strongbox.names.identifier)).toEqual({ trusted: false, positions: [] });
    expect(await second.dapp.recordedPositions(strongbox.names.identifier)).toEqual({ trusted: false, positions: [] });
    expect(proposals()).toEqual([]);
  });

  it('a template trusted without this application is answered for only once the user allows it', async () => {
    const device = await deviceWith([100_000n, 60_000n]);
    const asked: [string, string][] = [];
    let proposals: Proposal[] = [];
    const connector = applicationConnector(device.applications, { onProposals: (open) => (proposals = open), onPositionsAsked: (template, application) => void asked.push([template, application]) });
    const connect = (pairing: string) => {
      const wires = link();
      connector.attach(pairing, wires.wallet);
      const dapp = new DappRequests();
      dapp.attach(wires.dappEnd);
      return dapp;
    };
    // A token made in a session with one application; then the template is known to the device without the other.
    const first = connect('first application');
    const opened = first.request(open(keyedBox), keyedBox.texts);
    await settle();
    await proposals[0]?.approve();
    const { tokens } = (await opened) as { tokens: { category: string }[] };
    const later = connect('a later session');

    // Not trusted at all: refused, and the user is not asked, so that nothing hints at it.
    expect(await later.recordedPositions(strongbox.names.identifier)).toEqual({ trusted: false, positions: [] });
    expect(asked).toEqual([]);
    // Trusted, but not with this application: refused, and the user is asked.
    expect(await later.recordedPositions(keyedBox.names.identifier)).toEqual({ trusted: false, positions: [] });
    expect(asked).toEqual([[keyedBox.names.identifier, 'a later session']]);
    // Only the user's word lets it see the tokens.
    expect(() => device.applications.allow(strongbox.names.identifier, 'a later session')).toThrow(/does not trust/);
    device.applications.allow(keyedBox.names.identifier, 'a later session');
    expect(await later.recordedPositions(keyedBox.names.identifier)).toMatchObject({ trusted: true, positions: [{ category: tokens[0]?.category, status: 'open', satoshis: '1000' }] });
    expect(device.applications.mayAllow(keyedBox.names.identifier, 'a later session')).toBe(false);
    expect(asked).toHaveLength(1);
  });

  it('a template kept with a recovery declaration by the second design: the declaration is not read, and a request without one finds the template', async () => {
    const { device, connect, proposals } = await session();
    // The device kept the template with a declaration beside it, as the second design did.
    device.wallet.parts.store({
      templates: [{ identifier: keyedBox.names.identifier, contentHash: keyedBox.names.contentHash, text: keyedBox.texts.template, name: 'Keyed strongbox', trustedAt: 1, applications: ['first application'], stored: true, declaration: { contentHash: 'dd'.repeat(32), text: '{"profile":"recoverable-app-v1"}' } } as never],
      notes: [],
    });
    expect(device.applications.has(keyedBox.names)).toBe(true);
    const { dapp, sentToWallet } = connect('first application');
    const result = dapp.request(open(keyedBox), keyedBox.texts);
    await settle();
    await proposals()[0]?.approve();
    await result;
    // The request was taken at once, without the page sending the template again.
    const requests = sentToWallet.filter((message) => message.action === 'xo_action_request');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.definition).toBeUndefined();
    expect(device.applications.templates).toHaveLength(1);
  });

  it('a page that still sends a declaration beside its template: only the template is taken', async () => {
    const { device, connect, proposals } = await session();
    const { dapp } = connect('first application');
    const result = dapp.request({ ...open(strongbox), template: { ...strongbox.names, declaration: 'ee'.repeat(32) } as never }, { ...strongbox.texts, declaration: '{"profile":"recoverable-app-v1"}' } as never);
    await settle();
    expect(proposals()[0]?.entry.template).toEqual(strongbox.names);
    expect(proposals()[0]?.entry.definition).toEqual(strongbox.texts);
    await proposals()[0]?.approve();
    await result;
    expect(device.applications.templates).toMatchObject([{ identifier: strongbox.names.identifier, contentHash: strongbox.names.contentHash }]);
    expect(device.applications.templates[0]).not.toHaveProperty('declaration');
  });
});
