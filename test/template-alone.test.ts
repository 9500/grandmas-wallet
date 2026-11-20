import { type TransactionCommon, binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { type MemoryStore, type PositionRecordEntry, positionEntry } from '@grandmas-wallet/archive';
import { type RecordedPosition, ActionRefusedError, NeedsApplicationError, TickNeededError, applicationArchive, applicationConnector, walletAnnouncement } from '@grandmas-wallet/app';
import { type ActionDetails, type Channel, type Proposal, DappRequests, XO_EXTENSION, readAdvertisement, speaks } from '@grandmas-wallet/connect';
import { ADDRESS_KIND, p2pkhLockingBytecode, readTemplate, takeNumber, templateLockingBytecode, walletAddress } from '@grandmas-wallet/core';
import { cloakroomTemplate, keyedStrongboxTemplate, lockerClubTemplate, strongboxTemplate, testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { type Device, deviceWith, finishCopying, presentation, request, seedOf } from './support/applications.js';

/**
 * Acceptance tests PR13 to PR18 and PR22 of the proposal (the first part of stage 14 of the plan): an application
 * from its template alone. Every template here comes with no recovery declaration. The wallet carries out its
 * actions from three things: the template as its author wrote it for XO, the request, and the wallet's own
 * position records (section 13.3).
 *
 * - The Strongbox as it is: its key is not an input of its own; the request says where the key goes in.
 * - The keyed strongbox: its key is an input of its own, at index 0.
 * - The club with lockers: a door every member shares, which the request names by outpoint.
 * - The cloakroom: every guest's coat at one script, which the wallet does not follow; the request names the coat.
 */

const hex = binToHex;
const PAGE = 'https://application.example/club';
const OTHER = 'ab'.repeat(32);
const CLUB = 'c1'.repeat(32);
const elsewhere = p2pkhLockingBytecode(testKey(0x41).keyHash);
const { change, vault } = ADDRESS_KIND;

const plainBox = presentation(strongboxTemplate);
const keyedBox = presentation(keyedStrongboxTemplate);
const club = presentation(lockerClubTemplate);
const cloakroom = presentation(cloakroomTemplate);
type Presented = ReturnType<typeof presentation>;

const definitionOf = (presented: Presented) => readTemplate(presented.texts.template).definition;
const boxAt = (presented: Presented, category: string): Uint8Array => templateLockingBytecode(definitionOf(presented), 'boxLockingScript', { boxKey: category });
const lockerAt = (category: string): Uint8Array => templateLockingBytecode(definitionOf(club), 'lockerLockingScript', { memberKey: category });
const rackAt = templateLockingBytecode(definitionOf(cloakroom), 'rackLockingScript', {});
const doorAt = templateLockingBytecode(definitionOf(club), 'doorLockingScript', {});

const transactionOf = async (device: Device, transactionId: string): Promise<TransactionCommon> => {
  const transaction = decodeTransactionBch(hexToBin((await device.chain.getTransaction(transactionId)) ?? ''));
  if (typeof transaction === 'string') throw new Error(transaction);
  return transaction;
};
/** The number the next address of a kind will get. */
const next = (device: Device, kind: 1 | 2): number => {
  const taken = takeNumber(device.state().allocation, kind);
  return 'number' in taken ? taken.number : -1;
};
const addressOf = (device: Device, kind: 1 | 2, number: number, seed = 0): string => hex(walletAddress(device.identity, seedOf(seed).viewingKey, kind, number).lockingBytecode);
const keyCoinOf = async (device: Device, category: string) => {
  const found = (await device.wallet.parts.tokenCoins()).find(({ coin }) => hex(coin.utxo.output.token?.category ?? new Uint8Array()) === category);
  if (found === undefined) throw new Error('the wallet holds no such token');
  return found.coin;
};
const unreachable = (device: Device, value: boolean): void => {
  for (const store of device.stores.values()) store.unreachable = value;
};
const archiveOf = (device: Device, seedIndex = 0) =>
  applicationArchive({ arrangement: () => device.arrangement, storeAt: (address) => device.stores.get(address) as MemoryStore, seed: seedOf(seedIndex), identity: device.identity, chain: device.chain });
/** The action is refused before the user is asked, and nothing is sent. */
const refused = async (device: Device, attempt: () => Promise<unknown>, reason: RegExp | string): Promise<unknown> => {
  const before = device.chain.broadcasts;
  let thrown: unknown;
  await attempt().then(
    () => expect.unreachable('the action was carried out'),
    (error: unknown) => (thrown = error),
  );
  expect(thrown).toBeInstanceOf(ActionRefusedError);
  expect((thrown as Error).message).toMatch(reason);
  expect(device.chain.broadcasts).toBe(before);
  return thrown;
};

/** A wallet, and the club's door on chain: a minting token of the club's category with 1,000,000 credits. */
const withDoor = async (values: bigint[] = [200_000n]): Promise<{ device: Device; door: string }> => {
  const device = await deviceWith(values);
  const door = { transactionId: 'd0'.repeat(32), index: 2, output: { lockingBytecode: doorAt, valueSatoshis: 1000n, token: { category: hexToBin(CLUB), amount: 1_000_000n, nft: { capability: 'minting' as const, commitment: hexToBin('0700ffff') } } } };
  device.chain.adopt([door]);
  return { device, door: `${door.transactionId}:${door.index}` };
};
/** Joining the club: what the page read from the door it names, and nothing of the wallet's. */
const joinClub = (door: string, more: Partial<Parameters<typeof request>[4]> = {}) =>
  request(club, 'join', 'member', { credits: 30_000, deposit: 20_000, doorCredits: 1_000_000, doorState: '0700ffff', doorNumber: 7 }, { inputs: { doorInput: door }, page: PAGE, ...more });

/**
 * The device is lost and the wallet is recovered: the new device takes over while no store answers, searches,
 * sweeps, then copies the earlier archive (after `meanwhile`, what the holder of the earlier seed does before the
 * copy is complete), reads its backup, trusts the templates the earlier owner stored, and checks the records.
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

/** A connection to the wallet's connector, as an application has it: a pair of queues in memory. */
const connectTo = (device: Device, pairing: string) => {
  let proposals: Proposal[] = [];
  const connector = applicationConnector(device.applications, { onProposals: (open) => (proposals = open) });
  const toWallet: ((message: unknown) => void)[] = [];
  const toDapp: ((message: unknown) => void)[] = [];
  let sequence = 0;
  const end = (out: ((message: unknown) => void)[], incoming: ((message: unknown) => void)[]): Channel => ({
    send: async (message) => {
      for (const handler of [...out]) handler(JSON.parse(JSON.stringify(message)));
    },
    onMessage: (handler) => {
      incoming.push(handler);
      return () => void incoming.splice(incoming.indexOf(handler), 1);
    },
    nextSequence: () => (sequence += 2),
  });
  connector.attach(pairing, end(toDapp, toWallet));
  const dapp = new DappRequests();
  dapp.attach(end(toWallet, toDapp));
  /** Ask for an action, and approve it in the wallet as the user would. */
  const ask = async (details: ActionDetails, presented: Presented): Promise<Record<string, unknown>> => {
    const result = dapp.request(details, presented.texts);
    for (let turn = 0; turn < 40 && proposals.length === 0; turn++) await new Promise((done) => setTimeout(done, 0));
    await proposals[0]?.approve();
    return result;
  };
  return { dapp, ask };
};

describe('an application from its template alone', () => {
  it('PR13: a template that comes with no declaration: an action that creates a token, and one that spends it, with coins of the application\'s named in the request, are carried out from the template, the request and the record', async () => {
    const { device, door } = await withDoor();
    // Joining: the request names the door by its outpoint and gives what the page read from it. The wallet itself
    // works out that the action makes the card's category, and gives its own addresses for the card and the credits.
    const join = joinClub(door);
    expect(join).not.toHaveProperty('creates');
    expect(join).not.toHaveProperty('bindings');
    const preview = await device.applications.preview(join);
    expect(preview.template).not.toHaveProperty('declaration');
    expect(preview.words.outcome).toBe('Joined at door 7 with 30000 credits.');
    expect(preview.figures.applicationInputs.map(({ name, outpoint }) => [name, outpoint])).toEqual([['The club\'s door', door]]);
    expect(preview.figures.toWallet.map(({ kind }) => kind)).toEqual(['left over', 'receive', 'receive']);
    expect(preview.recordsPosition).toBe(true);
    expect(preview.tokensLeaving).toBeUndefined();
    const joined = await device.applications.carryOut(join);
    const card = joined.tokens.find(({ amount }) => amount === undefined)?.category as string;
    const joinedAs = await transactionOf(device, joined.transactionId);
    // The coin that defines the card's category is the wallet's, at input 0; the door is where the template puts it.
    expect(hex(joinedAs.inputs[0]?.outpointTransactionHash as Uint8Array)).toBe(card);
    expect(`${hex(joinedAs.inputs[1]?.outpointTransactionHash as Uint8Array)}:${joinedAs.inputs[1]?.outpointIndex}`).toBe(door);
    // The record, from the transaction as built: the locker's own value, the action's others, the page; no address.
    expect(device.applications.positionRecords).toEqual([
      {
        kind: 'position',
        token: { category: card, commitment: '01', capability: 'none' },
        templateIdentifier: club.names.identifier,
        lockingScriptIdentifier: 'lockerLockingScript',
        roleIdentifier: 'member',
        variables: { memberKey: card },
        values: { credits: '30000', deposit: '20000', doorCredits: '1000000', doorState: '0700ffff', doorNumber: '7' },
        applicationPage: PAGE,
      },
    ]);
    expect(device.applications.templates[0]).not.toHaveProperty('declaration');

    // Using the locker spends the card. The request names the door as it now is, says that the card is spent and
    // where it goes in, and asks for it back where it was. The locker's value is the record's: the request's is not used.
    const doorNow = `${joined.transactionId}:1`;
    const use = request(
      club,
      'use',
      'member',
      { burned: 12_000, doorCredits: 970_000, doorState: '0700ffff', keyInput: 2, memberKey: OTHER },
      { about: { category: card, spent: true }, inputs: { doorInput: doorNow }, bindings: { holder: 'return' } },
    );
    const using = await device.applications.preview(use);
    // The locker was not named: the wallet found it at the script its record gives.
    expect(using.figures.applicationInputs.map(({ name, satoshis }) => [name, satoshis])).toEqual([
      ['The club\'s door', 1000n],
      ['Locker', 20_000n],
    ]);
    expect(using.words.values.find(({ name }) => name === 'Member card')?.value).toBe(card);
    expect(using.figures.toWallet.map(({ kind }) => kind)).toEqual(['return', 'token change', 'left over']);
    expect(using.figures.tokensDestroyed).toEqual([{ name: 'Credits spent', token: { category: CLUB, amount: 12_000n }, how: 'data output', wallet: true }]);
    expect(using.tokensLeaving).toBeUndefined();
    const used = await device.applications.carryOut(use);
    const usedAs = await transactionOf(device, used.transactionId);
    // The card is at input 2, where the request said, and comes back to the script it left.
    expect(hex(usedAs.inputs[2]?.outpointTransactionHash as Uint8Array)).toBe(joined.transactionId);
    expect(hex(usedAs.outputs[2]?.lockingBytecode as Uint8Array)).toBe(hex(joinedAs.outputs[2]?.lockingBytecode as Uint8Array));
    expect(await device.chain.listUnspent(lockerAt(card))).toEqual([]);
    expect(await device.chain.listUnspent(lockerAt(OTHER))).toEqual([]);

    // The same through `xo_v1` in its version 2, with the template whose key is an input of its own: the request
    // names the position by its token and the page's address, and no declaration anywhere.
    const { ask } = connectTo(device, 'an application');
    const opened = (await ask({ template: keyedBox.names, templateAction: 'open', role: 'holder', variables: { amount: 30_000, label: '0a' }, page: PAGE }, keyedBox)) as { tokens: { category: string }[] };
    const key = opened.tokens[0]?.category as string;
    expect(device.applications.positionRecords.at(-1)).toMatchObject({ token: { category: key }, lockingScriptIdentifier: 'boxLockingScript', variables: { boxKey: key }, values: { amount: '30000', label: '0a' }, applicationPage: PAGE });
    // Paying in is about the key and does not spend it; taking out spends it, at the template's own input for it.
    await ask({ template: keyedBox.names, templateAction: 'add', role: 'holder', variables: { amount: 5_000 }, about: { category: key, spent: false } }, keyedBox);
    expect((await device.chain.listUnspent(boxAt(keyedBox, key))).length).toBe(2);
    const keyBefore = await keyCoinOf(device, key);
    const taken = (await ask({ template: keyedBox.names, templateAction: 'take', role: 'holder', variables: {}, about: { category: key, spent: false } }, keyedBox)) as { transactionId: string };
    const takenAs = await transactionOf(device, taken.transactionId);
    expect(`${hex(takenAs.inputs[0]?.outpointTransactionHash as Uint8Array)}:${takenAs.inputs[0]?.outpointIndex}`).toBe(`${hex(keyBefore.utxo.transactionHash)}:${keyBefore.utxo.index}`);
    expect(await device.chain.listUnspent(boxAt(keyedBox, key))).toEqual([]);
  }, 60_000);

  it('PR14: a locking script the wallet\'s role provides: supplied by nobody, by the request, with the kinds `return` and `lasting`; and a variable that nothing fills', async () => {
    const device = await deviceWith([100_000n, 100_000n, 100_000n]);
    // Supplied by nobody: an address of the wallet's, the next of chain 1.
    let first = next(device, change);
    const opened = await device.applications.carryOut(request(keyedBox, 'open', 'holder', { amount: 30_000, label: '01' }));
    const key = opened.tokens[0]?.category as string;
    expect(hex((await transactionOf(device, opened.transactionId)).outputs[1]?.lockingBytecode as Uint8Array)).toBe(addressOf(device, change, first));

    // `return`: the key goes back to the script of the coin it left, and no number is taken for it.
    const keyWas = hex((await keyCoinOf(device, key)).utxo.output.lockingBytecode);
    first = next(device, change);
    const take = request(keyedBox, 'take', 'holder', {}, { about: { category: key, spent: true }, bindings: { holder: 'return' } });
    expect((await device.applications.preview(take)).figures.toWallet.map(({ kind }) => kind)).toEqual(['return', 'left over']);
    const taken = await device.applications.carryOut(take);
    expect(hex((await transactionOf(device, taken.transactionId)).outputs[0]?.lockingBytecode as Uint8Array)).toBe(keyWas);
    expect(next(device, change)).toBe(first + 1);

    // `lasting`: a vault address, stored now and paid later.
    await device.wallet.search({ passes: ['quick'] });
    const vaultNumber = next(device, vault);
    const lasting = await device.applications.carryOut(request(plainBox, 'open', 'holder', { amount: 20_000, label: '02' }, { bindings: { holder: 'lasting' } }));
    expect(hex((await transactionOf(device, lasting.transactionId)).outputs[1]?.lockingBytecode as Uint8Array)).toBe(addressOf(device, vault, vaultNumber));
    expect(next(device, vault)).toBe(vaultNumber + 1);

    // Supplied by the request: someone else's. The credits go there, and the wallet's figures show them leaving it.
    const door = `${'d0'.repeat(32)}:2`;
    device.chain.adopt([{ transactionId: 'd0'.repeat(32), index: 2, output: { lockingBytecode: doorAt, valueSatoshis: 1000n, token: { category: hexToBin(CLUB), amount: 1_000_000n, nft: { capability: 'minting', commitment: hexToBin('0700ffff') } } } }]);
    const joining = request(club, 'join', 'member', { credits: 30_000, deposit: 20_000, doorCredits: 1_000_000, doorState: '0700ffff', doorNumber: 7, creditsHolder: hex(elsewhere) }, { inputs: { doorInput: door } });
    const preview = await device.applications.preview(joining);
    expect(preview.figures.toOthers.find(({ name }) => name === 'Credits')).toMatchObject({ lockingBytecode: hex(elsewhere), token: { category: CLUB, amount: 30_000n } });
    expect(preview.figures.toWallet.map(({ kind }) => kind)).toEqual(['left over', 'receive']);
    expect(preview.figures.tokensNet).toEqual([]);
    await device.applications.carryOut(joining);
    expect(device.chain.outputsAt(elsewhere).map(({ output }) => output.token?.amount)).toEqual([30_000n]);

    // A variable that nothing fills: refused, with the variable named.
    await refused(device, () => device.applications.preview(request(plainBox, 'open', 'holder', { label: '03' })), /needs a value for "Amount"/);
    await refused(device, () => device.applications.carryOut(request(plainBox, 'open', 'holder', { label: '03' })), /needs a value for "Amount", and nothing fills it/);
    // The Strongbox as it is needs to be told where the key goes in; a request that does not say is refused.
    const box = (await device.applications.carryOut(request(plainBox, 'open', 'holder', { amount: 10_000, label: '04' }))).tokens[0]?.category as string;
    await refused(device, () => device.applications.carryOut(request(plainBox, 'take', 'holder', {}, { about: { category: box, spent: true } })), /needs a value for "Key input"/);
  }, 60_000);

  it('PR15: an action that would not return a token of the wallet\'s, and one that would send elsewhere a token made from the wallet\'s coin, are shown as leaving and carried out only with the user\'s tick', async () => {
    const device = await deviceWith([100_000n, 100_000n, 100_000n]);
    const opened = await device.applications.carryOut(request(plainBox, 'open', 'holder', { amount: 30_000, label: '01' }));
    const key = opened.tokens[0]?.category as string;
    // The request sends the key elsewhere. The box's value is the record's; the key goes in at place 1.
    const away = request(plainBox, 'take', 'holder', { keyInput: 1, holder: hex(elsewhere) }, { about: { category: key, spent: true } });
    const preview = await device.applications.preview(away);
    expect(preview.tokensLeaving).toEqual([{ token: { category: key, commitment: '01', capability: 'none' }, how: 'leaves', to: 'Strongbox key' }]);
    expect(preview.figures.toOthers.find(({ name }) => name === 'Strongbox key')).toMatchObject({ lockingBytecode: hex(elsewhere), token: { category: key } });
    const refusal = await refused(device, () => device.applications.carryOut(away), /goes to "Strongbox key", out of the wallet\. It is carried out only when you tick/);
    expect(refusal).toBeInstanceOf(TickNeededError);
    // Changed on the way back: shown too.
    const changed = request(plainBox, 'take', 'holder', { keyInput: 1, label: '02' }, { about: { category: key, spent: true } });
    expect((await device.applications.preview(changed)).tokensLeaving).toEqual([{ token: { category: key, commitment: '01', capability: 'none' }, how: 'changes', to: 'Strongbox key' }]);
    await refused(device, () => device.applications.carryOut(changed), /comes back changed/);
    // With the tick, it is carried out.
    await device.applications.carryOut(away, undefined, { tokensLeave: true });
    expect(device.chain.outputsAt(elsewhere).map(({ output }) => hex(output.token?.category ?? new Uint8Array()))).toEqual([key]);
    expect(await device.chain.listUnspent(boxAt(plainBox, key))).toEqual([]);

    // Leaving a coat makes the ticket from the wallet's coin and puts a token of its category on the rack: it goes to the application.
    const leave = request(cloakroom, 'leave', 'guest', { amount: 20_000 });
    const leaving = await device.applications.preview(leave);
    const ticket = leaving.tokensLeaving?.[0]?.token.category as string;
    expect(leaving.tokensLeaving).toEqual([{ token: { category: ticket, commitment: '00', capability: 'none' }, how: 'leaves', made: true, to: 'Coat' }]);
    await refused(device, () => device.applications.carryOut(leave), /a token made now from the wallet's coin .* goes to "Coat"/);
    const left = await device.applications.carryOut(leave, undefined, { tokensLeave: true });
    expect(left.tokens).toEqual([expect.objectContaining({ category: ticket, commitment: '01' })]);
    expect((await device.chain.listUnspent(rackAt)).map(({ valueSatoshis }) => valueSatoshis)).toEqual([20_000n]);
  }, 60_000);

  it('PR16: from the wallet\'s own list, an action that needs nothing from the application is carried out by the wallet alone; one that needs a coin of the application\'s is done through the application, at its page', async () => {
    const { device, door } = await withDoor([200_000n, 100_000n]);
    await device.applications.carryOut(request(keyedBox, 'open', 'holder', { amount: 30_000, label: '01' }, { page: PAGE }));
    await device.applications.carryOut(joinClub(door));
    const positions = await device.applications.recordedPositions();
    const box = positions.find(({ template }) => template.identifier === keyedBox.names.identifier) as RecordedPosition;
    const locker = positions.find(({ template }) => template.identifier === club.names.identifier) as RecordedPosition;
    expect([box.status, locker.status]).toEqual(['open', 'open']);

    // The box: taking out needs nothing; putting in asks the user for the amount.
    expect(device.applications.offeredActions(box)).toEqual([
      { action: 'take', role: 'holder', name: 'Take everything out', description: expect.any(String) as string },
      { action: 'add', role: 'holder', name: 'Put coins in', description: expect.any(String) as string, asks: [{ variable: 'amount', name: 'Amount', description: 'Satoshis to put in.', type: 'satoshis' }] },
    ]);
    const take = device.applications.actionOn(box, 'take');
    expect(take).toMatchObject({ about: { category: box.token.category, spent: true }, fromWallet: { typed: {} } });
    const before = device.chain.broadcasts;
    const outcome = await device.applications.carryOut(take);
    expect(device.chain.broadcasts).toBe(before + 1);
    expect(outcome.tokens).toEqual([expect.objectContaining({ category: box.token.category, commitment: '01' })]);
    expect(await device.chain.listUnspent(boxAt(keyedBox, box.token.category))).toEqual([]);

    // The locker: using it spends the club's door, which only the application can name.
    const [use] = device.applications.offeredActions(locker);
    expect(use).toMatchObject({ action: 'use', needsApplication: 'It spends a coin of the application\'s, "The club\'s door", which only the application can name.', page: PAGE });
    const error = await refused(device, () => device.applications.carryOut(device.applications.actionOn(locker, 'use', { burned: 1_000, doorCredits: 970_000, keyInput: 2 })), `Open the application to do this: ${PAGE}.`);
    expect(error).toBeInstanceOf(NeedsApplicationError);
    expect((error as NeedsApplicationError).page).toBe(PAGE);
    expect((error as Error).message).toMatch(/"The club's door"/);
  }, 60_000);

  it('PR17: a coin that the request names and that does not belong with the wallet\'s token is refused before the user is asked, by the application\'s own contract', async () => {
    const device = await deviceWith([100_000n, 100_000n, 100_000n]);
    const leave = (amount: number) => device.applications.carryOut(request(cloakroom, 'leave', 'guest', { amount }), undefined, { tokensLeave: true });
    const mine = (await leave(20_000)).tokens[0]?.category as string;
    const theirs = (await leave(25_000)).tokens[0]?.category as string;
    const coatOf = (category: string): string => {
      const coat = device.chain.outputsAt(rackAt).find(({ output }) => hex(output.token?.category ?? new Uint8Array()) === category);
      return `${hex(coat?.transactionHash ?? new Uint8Array())}:${coat?.index}`;
    };
    // Both coats are at the rack, a script the template gives: the coin the request names fits it.
    const collect = (coat: string) => request(cloakroom, 'collect', 'guest', {}, { about: { category: mine, spent: true }, inputs: { rackInput: coat } });
    await refused(device, () => device.applications.preview(collect(coatOf(theirs))), /The application's own contract, "Coat" at input 1, does not accept the transaction the wallet worked out/);
    await refused(device, () => device.applications.carryOut(collect(coatOf(theirs))), /does not accept/);
    // A coin at no script of the template is refused before that.
    const own = (await device.wallet.parts.ownCoins())[0]?.utxo;
    await refused(device, () => device.applications.preview(collect(`${hex(own?.transactionHash ?? new Uint8Array())}:${own?.index}`)), /is at no script of the template "Cloakroom"/);
    // An action that spends a coin of the application's that the request does not name is refused: the wallet does not look for it.
    await refused(device, () => device.applications.preview(request(cloakroom, 'collect', 'guest', {}, { about: { category: mine, spent: true } })), /The request has to name it by its outpoint/);
    // The coat that belongs with the ticket is collected.
    const collected = await device.applications.carryOut(collect(coatOf(mine)));
    expect(collected.tokens).toEqual([expect.objectContaining({ category: mine, commitment: '01' })]);
    expect((await device.chain.listUnspent(rackAt)).map(({ valueSatoshis }) => valueSatoshis)).toEqual([25_000n]);
  }, 60_000);
});

describe('an application from its template alone, after a recovery', () => {
  it('PR18: a positions request after a recovery: a position at a script of its own that counts, and one that does not; one at a script many users share; a token without a record', async () => {
    const device = await deviceWith([100_000n, 100_000n, 100_000n]);
    const box = (await device.applications.carryOut(request(keyedBox, 'open', 'holder', { amount: 30_000, label: '01' }))).tokens[0]?.category as string;
    const ticket = (await device.applications.carryOut(request(cloakroom, 'leave', 'guest', { amount: 20_000 }), undefined, { tokensLeave: true })).tokens[0]?.category as string;
    const [genuine] = device.applications.positionRecords;
    if (genuine === undefined) throw new Error('no record');
    // A token of the box's template that no record names, sent to the wallet by someone.
    const stray = 'e2'.repeat(32);
    device.chain.adopt([{ transactionId: 'e1'.repeat(32), index: 0, output: { lockingBytecode: hexToBin(addressOf(device, change, 0)), valueSatoshis: 1_000n, token: { category: hexToBin(stray), amount: 0n, nft: { capability: 'none', commitment: hexToBin('01') } } } }]);
    const lookAlike: PositionRecordEntry = positionEntry({ ...genuine, variables: { boxKey: OTHER } });
    const taken = await recovered(device, async () => {
      // After the sweep: the holder of the earlier seed pays a look-alike and signs a record that names the wallet's key.
      device.chain.fund(boxAt(keyedBox, OTHER), 25_000n);
      expect((await archiveOf(device).write(lookAlike)).confirmedBy.length).toBeGreaterThan(0);
    });
    expect((await taken.applications.tokens()).map(({ category }) => category).sort()).toEqual([box, ticket, stray].sort());

    // The wallet announces version 2 beside version 1, for the pages of the second design.
    const announced = readAdvertisement({ [XO_EXTENSION]: walletAnnouncement('chipnet') });
    expect(announced !== undefined && speaks(announced, 2) && speaks(announced, 1)).toBe(true);
    expect(announced?.profiles).toEqual(['recoverable-app-v1']);

    // The templates came from the backup: no application is answered until the user allows it.
    const { dapp } = connectTo(taken, 'an application');
    expect(await dapp.recordedPositions(keyedBox.names.identifier)).toEqual({ trusted: false, positions: [] });
    taken.applications.allow(keyedBox.names.identifier, 'an application');
    taken.applications.allow(cloakroom.names.identifier, 'an application');
    const keyCoin = await keyCoinOf(taken, box);
    expect(await dapp.recordedPositions(keyedBox.names.identifier)).toEqual({
      trusted: true,
      positions: [
        { category: box, commitment: '01', capability: 'none', satoshis: String(keyCoin.utxo.output.valueSatoshis), status: 'open', lockingScript: 'boxLockingScript', variables: { boxKey: box } },
        { category: box, commitment: '01', capability: 'none', satoshis: String(keyCoin.utxo.output.valueSatoshis), status: 'unconfirmed', lockingScript: 'boxLockingScript', variables: { boxKey: OTHER } },
      ],
    });
    expect(await dapp.recordedPositions(cloakroom.names.identifier)).toEqual({ trusted: true, positions: [{ category: ticket, commitment: '01', capability: 'none', satoshis: '1000', status: 'held' }] });
    // The token without a record is answered for under no template; the pages of the second design are answered as before.
    expect(JSON.stringify(await dapp.recordedPositions(keyedBox.names.identifier))).not.toContain(stray);
    expect((await dapp.positions(keyedBox.names.identifier)).positions).toEqual([]);

    // The template whose token led to its position through a confirmed record has come back once; the verdict is as it was.
    expect(taken.applications.describe(keyedBox.names)).toMatchObject({ cameBack: true, verdict: { statement: 'not verified' } });
    expect(taken.applications.describe(cloakroom.names)).not.toHaveProperty('cameBack');
  }, 60_000);

  it('PR22: after a recovery, actions from the wallet\'s list on a position whose record the earlier seed made: the key goes to an address of the new seed, and an amount paid in is asked of the user', async () => {
    const device = await deviceWith([100_000n, 100_000n]);
    const opened = await device.applications.carryOut(request(keyedBox, 'open', 'holder', { amount: 30_000, label: '01' }));
    const key = opened.tokens[0]?.category as string;
    const keyFirstAt = hex((await transactionOf(device, opened.transactionId)).outputs[1]?.lockingBytecode as Uint8Array);
    const taken = await recovered(device);
    await taken.receive(50_000n);
    const [position] = await taken.applications.recordedPositions();
    if (position === undefined) throw new Error('no position');
    // The record is the earlier seed's, written again as the new owner's once the chain confirmed it; it holds the
    // amount the box was opened with.
    expect(position).toMatchObject({ status: 'open', standing: 'own', record: { values: { amount: '30000', label: '01' } } });

    // Paying in: the amount is the user's. Without it the action is refused; the record's is never used.
    const add = taken.applications.actionOn(position, 'add');
    expect(add.about).toEqual({ category: key, spent: false });
    await refused(taken, () => taken.applications.carryOut(add), /Give a value for "Amount"/);
    const paid = await taken.applications.carryOut(taken.applications.actionOn(position, 'add', { amount: 5_000 }));
    expect((await transactionOf(taken, paid.transactionId)).outputs[0]).toMatchObject({ lockingBytecode: boxAt(keyedBox, key), valueSatoshis: 5_000n });

    // Taking out: the key comes back to an address of the new seed, not to the one it had when the box was opened.
    const firstOfNewSeed = next(taken, change);
    const out = await taken.applications.carryOut(taken.applications.actionOn(position, 'take'));
    const keyNowAt = hex((await transactionOf(taken, out.transactionId)).outputs[0]?.lockingBytecode as Uint8Array);
    expect(keyNowAt).toBe(addressOf(taken, change, firstOfNewSeed, 1));
    expect(keyNowAt).not.toBe(keyFirstAt);
    expect((await taken.wallet.parts.tokenCoins()).find(({ coin }) => hex(coin.utxo.output.token?.category ?? new Uint8Array()) === key)?.place).toBe('address');
    expect(await taken.chain.listUnspent(boxAt(keyedBox, key))).toEqual([]);
  }, 60_000);
});
