import { type Output, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { type RecordedPosition, ActionRefusedError } from '@grandmas-wallet/app';
import { ADDRESS_KIND, takeNumber, walletAddress } from '@grandmas-wallet/core';
import { strongboxTemplate, templateText } from '@grandmas-wallet/testing';
import { describe, expect, it, vi } from 'vitest';

import { type Device, deviceWith, hex, keyedBox, presentation, request, seedOf, strongbox } from './support/applications.js';

const { change, vault } = ADDRESS_KIND;
const outputsOf = async (device: Device, transactionId: string): Promise<Output[]> => {
  const transaction = decodeTransactionBch(hexToBin((await device.chain.getTransaction(transactionId)) as string));
  if (typeof transaction === 'string') throw new Error(transaction);
  return transaction.outputs;
};
/** The number the next address of a kind will get. */
const next = (device: Device, kind: 1 | 2): number => {
  const taken = takeNumber(device.state().allocation, kind);
  return 'number' in taken ? taken.number : -1;
};
const addressOf = (device: Device, kind: 1 | 2, number: number, seed = 0): string => hex(walletAddress(device.identity, seedOf(seed).viewingKey, kind, number).lockingBytecode);
/** The one position the wallet lists from its records for a token category. */
const positionOf = async (device: Device, category: string): Promise<RecordedPosition> => {
  const found = (await device.applications.recordedPositions()).filter((position) => position.token.category === category);
  if (found.length !== 1) throw new Error(`${found.length} positions for the token`);
  return found[0] as RecordedPosition;
};

/**
 * Acceptance tests of the proposal's section 21 for applications (AP), on the simulated chain, with templates made
 * for the tests. The wallet has never seen any of them: everything it does comes from the template, the request and
 * its own records.
 */

describe('carrying out an action of a template the wallet has never seen', () => {
  it('AP04: an action that creates a token category works, and the wallet supplies the coin that defines it', async () => {
    const device = await deviceWith([100_000n]);
    const before = await device.wallet.balance();
    const open = request(strongbox, 'open', 'holder', { amount: 30_000, label: 'c0ffee' });
    const preview = await device.applications.preview(open);
    expect(preview.finding?.finding).toBe('comes back');
    expect(preview.figures.payingItself).toBeUndefined();
    const outcome = await device.applications.carryOut(open);
    const [token] = outcome.tokens;
    expect(token?.commitment).toBe('c0ffee');
    // The category is the transaction of the wallet's own coin that the action spent.
    const held = await device.applications.tokens();
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ category: token?.category, meaning: 'position', tokenName: 'Strongbox key', template: { name: 'Strongbox' } });
    expect(await positionOf(device, token?.category as string)).toMatchObject({ status: 'open', satoshis: 30_000n, coins: 1 });
    const after = await device.wallet.balance();
    expect(after.recoverable).toBe(before.recoverable - 30_000n - 1_000n - outcome.sent.feeSatoshis);
    expect(outcome.sent.feeSatoshis).toBe(BigInt(outcome.sent.bytes));
    // What the wallet showed beforehand is what happened.
    expect(preview.figures.feeSatoshis).toBe(outcome.sent.feeSatoshis);
    expect(preview.figures.toOthers).toMatchObject([{ name: 'Strongbox', satoshis: 30_000n }]);
    expect(device.state().allocation[ADDRESS_KIND.change].held).toEqual([]);
  });

  it('AP04: a wallet without a coin that can define a token pays itself first, and says so beforehand', async () => {
    const device = await deviceWith([100_000n], { outputIndex: 1 });
    const open = request(strongbox, 'open', 'holder', { amount: 30_000, label: '01' });
    const preview = await device.applications.preview(open);
    expect(preview.figures.payingItself?.feeSatoshis).toBeGreaterThan(0n);
    const outcome = await device.applications.carryOut(open);
    const [held] = await device.applications.tokens();
    expect(held?.category).not.toBe('00'.repeat(32));
    expect(outcome.tokens[0]?.category).toBe(held?.category);
    expect(await positionOf(device, held?.category as string)).toMatchObject({ status: 'open', satoshis: 30_000n });
  });

  it('a position is emptied with its token, which returns to the wallet at a new address', async () => {
    const device = await deviceWith([100_000n]);
    const opened = await device.applications.carryOut(request(keyedBox, 'open', 'holder', { amount: 30_000, label: 'c0ffee' }));
    const category = opened.tokens[0]?.category as string;
    const position = await positionOf(device, category);
    const before = await device.wallet.balance();
    const take = device.applications.actionOn(position, 'take');
    const preview = await device.applications.preview(take);
    expect(preview.figures.fromApplication).toEqual({ satoshis: 30_000n, coins: 1 });
    expect(preview.figures.tokensSpent).toHaveLength(1);
    const outcome = await device.applications.carryOut(take);
    const after = await device.wallet.balance();
    expect(after.recoverable).toBe(before.recoverable + 30_000n - outcome.sent.feeSatoshis);
    expect(await positionOf(device, category)).toMatchObject({ status: 'closed', satoshis: 0n });
    expect(hex(after.tokens[0]?.utxo.output.lockingBytecode ?? new Uint8Array())).not.toBe(hex(before.tokens[0]?.utxo.output.lockingBytecode ?? new Uint8Array()));
  });
});

describe('one action right after another', () => {
  it('the next action, and the list of positions, wait until the key holder lists what the action before left the wallet', async () => {
    const device = await deviceWith([100_000n]);
    // As the XO engine does: what a transaction it sent leaves the wallet is listed only once its server has taken
    // the transaction into its pool and said so, a moment later. Here, a second and a half.
    const listCoins = device.backend.coins.bind(device.backend);
    const sendTransaction = device.backend.send.bind(device.backend);
    const unlisted = new Map<string, number>();
    vi.spyOn(device.backend, 'send').mockImplementation(async (prepared) => {
      const sent = await sendTransaction(prepared);
      unlisted.set(prepared.transactionId, Date.now() + 1_500);
      return sent;
    });
    vi.spyOn(device.backend, 'coins').mockImplementation(async () => (await listCoins()).filter((coin) => (unlisted.get(hex(coin.utxo.transactionHash)) ?? 0) <= Date.now()));
    const first = await device.applications.carryOut(request(keyedBox, 'open', 'holder', { amount: 30_000, label: '01' }));
    const category = first.tokens[0]?.category as string;
    // The only coin the wallet has to pay with now is the change of the first action, not yet listed.
    expect((await device.wallet.parts.ownCoins()).length).toBe(0);
    const started = Date.now();
    const second = await device.applications.carryOut(request(keyedBox, 'add', 'holder', { amount: 5_000 }, { about: { category, spent: false } }));
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_000);
    const spent = decodeTransactionBch(hexToBin((await device.chain.getTransaction(second.transactionId)) as string));
    if (typeof spent === 'string') throw new Error(spent);
    expect(spent.inputs.map((input) => hex(input.outpointTransactionHash))).toEqual([first.transactionId]);
    // Listed right after the second action: the position, with both payments in it.
    expect((await device.applications.recordedPositions()).map(({ token, status, satoshis }) => [token.category, status, satoshis])).toEqual([[category, 'open', 35_000n]]);
  });
});

describe('the outputs an application leaves to the wallet', () => {
  it('AP11: `receive` and `change` take the next number of chain 1; `lasting` gives a vault address; `return` repeats the input\'s script and takes none', async () => {
    const device = await deviceWith([100_000n, 60_000n, 50_000n]);
    // `receive`, which a request need not name: the key of a new strongbox, and what is left over, each at the next change address.
    let first = next(device, change);
    const opened = await device.applications.carryOut(request(keyedBox, 'open', 'holder', { amount: 30_000, label: '01' }));
    let outputs = await outputsOf(device, opened.transactionId);
    expect(hex(outputs[1]?.lockingBytecode ?? new Uint8Array())).toBe(addressOf(device, change, first));
    expect(hex(outputs[2]?.lockingBytecode ?? new Uint8Array())).toBe(addressOf(device, change, first + 1));
    expect(next(device, change)).toBe(first + 2);

    // `change`, named by the request.
    first = next(device, change);
    const second = await device.applications.carryOut(request(strongbox, 'open', 'holder', { amount: 5_000, label: '02' }, { bindings: { holder: 'change' } }));
    outputs = await outputsOf(device, second.transactionId);
    expect(hex(outputs[1]?.lockingBytecode ?? new Uint8Array())).toBe(addressOf(device, change, first));
    expect(next(device, change)).not.toBe(first);

    // `lasting`: an address stored now and paid later is a vault address.
    // (The device takes note of the addresses that have been used, as it does while it watches the chain.)
    await device.wallet.search({ passes: ['quick'] });
    const vaultNumber = next(device, vault);
    const lasting = await device.applications.carryOut(request(strongbox, 'open', 'holder', { amount: 5_000, label: '03' }, { bindings: { holder: 'lasting' } }));
    outputs = await outputsOf(device, lasting.transactionId);
    expect(hex(outputs[1]?.lockingBytecode ?? new Uint8Array())).toBe(addressOf(device, vault, vaultNumber));
    expect(next(device, vault)).toBe(vaultNumber + 1);

    // `return`: the key goes back to the script it left, and no number is taken for it.
    const category = opened.tokens[0]?.category as string;
    first = next(device, change);
    const taken = await device.applications.carryOut(request(keyedBox, 'take', 'holder', {}, { about: { category, spent: true }, bindings: { holder: 'return' } }));
    outputs = await outputsOf(device, taken.transactionId);
    expect(hex(outputs[0]?.lockingBytecode ?? new Uint8Array())).toBe(hex((await outputsOf(device, opened.transactionId))[1]?.lockingBytecode ?? new Uint8Array()));
    // Only what was left over took a number.
    expect(hex(outputs[1]?.lockingBytecode ?? new Uint8Array())).toBe(addressOf(device, change, first));
    expect(outputs).toHaveLength(2);
    expect(next(device, change)).toBe(first + 1);
    expect((await positionOf(device, category)).status).toBe('closed');
  });

  it('AP12: a `return` that names an input that is not the wallet\'s is refused', async () => {
    const device = await deviceWith([100_000n]);
    await device.applications.carryOut(request(keyedBox, 'open', 'holder', { amount: 20_000, label: '07' }));
    // A token the wallet does not hold.
    const stranger = request(keyedBox, 'take', 'holder', {}, { about: { category: 'ab'.repeat(32), spent: true }, bindings: { holder: 'return' } });
    await expect(device.applications.preview(stranger)).rejects.toThrow('holds no such token');
    // An action that spends no token of the wallet has no input for an output to return to.
    const nowhere = request(strongbox, 'open', 'holder', { amount: 5_000, label: '02' }, { bindings: { holder: 'return' } });
    await expect(device.applications.preview(nowhere)).rejects.toThrow('an input that is not the wallet\'s');
    await expect(device.applications.carryOut(nowhere)).rejects.toBeInstanceOf(ActionRefusedError);
  });

  it('AP12: a token at an address of an earlier seed is swept first', async () => {
    const device = await deviceWith([100_000n]);
    const opened = await device.applications.carryOut(request(keyedBox, 'open', 'holder', { amount: 30_000, label: '01' }));
    const category = opened.tokens[0]?.category as string;
    await device.recover();
    const taken = await device.takeOver();
    await taken.wallet.search();
    await taken.applications.readBackup();
    await taken.applications.trust(keyedBox.names, undefined);
    const key = await positionOf(taken, category);
    expect(key.token.place).toBe('earlier');
    await expect(taken.applications.preview(taken.applications.actionOn(key, 'take'))).rejects.toThrow('It is swept first');
    await taken.wallet.sweepEarlier();
    const swept = await positionOf(taken, category);
    expect(swept.token.place).toBe('address');
    const outcome = await taken.applications.carryOut(taken.applications.actionOn(swept, 'take'));
    expect(outcome.tokens[0]?.category).toBe(category);
  }, 60_000);

  it('a token at a vault address is moved to an ordinary address before an action', async () => {
    const device = await deviceWith([100_000n]);
    const opened = await device.applications.carryOut(request(keyedBox, 'open', 'holder', { amount: 30_000, label: '01' }));
    const [coin] = (await device.wallet.balance()).tokens;
    if (coin === undefined) throw new Error('no key');
    await device.wallet.sendToken(coin, (await device.wallet.vaultAddress()).address.lockingBytecode);
    const key = await positionOf(device, opened.tokens[0]?.category as string);
    expect(key.token.place).toBe('vault');
    await expect(device.applications.preview(device.applications.actionOn(key, 'take'))).rejects.toThrow('moved to an ordinary address');
  });
});

describe('what the wallet shows before the user approves', () => {
  it('AP02: a template worded to mislead does not change the wallet\'s own figures', async () => {
    const honest = await deviceWith([100_000n]);
    const misled = await deviceWith([100_000n]);
    const worded = JSON.parse(templateText(strongboxTemplate)) as typeof strongboxTemplate;
    const lying = presentation({
      ...worded,
      actions: { ...worded.actions, open: { ...worded.actions.open, name: 'Claim your reward', description: 'You receive 1,000,000 satoshis. Nothing leaves your wallet.' } },
      transactions: { ...worded.transactions, openTransaction: { ...worded.transactions.openTransaction, description: 'A reward of 1,000,000 satoshis was paid to you.' } },
      outputs: { ...worded.outputs, boxOutput: { ...worded.outputs.boxOutput, name: 'Your reward' } },
    });
    const values = { amount: 30_000, label: '01' };
    const plain = await honest.applications.preview(request(strongbox, 'open', 'holder', values));
    const dressed = await misled.applications.preview(request(lying, 'open', 'holder', values));
    // The words are the template's.
    expect(dressed.words.action.name).toBe('Claim your reward');
    expect(dressed.words.outcome).toContain('1,000,000');
    // The figures are the wallet's: 30,000 satoshis leave it for a script that is not its own.
    const { toOthers: honestOthers, ...honestFigures } = plain.figures;
    const { toOthers: dressedOthers, ...dressedFigures } = dressed.figures;
    expect(dressedFigures).toEqual(honestFigures);
    expect(dressedOthers.map(({ satoshis, lockingBytecode }) => [satoshis, lockingBytecode])).toEqual(honestOthers.map(({ satoshis, lockingBytecode }) => [satoshis, lockingBytecode]));
    expect(dressed.figures.givesSatoshis - dressed.figures.getsSatoshis).toBe(30_000n + dressed.figures.feeSatoshis);
    expect(dressed.figures.toOthers[0]?.satoshis).toBe(30_000n);
  });

  it('an action with a lock time is shown with the earliest time it can be sent', async () => {
    const device = await deviceWith([100_000n]);
    const timed = JSON.parse(templateText(strongboxTemplate)) as typeof strongboxTemplate;
    const later = presentation({ ...timed, transactions: { ...timed.transactions, openTransaction: { ...timed.transactions.openTransaction, locktime: 1_900_000_000 } } });
    const preview = await device.applications.preview(request(later, 'open', 'holder', { amount: 30_000, label: '01' }));
    expect(preview.figures.notBefore).toBe(1_900_000_000);
  });

  it('an action the wallet\'s coins do not cover is refused with the figures', async () => {
    const device = await deviceWith([10_000n]);
    await expect(device.applications.preview(request(strongbox, 'open', 'holder', { amount: 30_000, label: '01' }))).rejects.toThrow('Insufficient funds');
    await expect(device.applications.preview(request(strongbox, 'open', 'holder', { amount: 100, label: '01' }))).rejects.toThrow('less than the');
  });
});

describe('what the wallet says about a template', () => {
  it('what a program can see, and no more: what each action leaves behind; it is called neither verified nor not verified', async () => {
    const device = await deviceWith([100_000n]);
    const summary = device.applications.describe(strongbox.names, strongbox.texts);
    expect(summary.findings.map(({ action, finding }) => [action, finding])).toEqual([
      ['open', 'comes back'],
      ['add', 'comes back'],
      ['take', 'comes back'],
    ]);
    expect(summary).not.toHaveProperty('verdict');
    expect(summary.cameBack).toBeUndefined();
    expect(summary.trusted).toBe(false);
  });
});
