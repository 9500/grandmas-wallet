import { binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { ActionRefusedError } from '@grandmas-wallet/app';
import { readTemplate, templateLockingBytecode } from '@grandmas-wallet/core';
import { lockerClubTemplate } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { type Device, deviceWith, presentation, request } from './support/applications.js';

/**
 * What an application's template can ask of the wallet besides its own position (stage 9, written for a template
 * made for the tests, and since stage 14 without a declaration): contracts every user of the application shares,
 * which the page names by outpoint and the wallet reads from the chain; values the page read from those coins;
 * places in the transaction that the template fixes; fungible tokens the wallet pays with, with what is left of
 * them coming back; tokens sent to a data output; and the application's own contracts evaluated before anything
 * is signed.
 */

const club = presentation(lockerClubTemplate);
const CLUB = 'c1'.repeat(32);
const definition = readTemplate(club.texts.template).definition;
const doorAt = templateLockingBytecode(definition, 'doorLockingScript', {});
const hex = binToHex;

/** A wallet, and the club's door on chain: a minting token of the club's category with 1,000,000 credits. */
const withDoor = async (): Promise<{ device: Device; door: string }> => {
  const device = await deviceWith([200_000n]);
  const door = { transactionId: 'd0'.repeat(32), index: 2, output: { lockingBytecode: doorAt, valueSatoshis: 1000n, token: { category: hexToBin(CLUB), amount: 1_000_000n, nft: { capability: 'minting' as const, commitment: hexToBin('0700ffff') } } } };
  device.chain.adopt([door]);
  return { device, door: `${door.transactionId}:${door.index}` };
};
/** Joining, as the page asks for it: the door by its outpoint, and what the page read from it. */
const join = (credits: number, door: string | undefined, more: Parameters<typeof request>[4] = {}) =>
  request(club, 'join', 'member', { credits, deposit: 20_000, doorCredits: 1_000_000, doorState: '0700ffff', doorNumber: 7 }, { ...(door === undefined ? {} : { inputs: { doorInput: door } }), ...more });
const transactionOf = async (device: Device, transactionId: string) => {
  const transaction = decodeTransactionBch(hexToBin((await device.chain.getTransaction(transactionId)) ?? ''));
  if (typeof transaction === 'string') throw new Error(transaction);
  return transaction;
};

describe('an application\'s shared contracts, fungible tokens and places in the transaction', () => {
  it('the wallet reads the shared contract the page names, takes the values the page read from it, and puts its own coin and output where the template leaves room', async () => {
    const { device, door } = await withDoor();
    const preview = await device.applications.preview(join(30_000, door));
    expect(preview.words.outcome).toBe('Joined at door 7 with 30000 credits.');
    // The door as the wallet read it from the chain, not as the page described it.
    expect(preview.figures.applicationInputs).toEqual([{ name: 'The club\'s door', outpoint: door, satoshis: 1000n, token: { category: CLUB, amount: 1_000_000n, nft: { capability: 'minting', commitment: '0700ffff' } } }]);
    const outcome = await device.applications.carryOut(join(30_000, door));
    const transaction = await transactionOf(device, outcome.transactionId);
    // The coin that defines the card's category is input 0, the door is where the template puts it.
    expect(hex(transaction.inputs[0]?.outpointTransactionHash as Uint8Array)).toBe(outcome.tokens[0]?.category);
    expect(`${hex(transaction.inputs[1]?.outpointTransactionHash as Uint8Array)}:${transaction.inputs[1]?.outpointIndex}`).toBe(door);
    // Output 0 is what the wallet keeps; the template's outputs are at their places.
    expect(transaction.outputs[0]?.token).toBeUndefined();
    expect(preview.figures.toWallet.map(({ kind }) => kind)).toEqual(['left over', 'receive', 'receive']);
    expect(transaction.outputs[1]).toMatchObject({ lockingBytecode: doorAt, token: { amount: 970_000n } });
    expect(outcome.tokens.map(({ capability, amount }) => [capability, amount])).toEqual([['none', undefined], ['none', '30000']]);
    expect(preview.figures.tokensNet).toEqual([{ category: CLUB, amount: 30_000n }]);
  });

  it('a coin the page names is used when it is at a script of the template, and refused when it is not, is spent, or is not where the action spends one; none is looked for', async () => {
    const { device, door } = await withDoor();
    device.chain.adopt([
      { transactionId: 'd1'.repeat(32), index: 0, output: { lockingBytecode: doorAt, valueSatoshis: 5_000n } },
      { transactionId: 'd2'.repeat(32), index: 0, output: { lockingBytecode: Uint8Array.of(0x51), valueSatoshis: 5_000n } },
    ]);
    const refusedFor = async (attempt: ReturnType<typeof join>, reason: RegExp) => {
      const before = device.chain.broadcasts;
      await expect(device.applications.preview(attempt)).rejects.toThrow(reason);
      expect(device.chain.broadcasts).toBe(before);
    };
    // At the door's script, without the door's credits: the wallet would have to bring them itself, and has none.
    await refusedFor(join(30_000, `${'d1'.repeat(32)}:0`), /The action needs 1000000 tokens of the category c1c1/);
    await refusedFor(join(30_000, `${'d2'.repeat(32)}:0`), /is at no script of the template/);
    await refusedFor(join(30_000, `${'d0'.repeat(32)}:3`), /is not on chain/);
    await refusedFor(join(30_000, undefined, { inputs: { doorInput: door, lockerInput: door } }), /names a coin for "Locker", which the action does not spend/);
    // Without a name the wallet looks for no coin of the application's.
    await refusedFor(join(30_000, undefined), /The request has to name it by its outpoint; this wallet does not look for such coins itself/);
    await device.applications.carryOut(join(30_000, door));
    // Once spent, the same coin is refused.
    await refusedFor(join(30_000, door), /is spent/);
  });

  it('a value the shared contract does not accept is refused before anything is signed, with the contract that refused it', async () => {
    const { device, door } = await withDoor();
    const before = device.chain.broadcasts;
    await expect(device.applications.preview(join(60_000, door))).rejects.toThrow(/contract, "The club's door" at input 1, does not accept the transaction the wallet worked out/);
    await expect(device.applications.carryOut(join(60_000, door))).rejects.toBeInstanceOf(ActionRefusedError);
    expect(device.chain.broadcasts).toBe(before);
  });

  it('the wallet pays fungible tokens from its own, sends them to a data output as the template says, and keeps what is left; it says what is destroyed and whose it was', async () => {
    const { device, door } = await withDoor();
    const joined = await device.applications.carryOut(join(30_000, door));
    const card = joined.tokens.find(({ amount }) => amount === undefined)?.category as string;
    // Using the locker, as the page asks for it: the door as it now is, the values read from it, the card spent at input 2.
    const use = request(club, 'use', 'member', { burned: 12_000, doorCredits: 970_000, doorState: '0700ffff', keyInput: 2 }, { about: { category: card, spent: true }, inputs: { doorInput: `${joined.transactionId}:1` }, bindings: { holder: 'return' } });
    const preview = await device.applications.preview(use);
    expect(preview.figures.tokensSpent.map(({ token }) => token?.amount)).toEqual([0n, 30_000n]);
    expect(preview.figures.tokensDestroyed).toEqual([{ name: 'Credits spent', token: { category: CLUB, amount: 12_000n }, how: 'data output', wallet: true }]);
    expect(preview.figures.tokensNet).toEqual([{ category: CLUB, amount: -12_000n }]);
    expect(preview.figures.toWallet.map(({ kind, token }) => [kind, token?.amount])).toEqual([['return', 0n], ['token change', 18_000n], ['left over', undefined]]);
    // The locker's deposit comes back: from the application to the wallet.
    expect(preview.figures.intoApplicationSatoshis).toBe(-20_000n);
    const used = await device.applications.carryOut(use);
    const transaction = await transactionOf(device, used.transactionId);
    expect(transaction.outputs[1]).toMatchObject({ lockingBytecode: Uint8Array.of(0x6a), valueSatoshis: 0n, token: { amount: 12_000n } });
    // The card comes back to where it was, the credits left over to a fresh address.
    expect((await device.applications.tokens()).filter((token) => token.category === CLUB).map((token) => token.amount)).toEqual([18_000n]);
  });
});
