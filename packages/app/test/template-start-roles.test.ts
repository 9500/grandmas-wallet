import { type ApplicationsState, ActionRefusedError, Applications, applicationArchive } from '@grandmas-wallet/app';
import { guestBookTemplate } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { type Device, bond, deviceWith, presentation, seedOf, strongbox } from '../../../test/support/applications.js';

/**
 * The starting actions a template the user trusts offers from the wallet itself, where they are under more than one
 * role: with nothing that settles the wallet's role, every starting action is offered under the role its entry names,
 * and the user picks the action and the role with it. Where one role is settled, by the template's starting actions or
 * by what the wallet told the template's service, only that role's are offered, as before.
 */

const book = presentation(guestBookTemplate);
const URL_ = 'https://service.example/xo';
const bookWithService = presentation({ ...guestBookTemplate, resources: [{ name: 'xo_service_v1', description: 'The test service', url: URL_ }] });
const asksAmount = { asks: [{ variable: 'amount', name: 'Amount', description: 'Satoshis on the book.', type: 'satoshis' }] };

const trusted = async (device: Device, presented: typeof book, applications: Applications = device.applications) => {
  await applications.trust(presented.names, presented.texts, 'the page');
  return presented.names.identifier;
};

describe('starting actions under more than one role', () => {
  it('lists every starting action under the role its entry names, with the template\'s names for the roles', async () => {
    const device = await deviceWith([100_000n]);
    const identifier = await trusted(device, book);
    const offered = await device.applications.templateActions(identifier);
    expect(offered?.starting).toEqual([
      { action: 'openBook', role: 'host', name: 'Open a book', description: 'Make a book token with coins on it.', ...asksAmount },
      { action: 'sign', role: 'guest', name: 'Sign', description: 'Make a page token of your own.' },
      { action: 'openBook', role: 'guest', name: 'Open a book', description: 'Make a book token with coins on it.', ...asksAmount },
    ]);
    expect(offered?.roleNames).toEqual({ host: 'Host', guest: 'Guest' });
    expect(offered).not.toHaveProperty('role');
  });

  it('carries out a starting action of each role under the role the user picked it in', async () => {
    const device = await deviceWith([100_000n, 100_000n, 100_000n]);
    const identifier = await trusted(device, book);

    const asHost = device.applications.startAction(identifier, 'openBook', { amount: 20_000 }, 'host');
    expect(asHost).toMatchObject({ action: 'openBook', role: 'host', fromWallet: { typed: { amount: 20_000 } } });
    const hosted = await device.applications.carryOut(asHost);
    expect(hosted.tokens).toEqual([expect.objectContaining({ satoshis: '20000', capability: 'none' })]);

    const asGuest = device.applications.startAction(identifier, 'openBook', { amount: 15_000 }, 'guest');
    expect(asGuest).toMatchObject({ action: 'openBook', role: 'guest' });
    const guested = await device.applications.carryOut(asGuest);
    expect(guested.tokens).toEqual([expect.objectContaining({ satoshis: '15000' })]);

    // An action under one role only needs no role named; named under another, it is refused.
    const signing = device.applications.startAction(identifier, 'sign');
    expect(signing).toMatchObject({ action: 'sign', role: 'guest' });
    const signed = await device.applications.carryOut(signing);
    expect(signed.tokens).toEqual([expect.objectContaining({ satoshis: '1000' })]);
    expect(new Set([hosted, guested, signed].map((outcome) => outcome.tokens[0]?.category)).size).toBe(3);
    expect(() => device.applications.startAction(identifier, 'sign', {}, 'host')).toThrow(new ActionRefusedError('The template "Guest book" offers no starting action "sign" to the wallet as "Host".'));
    // An action under two roles is not guessed.
    expect(() => device.applications.startAction(identifier, 'openBook', { amount: 15_000 })).toThrow(new ActionRefusedError('The template "Guest book" offers "Open a book" as "Host" and "Guest": the request has to say which.'));
  }, 60_000);

  it('leaves a template whose starting actions are under one role as it was', async () => {
    const device = await deviceWith([100_000n]);
    for (const presented of [strongbox, bond]) {
      const identifier = await trusted(device, presented);
      const offered = await device.applications.templateActions(identifier);
      const role = presented === strongbox ? 'holder' : 'poster';
      expect(offered?.role).toBe(role);
      expect(offered).not.toHaveProperty('roleNames');
      expect(offered?.starting.length).toBeGreaterThan(0);
      expect(offered?.starting.every((action) => action.role === role)).toBe(true);
      const [first] = offered?.starting ?? [];
      expect(device.applications.startAction(identifier, first?.action ?? '')).toMatchObject({ role });
      expect(device.applications.startAction(identifier, first?.action ?? '', {}, role)).toMatchObject({ role });
    }
  });

  it('offers only the role the wallet told the template\'s service, where it keeps one', async () => {
    const device = await deviceWith([100_000n]);
    const fetch = async (): Promise<Response> => {
      throw new TypeError('fetch failed');
    };
    const applications = new Applications(device.wallet.parts, {
      archive: applicationArchive({ arrangement: () => device.arrangement, storeAt: (address) => device.stores.get(address) as never, seed: seedOf(0), identity: device.identity, chain: device.chain }),
      now: () => 1_795_000_000,
      service: { network: 'regtest', kind: 'public', fetch },
    });
    const identifier = await trusted(device, bookWithService, applications);
    // Not settled: every starting action, under the role its entry names.
    expect((await applications.templateActions(identifier))?.starting.map(({ action, role }) => [action, role])).toEqual([
      ['openBook', 'host'],
      ['sign', 'guest'],
      ['openBook', 'guest'],
    ]);

    const state = device.wallet.parts.kept() as ApplicationsState;
    device.wallet.parts.store({ ...state, services: [{ ...bookWithService.names, url: URL_, description: 'The test service', walletRole: 'guest' }] });
    const offered = await applications.templateActions(identifier);
    expect(offered?.role).toBe('guest');
    expect(offered).not.toHaveProperty('roleNames');
    expect(offered?.starting.map(({ action, role }) => [action, role])).toEqual([
      ['sign', 'guest'],
      ['openBook', 'guest'],
    ]);
    expect(applications.startAction(identifier, 'openBook', { amount: 15_000 })).toMatchObject({ role: 'guest' });
    expect(() => applications.startAction(identifier, 'openBook', { amount: 15_000 }, 'host')).toThrow(ActionRefusedError);
  });
});
