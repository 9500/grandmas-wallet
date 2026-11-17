import { type ChainReader, readControllerHistory } from '@grandmas-wallet/core';
import { readReceipt, readViewingKeyRecord, recoveryStatus, signMessage, signViewingKeyRecord, viewingKeyRecordHash } from '@grandmas-wallet/archive';
import type { SimulatedChain } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import {
  type KeptKit,
  checkEnrollment,
  checkHandOver,
  fromSignedJson,
  generateRecipientKeyPair,
  handOver,
  openPackage,
  readKit,
  readTakeover,
  readUpdate,
  receiptFor,
  recoveryKeyOf,
  saveTakeover,
  sealPackage,
  signKit,
  signTakeover,
  signUpdate,
  takeUpdate,
  toSignedJson,
} from '../src/index.js';
import { WORDS_B, WORDS_C, archiveAt, credential, hex, kitInput, otherCredential, ownerUpdate, seedOf, setup } from './setup.js';

/**
 * Acceptance test RC07 of the proposal: the order in which viewing keys are handed over in a recovery.
 * The new device's record reaches the recoverer before the request, without the device knowing the
 * identity; the earlier ones reach the new device only after completion.
 */

/** The simulated chain with nothing confirmed. */
const unconfirmed = (chain: SimulatedChain): ChainReader => ({
  getTransaction: (id) => chain.getTransaction(id),
  listUnspent: (script) => chain.listUnspent(script),
  getHistory: async (script) => (await chain.getHistory(script)).map((entry) => ({ ...entry, height: 0 })),
});

/** A wallet whose owner, seed A, has enrolled a recoverer; the recoverer has kept the kit and left its receipt. */
const enrolled = async () => {
  const made = setup();
  const read = readKit(signKit(kitInput(made.wallet, made.seedA), made.seedA.controllerKey), 'testnet');
  const checked = await checkEnrollment(read, made.chain);
  const recoveryKey = recoveryKeyOf(checked.kept.kit);
  const { kept } = receiptFor(checked.kept, recoveryKey);
  return { ...made, kept, recoveryKey };
};

/** What a new device makes from nothing but its own new seed. */
const newDevice = async (words: string) => {
  const seed = seedOf(words);
  const answer = await generateRecipientKeyPair();
  const archive = archiveAt(0x50);
  const takeover = signTakeover(seed, archive, answer.publicKey);
  return { seed, answer, archive, takeover, record: signViewingKeyRecord(seed) };
};

describe('handing over viewing keys in a recovery', () => {
  it('RC07: the new device\'s record reaches the recoverer before the request, and the device does not know the identity', async () => {
    const { chain, wallet, seedA, kept, recoveryKey, identity } = await enrolled();
    // The new device has its seed and nothing else: no identity, no creating transaction, no earlier key.
    const device = await newDevice(WORDS_B);
    for (const unknown of [identity, wallet.genesisTransactionId, kept.viewingKeyRecords[0]?.publicKey ?? 'no earlier record', hex(seedA.viewingKey.blindingSeed)]) expect(device.takeover.message).not.toContain(unknown);
    const stated = JSON.parse(device.takeover.message) as Record<string, unknown>;
    expect(Object.keys(stated).sort()).toEqual(['answerKey', 'archive', 'format', 'network', 'proposedKeyHash', 'version', 'viewingKeyRecord']);

    // It goes to the recoverer sealed. The recoverer checks that it holds together and saves it.
    const recoverer = await generateRecipientKeyPair();
    const read = readTakeover(await openPackage(await sealPackage(device.takeover, recoverer.publicKey), recoverer.privateKey), 'testnet');
    expect(read.viewingKey.viewingKey).toEqual(device.seed.viewingKey);
    const saved = saveTakeover(kept, read);
    expect(saved.pending).toMatchObject({ messageHash: read.hash, proposedKeyHash: hex(device.seed.controllerKey.keyHash), archive: device.archive });
    expect(saved.pending?.viewingKeyRecord).toEqual(toSignedJson(device.record));

    // All of that before anything is on chain: the controller has no request yet.
    expect((await readControllerHistory(chain, wallet.identity)).transitions).toHaveLength(0);
    // The request then names the key whose record the recoverer holds.
    wallet.requestRecovery(recoveryKey, device.seed.controllerKey.keyHash);
    expect(hex(wallet.controller().state.proposedOwnerKeyHash ?? new Uint8Array())).toBe(saved.pending?.proposedKeyHash);
  });

  it('RC07: a takeover message that does not hold together is refused', async () => {
    const device = await newDevice(WORDS_B);
    const other = seedOf(WORDS_C);
    expect(() => readTakeover(device.takeover, 'mainnet')).toThrow('The takeover message is for testnet, not for mainnet.');
    expect(() => readTakeover({ ...device.takeover, message: device.takeover.message.replace('store1', 'store9') }, 'testnet')).toThrow('The takeover message\'s signature is not valid.');
    // It proposes one key and is signed by another.
    const stolen = signMessage('grandmas-wallet/takeover/v1', device.takeover.message, other.controllerKey);
    expect(() => readTakeover(stolen, 'testnet')).toThrow('The takeover message is not signed by the key it proposes.');
    // It proposes its own key and carries the viewing-key record of another seed.
    const text = JSON.parse(signTakeover(other, device.archive, device.answer.publicKey).message) as Record<string, unknown>;
    const mixed = signMessage('grandmas-wallet/takeover/v1', JSON.stringify({ ...text, viewingKeyRecord: toSignedJson(device.record) }), other.controllerKey);
    expect(() => readTakeover(mixed, 'testnet')).toThrow('The viewing-key record is not of the seed whose key the takeover message proposes.');
  });

  it('RC07: the earlier viewing keys are not handed over before the recovery is complete', async () => {
    const { chain, wallet, seedA, kept, recoveryKey } = await enrolled();
    const device = await newDevice(WORDS_B);
    // Without a saved takeover message there is no one to hand over to.
    await expect(handOver(kept, chain, recoveryKey)).rejects.toThrow('No takeover message has been saved for this wallet.');
    const saved = saveTakeover(kept, readTakeover(device.takeover, 'testnet'));
    const refusal = 'The proposed key is not the owner on chain. The earlier viewing keys are handed over only after the recovery is complete.';
    // Before the request; while the request waits; after the owner has cancelled it.
    await expect(handOver(saved, chain, recoveryKey)).rejects.toThrow(refusal);
    wallet.requestRecovery(recoveryKey, device.seed.controllerKey.keyHash);
    await expect(handOver(saved, chain, recoveryKey)).rejects.toThrow(refusal);
    wallet.authorize(seedA.controllerKey);
    await expect(handOver(saved, chain, recoveryKey)).rejects.toThrow(refusal);
    // A completion for another key than the one in the saved message.
    wallet.recover(recoveryKey, seedOf(WORDS_C).controllerKey);
    await expect(handOver(saved, chain, recoveryKey)).rejects.toThrow(refusal);
  });

  it('RC07: a completion that is not confirmed yet hands nothing over', async () => {
    const { chain, wallet, kept, recoveryKey } = await enrolled();
    const device = await newDevice(WORDS_B);
    const saved = saveTakeover(kept, readTakeover(device.takeover, 'testnet'));
    wallet.recover(recoveryKey, device.seed.controllerKey);
    await expect(handOver(saved, unconfirmed(chain), recoveryKey)).rejects.toThrow('The completion is not confirmed yet.');
  });

  it('RC07: after completion the earlier viewing keys reach the new device, sealed to its own key, and recovery is on again', async () => {
    const { chain, wallet, seedA, kept, recoveryKey, identity } = await enrolled();
    const device = await newDevice(WORDS_B);
    const takeover = readTakeover(device.takeover, 'testnet');
    const saved = saveTakeover(kept, takeover);
    wallet.recover(recoveryKey, device.seed.controllerKey);

    const handed = await handOver(saved, chain, recoveryKey);
    expect(handed.answerKey).toEqual(device.answer.publicKey);
    // Sealed to the key the device named in its takeover message: no one else reads the earlier viewing keys.
    const sealed = await sealPackage(handed.handOver, handed.answerKey);
    const observer = await generateRecipientKeyPair();
    await expect(openPackage(sealed, observer.privateKey)).rejects.toThrow('cannot be opened with this key');
    expect(Buffer.from(sealed).toString('latin1')).not.toContain(identity);

    // The device learns the identity here, and checks everything against the chain itself.
    const own = { controllerKeyHash: device.seed.controllerKey.keyHash, viewingKeyRecordHash: viewingKeyRecordHash(device.record), takeoverHash: takeover.hash };
    const checked = await checkHandOver(await openPackage(sealed, device.answer.privateKey), chain, 'testnet', own);
    expect(checked.identity).toBe(identity);
    expect(checked.creationTransactionId).toBe(wallet.genesisTransactionId);
    expect(checked.earlier.map((entry) => entry.record.viewingKey)).toEqual([seedA.viewingKey]);
    expect(checked.archives).toEqual([archiveAt(0x30)]);
    expect(checked.missing).toEqual([]);
    // The recoverer's receipt names the device's record and its takeover message: recovery is on, with no second enrollment.
    expect(readReceipt(checked.receipt, 'testnet')).toMatchObject({ answers: takeover.hash, recoveryKeyHash: hex(recoveryKey.keyHash) });
    expect(readReceipt(checked.receipt, 'testnet').viewingKeyRecords).toContain(own.viewingKeyRecordHash);
    expect(checked.recovery).toMatchObject({ on: true, reasons: [] });

    // The recoverer now keeps both records, the current seed's last, and both archives; nothing is pending.
    expect(handed.kept.viewingKeyRecords.map((record) => hex(readViewingKeyRecord(fromSignedJson(record, 'record'), 'testnet').controllerPublicKey))).toEqual([hex(seedA.controllerKey.publicKey), hex(device.seed.controllerKey.publicKey)]);
    expect(handed.kept.archives).toEqual([archiveAt(0x30), device.archive]);
    expect(handed.kept.pending).toBeUndefined();
    expect(handed.kept.latestReceiptHash).toBe(readReceipt(handed.receipt, 'testnet').hash);
  });

  it('RC07: a hand-over that lacks an earlier viewing key says so; one from someone else, or for another device, is refused', async () => {
    const { chain, wallet, kept, recoveryKey } = await enrolled();
    const device = await newDevice(WORDS_B);
    const takeover = readTakeover(device.takeover, 'testnet');
    wallet.recover(recoveryKey, device.seed.controllerKey);
    const own = { controllerKeyHash: device.seed.controllerKey.keyHash, viewingKeyRecordHash: viewingKeyRecordHash(device.record), takeoverHash: takeover.hash };

    // A recoverer that has lost the earlier record: the device reports what is missing, not an empty wallet.
    const lost: KeptKit = { ...saveTakeover(kept, takeover), viewingKeyRecords: [] };
    const thin = await checkHandOver((await handOver(lost, chain, recoveryKey)).handOver, chain, 'testnet', own);
    expect(thin.earlier).toEqual([]);
    expect(thin.missing).toEqual(['The viewing key of the seed that owned the wallet in epoch 0 was not handed over: coins at its addresses cannot be found.']);

    // A record of a seed that never owned the wallet is not taken as an earlier one.
    const padded: KeptKit = { ...saveTakeover(kept, takeover), viewingKeyRecords: [toSignedJson(signViewingKeyRecord(seedOf(WORDS_C)))] };
    const strange = await checkHandOver((await handOver(padded, chain, recoveryKey)).handOver, chain, 'testnet', own);
    expect(strange.earlier).toEqual([]);
    expect(strange.missing).toHaveLength(1);

    // Signed with a key that is not the wallet's recoverer.
    const genuine = await handOver(saveTakeover(kept, takeover), chain, recoveryKey);
    const forged = signMessage('grandmas-wallet/hand-over/v1', genuine.handOver.message, otherCredential.recoveryKey);
    await expect(checkHandOver(forged, chain, 'testnet', own)).rejects.toThrow('The hand-over is not signed by the wallet\'s recoverer.');
    // Read by a device whose key is not the owner.
    const bystander = seedOf(WORDS_C);
    await expect(checkHandOver(genuine.handOver, chain, 'testnet', { ...own, controllerKeyHash: bystander.controllerKey.keyHash })).rejects.toThrow('This device\'s key is not the owner of the wallet the hand-over names.');
    // Changed on the way.
    await expect(checkHandOver({ ...genuine.handOver, message: genuine.handOver.message.replace('store1', 'store9') }, chain, 'testnet', own)).rejects.toThrow('The hand-over\'s signature is not valid.');
  });
});

describe('a move to a new seed while the old device works', () => {
  it('the update message reaches the recoverer first; its prepared receipt counts once the owner\'s change is confirmed', async () => {
    const { chain, wallet, seedA, kept, recoveryKey, identity } = await enrolled();
    const seedB = seedOf(WORDS_B);
    const record = signViewingKeyRecord(seedB);
    const signed = signUpdate({ network: 'testnet', identity, newSeed: { proposedKeyHash: hex(seedB.controllerKey.keyHash), viewingKeyRecord: toSignedJson(record), archive: archiveAt(0x50) } }, seedA.controllerKey);
    const update = readUpdate(signed, 'testnet');

    // Signed by anyone but the owner on chain, it is refused.
    const stranger = seedOf(WORDS_C);
    const forged = readUpdate(signUpdate(update.update, stranger.controllerKey), 'testnet');
    await expect(takeUpdate(kept, forged, chain)).rejects.toThrow('The update message is not signed by the key that owns the wallet on chain.');

    const taken = await takeUpdate(kept, update, chain);
    expect(taken.kept.viewingKeyRecords).toHaveLength(2);
    const { receipt } = receiptFor(taken.kept, recoveryKey, taken.prepared);
    const sent = { messageHash: update.hash, viewingKeyRecordHash: viewingKeyRecordHash(record), recoveryKeyHash: hex(credential.recoveryKey.keyHash), ownerKeyHash: hex(seedB.controllerKey.keyHash) };
    expect(recoveryStatus([receipt], sent, await readControllerHistory(chain, wallet.identity), 'testnet').on).toBe(false);
    ownerUpdate(chain, wallet, seedA.controllerKey, { ownerKeyHash: seedB.controllerKey.keyHash });
    expect(recoveryStatus([receipt], sent, await readControllerHistory(chain, wallet.identity), 'testnet')).toMatchObject({ on: true, reasons: [] });
  });
});
