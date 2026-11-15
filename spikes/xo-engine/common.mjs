// Shared setup for the spike experiments.
// The engine's SQLite storage is a stub in the pinned version, so Node runs use an in-memory IndexedDB.
import 'fake-indexeddb/auto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { generateBip39Mnemonic, lockingBytecodeToCashAddress, hexToBin } from '@bitauth/libauth';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';

export const DATA = new URL('./.data/', import.meta.url).pathname;
mkdirSync(DATA, { recursive: true });

/** A test mnemonic per account name, created once and kept in .data (git-ignored). */
export const mnemonicFor = (account) => {
  const path = `${DATA}${account}.mnemonic`;
  if (!existsSync(path)) writeFileSync(path, generateBip39Mnemonic().phrase ?? generateBip39Mnemonic(), { mode: 0o600 });
  return readFileSync(path, 'utf8').trim();
};

export const openEngine = async (account, extra = {}) =>
  Engine.create(mnemonicFor(account), {
    network: XO_SUPPORTED_NETWORKS.chipnet,
    ...extra,
  });

export const address = (lockingBytecodeHex) => {
  const result = lockingBytecodeToCashAddress({ prefix: 'bchtest', bytecode: hexToBin(lockingBytecodeHex) });
  return typeof result === 'string' ? result : result.address;
};

export const show = (label, value) =>
  console.log(label, JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v), 1));
