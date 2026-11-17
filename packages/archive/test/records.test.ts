import { binToHex, utf8ToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';

import {
  type ArchiveStore,
  type Blob,
  Archive,
  MemoryStore,
  assessArchive,
  blobIdOf,
  contentHashOf,
  encodeBlob,
  generateArchiveId,
  generateContentKey,
  readArchive,
  receiptHash,
  restoreArchive,
  safelyStored,
  seal,
  signReceipt,
  signRecord,
  signViewingKeyRecord,
  templateEntry,
  templateStanding,
  viewingKeyRecordHash,
  viewingKeysInForce,
} from '../src/index.js';
import { WORDS_B, WORDS_C, credential, hex, seedOf, setup } from './setup.js';

/**
 * Acceptance tests BK01, BK02, BK03, BK07 and BK08 of the proposal: the sealed records on backup stores,
 * who can make one that counts, and what a reader says when it cannot rely on what it was given.
 */

const TEMPLATE_TEXT = '{"name":"Savings Jar","version":"1","actions":{"open":{},"withdraw":{}}}';
const TEMPLATE_ID = 'e1'.repeat(32);
const DECLARATION = '{"authority":[{"name":"jar key","finds":"companion"}]}';
const MESSAGE = 'aa'.repeat(32);

/** A wallet with an archive on two stores: its viewing-key record, a template, a token note, a label, and the recoverer's receipt. */
const start = async () => {
  const made = setup();
  const archiveId = generateArchiveId();
  const contentKey = generateContentKey();
  const stores = [new MemoryStore('store one'), new MemoryStore('store two')] as const;
  const archive = new Archive(archiveId, contentKey, [...stores]);
  const owning = { network: 'testnet' as const, identity: made.identity };
  const viewingKey = signViewingKeyRecord(made.seedA);
  const template = signRecord(templateEntry(TEMPLATE_ID, TEMPLATE_TEXT, DECLARATION), owning, made.seedA.controllerKey);
  const receipt = signReceipt(
    { network: 'testnet', identity: made.identity, answers: MESSAGE, viewingKeyRecords: [viewingKeyRecordHash(viewingKey)], recoveryKeyHash: hex(credential.recoveryKey.keyHash) },
    credential.recoveryKey,
  );
  await archive.write({ type: 'viewing-key', signed: viewingKey });
  const written = await archive.write({ type: 'record', signed: template });
  await archive.write({ type: 'record', signed: signRecord({ kind: 'token-note', category: 'c7'.repeat(32), templateIdentifier: TEMPLATE_ID, authority: 'jar key' }, owning, made.seedA.controllerKey) });
  await archive.write({ type: 'record', signed: signRecord({ kind: 'label', subject: 'c7'.repeat(32), name: 'Holiday jar' }, owning, made.seedA.controllerKey) });
  await archive.write({ type: 'receipt', signed: receipt });
  /** @param kept - the hash of the latest receipt the reader kept; `null` for a reader that kept none */
  const read = async (from: ArchiveStore[] = [...stores], kept: string | null = receiptHash(receipt)) =>
    restoreArchive(archiveId, contentKey, from, { network: 'testnet', history: await made.history(), ...(kept === null ? {} : { latestReceiptHash: kept }) });
  return { ...made, archiveId, contentKey, stores, archive, owning, viewingKey, template, receipt, written, read };
};

/** Seal a blob with the archive's content key and put it on a store, as anyone who holds that key can. */
const plant = async (store: MemoryStore, archiveId: Uint8Array, contentKey: Uint8Array, blob: Blob): Promise<string> => store.put(binToHex(archiveId), seal(contentKey, archiveId, encodeBlob(blob)));

describe('what a store holds', () => {
  it('BK01: a store, or someone who copies it, cannot read the records', async () => {
    const { stores, archiveId, contentKey, identity, seedA, read } = await start();
    const names = await stores[0].list(binToHex(archiveId));
    expect(names).toHaveLength(5);
    const secrets = [TEMPLATE_TEXT, 'Holiday jar', identity, binToHex(seedA.viewingKey.blindingSeed), seedA.viewingKey.addressNodes.givenOut, binToHex(credential.recoveryKey.keyHash)];
    for (const name of names) {
      const sealed = (await stores[0].get(binToHex(archiveId), name)) as Uint8Array;
      // A blob is named by the hash of its sealed bytes, and nothing of its content shows.
      expect(blobIdOf(sealed)).toBe(name);
      const asText = Buffer.from(sealed).toString('latin1');
      const asHex = binToHex(sealed);
      for (const secret of secrets) {
        expect(asText.includes(secret)).toBe(false);
        expect(asHex.includes(binToHex(utf8ToBin(secret)))).toBe(false);
      }
    }
    // The archive's identifier says nothing of whose it is.
    expect(binToHex(archiveId)).not.toContain(identity.slice(0, 16));
    // Sealing the same record twice gives unrelated blobs, so a store cannot tell that two are the same.
    const record = { type: 'viewing-key' as const, signed: signViewingKeyRecord(seedA) };
    expect(binToHex(seal(contentKey, archiveId, encodeBlob(record)))).not.toBe(binToHex(seal(contentKey, archiveId, encodeBlob(record))));
    // A copy of the store without the content key opens nothing.
    const copied = await readArchive(archiveId, generateContentKey(), [...stores]);
    expect(copied.blobs).toEqual([]);
    // Five records on each of two stores, and not one of them opens.
    expect(copied.problems).toHaveLength(10);
    expect(copied.problems[0]).toMatch(/cannot be read: The blob cannot be opened with this archive key/);
    // With the key, everything is there.
    expect((await read()).templates).toHaveLength(1);
  });
});

describe('stores that fail', () => {
  it('BK02: when one store fails, the other copy works', async () => {
    const { stores, read } = await start();
    stores[0].unreachable = true;
    const assessed = await read();
    expect(assessed.templates[0]?.entry.text).toBe(TEMPLATE_TEXT);
    expect(viewingKeysInForce(assessed)).toHaveLength(1);
    expect(assessed.currency).toBe('current');
    // The failure is said, not passed over.
    expect(assessed.notices).toEqual(['store one did not answer: store one cannot be reached']);
  });

  it('BK02: damaged content is refused, and the other copy supplies it', async () => {
    const { stores, archiveId, written, read } = await start();
    const id = binToHex(archiveId);
    const good = (await stores[0].get(id, written.blobId)) as Uint8Array;
    const damaged = good.slice();
    damaged[40] = (damaged[40] ?? 0) ^ 0xff;
    stores[0].tamper(id, written.blobId, damaged);
    const assessed = await read();
    expect(assessed.templates).toHaveLength(1);
    expect(assessed.notices).toEqual([`store one returned damaged data for record ${written.blobId.slice(0, 12)}…; it is refused.`]);
    // Damaged on both: the record is not there, and nothing damaged was taken in.
    stores[1].tamper(id, written.blobId, damaged);
    const both = await read();
    expect(both.templates).toEqual([]);
    expect(both.notices.filter((notice) => notice.includes('returned damaged data'))).toHaveLength(2);
    // A blob that a store dropped is supplied by the other, too.
    stores[1].tamper(id, written.blobId, good);
    stores[0].tamper(id, written.blobId, undefined);
    expect((await read()).templates).toHaveLength(1);
  });

  it('BK02: a write counts only where a store confirmed it, and a store is filled again from the device\'s copy', async () => {
    const { stores, archive, archiveId, owning, seedA, read } = await start();
    stores[1].unreachable = true;
    const record = signRecord({ kind: 'label', subject: 'ab'.repeat(32), name: 'Rent' }, owning, seedA.controllerKey);
    const result = await archive.write({ type: 'record', signed: record });
    expect(result.confirmedBy).toEqual(['store one']);
    expect(result.failed).toEqual([{ store: 'store two', reason: 'store two cannot be reached' }]);
    expect(safelyStored(result)).toBe(true);
    stores[0].unreachable = true;
    const nowhere = await archive.write({ type: 'record', signed: signRecord({ kind: 'label', subject: 'cd'.repeat(32), name: 'Car' }, owning, seedA.controllerKey) });
    // The device's own copy is not a store: nothing may come to depend on this record yet.
    expect(safelyStored(nowhere)).toBe(false);
    // A new store is filled from the device's copy, without the old ones taking part.
    const fresh = new MemoryStore('store three');
    const filled = await archive.fill(fresh);
    expect(filled.every(safelyStored)).toBe(true);
    expect(await fresh.list(binToHex(archiveId))).toHaveLength(7);
    expect((await read([fresh])).labels.map((label) => label.entry.name).sort()).toEqual(['Car', 'Holiday jar', 'Rent']);
  });
});

describe('who can make a record that counts', () => {
  it('BK03: a record made by a holder of the content key who is not an owner is refused', async () => {
    const { stores, archiveId, contentKey, owning, read } = await start();
    // The recoverer and a lost phone hold the content key. Here someone with it signs with a key of their own.
    const stranger = seedOf(WORDS_C);
    const forgedTemplate = signRecord(templateEntry('f0'.repeat(32), '{"name":"Give me everything"}'), owning, stranger.controllerKey);
    const forgedId = await plant(stores[0], archiveId, contentKey, { type: 'record', signed: forgedTemplate });
    const forgedKey = await plant(stores[0], archiveId, contentKey, { type: 'viewing-key', signed: signViewingKeyRecord(stranger) });
    // The recovery key holds the content key too; it does not make it an owner.
    const byRecoverer = await plant(stores[1], archiveId, contentKey, { type: 'record', signed: signRecord({ kind: 'label', subject: 'ab'.repeat(32), name: 'Mine now' }, owning, credential.recoveryKey) });

    const assessed = await read();
    expect(assessed.refused).toEqual(
      expect.arrayContaining([
        { blobId: forgedId, reason: 'The record is not signed by a key that has owned this wallet. Holding the content key does not make a record genuine.' },
        { blobId: forgedKey, reason: 'The viewing-key record is of a seed that has never owned this wallet.' },
        { blobId: byRecoverer, reason: 'The record is not signed by a key that has owned this wallet. Holding the content key does not make a record genuine.' },
      ]),
    );
    expect(assessed.refused).toHaveLength(3);
    expect(assessed.templates.map((template) => template.entry.identifier)).toEqual([TEMPLATE_ID]);
    expect(assessed.labels.map((label) => label.entry.name)).toEqual(['Holiday jar']);
    expect(viewingKeysInForce(assessed)).toHaveLength(1);
    expect(templateStanding(assessed, 'f0'.repeat(32), contentHashOf('{"name":"Give me everything"}'))).toEqual({ stored: false, trusted: false, signedBy: [] });
    expect(assessed.notices).toContain('3 records were refused.');
  });

  it('BK03: a record for another wallet, or one whose text was changed, is refused', async () => {
    const { stores, archiveId, contentKey, seedA, template, read } = await start();
    const elsewhere = await plant(stores[0], archiveId, contentKey, { type: 'record', signed: signRecord({ kind: 'label', subject: 'ab'.repeat(32), name: 'Other' }, { network: 'testnet', identity: 'cd'.repeat(32) }, seedA.controllerKey) });
    const altered = await plant(stores[0], archiveId, contentKey, { type: 'record', signed: { ...template, message: template.message.replace('Savings Jar', 'Savings Jug') } });
    const assessed = await read();
    expect(assessed.refused).toEqual(
      expect.arrayContaining([
        { blobId: elsewhere, reason: 'The record is for another wallet.' },
        { blobId: altered, reason: 'The record\'s template is not the text its hash names.' },
      ]),
    );
    expect(assessed.templates).toHaveLength(1);
  });

  it('a template is stored: by whom it was signed, and whether it is trusted', async () => {
    const { written, seedA, read } = await start();
    expect(written.confirmedBy).toEqual(['store one', 'store two']);
    expect(safelyStored(written)).toBe(true);
    const assessed = await read();
    const standing = templateStanding(assessed, TEMPLATE_ID, contentHashOf(TEMPLATE_TEXT));
    expect(standing).toEqual({ stored: true, trusted: true, signedBy: [hex(seedA.controllerKey.keyHash)], text: TEMPLATE_TEXT });
    expect(assessed.templates[0]?.entry.declaration).toEqual({ contentHash: contentHashOf(DECLARATION), text: DECLARATION });
    // The same identifier with another text is another template.
    expect(templateStanding(assessed, TEMPLATE_ID, contentHashOf(`${TEMPLATE_TEXT} `)).stored).toBe(false);
    expect(templateStanding(assessed, 'e2'.repeat(32), contentHashOf(TEMPLATE_TEXT)).stored).toBe(false);
    expect(assessed.tokenNotes[0]).toMatchObject({ entry: { category: 'c7'.repeat(32), templateIdentifier: TEMPLATE_ID, authority: 'jar key' }, standing: 'current owner' });
    expect(assessed.notices).toEqual([]);
  });
});

describe('records of an earlier seed', () => {
  it('BK07: a second viewing-key record does not replace the one the receipt names, and the conflict is reported', async () => {
    const { wallet, stores, archiveId, contentKey, seedA, history, identity, viewingKey } = await start();
    // A recovery: seed B owns the wallet now. The recoverer's receipt names A's record and B's.
    const seedB = seedOf(WORDS_B);
    wallet.recover(credential.recoveryKey, seedB.controllerKey);
    const latest = signReceipt(
      { network: 'testnet', identity, answers: 'bb'.repeat(32), viewingKeyRecords: [viewingKeyRecordHash(viewingKey), viewingKeyRecordHash(signViewingKeyRecord(seedB))], recoveryKeyHash: hex(credential.recoveryKey.keyHash) },
      credential.recoveryKey,
    );
    // Whoever holds the earlier seed signs a second record for it, with another blinding seed: genuine as to who signed.
    const second = signViewingKeyRecord({ ...seedA, viewingKey: { ...seedA.viewingKey, blindingSeed: new Uint8Array(32).fill(7) } });
    await plant(stores[0], archiveId, contentKey, { type: 'viewing-key', signed: second });

    // The new device reads the earlier archive, holding the receipt it was handed.
    const assessed = assessArchive(await readArchive(archiveId, contentKey, [...stores]), { network: 'testnet', history: await history(), latestReceipt: latest });
    expect(assessed.viewingKeys).toHaveLength(2);
    const inForce = viewingKeysInForce(assessed);
    expect(inForce).toHaveLength(1);
    expect(inForce[0]?.hash).toBe(viewingKeyRecordHash(viewingKey));
    expect(inForce[0]?.viewingKey.blindingSeed).toEqual(seedA.viewingKey.blindingSeed);
    expect(assessed.conflicts).toEqual([
      `2 different viewing-key records were found for the seed of key ${hex(seedA.controllerKey.keyHash).slice(0, 12)}…. The one the receipt names stays in force; the other does not replace it.`,
    ]);
    expect(assessed.notices).toEqual(expect.arrayContaining(assessed.conflicts));

    // Without a receipt that names either, neither is used: a wrong record would find nothing.
    const unnamed = assessArchive(await readArchive(archiveId, contentKey, [stores[0]]), {
      network: 'testnet',
      history: await history(),
      latestReceipt: signReceipt({ network: 'testnet', identity, answers: 'bb'.repeat(32), viewingKeyRecords: [], recoveryKeyHash: hex(credential.recoveryKey.keyHash) }, credential.recoveryKey),
    });
    expect(viewingKeysInForce(unnamed)).toEqual([]);
    expect(unnamed.conflicts[0]).toMatch(/The receipt names none of them, so none is used/);
  });

  it('BK07: a template record signed by an earlier seed after the recovery is not trusted on the new device', async () => {
    const { wallet, stores, archiveId, contentKey, seedA, history, owning, read } = await start();
    const seedB = seedOf(WORDS_B);
    wallet.recover(credential.recoveryKey, seedB.controllerKey);
    const lateText = '{"name":"Savings Jar","version":"2","actions":{"drain":{}}}';
    await plant(stores[1], archiveId, contentKey, { type: 'record', signed: signRecord(templateEntry('e9'.repeat(32), lateText), owning, seedA.controllerKey) });

    const assessed = await read();
    // Both of the earlier seed's templates are there as suggestions; neither is trusted because that seed says so.
    expect(assessed.templates.map((template) => template.standing)).toEqual(['earlier owner', 'earlier owner']);
    expect(templateStanding(assessed, 'e9'.repeat(32), contentHashOf(lateText))).toMatchObject({ stored: true, trusted: false, signedBy: [hex(seedA.controllerKey.keyHash)] });
    expect(templateStanding(assessed, TEMPLATE_ID, contentHashOf(TEMPLATE_TEXT)).trusted).toBe(false);
    expect(assessed.notices.filter((notice) => notice.includes('stored by an earlier seed'))).toHaveLength(2);
    // The new owner trusts a template by storing it under its own key.
    await plant(stores[1], archiveId, contentKey, { type: 'record', signed: signRecord(templateEntry(TEMPLATE_ID, TEMPLATE_TEXT), owning, seedB.controllerKey) });
    expect(templateStanding(await read(), TEMPLATE_ID, contentHashOf(TEMPLATE_TEXT))).toMatchObject({ stored: true, trusted: true });
    expect((await history()).owners).toHaveLength(2);
  });
});

describe('a store that hands back an older set', () => {
  it('BK08: it is noticed against the latest receipt, or reported as possibly out of date; never taken as current without notice', async () => {
    const { archive, archiveId, stores, owning, seedA, identity, viewingKey, receipt, read } = await start();
    // A copy of the store as it is now: once genuine.
    const stale = new MemoryStore('a stale store');
    await archive.fill(stale);
    // The wallet goes on: another template, and a newer receipt from the recoverer.
    const newText = '{"name":"Loan","version":"1"}';
    await archive.write({ type: 'record', signed: signRecord(templateEntry('ee'.repeat(32), newText), owning, seedA.controllerKey) });
    const newer = signReceipt({ network: 'testnet', identity, answers: 'bb'.repeat(32), viewingKeyRecords: [viewingKeyRecordHash(viewingKey)], recoveryKeyHash: hex(credential.recoveryKey.keyHash) }, credential.recoveryKey);
    await archive.write({ type: 'receipt', signed: newer });
    expect(await stale.list(binToHex(archiveId))).toHaveLength(5);

    // The device kept the hash of the latest receipt: the older set is noticed.
    const noticed = await read([stale], receiptHash(newer));
    expect(noticed.currency).toBe('older');
    expect(noticed.currentReceipt).toBeUndefined();
    expect(noticed.notices).toEqual(['The stores did not return the latest receipt this device knows of. They may have handed back an older set: the backup may be out of date.']);
    expect(viewingKeysInForce(noticed)).toEqual([]);
    expect(templateStanding(noticed, 'ee'.repeat(32), contentHashOf(newText)).stored).toBe(false);

    // A device that kept nothing cannot establish the newest set, and says so.
    const unknown = await read([stale], null);
    expect(unknown.currency).toBe('unknown');
    expect(unknown.notices).toEqual(['This device has kept no receipt to compare with, so it cannot tell whether the stores returned the newest set: the backup may be out of date.']);
    expect(unknown.currentReceipt?.hash).toBe(receiptHash(receipt));

    // With a store that has everything, the set is the current one, whatever the stale store adds.
    const current = await read([stale, ...stores], receiptHash(newer));
    expect(current.currency).toBe('current');
    expect(current.currentReceipt?.hash).toBe(receiptHash(newer));
    expect(current.notices).toEqual([]);
    expect(templateStanding(current, 'ee'.repeat(32), contentHashOf(newText)).stored).toBe(true);
    // The device's own copy is read like a store, and is complete.
    expect((await read([archive.localStore], receiptHash(newer))).currency).toBe('current');
    // A device that holds the earlier receipt only does not take two receipts for one.
    const two = await read([...stores], null);
    expect(two.currentReceipt).toBeUndefined();
    expect(two.conflicts).toEqual(['2 receipts of the current recoverer were found and nothing settles which is the latest; none is relied on.']);
  });
});
