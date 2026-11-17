import { binToHex, hash160, hexToBin } from '@bitauth/libauth';
import { readViewingKeyRecord } from '@grandmas-wallet/archive';
import { type ChainReader, type SeedKeys, type ViewingKey, type WalletBackend, ADDRESS_SCHEME_VERSION, deriveSeedKeys, readControllerHistory } from '@grandmas-wallet/core';
import { type KitArchive, type SignedJson, fromSignedJson } from '@grandmas-wallet/enrollment';

import { type OwnerWalletState, OwnerWallet } from './owner-wallet.js';
import type { RecoveryArrangement } from './recovery-flow.js';
import { walletTemplateNumbers } from './templates.js';

/**
 * A backup the user keeps (proposal section 18.1). The design does not need one and supports one.
 *
 * The least that restores the current seed is the twelve words and the wallet's identity, with the network
 * and the version of the address scheme beside them. A device with these is the same owner: it recomputes
 * every key and address of that seed and finds its coins by searching, with no controller transaction and
 * no waiting period. A complete backup adds the viewing-key record of every earlier seed, without which
 * what arrives at earlier addresses is not found, and may add the creating transaction and the access to
 * the backup stores, so that templates and labels come back too.
 *
 * It is not a standard wallet backup: the words alone restore nothing in another wallet, and nothing here
 * without the identity. It goes stale when the wallet gets a new seed. Whoever holds it has the wallet at once.
 */

const hex = binToHex;
const TITLE = 'Grandma\'s Wallet backup';

export interface UserBackup {
  network: SeedKeys['network'];
  addressScheme: number;
  /** Wallet identity, in the byte order shown by explorers. */
  identity: string;
  words: string;
  /** The transaction that created the identity. */
  creationTransactionId?: string;
  /** The viewing-key record of every earlier seed, oldest first. */
  earlierViewingKeyRecords?: SignedJson[];
  /** The access to the backup archives, the one in use first. */
  archives?: KitArchive[];
}

export class UserBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserBackupError';
  }
}

/**
 * Make a backup of the wallet as it is now.
 *
 * @param options.complete - add the earlier seeds' viewing-key records and the access to the archives
 */
export const makeUserBackup = async (options: {
  words: string;
  wallet: OwnerWallet;
  network: SeedKeys['network'];
  chain: ChainReader;
  arrangement?: RecoveryArrangement;
  complete?: boolean;
}): Promise<UserBackup> => {
  const { identity, creation } = options.wallet.stored;
  if (identity === undefined || !creation.confirmed) throw new UserBackupError('The wallet\'s identity is not confirmed yet. A backup is made after that.');
  const backup: UserBackup = { network: options.network, addressScheme: ADDRESS_SCHEME_VERSION, identity, words: options.words.trim().split(/\s+/).join(' ') };
  if (options.complete !== true) return backup;
  const history = await readControllerHistory(options.chain, hexToBin(identity));
  const creationTransactionId = history.transactions[0]?.transactionId;
  return {
    ...backup,
    ...(creationTransactionId === undefined ? {} : { creationTransactionId }),
    earlierViewingKeyRecords: [...(options.arrangement?.earlierViewingKeyRecords ?? [])].reverse(),
    ...(options.arrangement === undefined ? {} : { archives: [options.arrangement.archive, ...options.arrangement.earlierArchives] }),
  };
};

/**
 * The backup as text. The least there is to keep is four lines that can be written down by hand. A complete
 * backup adds one line with the rest, which is for copying, not for writing down.
 */
export const userBackupText = (backup: UserBackup): string => {
  const { network, addressScheme, identity, words, ...rest } = backup;
  const lines = [TITLE, `network: ${network}`, `address scheme: ${addressScheme}`, `identity: ${identity}`, `words: ${words}`];
  if (Object.keys(rest).length > 0) lines.push(`more: ${JSON.stringify(rest)}`);
  return `${lines.join('\n')}\n`;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Read a backup from its text. Lines may be in any order and letters in any case, as when typed in from paper.
 *
 * @throws UserBackupError if something is missing, or the address scheme is not one this version knows:
 * an unknown version is refused, never guessed at
 */
export const readUserBackup = (text: string): UserBackup => {
  const fields = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([a-z ]+?)\s*:\s*(.*\S)\s*$/i.exec(line);
    if (match !== null) fields.set((match[1] as string).toLowerCase(), match[2] as string);
  }
  const network = fields.get('network')?.toLowerCase();
  if (network !== 'mainnet' && network !== 'testnet') throw new UserBackupError('The backup does not say which network it is for.');
  const addressScheme = Number(fields.get('address scheme'));
  if (addressScheme !== ADDRESS_SCHEME_VERSION) throw new UserBackupError(`The backup is for address scheme ${fields.get('address scheme') ?? '(not stated)'}; this version knows scheme ${ADDRESS_SCHEME_VERSION}.`);
  const identity = fields.get('identity')?.toLowerCase();
  if (identity === undefined || !/^[0-9a-f]{64}$/.test(identity)) throw new UserBackupError('The backup does not hold the wallet\'s identity: 64 hexadecimal characters. The words alone restore nothing.');
  const words = fields.get('words')?.toLowerCase().split(/\s+/).join(' ');
  if (words === undefined || words.split(' ').length !== 12) throw new UserBackupError('The backup does not hold twelve words.');
  const backup: UserBackup = { network, addressScheme, identity, words };
  const more = fields.get('more');
  if (more === undefined) return backup;
  let parsed: unknown;
  try {
    parsed = JSON.parse(more);
  } catch {
    throw new UserBackupError('The additional line of the backup cannot be read.');
  }
  if (!isObject(parsed)) throw new UserBackupError('The additional line of the backup cannot be read.');
  const { creationTransactionId, earlierViewingKeyRecords, archives } = parsed;
  return {
    ...backup,
    ...(typeof creationTransactionId === 'string' && /^[0-9a-f]{64}$/.test(creationTransactionId) ? { creationTransactionId } : {}),
    ...(Array.isArray(earlierViewingKeyRecords) ? { earlierViewingKeyRecords: earlierViewingKeyRecords as SignedJson[] } : {}),
    ...(Array.isArray(archives) ? { archives: archives as KitArchive[] } : {}),
  };
};

/**
 * Open the wallet again from a backup. The chain must show the backup's seed as the owner; a backup of a
 * seed that no longer owns the wallet is stale, and the device says so. The earlier seeds' viewing keys are
 * taken only from records the chain shows as an owner's.
 *
 * @returns the wallet, the seed's keys, and what the backup does not cover
 * @throws UserBackupError for a stale backup
 */
export const restoreFromBackup = async (options: {
  backup: UserBackup;
  backend: (seed: SeedKeys) => WalletBackend;
  chain: ChainReader;
  save?: (state: OwnerWalletState) => void;
  feeRate?: number;
}): Promise<{ wallet: OwnerWallet; seed: SeedKeys; notCovered: string[] }> => {
  const { backup } = options;
  const seed = deriveSeedKeys(backup.words, backup.network, walletTemplateNumbers());
  const history = await readControllerHistory(options.chain, hexToBin(backup.identity), backup.creationTransactionId);
  const own = hex(seed.controllerKey.keyHash);
  if (history.closed !== undefined) throw new UserBackupError('This wallet has been closed.');
  if (hex(history.current.state.ownerKeyHash) !== own) {
    throw new UserBackupError(
      history.owners.some((period) => hex(period.ownerKeyHash) === own)
        ? 'This backup is out of date: the wallet has a new seed since it was made. Its words no longer own the wallet; they spend only what is still at their own addresses and has not been swept.'
        : 'These words have never owned the wallet with this identity.',
    );
  }
  const earlierOwners = history.owners.map((period) => hex(period.ownerKeyHash)).filter((keyHash) => keyHash !== own);
  const found = new Map<string, ViewingKey>();
  for (const signed of backup.earlierViewingKeyRecords ?? []) {
    try {
      const record = readViewingKeyRecord(fromSignedJson(signed, 'viewing-key record'), backup.network);
      const keyHash = hex(hash160(record.controllerPublicKey));
      if (earlierOwners.includes(keyHash)) found.set(keyHash, record.viewingKey);
    } catch {
      // counted below as not covered, if it was an owner's
    }
  }
  const lacking = earlierOwners.filter((keyHash) => !found.has(keyHash)).length;
  const notCovered: string[] = [];
  if (lacking > 0) {
    notCovered.push(
      `The wallet has had ${earlierOwners.length} earlier seed${earlierOwners.length === 1 ? '' : 's'}, and this backup holds the viewing key of ${earlierOwners.length - lacking}. Earlier addresses are not covered: what is or arrives there, and at the earlier seeds' vault addresses, is not found. The recoverer holds those viewing keys.`,
    );
  }
  if (backup.archives === undefined) notCovered.push('The backup does not say where the backup stores are. Coins are restored; templates and labels are not, and can be had again from the applications.');
  const wallet = await OwnerWallet.takeOver({
    backend: options.backend(seed),
    chain: options.chain,
    seed,
    identity: hexToBin(backup.identity),
    earlierViewingKeys: earlierOwners.flatMap((keyHash) => found.get(keyHash) ?? []),
    ...(options.save === undefined ? {} : { save: options.save }),
    ...(options.feeRate === undefined ? {} : { feeRate: options.feeRate }),
  });
  return { wallet, seed, notCovered };
};
