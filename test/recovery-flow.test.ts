import { hexToBin } from '@bitauth/libauth';
import { MemoryStore } from '@grandmas-wallet/archive';
import {
  type OwnerWalletState,
  type RecoveryArrangement,
  OwnerWallet,
  RecovererWallet,
  acceptEnrollment,
  acceptTakeover,
  acceptUpdate,
  checkRecovery,
  completeTakeover,
  enroll,
  finishMove,
  finishTakeover,
  kitTemplates,
  makeChange,
  prepareNewSeed,
  sendUpdate,
  startTakeover,
  walletTemplateNumbers,
} from '@grandmas-wallet/app';
import { deriveSeedKeys, p2pkhLockingBytecode } from '@grandmas-wallet/core';
import { type KeptKit, ENROLLMENT_LINK_BUDGET, credentialKeys, generateRecipientKeyPair } from '@grandmas-wallet/enrollment';
import { KeyBackend, SimulatedChain } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

/**
 * The three devices relying on each other, with the wallets' own code on the simulated chain and backup
 * stores in memory: enrolling a recoverer, recovery shown as on only with its receipt (RC04 at the wallet),
 * a takeover from the first message to the sweep, a device lost right after a recovery or a move (MG02), and
 * the changes made with the old device still working: a new seed (MG01), a new recoverer, a new waiting
 * period, each stopped and repeated at every step (MG08).
 */

const numbers = walletTemplateNumbers();
const WORDS = [
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
  'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
];
const CREDENTIAL_WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const DELAY = { unit: 'time512', value: 1 } as const;
const STORES = ['https://store1.example', 'https://store2.example'];
const seedOf = (index: number) => deriveSeedKeys(WORDS[index] as string, 'testnet', numbers);

/** A wallet of the first seed, created with the credential's recovery key as its recoverer; the recoverer's device with its own encryption key. */
const start = async () => {
  const chain = new SimulatedChain();
  const stores = new Map(STORES.map((address) => [address, new MemoryStore(address)]));
  const storeAt = (address: string): MemoryStore => stores.get(address) as MemoryStore;
  const first = seedOf(0);
  const credential = credentialKeys(CREDENTIAL_WORDS, 'testnet', kitTemplates());
  const owner = await OwnerWallet.open({ backend: new KeyBackend(chain, first), chain, seed: first });
  chain.fund(p2pkhLockingBytecode(first.fundingKey.keyHash), 100_000n);
  await owner.create({ recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: DELAY, allowance: { feeLockingBytecode: p2pkhLockingBytecode(credential.feeKey.keyHash), satoshis: 20_000n } });
  const identity = hexToBin(owner.stored.identity as string);
  const recovererDevice = await generateRecipientKeyPair();
  const recipient = { name: 'recoverer.example', page: 'https://recoverer.example/', publicKey: recovererDevice.publicKey };
  const recovererWallet = () =>
    RecovererWallet.open({ backend: new KeyBackend(chain, { controllerKey: credential.recoveryKey, fundingKey: credential.feeKey, addressKey: () => credential.feeKey }), chain, identity });
  /** The owner enrolls the recoverer; the recoverer takes the link in and leaves its receipt. */
  const enrolled = async () => {
    const sent = await enroll({ wallet: owner, seed: first, chain, credential: { words: CREDENTIAL_WORDS }, recipient, stores: STORES, storeAt, madeAt: 1_794_950_000 });
    const taken = await acceptEnrollment({ link: sent.link, privateKey: recovererDevice.privateKey, chain, network: 'testnet', storeAt });
    return { arrangement: sent.arrangement, kept: taken.kept, recoveryKey: taken.recoveryKey };
  };
  /** A recovery to the device of the seed with the given index, from its takeover message to the wallet it ends up with. */
  const recover = async (index: number, kept: KeptKit, recoveryKey: Awaited<ReturnType<typeof enrolled>>['recoveryKey'], options: { loseBeforeHandOver?: boolean } = {}) => {
    const seed = seedOf(index);
    const asked = await startTakeover({ seed, stores: STORES, storeAt, recovererPublicKey: recovererDevice.publicKey });
    const saved = await acceptTakeover({ sealed: asked.sealed, privateKey: recovererDevice.privateKey, kept, chain });
    expect(saved.fingerprint).toBe(asked.pending.fingerprint);
    const recoverer = await recovererWallet();
    await recoverer.request(saved.proposedKeyHash);
    chain.nowMs += 2 * 512 * 1000;
    await recoverer.complete();
    if (options.loseBeforeHandOver === true) return { kept: saved.kept, seed };
    const handed = await completeTakeover({ kept: saved.kept, chain, recoveryKey, storeAt });
    let state: OwnerWalletState | undefined;
    const taken = await finishTakeover({ sealedHandOver: handed.sealed, pending: asked.pending, seed, backend: new KeyBackend(chain, seed), chain, save: (next) => (state = next) });
    return { kept: handed.kept, seed, ...taken, state: () => state as OwnerWalletState };
  };
  return { chain, stores, storeAt, owner, first, identity, credential, recovererDevice, recipient, recovererWallet, enrolled, recover };
};

describe('enrolling a recoverer', () => {
  it('RC04: recovery is shown as on only once the recoverer\'s receipt for this kit is on the stores', async () => {
    const { chain, storeAt, owner, first, recipient, recovererDevice } = await start();
    expect(owner.recovery).toBe('off');
    // Nothing was sent: there is nothing a receipt could answer.
    expect((await checkRecovery({ wallet: owner, chain, arrangement: undefined, storeAt, network: 'testnet' })).status.on).toBe(false);

    const sent = await enroll({ wallet: owner, seed: first, chain, credential: { words: CREDENTIAL_WORDS }, recipient, stores: STORES, storeAt, madeAt: 1_794_950_000 });
    expect(sent.link.length).toBeLessThanOrEqual(ENROLLMENT_LINK_BUDGET);
    // The stores have confirmed the viewing-key record. That is not a receipt.
    const before = await checkRecovery({ wallet: owner, chain, arrangement: sent.arrangement, storeAt, network: 'testnet' });
    expect(before.status).toEqual({ on: false, reasons: ['The recoverer has left no receipt.'] });
    expect(owner.recovery).toBe('off');

    // The recoverer takes the link in, checks it against the chain, keeps the kit and leaves its receipt.
    let savedFirst = false;
    const taken = await acceptEnrollment({ link: sent.link, privateKey: recovererDevice.privateKey, chain, network: 'testnet', storeAt, save: () => void (savedFirst = true) });
    expect(savedFirst).toBe(true);
    expect(taken.kept.kit.identity).toBe(owner.stored.identity);
    const after = await checkRecovery({ wallet: owner, chain, arrangement: sent.arrangement, storeAt, network: 'testnet' });
    expect(after.status.on).toBe(true);
    expect(after.arrangement?.latestReceiptHash).toBe(taken.kept.latestReceiptHash);
    expect(owner.recovery).toBe('on');

    // A second kit is sent, for instance after the first link was lost. Recovery is off until that one is answered.
    const again = await enroll({ wallet: owner, seed: first, chain, credential: { words: CREDENTIAL_WORDS }, recipient, stores: STORES, storeAt, arrangement: after.arrangement as RecoveryArrangement, madeAt: 1_794_960_000 });
    expect(owner.recovery).toBe('off');
    const waiting = await checkRecovery({ wallet: owner, chain, arrangement: again.arrangement, storeAt, network: 'testnet' });
    expect(waiting.status.on).toBe(false);
    expect(waiting.status.reasons).toEqual(['A receipt does not count: it answers another message than the one this wallet sent.']);
    await acceptEnrollment({ link: again.link, privateKey: recovererDevice.privateKey, chain, network: 'testnet', storeAt });
    expect((await checkRecovery({ wallet: owner, chain, arrangement: again.arrangement, storeAt, network: 'testnet' })).status.on).toBe(true);
  });

  it('a recoverer is not enrolled when no store confirms the viewing-key record, and nothing is sent', async () => {
    const { chain, stores, storeAt, owner, first, recipient } = await start();
    for (const store of stores.values()) store.unreachable = true;
    await expect(enroll({ wallet: owner, seed: first, chain, credential: { words: CREDENTIAL_WORDS }, recipient, stores: STORES, storeAt, madeAt: 1 })).rejects.toThrow(/No backup store confirmed this seed's viewing-key record/);
    expect(owner.recovery).toBe('off');
    // With one store back, the record is kept there and the kit is made.
    (stores.get(STORES[1] as string) as MemoryStore).unreachable = false;
    const sent = await enroll({ wallet: owner, seed: first, chain, credential: { words: CREDENTIAL_WORDS }, recipient, stores: STORES, storeAt, madeAt: 1 });
    expect(sent.arrangement.sent).toBeDefined();
  });

  it('with no store in reach, the device says that it could not look for a receipt', async () => {
    const { chain, stores, storeAt, owner, enrolled } = await start();
    const { arrangement } = await enrolled();
    for (const store of stores.values()) store.unreachable = true;
    const status = await checkRecovery({ wallet: owner, chain, arrangement, storeAt, network: 'testnet' });
    expect(status.status.on).toBe(false);
    expect(status.status.reasons).toEqual(['No backup store could be reached, so no receipt could be looked for.']);
  });
});

describe('a takeover, from the first message to the sweep', () => {
  it('the new device learns the identity only after completion, finds the earlier coins and has recovery on again', async () => {
    const { chain, storeAt, owner, identity, enrolled, recover } = await start();
    const { kept, recoveryKey } = await enrolled();
    chain.fund((await owner.receiveAddress()).address.lockingBytecode, 10_000n);
    chain.fund((await owner.vaultAddress()).address.lockingBytecode, 5_000n);
    const before = await owner.balance();
    const held = before.recoverable + before.cancelling + before.vault;

    const taken = await recover(1, kept, recoveryKey);
    if (!('wallet' in taken)) throw new Error('the takeover was to finish');
    expect(taken.wallet.stored.identity).toBe(owner.stored.identity);
    expect(taken.missing).toEqual([]);
    // The receipt in the hand-over names the new device's viewing-key record: recovery is on again.
    expect(taken.recovery.on).toBe(true);
    expect(taken.wallet.recovery).toBe('on');
    // The same is found on the stores later, in the new device's own archive.
    expect((await checkRecovery({ wallet: taken.wallet, chain, arrangement: taken.arrangement, storeAt, network: 'testnet' })).status.on).toBe(true);
    // The recoverer holds both seeds' records and both archives.
    expect(taken.kept.viewingKeyRecords).toHaveLength(2);
    expect(taken.kept.archives).toHaveLength(2);
    expect(taken.kept.pending).toBeUndefined();

    expect((await taken.wallet.search()).status).toBe('fully-found');
    expect((await taken.wallet.balance()).toSweep).toBe(held);
    await taken.wallet.sweepEarlier();
    expect((await taken.wallet.balance()).toSweep).toBe(0n);
    // The old device, if it turns up, sees that it no longer owns the wallet.
    expect(await owner.checkOwnership()).toBe('another key');
    expect(identity).toHaveLength(32);
  }, 60_000);

  it('a hand-over opened by another device than the one that asked is refused', async () => {
    const { chain, storeAt, enrolled, recovererDevice, recovererWallet } = await start();
    const { kept, recoveryKey } = await enrolled();
    const seed = seedOf(1);
    const asked = await startTakeover({ seed, stores: STORES, storeAt, recovererPublicKey: recovererDevice.publicKey });
    const saved = await acceptTakeover({ sealed: asked.sealed, privateKey: recovererDevice.privateKey, kept, chain });
    // Before completion nothing is handed over.
    await expect(completeTakeover({ kept: saved.kept, chain, recoveryKey, storeAt })).rejects.toThrow(/only after the recovery is complete/);
    const recoverer = await recovererWallet();
    await recoverer.request(saved.proposedKeyHash);
    chain.nowMs += 2 * 512 * 1000;
    await recoverer.complete();
    const handed = await completeTakeover({ kept: saved.kept, chain, recoveryKey, storeAt });
    const stranger = await generateRecipientKeyPair();
    const other = { ...asked.pending, answerKey: { publicKey: asked.pending.answerKey.publicKey, privateKey: Buffer.from(stranger.privateKey).toString('hex') } };
    await expect(finishTakeover({ sealedHandOver: handed.sealed, pending: other, seed, backend: new KeyBackend(chain, seed), chain })).rejects.toThrow();
    // A device of another seed is not the owner, whatever it is handed.
    const wrong = seedOf(2);
    await expect(finishTakeover({ sealedHandOver: handed.sealed, pending: asked.pending, seed: wrong, backend: new KeyBackend(chain, wrong), chain })).rejects.toThrow(/not the owner/);
  });
});

describe('a device lost right after a recovery', () => {
  it('MG02: lost after the hand-over, another recovery succeeds and the third device finds the coins of both earlier seeds', async () => {
    const { chain, owner, enrolled, recover } = await start();
    const { kept, recoveryKey } = await enrolled();
    chain.fund((await owner.receiveAddress()).address.lockingBytecode, 10_000n);
    const second = await recover(1, kept, recoveryKey);
    if (!('wallet' in second)) throw new Error('the takeover was to finish');
    // The second device gives out an address and is paid there. It has swept nothing yet. Then it is lost.
    chain.fund((await second.wallet.receiveAddress()).address.lockingBytecode, 8_000n);

    const third = await recover(2, second.kept, recoveryKey);
    if (!('wallet' in third)) throw new Error('the takeover was to finish');
    expect(third.missing).toEqual([]);
    expect(third.kept.viewingKeyRecords).toHaveLength(3);
    expect(third.arrangement.earlierViewingKeyRecords).toHaveLength(2);
    expect(third.arrangement.earlierArchives).toHaveLength(2);
    // The quick pass over both earlier seeds is enough to see their coins; the full pass is covered elsewhere.
    await third.wallet.search({ passes: ['quick'] });
    const balance = await third.wallet.balance();
    const first = await owner.balance();
    expect(balance.toSweep).toBe(first.recoverable + first.cancelling + 8_000n);
    expect(third.wallet.recovery).toBe('on');
  });

  it('MG02: lost between the completion and the hand-over, its viewing key and archive stay with the recoverer', async () => {
    const { chain, enrolled, recover } = await start();
    const { kept, recoveryKey } = await enrolled();
    // The second device's key owns the wallet; the device is lost before it is handed anything.
    const second = await recover(1, kept, recoveryKey, { loseBeforeHandOver: true });
    expect(second.kept.pending).toBeDefined();
    expect(second.kept.viewingKeyRecords).toHaveLength(1);

    const third = await recover(2, second.kept, recoveryKey);
    if (!('wallet' in third)) throw new Error('the takeover was to finish');
    // The recoverer kept the second seed's record when the third takeover message arrived.
    expect(third.kept.viewingKeyRecords).toHaveLength(3);
    expect(third.kept.archives).toHaveLength(3);
    expect(third.missing).toEqual([]);
    expect(third.arrangement.earlierViewingKeyRecords).toHaveLength(2);
    expect(third.wallet.stored.earlierSeeds).toHaveLength(2);
    expect(chain.nowMs).toBeGreaterThan(0);
  });

  it('a takeover that was never completed is replaced by the next one and leaves nothing behind', async () => {
    const { chain, storeAt, enrolled, recover, recovererDevice } = await start();
    const { kept, recoveryKey } = await enrolled();
    // A device asks and no request follows: the recoverer was not satisfied that it is the user's.
    const asked = await startTakeover({ seed: seedOf(1), stores: STORES, storeAt, recovererPublicKey: recovererDevice.publicKey });
    const saved = await acceptTakeover({ sealed: asked.sealed, privateKey: recovererDevice.privateKey, kept, chain });
    const third = await recover(2, saved.kept, recoveryKey);
    if (!('wallet' in third)) throw new Error('the takeover was to finish');
    expect(third.kept.viewingKeyRecords).toHaveLength(2);
    expect(third.arrangement.earlierViewingKeyRecords).toHaveLength(1);
  });
});

describe('a move to a new seed with the old device still working', () => {
  /** An enrolled wallet with a coin, and a new device that has prepared its seed. */
  const prepared = async () => {
    const made = await start();
    const { arrangement, kept, recoveryKey } = await made.enrolled();
    made.chain.fund((await made.owner.receiveAddress()).address.lockingBytecode, 10_000n);
    const next = seedOf(1);
    const preparation = await prepareNewSeed({ seed: next, stores: STORES, storeAt: made.storeAt });
    return { ...made, arrangement, kept, recoveryKey, next, preparation };
  };

  it('MG01: the recoverer\'s prepared receipt comes first; then the move needs no waiting period, and recovery is on for the new seed at once', async () => {
    const { chain, storeAt, owner, first, recipient, recovererDevice, arrangement, kept, recoveryKey, next, preparation } = await prepared();
    const clock = chain.nowMs;
    const announced = await sendUpdate({ wallet: owner, seed: first, chain, arrangement, recipient, newSeed: preparation });
    if (announced.handOver === undefined) throw new Error('a move hands the wallet over');
    // Without the recoverer's prepared receipt the old device does not make the change.
    await expect(makeChange({ wallet: owner, chain, arrangement: announced.arrangement, storeAt, network: 'testnet' })).rejects.toThrow(/prepared receipt for this change is not on the backup stores/);
    // And the new device has no wallet: the chain does not name its key.
    const finish = () => finishMove({ handOver: announced.handOver as NonNullable<typeof announced.handOver>, preparation, seed: next, backend: new KeyBackend(chain, next), chain, storeAt });
    await expect(finish()).rejects.toThrow(/has not made the change yet/);

    const updated = await acceptUpdate({ sealed: announced.sealed, privateKey: recovererDevice.privateKey, kept, chain, recoveryKey, storeAt });
    expect(updated.kept.viewingKeyRecords).toHaveLength(2);
    // The receipt was prepared for a change that has not happened: recovery is still on for the old seed, by the earlier receipt.
    expect((await checkRecovery({ wallet: owner, chain, arrangement: announced.arrangement, storeAt, network: 'testnet' })).status.on).toBe(true);

    const changed = await makeChange({ wallet: owner, chain, arrangement: announced.arrangement, storeAt, network: 'testnet' });
    expect(changed.sent).toBeDefined();
    expect(changed.arrangement.movedTo).toBe(preparation.proposedKeyHash);
    expect(chain.nowMs).toBe(clock);
    expect(await owner.checkOwnership()).toBe('another key');

    const moved = await finish();
    expect(moved.missing).toEqual([]);
    expect(moved.recovery.on).toBe(true);
    expect(moved.wallet.recovery).toBe('on');
    await moved.wallet.search({ passes: ['quick'] });
    const before = (await moved.wallet.balance()).toSweep;
    expect(before).toBeGreaterThan(10_000n);
    await moved.wallet.sweepEarlier();
    expect((await moved.wallet.balance()).toSweep).toBe(0n);
    // The earlier seed can move nothing that was swept.
    expect(await owner.balance()).toMatchObject({ recoverable: 0n, cancelling: 0n });
  });

  it('MG02: the new device is lost right after the move; the recoverer holds its viewing key and archive, and another recovery succeeds', async () => {
    const { chain, storeAt, owner, first, recipient, recovererDevice, arrangement, kept, recoveryKey, preparation, recover } = await prepared();
    const announced = await sendUpdate({ wallet: owner, seed: first, chain, arrangement, recipient, newSeed: preparation });
    const updated = await acceptUpdate({ sealed: announced.sealed, privateKey: recovererDevice.privateKey, kept, chain, recoveryKey, storeAt });
    await makeChange({ wallet: owner, chain, arrangement: announced.arrangement, storeAt, network: 'testnet' });
    // The second device never opened the wallet. A third device takes over.
    const third = await recover(2, updated.kept, recoveryKey);
    if (!('wallet' in third)) throw new Error('the takeover was to finish');
    expect(third.missing).toEqual([]);
    expect(third.arrangement.earlierViewingKeyRecords).toHaveLength(2);
    expect(third.arrangement.earlierArchives).toHaveLength(2);
    await third.wallet.search({ passes: ['quick'] });
    const old = await owner.balance();
    expect((await third.wallet.balance()).toSweep).toBe(old.recoverable + old.cancelling);
  });

  it('MG08: every step of the move can stop and be repeated; nothing is done twice and no viewing-key record is lost', async () => {
    const { chain, storeAt, owner, first, recipient, recovererDevice, arrangement, kept, recoveryKey, next, preparation, recovererWallet } = await prepared();
    // Step 2 twice: the same message, the same hash.
    const once = await sendUpdate({ wallet: owner, seed: first, chain, arrangement, recipient, newSeed: preparation });
    const announced = await sendUpdate({ wallet: owner, seed: first, chain, arrangement: once.arrangement, recipient, newSeed: preparation });
    expect(announced.arrangement.change).toEqual(once.arrangement.change);
    // Step 3 twice: the recoverer holds two records and two archives, not three.
    const taken = await acceptUpdate({ sealed: once.sealed, privateKey: recovererDevice.privateKey, kept, chain, recoveryKey, storeAt });
    const again = await acceptUpdate({ sealed: announced.sealed, privateKey: recovererDevice.privateKey, kept: taken.kept, chain, recoveryKey, storeAt });
    expect(again.kept.viewingKeyRecords).toHaveLength(2);
    expect(again.kept.archives).toHaveLength(2);

    // The controller moves before the change is made: a request, which the recoverer's key can make.
    await (await recovererWallet()).request(seedOf(2).controllerKey.keyHash);
    await expect(makeChange({ wallet: owner, chain, arrangement: announced.arrangement, storeAt, network: 'testnet' })).rejects.toThrow(/prepared against another controller output than the present one/);
    // The receipt is prepared again against the new output. The change then also clears the request.
    const renewed = await acceptUpdate({ sealed: announced.sealed, privateKey: recovererDevice.privateKey, kept: again.kept, chain, recoveryKey, storeAt });
    expect(renewed.kept.viewingKeyRecords).toHaveLength(2);

    // Step 4 twice: the second time the chain already shows the change, and nothing is sent.
    const changed = await makeChange({ wallet: owner, chain, arrangement: announced.arrangement, storeAt, network: 'testnet' });
    expect(changed.sent).toBeDefined();
    const repeated = await makeChange({ wallet: owner, chain, arrangement: announced.arrangement, storeAt, network: 'testnet' });
    expect(repeated.sent).toBeUndefined();
    expect(repeated.arrangement).toEqual(changed.arrangement);

    // Step 5 twice, as after a restart of the new device.
    if (announced.handOver === undefined) throw new Error('a move hands the wallet over');
    let state: OwnerWalletState | undefined;
    const finish = () => finishMove({ handOver: announced.handOver as NonNullable<typeof announced.handOver>, preparation, seed: next, backend: new KeyBackend(chain, next), chain, storeAt, save: (stored) => (state = stored) });
    const moved = await finish();
    const restarted = await finish();
    expect(restarted.arrangement).toEqual(moved.arrangement);
    expect(restarted.recovery.on).toBe(true);
    expect(state?.earlierSeeds).toHaveLength(1);
  });

  it('a preparation that was never followed by its change is not taken for a seed of the wallet', async () => {
    const { chain, storeAt, owner, first, recipient, recovererDevice, arrangement, kept, recoveryKey, preparation, recover } = await prepared();
    const announced = await sendUpdate({ wallet: owner, seed: first, chain, arrangement, recipient, newSeed: preparation });
    const updated = await acceptUpdate({ sealed: announced.sealed, privateKey: recovererDevice.privateKey, kept, chain, recoveryKey, storeAt });
    // The old device never signs the change. It is lost; the recoverer holds a record of a seed that never owned the wallet.
    expect(updated.kept.viewingKeyRecords).toHaveLength(2);
    const third = await recover(2, updated.kept, recoveryKey);
    if (!('wallet' in third)) throw new Error('the takeover was to finish');
    // The new device takes only what the chain shows as an owner's.
    expect(third.missing).toEqual([]);
    expect(third.arrangement.earlierViewingKeyRecords).toHaveLength(1);
    expect(third.wallet.stored.earlierSeeds).toHaveLength(1);
  });
});

describe('a new recoverer and a new waiting period', () => {
  it('MG08: the new recoverer\'s prepared receipt comes first; each step can be repeated; recovery is on again once the change is confirmed', async () => {
    const { chain, storeAt, owner, first, enrolled, credential } = await start();
    const { arrangement } = await enrolled();
    const NEW_CREDENTIAL = 'army van defense carry jealous true garbage claim echo media make crunch';
    const newDevice = await generateRecipientKeyPair();
    const newRecipient = { name: 'second.example', page: 'https://second.example/', publicKey: newDevice.publicKey };
    const newKeys = credentialKeys(NEW_CREDENTIAL, 'testnet', kitTemplates());
    const send = (from: RecoveryArrangement) => enroll({ wallet: owner, seed: first, chain, credential: { words: NEW_CREDENTIAL }, recipient: newRecipient, stores: STORES, storeAt, arrangement: from, newRecoverer: {}, madeAt: 1_794_970_000 });
    expect((await checkRecovery({ wallet: owner, chain, arrangement, storeAt, network: 'testnet' })).status.on).toBe(true);
    const sent = await send(arrangement);
    // The arrangement in force is untouched: recovery stays on with the first recoverer.
    expect(sent.arrangement.sent).toEqual(arrangement.sent);
    expect(owner.recovery).toBe('on');
    await expect(makeChange({ wallet: owner, chain, arrangement: sent.arrangement, storeAt, network: 'testnet' })).rejects.toThrow(/prepared receipt for this change is not on the backup stores/);

    // The new recoverer is not the recoverer on chain yet. Taken in as an ordinary enrollment, the kit is refused.
    await expect(acceptEnrollment({ link: sent.link, privateKey: newDevice.privateKey, chain, network: 'testnet', storeAt })).rejects.toThrow(/not the recoverer the controller names/);
    const take = () => acceptEnrollment({ link: sent.link, privateKey: newDevice.privateKey, chain, network: 'testnet', storeAt, forNewRecoverer: true });
    await take();
    const taken = await take();
    expect(taken.recoveryKey.keyHash).toEqual(newKeys.recoveryKey.keyHash);

    const changed = await makeChange({ wallet: owner, chain, arrangement: sent.arrangement, storeAt, network: 'testnet' });
    expect(changed.sent).toBeDefined();
    expect((await makeChange({ wallet: owner, chain, arrangement: sent.arrangement, storeAt, network: 'testnet' })).sent).toBeUndefined();
    const status = await checkRecovery({ wallet: owner, chain, arrangement: changed.arrangement, storeAt, network: 'testnet' });
    expect(status.status.on).toBe(true);
    expect(status.status.receipt?.recoveryKeyHash).toBe(Buffer.from(newKeys.recoveryKey.keyHash).toString('hex'));
    expect(owner.recovery).toBe('on');
    // The first recoverer's receipt no longer makes recovery on, and its key no longer works on the controller.
    const old = await checkRecovery({ wallet: owner, chain, arrangement, storeAt, network: 'testnet' });
    expect(old.status.on).toBe(false);
    const firstRecoverer = RecovererWallet.open({ backend: new KeyBackend(chain, { controllerKey: credential.recoveryKey, fundingKey: credential.feeKey, addressKey: () => credential.feeKey }), chain, identity: hexToBin(owner.stored.identity as string) });
    await expect(firstRecoverer).rejects.toThrow(/not the recoverer named in the wallet's controller/);
  });

  it('a new waiting period is announced, answered with a prepared receipt, and then made', async () => {
    const { chain, storeAt, owner, first, recipient, recovererDevice, enrolled } = await start();
    const { arrangement, kept, recoveryKey } = await enrolled();
    const longer = { unit: 'time512', value: 4 } as const;
    await expect(sendUpdate({ wallet: owner, seed: first, chain, arrangement, recipient })).rejects.toThrow(/announces one change/);
    const announced = await sendUpdate({ wallet: owner, seed: first, chain, arrangement, recipient, challengeDelay: longer });
    expect(announced.handOver).toBeUndefined();
    await expect(makeChange({ wallet: owner, chain, arrangement: announced.arrangement, storeAt, network: 'testnet' })).rejects.toThrow(/prepared receipt/);
    await acceptUpdate({ sealed: announced.sealed, privateKey: recovererDevice.privateKey, kept, chain, recoveryKey, storeAt });
    const changed = await makeChange({ wallet: owner, chain, arrangement: announced.arrangement, storeAt, network: 'testnet' });
    expect(owner.recovery).toBe('off');
    const status = await checkRecovery({ wallet: owner, chain, arrangement: changed.arrangement, storeAt, network: 'testnet' });
    expect(status.status.on).toBe(true);
    expect(status.status.receipt?.prepared).toBeDefined();
  });
});
