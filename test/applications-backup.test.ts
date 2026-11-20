import { type MemoryStore } from '@grandmas-wallet/archive';
import { Applications, NotStoredError, applicationArchive } from '@grandmas-wallet/app';
import { describe, expect, it, vi } from 'vitest';

import { type Device, deviceWith, finishCopying, keyedBox, request, seedOf } from './support/applications.js';

/**
 * Acceptance tests BK04, BK06 and BK10 of the proposal: the records that applications bring to the backup. A
 * template is stored before its first action; and a token is never left out, whatever is missing.
 */

const open = request(keyedBox, 'open', 'holder', { amount: 30_000, label: '01' });
/** The one position the wallet lists from its records. */
const positionOf = async (device: Device) => {
  const [position, ...others] = await device.applications.recordedPositions();
  if (position === undefined || others.length > 0) throw new Error('not one position');
  return position;
};
const unreachable = (device: Device, value: boolean): void => {
  for (const store of device.stores.values()) (store as MemoryStore).unreachable = value;
};
/** The device's archive for applications, as the device itself uses it. */
const archiveOf = (device: Device) =>
  applicationArchive({ arrangement: () => device.arrangement, storeAt: (address) => device.stores.get(address) as MemoryStore, seed: seedOf(0), identity: device.identity, chain: device.chain });

describe('the backup records that applications bring', () => {
  it('BK06: when no store confirms before the first action of a new template, the action is refused', async () => {
    const device = await deviceWith([100_000n]);
    unreachable(device, true);
    const broadcasts = device.chain.broadcasts;
    await expect(device.applications.carryOut(open)).rejects.toBeInstanceOf(NotStoredError);
    await expect(device.applications.carryOut(open)).rejects.toThrow('No backup store confirmed the template');
    expect(device.chain.broadcasts).toBe(broadcasts);
    expect(await device.applications.tokens()).toEqual([]);
    // One store that answers is enough; the other can be filled later from the device's copy.
    (device.stores.get('https://store2.example') as MemoryStore).unreachable = false;
    const outcome = await device.applications.carryOut(open);
    expect(outcome.tokens).toHaveLength(1);
    expect(device.applications.templates).toMatchObject([{ name: 'Keyed strongbox', stored: true }]);
    // A store that cannot be reached does not stop the actions of a template that is already stored.
    unreachable(device, true);
    expect((await device.applications.carryOut(device.applications.actionOn(await positionOf(device), 'take'))).tokens).toHaveLength(1);
  });

  it('BK10: no signature for the first action of a new template is made before a store has confirmed the template; a note of the action on the device does not count', async () => {
    const device = await deviceWith([100_000n]);
    const prepare = vi.spyOn(device.backend, 'prepare');
    unreachable(device, true);
    await expect(device.applications.carryOut(open)).rejects.toBeInstanceOf(NotStoredError);
    // The device has taken note of the template: the user trusted it. That is not a stored template.
    expect(device.applications.templates).toMatchObject([{ name: 'Keyed strongbox', stored: false }]);
    await expect(device.applications.carryOut(open)).rejects.toBeInstanceOf(NotStoredError);
    // Nothing was built or signed, and no address was taken for it.
    expect(prepare).not.toHaveBeenCalled();
    expect(device.state().allocation[1].held).toEqual([]);

    // A wallet that has no backup store at all refuses in the same way.
    const bare = await deviceWith([100_000n], { withoutArchive: true });
    const signing = vi.spyOn(bare.backend, 'prepare');
    await expect(bare.applications.carryOut(open)).rejects.toThrow('has no backup store');
    expect(signing).not.toHaveBeenCalled();
    // What the wallet would do can still be shown.
    expect((await bare.applications.preview(open)).firstUse).toBe(true);
  });

  it('BK04: a token whose template is missing is still swept and is reported as incomplete, never left out', async () => {
    const device = await deviceWith([100_000n]);
    // The backup takes the record of the position and loses the template.
    const real = archiveOf(device);
    const lossy = new Applications(device.wallet.parts, {
      archive: { read: real.read, write: async (entry) => (entry.kind === 'template' ? { blobId: '00', confirmedBy: ['a store that later lost it'], failed: [] } : real.write(entry)) },
    });
    const opened = await lossy.carryOut(open);
    const category = opened.tokens[0]?.category as string;

    await device.recover();
    const taken = await device.takeOver();
    await taken.wallet.search();
    const swept = await taken.wallet.sweepEarlier();
    expect(swept.tokens).toEqual([{ category, meaning: 'unknown' }]);
    await finishCopying(taken);
    expect(await taken.applications.readBackup()).toEqual({ suggested: 0, notes: 0 });
    expect(taken.applications.suggestedRecords).toHaveLength(1);
    const [token] = await taken.applications.tokens();
    expect(token).toMatchObject({ category, place: 'address', meaning: 'incomplete' });
    expect(token?.reason).toContain('that template is not on this device');
    expect(token?.reason).toContain('The token is safe');
    // With the template had again, from any copy, the record leads to the position, which the chain confirms.
    await taken.applications.trust(keyedBox.names, keyedBox.texts);
    await taken.applications.confirmRecords();
    expect((await taken.applications.tokens())[0]).toMatchObject({ category, meaning: 'position', tokenName: 'Strongbox key' });
    expect(await positionOf(taken)).toMatchObject({ token: { category }, status: 'open', satoshis: 30_000n, standing: 'own' });
  }, 60_000);

  it('a template that an earlier owner stored is a suggestion on the new device, and its tokens are listed all the same', async () => {
    const device = await deviceWith([100_000n]);
    const opened = await device.applications.carryOut(open);
    await device.recover();
    const taken = await device.takeOver();
    await taken.wallet.search();
    await taken.wallet.sweepEarlier();
    await finishCopying(taken);
    expect(await taken.applications.readBackup()).toEqual({ suggested: 1, notes: 0 });
    // The earlier owner's record does not make the template trusted here (section 10.3).
    expect(taken.applications.templates).toEqual([]);
    expect(taken.applications.suggestions).toMatchObject([{ name: 'Keyed strongbox', identifier: keyedBox.names.identifier }]);
    const [token] = await taken.applications.tokens();
    expect(token).toMatchObject({ category: opened.tokens[0]?.category, meaning: 'incomplete', template: { name: 'Keyed strongbox' } });
    expect(token?.reason).toContain('not trusted on this device yet');
    // The user trusts it again, from the copy in the backup, with no application at hand.
    await taken.applications.trust(keyedBox.names, undefined);
    await taken.applications.confirmRecords();
    expect(taken.applications.suggestions).toEqual([]);
    const found = await positionOf(taken);
    expect(found).toMatchObject({ status: 'open', satoshis: 30_000n });
    // Its first action on this device stores it in the new archive, signed by the new owner.
    const outcome = await taken.applications.carryOut(taken.applications.actionOn(found, 'take'));
    expect(outcome.tokens[0]?.category).toBe(opened.tokens[0]?.category);
    expect(taken.applications.templates).toMatchObject([{ name: 'Keyed strongbox', stored: true }]);
    expect((await taken.wallet.balance()).recoverable).toBeGreaterThan(90_000n);
  }, 60_000);
});
