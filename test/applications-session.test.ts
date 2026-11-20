import { applicationConnector, walletAnnouncement } from '@grandmas-wallet/app';
import { type ActionDetails, type Channel, type Proposal, type TemplateTexts, type XoMessage, DappRequests, XO_EXTENSION, readAdvertisement } from '@grandmas-wallet/connect';
import { describe, expect, it } from 'vitest';

import { type Device, bond, deviceWith, hex, presentationHash, seedOf, strongbox } from './support/applications.js';

/**
 * Acceptance tests AP01, AP03, AP05 and AP06 of the proposal: a session between an application and the
 * wallet, with the wallet's own handling of templates behind the messages. The connection is a pair of
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
  it('the wallet announces the profiles it reads and the kinds of output it fills, and names no template', () => {
    const announced = walletAnnouncement('chipnet');
    expect(announced).toEqual({ version: 1, network: 'chipnet', profiles: ['recoverable-app-v1'], bindings: ['receive', 'change', 'return', 'lasting'], versions: [1, 2] });
    expect(readAdvertisement({ [XO_EXTENSION]: announced })).toEqual(announced);
  });

  it('AP01: an unknown template is shown as not verified and trusted only on the user\'s word', async () => {
    const { device, connect, proposals } = await session();
    const { dapp } = connect('first application');
    const result = dapp.request(open(strongbox), strongbox.texts);
    await settle();
    const [proposal] = proposals();
    if (proposal === undefined) throw new Error('no proposal');
    // What the user is shown: the template's own words about itself, and what the wallet can say about it.
    expect(proposal.entry.templateKnown).toBe(false);
    const shown = device.applications.describe(proposal.entry.template, proposal.entry.definition);
    expect(shown).toMatchObject({ name: 'Strongbox', trusted: false, verdict: { statement: 'not verified' } });
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

  it('AP01: a template, a declaration or a file referred to that is not the one the request names by hash is refused', async () => {
    const { device, connect, proposals } = await session();
    const { dapp } = connect('first application');
    // Another template under the name of the first.
    await expect(dapp.request(open(strongbox), bond.texts)).rejects.toThrow('not the one the request names');
    // The right template with another declaration than the one named.
    const altered = (strongbox.texts.declaration as string).replace('"take"', '"add"');
    await expect(dapp.request(open(strongbox), { ...strongbox.texts, declaration: altered })).rejects.toThrow('recovery declaration sent with the request is not the one the request names');
    // A declaration that is named correctly and is for another template.
    const borrowed: TemplateTexts = { template: strongbox.texts.template, declaration: bond.texts.declaration as string };
    await expect(dapp.request({ ...open(strongbox), template: { ...strongbox.names, declaration: presentationHash(borrowed.declaration as string) } }, borrowed)).rejects.toThrow('for another template');
    // A file that the declaration does not refer to, and a declaration without a file it refers to.
    await expect(dapp.request(open(strongbox), { ...strongbox.texts, references: ['terms of use'] })).rejects.toThrow('not one the recovery declaration refers to');
    const referring = JSON.stringify({ ...(JSON.parse(strongbox.texts.declaration as string) as object), references: [presentationHash('terms of use')] });
    const withReference = { ...open(strongbox), template: { ...strongbox.names, declaration: presentationHash(referring) } };
    await expect(dapp.request(withReference, { template: strongbox.texts.template, declaration: referring, references: ['other terms'] })).rejects.toThrow('not one the recovery declaration refers to');
    await expect(dapp.request(withReference, { template: strongbox.texts.template, declaration: referring })).rejects.toThrow('refers to was not sent');
    expect(proposals()).toEqual([]);
    expect(device.applications.templates).toEqual([]);
    // With the file it names, the same request is taken on.
    void dapp.request(withReference, { template: strongbox.texts.template, declaration: referring, references: ['terms of use'] });
    await settle();
    expect(proposals()).toHaveLength(1);
  });

  it('AP01: a later text under the same identifier does not replace the template the user trusted without the user\'s word', async () => {
    const { device, connect, proposals } = await session();
    const { dapp } = connect('first application');
    const first = dapp.request(open(strongbox), strongbox.texts);
    await settle();
    await proposals()[0]?.approve();
    await first;
    // The same template comes again with another declaration. It is shown as a template to be trusted again, and
    // does not take the place of the one the user trusted unless the user approves.
    const altered = (strongbox.texts.declaration as string).replace('"actions":["add","take"]', '"actions":["take"]');
    expect(altered).not.toBe(strongbox.texts.declaration);
    const names = { ...strongbox.names, declaration: presentationHash(altered) };
    const texts = { template: strongbox.texts.template, declaration: altered };
    const again = dapp.request({ ...open(strongbox), template: names }, texts);
    await settle();
    expect(proposals()).toHaveLength(1);
    expect(device.applications.describe(names, texts)).toMatchObject({ trusted: false, replacesDeclaration: true });
    await proposals()[0]?.decline();
    await expect(again).rejects.toThrow('declined');
    expect(device.applications.templates).toHaveLength(1);
    expect(device.applications.templates[0]?.declaration?.contentHash).toBe(strongbox.names.declaration);
    // Asked again and approved: the new declaration takes the earlier one's place.
    const approved = dapp.request({ ...open(strongbox), template: names }, texts);
    await settle();
    await proposals()[0]?.approve();
    await approved;
    expect(device.applications.templates).toHaveLength(1);
    expect(device.applications.templates[0]?.declaration?.contentHash).toBe(names.declaration);
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
    const posted = other.dapp.request({ template: bond.names, templateAction: 'post', role: 'poster', variables: { amount: 20_000, serial: '07' } }, bond.texts);
    await settle();
    await proposals()[0]?.approve();
    await posted;

    const { dapp, sentToDapp } = connect('first application');
    const opened = dapp.request(open(strongbox), strongbox.texts);
    await settle();
    await proposals()[0]?.approve();
    const { transactionId, tokens } = (await opened) as { transactionId: string; tokens: { category: string }[] };
    const held = await dapp.positions(strongbox.names.identifier);
    expect(held.positions).toHaveLength(1);
    const taken = dapp.request({ template: strongbox.names, templateAction: 'take', role: 'holder', variables: {}, spends: [tokens[0]?.category ?? ''] }, strongbox.texts);
    await settle();
    await proposals()[0]?.approve();
    const second = (await taken) as { transactionId: string };
    await dapp.positions(bond.names.identifier);
    await dapp.positions(strongbox.names.identifier);

    const everything = JSON.stringify(sentToDapp);
    for (const secret of secretsOf(device)) expect(everything).not.toContain(secret);
    // Nothing about the other application: neither its template nor its tokens.
    expect(everything).not.toContain(bond.names.identifier);
    expect(everything).not.toContain(bond.names.contentHash);
    const bondKey = (await device.applications.tokens()).find((token) => token.template?.name === 'Bond');
    expect(everything).not.toContain(bondKey?.category);
    // Every address it was told appears in a transaction of its own.
    const mine = new Set<string>();
    for (const id of [transactionId, second.transactionId]) {
      const raw = (await device.chain.getTransaction(id)) as string;
      for (const match of raw.matchAll(/aa20[0-9a-f]{64}87/g)) mine.add(match[0]);
    }
    const told = [...everything.matchAll(/aa20[0-9a-f]{64}87/g)].map((match) => match[0]);
    expect(told.length).toBeGreaterThan(0);
    for (const address of told) expect(mine.has(address)).toBe(true);
  });

  it('AP06: a positions request is answered from the chain for a template trusted in a session with this application, and refused otherwise', async () => {
    const { device, connect, proposals } = await session();
    const first = connect('first application');
    const opened = first.dapp.request(open(strongbox), strongbox.texts);
    await settle();
    await proposals()[0]?.approve();
    const { tokens } = (await opened) as { tokens: { category: string }[] };

    // Trusted in a session with this application: answered, from the chain.
    const answer = await first.dapp.positions(strongbox.names.identifier);
    expect(answer).toMatchObject({ trusted: true, positions: [{ category: tokens[0]?.category, authority: 'boxKey', status: 'open', satoshis: '30000', actions: ['add', 'take'] }] });
    // Someone pays into the box behind the wallet's back; the next answer shows it.
    device.chain.fund(Uint8Array.from(Buffer.from(answer.positions[0]?.lockingBytecode ?? '', 'hex')), 4_000n);
    expect((await first.dapp.positions(strongbox.names.identifier)).positions[0]?.satoshis).toBe('34000');

    // Trusted with another application: refused, and nothing is said about what the wallet holds.
    const second = connect('another application');
    expect(await second.dapp.positions(strongbox.names.identifier)).toEqual({ trusted: false, positions: [] });
    // Not trusted at all: refused in the same way.
    expect(await first.dapp.positions(bond.names.identifier)).toEqual({ trusted: false, positions: [] });
    expect(await second.dapp.positions(bond.names.identifier)).toEqual({ trusted: false, positions: [] });
    expect(proposals()).toEqual([]);
  });

  it('AP06: a template trusted without this application is answered for only once the user allows it', async () => {
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
    const opened = first.request(open(strongbox), strongbox.texts);
    await settle();
    await proposals[0]?.approve();
    const { tokens } = (await opened) as { tokens: { category: string }[] };
    const later = connect('a later session');

    // Not trusted at all: refused, and the user is not asked, so that nothing hints at it.
    expect(await later.positions(bond.names.identifier)).toEqual({ trusted: false, positions: [] });
    expect(asked).toEqual([]);
    // Trusted, but not with this application: refused, and the user is asked.
    expect(await later.positions(strongbox.names.identifier)).toEqual({ trusted: false, positions: [] });
    expect(asked).toEqual([[strongbox.names.identifier, 'a later session']]);
    // Only the user's word lets it see the tokens.
    expect(() => device.applications.allow(bond.names.identifier, 'a later session')).toThrow(/does not trust/);
    device.applications.allow(strongbox.names.identifier, 'a later session');
    expect(await later.positions(strongbox.names.identifier)).toMatchObject({ trusted: true, positions: [{ category: tokens[0]?.category, status: 'open', satoshis: '30000' }] });
    expect(device.applications.mayAllow(strongbox.names.identifier, 'a later session')).toBe(false);
    expect(asked).toHaveLength(1);
  });
});
