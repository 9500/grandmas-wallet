import { binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { ActionRefusedError, readDeclaration } from '@grandmas-wallet/app';
import { readTemplate, templateLockingBytecode } from '@grandmas-wallet/core';
import { clubDeclaration, clubTemplate } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { type Device, deviceWith, presentation, request } from './support/applications.js';

/**
 * What an application's template can ask of the wallet besides its own position (stage 9, written for a
 * template made for the tests): contracts every user of the application shares, which the wallet finds on
 * chain or checks when a page names them; values read from those coins, whole or in part; places in the
 * transaction that the template fixes; fungible tokens the wallet pays with, with what is left of them coming
 * back; tokens sent to a data output; and the application's own contracts evaluated before anything is signed.
 */

const club = presentation(clubTemplate, clubDeclaration);
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
const join = (credits: number, more: Parameters<typeof request>[4] = {}) => request(club, 'join', 'member', { credits, deposit: 20_000 }, more);
const transactionOf = async (device: Device, transactionId: string) => {
  const transaction = decodeTransactionBch(hexToBin((await device.chain.getTransaction(transactionId)) ?? ''));
  if (typeof transaction === 'string') throw new Error(transaction);
  return transaction;
};

describe('an application\'s shared contracts, fungible tokens and places in the transaction', () => {
  it('the wallet finds the shared contract on chain, reads values from it, and puts its own coin and output where the template leaves room', async () => {
    const { device, door } = await withDoor();
    const preview = await device.applications.preview(join(30_000));
    // Read from the door's coin: its credits, its commitment, and the commitment's first two bytes as a number.
    expect(preview.words.outcome).toBe('Joined at door 7 with 30000 credits.');
    expect(preview.figures.applicationInputs).toEqual([{ name: 'The club\'s door', outpoint: door, satoshis: 1000n, token: { category: CLUB, amount: 1_000_000n, nft: { capability: 'minting', commitment: '0700ffff' } } }]);
    const outcome = await device.applications.carryOut(join(30_000));
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

  it('a coin the page names is used when it is the template\'s, and refused when it is not', async () => {
    const { device, door } = await withDoor();
    device.chain.adopt([
      { transactionId: 'd1'.repeat(32), index: 0, output: { lockingBytecode: doorAt, valueSatoshis: 5_000n } },
      { transactionId: 'd2'.repeat(32), index: 0, output: { lockingBytecode: Uint8Array.of(0x51), valueSatoshis: 5_000n } },
    ]);
    const refusedFor = async (outpoint: string, reason: RegExp) => {
      const before = device.chain.broadcasts;
      await expect(device.applications.preview(join(30_000, { inputs: { doorInput: outpoint } }))).rejects.toThrow(reason);
      expect(device.chain.broadcasts).toBe(before);
    };
    await refusedFor(`${'d1'.repeat(32)}:0`, /is not what the template's declaration says is spent there/);
    await refusedFor(`${'d2'.repeat(32)}:0`, /is not unspent at the script the template gives it/);
    await refusedFor(`${'d0'.repeat(32)}:3`, /is not unspent/);
    await expect(device.applications.preview(join(30_000, { inputs: { lockerInput: door } }))).rejects.toThrow(/the template's declaration does not say what may be spent there/);
    // Without a name the wallet takes the coin that fits, and passes over the one that does not.
    expect((await device.applications.preview(join(30_000))).figures.applicationInputs[0]?.outpoint).toBe(door);
    await device.applications.carryOut(join(30_000, { inputs: { doorInput: door } }));
  });

  it('a value the shared contract does not accept is refused before anything is signed, with the contract that refused it', async () => {
    const { device } = await withDoor();
    const before = device.chain.broadcasts;
    await expect(device.applications.preview(join(60_000))).rejects.toThrow(/contract, "The club's door" at input 1, does not accept the transaction the wallet worked out/);
    await expect(device.applications.carryOut(join(60_000))).rejects.toBeInstanceOf(ActionRefusedError);
    expect(device.chain.broadcasts).toBe(before);
  });

  it('the wallet pays fungible tokens from its own, sends them to a data output as the template says, and keeps what is left; it says what is destroyed and whose it was', async () => {
    const { device } = await withDoor();
    const joined = await device.applications.carryOut(join(30_000));
    const card = (await device.applications.tokens()).find((token) => token.category === joined.tokens[0]?.category);
    if (card === undefined) throw new Error('no card');
    // From the wallet's own list: the amount to spend is the user's to give.
    expect(card.actions).toEqual([{ action: 'use', role: 'member', name: 'Use the locker', description: expect.any(String) as string, asks: [{ variable: 'burned', name: 'Credits to spend', description: 'Credits the locker takes.', type: 'token_amount' }] }]);
    const use = device.applications.actionOn(card, 'use', { burned: '12000' });
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

  it('an action that needs a value only the application works out is offered through the application only', async () => {
    const declared = { ...clubDeclaration, actions: { ...clubDeclaration.actions, use: { ...clubDeclaration.actions.use, fromApplication: ['burned'] } } };
    const presented = presentation(clubTemplate, declared);
    expect(readDeclaration(presented.texts.declaration as string).declaration.actions['use']?.fromApplication).toEqual(['burned']);
    const { device } = await withDoor();
    const joined = await device.applications.carryOut(request(presented, 'join', 'member', { credits: 30_000, deposit: 20_000 }));
    const card = (await device.applications.tokens()).find((token) => token.category === joined.tokens[0]?.category);
    expect(card?.actions?.[0]?.needsApplication).toBe('It needs values that the application works out: "Credits to spend".');
    expect(card?.actions?.[0]?.asks).toBeUndefined();
  });

  it('declarations with the new parts are read, and wrong ones refused', () => {
    const read = (declaration: object) => readDeclaration(presentation(clubTemplate, declaration).texts.declaration as string);
    expect(read(clubDeclaration).declaration.actions['join']?.inputs?.['doorInput']).toEqual({ lockingScript: 'doorLockingScript', token: { category: CLUB, capability: 'minting' } });
    expect(() => read({ ...clubDeclaration, actions: { join: { ...clubDeclaration.actions.join, variables: { doorState: 'input.doorInput.script' } } } })).toThrow(/not something a wallet can read/);
    expect(() => read({ ...clubDeclaration, actions: { join: { ...clubDeclaration.actions.join, inputs: { doorInput: { lockingScript: 'doorLockingScript', token: { capability: 'owner' } } } } } })).toThrow(/capability that is not known/);
    expect(read({ ...clubDeclaration, actions: { join: { ...clubDeclaration.actions.join, variables: { doorNumber: 'position.commitment[1..7]' } } } }).declaration.actions['join']?.variables).toEqual({ doorNumber: 'position.commitment[1..7]' });
  });

  it('the template made for these tests passes the wallet\'s check of the three rules; a declaration that names what the template does not have is a violation', async () => {
    const { device } = await withDoor();
    expect(device.applications.describe(club.names, club.texts).verdict.statement).toBe('not verified');
    const wrong = presentation(clubTemplate, { ...clubDeclaration, actions: { ...clubDeclaration.actions, use: { ...clubDeclaration.actions.use, companion: 'markerInput', inputs: { doorInput: { lockingScript: 'gateLockingScript' } }, fromApplication: ['stamp'] } } });
    const verdict = device.applications.describe(wrong.names, wrong.texts).verdict;
    expect(verdict.statement).toBe('violation');
    expect(verdict.statement === 'violation' ? verdict.violations.map(({ what }) => what) : []).toEqual([
      'The action "use" spends the coin its position was found through as the input "markerInput", which the template does not have.',
      'The action "use" finds the input "doorInput" at the locking script "gateLockingScript", which the template does not have.',
      'The action "use" leaves "stamp" to the application, and the template has no such variable.',
    ]);
  });
});
