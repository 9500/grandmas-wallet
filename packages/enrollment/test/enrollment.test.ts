import { binToHex, utf8ToBin } from '@bitauth/libauth';
import { MemoryStore, signMessage, templateContentHash } from '@grandmas-wallet/archive';
import { SimulatedChain, TestWallet, describeSavingsJar, testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import {
  type EnrollmentPackage,
  acknowledgeEnrollment,
  createArchiveAccess,
  createEnrollmentPackage,
  createRecoveryCredential,
  enrollmentLink,
  enrollmentStatus,
  envelopeFromLink,
  generateRecipientKeyPair,
  openPackage,
  parsePackage,
  recipientKeyFingerprint,
  recoveryKeyOf,
  sealPackage,
  verifyEnrollment,
} from '../src/index.js';

const NETWORK = 'chipnet';
const TEMPLATE_IDENTIFIER = 'f33c98ed0d081ac3544976c7e7b9795ec47a0d45924b530e26c55645d2860588';
const owner = testKey(0x22);
const replacement = testKey(0x44);

const setup = () => {
  const chain = new SimulatedChain();
  const credential = createRecoveryCredential(TEMPLATE_IDENTIFIER, NETWORK);
  const wallet = TestWallet.create(chain, { owner, recovererKeyHash: credential.keyHash });
  const archive = createArchiveAccess(['https://store1.example', 'https://store2.example']);
  const signed = createEnrollmentPackage({
    network: NETWORK,
    identity: wallet.identity,
    genesisTransactionId: wallet.genesisTransactionId,
    state: wallet.controller().state,
    template: { identifier: TEMPLATE_IDENTIFIER, contentHash: templateContentHash({ name: 'wallet template' }) },
    credential,
    archive,
    recoverer: 'bank.example',
    ownerKey: owner,
    now: 1_800_000_000,
  });
  return { chain, credential, wallet, archive, signed };
};

describe('enrollment package', () => {
  it('carries what the recoverer needs and nothing of the owner\'s keys', () => {
    const { signed, wallet, credential, archive } = setup();
    const enrollment = parsePackage(signed.message);
    expect(enrollment.identity).toBe(wallet.identityHex);
    expect(enrollment.genesisTransactionId).toBe(wallet.genesisTransactionId);
    expect(enrollment.recovery.mnemonic).toBe(credential.mnemonic);
    expect(enrollment.archive).toEqual(archive);
    expect(enrollment.policy).toEqual({
      ownerKeyHash: binToHex(owner.keyHash),
      recovererKeyHash: binToHex(credential.keyHash),
      challengeDelay: { unit: 'time512', value: 1 },
      recoverer: 'bank.example',
      createdAt: 1_800_000_000,
    });
    expect(recoveryKeyOf(enrollment).keyHash).toEqual(credential.keyHash);
    expect(signed.message).not.toContain(binToHex(owner.privateKey));
  });

  it('gives each wallet its own recovery credential and archive', () => {
    const [a, b] = [setup(), setup()];
    expect(a.credential.mnemonic).not.toBe(b.credential.mnemonic);
    expect(a.archive.contentKey).not.toBe(b.archive.contentKey);
    expect(a.archive.archiveId).not.toBe(b.archive.archiveId);
  });

  it('refuses packages that are malformed or of another version', () => {
    const { signed } = setup();
    const good = JSON.parse(signed.message) as EnrollmentPackage;
    const broken = (change: (enrollment: Record<string, unknown>) => void): string => {
      const copy = JSON.parse(signed.message) as Record<string, unknown>;
      change(copy);
      return JSON.stringify(copy);
    };
    expect(parsePackage(JSON.stringify(good))).toEqual(good);
    expect(() => parsePackage('not json')).toThrow('not readable');
    expect(() => parsePackage(broken((copy) => (copy['version'] = 2)))).toThrow('version 2 is not supported');
    expect(() => parsePackage(broken((copy) => (copy['format'] = 'other')))).toThrow('not an enrollment package');
    expect(() => parsePackage(broken((copy) => delete copy['recovery']))).toThrow('recovery credential');
    expect(() => parsePackage(broken((copy) => (copy['archive'] = { ...good.archive, stores: [] })))).toThrow('archive');
    expect(() => parsePackage(broken((copy) => (copy['identity'] = 'xyz')))).toThrow('does not name a wallet');
    expect(() => parsePackage(broken((copy) => (copy['manifest'] = [{ positionId: 'p' }])))).toThrow();
  });

  it('can list positions that exist when it is made', () => {
    const { wallet, credential, archive } = setup();
    const position = describeSavingsJar(wallet.identityHex, 1_900_000_000, { positionId: 'jar-1' });
    const signed = createEnrollmentPackage({
      network: NETWORK, identity: wallet.identity, genesisTransactionId: wallet.genesisTransactionId, state: wallet.controller().state,
      template: { identifier: TEMPLATE_IDENTIFIER, contentHash: 'ab'.repeat(32) }, credential, archive, manifest: [position], recoverer: 'bank.example', ownerKey: owner,
    });
    expect(parsePackage(signed.message).manifest).toEqual([position]);
  });
});

describe('delivery to the recoverer (R01)', () => {
  it('can be opened by the recoverer and by no one else', async () => {
    const { signed } = setup();
    const bank = await generateRecipientKeyPair();
    const observer = await generateRecipientKeyPair();
    const envelope = await sealPackage(signed, bank.publicKey);

    const opened = await openPackage(envelope, bank.privateKey);
    expect(opened.message).toBe(signed.message);
    expect(opened.signature).toEqual(signed.signature);
    await expect(openPackage(envelope, observer.privateKey)).rejects.toThrow('cannot be opened with this key');
  });

  it('shows an observer of the link none of its contents', async () => {
    const { signed, credential, archive, wallet } = setup();
    const bank = await generateRecipientKeyPair();
    const link = enrollmentLink('https://bank.example/', await sealPackage(signed, bank.publicKey));
    const envelope = envelopeFromLink(link);
    const visible = `${link}\n${new TextDecoder('latin1').decode(envelope)}\n${binToHex(envelope)}`;

    for (const word of credential.mnemonic.split(' ').filter((item) => item.length > 4)) expect(visible).not.toContain(word);
    for (const secret of [archive.contentKey, archive.archiveId, wallet.identityHex, binToHex(credential.keyHash), 'store1.example']) {
      expect(visible).not.toContain(secret);
    }
    // Sealing the same package again gives unrelated bytes, so two links cannot be matched to one wallet.
    const second = await sealPackage(signed, bank.publicKey);
    expect(binToHex(second.slice(1, 33))).not.toBe(binToHex(envelope.slice(1, 33)));
  });

  it('detects any change made in transit', async () => {
    const { signed } = setup();
    const bank = await generateRecipientKeyPair();
    const envelope = await sealPackage(signed, bank.publicKey);
    for (const position of [0, 5, 40, envelope.length - 1]) {
      const altered = envelope.slice();
      altered[position] = (altered[position] ?? 0) ^ 1;
      await expect(openPackage(altered, bank.privateKey)).rejects.toThrow();
    }
    await expect(openPackage(envelope.slice(0, 20), bank.privateKey)).rejects.toThrow('incomplete');
  });

  it('travels in the part of a link that is not sent to the server, and fits a QR code', async () => {
    const { signed } = setup();
    const bank = await generateRecipientKeyPair();
    const envelope = await sealPackage(signed, bank.publicKey);
    const link = enrollmentLink('https://bank.example/', envelope);
    const url = new URL(link);
    expect(url.search).toBe('');
    expect(url.pathname).toBe('/');
    expect(url.hash.startsWith('#enroll=')).toBe(true);
    expect(envelopeFromLink(link)).toEqual(envelope);
    expect(() => envelopeFromLink('https://bank.example/#other=1')).toThrow('no enrollment package');

    // A version 40 QR code at the lowest error correction holds 2,953 bytes.
    expect(link.length).toBeLessThan(2_953);
    // Overhead of sealing: one version byte, a 32-byte key share and a 16-byte tag.
    const plaintextLength = utf8ToBin(JSON.stringify({ message: signed.message, publicKey: binToHex(signed.publicKey), signature: binToHex(signed.signature) })).length;
    expect(envelope.length).toBe(plaintextLength + 49);
  });

  it('gives a short form of the recoverer key for people to compare', async () => {
    const bank = await generateRecipientKeyPair();
    expect(bank.publicKey).toHaveLength(32);
    expect(recipientKeyFingerprint(bank.publicKey)).toMatch(/^([0-9a-f]{4} ){3}[0-9a-f]{4}$/);
    expect(recipientKeyFingerprint(bank.publicKey)).not.toBe(recipientKeyFingerprint((await generateRecipientKeyPair()).publicKey));
  });
});

describe('the recoverer checks a package against the chain', () => {
  it('accepts a package for a wallet that exists as described', async () => {
    const { signed, chain, credential } = setup();
    const verified = await verifyEnrollment(signed, chain, NETWORK);
    expect(verified.credentialAuthorized).toBe(true);
    expect(verified.signedBy).toBe('current-owner');
    expect(verified.differences).toEqual([]);
    expect(verified.recoveryKey.keyHash).toEqual(credential.keyHash);
    expect(verified.controller.current.state.status).toBe('active');
  });

  it('refuses a package for another network, with a changed content, or not signed by an owner', async () => {
    const { signed, chain, wallet, credential, archive } = setup();
    await expect(verifyEnrollment(signed, chain, 'mainnet')).rejects.toThrow('is for chipnet, not mainnet');
    await expect(verifyEnrollment({ ...signed, message: signed.message.replace('bank.example', 'bank.exampel') }, chain, NETWORK)).rejects.toThrow('signature is not valid');

    const outsider = testKey(0x77);
    const forged = createEnrollmentPackage({
      network: NETWORK, identity: wallet.identity, genesisTransactionId: wallet.genesisTransactionId, state: wallet.controller().state,
      template: { identifier: TEMPLATE_IDENTIFIER, contentHash: 'ab'.repeat(32) }, credential, archive, recoverer: 'bank.example', ownerKey: outsider,
    });
    await expect(verifyEnrollment(forged, chain, NETWORK)).rejects.toThrow('not signed by an owner');
    // A signature made for another purpose with the owner key is not a package signature.
    const reused = signMessage('grandmas-wallet/archive-record/v1', signed.message, owner);
    await expect(verifyEnrollment(reused, chain, NETWORK)).rejects.toThrow('signature is not valid');
  });

  it('refuses a package naming a wallet that is not on the chain', async () => {
    const { signed } = setup();
    await expect(verifyEnrollment(signed, new SimulatedChain(), NETWORK)).rejects.toThrow('No transaction creating this identity');
  });

  it('reports when the wallet no longer matches the package', async () => {
    const { signed, chain, wallet } = setup();
    const verified = await verifyEnrollment(signed, chain, NETWORK);
    wallet.recover(verified.recoveryKey, replacement);
    const later = await verifyEnrollment(signed, chain, NETWORK);
    expect(later.signedBy).toBe('earlier-owner');
    expect(later.credentialAuthorized).toBe(true);
    expect(later.controller.current.state.ownerKeyHash).toEqual(replacement.keyHash);
  });

  it('reports a credential that does not match the recoverer the wallet names', async () => {
    const { chain, wallet, archive } = setup();
    const other = createRecoveryCredential(TEMPLATE_IDENTIFIER, NETWORK);
    const signed = createEnrollmentPackage({
      network: NETWORK, identity: wallet.identity, genesisTransactionId: wallet.genesisTransactionId, state: wallet.controller().state,
      template: { identifier: TEMPLATE_IDENTIFIER, contentHash: 'ab'.repeat(32) }, credential: other, archive, recoverer: 'bank.example', ownerKey: owner,
    });
    const verified = await verifyEnrollment(signed, chain, NETWORK);
    expect(verified.credentialAuthorized).toBe(false);
    expect(verified.differences).toEqual(['The recovery credential does not match the recoverer the package names.']);
  });
});

describe('confirmation of receipt', () => {
  it('shows the package as created until the recoverer confirms it', async () => {
    const { signed } = setup();
    const stores = [new MemoryStore('one'), new MemoryStore('two')];
    expect(await enrollmentStatus(signed, stores)).toEqual({ status: 'package-created' });
    await acknowledgeEnrollment(signed, stores, 1_800_000_500);
    expect(await enrollmentStatus(signed, stores)).toEqual({ status: 'recoverer-confirmed', receivedAt: 1_800_000_500 });
    expect(await enrollmentStatus(signed, [stores[1] as MemoryStore])).toEqual({ status: 'recoverer-confirmed', receivedAt: 1_800_000_500 });
  });

  it('is not satisfied by a confirmation of another package or from someone without the credential', async () => {
    const { signed, wallet, archive } = setup();
    const stores = [new MemoryStore('one')];
    // Same wallet and archive, but a credential the wallet does not name: someone who only knows the archive key.
    const impostor = createEnrollmentPackage({
      network: NETWORK, identity: wallet.identity, genesisTransactionId: wallet.genesisTransactionId, state: wallet.controller().state,
      template: { identifier: TEMPLATE_IDENTIFIER, contentHash: 'ab'.repeat(32) }, credential: createRecoveryCredential(TEMPLATE_IDENTIFIER, NETWORK),
      archive, recoverer: 'bank.example', ownerKey: owner,
    });
    await acknowledgeEnrollment(impostor, stores);
    expect(await enrollmentStatus(signed, stores)).toEqual({ status: 'package-created' });
    // The real recoverer confirming an earlier package says nothing about a later one.
    const earlier = { ...signed };
    const later = createEnrollmentPackage({
      network: NETWORK, identity: wallet.identity, genesisTransactionId: wallet.genesisTransactionId, state: wallet.controller().state,
      template: { identifier: TEMPLATE_IDENTIFIER, contentHash: 'ab'.repeat(32) }, credential: { mnemonic: parsePackage(signed.message).recovery.mnemonic, derivation: parsePackage(signed.message).recovery.derivation },
      archive, recoverer: 'other-bank.example', ownerKey: owner,
    });
    await acknowledgeEnrollment(earlier, stores);
    expect((await enrollmentStatus(earlier, stores)).status).toBe('recoverer-confirmed');
    expect((await enrollmentStatus(later, stores)).status).toBe('package-created');
  });

  it('fails when no store takes the confirmation', async () => {
    const { signed } = setup();
    const store = new MemoryStore('one');
    store.unreachable = true;
    await expect(acknowledgeEnrollment(signed, [store])).rejects.toThrow('No backup store accepted');
  });
});
