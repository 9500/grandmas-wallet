import { binToHex, hexToBin } from '@bitauth/libauth';
import { type ArchiveStore, type MemoryStore, type PositionRecordEntry, MemoryStore as Store, assessArchive, positionEntry, readArchive } from '@grandmas-wallet/archive';
import { type RecordedPosition, ActionRefusedError, applicationArchive, checkPositionRecord } from '@grandmas-wallet/app';
import { buildTransaction, p2pkhInput, p2pkhLockingBytecode, readControllerHistory, readTemplate, templateLockingBytecode } from '@grandmas-wallet/core';
import { strongboxTemplate, testKey } from '@grandmas-wallet/testing';
import { describe, expect, it, vi } from 'vitest';

import { type Device, STORES, deviceWith, finishCopying, presentation, request, seedOf, strongbox } from './support/applications.js';

/**
 * Acceptance tests PR03 to PR07, PR12, PR23 and PR24 of the proposal (stage 13 of the plan): the check of a
 * position record against the chain (section 10.4), the positions the wallet lists from its records, and the
 * rule for a position that is not confirmed: the wallet carries out an action there only when its own figures
 * show that it gives nothing but the fee.
 *
 * Every template here comes alone, with nothing beside it.
 */

const hex = binToHex;
/** A category of someone else's: what a look-alike script is made with. */
const OTHER = 'ab'.repeat(32);
const elsewhere = p2pkhLockingBytecode(testKey(0x41).keyHash);

type Presented = ReturnType<typeof presentation>;
const definitionOf = (presented: Presented) => readTemplate(presented.texts.template).definition;
const boxAt = (presented: Presented, category: string, lockingScript = 'boxLockingScript'): Uint8Array => templateLockingBytecode(definitionOf(presented), lockingScript, { boxKey: category });
/** A request to open a box of a template without a declaration: the request says which variable gets the new category, and which is the wallet's address. */
const openBox = (presented: Presented, label: string, more: Record<string, string | number> = {}) => request(presented, 'open', 'holder', { amount: 30_000, label, ...more }, { creates: 'boxKey', bindings: { holder: 'receive' } });
/** A plain payment into a box, naming no token of the wallet's. */
const payInto = (presented: Presented, category: string, amount = 5_000) => request(presented, 'add', 'holder', { boxKey: category, amount });

const plainBox = presentation(strongboxTemplate);
/** The strongbox with the key as an input of its own, at index 0, as the Savings Jar of stage 11 has it. */
const keyedBox = presentation({
  ...strongboxTemplate,
  name: 'Keyed strongbox',
  actions: { ...strongboxTemplate.actions, take: { ...strongboxTemplate.actions.take, roles: { holder: { requirements: { variables: ['boxKey', 'holder', 'label'] } } } } },
  transactions: { ...strongboxTemplate.transactions, takeTransaction: { ...strongboxTemplate.transactions.takeTransaction, inputs: [{ input: 'boxKeyInput', inputIndex: 0 }, { input: 'boxInput' }] } },
  inputs: { ...strongboxTemplate.inputs, boxKeyInput: { name: 'Strongbox key', description: 'The box\'s key, spent and given back.', token: { category: '$(<boxKey>)' } } },
  scripts: { ...strongboxTemplate.scripts, unlockBox: '<0>' },
});
/** The strongbox with a key that can mint. */
const mintingBox = presentation({
  ...strongboxTemplate,
  name: 'Minting strongbox',
  outputs: { ...strongboxTemplate.outputs, keyOutput: { ...strongboxTemplate.outputs.keyOutput, token: { ...strongboxTemplate.outputs.keyOutput.token, nft: { capability: 'minting', commitment: '$(<label>)' } } } },
});
/** The strongbox whose opening makes a second key of the same category, for someone else. */
const twinBox = presentation({
  ...strongboxTemplate,
  name: 'Twin strongbox',
  actions: { ...strongboxTemplate.actions, open: { ...strongboxTemplate.actions.open, roles: { holder: { requirements: { variables: ['boxKey', 'amount', 'holder', 'label', 'spareLabel', 'spareHolder'] } } } } },
  transactions: { ...strongboxTemplate.transactions, openTransaction: { ...strongboxTemplate.transactions.openTransaction, outputs: [{ output: 'boxOutput' }, { output: 'keyOutput' }, { output: 'spareOutput' }] } },
  outputs: {
    ...strongboxTemplate.outputs,
    spareOutput: { name: 'Spare key', description: 'A second key, for someone else.', lockingScript: '$(<spareHolder>)', valueSatoshis: '1000', token: { category: '$(<boxKey>)', amount: null, nft: { capability: 'none', commitment: '$(<spareLabel>)' } } },
  },
  variables: {
    ...strongboxTemplate.variables,
    spareLabel: { name: 'Spare label', description: 'What is written on the second key.', type: 'bytes' },
    spareHolder: { name: 'Spare holder', description: 'Who gets the second key.', type: 'locking_script' },
  },
});
/** The strongbox with a second script, the safe, that a later action moves the position to. */
const movingBox = presentation({
    ...strongboxTemplate,
    name: 'Moving strongbox',
    actions: {
      ...strongboxTemplate.actions,
      move: {
        name: 'Move to the safe',
        description: 'Move everything in the box to the safe.',
        roles: { holder: { requirements: { variables: ['boxKey', 'holder', 'label', 'keyInput', 'amount'] } } },
        requirements: { participants: [{ role: 'holder', slots: { min: 1, max: 1 } }] },
        transaction: 'moveTransaction',
      },
    },
    transactions: { ...strongboxTemplate.transactions, moveTransaction: { name: 'Moved', description: 'Moved to the safe.', inputs: [{ input: 'boxInput' }], outputs: [{ output: 'safeOutput' }, { output: 'keyOutput' }], version: 2, locktime: 0 } },
    outputs: { ...strongboxTemplate.outputs, safeOutput: { name: 'Safe', description: '$(<amount>) satoshis in the safe.', lockingScript: 'safeLockingScript', valueSatoshis: '$(<amount>)' } },
    lockingScripts: {
      ...strongboxTemplate.lockingScripts,
      safeLockingScript: { name: 'Safe', description: 'Opens for whoever spends the box\'s key.', lockingType: 'p2sh', lockingBytecode: 'safeBytecode', unlockingBytecode: 'unlockBox', state: { variables: ['boxKey'] }, roles: { holder: { balance: { satoshis: true }, selectable: false, actions: [] } } },
    },
    scripts: { ...strongboxTemplate.scripts, safeBytecode: '<"safe"> OP_DROP OP_UTXOTOKENCATEGORY <$(<boxKey> OP_REVERSEBYTES)> OP_EQUAL' },
});

const unreachable = (device: Device, value: boolean): void => {
  for (const store of device.stores.values()) store.unreachable = value;
};
/** The device's archive for applications, under the seed of the given index: what the holder of that seed can write to. */
const archiveOf = (device: Device, seedIndex = 0) =>
  applicationArchive({ arrangement: () => device.arrangement, storeAt: (address) => device.stores.get(address) as MemoryStore, seed: seedOf(seedIndex), identity: device.identity, chain: device.chain });
/** The position records an archive holds, each with whose it is, as a reader assesses them. */
const positionsOn = async (device: Device, access = device.arrangement.archive, stores: ArchiveStore[] = [...device.stores.values()]) => {
  const contents = await readArchive(hexToBin(access.archiveId), hexToBin(access.contentKey), stores);
  return assessArchive(contents, { network: 'testnet', history: await readControllerHistory(device.chain, device.identity) }).positions;
};
const keyCoinOf = async (device: Device, category: string) => {
  const found = (await device.wallet.parts.tokenCoins()).find(({ coin }) => hex(coin.utxo.output.token?.category ?? new Uint8Array()) === category);
  if (found === undefined) throw new Error('the wallet holds no such key');
  return found.coin;
};
/**
 * What the holder of a seed can do with a key not yet swept: spend it in a payment of the wallet's own that pays
 * a script of their choice and gives the key back where it was.
 */
const payWithKey = async (device: Device, category: string, lockingBytecode: Uint8Array, valueSatoshis = 20_000n): Promise<string> => {
  const coin = await keyCoinOf(device, category);
  return (await device.wallet.pay([{ lockingBytecode, valueSatoshis }, { ...coin.utxo.output }], [coin])).transactionId;
};
/** An ordinary payment to a script, from someone with no token of the wallet's. */
const someonePays = (device: Device, lockingBytecode: Uint8Array, valueSatoshis: bigint): void => {
  const payer = testKey(0x43);
  const payerAt = p2pkhLockingBytecode(payer.keyHash);
  const funded = device.chain.fund(payerAt, valueSatoshis + 1_000n);
  const coin = device.chain.outputsAt(payerAt).find((candidate) => hex(candidate.transactionHash) === funded);
  if (coin === undefined) throw new Error('no coin');
  const built = buildTransaction({ inputs: [p2pkhInput(coin, payer)], outputs: [{ lockingBytecode, valueSatoshis }], changeLockingBytecode: payerAt });
  expect(device.chain.submit(hex(built.encoded))).toMatchObject({ accepted: true });
};
/** A record that names the wallet's token and another script of the same template. */
const lookAlike = (genuine: PositionRecordEntry, category = OTHER): PositionRecordEntry => positionEntry({ ...genuine, variables: { boxKey: category } });
/**
 * The device is lost and the wallet is recovered: the new device takes over while no store answers, searches,
 * sweeps, then copies the earlier archive (after `meanwhile`, what the holder of the earlier seed does before the
 * copy is complete), reads its backup and trusts the template the earlier owner stored.
 */
const recovered = async (device: Device, meanwhile: () => Promise<void> = async () => undefined): Promise<Device> => {
  await device.recover();
  unreachable(device, true);
  const taken = await device.takeOver();
  unreachable(device, false);
  await taken.wallet.search();
  await taken.wallet.sweepEarlier();
  await meanwhile();
  await finishCopying(taken);
  await taken.applications.readBackup();
  for (const suggested of taken.applications.suggestions) await taken.applications.trust(suggested, undefined);
  await taken.applications.confirmRecords();
  return taken;
};
const listed = (positions: RecordedPosition[]) => positions.map(({ status, lockingBytecode, satoshis }) => ({ status, lockingBytecode, satoshis }));
/** The action is refused before the user is asked, with the reason, and nothing is sent. */
const refusedThere = async (device: Device, action: ReturnType<typeof request>): Promise<void> => {
  const before = device.chain.broadcasts;
  await expect(device.applications.preview(action)).rejects.toThrow(/This position is not confirmed: .* gives nothing but the fee/);
  await expect(device.applications.carryOut(action)).rejects.toBeInstanceOf(ActionRefusedError);
  expect(device.chain.broadcasts).toBe(before);
};

describe('the check of a position record, and positions from records', () => {
  it('PR03: the device is lost with a position open; after the recovery the new device reads the record, the chain confirms it, the position is listed, and the wallet carries an action out by itself', async () => {
    const device = await deviceWith([100_000n]);
    const opened = await device.applications.carryOut(request(strongbox, 'open', 'holder', { amount: 30_000, label: '01' }));
    const category = opened.tokens[0]?.category as string;
    const [record] = device.applications.positionRecords;
    if (record === undefined) throw new Error('no record');

    await device.recover();
    const taken = await device.takeOver();
    await taken.wallet.search();
    await taken.wallet.sweepEarlier();
    // The new device reads the record from a store. It is a suggestion; its template is not trusted yet here.
    await taken.applications.readBackup();
    expect(taken.applications.suggestedRecords).toEqual([record]);
    expect(taken.applications.positionRecords).toEqual([]);
    // Until the user trusts it, the record cannot be checked: the token is listed as one of a template not trusted, with
    // that template to trust, and not as a position the chain does not confirm.
    expect(await taken.applications.recordedPositions()).toEqual([]);
    expect(await taken.applications.tokens()).toMatchObject([{ category, meaning: 'incomplete', template: { identifier: strongbox.names.identifier } }]);

    // The user trusts the template the earlier owner stored; the chain confirms the record.
    const [suggested] = taken.applications.suggestions;
    await taken.applications.trust(suggested as NonNullable<typeof suggested>, undefined);
    const lookups = { history: vi.spyOn(taken.chain, 'getHistory'), transactions: vi.spyOn(taken.chain, 'getTransaction') };
    const verdict = await checkPositionRecord(record, taken.wallet.parts, readTemplate(strongbox.texts.template));
    expect(verdict).toMatchObject({ counts: true, carriedIn: opened.transactionId });
    // From the script's side: one history, and the one transaction in it.
    expect(lookups.history).toHaveBeenCalledTimes(1);
    expect(lookups.transactions).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    // It is written again as the new owner's own, with the earlier record's values, and the key holder follows its script.
    const following = vi.spyOn(taken.backend, 'followScript');
    expect(await taken.applications.confirmRecords()).toEqual({ confirmed: 1, suggested: 0, followed: 1, notFollowed: [] });
    expect(following).toHaveBeenCalledWith({ template: strongbox.names.identifier, lockingScript: 'boxLockingScript', role: 'holder', variables: { boxKey: category } });
    expect(taken.applications.positionRecords).toEqual([record]);
    expect((await positionsOn(taken, taken.arrangement.archive)).filter(({ standing }) => standing === 'current owner').map(({ entry }) => entry)).toEqual([record]);

    // The position is listed, open, under the template's name.
    const [position] = await taken.applications.recordedPositions();
    expect(position).toMatchObject({ status: 'open', satoshis: 30_000n, coins: 1, standing: 'own', template: { identifier: strongbox.names.identifier, name: 'Strongbox' }, actions: ['take'], token: { category, commitment: '01', capability: 'none', place: 'address' } });
    // The wallet takes everything out by itself, with no application asked.
    // The key's input comes after the box's: the user gives its number, which the template asks for.
    const outcome = await taken.applications.carryOut(taken.applications.actionOn(position as RecordedPosition, 'take', { keyInput: 1 }));
    expect(outcome.tokens).toEqual([expect.objectContaining({ category, commitment: '01' })]);
    expect(await taken.chain.listUnspent(boxAt(strongbox, category))).toEqual([]);
    expect(listed(await taken.applications.recordedPositions())).toEqual([{ status: 'closed', lockingBytecode: hex(boxAt(strongbox, category)), satoshis: 0n }]);
  }, 60_000);

  it('PR04: after the sweep, the holder of the earlier seed pays a look-alike script and signs a record that names the wallet\'s token: it is shown as not confirmed, never as the position, and paying in is refused', async () => {
    const device = await deviceWith([100_000n, 100_000n]);
    const opened = await device.applications.carryOut(openBox(plainBox, '01'));
    const category = opened.tokens[0]?.category as string;
    const [genuine] = device.applications.positionRecords;
    if (genuine === undefined) throw new Error('no record');
    const taken = await recovered(device, async () => {
      // After the sweep: the key is out of the earlier seed's reach. Its holder pays a look-alike from elsewhere and signs a record for it.
      someonePays(device, boxAt(plainBox, OTHER), 25_000n);
      expect((await archiveOf(device).write(lookAlike(genuine))).confirmedBy.length).toBeGreaterThan(0);
    });
    expect(taken.applications.suggestedRecords).toEqual([lookAlike(genuine)]);
    expect(taken.applications.positionRecords).toEqual([genuine]);
    const positions = await taken.applications.recordedPositions();
    expect(listed(positions)).toEqual([
      { status: 'open', lockingBytecode: hex(boxAt(plainBox, category)), satoshis: 30_000n },
      { status: 'unconfirmed', lockingBytecode: hex(boxAt(plainBox, OTHER)), satoshis: 25_000n },
    ]);
    expect(positions[1]?.reason).toBe('No transaction that paid the record\'s script carried its NFT.');
    // Paying into the look-alike is refused; paying into the position is not.
    await refusedThere(taken, payInto(plainBox, OTHER));
    await taken.receive(50_000n);
    await taken.applications.carryOut(payInto(plainBox, category));
    expect((await taken.chain.listUnspent(boxAt(plainBox, category))).length).toBe(2);
    expect((await taken.chain.listUnspent(boxAt(plainBox, OTHER))).length).toBe(1);
  }, 60_000);

  it('PR05: at a position that is not confirmed, an action whose figures show the wallet giving nothing but the fee is carried out, and any other is refused', async () => {
    const device = await deviceWith([100_000n, 100_000n]);
    const opened = await device.applications.carryOut(request(strongbox, 'open', 'holder', { amount: 30_000, label: '01' }));
    const category = opened.tokens[0]?.category as string;
    const [genuine] = device.applications.positionRecords;
    if (genuine === undefined) throw new Error('no record');
    // A second script that the key's own transaction paid, and a record for it: two records count, and both scripts hold coins.
    await payWithKey(device, category, boxAt(strongbox, OTHER));
    await archiveOf(device).write(lookAlike(genuine));
    await device.applications.readBackup();
    const positions = await device.applications.recordedPositions();
    expect(positions.map(({ status }) => status)).toEqual(['unconfirmed', 'unconfirmed']);
    expect(positions[0]?.reason).toMatch(/2 records count for this token and the scripts of more than one hold coins/);

    const key = positions.find((position) => position.lockingBytecode === hex(boxAt(strongbox, category))) as RecordedPosition;
    // Paying in: the wallet would give more than the fee.
    await refusedThere(device, device.applications.actionOn(key, 'add', { amount: 1_000 }));
    // Taking everything out: the wallet gives its key and the fee, and gets the key and the box's coins back.
    const take = device.applications.actionOn(key, 'take', { keyInput: 1 });
    const preview = await device.applications.preview(take);
    expect(preview.notConfirmed).toMatch(/more than one hold coins/);
    expect(preview.figures.intoApplicationSatoshis).toBe(-30_000n);
    const outcome = await device.applications.carryOut(take);
    expect(outcome.tokens).toEqual([expect.objectContaining({ category })]);
    expect(await device.chain.listUnspent(boxAt(strongbox, category))).toEqual([]);
  }, 60_000);

  it('PR06: a position moved to another script by a later action has two records that count; the one whose script holds coins is the current one, and the other is not listed', async () => {
    const device = await deviceWith([100_000n, 100_000n]);
    const opened = await device.applications.carryOut(request(movingBox, 'open', 'holder', { amount: 30_000, label: '01' }));
    const category = opened.tokens[0]?.category as string;
    expect(listed(await device.applications.recordedPositions())).toEqual([{ status: 'open', lockingBytecode: hex(boxAt(movingBox, category)), satoshis: 30_000n }]);
    const [box] = await device.applications.recordedPositions();
    // The amount is the record's, the key's place the user's to give.
    const move = device.applications.actionOn(box as RecordedPosition, 'move', { keyInput: 1 });
    expect((await device.applications.preview(move)).recordsPosition).toBe(true);
    await device.applications.carryOut(move);
    const [atBox, atSafe] = device.applications.positionRecords;
    expect([atBox?.lockingScriptIdentifier, atSafe?.lockingScriptIdentifier]).toEqual(['boxLockingScript', 'safeLockingScript']);
    // Both count: each was paid by a transaction that carried the key.
    const template = readTemplate(movingBox.texts.template);
    for (const record of [atBox, atSafe]) expect((await checkPositionRecord(record as PositionRecordEntry, device.wallet.parts, template)).counts).toBe(true);
    // The safe holds the coins: it is the position. The box's record is not listed.
    const positions = await device.applications.recordedPositions();
    expect(listed(positions)).toEqual([{ status: 'open', lockingBytecode: hex(boxAt(movingBox, category, 'safeLockingScript')), satoshis: 30_000n }]);
    expect(positions[0]?.record).toEqual(atSafe);
  }, 60_000);

  it('PR07: an application that makes several NFTs of one category: a record that matches by commitment is confirmed, one that cannot be told apart is not', async () => {
    const device = await deviceWith([100_000n, 100_000n]);
    const spareHolder = hex(elsewhere);
    // Two keys of one category, with different commitments: the wallet's is told apart by its commitment.
    // The spare key is made from the wallet's coin and goes elsewhere: the user ticks that (section 13.3).
    const apart = await device.applications.carryOut(openBox(twinBox, '01', { spareLabel: '02', spareHolder }), undefined, { tokensLeave: true });
    // Two keys alike in everything: which one is the wallet's cannot be told.
    const alike = await device.applications.carryOut(openBox(twinBox, '03', { spareLabel: '03', spareHolder }), undefined, { tokensLeave: true });
    const [first, second] = [apart, alike].map((outcome) => outcome.tokens[0]?.category as string);
    expect(device.chain.outputsAt(elsewhere).map((coin) => [hex(coin.output.token?.category ?? new Uint8Array()), hex(coin.output.token?.nft?.commitment ?? new Uint8Array())])).toEqual([
      [first, '02'],
      [second, '03'],
    ]);
    const positions = await device.applications.recordedPositions();
    expect(positions.map(({ token, status }) => [token.category, status])).toEqual([
      [first, 'open'],
      [second, 'unconfirmed'],
    ]);
    expect(positions[1]?.reason).toBe(`Transaction ${alike.transactionId} carried more than one NFT like the record's: they cannot be told apart.`);
  });

  it('PR12: every copy of a record is gone: the token is swept, listed and can be sent; no position is shown; an action the application asks for with it is carried out only where the wallet gives nothing but the fee', async () => {
    const device = await deviceWith([100_000n]);
    const opened = await device.applications.carryOut(request(strongbox, 'open', 'holder', { amount: 30_000, label: '01' }));
    const category = opened.tokens[0]?.category as string;
    // The device is lost, and the stores lose everything they held.
    for (const address of STORES) device.stores.set(address, new Store(address));
    await device.recover();
    const taken = await device.takeOver();
    await taken.wallet.search();
    const swept = await taken.wallet.sweepEarlier();
    expect(swept.tokens).toEqual([{ category, meaning: 'unknown' }]);
    await taken.receive(50_000n);
    await taken.applications.readBackup();
    expect([...taken.applications.positionRecords, ...taken.applications.suggestedRecords]).toEqual([]);
    // The token is listed, and no position.
    const [key] = await taken.applications.tokens();
    expect(key).toMatchObject({ category, commitment: '01', meaning: 'unknown', place: 'address' });
    expect(await taken.applications.recordedPositions()).toEqual([]);
    // The application asks, naming the box's coin: paying in is refused, taking everything out is carried out.
    await refusedThere(taken, request(strongbox, 'add', 'holder', { boxKey: category, amount: 5_000 }, { about: { category, spent: false } }));
    const outcome = await taken.applications.carryOut(request(strongbox, 'take', 'holder', { label: '01', keyInput: 1 }, { about: { category, spent: true }, inputs: { boxInput: `${opened.transactionId}:0` } }));
    expect(outcome.tokens).toEqual([expect.objectContaining({ category, commitment: '01' })]);
    expect(await taken.chain.listUnspent(boxAt(strongbox, category))).toEqual([]);
    // The token can be sent, unchanged.
    const held = await keyCoinOf(taken, category);
    await taken.wallet.sendTokens({ kind: 'nft', outpoint: `${hex(held.utxo.transactionHash)}:${held.utxo.index}`, to: elsewhere });
    expect(taken.chain.outputsAt(elsewhere).map((coin) => hex(coin.output.token?.category ?? new Uint8Array()))).toEqual([category]);
  }, 60_000);

  it('PR23: before the sweep, the holder of the earlier seed spends the key in a transaction that pays a script of their own and gives the key back, and later signs a record for it: with a template that names the key as an input, the record does not count', async () => {
    const device = await deviceWith([100_000n, 100_000n]);
    const opened = await device.applications.carryOut(openBox(keyedBox, '01'));
    const category = opened.tokens[0]?.category as string;
    const [genuine] = device.applications.positionRecords;
    if (genuine === undefined) throw new Error('no record');
    // Before the sweep: the key pays the box of another category, and comes back.
    const trap = await payWithKey(device, category, boxAt(keyedBox, OTHER));
    const taken = await recovered(device, async () => void (await archiveOf(device).write(lookAlike(genuine))));
    const verdict = await checkPositionRecord(lookAlike(genuine), taken.wallet.parts, readTemplate(keyedBox.texts.template));
    expect(verdict).toMatchObject({ counts: false });
    expect(verdict.reason).toMatch(/names the position's token as the input "Strongbox key".*another token's category/);
    // Points 1 to 3 alone would have let it count: the trap carried the key and paid the script.
    expect((await taken.chain.getHistory(boxAt(keyedBox, OTHER))).map(({ transactionId }) => transactionId)).toEqual([trap]);
    expect(listed(await taken.applications.recordedPositions())).toEqual([
      { status: 'open', lockingBytecode: hex(boxAt(keyedBox, category)), satoshis: 30_000n },
      { status: 'unconfirmed', lockingBytecode: hex(boxAt(keyedBox, OTHER)), satoshis: 20_000n },
    ]);
    await taken.receive(50_000n);
    await refusedThere(taken, payInto(keyedBox, OTHER));
  }, 60_000);

  it('PR23: the same with a template that does not name the key as an input, while the genuine position holds coins: both are shown as not confirmed, and nothing is paid into either', async () => {
    const device = await deviceWith([100_000n, 100_000n]);
    const opened = await device.applications.carryOut(openBox(plainBox, '01'));
    const category = opened.tokens[0]?.category as string;
    const [genuine] = device.applications.positionRecords;
    if (genuine === undefined) throw new Error('no record');
    await payWithKey(device, category, boxAt(plainBox, OTHER));
    const taken = await recovered(device, async () => void (await archiveOf(device).write(lookAlike(genuine))));
    // The trap passes points 1 to 3, and there is no point 4 for this template.
    expect((await checkPositionRecord(lookAlike(genuine), taken.wallet.parts, readTemplate(plainBox.texts.template))).counts).toBe(true);
    const positions = await taken.applications.recordedPositions();
    expect(listed(positions)).toEqual([
      { status: 'unconfirmed', lockingBytecode: hex(boxAt(plainBox, category)), satoshis: 30_000n },
      { status: 'unconfirmed', lockingBytecode: hex(boxAt(plainBox, OTHER)), satoshis: 20_000n },
    ]);
    expect(positions.map(({ standing }) => standing)).toEqual(['own', 'own']);
    await taken.receive(50_000n);
    await refusedThere(taken, payInto(plainBox, category));
    await refusedThere(taken, payInto(plainBox, OTHER));
  }, 60_000);

  it('PR24: a record whose NFT differs from the wallet\'s only in its commitment or its capability does not count', async () => {
    const device = await deviceWith([100_000n]);
    const opened = await device.applications.carryOut(openBox(plainBox, '01'));
    const category = opened.tokens[0]?.category as string;
    const [genuine] = device.applications.positionRecords;
    if (genuine === undefined) throw new Error('no record');
    const template = readTemplate(plainBox.texts.template);
    const check = (record: PositionRecordEntry) => checkPositionRecord(record, device.wallet.parts, template);
    expect((await check(genuine)).counts).toBe(true);
    for (const token of [
      { category, commitment: '02', capability: 'none' as const },
      { category, commitment: '01', capability: 'mutable' as const },
      { category, commitment: '01', capability: 'minting' as const },
    ]) {
      const verdict = await check(positionEntry({ ...genuine, token }));
      expect(verdict.counts).toBe(false);
    }
    expect((await check(positionEntry({ ...genuine, token: { category, commitment: '02', capability: 'none' } }))).reason).toBe('The wallet\'s NFT of the record\'s category differs from the record\'s in its commitment or its capability.');
    expect((await check(positionEntry({ ...genuine, token: { category, commitment: '01', capability: 'minting' } }))).reason).toBe('No transaction that paid the record\'s script carried its NFT.');
  });

  it('PR24: a token that can mint, of which a copy exists, counts only where it is followed back to the wallet\'s coin without a fork', async () => {
    const device = await deviceWith([100_000n, 100_000n, 100_000n]);
    const opened = await device.applications.carryOut(openBox(mintingBox, '01'));
    const category = opened.tokens[0]?.category as string;
    const [genuine] = device.applications.positionRecords;
    if (genuine === undefined) throw new Error('no record');
    expect(genuine.token).toEqual({ category, commitment: '01', capability: 'minting' });
    const template = readTemplate(mintingBox.texts.template);
    const check = (record: PositionRecordEntry) => checkPositionRecord(record, device.wallet.parts, template);
    expect(await check(genuine)).toMatchObject({ counts: true, carriedIn: opened.transactionId });

    // A copy is made: the key goes back to the wallet, and one alike in everything goes elsewhere.
    const key = await keyCoinOf(device, category);
    const copier = testKey(0x42);
    const copierAt = p2pkhLockingBytecode(copier.keyHash);
    const fork = (await device.wallet.pay([{ ...key.utxo.output }, { ...key.utxo.output, lockingBytecode: copierAt }], [key])).transactionId;
    // The record of the opening no longer counts: the way back passes the copy.
    const after = await check(genuine);
    expect(after.counts).toBe(false);
    expect(after.reason).toContain(`Transaction ${fork} made another NFT that can stand for it`);

    // The copy pays a script of its holder's making; a record for it names the wallet's token.
    const [copy] = device.chain.outputsAt(copierAt);
    device.chain.fund(copierAt, 10_000n);
    const [, fee] = device.chain.outputsAt(copierAt);
    if (copy === undefined || fee === undefined) throw new Error('no copy');
    const paid = buildTransaction({ inputs: [p2pkhInput(copy, copier), p2pkhInput(fee, copier)], outputs: [{ ...copy.output }, { lockingBytecode: boxAt(mintingBox, OTHER), valueSatoshis: 5_000n }], changeLockingBytecode: copierAt });
    expect(device.chain.submit(hex(paid.encoded))).toMatchObject({ accepted: true });
    const ofTheCopy = lookAlike(genuine);
    expect((await check(ofTheCopy)).counts).toBe(false);

    // A transaction after the copy, on the wallet's side: the wallet's own key pays a script, and comes back.
    const later = await payWithKey(device, category, boxAt(mintingBox, 'cd'.repeat(32)));
    const ofTheWallet = lookAlike(genuine, 'cd'.repeat(32));
    expect(await check(ofTheWallet)).toMatchObject({ counts: true, carriedIn: later });
  });
});

