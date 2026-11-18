import { binToHex, decodeBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import { Archive, MemoryStore, readArchive, readReceipt, recoveryStatus, signViewingKeyRecord, viewingKeyRecordHash } from '@grandmas-wallet/archive';
import { readControllerHistory } from '@grandmas-wallet/core';
import { SimulatedChain } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import {
  ENROLLMENT_LINK_BUDGET,
  checkEnrollment,
  credentialKeys,
  decodeEnrollment,
  encodeEnrollment,
  enrollmentLink,
  envelopeFromLink,
  generateRecipientKeyPair,
  openEnrollment,
  readKit,
  receiptFor,
  recoveryKeyOf,
  sealEnrollment,
  signKit,
  toSignedJson,
  viewingKeyRecordsIn,
} from '../src/index.js';
import { CREDENTIAL_WORDS, DELAY, OTHER_CREDENTIAL_WORDS, RECOVERER_PAGE, WORDS_B, WORDS_C, archiveAt, credential, hex, kitInput, otherCredential, ownerUpdate, seedOf, setup, templates } from './setup.js';

/**
 * Acceptance tests RC01, RC02 and RC11 of the proposal: the enrollment message on its way, the recoverer's
 * check of it against the chain, and a kit for a new recoverer that refers to sealed records.
 */

describe('the enrollment message on its way', () => {
  it('RC01: someone who records the link or the QR code reads nothing', async () => {
    const { wallet, seedA, identity } = setup();
    const recoverer = await generateRecipientKeyPair();
    const signed = signKit(kitInput(wallet, seedA), seedA.controllerKey);
    const envelope = await sealEnrollment(signed, 'testnet', recoverer.publicKey);
    const link = enrollmentLink(RECOVERER_PAGE, envelope);

    // The kit is in the part of the link that browsers do not send to servers.
    expect(link.startsWith(`${RECOVERER_PAGE}#enroll=`)).toBe(true);
    const recorded = envelopeFromLink(link);
    expect(recorded).toEqual(envelope);
    // Nothing of what the kit holds shows in the recorded bytes: not the credential, the identity, the viewing key or the content key.
    const entropy = decodeBip39Mnemonic(CREDENTIAL_WORDS) as Uint8Array;
    const secrets = [entropy, hexToBin(identity), seedA.viewingKey.blindingSeed, hexToBin(archiveAt(0x30).contentKey), seedA.controllerKey.publicKey.slice(1), credential.recoveryKey.keyHash];
    for (const secret of secrets) expect(binToHex(recorded)).not.toContain(binToHex(secret));
    for (const word of ['zoo', 'store1', 'recoverer.9500.cash', 'tpub']) expect(Buffer.from(recorded).toString('latin1')).not.toContain(word);
    // Another key opens nothing; sealing the same kit twice gives unrelated bytes.
    const observer = await generateRecipientKeyPair();
    await expect(openEnrollment(recorded, observer.privateKey, 'testnet')).rejects.toThrow('cannot be opened with this key');
    const again = await sealEnrollment(signed, 'testnet', recoverer.publicKey);
    expect(binToHex(again.slice(1, 33))).not.toBe(binToHex(envelope.slice(1, 33)));
    expect(binToHex(again.slice(-64))).not.toBe(binToHex(envelope.slice(-64)));

    // The recoverer opens it and has the kit the owner signed.
    const opened = await openEnrollment(recorded, recoverer.privateKey, 'testnet');
    expect(opened.signed).toEqual(signed);
    expect(opened.kit.credential).toEqual({ words: CREDENTIAL_WORDS });
    expect(opened.kit.policy).toEqual({ ownerKeyHash: hex(seedA.controllerKey.keyHash), recovererKeyHash: hex(credential.recoveryKey.keyHash), challengeDelay: DELAY, recipient: 'recoverer.9500.cash', madeAt: 1_794_950_000 });
    expect(opened.viewingKeys[0]?.record.viewingKey).toEqual(seedA.viewingKey);
    expect(credentialKeys(CREDENTIAL_WORDS, 'testnet', templates)).toEqual(credential);
  });

  it('RC01: a message altered in transit is refused', async () => {
    const { wallet, seedA } = setup();
    const recoverer = await generateRecipientKeyPair();
    const signed = signKit(kitInput(wallet, seedA), seedA.controllerKey);
    const envelope = await sealEnrollment(signed, 'testnet', recoverer.publicKey);
    // Any byte of the sealed message: the version, the part that opens it, the content, the tag.
    for (const position of [0, 5, 40, 200, envelope.length - 1]) {
      const altered = envelope.slice();
      altered[position] = (altered[position] ?? 0) ^ 0x01;
      await expect(openEnrollment(altered, recoverer.privateKey, 'testnet')).rejects.toThrow(/cannot be opened with this key|not supported/);
    }
    await expect(openEnrollment(envelope.slice(0, 20), recoverer.privateKey, 'testnet')).rejects.toThrow(/incomplete/);
    expect(() => envelopeFromLink(`${RECOVERER_PAGE}#enroll=not*base64`)).toThrow(/damaged/);
    expect(() => envelopeFromLink(RECOVERER_PAGE)).toThrow(/carries no enrollment package/);

    // Altered before sealing, by someone who could seal it again: the owner's signature no longer fits.
    const plain = encodeEnrollment(signed, 'testnet');
    for (const position of [10, 70, 400, 700, plain.length - 80, plain.length - 1]) {
      const altered = plain.slice();
      altered[position] = (altered[position] ?? 0) ^ 0x01;
      expect(() => decodeEnrollment(altered, 'testnet'), `byte ${position}`).toThrow();
    }
    expect(() => decodeEnrollment(Uint8Array.from([...plain, 0]), 'testnet')).toThrow(/something after its end/);
    expect(decodeEnrollment(plain, 'testnet')).toEqual(signed);
  });

  it('RC01: the whole link, as text, fits a QR code that a phone reads', async () => {
    const { wallet, seedA } = setup();
    const recoverer = await generateRecipientKeyPair();
    const signed = signKit(kitInput(wallet, seedA), seedA.controllerKey);
    const plain = encodeEnrollment(signed, 'testnet');
    const envelope = await sealEnrollment(signed, 'testnet', recoverer.publicKey);
    const link = enrollmentLink(RECOVERER_PAGE, envelope);
    // What is measured is the link as a phone has to read it: sealing and encoding included.
    expect(plain.length).toBe(915);
    expect(envelope.length).toBe(plain.length + 49);
    expect(link.length).toBe(1_322);
    expect(link.length).toBeLessThanOrEqual(ENROLLMENT_LINK_BUDGET);
    // The budget is a code of version 27, well below the largest code's 2,953 bytes.
    expect(ENROLLMENT_LINK_BUDGET).toBe(1_465);
    // The kit's own text, signed and written as text, would be more than twice that.
    expect(JSON.stringify(toSignedJson(signed)).length).toBeGreaterThan(2 * link.length);
  });
});

describe('the recoverer\'s check against the chain', () => {
  const sent = async (change: Parameters<typeof kitInput>[2] = {}, signer?: ReturnType<typeof seedOf>) => {
    const made = setup();
    const signed = signKit(kitInput(made.wallet, signer ?? made.seedA, change), (signer ?? made.seedA).controllerKey);
    return { ...made, signed };
  };

  it('RC02: a genuine message is accepted, and the recoverer leaves a receipt that names it', async () => {
    const { chain, wallet, seedA, signed } = await sent();
    const read = readKit(signed, 'testnet');
    const checked = await checkEnrollment(read, chain);
    expect(checked.prepared).toBeUndefined();
    const recoveryKey = recoveryKeyOf(checked.kept.kit);
    expect(recoveryKey).toEqual(credential.recoveryKey);
    const { receipt, kept } = receiptFor(checked.kept, recoveryKey);
    const record = viewingKeyRecordHash(signViewingKeyRecord(seedA));
    expect(readReceipt(receipt, 'testnet')).toMatchObject({ identity: wallet.identityHex, answers: read.hash, viewingKeyRecords: [record], recoveryKeyHash: hex(credential.recoveryKey.keyHash) });
    expect(kept.latestReceiptHash).toBe(readReceipt(receipt, 'testnet').hash);
    // The wallet finds the receipt and says that recovery is on.
    const history = await readControllerHistory(chain, wallet.identity);
    const status = recoveryStatus([receipt], { messageHash: read.hash, viewingKeyRecordHash: record, recoveryKeyHash: hex(credential.recoveryKey.keyHash), ownerKeyHash: hex(seedA.controllerKey.keyHash) }, history, 'testnet');
    expect(status.on).toBe(true);
  });

  it('RC02: a message for another network is refused', async () => {
    const { signed } = await sent();
    const recoverer = await generateRecipientKeyPair();
    expect(() => readKit(signed, 'mainnet')).toThrow('The kit is for testnet, not for mainnet.');
    await expect(openEnrollment(await sealEnrollment(signed, 'testnet', recoverer.publicKey), recoverer.privateKey, 'mainnet')).rejects.toThrow('The kit is for testnet, not for mainnet.');
  });

  it('RC02: a message that was changed, or that is not signed by the owner, is refused', async () => {
    const { chain, wallet, seedA, signed } = await sent();
    // Changed after signing: another store, another credential.
    expect(() => readKit({ ...signed, message: signed.message.replace('store1', 'store9') }, 'testnet')).toThrow('The kit\'s signature is not valid.');
    expect(() => readKit({ ...signed, message: signed.message.replace(CREDENTIAL_WORDS, OTHER_CREDENTIAL_WORDS) }, 'testnet')).toThrow('The kit\'s signature is not valid.');
    // Signed by someone else, over the owner's text.
    const stranger = seedOf(WORDS_C);
    expect(() => readKit({ ...signed, publicKey: stranger.controllerKey.publicKey }, 'testnet')).toThrow('The kit\'s signature is not valid.');
    // A whole kit made and signed by someone else, for the owner's wallet: it holds together, and the chain names another owner.
    const forged = readKit(signKit(kitInput(wallet, stranger), stranger.controllerKey), 'testnet');
    await expect(checkEnrollment(forged, chain)).rejects.toThrow('The message is not signed by the key that owns the wallet on chain.');
    // Signed by the owner, carrying someone else's viewing-key record.
    const mixed = readKit(signKit(kitInput(wallet, seedA, { viewingKeyRecords: [toSignedJson(signViewingKeyRecord(stranger))] }), seedA.controllerKey), 'testnet');
    await expect(checkEnrollment(mixed, chain)).rejects.toThrow('The viewing-key record of the current seed is not signed by the key that signed the message.');
  });

  it('RC02: a message for a wallet that is not on chain is refused', async () => {
    const { wallet, seedA, signed } = await sent();
    // The servers know nothing of this wallet.
    await expect(checkEnrollment(readKit(signed, 'testnet'), new SimulatedChain())).rejects.toThrow(/The wallet is not on chain as the message describes it/);
    // The identity exists, created by another transaction than the one named.
    const { chain } = setup();
    const elsewhere = readKit(signKit(kitInput(wallet, seedA, { creationTransactionId: 'ab'.repeat(32) }), seedA.controllerKey), 'testnet');
    await expect(checkEnrollment(elsewhere, chain)).rejects.toThrow(/The wallet is not on chain as the message describes it/);
  });

  it('RC02: a message that does not match the controller\'s state is refused', async () => {
    // The credential is not the recoverer the controller names.
    const other = await sent({ credential: { words: OTHER_CREDENTIAL_WORDS } });
    await expect(checkEnrollment(readKit(other.signed, 'testnet'), other.chain)).rejects.toThrow('The credential\'s recovery key is not the recoverer the controller names.');
    const held = await sent({ credential: { heldByRecoverer: true, recoveryKeyHash: hex(otherCredential.recoveryKey.keyHash) } });
    await expect(checkEnrollment(readKit(held.signed, 'testnet'), held.chain)).rejects.toThrow('The credential\'s recovery key is not the recoverer the controller names.');
    // The waiting period on chain is not the one the message states.
    const delay = await sent({ policy: { challengeDelay: { unit: 'time512', value: 100 }, recipient: 'recoverer.9500.cash', madeAt: 1_794_950_000 } });
    await expect(checkEnrollment(readKit(delay.signed, 'testnet'), delay.chain)).rejects.toThrow('The waiting period on chain is not the one the message states.');
    // The wallet has gone to another owner since the message was made; or the owner has closed it.
    const moved = await sent();
    moved.wallet.recover(credential.recoveryKey, seedOf(WORDS_B).controllerKey);
    await expect(checkEnrollment(readKit(moved.signed, 'testnet'), moved.chain)).rejects.toThrow('The message is not signed by the key that owns the wallet on chain.');
    const closed = await sent();
    closed.wallet.close(closed.seedA.controllerKey);
    await expect(checkEnrollment(readKit(closed.signed, 'testnet'), closed.chain)).rejects.toThrow('The wallet has been closed by its owner.');
    // A recoverer that holds its own key is named by its hash; with the right hash the message is accepted.
    const own = await sent({ credential: { heldByRecoverer: true, recoveryKeyHash: hex(credential.recoveryKey.keyHash) } });
    const checked = await checkEnrollment(readKit(own.signed, 'testnet'), own.chain);
    expect(() => recoveryKeyOf(checked.kept.kit)).toThrow(/holds its own key/);
    expect(recoveryKeyOf(checked.kept.kit, credential.recoveryKey)).toEqual(credential.recoveryKey);
  });
});

describe('a kit for a new recoverer', () => {
  it('RC11: the viewing keys of several seeds are delivered by reference; the recoverer confirms only after it has fetched and saved them', async () => {
    // The wallet has had two seeds: A, then B after a recovery. B now names a new recoverer.
    const { chain, wallet, seedA } = setup();
    const seedB = seedOf(WORDS_B);
    wallet.recover(credential.recoveryKey, seedB.controllerKey);
    const records = [signViewingKeyRecord(seedB), signViewingKeyRecord(seedA)];
    const hashes = records.map((record) => viewingKeyRecordHash(record));

    // The records are sealed on the stores of B's archive; the kit names them by their hashes.
    const access = archiveAt(0x50);
    const stores = [new MemoryStore('store one'), new MemoryStore('store two')];
    const archive = new Archive(hexToBin(access.archiveId), hexToBin(access.contentKey), stores);
    for (const record of records) await archive.write({ type: 'viewing-key', signed: record });
    const signed = signKit(
      kitInput(wallet, seedB, { credential: { words: OTHER_CREDENTIAL_WORDS }, viewingKeyRecords: hashes.map((reference) => ({ reference })), archives: [access, archiveAt(0x30)] }),
      seedB.controllerKey,
    );
    const newRecoverer = await generateRecipientKeyPair();
    const link = enrollmentLink(RECOVERER_PAGE, await sealEnrollment(signed, 'testnet', newRecoverer.publicKey));
    // A kit that has grown is not sent as one large code: by reference it is smaller than the first one was.
    expect(link.length).toBe(1_171);
    expect(link.length).toBeLessThanOrEqual(ENROLLMENT_LINK_BUDGET);

    const read = await openEnrollment(envelopeFromLink(link), newRecoverer.privateKey, 'testnet');
    expect(read.references).toEqual(hashes);
    expect(read.viewingKeys).toEqual([]);
    // A reference is not the thing itself: before the records are fetched, the kit cannot be confirmed.
    await expect(checkEnrollment(read, chain, { forNewRecoverer: true })).rejects.toThrow(/refers to 2 viewing-key records that have not been fetched and saved/);
    // One of two is not enough.
    await expect(checkEnrollment(read, chain, { forNewRecoverer: true, fetched: [records[1] as (typeof records)[number]] })).rejects.toThrow(/refers to 1 viewing-key record that has not been fetched and saved/);
    // A record that is not the one referred to does not stand in for it.
    await expect(checkEnrollment(read, chain, { forNewRecoverer: true, fetched: [signViewingKeyRecord(seedOf(WORDS_C)), records[1] as (typeof records)[number]] })).rejects.toThrow(/has not been fetched and saved/);

    // It fetches them from the stores with the access the kit gives; one store being out of reach does not stop it.
    (stores[0] as MemoryStore).unreachable = true;
    const contents = await readArchive(hexToBin(read.kit.archives[0]?.archiveId ?? ''), hexToBin(read.kit.archives[0]?.contentKey ?? ''), stores);
    const checked = await checkEnrollment(read, chain, { forNewRecoverer: true, fetched: viewingKeyRecordsIn(contents) });
    // It has saved both records, the current seed's last, and the access to both archives.
    expect(checked.kept.viewingKeyRecords.map((record) => viewingKeyRecordHash(record))).toEqual([hashes[1], hashes[0]]);
    expect(checked.kept.archives).toEqual([archiveAt(0x30), access]);

    // It is not yet the recoverer on chain. Its receipt is a prepared one, signed with the key that is to be installed.
    const newKey = recoveryKeyOf(checked.kept.kit);
    expect(newKey).toEqual(otherCredential.recoveryKey);
    const { receipt } = receiptFor(checked.kept, newKey, checked.prepared);
    const named = readReceipt(receipt, 'testnet');
    expect([...named.viewingKeyRecords].sort()).toEqual([...hashes].sort());
    expect(named.prepared?.controllerOutput.transactionId).toBe(hex(wallet.controller().utxo.transactionHash));
    const sentByOwner = { messageHash: read.hash, viewingKeyRecordHash: hashes[0] as string, recoveryKeyHash: hex(otherCredential.recoveryKey.keyHash), ownerKeyHash: hex(seedB.controllerKey.keyHash) };
    const before = await readControllerHistory(chain, wallet.identity);
    expect(recoveryStatus([receipt], sentByOwner, before, 'testnet').on).toBe(false);
    // Only then does the owner make the change; as soon as the network shows it and it matches the receipt, recovery is on again.
    ownerUpdate(chain, wallet, seedB.controllerKey, { recovererKeyHash: otherCredential.recoveryKey.keyHash });
    expect(recoveryStatus([receipt], sentByOwner, await readControllerHistory(chain, wallet.identity), 'testnet').on).toBe(true);
    // The earlier recoverer's key no longer works on the controller.
    expect(() => wallet.requestRecovery(credential.recoveryKey, seedOf(WORDS_C).controllerKey.keyHash)).toThrow(/refused/);
  });

  it('RC11: a kit that carries a record of a seed that never owned the wallet is refused', async () => {
    const { chain, wallet, seedA } = setup();
    const stranger = seedOf(WORDS_C);
    const signed = signKit(kitInput(wallet, seedA, { viewingKeyRecords: [toSignedJson(signViewingKeyRecord(seedA)), toSignedJson(signViewingKeyRecord(stranger))] }), seedA.controllerKey);
    await expect(checkEnrollment(readKit(signed, 'testnet'), chain)).rejects.toThrow('The kit carries a viewing-key record of a seed that has never owned this wallet.');
  });
});
