import { type MemoryStore } from '@grandmas-wallet/archive';
import { Applications, type ApplicationsState, applicationArchive, applicationConnector } from '@grandmas-wallet/app';
import { type Channel, type Offer, type XoMessage, DappRequests, RequestRefusedError } from '@grandmas-wallet/connect';
import { describe, expect, it } from 'vitest';

import { type Device, bond, deviceWith, keyedBox, request, seedOf, strongbox } from './support/applications.js';

/**
 * The templates a wallet keeps: an application offers its template without an action, for a wallet that holds
 * a token of it and has never used the application; and the user stops trusting a template, which the backup
 * remembers (proposal sections 10.2 and 14.2).
 */

const open = request(strongbox, 'open', 'holder', { amount: 30_000, label: '01' });
const link = () => {
  const toWallet: ((message: unknown) => void)[] = [];
  const toDapp: ((message: unknown) => void)[] = [];
  const sentToDapp: XoMessage[] = [];
  const end = (out: ((message: unknown) => void)[], log: XoMessage[], incoming: ((message: unknown) => void)[]): Channel => ({
    send: async (message) => {
      log.push(message);
      for (const handler of [...out]) handler(JSON.parse(JSON.stringify(message)));
    },
    onMessage: (handler) => {
      incoming.push(handler);
      return () => void incoming.splice(incoming.indexOf(handler), 1);
    },
    nextSequence: () => 0,
  });
  return { dappEnd: end(toWallet, [], toDapp), wallet: end(toDapp, sentToDapp, toWallet), sentToDapp };
};
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn++) await new Promise((done) => setTimeout(done, 0));
};
const session = (device: Device) => {
  let offers: Offer[] = [];
  const connector = applicationConnector(device.applications, { onProposals: () => undefined, onOffers: (open) => (offers = open) });
  const connect = (pairing: string) => {
    const wires = link();
    connector.attach(pairing, wires.wallet);
    const dapp = new DappRequests();
    dapp.attach(wires.dappEnd);
    return { dapp, ...wires };
  };
  return { connector, connect, offers: () => offers };
};
const archiveOf = (device: Device) =>
  applicationArchive({ arrangement: () => device.arrangement, storeAt: (address) => device.stores.get(address) as MemoryStore, seed: seedOf(0), identity: device.identity, chain: device.chain });
/** The same wallet on a device that keeps nothing about applications yet: what reading the backup gives it. */
const afresh = (device: Device): Applications => {
  let state: ApplicationsState | undefined;
  return new Applications({ ...device.wallet.parts, kept: () => state, store: (next) => void (state = next) }, { archive: archiveOf(device) });
};
const unreachable = (device: Device, value: boolean): void => {
  for (const store of device.stores.values()) (store as MemoryStore).unreachable = value;
};

describe('a template offered without an action', () => {
  it('AP16: is shown to the user, and trusted with that application only on their word; the token the wallet holds then leads to its position through its record', async () => {
    const device = await deviceWith([100_000n, 60_000n]);
    const { tokens } = await device.applications.carryOut(open);
    // The wallet holds the token and its record, and no longer has the template.
    device.wallet.parts.store({ ...(device.wallet.parts.kept() as ApplicationsState), templates: [] });
    expect((await device.applications.tokens())[0]).toMatchObject({ meaning: 'incomplete' });

    const { connect, offers } = session(device);
    const page = connect('page');
    expect(await page.dapp.recordedPositions(strongbox.names.identifier)).toEqual({ trusted: false, positions: [] });
    const answer = page.dapp.offerTemplate(strongbox.names, strongbox.texts);
    await settle();
    // Nothing is answered, and nothing trusted, until the user decides.
    expect(page.sentToDapp.filter((message) => message.action === 'xo_template_answer')).toEqual([]);
    expect(device.applications.templates).toEqual([]);
    expect(offers()).toMatchObject([{ application: 'page', template: strongbox.names }]);
    expect(device.applications.describe(strongbox.names, offers()[0]?.definition)).toMatchObject({ name: 'Strongbox', trusted: false });
    await offers()[0]?.accept();
    expect(await answer).toBe(true);
    expect(offers()).toEqual([]);
    // Trusted, with this application, and in the backup at once: a token already depends on it.
    expect(device.applications.templates).toMatchObject([{ name: 'Strongbox', applications: ['page'], stored: true }]);
    expect(await page.dapp.recordedPositions(strongbox.names.identifier)).toMatchObject({ trusted: true, positions: [{ category: tokens[0]?.category, status: 'open', satoshis: '1000', variables: { boxKey: tokens[0]?.category } }] });
    expect((await device.applications.recordedPositions())[0]).toMatchObject({ status: 'open', satoshis: 30_000n });
    // Offered again, it is answered at once; another application is told nothing by that.
    expect(await page.dapp.offerTemplate(strongbox.names, strongbox.texts)).toBe(true);
    expect(await connect('other').dapp.recordedPositions(strongbox.names.identifier)).toEqual({ trusted: false, positions: [] });
  }, 60_000);

  it('AP16: is not trusted when the user declines, and is refused when the text is not the one named', async () => {
    const device = await deviceWith([100_000n]);
    const { connect, offers } = session(device);
    const page = connect('page');
    const answer = page.dapp.offerTemplate(strongbox.names, strongbox.texts);
    await settle();
    await offers()[0]?.decline();
    expect(await answer).toBe(false);
    expect(device.applications.templates).toEqual([]);
    await expect(page.dapp.offerTemplate(strongbox.names, keyedBox.texts)).rejects.toBeInstanceOf(RequestRefusedError);
    expect(offers()).toEqual([]);
  });

  it('a template trusted without this application is allowed for it by accepting its offer', async () => {
    const device = await deviceWith([100_000n]);
    await device.applications.trust(strongbox.names, strongbox.texts);
    const { connect, offers } = session(device);
    const page = connect('page');
    const answer = page.dapp.offerTemplate(strongbox.names, strongbox.texts);
    await settle();
    expect(offers()).toHaveLength(1);
    await offers()[0]?.accept();
    expect(await answer).toBe(true);
    expect(device.applications.templates).toMatchObject([{ applications: ['page'] }]);
  });
});

describe('a template the user stops trusting', () => {
  it('BK11: leaves its tokens in the wallet, is no longer answered for, and is not trusted again by reading the backup; trusted again, it is', async () => {
    const device = await deviceWith([100_000n, 60_000n]);
    const { tokens } = await device.applications.carryOut({ ...open, application: 'page' });
    expect(await device.applications.positionsFromRecords(strongbox.names.identifier, 'page')).toHaveLength(1);

    expect(await device.applications.forget(strongbox.names.identifier)).toEqual({ name: 'Strongbox', backupTold: true });
    expect(device.applications.templates).toEqual([]);
    expect(device.applications.suggestions).toMatchObject([{ name: 'Strongbox', withdrawn: { renewal: 0, stored: true } }]);
    const [token] = await device.applications.tokens();
    expect(token).toMatchObject({ category: tokens[0]?.category, meaning: 'incomplete' });
    expect(token?.reason).toContain('You stopped trusting that template');
    expect(await device.applications.positionsFromRecords(strongbox.names.identifier, 'page')).toBeUndefined();
    expect(device.applications.has(strongbox.names)).toBe(false);

    // Reading the backup, here or on a device that starts from it, does not bring the trust back.
    await device.applications.readBackup();
    expect(device.applications.templates).toEqual([]);
    const restored = afresh(device);
    await restored.readBackup();
    expect(restored.templates).toEqual([]);
    expect(restored.suggestions).toMatchObject([{ name: 'Strongbox', withdrawn: { renewal: 0, stored: true } }]);

    // Trusted again from the backup's copy: stored again, under a number the withdrawal does not reach.
    await restored.trust(strongbox.names, undefined);
    expect(restored.templates).toMatchObject([{ name: 'Strongbox', stored: false, renewal: 1 }]);
    expect(await restored.storeNow(strongbox.names.identifier)).toBe(true);
    expect((await restored.tokens())[0]).toMatchObject({ meaning: 'position', tokenName: 'Strongbox key' });
    expect((await restored.recordedPositions())[0]).toMatchObject({ status: 'open', standing: 'own' });
    const later = afresh(device);
    await later.readBackup();
    expect(later.templates).toMatchObject([{ name: 'Strongbox', stored: true, renewal: 1 }]);
    expect(later.suggestions).toEqual([]);
    // And stopped again: the second withdrawal reaches the second record.
    await later.forget(strongbox.names.identifier);
    const last = afresh(device);
    await last.readBackup();
    expect(last.templates).toEqual([]);
    expect(last.suggestions).toMatchObject([{ withdrawn: { renewal: 1 } }]);
  }, 60_000);

  it('is told to the backup later when no store can be reached now', async () => {
    const device = await deviceWith([100_000n]);
    await device.applications.carryOut(open);
    unreachable(device, true);
    expect(await device.applications.forget(strongbox.names.identifier)).toEqual({ name: 'Strongbox', backupTold: false });
    expect(device.applications.templates).toEqual([]);
    unreachable(device, false);
    // The backup still has only the template: the device remembers the withdrawal, and writes it now.
    await device.applications.readBackup();
    expect(device.applications.templates).toEqual([]);
    expect(device.applications.suggestions).toMatchObject([{ withdrawn: { renewal: 0, stored: true } }]);
    const restored = afresh(device);
    await restored.readBackup();
    expect(restored.templates).toEqual([]);
  }, 60_000);

  it('a template the backup never held is simply dropped', async () => {
    const device = await deviceWith([100_000n]);
    await device.applications.trust(bond.names, bond.texts);
    expect(await device.applications.forget(bond.names.identifier)).toEqual({ name: 'Bond', backupTold: true });
    expect(device.applications.templates).toEqual([]);
    expect(device.applications.suggestions).toEqual([]);
    await expect(device.applications.forget(bond.names.identifier)).rejects.toThrow('does not trust that template');
  });
});
