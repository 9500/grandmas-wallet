import { binToHex, hexToBin } from '@bitauth/libauth';
import { p2pkhLockingBytecode } from '@grandmas-wallet/core';
import { testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import {
  type ArchiveRecord,
  BackupUnavailableError,
  MemoryStore,
  RECORD_FORMAT,
  blobIdOf,
  canonicalJson,
  decodeBlob,
  encodeBlob,
  parseRecord,
  seal,
  signRecord,
  templateContentHash,
  unseal,
} from '../src/index.js';
import { NETWORK, owner, recoverer, replacement, setup } from './setup.js';

describe('records', () => {
  it('encodes a value the same way whatever the order of its fields', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'] })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(canonicalJson({ a: [true, null, 'x'], b: 1 })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(() => canonicalJson({ a: 1.5 })).toThrow();
  });

  it('cannot be read from a store without the archive key', async () => {
    const { stores, archiveId, archiveIdHex, contentKey, writerFor, openJar } = setup();
    await openJar(writerFor(owner, 0));
    const [name] = await stores[0].list(archiveIdHex);
    const sealed = await stores[0].get(archiveIdHex, name ?? '');
    if (sealed === undefined) throw new Error('nothing stored');
    expect(decodeBlob(unseal(contentKey, archiveId, sealed)).type).toBe('record');
    expect(() => unseal(new Uint8Array(32).fill(1), archiveId, sealed)).toThrow('cannot be opened');
    // The stored bytes show neither the wallet's identity nor the kind of position.
    const visible = new TextDecoder('latin1').decode(sealed);
    expect(visible).not.toContain('savings-jar');
    expect(visible).not.toContain(RECORD_FORMAT);
  });

  it('refuses records that are malformed or of another version', () => {
    const base = { format: RECORD_FORMAT, version: 1, network: NETWORK, identity: 'ab'.repeat(32), sequence: 0, previous: null, ownerEpoch: 0, createdAt: 1 };
    expect(() => parseRecord(JSON.stringify({ ...base, version: 2, entry: { type: 'position' } }))).toThrow('not supported');
    expect(() => parseRecord(JSON.stringify({ ...base, sequence: 1, entry: { type: 'x' } }))).toThrow('first record');
    expect(() => parseRecord(JSON.stringify({ ...base, entry: { type: 'position', status: 'confirmed', position: { positionId: 'p' } } }))).toThrow();
    expect(parseRecord(JSON.stringify({ ...base, entry: { type: 'something-new', data: 1 } })).entry).toEqual({ type: 'something-new' });
  });
});

describe('write before sign (R03)', () => {
  it('releases the signature only after the stores confirm', async () => {
    const { stores, archiveIdHex, writerFor, jar } = setup();
    const writer = writerFor(owner, 0);
    let stored = -1;
    await writer.protect([jar().position], async () => {
      stored = (await stores[0].list(archiveIdHex)).length + (await stores[1].list(archiveIdHex)).length;
    });
    expect(stored).toBe(2);
  });

  it('does not release it while a required store is unavailable, and does once it is back', async () => {
    const { stores, wallet, writerFor, jar, restoreWith } = setup();
    const writer = writerFor(owner, 0);
    const described = jar();
    let signed = 0;
    const sign = async () => {
      signed += 1;
      return wallet.openJarTransaction(owner, described.unlockTime);
    };

    stores[1].unreachable = true;
    await expect(writer.protect([described.position], sign)).rejects.toBeInstanceOf(BackupUnavailableError);
    expect(signed).toBe(0);
    // Nothing more is recorded on a second try; the record written the first time is sent again.
    await expect(writer.protect([], sign)).rejects.toThrow('1 of the required 2');
    expect(signed).toBe(0);

    stores[1].unreachable = false;
    const built = await writer.protect([], sign);
    expect(signed).toBe(1);
    await writer.confirm(described.position, wallet.send(built));
    const report = await restoreWith();
    expect(report.completeness).toBe('complete');
    expect(report.positions.map((position) => position.onChain)).toEqual(['live']);
  });

  it('can be set to need fewer stores, and brings the absent store up to date later', async () => {
    const { stores, archiveIdHex, writerFor, openJar } = setup();
    const writer = writerFor(owner, 0, undefined, 1);
    stores[1].unreachable = true;
    await openJar(writer);
    stores[1].unreachable = false;
    expect(await stores[1].list(archiveIdHex)).toEqual([]);
    await writer.flush();
    expect((await stores[1].list(archiveIdHex)).sort()).toEqual((await stores[0].list(archiveIdHex)).sort());
    expect((await writer.status()).map((store) => store.held === store.total)).toEqual([true, true]);
  });

  it('keeps unconfirmed records across a restart of the wallet', async () => {
    const { stores, writerFor, jar, restoreWith } = setup();
    const first = writerFor(owner, 0);
    stores[0].unreachable = true;
    stores[1].unreachable = true;
    await expect(first.protect([jar().position], async () => undefined)).rejects.toBeInstanceOf(BackupUnavailableError);

    stores[0].unreachable = false;
    stores[1].unreachable = false;
    const afterRestart = writerFor(owner, 0, JSON.parse(JSON.stringify(first.snapshot())));
    await afterRestart.flush();
    expect((await restoreWith()).positions).toHaveLength(1);
  });
});

describe('where the archive is kept', () => {
  it('works with a single store', async () => {
    const { stores, writerFor, openJar, restoreWith } = setup();
    const writer = writerFor(owner, 0);
    writer.setStores([stores[0]]);
    await openJar(writer);
    const report = await restoreWith({ stores: [stores[0]] });
    expect(report.completeness).toBe('complete');
    expect(report.positions.map((position) => position.onChain)).toEqual(['live']);
  });

  it('still holds back the signature when the single store does not confirm (R03)', async () => {
    const { stores, writerFor, jar } = setup();
    const writer = writerFor(owner, 0);
    writer.setStores([stores[0]]);
    stores[0].unreachable = true;
    let signed = 0;
    await expect(writer.protect([jar().position], async () => (signed += 1))).rejects.toBeInstanceOf(BackupUnavailableError);
    expect(signed).toBe(0);
  });

  it('needs at least one store, each with its own name', () => {
    const { stores, writerFor } = setup();
    const writer = writerFor(owner, 0);
    expect(() => writer.setStores([])).toThrow('At least one');
    expect(() => writer.setStores([stores[0], stores[0]])).toThrow('own name');
    expect(() => writer.setStores([stores[0]], 2)).toThrow('between 1 and');
  });

  it('keeps every blob on the device', async () => {
    const { stores, device, archiveIdHex, writerFor, openJar } = setup();
    const writer = writerFor(owner, 0);
    await openJar(writer);
    await openJar(writer);
    expect((await device.list(archiveIdHex)).sort()).toEqual((await stores[0].list(archiveIdHex)).sort());
    expect(await device.list(archiveIdHex)).toHaveLength(4);
  });

  it('moves to another store without the old one taking part', async () => {
    const { stores, archiveIdHex, writerFor, openJar, restoreWith } = setup();
    const writer = writerFor(owner, 0);
    writer.setStores([stores[0]]);
    await openJar(writer);
    expect(await stores[1].list(archiveIdHex)).toEqual([]);

    // The old store is gone for good; the wallet is pointed at another and goes on.
    stores[0].unreachable = true;
    writer.setStores([stores[1]]);
    await openJar(writer);

    const report = await restoreWith({ stores: [stores[1]] });
    expect(report.completeness).toBe('complete');
    expect(report.positions.map((position) => position.onChain)).toEqual(['live', 'live']);
  });

  it('fills a store that is added later', async () => {
    const { stores, archiveIdHex, writerFor, openJar } = setup();
    const writer = writerFor(owner, 0);
    writer.setStores([stores[0]]);
    await openJar(writer);
    writer.setStores([stores[0], stores[1]]);
    expect((await writer.status()).map((store) => store.held)).toEqual([2, 0]);
    await writer.flush();
    expect((await stores[1].list(archiveIdHex)).sort()).toEqual((await stores[0].list(archiveIdHex)).sort());
  });

  it('gives a restoring device its own copy, from which a new store can be filled', async () => {
    const { stores, archiveIdHex, writerFor, openJar, restoreWith } = setup();
    await openJar(writerFor(owner, 0));
    const newDevice = new MemoryStore('new-device');
    const restored = await restoreWith({ local: newDevice });
    expect((await newDevice.list(archiveIdHex)).sort()).toEqual((await stores[0].list(archiveIdHex)).sort());

    const elsewhere = new MemoryStore('store-three');
    const writer = writerFor(owner, 0, restored.writerState, undefined, newDevice);
    writer.setStores([elsewhere]);
    await writer.flush();
    expect((await restoreWith({ stores: [elsewhere] })).completeness).toBe('complete');
  });
});

describe('restoring from the archive', () => {
  it('finds positions opened after the archive was set up, with nothing but its key and the identity (R02)', async () => {
    const { wallet, writerFor, openJar, restoreWith } = setup();
    const writer = writerFor(owner, 0);
    const first = await openJar(writer);
    const second = await openJar(writer);
    const third = await openJar(writer);

    const report = await restoreWith();
    expect(report.completeness).toBe('complete');
    expect(report.unresolved).toEqual([]);
    expect(report.positions.map((position) => [position.position.positionId, position.result, position.onChain])).toEqual([
      ['jar-1', 'complete', 'live'],
      ['jar-2', 'complete', 'live'],
      ['jar-3', 'complete', 'live'],
    ]);
    expect(report.positions.map((position) => position.position.parameters['unlockTime'])).toEqual([first.unlockTime, second.unlockTime, third.unlockTime]);
    expect(report.positions[0]?.unspent[0]?.valueSatoshis).toBe(5_000n);
    expect(report.funds.balance).toBeGreaterThan(30_000n);
    expect(report.controller.current.state.ownerKeyHash).toEqual(owner.keyHash);
    expect(wallet.identityHex).toBe(binToHex(report.controller.current.identity));
  });

  it('finds a position whose transaction was sent but never recorded as sent (R04)', async () => {
    const { wallet, writerFor, jar, restoreWith } = setup();
    const writer = writerFor(owner, 0);
    const described = jar();
    const built = await writer.protect([described.position], async () => wallet.openJarTransaction(owner, described.unlockTime));
    wallet.send(built);
    // The device is lost here: the record still says "prepared".

    const report = await restoreWith();
    const [position] = report.positions;
    expect(position?.recorded).toBe('prepared');
    expect(position?.onChain).toBe('live');
    expect(position?.result).toBe('complete');
    expect(report.completeness).toBe('complete');
  });

  it('does not report a position for a prepared transaction that was never sent (R05)', async () => {
    const { wallet, writerFor, jar, restoreWith } = setup();
    const writer = writerFor(owner, 0);
    const described = jar();
    await writer.protect([described.position], async () => wallet.openJarTransaction(owner, described.unlockTime));

    const report = await restoreWith();
    const [position] = report.positions;
    expect(position?.recorded).toBe('prepared');
    expect(position?.onChain).toBe('never-created');
    expect(position?.unspent).toEqual([]);
    expect(report.completeness).toBe('complete');
  });

  it('reports a position its owner has emptied as spent', async () => {
    const { chain, wallet, writerFor, openJar, restoreWith } = setup();
    const writer = writerFor(owner, 0);
    const opened = await openJar(writer, owner, 60);
    chain.nowMs += 3_600_000;
    await writer.close(opened.position, wallet.emptyJar(owner, opened.unlockTime));
    const [position] = (await restoreWith()).positions;
    expect([position?.recorded, position?.onChain]).toEqual(['closed', 'spent']);
  });

  it('works from one store when the other is unreachable or returns damaged data (R06)', async () => {
    const { stores, archiveIdHex, writerFor, openJar, restoreWith } = setup();
    await openJar(writerFor(owner, 0));

    stores[0].unreachable = true;
    const withOne = await restoreWith();
    expect(withOne.positions.map((position) => position.onChain)).toEqual(['live']);
    expect(withOne.stores.map((store) => store.reachable)).toEqual([false, true]);
    expect(withOne.unresolved).toEqual(['Backup store store-one could not be reached.']);

    stores[0].unreachable = false;
    for (const name of await stores[1].list(archiveIdHex)) stores[1].tamper(archiveIdHex, name, new Uint8Array(80).fill(7));
    const withDamage = await restoreWith();
    expect(withDamage.positions.map((position) => [position.result, position.onChain])).toEqual([['complete', 'live']]);
    expect(withDamage.stores[1]?.damaged).toBe(2);
    expect(withDamage.completeness).toBe('incomplete');
  });

  it('rejects content that is intact but not written by the owner (R06)', async () => {
    const { wallet, stores, archiveId, archiveIdHex, contentKey, writerFor, openJar, restoreWith } = setup();
    await openJar(writerFor(owner, 0));
    const outsider = testKey(0x99);
    const forged: ArchiveRecord = {
      format: RECORD_FORMAT, version: 1, network: NETWORK, identity: wallet.identityHex, sequence: 0, previous: null, ownerEpoch: 0, createdAt: 1,
      entry: { type: 'position', status: 'confirmed', position: { positionId: 'x', kind: 'savings-jar', interfaceVersion: 2, parameters: { unlockTime: 5 }, lockingBytecode: 'aa', requires: [] } },
    };
    // Someone who can read the archive, such as the recoverer, still cannot add to it.
    for (const key of [outsider, recoverer]) {
      await stores[0].put(archiveIdHex, seal(contentKey, archiveId, encodeBlob({ type: 'record', signed: signRecord(forged, key) })));
    }
    await stores[0].put(archiveIdHex, seal(new Uint8Array(32).fill(9), archiveId, new Uint8Array(40)));

    const report = await restoreWith();
    expect(report.rejected.map((item) => item.reason).sort()).toEqual([
      'The blob cannot be opened with this archive key.',
      'The record was not signed by the owner of epoch 0.',
      'The record was not signed by the owner of epoch 0.',
    ]);
    expect(report.positions.map((position) => position.position.positionId)).toEqual(['jar-1']);
    expect(report.completeness).toBe('incomplete');
  });

  it('notices a position missing from an old copy of the archive (R07)', async () => {
    const { stores, archiveIdHex, writerFor, openJar, restoreWith } = setup();
    const writer = writerFor(owner, 0);
    await openJar(writer);
    const old = new Map<string, Uint8Array>();
    for (const name of await stores[0].list(archiveIdHex)) old.set(name, (await stores[0].get(archiveIdHex, name)) ?? new Uint8Array());
    const second = await openJar(writer);

    // Both stores go back to what they held before the second jar.
    for (const store of stores) {
      for (const name of await store.list(archiveIdHex)) if (!old.has(name)) store.tamper(archiveIdHex, name, undefined);
    }
    const report = await restoreWith();
    expect(report.positions.map((position) => position.position.positionId)).toEqual(['jar-1']);
    expect(report.undescribed).toEqual([
      { transactionId: second.transactionId, index: 1, valueSatoshis: 5_000n, lockingBytecode: second.position.lockingBytecode },
    ]);
    expect(report.completeness).toBe('incomplete');
    expect(report.unresolved).toEqual(['1 output(s) paid from the wallet to a script address are described by no record.']);
  });

  it('does not count ordinary payments as missing positions', async () => {
    const { wallet, restoreWith } = setup();
    wallet.pay(owner, p2pkhLockingBytecode(new Uint8Array(20).fill(5)), 2_000n);
    const report = await restoreWith();
    expect(report.undescribed).toEqual([]);
    expect(report.completeness).toBe('complete');
  });

  it('reports a gap when a record in the middle is missing (R07)', async () => {
    const { stores, archiveId, archiveIdHex, contentKey, writerFor, openJar, restoreWith } = setup();
    const writer = writerFor(owner, 0);
    await openJar(writer);
    await openJar(writer);
    for (const name of await stores[0].list(archiveIdHex)) {
      const blob = decodeBlob(unseal(contentKey, archiveId, (await stores[0].get(archiveIdHex, name)) ?? new Uint8Array()));
      if (blob.type === 'record' && parseRecord(blob.signed.message).sequence === 1) stores.forEach((store) => store.tamper(archiveIdHex, name, undefined));
    }
    const report = await restoreWith();
    expect(report.missingRecords).toHaveLength(1);
    expect(report.completeness).toBe('incomplete');
    // Records after the gap are still used as places to look.
    expect(report.positions.map((position) => position.onChain)).toEqual(['live', 'live']);
  });

  it('reports conflicting histories and does not let the earlier owner override the new one (R07)', async () => {
    const { wallet, writerFor, openJar, restoreWith } = setup();
    const before = writerFor(owner, 0);
    await openJar(before);
    const stolen = before.snapshot();

    wallet.recover(recoverer, replacement);
    const restored = await restoreWith();
    expect(restored.controller.owners.map((period) => period.ownerEpoch)).toEqual([0, 1]);
    const after = writerFor(replacement, 1, restored.writerState);
    const second = await openJar(after, replacement);

    // Whoever holds the old device keeps writing with the old key, from where that device left off.
    const thief = writerFor(owner, 0, stolen);
    const fake = { ...second.position, positionId: 'jar-2', label: 'not the real one', parameters: { unlockTime: 1 }, lockingBytecode: wallet.jar(1).lockingBytecode.reduce((hex, byte) => hex + byte.toString(16).padStart(2, '0'), '') };
    await thief.protect([fake], async () => undefined);

    const report = await restoreWith();
    expect(report.conflicts).toHaveLength(1);
    expect(report.completeness).toBe('incomplete');
    expect(report.unresolved).toContain('The archive holds conflicting histories.');
    // The new owner's record is the one kept for the position both lines name.
    const jarTwo = report.positions.find((position) => position.position.positionId === 'jar-2');
    expect(jarTwo?.position.parameters['unlockTime']).toBe(second.unlockTime);
    expect(jarTwo?.onChain).toBe('live');
    // The new owner continues from its own record, not from the old device's.
    expect(report.writerState.nextSequence).toBe(4);
  });

  it('rejects a record that claims an owner epoch its signer never held', async () => {
    const { wallet, writerFor, openJar, restoreWith, jar } = setup();
    await openJar(writerFor(owner, 0));
    wallet.recover(recoverer, replacement);
    const { writerState } = await restoreWith();
    // The old key signing as the new epoch, and following the new owner's line with the old epoch.
    await writerFor(owner, 1, writerState).protect([jar().position], async () => undefined);
    const report = await restoreWith();
    expect(report.rejected.map((item) => item.reason)).toEqual(['The record was not signed by the owner of epoch 1.']);
    expect(report.positions).toHaveLength(1);
  });

  it('says so when a position is of a kind it does not know, or needs something it does not have (R08)', async () => {
    const { wallet, writerFor, jar, restoreWith } = setup();
    const writer = writerFor(owner, 0);
    const unknownScript = wallet.jar(12345).lockingBytecode;
    const unknown = { positionId: 'pool', kind: 'liquidity-pool', interfaceVersion: 2, parameters: {}, lockingBytecode: binToHex(unknownScript), requires: [], label: 'Pool share' };
    const needsSecret = { ...jar().position, requires: ['secret:withdrawal-preimage'] };
    const newerInterface = { ...jar().position, interfaceVersion: 3 };
    await writer.protect([unknown, needsSecret, newerInterface], async () => undefined);
    wallet.pay(owner, unknownScript, 3_000n);
    wallet.pay(owner, hexToBin(needsSecret.lockingBytecode), 3_000n);

    const report = await restoreWith();
    const byId = new Map(report.positions.map((position) => [position.position.positionId, position]));
    expect(byId.get('pool')?.result).toBe('unsupported');
    expect(byId.get('pool')?.onChain).toBe('live');
    expect(byId.get('pool')?.reasons).toEqual(['This wallet does not know positions of kind "liquidity-pool".']);
    expect(byId.get(needsSecret.positionId)?.result).toBe('unsupported');
    expect(byId.get(needsSecret.positionId)?.reasons[0]).toContain('secret:withdrawal-preimage');
    expect(byId.get(newerInterface.positionId)?.result).toBe('unsupported');
    expect(report.completeness).toBe('incomplete');
    expect(report.unresolved).toContain('Position "Pool share" is unsupported.');
    // Recorded by the owner, so not also listed as an unexplained output.
    expect(report.undescribed).toEqual([]);
  });

  it('says so when the template a position needs is missing, and supplies it when it is there (R08)', async () => {
    const { writerFor, jar, restoreWith, wallet } = setup();
    const writer = writerFor(owner, 0);
    const template = { name: 'Savings Jar', actions: { deposit: {} } };
    const reference = { identifier: 'ab'.repeat(32), contentHash: templateContentHash(template) };
    const described = jar();
    const position = { ...described.position, template: reference };
    wallet.send(await writer.protect([position], async () => wallet.openJarTransaction(owner, described.unlockTime)));

    const without = await restoreWith();
    expect(without.positions[0]?.result).toBe('incomplete');
    expect(without.positions[0]?.reasons[0]).toContain('is not in the archive');
    expect(without.completeness).toBe('incomplete');

    // A wallet that already has the template needs no copy from the archive.
    const known = await restoreWith({ knownTemplates: new Map([[reference.contentHash, template]]) });
    expect(known.positions[0]?.result).toBe('complete');

    expect(await writer.putTemplate(template)).toBe(reference.contentHash);
    await writer.flush();
    const withTemplate = await restoreWith();
    expect(withTemplate.positions[0]?.result).toBe('complete');
    expect(withTemplate.positions[0]?.template).toEqual(template);
    expect(withTemplate.completeness).toBe('complete');
  });

  it('does not look where a record points if the script does not follow from the wallet identity', async () => {
    const { chain, writerFor, jar, restoreWith } = setup();
    const elsewhere = p2pkhLockingBytecode(new Uint8Array(20).fill(8));
    chain.fund(elsewhere, 9_000n);
    await writerFor(owner, 0).protect([{ ...jar().position, lockingBytecode: binToHex(elsewhere) }], async () => undefined);
    const [position] = (await restoreWith()).positions;
    expect(position?.result).toBe('incomplete');
    expect(position?.unspent).toEqual([]);
    expect(position?.onChain).toBeUndefined();
  });

  it('refuses an identity whose creation is not valid, or a record for another wallet', async () => {
    const { restoreWith, archiveId, contentKey, stores, archiveIdHex, wallet } = setup();
    await expect(restoreWith({ identity: 'cd'.repeat(32) })).rejects.toThrow('No transaction creating this identity');
    await expect(restoreWith({ genesisTransactionId: 'ef'.repeat(32) })).rejects.toThrow('different transaction');
    const other: ArchiveRecord = {
      format: RECORD_FORMAT, version: 1, network: 'mainnet', identity: wallet.identityHex, sequence: 0, previous: null, ownerEpoch: 0, createdAt: 1,
      entry: { type: 'future-entry' },
    };
    const sealed = seal(contentKey, archiveId, encodeBlob({ type: 'record', signed: signRecord(other, owner) }));
    expect(await stores[0].put(archiveIdHex, sealed)).toBe(blobIdOf(sealed));
    expect((await restoreWith()).rejected[0]?.reason).toBe('The record is for a different network.');
  });

  it('reports entries of a type it does not know instead of skipping them (R08)', async () => {
    const { restoreWith, archiveId, contentKey, stores, archiveIdHex, wallet } = setup();
    const future: ArchiveRecord = {
      format: RECORD_FORMAT, version: 1, network: NETWORK, identity: wallet.identityHex, sequence: 0, previous: null, ownerEpoch: 0, createdAt: 1,
      entry: { type: 'future-entry' },
    };
    await stores[0].put(archiveIdHex, seal(contentKey, archiveId, encodeBlob({ type: 'record', signed: signRecord(future, owner) })));
    const report = await restoreWith();
    expect(report.unknownEntries.map((entry) => entry.type)).toEqual(['future-entry']);
    expect(report.completeness).toBe('incomplete');
  });
});
