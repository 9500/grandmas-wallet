import { type AppChain, type DeskDependencies, type EnrolledWallet, type LinkField, XoAccount, linkKind, readLink } from '@grandmas-wallet/app';
import { HttpStore } from '@grandmas-wallet/archive';
import type { ChainReader } from '@grandmas-wallet/core';
import { type RecipientKeyPair, generateRecipientKeyPair, parsePackage } from '@grandmas-wallet/enrollment';
import { type Environment, Vault, connectChain, loadEnvironment } from '@grandmas-wallet/ui';

/** What the recoverer's page holds while it is open. */
export interface Session {
  environment: Environment;
  vault: Vault;
  chain: AppChain;
  servers: ChainReader[];
  /** The key wallets seal their packages to. */
  keys: RecipientKeyPair;
  name: string;
  incoming?: { kind: LinkField | 'enroll'; text: string };
  /** The wallet whose desk is open, from the address. */
  openIdentity?: string;
}

const DESK = /^#\/w\/([0-9a-f]{64})$/;

export const boot = async (): Promise<Session> => {
  const environment = await loadEnvironment();
  const vault = new Vault('recoverer');
  const text = window.location.href;
  const kind = linkKind(text);
  if (kind !== undefined) {
    vault.set('incoming', { kind, text });
    let next = window.location.pathname;
    if (kind === 'join') {
      // The link names the wallet it is about; go straight to that wallet.
      const message = await readLink<{ identity?: string }>(text, 'join').catch(() => undefined);
      if (typeof message?.identity === 'string' && /^[0-9a-f]{64}$/.test(message.identity)) next += `#/w/${message.identity}`;
    }
    window.history.replaceState(null, '', next);
  }
  let keys = vault.get<RecipientKeyPair>('keys');
  if (keys === undefined) {
    keys = await generateRecipientKeyPair();
    vault.set('keys', keys);
  }
  const { chain, servers } = await connectChain(environment.chain, environment.secondsPerBlock);
  const session: Session = { environment, vault, chain, servers, keys, name: vault.get<string>('name') ?? 'Demo Recoverer' };
  const incoming = vault.get<{ kind: LinkField | 'enroll'; text: string }>('incoming');
  if (incoming !== undefined) session.incoming = incoming;
  const identity = DESK.exec(window.location.hash)?.[1];
  if (identity !== undefined) session.openIdentity = identity;
  return session;
};

export const takeIncoming = (session: Session): void => {
  session.vault.remove('incoming');
  delete session.incoming;
};

export const enrolledWallets = (session: Session): EnrolledWallet[] =>
  session.vault
    .names()
    .filter((name) => name.startsWith('wallet/'))
    .flatMap((name) => session.vault.get<EnrolledWallet>(name) ?? [])
    .sort((a, b) => b.importedAt - a.importedAt);

export const identityOf = (enrolled: EnrolledWallet): string => parsePackage(enrolled.signed.message).identity;

export const saveEnrolled = (session: Session, enrolled: EnrolledWallet): void => session.vault.set(`wallet/${identityOf(enrolled)}`, enrolled);

/** Only one account can be open in a page, so going to a wallet's desk, or away from it, loads the page again. */
export const goTo = (identity: string | undefined): void => {
  window.location.hash = identity === undefined ? '' : `#/w/${identity}`;
  window.location.reload();
};

/** Open the account that holds a wallet's recovery credential. */
export const deskDependencies = async (session: Session, enrolled: EnrolledWallet): Promise<DeskDependencies> => {
  const enrollment = parsePackage(enrolled.signed.message);
  const account = await XoAccount.open(enrollment.recovery.mnemonic, session.vault.memory(`account/${enrollment.identity}`));
  return {
    account,
    chain: session.chain,
    openStore: (url) => new HttpStore(url),
    save: (updated) => saveEnrolled(session, updated),
  };
};
