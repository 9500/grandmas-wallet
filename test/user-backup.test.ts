import { MemoryStore } from '@grandmas-wallet/archive';
import {
  OwnerWallet,
  RecovererWallet,
  UserBackupError,
  acceptEnrollment,
  acceptTakeover,
  completeTakeover,
  enroll,
  finishTakeover,
  kitTemplates,
  makeUserBackup,
  readUserBackup,
  restoreFromBackup,
  startTakeover,
  userBackupText,
  walletTemplateNumbers,
} from '@grandmas-wallet/app';
import { deriveSeedKeys, p2pkhLockingBytecode } from '@grandmas-wallet/core';
import { credentialKeys, generateRecipientKeyPair } from '@grandmas-wallet/enrollment';
import { KeyBackend, SimulatedChain, testKey } from '@grandmas-wallet/testing';
import { hexToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';

/**
 * A backup the user keeps (proposal section 18.1): what the least of it restores, what it leaves out, what
 * a complete one adds, and that it goes stale when the wallet gets a new seed.
 */

const numbers = walletTemplateNumbers();
const WORDS = ['abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above'];
const CREDENTIAL_WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const STORES = ['https://store1.example', 'https://store2.example'];
const payee = p2pkhLockingBytecode(testKey(0x44).keyHash);

/** A wallet of the first seed with a coin at a given-out address and one at a vault address, and its recoverer enrolled. */
const start = async () => {
  const chain = new SimulatedChain();
  const stores = new Map(STORES.map((address) => [address, new MemoryStore(address)]));
  const storeAt = (address: string): MemoryStore => stores.get(address) as MemoryStore;
  const first = deriveSeedKeys(WORDS[0] as string, 'testnet', numbers);
  const credential = credentialKeys(CREDENTIAL_WORDS, 'testnet', kitTemplates());
  const owner = await OwnerWallet.open({ backend: new KeyBackend(chain, first), chain, seed: first });
  chain.fund(p2pkhLockingBytecode(first.fundingKey.keyHash), 100_000n);
  await owner.create({ recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: { unit: 'time512', value: 1 }, allowance: { feeLockingBytecode: p2pkhLockingBytecode(credential.feeKey.keyHash), satoshis: 20_000n } });
  chain.fund((await owner.receiveAddress()).address.lockingBytecode, 10_000n);
  chain.fund((await owner.vaultAddress()).address.lockingBytecode, 5_000n);
  const recovererDevice = await generateRecipientKeyPair();
  const sent = await enroll({ wallet: owner, seed: first, chain, credential: { words: CREDENTIAL_WORDS }, recipient: { name: 'recoverer.example', page: 'https://recoverer.example/', publicKey: recovererDevice.publicKey }, stores: STORES, storeAt, madeAt: 1 });
  const taken = await acceptEnrollment({ link: sent.link, privateKey: recovererDevice.privateKey, chain, network: 'testnet', storeAt });
  /** The wallet is recovered to a device of the second seed. */
  const recovered = async () => {
    const seed = deriveSeedKeys(WORDS[1] as string, 'testnet', numbers);
    const asked = await startTakeover({ seed, stores: STORES, storeAt, recovererPublicKey: recovererDevice.publicKey });
    const saved = await acceptTakeover({ sealed: asked.sealed, privateKey: recovererDevice.privateKey, kept: taken.kept, chain });
    const recoverer = await RecovererWallet.open({ backend: new KeyBackend(chain, { controllerKey: credential.recoveryKey, fundingKey: credential.feeKey, addressKey: () => credential.feeKey }), chain, identity: hexToBin(owner.stored.identity as string) });
    await recoverer.request(saved.proposedKeyHash);
    chain.nowMs += 2 * 512 * 1000;
    await recoverer.complete();
    const handed = await completeTakeover({ kept: saved.kept, chain, recoveryKey: taken.recoveryKey, storeAt });
    return finishTakeover({ sealedHandOver: handed.sealed, pending: asked.pending, seed, backend: new KeyBackend(chain, seed), chain });
  };
  const restore = (text: string) => restoreFromBackup({ backup: readUserBackup(text), backend: (seed) => new KeyBackend(chain, seed), chain });
  return { chain, owner, first, arrangement: sent.arrangement, recovered, restore };
};

describe('a backup the user keeps', () => {
  it('the words and the identity restore the current seed: the same owner, with no controller transaction and no waiting period', async () => {
    const { chain, owner, restore } = await start();
    const text = userBackupText(await makeUserBackup({ words: WORDS[0] as string, wallet: owner, network: 'testnet', chain }));
    expect(text.trim().split('\n')).toEqual(['Grandma\'s Wallet backup', 'network: testnet', 'address scheme: 1', `identity: ${owner.stored.identity}`, `words: ${WORDS[0]}`]);
    const held = await owner.balance();
    const clock = chain.nowMs;

    // Typed in from paper: another order, capitals, extra spaces.
    const typed = `Words:  ${(WORDS[0] as string).toUpperCase()}\n IDENTITY: ${(owner.stored.identity as string).toUpperCase()}\nAddress Scheme: 1\nNetwork: Testnet\n`;
    const { wallet, notCovered } = await restore(typed);
    expect(wallet.stored.identity).toBe(owner.stored.identity);
    // Nothing of earlier seeds is missing, since there are none; only the stores were not named.
    expect(notCovered).toHaveLength(1);
    expect(notCovered[0]).toMatch(/does not say where the backup stores are/);
    await wallet.search({ passes: ['quick'] });
    expect(await wallet.balance()).toMatchObject({ recoverable: held.recoverable, vault: held.vault });
    // It pays by key and releases the vault coin through the controller, at once.
    await wallet.sendEverything(payee);
    expect(await wallet.balance()).toMatchObject({ recoverable: 0n, vault: 0n });
    expect(chain.nowMs).toBe(clock);
  }, 30_000);

  it('the words alone restore nothing, and an unknown address scheme is refused', async () => {
    const { owner } = await start();
    const identity = owner.stored.identity as string;
    expect(() => readUserBackup(`network: testnet\naddress scheme: 1\nwords: ${WORDS[0]}\n`)).toThrow(/The words alone restore nothing/);
    expect(() => readUserBackup(`network: testnet\naddress scheme: 2\nidentity: ${identity}\nwords: ${WORDS[0]}\n`)).toThrow(/address scheme 2; this version knows scheme 1/);
    expect(() => readUserBackup(`address scheme: 1\nidentity: ${identity}\nwords: ${WORDS[0]}\n`)).toThrow(/which network/);
    expect(() => readUserBackup(`network: testnet\naddress scheme: 1\nidentity: ${identity}\nwords: abandon abandon about\n`)).toThrow(/twelve words/);
  });

  it('after a recovery the earlier backup is out of date, and says so', async () => {
    const { chain, owner, recovered, restore } = await start();
    const text = userBackupText(await makeUserBackup({ words: WORDS[0] as string, wallet: owner, network: 'testnet', chain }));
    await recovered();
    await expect(restore(text)).rejects.toThrow(UserBackupError);
    await expect(restore(text)).rejects.toThrow(/out of date: the wallet has a new seed since it was made/);
    // Words that never owned the wallet are told apart from that.
    const stranger = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
    await expect(restore(`network: testnet\naddress scheme: 1\nidentity: ${owner.stored.identity}\nwords: ${stranger}\n`)).rejects.toThrow(/have never owned the wallet/);
  });

  it('a backup of the new seed with only the words and the identity says that earlier addresses are not covered; a complete one covers them', async () => {
    const { chain, owner, recovered, restore } = await start();
    const held = await owner.balance();
    const taken = await recovered();

    const least = userBackupText(await makeUserBackup({ words: WORDS[1] as string, wallet: taken.wallet, network: 'testnet', chain }));
    const partly = await restore(least);
    expect(partly.notCovered[0]).toMatch(/has had 1 earlier seed, and this backup holds the viewing key of 0\. Earlier addresses are not covered/);
    const search = await partly.wallet.search({ passes: ['quick'] });
    expect(search.status).not.toBe('fully-found');
    expect((await partly.wallet.balance()).toSweep).toBe(0n);

    const complete = userBackupText(await makeUserBackup({ words: WORDS[1] as string, wallet: taken.wallet, network: 'testnet', chain, arrangement: taken.arrangement, complete: true }));
    expect(complete.trim().split('\n')).toHaveLength(6);
    const whole = await restore(complete);
    expect(whole.notCovered).toEqual([]);
    await whole.wallet.search({ passes: ['quick'] });
    expect((await whole.wallet.balance()).toSweep).toBe(held.recoverable + held.vault);
    const read = readUserBackup(complete);
    expect(read.archives).toHaveLength(2);
    expect(read.earlierViewingKeyRecords).toHaveLength(1);
  });
});
