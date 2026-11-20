import { binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { FindingRefusalError, THIS_WALLET_ANSWERS, actionFinding } from '@grandmas-wallet/app';
import { p2pkhLockingBytecode, readTemplate } from '@grandmas-wallet/core';
import { keyedPoolTemplate, keyedStrongboxTemplate, ruledBoxTemplate, testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { type Device, deviceWith, presentation, request } from './support/applications.js';

/**
 * Acceptance tests PR08 and PR09 of the proposal (stage 15 of the plan): what an action leaves behind (section 12.3),
 * and what this wallet does with it (section 12.5). Every template here comes with no recovery declaration.
 *
 * - The keyed pool: opening a pool puts coins at a script that takes a key the engine makes for the wallet under the
 *   template; trading pays someone and leaves nothing behind.
 * - The box with a rule: whether the wallet follows the box is given by an expression the engine does not evaluate.
 */

const hex = binToHex;
const pool = presentation(keyedPoolTemplate);
const ruled = presentation(ruledBoxTemplate);
const payee = p2pkhLockingBytecode(testKey(0x52).keyHash);

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
    expect(summary.verdict.statement).not.toBe('violation');
    expect(summary.findings?.map(({ action, finding }) => [action, finding])).toEqual([
      ['open', 'does not come back'],
      ['trade', 'comes back'],
    ]);
    expect(summary.findings?.[0]?.outputs).toEqual([{ output: 'poolOutput', name: 'Pool', lockingScript: 'poolLockingScript', scriptName: 'Pool', keys: ['poolKey'] }]);

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
      ['add', 'cannot tell'],
      ['take', 'comes back'],
    ]);

    const opening = request(ruled, 'open', 'holder', { amount: 30_000, label: '01' });
    const refusal = await refusedOnFinding(device, () => device.applications.preview(opening));
    expect(refusal.finding).toMatchObject({ action: 'open', finding: 'cannot tell', outputs: [{ output: 'boxOutput', expression: true }] });
    expect(refusal.message).toMatch(/^This wallet cannot tell whether this would come back if the phone is lost: the template decides by an expression whether the wallet follows "Strongbox" at "Strongbox".* This wallet does not carry it out\.$/);
    await refusedOnFinding(device, () => device.applications.carryOut(opening));

    // "Cannot tell" is answered like "does not come back", in the one place this wallet decides.
    expect(THIS_WALLET_ANSWERS).toEqual({ 'comes back': 'carry out', 'does not come back': 'refuse', 'cannot tell': 'refuse' });
    // The same template with a rule the wallet can read comes back.
    expect(actionFinding(readTemplate(presentation(keyedStrongboxTemplate).texts.template).definition, 'open', 'holder')).toMatchObject({ finding: 'comes back', outputs: [{ output: 'boxOutput', keys: [] }] });
  });
});
