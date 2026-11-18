import { binToHex, generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import { type Account, type AppChain, type LinkField, type SetUpRecord, type StoreAt, RecovererFunds } from '@grandmas-wallet/app';
import { linkKind, makeLink, readLink } from '@grandmas-wallet/app/links';
import { HttpStore } from '@grandmas-wallet/archive';
import type { ChainReader, ChallengeDelay } from '@grandmas-wallet/core';
import { type KeptKit, generateRecipientKeyPair, recipientKeyFingerprint } from '@grandmas-wallet/enrollment';
import { type Environment, Vault, connectChain, keyNetwork, loadEnvironment, openAccount } from '@grandmas-wallet/ui';

/**
 * What the recoverer's page holds while it is open, and what it keeps in this browser: its encryption key,
 * the kit of every wallet it looks after, and the takeover requests it has received. Everything is kept
 * under names of its own (`gw2-recoverer:`).
 */

export const vault = new Vault('gw2-recoverer');

/** A wallet the recoverer looks after. */
export interface Looked {
  kept: KeptKit;
  /** The recoverer's own name for it. */
  label: string;
  addedAt: number;
  /** Taken in as a new recoverer, before the wallet names this recoverer. */
  asNewRecoverer?: boolean;
  /** The request this recoverer sent, so that a refusal can be told apart. */
  requested?: { proposedKeyHash: string; transactionId: string };
  /** The hand-over link, once made, so that it can be given again. */
  handOverLink?: string;
  /** The new phone said, over the session of the lost phone's code, that it has the hand-over. */
  handOverDelivered?: boolean;
}

/** A takeover message, before and after the recoverer has said which wallet it is for. */
export interface InboxEntry {
  /** The sealed message, hex. */
  sealed: string;
  messageHash: string;
  proposedKeyHash: string;
  fingerprint: string;
  receivedAt: number;
  assignedTo?: string;
}

/** How this recoverer works: a bank sets wallets up without asking; someone helping a person they know says yes first. */
export type Mode = 'bank' | 'friend';

/** What a new wallet gets, and the waiting period it is created with. */
export interface Settings {
  /** Satoshis, as a decimal string. */
  startingSatoshis: string;
  challengeDelay: ChallengeDelay;
}

export interface Kept {
  key: { publicKey: string; privateKey: string };
  name: string;
  wallets: Record<string, Looked>;
  inbox: InboxEntry[];
  /** The wallet open in this page: its credential's account is the engine of the page. */
  current: string;
  incoming: { kind: LinkField | 'enroll'; text: string };
  mode: Mode;
  settings: Settings;
  /** The twelve words of the recoverer's own coins: its balance, from which it creates wallets and pays its fees. */
  fundsWords: string;
  /** Phones' requests to have a wallet set up, by request. */
  setUps: Record<string, SetUpRecord>;
  /** The session the page's code offers, kept so that the page offers the same one after a reload. */
  deskSession: { privateKey: string; secret: string; walletPublicKey?: string; for?: string };
}

/**
 * Until the recoverer chooses, the starting balance and the waiting period of a new wallet. On a test network
 * the waiting period starts at the shortest, so that moving a wallet to a new phone can be tried out without
 * a day's wait; with real coins it starts at a day.
 */
let onTestNetwork = false;
export const settingsOf = (): Settings => kept('settings') ?? { startingSatoshis: '10000', challengeDelay: { unit: 'time512', value: onTestNetwork ? 1 : 169 } };

/**
 * How this page works. A page that held kits before it could be asked keeps working as someone helping people
 * they know, and shows its wallets at once.
 */
export const modeOf = (): Mode | undefined => kept('mode') ?? (Object.keys(kept('wallets') ?? {}).length > 0 ? 'friend' : undefined);

export const kept = <Name extends keyof Kept>(name: Name): Kept[Name] | undefined => vault.get<Kept[Name]>(name);
export const keep = <Name extends keyof Kept>(name: Name, value: Kept[Name] | undefined): void => (value === undefined ? vault.remove(name) : vault.set(name, value));

export const wallets = (): Record<string, Looked> => kept('wallets') ?? {};
export const saveWallet = (identity: string, looked: Looked): void => keep('wallets', { ...wallets(), [identity]: looked });

export interface Session {
  environment: Environment;
  network: 'mainnet' | 'testnet';
  chain: AppChain;
  servers: ChainReader[];
  storeAt: StoreAt;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

const stores = new Map<string, HttpStore>();
const storeAt: StoreAt = (address) => {
  const known = stores.get(address) ?? new HttpStore(address);
  stores.set(address, known);
  return known;
};

export const boot = async (): Promise<Session> => {
  const environment = await loadEnvironment();
  const kind = linkKind(window.location.href);
  if (kind !== undefined) {
    keep('incoming', { kind, text: window.location.href });
    window.history.replaceState(null, '', window.location.pathname);
  }
  // The encryption key is made on first use and never leaves this browser.
  let key = kept('key');
  if (key === undefined) {
    const made = await generateRecipientKeyPair();
    key = { publicKey: binToHex(made.publicKey), privateKey: binToHex(made.privateKey) };
    keep('key', key);
  }
  onTestNetwork = environment.network !== 'mainnet';
  const { chain, servers } = await connectChain(environment.chain, environment.secondsPerBlock);
  return { environment, network: keyNetwork(environment), chain, servers, storeAt, publicKey: hexToBin(key.publicKey), privateKey: hexToBin(key.privateKey) };
};

export const fingerprintOf = (session: Session): string => recipientKeyFingerprint(session.publicKey);

/**
 * The link the owner's wallet takes in: this recoverer's name, its page and its encryption key. Not secret. In
 * the page's QR code it also names the session the page offers while it is open, so that the wallet can send
 * the kit straight back; a link sent as a message names none, and works at any time.
 */
export const recovererLink = (session: Session, sessionAddress?: string): Promise<string> =>
  makeLink(session.environment.walletUrl, 'recoverer', {
    name: kept('name') ?? '',
    page: session.environment.recovererUrl,
    publicKey: binToHex(session.publicKey),
    ...(sessionAddress === undefined ? {} : { session: sessionAddress }),
  });

export const sealedOf = async (text: string, field: 'takeover' | 'update'): Promise<Uint8Array> => {
  const read = await readLink<{ sealed?: unknown }>(text, field);
  if (read === undefined || typeof read.sealed !== 'string' || !/^[0-9a-f]+$/.test(read.sealed)) throw new Error('The link is incomplete.');
  return hexToBin(read.sealed);
};

let account: Promise<Account> | undefined;
/** The account of one wallet's credential. Only one engine can be open in a page; switching wallets loads the page again. */
export const credentialAccount = (session: Session, words: string): Promise<Account> => {
  account ??= openAccount(words, session.environment).catch((error: unknown) => {
    account = undefined;
    throw error;
  });
  return account;
};

/** The words of the recoverer's own coins, made the first time they are needed. */
const fundsWords = (): string => {
  const known = kept('fundsWords');
  if (known !== undefined) return known;
  const words = generateBip39Mnemonic();
  keep('fundsWords', words);
  return words;
};

let funds: Promise<RecovererFunds> | undefined;
/** For the fixtures page, which has no chain: the recoverer's coins as given. */
export const useFixedFunds = (fixed: RecovererFunds): void => {
  funds = Promise.resolve(fixed);
};
/**
 * The recoverer's own coins: the engine of the page's first screens, from which wallets are created. A page that
 * opens one wallet's credential instead loads again.
 */
export const fundsOf = (session: Session): Promise<RecovererFunds> => {
  funds ??= credentialAccount(session, fundsWords())
    .then((opened) => RecovererFunds.open({ backend: opened, chain: session.chain }))
    .catch((error: unknown) => {
      funds = undefined;
      throw error;
    });
  return funds;
};

/** Open another wallet: the page loads again, so that its engine opens with that wallet's credential. */
export const openWalletPage = (identity: string | undefined, path = '/'): void => {
  keep('current', identity);
  window.location.assign(path);
};
