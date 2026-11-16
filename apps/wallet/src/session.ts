import { generateBip39Mnemonic } from '@bitauth/libauth';
import { type AppChain, type LinkField, type WalletDependencies, type WalletRecord, type TakeoverRecord, XoAccount, linkKind } from '@grandmas-wallet/app';
import { HttpStore } from '@grandmas-wallet/archive';
import type { ChainReader } from '@grandmas-wallet/core';
import { type Environment, DeviceStore, Vault, connectChain, loadEnvironment } from '@grandmas-wallet/ui';

/**
 * What the wallet page holds while it is open: its configuration, its
 * connections, and the account whose keys live in this browser.
 */
export interface Session {
  environment: Environment;
  vault: Vault;
  chain: AppChain;
  servers: ChainReader[];
  local: DeviceStore;
  /** A link the page was opened with, kept until something has dealt with it. */
  incoming?: { kind: LinkField | 'enroll'; text: string };
  mnemonic?: string;
  account?: XoAccount;
}

export const boot = async (): Promise<Session> => {
  const environment = await loadEnvironment();
  const vault = new Vault('wallet');
  // The link's content is taken out of the address bar, where it would otherwise stay in the history.
  const text = window.location.href;
  const kind = linkKind(text);
  if (kind !== undefined) {
    vault.set('incoming', { kind, text });
    window.history.replaceState(null, '', window.location.pathname);
  }
  const { chain, servers } = await connectChain(environment.chain, environment.secondsPerBlock);
  const session: Session = { environment, vault, chain, servers, local: new DeviceStore('wallet-archive') };
  const incoming = vault.get<{ kind: LinkField | 'enroll'; text: string }>('incoming');
  if (incoming !== undefined) session.incoming = incoming;
  const mnemonic = vault.get<string>('mnemonic');
  if (mnemonic !== undefined) await openAccount(session, mnemonic);
  return session;
};

const openAccount = async (session: Session, mnemonic: string): Promise<XoAccount> => {
  session.mnemonic = mnemonic;
  session.account = await XoAccount.open(mnemonic, session.vault.memory('account'));
  return session.account;
};

/** The account of this device, made on first use. */
export const ensureAccount = async (session: Session): Promise<XoAccount> => {
  if (session.account !== undefined) return session.account;
  const mnemonic = generateBip39Mnemonic();
  session.vault.set('mnemonic', mnemonic);
  return openAccount(session, mnemonic);
};

export const takeIncoming = (session: Session): void => {
  session.vault.remove('incoming');
  delete session.incoming;
};

export const walletDependencies = (session: Session, onProgress?: (step: string) => void): WalletDependencies => {
  if (session.account === undefined || session.mnemonic === undefined) throw new Error('This device has no account yet.');
  return {
    account: session.account,
    mnemonic: session.mnemonic,
    chain: session.chain,
    local: session.local,
    openStore: (url) => new HttpStore(url),
    save: (record: WalletRecord) => session.vault.set('wallet', record),
    ...(onProgress === undefined ? {} : { onProgress }),
  };
};

export const storedWallet = (session: Session): WalletRecord | undefined => session.vault.get<WalletRecord>('wallet');
export const storedTakeover = (session: Session): TakeoverRecord | undefined => session.vault.get<TakeoverRecord>('takeover');
