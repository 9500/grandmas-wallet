import { type Output, binToHex, decodeTransactionBch, encodeTransactionBch, hexToBin } from '@bitauth/libauth';
import type { ApplicationAction, HeldToken } from '@grandmas-wallet/app';
import { buildTransaction, p2pkhInput, p2pkhLockingBytecode, readTemplate, textHash } from '@grandmas-wallet/core';
import { WITHDRAW_SEQUENCE, savingsJarDeclarationText, savingsJarScript, savingsJarTemplateText, unlockTimeBytes } from '@grandmas-wallet/savings-jar';
import { testKey } from '@grandmas-wallet/testing';
import { describe, expect, it, vi } from 'vitest';

import { type Device, deviceWith } from './support/applications.js';

/**
 * Acceptance tests of the proposal for the Savings Jar (SJ01, SJ04 to SJ06) and AP10, on the simulated
 * chain. The wallet learns of the jar from its template and recovery declaration, as it would from any
 * application; the tests reach the jar through the wallet's general handling of templates.
 */

const hex = binToHex;
const read = readTemplate(savingsJarTemplateText);
const jar = {
  names: { identifier: read.identifier, contentHash: read.contentHash, declaration: textHash(savingsJarDeclarationText) },
  texts: { template: savingsJarTemplateText, declaration: savingsJarDeclarationText },
};
const now = (device: Device): number => Math.floor(device.chain.nowMs / 1000);
/** The request the application's page makes to open a jar. */
const open = (unlockTime: number, savedSatoshis: number): ApplicationAction => ({
  template: jar.names,
  presented: jar.texts,
  action: 'open',
  role: 'saver',
  variables: { unlockTime, unlockTimeBytes: hex(unlockTimeBytes(unlockTime)), savedSatoshis },
});
const jarOf = async (device: Device): Promise<HeldToken> => {
  const [token] = await device.applications.tokens();
  if (token === undefined) throw new Error('the wallet holds no key');
  return token;
};
/** A wallet with a jar of 40,000 satoshis that opens in an hour. */
const withJar = async () => {
  const device = await deviceWith([100_000n, 30_000n]);
  const unlockTime = now(device) + 3_600;
  const opened = await device.applications.carryOut(open(unlockTime, 40_000));
  const key = await jarOf(device);
  const script = savingsJarScript(hexToBin(key.category), unlockTime);
  return { device, unlockTime, opened, key, script };
};
const pass = (device: Device, seconds: number): void => {
  device.chain.nowMs += seconds * 1000;
};

describe('a savings jar', () => {
  it('opening one creates one key and sends it to the wallet; the jar\'s address follows from the key alone', async () => {
    const { device, unlockTime, opened, key, script } = await withJar();
    expect(opened.tokens).toEqual([{ category: key.category, commitment: hex(unlockTimeBytes(unlockTime)), capability: 'none', satoshis: '1000' }]);
    expect(key).toMatchObject({ meaning: 'position', template: { name: 'Savings Jar' }, authority: 'jarKey', amount: 0n, position: { status: 'open', satoshis: 40_000n, coins: 1, lockingBytecode: hex(script.lockingBytecode) } });
    expect(key.actions?.map(({ action }) => action)).toEqual(['deposit', 'withdraw']);
    expect(device.chain.balanceOf(script.lockingBytecode)).toBe(40_000n);
  });

  it('a jar whose date and key disagree is not opened: the key would not lead to the jar', async () => {
    const device = await deviceWith([100_000n]);
    const unlockTime = now(device) + 3_600;
    const crooked = { ...open(unlockTime, 40_000), variables: { unlockTime, unlockTimeBytes: hex(unlockTimeBytes(unlockTime + 1)), savedSatoshis: 40_000 } };
    await expect(device.applications.carryOut(crooked)).rejects.toThrow('would not lead to what the action pays in');
    expect(await device.applications.tokens()).toEqual([]);
  });

  it('SJ01: withdrawing with the key before the time is refused; after the time without the key is refused; with both it is accepted', async () => {
    const { device, unlockTime, key, script } = await withJar();
    const withdraw = device.applications.actionOn(key, 'withdraw');
    // Before the time, with the key. The wallet says beforehand when the network will take it.
    expect((await device.applications.preview(withdraw)).figures.notBefore).toBe(unlockTime);
    await expect(device.applications.carryOut(withdraw)).rejects.toThrow('non-final');
    expect(device.chain.balanceOf(script.lockingBytecode)).toBe(40_000n);

    // After the time, without the key: someone else's coin stands where the key should be.
    pass(device, 3_700);
    const [coin] = device.chain.outputsAt(script.lockingBytecode);
    const thief = testKey(0x31);
    const thiefAt = p2pkhLockingBytecode(thief.keyHash);
    device.chain.fund(thiefAt, 5_000n);
    const [own] = device.chain.outputsAt(thiefAt);
    if (coin === undefined || own === undefined) throw new Error('coins missing');
    const attempt = buildTransaction({
      inputs: [{ utxo: coin, sequence: WITHDRAW_SEQUENCE, unlock: () => script.unlock(1) }, p2pkhInput(own, thief)],
      outputs: [],
      changeLockingBytecode: thiefAt,
      locktime: unlockTime,
    });
    expect(device.chain.submit(hex(attempt.encoded))).toMatchObject({ accepted: false });
    expect(device.chain.balanceOf(script.lockingBytecode)).toBe(40_000n);

    // After the time, with the key.
    const before = (await device.wallet.balance()).recoverable;
    const outcome = await device.applications.carryOut(withdraw);
    expect(device.chain.balanceOf(script.lockingBytecode)).toBe(0n);
    expect((await device.wallet.balance()).recoverable).toBe(before + 40_000n - outcome.sent.feeSatoshis);
    expect(outcome.sent.feeSatoshis).toBe(BigInt(outcome.sent.bytes));
    expect(outcome.tokens[0]?.category).toBe(key.category);
  });

  it('SJ05: a third party cannot empty a jar, with a token of its own or without, and cannot alter a withdrawal', async () => {
    const { device, unlockTime, key, script } = await withJar();
    pass(device, 3_700);
    const [coin] = device.chain.outputsAt(script.lockingBytecode);
    if (coin === undefined) throw new Error('no jar coin');
    // With a key of another jar: a token of the thief's own category, with the same date on it.
    const thief = testKey(0x32);
    const thiefAt = p2pkhLockingBytecode(thief.keyHash);
    const category = device.chain.fund(thiefAt, 20_000n);
    const [seed] = device.chain.outputsAt(thiefAt);
    if (seed === undefined) throw new Error('no coin');
    const minted = buildTransaction({
      inputs: [p2pkhInput(seed, thief)],
      outputs: [{ lockingBytecode: thiefAt, valueSatoshis: 1_000n, token: { category: hexToBin(category), amount: 0n, nft: { capability: 'none', commitment: unlockTimeBytes(unlockTime) } } }],
      changeLockingBytecode: thiefAt,
    });
    expect(device.chain.submit(hex(minted.encoded))).toMatchObject({ accepted: true });
    const [forged, change] = device.chain.outputsAt(thiefAt);
    if (forged === undefined || change === undefined) throw new Error('no forged key');
    const attempt = buildTransaction({
      inputs: [{ utxo: coin, sequence: WITHDRAW_SEQUENCE, unlock: () => script.unlock(1) }, p2pkhInput(forged, thief), p2pkhInput(change, thief)],
      outputs: [{ ...forged.output }],
      changeLockingBytecode: thiefAt,
      locktime: unlockTime,
    });
    expect(device.chain.submit(hex(attempt.encoded))).toMatchObject({ accepted: false });

    // A withdrawal of the owner's is caught on its way and its payout is turned to the thief.
    const sending = vi.spyOn(device.chain, 'broadcast').mockRejectedValueOnce(new Error('connection lost'));
    await expect(device.applications.carryOut(device.applications.actionOn(key, 'withdraw'))).rejects.toThrow('connection lost');
    const caught = sending.mock.calls[0]?.[0] as string;
    sending.mockRestore();
    const transaction = decodeTransactionBch(hexToBin(caught));
    if (typeof transaction === 'string') throw new Error(transaction);
    const payout = transaction.outputs.findIndex((output) => output.token === undefined);
    const altered = { ...transaction, outputs: transaction.outputs.map((output, index): Output => (index === payout ? { ...output, lockingBytecode: thiefAt } : output)) };
    expect(device.chain.submit(hex(encodeTransactionBch(altered)))).toMatchObject({ accepted: false });
    expect(device.chain.balanceOf(script.lockingBytecode)).toBe(40_000n);
    // As the owner signed it, it is valid.
    expect(device.chain.submit(caught)).toMatchObject({ accepted: true });
    expect(device.chain.balanceOf(thiefAt)).toBeLessThan(21_000n);
  });

  it('SJ06: after a withdrawal the key is still in the wallet, and what someone pays in later can be withdrawn; a withdrawal that would not return the key is refused', async () => {
    const { device, key, script } = await withJar();
    pass(device, 3_700);
    await device.applications.carryOut(device.applications.actionOn(key, 'withdraw'));
    expect(await jarOf(device)).toMatchObject({ category: key.category, place: 'address', position: { status: 'closed', satoshis: 0n } });
    // Someone pays into the jar again: anyone can, with an ordinary payment to its address.
    device.chain.fund(script.lockingBytecode, 12_000n);
    device.chain.fund(script.lockingBytecode, 3_000n);
    const again = await jarOf(device);
    expect(again.position).toMatchObject({ status: 'open', satoshis: 15_000n, coins: 2 });
    const before = (await device.wallet.balance()).recoverable;
    const outcome = await device.applications.carryOut(device.applications.actionOn(again, 'withdraw'));
    expect((await device.wallet.balance()).recoverable).toBe(before + 15_000n - outcome.sent.feeSatoshis);
    expect((await jarOf(device)).category).toBe(key.category);

    // The same template with a withdrawal that lets the key go. The contract would allow it; the wallet does not.
    const source = JSON.parse(savingsJarTemplateText) as { transactions: { withdrawTransaction: { outputs: unknown[] } } };
    source.transactions.withdrawTransaction.outputs = [];
    const lossyText = JSON.stringify(source);
    const lossy = readTemplate(lossyText);
    const declaration = JSON.stringify({ ...(JSON.parse(savingsJarDeclarationText) as object), template: { identifier: lossy.identifier, contentHash: lossy.contentHash } });
    const names = { identifier: lossy.identifier, contentHash: lossy.contentHash, declaration: textHash(declaration) };
    const other = await deviceWith([100_000n]);
    const unlockTime = now(other) - 10;
    await other.applications.carryOut({ ...open(unlockTime, 20_000), template: names, presented: { template: lossyText, declaration } });
    const lossyKey = await jarOf(other);
    await expect(other.applications.carryOut(other.applications.actionOn(lossyKey, 'withdraw'))).rejects.toThrow('would not return the token it spends');
    expect((await jarOf(other)).position).toMatchObject({ status: 'open', satoshis: 20_000n });
  });

  it('anyone can pay into a jar, and the wallet can too, from its key', async () => {
    const { device, key, script } = await withJar();
    const outcome = await device.applications.carryOut(device.applications.actionOn(key, 'deposit', { savedSatoshis: 7_000 }));
    expect(outcome.tokens).toEqual([]);
    expect(device.chain.balanceOf(script.lockingBytecode)).toBe(47_000n);
    expect((await jarOf(device)).position).toMatchObject({ satoshis: 47_000n, coins: 2 });
  });

  it('SJ04: the device is lost with a jar open; the new device finds the jar from the swept key and empties it, with the application\'s site not consulted', async () => {
    const { device, unlockTime, key, script } = await withJar();
    // The phone is gone. The recoverer requests, waits and completes; the new phone takes the wallet over.
    await device.recover();
    const taken = await device.takeOver();
    await taken.wallet.search();
    const swept = await taken.wallet.sweepEarlier();
    expect(swept.tokens).toEqual([{ category: key.category, meaning: 'unknown' }]);
    // The new phone has only what the backup holds. No application is asked for anything.
    expect(await taken.applications.readBackup()).toEqual({ suggested: 1, notes: 1 });
    const [suggested] = taken.applications.suggestions;
    expect(suggested).toMatchObject({ name: 'Savings Jar', identifier: jar.names.identifier });
    if (suggested === undefined) throw new Error('no suggestion');
    await taken.applications.trust(suggested, undefined);
    const found = await jarOf(taken);
    expect(found).toMatchObject({ category: key.category, place: 'address', meaning: 'position', position: { status: 'open', satoshis: 40_000n } });
    // The waiting period of the recovery was shorter than the jar's: the date still holds.
    if (now(taken) < unlockTime) await expect(taken.applications.carryOut(taken.applications.actionOn(found, 'withdraw'))).rejects.toThrow('non-final');
    pass(taken, 3_700);
    const before = (await taken.wallet.balance()).recoverable;
    const outcome = await taken.applications.carryOut(taken.applications.actionOn(found, 'withdraw'));
    expect((await taken.wallet.balance()).recoverable).toBe(before + 40_000n - outcome.sent.feeSatoshis);
    expect(taken.chain.balanceOf(script.lockingBytecode)).toBe(0n);
    // The earlier phone's key no longer opens anything: the jar's key is at an address of the new seed.
    expect((await device.wallet.balance()).tokens).toEqual([]);
    // Someone pays in again, and that is withdrawn too.
    taken.chain.fund(script.lockingBytecode, 9_000n);
    const second = await taken.applications.carryOut(taken.applications.actionOn(await jarOf(taken), 'withdraw'));
    expect(second.tokens[0]?.category).toBe(key.category);
    expect(taken.chain.balanceOf(script.lockingBytecode)).toBe(0n);
  }, 60_000);

  it('AP10: with the application\'s site unavailable, a position stays operable from its token and template', async () => {
    const { device, key } = await withJar();
    pass(device, 3_700);
    // From here on nothing of the application takes part: no session, no request, no page. The wallet works
    // from the key it holds, the template it kept and the chain.
    const held = await jarOf(device);
    expect(held.actions).toEqual([
      // The amount is the user's to give; the wallet asks for it in the template's words.
      { action: 'deposit', role: 'saver', name: 'Pay into a savings jar', description: expect.stringContaining('Add savings') as string, asks: [{ variable: 'savedSatoshis', name: 'Amount to save', description: 'Satoshis to put into the jar.', type: 'satoshis' }] },
      { action: 'withdraw', role: 'saver', name: 'Empty a savings jar', description: expect.stringContaining('Take everything out') as string },
    ]);
    const deposit = device.applications.actionOn(held, 'deposit', { savedSatoshis: 5_000 });
    expect(deposit.presented).toBeUndefined();
    expect(deposit.application).toBeUndefined();
    await device.applications.carryOut(deposit);
    const preview = await device.applications.preview(device.applications.actionOn(await jarOf(device), 'withdraw'));
    expect(preview.words.action.name).toBe('Empty a savings jar');
    expect(preview.figures.fromApplication).toEqual({ satoshis: 45_000n, coins: 2 });
    const outcome = await device.applications.carryOut(device.applications.actionOn(await jarOf(device), 'withdraw'));
    expect(outcome.tokens[0]?.category).toBe(key.category);
    expect((await jarOf(device)).position).toMatchObject({ status: 'closed', satoshis: 0n });
  });
});
