import { binToHex, generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import { type Account, type AppChain, type LinkField, type SetUpRecord, type StoreAt, RecovererFunds } from '@grandmas-wallet/app';
import { linkKind, makeLink, readLink } from '@grandmas-wallet/app/links';
import { HttpStore } from '@grandmas-wallet/archive';
import type { ChainReader, ChallengeDelay } from '@grandmas-wallet/core';
import { type KeptKit, generateRecipientKeyPair, recipientKeyFingerprint } from '@grandmas-wallet/enrollment';
import { type Environment, type KeptInvitation, Vault, connectChain, keyNetwork, loadEnvironment, openAccount, withInvitation } from '@grandmas-wallet/ui';
import { defaultChallengeDelay } from './delays.js';

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
  /** The wallet open in this page. */
  current: string;
  incoming: { kind: LinkField | 'enroll'; text: string };
  mode: Mode;
  /** The first run is done: the balance has once covered a new wallet. */
  started: boolean;
  settings: Settings;
  /** The twelve words of the recoverer's own coins: its one balance, from which it creates wallets and pays every fee. */
  fundsWords: string;
  /** Developer mode: whether it is on, and the transactions this page sent with the engine's handle to each one's invitation. */
  developer: boolean;
  invitations: KeptInvitation[];
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
let pageNetwork = 'mainnet';
export const settingsOf = (): Settings => kept('settings') ?? { startingSatoshis: '10000', challengeDelay: defaultChallengeDelay(pageNetwork) };

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
  pageNetwork = environment.network;
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

/** The words of the recoverer's own coins, made the first time they are needed. */
const fundsWords = (): string => {
  const known = kept('fundsWords');
  if (known !== undefined) return known;
  const words = generateBip39Mnemonic();
  keep('fundsWords', words);
  return words;
};

let funds: Promise<RecovererFunds> | undefined;
let account: Account | undefined;
let opening: { verifiedHeight: number; currentHeight: number } | undefined;
/** How far the engine's check of block headers has come while the account opens, once it has begun. */
export const openingProgress = (): { verifiedHeight: number; currentHeight: number } | undefined => opening;
/** Stop the page's engine, before what the page keeps is erased. */
export const closeAccount = async (): Promise<void> => {
  await account?.close();
};
/** An invitation the page's engine holds, as text; nothing while the engine is not open. */
export const invitationText = async (invitationIdentifier: string): Promise<string | undefined> => account?.invitationText(invitationIdentifier);
/** The words of the recoverer's balance, if it has ever been opened: for keeping them before the page is erased. */
export const balanceWords = (): string | undefined => kept('fundsWords');
/** For the fixtures page, which has no chain: the recoverer's coins as given, or an account that never opens. */
export const useFixedFunds = (fixed: RecovererFunds | Promise<RecovererFunds>): void => {
  funds = Promise.resolve(fixed);
};
/**
 * The recoverer's own coins: the one engine of the page, on every screen. Wallets are created from it, and a
 * request and a completion for any wallet are paid from it; the key for a wallet's controller comes from that
 * wallet's credential and is used by the page's own code, so no wallet needs an engine of its own.
 */
export const fundsOf = (session: Session): Promise<RecovererFunds> => {
  funds ??= openAccount(fundsWords(), session.environment, (checked) => (opening = checked), (sent) => keep('invitations', withInvitation(kept('invitations'), sent)))
    .then((opened) => {
      account = opened;
      return RecovererFunds.open({ backend: opened, chain: session.chain });
    })
    .catch((error: unknown) => {
      funds = undefined;
      throw error;
    });
  return funds;
};

/** Open another wallet, or none: the page loads again and shows it. */
export const openWalletPage = (identity: string | undefined, path = '/'): void => {
  keep('current', identity);
  window.location.assign(path);
};
