import { type TransactionCommon, binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { type ApplicationAction, ActionRefusedError } from '@grandmas-wallet/app';
import { ADDRESS_KIND, readTemplate, takeNumber, walletAddress } from '@grandmas-wallet/core';
import { describe, expect, it } from 'vitest';

import { type Device, deviceWith, finishCopying, seedOf } from '../../../test/support/applications.js';
import { savingsJarScript, savingsJarV4TemplateText, unlockTimeBytes } from '../src/index.js';

/**
 * The Savings Jar without a declaration (proposal section 15.3; acceptance test PR19 on the simulated chain): the
 * template of version 4 is all the wallet is sent. Each action is carried out from the template, the request as
 * the jar's page makes it, and the wallet's own record of the jar; after the loss of the device, the new device
 * finds the jar from that record and empties it by itself, with no request from the jar's page.
 */

const hex = binToHex;
const PAGE = 'https://jar.example/';
const read = readTemplate(savingsJarV4TemplateText);
const names = { identifier: read.identifier, contentHash: read.contentHash };
const presented = { template: savingsJarV4TemplateText };

/** A request of the jar's page, as the wallet's session turns it into an action. */
const request = (action: 'open' | 'deposit' | 'withdraw', variables: Record<string, string | number>, more: Partial<ApplicationAction> = {}): ApplicationAction => ({
  template: names,
  presented,
  action,
  role: 'saver',
  variables,
  application: 'the jar page',
  ...more,
});
/** What the page sends to open a jar: the date, twice, and the amount; and its own address. */
const open = (unlockTime: number, savedSatoshis: number): ApplicationAction =>
  request('open', { unlockTime, unlockTimeBytes: hex(unlockTimeBytes(unlockTime)), savedSatoshis }, { page: PAGE });
const deposit = (category: string, savedSatoshis: number): ApplicationAction => request('deposit', { savedSatoshis }, { about: { category, spent: false }, page: PAGE });
const withdraw = (category: string): ApplicationAction => request('withdraw', {}, { about: { category, spent: true }, page: PAGE });

const transactionOf = async (device: Device, transactionId: string): Promise<TransactionCommon> => {
  const transaction = decodeTransactionBch(hexToBin((await device.chain.getTransaction(transactionId)) ?? ''));
  if (typeof transaction === 'string') throw new Error(transaction);
  return transaction;
};
const jarAt = (category: string, unlockTime: number): Uint8Array => savingsJarScript(hexToBin(category), unlockTime).lockingBytecode;
const keyCoinOf = async (device: Device, category: string) => {
  const found = (await device.wallet.parts.tokenCoins()).find(({ coin }) => hex(coin.utxo.output.token?.category ?? new Uint8Array()) === category);
  if (found === undefined) throw new Error('the wallet holds no such key');
  return found;
};
const outpoint = (transactionHash: Uint8Array, index: number): string => `${hex(transactionHash)}:${index}`;

/**
 * The device is lost and the wallet recovered with the project's recovery flow: the recoverer requests, waits and
 * completes; the new device takes over, searches, sweeps, copies the earlier archive, reads its backup, trusts
 * the template the earlier owner stored, and checks the records against the chain.
 */
const recovered = async (device: Device): Promise<Device> => {
  await device.recover();
  const taken = await device.takeOver();
  await taken.wallet.search();
  await taken.wallet.sweepEarlier();
  await finishCopying(taken);
  await taken.applications.readBackup();
  for (const suggested of taken.applications.suggestions) await taken.applications.trust(suggested, undefined);
  await taken.applications.confirmRecords();
  return taken;
};

describe('the Savings Jar from its template alone (PR19)', () => {
  it('opens a jar, takes a payment in and empties it, from the page\'s requests and the wallet\'s record; no declaration anywhere', async () => {
    const device = await deviceWith([100_000n, 60_000n]);
    const unlockTime = Math.floor(device.chain.nowMs / 1000) + 3_600;

    // Opening: the page gives the date and the amount; the wallet makes the key's category from its own coin.
    const opening = open(unlockTime, 40_000);
    const preview = await device.applications.preview(opening);
    expect(preview.template).not.toHaveProperty('declaration');
    expect(preview.words.outcome).toBe('A savings jar was opened with 40000 satoshis.');
    expect(preview.recordsPosition).toBe(true);
    expect(preview.tokensLeaving).toBeUndefined();
    const opened = await device.applications.carryOut(opening);
    const [key] = opened.tokens;
    const category = key?.category as string;
    expect(key).toMatchObject({ commitment: hex(unlockTimeBytes(unlockTime)), capability: 'none' });
    expect(device.chain.balanceOf(jarAt(category, unlockTime))).toBe(40_000n);
    expect(device.applications.templates[0]).not.toHaveProperty('declaration');
    // The record, written before the opening was signed: the jar's script and its two values, the date as written
    // on the key and the amount, and the page's address. No address of the wallet's.
    expect(device.applications.positionRecords).toEqual([
      {
        kind: 'position',
        token: { category, commitment: hex(unlockTimeBytes(unlockTime)), capability: 'none' },
        templateIdentifier: names.identifier,
        lockingScriptIdentifier: 'savingsJarLockingScript',
        roleIdentifier: 'saver',
        variables: { keyCategory: category, unlockTime: String(unlockTime) },
        values: { unlockTimeBytes: hex(unlockTimeBytes(unlockTime)), savedSatoshis: '40000' },
        applicationPage: PAGE,
      },
    ]);

    // Paying in: about the key, which it does not spend. The jar's values are the record's; the amount is the page's.
    const paying = await device.applications.preview(deposit(category, 6_000));
    expect(paying.figures.toOthers.map(({ name, satoshis, lockingBytecode }) => [name, satoshis, lockingBytecode])).toEqual([['Savings jar', 6_000n, hex(jarAt(category, unlockTime))]]);
    expect(paying.figures.tokensSpent).toEqual([]);
    expect(paying.recordsPosition).toBeUndefined();
    await device.applications.carryOut(deposit(category, 6_000));
    expect(device.chain.balanceOf(jarAt(category, unlockTime))).toBe(46_000n);
    expect(device.applications.positionRecords).toHaveLength(1);

    // Before the date the network refuses the withdrawal, and nothing moves.
    await expect(device.applications.carryOut(withdraw(category))).rejects.toThrow(/non-final/);
    expect(device.chain.balanceOf(jarAt(category, unlockTime))).toBe(46_000n);

    // From the date on: the page names the key and nothing else. The key goes in at input 0, the jar's two coins
    // after it, and comes back to a fresh address of the wallet's; the savings too.
    device.chain.nowMs += 3_700 * 1000;
    const keyBefore = await keyCoinOf(device, category);
    const emptying = await device.applications.preview(withdraw(category));
    expect(emptying.figures.applicationInputs.map(({ name, satoshis }) => [name, satoshis])).toEqual([
      ['Savings jar', 40_000n],
      ['Savings jar', 6_000n],
    ]);
    expect(emptying.figures.toWallet.map(({ kind, token }) => [kind, token?.category])).toEqual([
      ['receive', category],
      ['left over', undefined],
    ]);
    expect(emptying.figures.notBefore).toBe(unlockTime);
    expect(emptying.tokensLeaving).toBeUndefined();
    const emptied = await device.applications.carryOut(withdraw(category));
    const transaction = await transactionOf(device, emptied.transactionId);
    expect(outpoint(transaction.inputs[0]?.outpointTransactionHash as Uint8Array, transaction.inputs[0]?.outpointIndex as number)).toBe(outpoint(keyBefore.coin.utxo.transactionHash, keyBefore.coin.utxo.index));
    expect(transaction.locktime).toBe(unlockTime);
    expect(device.chain.balanceOf(jarAt(category, unlockTime))).toBe(0n);
    expect(emptied.tokens).toEqual([expect.objectContaining({ category, commitment: hex(unlockTimeBytes(unlockTime)) })]);
    expect((await keyCoinOf(device, category)).place).toBe('address');
    const [position] = await device.applications.recordedPositions();
    expect(position).toMatchObject({ status: 'closed', record: { applicationPage: PAGE } });
  }, 60_000);

  it('refuses a request that names no key for the withdrawal, and a key the wallet does not hold', async () => {
    const device = await deviceWith([100_000n]);
    const before = device.chain.broadcasts;
    await expect(device.applications.preview(request('withdraw', {}))).rejects.toThrow(ActionRefusedError);
    await expect(device.applications.preview(request('withdraw', {}))).rejects.toThrow(/spends a token of the wallet's as "Jar key"; the request has to name it/);
    await expect(device.applications.preview(withdraw('ab'.repeat(32)))).rejects.toThrow(/holds no such token/);
    expect(device.chain.broadcasts).toBe(before);
  });
});

describe('a Savings Jar through the loss of the device (PR19)', () => {
  it('until the user trusts the template the earlier owner stored, the swept key is a token of a template not trusted, with that template to trust, and not a position the chain does not confirm', async () => {
    const device = await deviceWith([100_000n, 60_000n]);
    const unlockTime = Math.floor(device.chain.nowMs / 1000) + 3_600;
    const category = (await device.applications.carryOut(open(unlockTime, 30_000))).tokens[0]?.category as string;
    await device.recover();
    const taken = await device.takeOver();
    await taken.wallet.search();
    await taken.wallet.sweepEarlier();
    await finishCopying(taken);
    await taken.applications.readBackup();
    expect(taken.applications.suggestedRecords).toHaveLength(1);
    expect(await taken.applications.recordedPositions()).toEqual([]);
    expect(await taken.applications.tokens()).toMatchObject([{ category, meaning: 'incomplete', template: { identifier: names.identifier, name: 'Savings Jar' } }]);
    for (const suggested of taken.applications.suggestions) await taken.applications.trust(suggested, undefined);
    expect(await taken.applications.recordedPositions()).toMatchObject([{ status: 'open', standing: 'suggested', satoshis: 30_000n }]);
    await taken.applications.confirmRecords();
    expect(await taken.applications.recordedPositions()).toMatchObject([{ status: 'open', standing: 'own', satoshis: 30_000n }]);
  }, 60_000);

  it('the new device finds the jar from its record and empties it by itself, from its own list, with no request from the jar\'s page; the key and the savings go to addresses of the new seed', async () => {
    const device = await deviceWith([100_000n, 60_000n]);
    const unlockTime = Math.floor(device.chain.nowMs / 1000) + 3_600;
    const opened = await device.applications.carryOut(open(unlockTime, 30_000));
    const category = opened.tokens[0]?.category as string;
    const keyFirstAt = hex((await keyCoinOf(device, category)).coin.utxo.output.lockingBytecode);

    const taken = await recovered(device);
    expect(taken.applications.templates.map(({ identifier }) => identifier)).toEqual([names.identifier]);
    const [position] = await taken.applications.recordedPositions();
    if (position === undefined) throw new Error('the jar is not listed');
    // The earlier seed's record, borne out by the chain and written again as the new owner's own.
    expect(position).toMatchObject({ status: 'open', standing: 'own', satoshis: 30_000n, coins: 1, template: { identifier: names.identifier, name: 'Savings Jar' }, record: { applicationPage: PAGE } });
    expect(position.token.place).toBe('address');
    // The template offers the withdrawal at the jar, and the wallet needs nothing for it from the page.
    expect(taken.applications.offeredActions(position)).toEqual([{ action: 'withdraw', role: 'saver', name: 'Empty a savings jar', description: expect.any(String) as string }]);

    taken.chain.nowMs += 3_700 * 1000;
    const action = taken.applications.actionOn(position, 'withdraw');
    expect(action).toEqual({ template: names, action: 'withdraw', role: 'saver', variables: {}, about: { category, spent: true }, fromWallet: { typed: {} } });
    expect(action).not.toHaveProperty('page');
    expect(action).not.toHaveProperty('application');
    const nextChange = takeNumber(taken.state().allocation, ADDRESS_KIND.change);
    const firstOfNewSeed = 'number' in nextChange ? nextChange.number : -1;
    const before = taken.chain.broadcasts;
    const emptied = await taken.applications.carryOut(action);
    expect(taken.chain.broadcasts).toBe(before + 1);
    const transaction = await transactionOf(taken, emptied.transactionId);
    const keyNowAt = hex(transaction.outputs[0]?.lockingBytecode as Uint8Array);
    expect(keyNowAt).toBe(hex(walletAddress(taken.identity, seedOf(1).viewingKey, ADDRESS_KIND.change, firstOfNewSeed).lockingBytecode));
    expect(keyNowAt).not.toBe(keyFirstAt);
    expect(transaction.outputs[0]?.token?.nft?.commitment).toEqual(unlockTimeBytes(unlockTime));
    expect(taken.chain.balanceOf(jarAt(category, unlockTime))).toBe(0n);
    expect((await taken.applications.recordedPositions())[0]?.status).toBe('closed');
  }, 60_000);

  it('after the recovery, the page\'s requests work on the jar the record names: a payment in, then the withdrawal', async () => {
    const device = await deviceWith([100_000n, 60_000n]);
    const unlockTime = Math.floor(device.chain.nowMs / 1000) + 3_600;
    const category = (await device.applications.carryOut(open(unlockTime, 30_000))).tokens[0]?.category as string;
    const taken = await recovered(device);
    await taken.receive(50_000n);
    // The new device's wallet trusted the template from the backup; the page's request names it as before.
    await taken.applications.carryOut(deposit(category, 5_000));
    expect(taken.chain.balanceOf(jarAt(category, unlockTime))).toBe(35_000n);
    taken.chain.nowMs += 3_700 * 1000;
    await taken.applications.carryOut(withdraw(category));
    expect(taken.chain.balanceOf(jarAt(category, unlockTime))).toBe(0n);
    expect((await keyCoinOf(taken, category)).place).toBe('address');
  }, 60_000);
});
