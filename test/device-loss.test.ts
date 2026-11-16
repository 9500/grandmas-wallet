import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { binToHex, hexToBin } from '@bitauth/libauth';
import {
  type JsonValue,
  ArchiveWriter,
  HttpStore,
  MemoryStore,
  restore,
  templateContentHash,
} from '@grandmas-wallet/archive';
import { createStoreServer } from '@grandmas-wallet/archive-store';
import { p2pkhLockingBytecode } from '@grandmas-wallet/core';
import {
  acknowledgeEnrollment,
  createArchiveAccess,
  createEnrollmentPackage,
  createRecoveryCredential,
  enrollmentLink,
  enrollmentStatus,
  envelopeFromLink,
  generateRecipientKeyPair,
  openPackage,
  sealPackage,
  verifyEnrollment,
} from '@grandmas-wallet/enrollment';
import { SimulatedChain, TestWallet, describeSavingsJar, savingsJarKind, testKey } from '@grandmas-wallet/testing';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Acceptance test X04: the owner's device is lost, and a new device with a
 * new key takes over the wallet and its savings jar, using only what the
 * recoverer was given at enrollment and what the archive holds.
 *
 * Each party below uses only what it would really have. The chain is
 * simulated; the two backup stores are real servers.
 */

const NETWORK = 'chipnet';
const TEMPLATE_IDENTIFIER = 'f33c98ed0d081ac3544976c7e7b9795ec47a0d45924b530e26c55645d2860588';
const walletTemplate: JsonValue = { name: 'Grandma\'s Wallet', version: 1 };
const jarTemplate: JsonValue = { name: 'Savings Jar', version: 1 };

const servers: Server[] = [];
const startStore = async (): Promise<string> => {
  const server = createStoreServer();
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};
afterAll(() => servers.forEach((server) => server.close()));

describe('device loss (X04)', () => {
  it('a new device takes over the wallet and its savings jar from the package and the archive', async () => {
    const chain = new SimulatedChain();
    const storeUrls = [await startStore(), await startStore()];
    const now = (): number => Math.floor(chain.nowMs / 1000);

    // ── The recoverer publishes its encryption key. ──────────────────────────────────────────
    const bankKeys = await generateRecipientKeyPair();

    // ── The owner's first device sets the wallet up, without the recoverer taking part. ──────
    let link: string;
    let jarUnlockTime: number;
    let paidElsewhere: Uint8Array;
    {
      const ownerKey = testKey(0x22);
      const credential = createRecoveryCredential(TEMPLATE_IDENTIFIER, NETWORK);
      const wallet = TestWallet.create(chain, { owner: ownerKey, recovererKeyHash: credential.keyHash });
      const archive = createArchiveAccess(storeUrls);
      const stores = storeUrls.map((url) => new HttpStore(url));
      const writer = new ArchiveWriter({
        network: NETWORK,
        identity: wallet.identityHex,
        archiveId: hexToBin(archive.archiveId),
        contentKey: hexToBin(archive.contentKey),
        local: new MemoryStore('device'),
        stores,
        signer: () => ({ key: ownerKey, ownerEpoch: 0 }),
        now,
      });
      const walletTemplateHash = await writer.putTemplate(walletTemplate);
      await writer.flush();

      const signed = createEnrollmentPackage({
        network: NETWORK,
        identity: wallet.identity,
        genesisTransactionId: wallet.genesisTransactionId,
        state: wallet.controller().state,
        template: { identifier: TEMPLATE_IDENTIFIER, contentHash: walletTemplateHash },
        credential,
        archive,
        recoverer: 'bank.example',
        ownerKey,
        now: now(),
      });
      link = enrollmentLink('https://bank.example/', await sealPackage(signed, bankKeys.publicKey));
      expect(await enrollmentStatus(signed, stores)).toEqual({ status: 'package-created' });

      // The wallet is used before the recoverer has even opened the link.
      paidElsewhere = p2pkhLockingBytecode(new Uint8Array(20).fill(0x0d));
      wallet.pay(ownerKey, paidElsewhere, 1_500n);

      // Later the owner opens a savings jar. Its unlock time exists nowhere but on this device and in the archive.
      jarUnlockTime = now() + 3_600;
      const jar = describeSavingsJar(wallet.identityHex, jarUnlockTime, {
        positionId: 'jar-1',
        label: 'Holiday savings',
        template: { identifier: 'savings-jar-v1', contentHash: await writer.putTemplate(jarTemplate) },
      });
      const transaction = await writer.protect([jar], async () => wallet.openJarTransaction(ownerKey, jarUnlockTime));
      await writer.confirm(jar, wallet.send(transaction));

      // The recoverer opens the link at some point and confirms; the owner's wallet sees that.
      const opened = await openPackage(envelopeFromLink(link), bankKeys.privateKey);
      await acknowledgeEnrollment(opened, stores, now());
      expect((await enrollmentStatus(signed, stores)).status).toBe('recoverer-confirmed');
    }
    // ── The device is lost. Nothing from the block above is used again except `link`. ────────

    // ── The recoverer, holding only its private key and the link it was sent. ────────────────
    const package_ = await openPackage(envelopeFromLink(link), bankKeys.privateKey);
    const verified = await verifyEnrollment(package_, chain, NETWORK);
    expect(verified.credentialAuthorized).toBe(true);
    expect(verified.differences).toEqual([]);
    const { enrollment } = verified;
    const identity = hexToBin(enrollment.identity);

    // ── The replacement device makes its own key and tells the recoverer its hash. ───────────
    const replacementKey = testKey(0x44);
    const stores = enrollment.archive.stores.map((url) => new HttpStore(url));
    // The new device's own copy of the archive, filled as it restores.
    const newDevice = new MemoryStore('new-device');
    const restoreNow = () =>
      restore({
        network: enrollment.network,
        identity: enrollment.identity,
        genesisTransactionId: enrollment.genesisTransactionId,
        archiveId: hexToBin(enrollment.archive.archiveId),
        contentKey: hexToBin(enrollment.archive.contentKey),
        chain,
        stores,
        local: newDevice,
        kinds: [savingsJarKind],
      });

    // The recoverer sees what there is to recover before starting.
    const before = await restoreNow();
    expect(before.completeness).toBe('complete');
    expect(before.positions.map((position) => [position.position.label, position.result, position.onChain])).toEqual([['Holiday savings', 'complete', 'live']]);

    // A wallet object that knows nothing but the identity, as a new device would after reading the package.
    const recovered = Object.assign(Object.create(TestWallet.prototype) as TestWallet, { chain, identity, genesisTransactionId: enrollment.genesisTransactionId });
    recovered.requestRecovery(verified.recoveryKey, replacementKey.keyHash);
    expect((await restoreNow()).controller.current.state.status).toBe('pending');
    recovered.finalizeRecovery(verified.recoveryKey);

    // ── The replacement device takes over. ───────────────────────────────────────────────────
    const after = await restoreNow();
    expect(after.controller.current.state.ownerKeyHash).toEqual(replacementKey.keyHash);
    expect(after.controller.current.state.ownerEpoch).toBe(1);
    expect(after.completeness).toBe('complete');
    const [jar] = after.positions;
    if (jar === undefined) throw new Error('the jar was not restored');
    expect(jar.template).toEqual(jarTemplate);
    expect(templateContentHash(jarTemplate)).toBe(jar.position.template?.contentHash);
    expect(jar.position.parameters['unlockTime']).toBe(jarUnlockTime);

    // It spends the wallet's funds with the new key.
    const fundsBefore = after.funds.balance;
    recovered.pay(replacementKey, paidElsewhere, 1_000n);
    expect(chain.balanceOf(paidElsewhere)).toBe(2_500n);

    // The jar is still locked for the new owner too, and opens when its time comes.
    expect(() => recovered.emptyJar(replacementKey, jarUnlockTime)).toThrow('non-final');
    chain.nowMs = (jarUnlockTime + 60) * 1000;
    const emptied = recovered.emptyJar(replacementKey, jarUnlockTime);

    // It continues the archive under its own key and epoch.
    const writer = new ArchiveWriter({
      network: enrollment.network,
      identity: enrollment.identity,
      archiveId: hexToBin(enrollment.archive.archiveId),
      contentKey: hexToBin(enrollment.archive.contentKey),
      local: newDevice,
      stores,
      signer: () => ({ key: replacementKey, ownerEpoch: 1 }),
      state: after.writerState,
      now,
    });
    await writer.close(jar.position, emptied);
    const newUnlockTime = now() + 600;
    const newJar = describeSavingsJar(enrollment.identity, newUnlockTime, { positionId: 'jar-2', label: 'New jar' });
    await writer.confirm(newJar, recovered.send(await writer.protect([newJar], async () => recovered.openJarTransaction(replacementKey, newUnlockTime))));

    const final = await restoreNow();
    expect(final.completeness).toBe('complete');
    expect(final.positions.map((position) => [position.position.label, position.recorded, position.onChain])).toEqual([
      ['Holiday savings', 'closed', 'spent'],
      ['New jar', 'confirmed', 'live'],
    ]);
    expect(final.funds.balance).toBeGreaterThan(fundsBefore - 8_000n);

    // The lost device's key no longer works anywhere.
    const oldKey = testKey(0x22);
    expect(() => recovered.pay(oldKey, paidElsewhere, 1_000n)).toThrow('refused');
    expect(() => recovered.emptyJar(oldKey, newUnlockTime)).toThrow();
    expect(binToHex(final.controller.owners[0]?.ownerKeyHash ?? new Uint8Array())).toBe(binToHex(oldKey.keyHash));
  });
});
