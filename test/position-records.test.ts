import { binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { type ArchiveStore, type MemoryStore, type PositionRecordEntry, type RecordEntry, assessArchive, positionEntry, readArchive } from '@grandmas-wallet/archive';
import { type PositionRecordCheck, Applications, NotStoredError, actionSent, applicationArchive, copyEarlierArchives } from '@grandmas-wallet/app';
import { readControllerHistory, readTemplate, templateLockingBytecode } from '@grandmas-wallet/core';
import { clubTemplate, strongboxTemplate } from '@grandmas-wallet/testing';
import { describe, expect, it, vi } from 'vitest';

import { type Device, STORES, bond, deviceWith, presentation, request, seedOf, strongbox } from './support/applications.js';

/**
 * Acceptance tests PR01, PR02, PR10 and PR11 of the proposal (stage 12 of the plan): the record of every
 * position an action leaves, on a backup store before anything is signed; no record, and no store needed, for
 * an action that leaves nothing outside the wallet; no copy of a record of an action that was never sent; and
 * the earlier archive's records after a recovery, which stay suggestions until the chain bears them out.
 */

const hex = binToHex;
const open = (label: string, amount = 30_000) => request(strongbox, 'open', 'holder', { amount, label });
const unreachable = (device: Device, value: boolean): void => {
  for (const store of device.stores.values()) store.unreachable = value;
};
/** The device's archive for applications, as the device itself uses it, under the seed of the given index. */
const archiveOf = (device: Device, seedIndex = 0) =>
  applicationArchive({ arrangement: () => device.arrangement, storeAt: (address) => device.stores.get(address) as MemoryStore, seed: seedOf(seedIndex), identity: device.identity, chain: device.chain });
/** The position records an archive holds on the given stores, each with whose it is, as a reader assesses them. */
const positionsOn = async (device: Device, access = device.arrangement.archive, stores: ArchiveStore[] = [...device.stores.values()]) => {
  const contents = await readArchive(hexToBin(access.archiveId), hexToBin(access.contentKey), stores);
  return assessArchive(contents, { network: 'testnet', history: await readControllerHistory(device.chain, device.identity) }).positions;
};
/** What a store lists for an archive. */
const listed = (device: Device, archiveId: string) => Promise.all([...device.stores.values()].map((store) => store.list(archiveId)));
const boxAt = (category: string) => templateLockingBytecode(readTemplate(strongbox.texts.template).definition, 'boxLockingScript', { boxKey: category });

describe('position records: written before anything is signed', () => {
  it('PR01: an action that leaves a position has its record on a store before a signature leaves the wallet; with no store reachable it is refused and nothing is signed', async () => {
    const device = await deviceWith([100_000n, 100_000n]);
    const store = device.stores.get(STORES[0] as string) as MemoryStore;
    // What one store held at the moment the key holder was asked to build and sign.
    let atSigning: Awaited<ReturnType<typeof positionsOn>> | undefined;
    const prepare = device.backend.prepare.bind(device.backend);
    const signing = vi.spyOn(device.backend, 'prepare').mockImplementation(async (asked) => {
      atSigning = await positionsOn(device, device.arrangement.archive, [store]);
      return prepare(asked);
    });
    expect((await device.applications.preview(open('01'))).recordsPosition).toBe(true);
    const opened = await device.applications.carryOut(open('01'));
    const category = opened.tokens[0]?.category as string;
    expect(signing).toHaveBeenCalledTimes(1);
    // The record was on the store, signed by the owner, before the signature was made; it is what the transaction made.
    const record: PositionRecordEntry = {
      kind: 'position',
      token: { category, commitment: '01', capability: 'none' },
      templateIdentifier: strongbox.names.identifier,
      lockingScriptIdentifier: 'boxLockingScript',
      roleIdentifier: 'holder',
      variables: { boxKey: category },
      values: { amount: '30000', label: '01' },
    };
    expect(atSigning).toEqual([expect.objectContaining({ entry: record, standing: 'current owner' })]);
    expect(device.applications.positionRecords).toEqual([record]);
    // The script it names is the one the transaction paid, and the token is the one the wallet received.
    expect((await device.chain.getHistory(boxAt(category))).map((entry) => entry.transactionId)).toEqual([opened.transactionId]);
    // No address of the wallet's is in it: not the key's, not what was left over.
    const text = JSON.stringify(record);
    const own = [...(await device.wallet.parts.tokenCoins()).map(({ coin }) => coin), ...(await device.wallet.parts.ownCoins())];
    expect(own.length).toBeGreaterThan(1);
    for (const coin of own) expect(text).not.toContain(hex(coin.utxo.output.lockingBytecode));

    // With no store reachable, a second position is refused before anything is built or signed.
    signing.mockClear();
    unreachable(device, true);
    const broadcasts = device.chain.broadcasts;
    await expect(device.applications.carryOut(open('02'))).rejects.toBeInstanceOf(NotStoredError);
    await expect(device.applications.carryOut(open('02'))).rejects.toThrow('No backup store confirmed the record of what the action leaves');
    expect(signing).not.toHaveBeenCalled();
    expect(device.chain.broadcasts).toBe(broadcasts);
    // No address was taken for it, and the wallet holds one record and one key.
    expect(device.state().allocation[1].held).toEqual([]);
    expect(device.applications.positionRecords).toHaveLength(1);
    expect((await device.applications.tokens()).map((token) => token.category)).toEqual([category]);

    // A wallet with no backup store refuses in the same way, even for a template it has stored somewhere before.
    const bare = new Applications(device.wallet.parts, {});
    unreachable(device, false);
    await expect(bare.carryOut(open('03'))).rejects.toThrow('has no backup store');
    expect(signing).not.toHaveBeenCalled();

    // Once a store answers again, the same action is carried out, its record first.
    const again = await device.applications.carryOut(open('02'));
    expect(signing).toHaveBeenCalledTimes(1);
    expect((await positionsOn(device, device.arrangement.archive, [store])).map(({ entry }) => entry.token?.category)).toEqual([category, again.tokens[0]?.category]);
  });

  it('PR02: an action that leaves nothing outside the wallet\'s addresses is carried out with no store reachable, and no record is written', async () => {
    const device = await deviceWith([100_000n]);
    const opened = await device.applications.carryOut(open('01'));
    const category = opened.tokens[0]?.category as string;
    const before = await listed(device, device.arrangement.archive.archiveId);
    // Every write to the backup is seen.
    const written: RecordEntry[] = [];
    const real = archiveOf(device);
    const watched = new Applications(device.wallet.parts, { archive: { read: real.read, write: async (entry) => (written.push(entry), real.write(entry)) } });
    unreachable(device, true);
    const [key] = await watched.recordedPositions();
    if (key === undefined) throw new Error('no key');
    const take = watched.actionOn(key, 'take', { keyInput: 1 });
    expect((await watched.preview(take)).recordsPosition).toBeUndefined();
    const taken = await watched.carryOut(take);
    // Everything came back to the wallet: the key, and the box's coins.
    expect(taken.tokens).toEqual([expect.objectContaining({ category, commitment: '01' })]);
    expect(await device.chain.listUnspent(boxAt(category))).toEqual([]);
    expect(written).toEqual([]);
    unreachable(device, false);
    expect(await listed(device, device.arrangement.archive.archiveId)).toEqual(before);
    expect(watched.positionRecords).toHaveLength(1);
  });
});

describe('position records: what is copied after a recovery', () => {
  it('PR10: a record of an action that was never sent: nothing is listed for it, and it is not copied into a new archive', async () => {
    const device = await deviceWith([100_000n, 100_000n]);
    const sent = await device.applications.carryOut(open('01'));
    const category = sent.tokens[0]?.category as string;
    // The second action's record reaches the stores, and the device stops before the transaction is signed.
    vi.spyOn(device.backend, 'prepare').mockRejectedValueOnce(new Error('The device stopped.'));
    await expect(device.applications.carryOut(open('02'))).rejects.toThrow('The device stopped.');
    const records = (await positionsOn(device)).map(({ entry }) => entry);
    expect(records).toHaveLength(2);
    const [, neverSent] = records as [PositionRecordEntry, PositionRecordEntry];
    const unsent = neverSent.token?.category as string;
    expect(unsent).not.toBe(category);
    // The script it names, the chain does not know; its token does not exist.
    expect(await device.chain.getHistory(boxAt(unsent))).toEqual([]);
    // A record that names only a token the wallet never received, as an action handed out by a contract would leave.
    const stranger: PositionRecordEntry = positionEntry({ token: { category: 'ee'.repeat(32), commitment: '', capability: 'none' }, templateIdentifier: strongbox.names.identifier, values: {} });
    await archiveOf(device).write(stranger);
    // Nothing is listed for either.
    expect((await device.applications.tokens()).map((token) => token.category)).toEqual([category]);

    // A recovery: the new device copies the earlier archive.
    await device.recover();
    const taken = await device.takeOver();
    const earlierId = device.arrangement.archive.archiveId;
    const copiedAt = taken.arrangement.archive;
    // The record of the action that was sent is copied; the one whose script the chain does not know is not.
    // Whether the token of the other was ever received is known only once the wallet has looked for its coins.
    expect((await positionsOn(taken, copiedAt)).map(({ entry, standing }) => [entry.token?.category, standing])).toEqual([[category, 'earlier owner']]);
    expect(taken.arrangement.copiedArchives ?? []).not.toContain(earlierId);
    await taken.wallet.search();
    expect(taken.state().fullySearched).toBe(true);
    const storeAt = (address: string): MemoryStore => taken.stores.get(address) as MemoryStore;
    const finished = await copyEarlierArchives({ arrangement: taken.arrangement, storeAt, whetherSent: actionSent(taken.wallet.parts) });
    expect(finished.unfinished).toEqual([]);
    expect(finished.arrangement.copiedArchives).toContain(earlierId);
    expect((await positionsOn(taken, copiedAt)).map(({ entry }) => entry.token?.category)).toEqual([category]);

    // The new device lists the token it swept, and nothing for the records left behind.
    await taken.wallet.sweepEarlier();
    await taken.applications.readBackup();
    expect(taken.applications.suggestedRecords.map((entry) => entry.token?.category)).toEqual([category]);
    const listedThere = (await taken.applications.tokens()).map((token) => token.category);
    expect(listedThere).toEqual([category]);
    // The earlier archive still holds all three.
    expect((await positionsOn(device)).map(({ entry }) => entry.token?.category)).toEqual([category, unsent, 'ee'.repeat(32)]);
  }, 60_000);

  it('PR11: after a recovery, while a store cannot be reached or the device stops, the records are copied as suggestions, nothing is removed before the copy is complete, and a record becomes the new owner\'s only once the chain has confirmed it', async () => {
    const device = await deviceWith([100_000n]);
    const opened = await device.applications.carryOut(open('01'));
    const category = opened.tokens[0]?.category as string;
    const earlier = device.arrangement.archive;
    const [record] = device.applications.positionRecords;
    const before = await listed(device, earlier.archiveId);
    await device.recover();

    // No store can be reached while the new device takes over: nothing is copied, and the copy is unfinished.
    unreachable(device, true);
    const taken = await device.takeOver();
    unreachable(device, false);
    expect(taken.arrangement.copiedArchives ?? []).toEqual([]);
    expect(await positionsOn(taken, taken.arrangement.archive)).toEqual([]);
    expect(await listed(device, earlier.archiveId)).toEqual(before);

    // The device stops during the copy: after one write, every write fails.
    const storeAt = (address: string): MemoryStore => taken.stores.get(address) as MemoryStore;
    let writes = 0;
    const stops = [...taken.stores.values()].map((store) => {
      const put = store.put.bind(store);
      return vi.spyOn(store, 'put').mockImplementation(async (archiveId, sealed) => {
        writes += 1;
        if (writes > 1) throw new Error('The device stopped.');
        return put(archiveId, sealed);
      });
    });
    const stopped = await copyEarlierArchives({ arrangement: taken.arrangement, storeAt, whetherSent: actionSent(taken.wallet.parts) });
    for (const stop of stops) stop.mockRestore();
    expect(stopped.copied).toBe(1);
    expect(stopped.unfinished.length).toBeGreaterThan(0);
    expect(stopped.arrangement.copiedArchives).toEqual([]);
    expect(await listed(device, earlier.archiveId)).toEqual(before);

    // Continued, it completes. Nothing was removed from the earlier archive at any point.
    const finished = await copyEarlierArchives({ arrangement: stopped.arrangement, storeAt, whetherSent: actionSent(taken.wallet.parts) });
    expect(finished.unfinished).toEqual([]);
    expect(finished.arrangement.copiedArchives).toEqual([earlier.archiveId]);
    expect(await listed(device, earlier.archiveId)).toEqual(before);
    expect(await positionsOn(taken, taken.arrangement.archive)).toEqual([expect.objectContaining({ entry: record, standing: 'earlier owner' })]);

    // The new device sweeps the key and reads the backup. The record is a suggestion: the chain has not confirmed it,
    // and until the check is built none is confirmed. Nothing is written as the new owner's.
    await taken.wallet.search();
    await taken.wallet.sweepEarlier();
    await taken.applications.readBackup();
    expect(taken.applications.suggestedRecords).toEqual([record]);
    expect(taken.applications.positionRecords).toEqual([]);
    expect((await positionsOn(taken, taken.arrangement.archive)).map(({ standing }) => standing)).toEqual(['earlier owner']);

    // A check that confirms it, standing in for the check against the chain: the wallet holds the record's NFT, and
    // the chain knows the record's script. With no store reachable, it is still not the new owner's.
    const check: PositionRecordCheck = async (entry, wallet) => {
      const held = (await wallet.tokenCoins()).some(({ coin }) => hex(coin.utxo.output.token?.category ?? new Uint8Array()) === entry.token?.category && hex(coin.utxo.output.token?.nft?.commitment ?? new Uint8Array()) === entry.token?.commitment);
      const paid = (await wallet.chain.getHistory(boxAt(entry.variables?.['boxKey'] ?? ''))).length > 0;
      return { counts: held && paid, reason: 'stand-in for the check against the chain' };
    };
    const confirming = new Applications(taken.wallet.parts, { archive: archiveOf(taken, 1), checkRecord: check });
    unreachable(taken, true);
    await confirming.readBackup().catch(() => undefined);
    unreachable(taken, false);
    expect(confirming.positionRecords).toEqual([]);
    expect(confirming.suggestedRecords).toEqual([record]);

    // With a store that answers, it is written again as the new owner's own, with the values of the earlier record.
    await confirming.readBackup();
    expect(confirming.positionRecords).toEqual([record]);
    expect(confirming.suggestedRecords).toEqual([]);
    const assessed = await positionsOn(taken, taken.arrangement.archive);
    expect(assessed.map(({ entry, standing }) => [entry, standing])).toEqual([
      [record, 'earlier owner'],
      [record, 'current owner'],
    ]);
    expect(record?.token?.category).toBe(category);
  }, 60_000);
});

describe('what a position record holds', () => {
  it('an address that is one of a script\'s own values stays in the record, so that the script can be made again; no other address of the wallet\'s is kept', async () => {
    const device = await deviceWith([100_000n]);
    // The marker carries a token of the key's category beside the bond: made from the wallet's coin, it goes there with the user's tick.
    const posted = await device.applications.carryOut(request(bond, 'post', 'poster', { amount: 20_000, serial: '07' }, { bindings: { refundTo: 'lasting' } }), undefined, { tokensLeave: true });
    const category = posted.tokens[0]?.category as string;
    const records = device.applications.positionRecords;
    // The return address, a vault address of the wallet's that the marker carries, is one of the bond's own values.
    const definition = readTemplate(bond.texts.template).definition;
    const [marker] = await device.chain.listUnspent(templateLockingBytecode(definition, 'companionLockingScript', { bondKey: category }));
    const markerTransaction = decodeTransactionBch(hexToBin((await device.chain.getTransaction(marker?.transactionId ?? '')) ?? ''));
    if (typeof markerTransaction === 'string') throw new Error(markerTransaction);
    const returnTo = hex(markerTransaction.outputs[marker?.index ?? 0]?.token?.nft?.commitment ?? new Uint8Array());
    expect(returnTo.length).toBeGreaterThan(40);
    expect(records.map(({ lockingScriptIdentifier, variables, values, token }) => ({ lockingScriptIdentifier, variables, values, token }))).toEqual([
      { lockingScriptIdentifier: 'bondLockingScript', variables: { bondKey: category, refundTo: returnTo }, values: { amount: '20000', serial: '07' }, token: { category, commitment: '07', capability: 'none' } },
      { lockingScriptIdentifier: 'companionLockingScript', variables: { bondKey: category }, values: { amount: '20000', serial: '07' }, token: { category, commitment: '07', capability: 'none' } },
    ]);
    // The bond's script is made again from the record alone: it is the one the transaction paid.
    const [bondRecord] = records;
    const bondAt = templateLockingBytecode(definition, 'bondLockingScript', bondRecord?.variables ?? {});
    expect(await device.chain.getHistory(bondAt)).toEqual([expect.objectContaining({ transactionId: posted.transactionId })]);
    // The key's address is in neither set of values.
    const text = JSON.stringify(records);
    for (const { coin } of await device.wallet.parts.tokenCoins()) expect(text).not.toContain(hex(coin.utxo.output.lockingBytecode));
  });

  it('a record is due only where a token of the wallet\'s takes part: joining a club writes the locker\'s record with the card, and none for the door every member shares', async () => {
    const device = await deviceWith([200_000n]);
    const club = presentation(clubTemplate);
    const definition = readTemplate(club.texts.template).definition;
    const doorAt = templateLockingBytecode(definition, 'doorLockingScript', {});
    device.chain.adopt([{ transactionId: 'd0'.repeat(32), index: 2, output: { lockingBytecode: doorAt, valueSatoshis: 1000n, token: { category: hexToBin('c1'.repeat(32)), amount: 1_000_000n, nft: { capability: 'minting', commitment: hexToBin('0700ffff') } } } }]);
    const joined = await device.applications.carryOut(request(club, 'join', 'member', { credits: 30_000, deposit: 20_000, doorCredits: 1_000_000, doorState: '0700ffff', doorNumber: 7 }, { inputs: { doorInput: `${'d0'.repeat(32)}:2` } }));
    const card = joined.tokens.find((token) => token.capability === 'none')?.category as string;
    // The transaction pays the door and the locker, both scripts the member follows. Only the locker holds the card's category.
    expect(device.applications.positionRecords.map(({ lockingScriptIdentifier, variables, token }) => ({ lockingScriptIdentifier, variables, token }))).toEqual([
      { lockingScriptIdentifier: 'lockerLockingScript', variables: { memberKey: card }, token: { category: card, commitment: '01', capability: 'none' } },
    ]);
  });

  it('a payment into someone else\'s position writes no record and needs no store', async () => {
    const plain = presentation(strongboxTemplate);
    const device = await deviceWith([100_000n]);
    // The template is stored first, as before any first action.
    await device.applications.trust(plain.names, plain.texts);
    expect(await device.applications.storeNow(plain.names.identifier)).toBe(true);
    unreachable(device, true);
    const someoneElses = 'ab'.repeat(32);
    const paid = request(plain, 'add', 'holder', { boxKey: someoneElses, amount: 5_000 });
    expect((await device.applications.preview(paid)).recordsPosition).toBeUndefined();
    await device.applications.carryOut(paid);
    expect(device.applications.positionRecords).toEqual([]);
    expect((await device.chain.listUnspent(templateLockingBytecode(readTemplate(plain.texts.template).definition, 'boxLockingScript', { boxKey: someoneElses }))).length).toBe(1);
  });

  it('a payment into a position that a record already names needs no new record, and goes on with no store reachable', async () => {
    const device = await deviceWith([100_000n, 50_000n]);
    const opened = await device.applications.carryOut(open('01'));
    const category = opened.tokens[0]?.category as string;
    unreachable(device, true);
    const add = request(strongbox, 'add', 'holder', { amount: 5_000 }, { about: { category, spent: false } });
    expect((await device.applications.preview(add)).recordsPosition).toBeUndefined();
    await device.applications.carryOut(add);
    expect(device.applications.positionRecords).toHaveLength(1);
    expect((await device.chain.listUnspent(boxAt(category))).length).toBe(2);
  });

  it('an action tried again with other values after it was never sent has its own record', async () => {
    const device = await deviceWith([100_000n]);
    vi.spyOn(device.backend, 'prepare').mockRejectedValueOnce(new Error('The device stopped.'));
    await expect(device.applications.carryOut(open('01', 30_000))).rejects.toThrow('The device stopped.');
    // The same coin makes the same token and the same script; the amount differs, and the record says what was sent.
    const opened = await device.applications.carryOut(open('01', 40_000));
    expect(device.applications.positionRecords.map(({ token, values }) => [token?.category, values['amount']])).toEqual([
      [opened.tokens[0]?.category, '30000'],
      [opened.tokens[0]?.category, '40000'],
    ]);
    // The same action again, with the same values, writes nothing new.
    vi.spyOn(device.backend, 'prepare').mockRejectedValueOnce(new Error('The device stopped.'));
    await device.receive(100_000n);
    await expect(device.applications.carryOut(open('02', 30_000))).rejects.toThrow('The device stopped.');
    const records = device.applications.positionRecords.length;
    await device.applications.carryOut(open('02', 30_000));
    expect(device.applications.positionRecords).toHaveLength(records);
  });

  it('an NFT an action gives the wallet at a script the wallet does not follow has a record that names no script', async () => {
    // The same box, at a script the template marks as one the holder need not follow, as an application whose
    // contracts every user shares does.
    const shared = presentation({ ...strongboxTemplate, lockingScripts: { boxLockingScript: { ...strongboxTemplate.lockingScripts.boxLockingScript, roles: { holder: { ...strongboxTemplate.lockingScripts.boxLockingScript.roles.holder, relevant: false } } } } });
    const device = await deviceWith([100_000n]);
    const opened = await device.applications.carryOut(request(shared, 'open', 'holder', { amount: 30_000, label: '0a' }, { page: 'https://application.example/' }));
    const category = opened.tokens[0]?.category as string;
    expect(device.applications.positionRecords).toEqual([
      { kind: 'position', token: { category, commitment: '0a', capability: 'none' }, templateIdentifier: shared.names.identifier, values: { amount: '30000', boxKey: category, label: '0a' }, applicationPage: 'https://application.example/' },
    ]);
  });
});
