import { binToHex, utf8ToBin } from '@bitauth/libauth';
import { signMessage } from '@grandmas-wallet/archive';
import { testKey } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

import { enrollmentLink, envelopeFromLink, generateRecipientKeyPair, openPackage, recipientKeyFingerprint, sealPackage } from '../src/index.js';
import { openBytes, sealBytes } from '../src/envelope.js';

const owner = testKey(0x22);
const IDENTITY = 'ab'.repeat(32);
const SECRET_WORDS = ['abandon', 'ability', 'absorb', 'abstract'];

/** A signed package of the size and kind that is sealed: a wallet, a credential and where its backup is kept. */
const setup = () => {
  const message = JSON.stringify({ identity: IDENTITY, recovery: { mnemonic: SECRET_WORDS.join(' ') }, backup: { stores: ['https://store1.example'] } });
  return { signed: signMessage('test/enrollment', message, owner) };
};

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
    const { signed } = setup();
    const bank = await generateRecipientKeyPair();
    const link = enrollmentLink('https://bank.example/', await sealPackage(signed, bank.publicKey));
    const envelope = envelopeFromLink(link);
    const visible = `${link}\n${new TextDecoder('latin1').decode(envelope)}\n${binToHex(envelope)}`;

    for (const secret of [...SECRET_WORDS, IDENTITY, 'store1.example']) expect(visible).not.toContain(secret);
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

  it('opens an envelope written without making its content smaller, as earlier versions wrote all of them', async () => {
    const bank = await generateRecipientKeyPair();
    // Content that deflate cannot make smaller is sealed as it is, and says so in its first byte.
    const noise = Uint8Array.from({ length: 64 }, (_, index) => (index * 97 + 13) % 251);
    const envelope = await sealBytes(noise, bank.publicKey);
    expect(envelope[0]).toBe(1);
    expect(envelope.length).toBe(noise.length + 49);
    expect(await openBytes(envelope, bank.privateKey)).toEqual(noise);
    // The first byte is part of what is checked: an envelope cannot be passed off as the other kind.
    const relabelled = Uint8Array.from(envelope);
    relabelled[0] = 2;
    await expect(openBytes(relabelled, bank.privateKey)).rejects.toThrow('cannot be opened with this key');
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
    // Overhead of sealing: one byte that says how the content is written, a 32-byte key share and a 16-byte tag.
    // The content, text with long runs of hexadecimal digits, is made smaller before it is sealed.
    const plaintextLength = utf8ToBin(JSON.stringify({ message: signed.message, publicKey: binToHex(signed.publicKey), signature: binToHex(signed.signature) })).length;
    expect(envelope[0]).toBe(2);
    expect(envelope.length).toBeLessThan(plaintextLength);
    expect(await openPackage(envelope, bank.privateKey)).toEqual(signed);
  });

  it('gives a short form of the recoverer key for people to compare', async () => {
    const bank = await generateRecipientKeyPair();
    expect(bank.publicKey).toHaveLength(32);
    expect(recipientKeyFingerprint(bank.publicKey)).toMatch(/^([0-9a-f]{4} ){3}[0-9a-f]{4}$/);
    expect(recipientKeyFingerprint(bank.publicKey)).not.toBe(recipientKeyFingerprint((await generateRecipientKeyPair()).publicKey));
  });
});
