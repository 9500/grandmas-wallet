import { binToHex, generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import {
  type Account,
  type AppChain,
  type DirectHandOver,
  type LinkField,
  type NewSeedPreparation,
  type OwnerWalletState,
  type PendingTakeover,
  type RecoveryArrangement,
  type StoreAt,
  type WatchLog,
  OwnerWallet,
  walletTemplateNumbers,
} from '@grandmas-wallet/app';
import { linkKind, readLink } from '@grandmas-wallet/app/links';
import { HttpStore } from '@grandmas-wallet/archive';
import type { LedgerEntry } from '@grandmas-wallet/connect';
import { type ChainReader, type ChallengeDelay, type SeedKeys, deriveSeedKeys } from '@grandmas-wallet/core';
import { recipientKeyFingerprint } from '@grandmas-wallet/enrollment';
import { type Environment, Vault, connectChain, keyNetwork, loadEnvironment, openAccount } from '@grandmas-wallet/ui';

/**
 * What the wallet page holds while it is open, and what it keeps in this browser between visits.
 *
 * Everything is kept under names of its own (`gw2-wallet:`), apart from what an earlier version of the page
 * kept under the same address. The twelve words are stored as they are: this is a page for a test network.
 */

export const vault = new Vault('gw2-wallet');

/** What the device is doing, before and after it has a wallet. */
export type Mode =
  /** Making a new wallet: the steps of creation. */
  | 'create'
  /** A new device asks the recoverer to take a wallet over. */
  | 'takeover'
  /** A new device takes the wallet over from the owner's other device, which still works. */
  | 'move'
  /** The device owns a wallet. */
  | 'owner';

/** The recoverer as this device knows it: from the link the recoverer's page shows. */
export interface StoredRecipient {
  name: string;
  page: string;
  /** The recoverer's encryption key, hex. */
  publicKey: string;
}

/** What was chosen before the wallet was created. */
export interface Setup {
  recipient: StoredRecipient;
  delay: ChallengeDelay;
  allowance: boolean;
  /** The recoverer's credential, made by this device. Forgotten once the recoverer's receipt is found. */
  credentialWords?: string;
  /** The hash of the credential's recovery key, hex: what the controller names. */
  recoveryKeyHash: string;
}

/** A transaction this device sent, for the list of what it did. */
export interface Activity {
  what: string;
  transactionId: string;
  bytes: number;
  /** Satoshis, as a decimal string. */
  fee: string;
  remainder?: string;
  amount?: string;
  at: number;
}

/** The names under which the page keeps things. */
export interface Kept {
  mode: Mode;
  words: string;
  state: OwnerWalletState;
  arrangement: RecoveryArrangement;
  setup: Setup;
  /** The recoverer this wallet's arrangement is with. */
  recipient: StoredRecipient;
  /** The link of the kit this device sent, until the receipt is found. */
  kitLink: string;
  /** A new device's takeover request. */
  takeover: { pending: PendingTakeover; recipient: StoredRecipient; link: string };
  /** A new device's preparation for a move from the old device, and the link to the old device. */
  preparation: { preparation: NewSeedPreparation; link: string };
  /** What the old device handed this one directly, for a move. */
  moveIn: DirectHandOver;
  /** The old device's side of a move: the links it made, and the new seed's fingerprint. */
  moveOut: { updateLink: string; moveLink: string; fingerprint: string };
  /** A new recoverer being enrolled. */
  newRecoverer: { recipient: StoredRecipient; credentialWords: string; link: string; delay?: ChallengeDelay };
  /** A new waiting period being announced. */
  newDelay: { delay: ChallengeDelay; link: string };
  /** After a takeover, a move or a restore: where bringing the coins over stands. */
  arrival: { from: 'takeover' | 'move' | 'restore'; missing: string[]; searched?: 'quick' | 'full'; swept?: boolean };
  watchLog: WatchLog;
  activity: Activity[];
  /** The address shown on the receive screen, so that it stays the same until another is asked for. */
  receive: { number: number; again: boolean };
  /** The vault address shown, likewise. */
  vaultReceive: { number: number; again: boolean };
  /** Refuse a request to another key without asking. */
  autoCancel: boolean;
  /** A link the page was opened with, until something has dealt with it. */
  incoming: { kind: LinkField | 'enroll'; text: string };
  /** The applications this device is connected to, so that the page connects again when it is opened. */
  connections: Connection[];
  /** Every request an application made, with its outcome: what makes a request carried out at most once. */
  ledger: LedgerEntry[];
}

/** A connection to an application over WizardConnect. */
export interface Connection {
  /** The `wiz://` address the application showed. */
  uri: string;
  /** This device's key for this connection alone, hex. */
  privateKey: string;
  /** The name of the pairing: which application a request came from. */
  pairing: string;
  /** The application's own name for itself, as it last gave it. Not verified. */
  name?: string;
  /** Unix seconds. */
  addedAt: number;
}

export const kept = <Name extends keyof Kept>(name: Name): Kept[Name] | undefined => vault.get<Kept[Name]>(name);
export const keep = <Name extends keyof Kept>(name: Name, value: Kept[Name] | undefined): void => (value === undefined ? vault.remove(name) : vault.set(name, value));

export interface Session {
  environment: Environment;
  network: 'mainnet' | 'testnet';
  chain: AppChain;
  /** Each reachable server by itself, for watching. */
  servers: ChainReader[];
  storeAt: StoreAt;
}

const stores = new Map<string, HttpStore>();
const storeAt: StoreAt = (address) => {
  const known = stores.get(address) ?? new HttpStore(address);
  stores.set(address, known);
  return known;
};

/** Read the configuration, connect to the servers, and take in a link the page was opened with. */
export const boot = async (): Promise<Session> => {
  const environment = await loadEnvironment();
  // The link's content is taken out of the address bar, where it would otherwise stay in the history.
  const kind = linkKind(window.location.href);
  if (kind !== undefined) {
    keep('incoming', { kind, text: window.location.href });
    window.history.replaceState(null, '', window.location.pathname);
  }
  const { chain, servers } = await connectChain(environment.chain, environment.secondsPerBlock);
  return { environment, network: keyNetwork(environment), chain, servers, storeAt };
};

/** The device's own twelve words, made the first time they are needed. */
export const deviceWords = (): string => {
  const existing = kept('words');
  if (existing !== undefined) return existing;
  const words = generateBip39Mnemonic();
  keep('words', words);
  return words;
};

export const seedOf = (session: Session, words: string): SeedKeys => deriveSeedKeys(words, session.network, walletTemplateNumbers());

let account: Promise<Account> | undefined;
/** The XO engine account of this device's words. Only one engine can be open in a page; it is opened once. */
export const deviceAccount = (session: Session): Promise<Account> => {
  account ??= openAccount(deviceWords(), session.environment).catch((error: unknown) => {
    account = undefined;
    throw error;
  });
  return account;
};

/** The account, if one was opened in this page. */
export const openedAccount = async (): Promise<Account | undefined> => (account === undefined ? undefined : account.catch(() => undefined));

/** Open the wallet this device keeps. */
export const openWallet = async (session: Session): Promise<OwnerWallet> =>
  OwnerWallet.open({
    backend: await deviceAccount(session),
    chain: session.chain,
    seed: seedOf(session, deviceWords()),
    ...(kept('state') === undefined ? {} : { state: kept('state') as OwnerWalletState }),
    save: (state) => keep('state', state),
  });

export const saveState = (state: OwnerWalletState): void => keep('state', state);

/** Read a `recoverer` link: the recoverer's name, page and encryption key. */
export const readRecipientLink = async (text: string): Promise<StoredRecipient> => {
  const read = await readLink<{ name?: unknown; page?: unknown; publicKey?: unknown }>(text, 'recoverer');
  if (read === undefined) throw new Error('This is not a recoverer\'s link. The recoverer\'s page shows it under "Your link".');
  const { name, page, publicKey } = read;
  if (typeof name !== 'string' || typeof page !== 'string' || typeof publicKey !== 'string' || !/^[0-9a-f]{64}$/.test(publicKey)) throw new Error('The recoverer\'s link is incomplete.');
  return { name, page, publicKey };
};

export const recipientOf = (stored: StoredRecipient) => ({ name: stored.name, page: stored.page, publicKey: hexToBin(stored.publicKey) });
export const recipientFingerprint = (stored: StoredRecipient): string => recipientKeyFingerprint(hexToBin(stored.publicKey));

/** Bytes in a link: the sealed messages travel as hex inside the link's compressed content. */
export const sealedOf = async (text: string, field: 'handover' | 'takeover' | 'update'): Promise<Uint8Array | undefined> => {
  const read = await readLink<{ sealed?: unknown }>(text, field);
  if (read === undefined) return undefined;
  if (typeof read.sealed !== 'string' || !/^[0-9a-f]+$/.test(read.sealed)) throw new Error('The link is incomplete.');
  return hexToBin(read.sealed);
};
export const sealedContent = (sealed: Uint8Array): { sealed: string } => ({ sealed: binToHex(sealed) });

export const noteActivity = (entry: Omit<Activity, 'at'>): void => {
  keep('activity', [{ ...entry, at: Math.floor(Date.now() / 1000) }, ...(kept('activity') ?? [])].slice(0, 100));
};
