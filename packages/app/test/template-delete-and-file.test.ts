import { type MemoryStore } from '@grandmas-wallet/archive';
import { type ApplicationsState, Applications, DeletionNotConfirmedError, LARGEST_TEMPLATE_FILE, TemplateFileError, WALLET_TEMPLATES, applicationArchive, templateIdentifier } from '@grandmas-wallet/app';
import { describe, expect, it } from 'vitest';

import { type Device, bond, deviceWith, request, seedOf, strongbox } from '../../../test/support/applications.js';

/**
 * Deleting a template from the wallet, and adding one from a file the user chose (proposal sections 10.2 and 14.3): what
 * goes from the device, what the backup is told, what stays (the tokens and the records of their positions), and that
 * adding the same template again, from a file, restores what the wallet can do with a token it holds.
 */

const open = request(strongbox, 'open', 'holder', { amount: 30_000, label: '01' }, { application: 'page' });

const archiveOf = (device: Device) =>
  applicationArchive({ arrangement: () => device.arrangement, storeAt: (address) => device.stores.get(address) as MemoryStore, seed: seedOf(0), identity: device.identity, chain: device.chain });
/** The same wallet on a device that keeps nothing about applications yet: what reading the backup gives it. */
const afresh = (device: Device): { applications: Applications; state: () => ApplicationsState | undefined } => {
  let state: ApplicationsState | undefined;
  return { applications: new Applications({ ...device.wallet.parts, kept: () => state, store: (next) => void (state = next) }, { archive: archiveOf(device) }), state: () => state };
};
const kept = (device: Device): ApplicationsState => device.wallet.parts.kept() as ApplicationsState;
const unreachable = (device: Device, value: boolean): void => {
  for (const store of device.stores.values()) (store as MemoryStore).unreachable = value;
};

describe('deleting a template', () => {
  it('asks for confirmation while a token of it is held; confirmed, it removes what the device kept, the backup marks it, and the token and its record stay', async () => {
    const device = await deviceWith([100_000n, 60_000n]);
    const { tokens } = await device.applications.carryOut(open);
    const { identifier } = strongbox.names;

    const [before] = await device.applications.recordedPositions();
    const offered = device.applications.offeredActions(before as NonNullable<typeof before>).map((action) => action.action);
    expect(offered.length).toBeGreaterThan(0);
    const holds = await device.applications.deletionHolds(identifier);
    expect(holds.tokens).toMatchObject([{ category: tokens[0]?.category, meaning: 'position' }]);
    expect(holds.open).toMatchObject([{ status: 'open' }]);
    // Without the user's second step nothing is deleted.
    await expect(device.applications.deleteTemplate(identifier)).rejects.toBeInstanceOf(DeletionNotConfirmedError);
    expect(device.applications.templates).toHaveLength(1);

    expect(await device.applications.deleteTemplate(identifier, { confirmed: true })).toEqual({ name: 'Strongbox', backupTold: true });
    expect(device.applications.templates).toEqual([]);
    expect(device.applications.suggestions).toEqual([]);
    expect(device.applications.has(strongbox.names)).toBe(false);
    // What the device kept of it is gone, its text first; only its names and the mark's number stay.
    const state = kept(device);
    expect(JSON.stringify(state)).not.toContain(strongbox.texts.template);
    expect(state.deleted).toEqual([{ ...strongbox.names, renewal: 0, stored: true }]);
    expect(state.services ?? []).toEqual([]);
    expect(state.made ?? []).toEqual([]);
    // The token stays, as one the wallet does not understand, and the record of its position stays.
    const [token] = await device.applications.tokens();
    expect(token).toMatchObject({ category: tokens[0]?.category, meaning: 'incomplete' });
    expect(token?.template).toBeUndefined();
    expect(token?.reason).toContain('that template is not on this device');
    expect(device.applications.positionRecords).toHaveLength(1);
    expect(await device.applications.positionsFromRecords(identifier, 'page')).toBeUndefined();

    // Reading the backup offers it again neither here nor on a device that starts from it.
    await device.applications.readBackup();
    expect(device.applications.templates).toEqual([]);
    expect(device.applications.suggestions).toEqual([]);
    const second = afresh(device);
    await second.applications.readBackup();
    expect(second.applications.templates).toEqual([]);
    expect(second.applications.suggestions).toEqual([]);
    expect(second.state()?.deleted).toEqual([{ ...strongbox.names, renewal: 0, stored: true }]);
    expect(second.applications.positionRecords).toHaveLength(1);
    expect((await second.applications.tokens())[0]).toMatchObject({ meaning: 'incomplete' });

    // Added again from a file, on the second device: trusted from the file, stored under a number the mark does not
    // reach, and the token held leads to its position with the actions the wallet offers for it.
    const file = second.applications.readTemplateFile(strongbox.texts.template);
    expect(file).toMatchObject({ kind: 'new', names: strongbox.names, summary: { name: 'Strongbox', trusted: false } });
    if (file.kind === 'trusted') throw new Error('not new');
    expect(await second.applications.trustFile(file)).toMatchObject({ name: 'Strongbox', from: 'file', stored: true, renewal: 1, applications: [] });
    expect(second.state()?.deleted).toEqual([]);
    expect((await second.applications.tokens())[0]).toMatchObject({ meaning: 'position', tokenName: 'Strongbox key' });
    const [position] = await second.applications.recordedPositions();
    expect(position).toMatchObject({ status: 'open' });
    expect(second.applications.offeredActions(position as NonNullable<typeof position>).map((action) => action.action)).toEqual(offered);
    // And a third device trusts it, from the record written again.
    const third = afresh(device);
    await third.applications.readBackup();
    expect(third.applications.templates).toMatchObject([{ name: 'Strongbox', renewal: 1, stored: true }]);
    expect(third.applications.suggestions).toEqual([]);
  }, 60_000);

  it('needs no confirmation when nothing of it is held, and a template the backup never held leaves no mark', async () => {
    const device = await deviceWith([100_000n]);
    await device.applications.trust(strongbox.names, strongbox.texts);
    expect(await device.applications.storeNow(strongbox.names.identifier)).toBe(true);
    expect(await device.applications.deletionHolds(strongbox.names.identifier)).toEqual({ tokens: [], open: [], waiting: [] });
    expect(await device.applications.deleteTemplate(strongbox.names.identifier)).toEqual({ name: 'Strongbox', backupTold: true });
    expect(kept(device).deleted).toEqual([{ ...strongbox.names, renewal: 0, stored: true }]);
    const second = afresh(device);
    await second.applications.readBackup();
    expect(second.applications.templates).toEqual([]);
    expect(second.applications.suggestions).toEqual([]);

    await device.applications.trust(bond.names, bond.texts);
    expect(await device.applications.deleteTemplate(bond.names.identifier)).toEqual({ name: 'Bond', backupTold: true });
    expect(kept(device).deleted).toEqual([{ ...strongbox.names, renewal: 0, stored: true }]);
    await expect(device.applications.deleteTemplate(bond.names.identifier)).rejects.toThrow('no such template');
  });

  it('clears a template the user stopped trusting from the suggestions, with confirmation while its token is held', async () => {
    const device = await deviceWith([100_000n, 60_000n]);
    await device.applications.carryOut(open);
    await device.applications.forget(strongbox.names.identifier);
    expect(device.applications.suggestions).toMatchObject([{ withdrawn: { renewal: 0, stored: true } }]);
    // The token of a template not trusted is still found, through its text, as one the deletion would leave.
    const holds = await device.applications.deletionHolds(strongbox.names.identifier);
    expect(holds.tokens).toHaveLength(1);
    expect(holds.open).toMatchObject([{ status: 'open' }]);
    await expect(device.applications.deleteTemplate(strongbox.names.identifier)).rejects.toBeInstanceOf(DeletionNotConfirmedError);
    expect(device.applications.suggestions).toHaveLength(1);
    await device.applications.deleteTemplate(strongbox.names.identifier, { confirmed: true });
    expect(device.applications.suggestions).toEqual([]);
    expect(kept(device).deleted).toEqual([{ ...strongbox.names, renewal: 0, stored: true, withdrawnBefore: true }]);
    const second = afresh(device);
    await second.applications.readBackup();
    expect(second.applications.suggestions).toEqual([]);
    // Added again from a file: the suggestion is gone, so it is a new template, stored under the next number.
    const file = device.applications.readTemplateFile(strongbox.texts.template);
    expect(file.kind).toBe('new');
    if (file.kind === 'trusted') throw new Error('not new');
    expect(await device.applications.trustFile(file)).toMatchObject({ renewal: 1, stored: true });
  }, 60_000);

  it('is told to the backup later when no store can be reached now, and this device offers it again meanwhile neither', async () => {
    const device = await deviceWith([100_000n]);
    await device.applications.trust(strongbox.names, strongbox.texts);
    await device.applications.storeNow(strongbox.names.identifier);
    unreachable(device, true);
    expect(await device.applications.deleteTemplate(strongbox.names.identifier)).toEqual({ name: 'Strongbox', backupTold: false });
    unreachable(device, false);
    // A device that reads the backup before it is told still trusts it: the backup holds the template, unmarked.
    const early = afresh(device);
    await early.applications.readBackup();
    expect(early.applications.templates).toHaveLength(1);
    // This device does not trust it again, and writes the mark now.
    await device.applications.readBackup();
    expect(device.applications.templates).toEqual([]);
    expect(device.applications.suggestions).toEqual([]);
    expect(kept(device).deleted).toEqual([{ ...strongbox.names, renewal: 0, stored: true }]);
    const later = afresh(device);
    await later.applications.readBackup();
    expect(later.applications.templates).toEqual([]);
    expect(later.applications.suggestions).toEqual([]);
  }, 60_000);

  it('refuses the wallet\'s own templates', async () => {
    const device = await deviceWith([100_000n]);
    for (const template of Object.values(WALLET_TEMPLATES)) {
      await expect(device.applications.deleteTemplate(templateIdentifier(template))).rejects.toThrow('built in');
      await expect(device.applications.forget(templateIdentifier(template))).rejects.toThrow('does not trust');
      expect(() => device.applications.readTemplateFile(JSON.stringify(template))).toThrow('built in');
    }
  });
});

describe('adding a template from a file', () => {
  const refused = (applications: Applications, text: string): TemplateFileError => {
    try {
      applications.readTemplateFile(text);
    } catch (error) {
      if (error instanceof TemplateFileError) return error;
      throw error;
    }
    throw new Error('not refused');
  };

  it('reads and checks it as an offer is checked, and trusts it only when the user says so', async () => {
    const device = await deviceWith([100_000n]);
    const file = device.applications.readTemplateFile(strongbox.texts.template);
    expect(file).toMatchObject({ kind: 'new', names: strongbox.names, texts: strongbox.texts, summary: { name: 'Strongbox', trusted: false } });
    expect(file.kind === 'trusted' ? undefined : file.summary.service).toBeUndefined();
    // Reading it trusts and stores nothing.
    expect(device.applications.templates).toEqual([]);
    if (file.kind === 'trusted') throw new Error('not new');
    expect(await device.applications.trustFile(file)).toMatchObject({ name: 'Strongbox', from: 'file', stored: true, applications: [] });
    const second = afresh(device);
    await second.applications.readBackup();
    expect(second.applications.templates).toMatchObject([{ name: 'Strongbox', stored: true }]);
    // Once trusted, the file is answered with the template it is.
    expect(device.applications.readTemplateFile(strongbox.texts.template)).toEqual({ kind: 'trusted', names: strongbox.names, name: 'Strongbox' });
  });

  it('refuses, in plain words, what is not a template it can take', async () => {
    const device = await deviceWith([100_000n]);
    expect(refused(device.applications, '  ')).toMatchObject({ problem: 'empty', message: 'The file is empty.' });
    expect(refused(device.applications, '{"name": "half')).toMatchObject({ problem: 'not json', message: 'This file is not JSON.' });
    const notTemplate = refused(device.applications, JSON.stringify({ name: 'A list', items: [1, 2, 3] }));
    expect(notTemplate.problem).toBe('not a template');
    expect(notTemplate.message).toBe('This is not an XO template: "description" expected string, received undefined.');
    expect(notTemplate.message.length).toBeLessThan(200);
    expect(refused(device.applications, `"${' '.repeat(LARGEST_TEMPLATE_FILE)}"`)).toMatchObject({ problem: 'too large' });
    // A template whose value the engine could not read back is refused as a page's offer of it is.
    const definition = JSON.parse(strongbox.texts.template) as { variables: Record<string, { type: string }> };
    const withTimestamp = JSON.stringify({ ...definition, variables: { ...definition.variables, when: { name: 'When', description: 'A time.', type: 'timestamp' } } });
    expect(refused(device.applications, withTimestamp)).toMatchObject({ problem: 'not a template', message: expect.stringContaining('This wallet cannot use this template') });
    expect(device.applications.templates).toEqual([]);
  });

  it('takes a template the backup holds as that suggestion, with the text checked equal', async () => {
    const device = await deviceWith([100_000n, 60_000n]);
    await device.applications.carryOut(open);
    await device.applications.forget(strongbox.names.identifier);
    const file = device.applications.readTemplateFile(strongbox.texts.template);
    expect(file.kind).toBe('suggested');
    // The same template in another text is another text: not that suggestion.
    expect(device.applications.readTemplateFile(JSON.stringify(JSON.parse(strongbox.texts.template), null, 1)).kind).toBe('new');
    if (file.kind === 'trusted') throw new Error('not suggested');
    expect(await device.applications.trustFile(file)).toMatchObject({ name: 'Strongbox', renewal: 1, stored: true, from: 'file' });
    expect(device.applications.suggestions).toEqual([]);
    expect((await device.applications.tokens())[0]).toMatchObject({ meaning: 'position' });
  }, 60_000);
});
