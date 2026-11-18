import { binToHex } from '@bitauth/libauth';
import { MemoryStore } from '@grandmas-wallet/archive';
import { OwnerWallet, acceptEnrollment, acceptTakeover, enroll, kitTemplates, startTakeover, walletTemplateNumbers } from '@grandmas-wallet/app';
import { linkOfSealed, sealedOfLink } from '@grandmas-wallet/app/hand-off';
import { type Particulars, type ReceivedSealed, type RecovererChannel, SealedCourier, SealedDesk, readRecovererMessage } from '@grandmas-wallet/connect/recoverer';
import { deriveSeedKeys, p2pkhLockingBytecode } from '@grandmas-wallet/core';
import { EnrollmentError, credentialKeys, generateRecipientKeyPair } from '@grandmas-wallet/enrollment';
import { KeyBackend, SimulatedChain } from '@grandmas-wallet/testing';
import { describe, expect, it } from 'vitest';

/**
 * A recovery kit sent over a session between the wallet's page and the recoverer's page (`gw_recoverer_v1`) is
 * the kit the link would carry, byte for byte, and the recoverer takes it in through the same checks: the
 * wallet's own code on the simulated chain, with backup stores in memory. The same for a takeover request.
 */

const WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const NEW_WORDS = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const CREDENTIAL_WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const STORES = ['https://store1.example', 'https://store2.example'];
const PAGE = 'https://recoverer.example/';

/** A pair of queues standing for the session; only this extension's messages, checked, reach a listener. */
const session = () => {
  const toDesk: ((message: unknown) => void)[] = [];
  const toWallet: ((message: unknown) => void)[] = [];
  const end = (out: ((message: unknown) => void)[], incoming: ((message: unknown) => void)[]): RecovererChannel => ({
    send: async (message) => {
      for (const handler of [...out]) handler(JSON.parse(JSON.stringify(message)));
    },
    onMessage: (handler) => {
      const listener = (message: unknown) => {
        const read = readRecovererMessage(message);
        if (read !== undefined) handler(read);
      };
      incoming.push(listener);
      return () => void incoming.splice(incoming.indexOf(listener), 1);
    },
  });
  return { desk: end(toWallet, toDesk), wallet: end(toDesk, toWallet) };
};

const start = async () => {
  const chain = new SimulatedChain();
  const stores = new Map(STORES.map((address) => [address, new MemoryStore(address)]));
  const storeAt = (address: string): MemoryStore => stores.get(address) as MemoryStore;
  const seed = deriveSeedKeys(WORDS, 'testnet', walletTemplateNumbers());
  const credential = credentialKeys(CREDENTIAL_WORDS, 'testnet', kitTemplates());
  const owner = await OwnerWallet.open({ backend: new KeyBackend(chain, seed), chain, seed });
  chain.fund(p2pkhLockingBytecode(seed.fundingKey.keyHash), 100_000n);
  await owner.create({ recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: { unit: 'time512', value: 1 } });
  const device = await generateRecipientKeyPair();
  const particulars: Particulars = { name: 'Anna', page: PAGE, publicKey: binToHex(device.publicKey) };
  const sent = await enroll({ wallet: owner, seed, chain, credential: { words: CREDENTIAL_WORDS }, recipient: { name: 'Anna', page: PAGE, publicKey: device.publicKey }, stores: STORES, storeAt, madeAt: 1_794_950_000 });

  /** The recoverer's page: what arrives over the session is put back into its link and taken in from there. */
  const received: ReceivedSealed[] = [];
  const wires = session();
  const courier = new SealedCourier(wires.wallet);
  const desk = new SealedDesk({ particulars: () => particulars, onSealed: (sealed) => (received.push(sealed), void desk.answer(sealed.id, 'received')) });
  desk.attach(wires.desk);
  return { chain, storeAt, device, particulars, sent, courier, received };
};

describe('a recovery kit over a session', () => {
  it('is, byte for byte, the kit the link carries, and is kept through the same checks', async () => {
    const { chain, storeAt, device, particulars, sent, courier, received } = await start();
    const envelope = await sealedOfLink('enroll', sent.link);
    expect((await courier.send({ expected: particulars, kind: 'enroll', sealed: envelope, timeoutMs: 2_000 })).status).toBe('received');
    expect(received[0]?.sealed).toEqual(envelope);
    // The recoverer's page puts it back into the link it would have come in: the same link.
    const link = await linkOfSealed('enroll', PAGE, received[0]?.sealed ?? new Uint8Array());
    expect(link).toBe(sent.link);
    const taken = await acceptEnrollment({ link, privateKey: device.privateKey, chain, network: 'testnet', storeAt });
    expect(taken.kept.kit.creationTransactionId).toBe(sent.arrangement.creationTransactionId);
    expect(taken.recoveryKey.keyHash).toEqual(credentialKeys(CREDENTIAL_WORDS, 'testnet', kitTemplates()).recoveryKey.keyHash);
  });

  it('is refused like a link when it was altered on the way', async () => {
    const { chain, storeAt, device, particulars, sent, courier, received } = await start();
    const altered = (await sealedOfLink('enroll', sent.link)).slice();
    altered[altered.length - 20] = (altered[altered.length - 20] ?? 0) ^ 1;
    await courier.send({ expected: particulars, kind: 'enroll', sealed: altered, timeoutMs: 2_000 });
    const link = await linkOfSealed('enroll', PAGE, received[0]?.sealed ?? new Uint8Array());
    await expect(acceptEnrollment({ link, privateKey: device.privateKey, chain, network: 'testnet', storeAt })).rejects.toBeInstanceOf(EnrollmentError);
  });

  it('cannot be opened by another recoverer, whatever page it reached', async () => {
    const { chain, storeAt, sent } = await start();
    const stranger = await generateRecipientKeyPair();
    const link = await linkOfSealed('enroll', PAGE, await sealedOfLink('enroll', sent.link));
    await expect(acceptEnrollment({ link, privateKey: stranger.privateKey, chain, network: 'testnet', storeAt })).rejects.toThrow();
  });
});

describe('a takeover request over a session', () => {
  it('is the request the link carries, and the recoverer saves it as from the link', async () => {
    const { chain, storeAt, device, particulars, sent, courier, received } = await start();
    const { kept } = await acceptEnrollment({ link: sent.link, privateKey: device.privateKey, chain, network: 'testnet', storeAt });
    // A new phone asks to take the wallet over.
    const asked = await startTakeover({ seed: deriveSeedKeys(NEW_WORDS, 'testnet', walletTemplateNumbers()), stores: STORES, storeAt, recovererPublicKey: device.publicKey });
    const link = await linkOfSealed('takeover', PAGE, asked.sealed);
    expect(await sealedOfLink('takeover', link)).toEqual(asked.sealed);
    expect((await courier.send({ expected: particulars, kind: 'takeover', sealed: asked.sealed, timeoutMs: 2_000 })).status).toBe('received');
    expect(received[0]?.kind).toBe('takeover');
    expect(await linkOfSealed('takeover', PAGE, received[0]?.sealed ?? new Uint8Array())).toBe(link);
    const saved = await acceptTakeover({ sealed: received[0]?.sealed ?? new Uint8Array(), privateKey: device.privateKey, kept, chain });
    expect(saved.fingerprint).toBe(asked.pending.fingerprint);
  });
});
