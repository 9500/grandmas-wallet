import { encodeControllerState } from '@grandmas-wallet/core';
import { describe, expect, it } from 'vitest';

import { type ReceiptFields, type Sent, readReceipt, recoveryStatus, signReceipt, signViewingKeyRecord, viewingKeyRecordHash } from '../src/index.js';
import { WORDS_B, credential, hex, otherCredential, ownerUpdate, seedOf, setup, unconfirmed } from './setup.js';

/**
 * Acceptance tests RC04 and RC10 of the proposal: when the wallet may say that recovery is on.
 */

const MESSAGE = 'aa'.repeat(32);
const OTHER_MESSAGE = 'bb'.repeat(32);

const start = () => {
  const made = setup();
  const record = viewingKeyRecordHash(signViewingKeyRecord(made.seedA));
  const sent: Sent = { messageHash: MESSAGE, viewingKeyRecordHash: record, recoveryKeyHash: hex(credential.recoveryKey.keyHash), ownerKeyHash: hex(made.seedA.controllerKey.keyHash) };
  const fields: ReceiptFields = { network: 'testnet', identity: made.identity, answers: MESSAGE, viewingKeyRecords: [record], recoveryKeyHash: hex(credential.recoveryKey.keyHash) };
  return { ...made, record, sent, fields };
};

describe('a receipt for a kit that was sent', () => {
  it('RC04: with no receipt, recovery is not shown as on; with the right one it is', async () => {
    const { history, sent, fields } = start();
    expect(recoveryStatus([], sent, await history(), 'testnet')).toEqual({ on: false, reasons: ['The recoverer has left no receipt.'] });
    const receipt = signReceipt(fields, credential.recoveryKey);
    const status = recoveryStatus([receipt], sent, await history(), 'testnet');
    expect(status.on).toBe(true);
    expect(status.receipt?.hash).toBe(readReceipt(receipt, 'testnet').hash);
  });

  it('RC04: a receipt for another message does not count', async () => {
    const { history, sent, fields } = start();
    const status = recoveryStatus([signReceipt({ ...fields, answers: OTHER_MESSAGE }, credential.recoveryKey)], sent, await history(), 'testnet');
    expect(status).toEqual({ on: false, reasons: ['A receipt does not count: it answers another message than the one this wallet sent.'] });
  });

  it('RC04: a receipt without the recovery key does not count', async () => {
    const { history, sent, fields, seedA } = start();
    // Signed with another key and naming it; signed with another key while naming the recovery key; signed by the owner.
    const byOther = signReceipt({ ...fields, recoveryKeyHash: hex(otherCredential.recoveryKey.keyHash) }, otherCredential.recoveryKey);
    expect(recoveryStatus([byOther], sent, await history(), 'testnet').reasons).toEqual(['A receipt does not count: it is signed with another recovery key than the one this wallet named.']);
    const genuine = signReceipt(fields, credential.recoveryKey);
    const forged = { ...genuine, publicKey: otherCredential.recoveryKey.publicKey };
    expect(recoveryStatus([forged], sent, await history(), 'testnet').reasons).toEqual(['A receipt does not count: The receipt is not signed with the recovery key it names.']);
    expect(() => signReceipt(fields, seedA.controllerKey)).toThrow(/signed with the recovery key it names/);
    // A receipt whose text was changed after signing.
    const altered = { ...genuine, message: genuine.message.replace(MESSAGE, OTHER_MESSAGE) };
    expect(recoveryStatus([altered], sent, await history(), 'testnet').reasons).toEqual(['A receipt does not count: The receipt\'s signature is not valid.']);
    // A store's answer that something was uploaded is not a receipt: only a signed receipt is looked at.
    expect(recoveryStatus([altered, forged, genuine], sent, await history(), 'testnet').on).toBe(true);
  });

  it('RC04: a receipt that does not name this seed\'s viewing-key record, or is for another wallet, does not count', async () => {
    const { history, sent, fields } = start();
    const otherRecord = viewingKeyRecordHash(signViewingKeyRecord(seedOf(WORDS_B)));
    expect(recoveryStatus([signReceipt({ ...fields, viewingKeyRecords: [otherRecord] }, credential.recoveryKey)], sent, await history(), 'testnet').reasons[0]).toMatch(/does not name this seed's viewing-key record/);
    expect(recoveryStatus([signReceipt({ ...fields, identity: 'cd'.repeat(32) }, credential.recoveryKey)], sent, await history(), 'testnet').reasons[0]).toMatch(/for another wallet/);
    expect(recoveryStatus([signReceipt({ ...fields, network: 'mainnet' }, credential.recoveryKey)], sent, await history(), 'testnet').reasons[0]).toMatch(/for mainnet, not for testnet/);
  });

  it('RC04: a receipt that does not match the controller\'s state does not count', async () => {
    const { chain, wallet, history, sent, fields, seedA } = start();
    const receipt = signReceipt(fields, credential.recoveryKey);
    // The state counts as soon as the network shows it: a block is not waited for.
    expect(recoveryStatus([receipt], sent, await history(unconfirmed(chain)), 'testnet').on).toBe(true);
    expect(recoveryStatus([receipt], sent, await history(), 'testnet').on).toBe(true);
    // A request is pending: the receipt still stands, and the owner can cancel.
    wallet.requestRecovery(credential.recoveryKey, seedOf(WORDS_B).controllerKey.keyHash);
    expect(recoveryStatus([receipt], sent, await history(), 'testnet').on).toBe(true);
    // The owner has since named another recoverer.
    ownerUpdate(chain, wallet, seedA.controllerKey, { recovererKeyHash: otherCredential.recoveryKey.keyHash });
    expect(recoveryStatus([receipt], sent, await history(), 'testnet').reasons[0]).toMatch(/controller names another recoverer/);
  });

  it('RC04: after the wallet has gone to another owner, or was closed, the receipt does not count', async () => {
    const first = start();
    const receipt = signReceipt(first.fields, credential.recoveryKey);
    first.wallet.recover(credential.recoveryKey, seedOf(WORDS_B).controllerKey);
    expect(recoveryStatus([receipt], first.sent, await first.history(), 'testnet').reasons[0]).toMatch(/controller names another owner than this device/);
    const second = start();
    second.wallet.close(second.seedA.controllerKey);
    expect(recoveryStatus([signReceipt(second.fields, credential.recoveryKey)], second.sent, await second.history(), 'testnet').reasons[0]).toMatch(/wallet is closed/);
  });
});

describe('a prepared receipt', () => {
  /** The owner is about to name a new recoverer; the new recoverer prepares a receipt against the controller as it stands. */
  const prepare = async () => {
    const made = start();
    const { utxo, state } = made.wallet.controller();
    const output = { transactionId: hex(utxo.transactionHash), index: utxo.index };
    const intended = { ...state, recovererKeyHash: otherCredential.recoveryKey.keyHash };
    const sent: Sent = { ...made.sent, recoveryKeyHash: hex(otherCredential.recoveryKey.keyHash) };
    const fields: ReceiptFields = { ...made.fields, recoveryKeyHash: hex(otherCredential.recoveryKey.keyHash), prepared: { controllerOutput: output, state: hex(encodeControllerState(intended)) } };
    const change = () => ownerUpdate(made.chain, made.wallet, made.seedA.controllerKey, { recovererKeyHash: otherCredential.recoveryKey.keyHash });
    return { ...made, sent, fields, output, intended, change };
  };

  it('RC10: recovery is not shown as on until the network shows the change it was prepared for, in a block or not', async () => {
    const { chain, history, sent, fields, change } = await prepare();
    // It is signed with the recovery key that is to be installed, which the controller does not name yet.
    const receipt = signReceipt(fields, otherCredential.recoveryKey);
    expect(recoveryStatus([receipt], sent, await history(), 'testnet')).toEqual({ on: false, reasons: ['A receipt does not count: the chain does not show the change it was prepared for.'] });
    const changedIn = change();
    expect(recoveryStatus([receipt], sent, await history(unconfirmed(chain)), 'testnet').on).toBe(true);
    expect(recoveryStatus([receipt], sent, await history(), 'testnet').on).toBe(true);
    // The change disappears (replaced, or its block undone and not mined again): the status goes with it.
    chain.drop(changedIn);
    expect(recoveryStatus([receipt], sent, await history(), 'testnet').reasons[0]).toMatch(/chain does not show the change it was prepared for/);
  });

  it('RC10: prepared for another controller output, it does not count', async () => {
    const { wallet, history, sent, fields, seedA, change } = await prepare();
    const receipt = signReceipt(fields, otherCredential.recoveryKey);
    // The controller moved in between: the change then spends another output than the one prepared against.
    wallet.authorize(seedA.controllerKey);
    change();
    expect(recoveryStatus([receipt], sent, await history(), 'testnet').reasons[0]).toMatch(/chain does not show the change it was prepared for/);
    // A receipt prepared again against the output the change did spend counts.
    const transitions = (await history()).transitions;
    const spent = transitions.at(-2)?.utxo;
    const again = signReceipt({ ...fields, prepared: { controllerOutput: { transactionId: hex(spent?.transactionHash ?? new Uint8Array()), index: spent?.index ?? 0 }, state: fields.prepared?.state ?? '' } }, otherCredential.recoveryKey);
    expect(recoveryStatus([again], sent, await history(), 'testnet').on).toBe(true);
  });

  it('RC10: prepared for other settings, it does not count', async () => {
    const { chain, wallet, history, sent, fields, seedA, intended } = await prepare();
    const receipt = signReceipt(fields, otherCredential.recoveryKey);
    // The owner makes another change than the one the receipt was prepared for: the waiting period as well.
    ownerUpdate(chain, wallet, seedA.controllerKey, { recovererKeyHash: otherCredential.recoveryKey.keyHash, challengeDelay: { unit: 'time512', value: 9 } });
    expect(recoveryStatus([receipt], sent, await history(), 'testnet').reasons[0]).toMatch(/chain does not show the change it was prepared for/);
    // And a receipt prepared for a state with another owner than this device is not for this device.
    const otherOwner = signReceipt({ ...fields, prepared: { controllerOutput: fields.prepared?.controllerOutput ?? { transactionId: '', index: 0 }, state: hex(encodeControllerState({ ...intended, ownerKeyHash: seedOf(WORDS_B).controllerKey.keyHash })) } }, otherCredential.recoveryKey);
    expect(recoveryStatus([otherOwner], sent, await history(), 'testnet').reasons[0]).toMatch(/installs another owner than this device/);
  });

  it('RC10: from another recipient, or for another viewing-key record, it does not count', async () => {
    const { history, sent, fields, change, intended } = await prepare();
    change();
    // The old recoverer signs a receipt for the change that removes it.
    const byOld = signReceipt({ ...fields, recoveryKeyHash: hex(credential.recoveryKey.keyHash) }, credential.recoveryKey);
    expect(recoveryStatus([byOld], sent, await history(), 'testnet').reasons[0]).toMatch(/another recovery key than the one this wallet named/);
    // A third party prepares a receipt for a state that would install itself; the wallet named someone else.
    const third = seedOf(WORDS_B).controllerKey;
    const byThird = signReceipt({ ...fields, recoveryKeyHash: hex(third.keyHash), prepared: { controllerOutput: fields.prepared?.controllerOutput ?? { transactionId: '', index: 0 }, state: hex(encodeControllerState({ ...intended, recovererKeyHash: third.keyHash })) } }, third);
    expect(recoveryStatus([byThird], sent, await history(), 'testnet').on).toBe(false);
    // The right recoverer, for another seed's viewing-key record.
    const otherRecord = signReceipt({ ...fields, viewingKeyRecords: [viewingKeyRecordHash(signViewingKeyRecord(seedOf(WORDS_B)))] }, otherCredential.recoveryKey);
    expect(recoveryStatus([otherRecord], sent, await history(), 'testnet').reasons[0]).toMatch(/does not name this seed's viewing-key record/);
    // The matching one counts.
    expect(recoveryStatus([byOld, byThird, otherRecord, signReceipt(fields, otherCredential.recoveryKey)], sent, await history(), 'testnet').on).toBe(true);
  });

  it('RC10: the receipt stands while the settings stay the ones it was prepared for, and falls when they change', async () => {
    const { chain, wallet, history, sent, fields, seedA, change } = await prepare();
    const receipt = signReceipt(fields, otherCredential.recoveryKey);
    change();
    wallet.authorize(seedA.controllerKey);
    expect(recoveryStatus([receipt], sent, await history(), 'testnet').on).toBe(true);
    ownerUpdate(chain, wallet, seedA.controllerKey, { challengeDelay: { unit: 'time512', value: 4 } });
    expect(recoveryStatus([receipt], sent, await history(), 'testnet').reasons[0]).toMatch(/waiting period has changed since/);
  });
});
