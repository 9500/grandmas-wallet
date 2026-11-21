import { binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { FindingRefusalError, THIS_WALLET_ANSWERS, actionFinding } from '@grandmas-wallet/app';
import { p2pkhLockingBytecode, readTemplate } from '@grandmas-wallet/core';
import { envelopeTemplate, jointEnvelopeTemplate, keyedPoolTemplate, ruledBoxTemplate, ruledPoolTemplate, testKey, unownedEnvelopeTemplate } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { type Device, deviceWith, presentation, request } from './support/applications.js';

/**
 * Acceptance tests PR08 and PR09 of the proposal (stage 15 of the plan), and PR26 and PR27 (stage 21): what an action
 * leaves behind (section 12.3), and what this wallet does with it (section 12.5). Every template here comes alone.
 *
 * - The keyed pool: opening a pool puts coins at a script that takes a key the engine makes for the wallet under the
 *   template; trading pays someone and leaves nothing behind.
 * - The pool with a rule: the keyed pool, whose pool the wallet follows by an expression the engine does not evaluate.
 * - The box with a rule: a box that takes no key, which the wallet follows by such an expression.
 * - The envelope: coins left at a script that the keeper's key opens, given in the giver's role or in the keeper's; the
 *   same without the template saying whose the key is, and with a key of each party.
 */

const hex = binToHex;
const pool = presentation(keyedPoolTemplate);
const ruled = presentation(ruledPoolTemplate);
const ruledBox = presentation(ruledBoxTemplate);
const envelope = presentation(envelopeTemplate);
const payee = p2pkhLockingBytecode(testKey(0x52).keyHash);
const keeperKeyHash = hex(testKey(0x53).keyHash);
const definitionOf = (template: unknown) => readTemplate(presentation(template).texts.template).definition;

/** The action is carried out: the transaction is sent, with the output the action leaves at the script. */
const carriedOut = async (device: Device, action: ReturnType<typeof request>, satoshis: bigint, scriptName: string): Promise<void> => {
  const preview = await device.applications.preview(action);
  expect(preview.finding).toMatchObject({ finding: 'comes back' });
  const outcome = await device.applications.carryOut(action);
  const sent = decodeTransactionBch(hexToBin((await device.chain.getTransaction(outcome.transactionId)) ?? ''));
  if (typeof sent === 'string') throw new Error(sent);
  expect(sent.outputs.some(({ valueSatoshis }) => valueSatoshis === satoshis), `${scriptName} holds ${satoshis} satoshis`).toBe(true);
};

/** The action is refused on its finding, before the user is asked: nothing is worked out, stored, signed or sent. */
const refusedOnFinding = async (device: Device, attempt: () => Promise<unknown>): Promise<FindingRefusalError> => {
  const before = { broadcasts: device.chain.broadcasts, templates: device.applications.templates.length, records: device.applications.positionRecords.length, allocation: JSON.stringify(device.state().allocation) };
  let thrown: unknown;
  await attempt().then(
    () => expect.unreachable('the action was carried out'),
    (error: unknown) => (thrown = error),
  );
  expect(thrown).toBeInstanceOf(FindingRefusalError);
  expect(device.chain.broadcasts).toBe(before.broadcasts);
  expect(device.applications.templates.length).toBe(before.templates);
  expect(device.applications.positionRecords.length).toBe(before.records);
  expect(JSON.stringify(device.state().allocation)).toBe(before.allocation);
  return thrown as FindingRefusalError;
};

describe('what an action leaves behind', () => {
  it('PR08: a template with a script that takes a key of the device: an action that puts nothing there comes back and is carried out; one that would put something there does not come back, and this wallet refuses it with the reason before the user is asked', async () => {
    const device = await deviceWith([100_000n]);

    // The template is not refused whole: shown, it names the finding of each action.
    const summary = device.applications.describe(pool.names, pool.texts);
    expect(summary.findings.map(({ action, finding }) => [action, finding])).toEqual([
      ['open', 'does not come back'],
      ['trade', 'comes back'],
    ]);
    expect(summary.findings[0]?.outputs).toEqual([{ output: 'poolOutput', name: 'Pool', lockingScript: 'poolLockingScript', scriptName: 'Pool', keys: ['poolKey'] }]);

    // Opening a pool would put coins at a script only this device's key unlocks: refused, before the user is asked.
    const opening = request(pool, 'open', 'provider', { amount: 30_000 });
    const shown = await refusedOnFinding(device, () => device.applications.preview(opening));
    expect(shown.finding).toMatchObject({ action: 'open', role: 'provider', finding: 'does not come back' });
    expect(shown.message).toMatch(/^This would tie money to this phone alone: "Pool" would be at "Pool", a script that takes a key of this device \("poolKey"\)\..*If the phone is lost, nobody can get it back\. This wallet does not carry it out\.$/);
    // Approving would not change that: the action is refused before the template is taken in.
    await refusedOnFinding(device, () => device.applications.carryOut(opening));

    // Trading leaves nothing at a script of the template: it comes back, and it is carried out.
    const trading = request(pool, 'trade', 'provider', { amount: 20_000, payee: hex(payee) });
    const preview = await device.applications.preview(trading);
    expect(preview.finding).toMatchObject({ action: 'trade', finding: 'comes back', outputs: [] });
    expect(preview.figures.toOthers).toEqual([expect.objectContaining({ name: 'Payment', satoshis: 20_000n, lockingBytecode: hex(payee) })]);
    const outcome = await device.applications.carryOut(trading);
    const sent = decodeTransactionBch(hexToBin((await device.chain.getTransaction(outcome.transactionId)) ?? ''));
    if (typeof sent === 'string') throw new Error(sent);
    expect(sent.outputs.some((output) => hex(output.lockingBytecode) === hex(payee) && output.valueSatoshis === 20_000n)).toBe(true);
    expect(device.applications.templates.map(({ identifier }) => identifier)).toEqual([pool.names.identifier]);

    // Trusted now, the template is still judged action by action: opening a pool is refused as before.
    await refusedOnFinding(device, () => device.applications.preview(opening));
  });

  it('PR09: a template that uses something the wallet cannot analyse: the finding is that the wallet cannot tell, and this wallet refuses', async () => {
    const device = await deviceWith([100_000n]);
    const summary = device.applications.describe(ruled.names, ruled.texts);
    expect(summary.findings?.map(({ action, finding }) => [action, finding])).toEqual([
      ['open', 'cannot tell'],
      ['trade', 'comes back'],
    ]);

    const opening = request(ruled, 'open', 'provider', { amount: 30_000 });
    const refusal = await refusedOnFinding(device, () => device.applications.preview(opening));
    expect(refusal.finding).toMatchObject({ action: 'open', finding: 'cannot tell', outputs: [{ output: 'poolOutput', keys: ['poolKey'], expression: true }] });
    expect(refusal.message).toMatch(/^This wallet cannot tell whether this would come back if the phone is lost: the template decides by an expression whether the wallet follows "Pool" at "Pool", a script that takes a key of this device \("poolKey"\).* This wallet does not carry it out\.$/);
    await refusedOnFinding(device, () => device.applications.carryOut(opening));

    // "Cannot tell" is answered like "does not come back", in the one place this wallet decides.
    expect(THIS_WALLET_ANSWERS).toEqual({ 'comes back': 'carry out', 'does not come back': 'refuse', 'cannot tell': 'refuse' });
    // The same pool with a rule the wallet can read is tied to the device: it does not come back.
    expect(actionFinding(definitionOf(keyedPoolTemplate), 'open', 'provider')).toMatchObject({ finding: 'does not come back', outputs: [{ output: 'poolOutput', keys: ['poolKey'] }] });
  });

  it('PR26: a script that takes no key comes back even where the template gives the rule for following it as an expression, and the action is carried out; the same rule on a script that takes a key of the wallet\'s role stays "cannot tell" and is refused', async () => {
    const device = await deviceWith([100_000n]);
    const summary = device.applications.describe(ruledBox.names, ruledBox.texts);
    expect(summary.findings?.map(({ action, finding }) => [action, finding])).toEqual([
      ['open', 'comes back'],
      ['add', 'comes back'],
      ['take', 'comes back'],
    ]);
    // The box is still an output the wallet might follow; it takes no key, so nothing there depends on one.
    expect(summary.findings?.[0]?.outputs).toEqual([{ output: 'boxOutput', name: 'Strongbox', lockingScript: 'boxLockingScript', scriptName: 'Strongbox', keys: [], expression: true }]);
    await carriedOut(device, request(ruledBox, 'open', 'holder', { amount: 30_000, label: '01' }), 30_000n, 'the box');

    // The pool takes a key of the device, under the same kind of rule: the wallet cannot tell, and refuses.
    expect(actionFinding(definitionOf(ruledPoolTemplate), 'open', 'provider')).toMatchObject({ finding: 'cannot tell', outputs: [{ keys: ['poolKey'], expression: true }] });
    await refusedOnFinding(device, () => device.applications.preview(request(ruled, 'open', 'provider', { amount: 30_000 })));
  });

  it('PR27: a script that takes only a key the template gives to another role comes back for the wallet in its own role and is carried out; in the role that keeps the key, with a key no role is named as keeping, and with a key of each role, it does not come back and is refused', async () => {
    const device = await deviceWith([100_000n]);
    const summary = device.applications.describe(envelope.names, envelope.texts);
    expect(summary.findings?.map(({ action, role, finding }) => [action, role, finding])).toEqual([
      ['give', 'giver', 'comes back'],
      ['give', 'keeper', 'does not come back'],
      ['collect', 'keeper', 'comes back'],
    ]);
    // In the giver's role the envelope is followed, but the key it takes is the keeper's: none of this device's.
    expect(summary.findings?.[0]?.outputs).toEqual([{ output: 'envelopeOutput', name: 'Envelope', lockingScript: 'envelopeLockingScript', scriptName: 'Envelope', keys: [] }]);
    await carriedOut(device, request(envelope, 'give', 'giver', { amount: 30_000, keeperKeyHash }), 30_000n, 'the envelope');

    // In the keeper's role the same envelope is tied to the key this device would keep: refused, with the reason.
    const keeping = await refusedOnFinding(device, () => device.applications.preview(request(envelope, 'give', 'keeper', { amount: 30_000, keeperKeyHash })));
    expect(keeping.finding).toMatchObject({ role: 'keeper', finding: 'does not come back', outputs: [{ output: 'envelopeOutput', keys: ['keeperKey'] }] });
    expect(keeping.message).toMatch(/^This would tie money to this phone alone: "Envelope" would be at "Envelope", a script that takes a key of this device \("keeperKey"\)\./);

    // Where no role is named as keeping the key, the key counts as the device's in either role.
    const unowned = presentation(unownedEnvelopeTemplate);
    for (const role of ['giver', 'keeper']) expect(actionFinding(definitionOf(unownedEnvelopeTemplate), 'give', role)).toMatchObject({ finding: 'does not come back', outputs: [{ keys: ['keeperKey'] }] });
    await refusedOnFinding(device, () => device.applications.preview(request(unowned, 'give', 'giver', { amount: 30_000, keeperKeyHash })));

    // A script with a key of each role takes a key of the device in either role.
    expect(actionFinding(definitionOf(jointEnvelopeTemplate), 'give', 'giver')).toMatchObject({ finding: 'does not come back', outputs: [{ keys: ['giverKey'] }] });
    expect(actionFinding(definitionOf(jointEnvelopeTemplate), 'give', 'keeper')).toMatchObject({ finding: 'does not come back', outputs: [{ keys: ['keeperKey'] }] });
    const joint = presentation(jointEnvelopeTemplate);
    await refusedOnFinding(device, () => device.applications.preview(request(joint, 'give', 'giver', { amount: 30_000 })));
  });
});
