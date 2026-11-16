import { binToHex } from '@bitauth/libauth';
import type { KeyPair } from '@grandmas-wallet/core';
import { SimulatedChain, TestWallet, testKey } from '@grandmas-wallet/testing';

import {
  type ArchiveStore,
  type RestoreParameters,
  type WriterState,
  ArchiveWriter,
  MemoryStore,
  describeSavingsJar,
  generateArchiveId,
  generateContentKey,
  restore,
} from '../src/index.js';

export const NETWORK = 'chipnet';
export const owner = testKey(0x22);
export const recoverer = testKey(0x33);
export const replacement = testKey(0x44);

/** A wallet on a simulated chain with an archive on two stores. */
export const setup = () => {
  const chain = new SimulatedChain();
  const wallet = TestWallet.create(chain, { owner, recovererKeyHash: recoverer.keyHash });
  const stores = [new MemoryStore('store-one'), new MemoryStore('store-two')] as const;
  const archiveId = generateArchiveId();
  const contentKey = generateContentKey();

  /** A writer as a device would hold it: for one owner key, continuing from a saved state. */
  const writerFor = (key: KeyPair, ownerEpoch: number, state?: WriterState, minimumAcknowledgments?: number): ArchiveWriter =>
    new ArchiveWriter({
      network: NETWORK,
      identity: wallet.identityHex,
      archiveId,
      contentKey,
      stores: [...stores],
      signer: () => ({ key, ownerEpoch }),
      now: () => Math.floor(chain.nowMs / 1000),
      ...(state === undefined ? {} : { state }),
      ...(minimumAcknowledgments === undefined ? {} : { minimumAcknowledgments }),
    });

  const restoreWith = (overrides: Partial<RestoreParameters> = {}) =>
    restore({
      network: NETWORK,
      identity: wallet.identityHex,
      genesisTransactionId: wallet.genesisTransactionId,
      archiveId,
      contentKey,
      chain,
      stores: [...stores] as ArchiveStore[],
      ...overrides,
    });

  let jars = 0;
  /** The description of a savings jar unlocking `seconds` from now. */
  const jar = (seconds = 600) => {
    jars += 1;
    const unlockTime = Math.floor(chain.nowMs / 1000) + seconds + jars;
    return { unlockTime, position: describeSavingsJar(wallet.identityHex, unlockTime, { positionId: `jar-${jars}`, label: `Jar ${jars}` }) };
  };

  /** Open a jar the way a wallet must: record, wait for the stores, sign, send, confirm. */
  const openJar = async (writer: ArchiveWriter, key: KeyPair = owner, seconds = 600) => {
    const described = jar(seconds);
    const built = await writer.protect([described.position], async () => wallet.openJarTransaction(key, described.unlockTime));
    const transactionId = wallet.send(built);
    await writer.confirm(described.position, transactionId);
    return { ...described, transactionId };
  };

  return { chain, wallet, stores, archiveId, archiveIdHex: binToHex(archiveId), contentKey, writerFor, restoreWith, jar, openJar };
};
