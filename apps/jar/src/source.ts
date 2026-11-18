import type { DappRequests, RequestStage } from '@grandmas-wallet/connect';
import type { WalletOffer } from '@grandmas-wallet/connect/wizard';

import { type JarView, explain } from './jar.js';
import { type PlainChain, type Signer, type WalletPaths, PlainWallet, networkOf, readPaths } from './plain.js';
import { type PendingStore, STAGE_WORDS, XoJars, xoProblem } from './xo.js';

/**
 * One page for both kinds of wallet. What the wallet offers when it connects decides how the page works
 * with it; the rest of the page sees the same jars and the same three actions either way.
 */

export type Kind =
  /** The wallet carries out the template's actions itself. */
  | { kind: 'xo' }
  /** The wallet shares the public keys of its address chains and signs what the page builds. */
  | { kind: 'plain'; paths: WalletPaths }
  | { kind: 'unusable'; reason: string };

/**
 * How this page will work with a wallet. XO requests are used where the wallet offers them in a form the
 * page can use; otherwise the wallet's shared keys, if it shared them.
 * @param network - the network the page is configured for
 */
export const kindOf = (offer: WalletOffer, network: string): Kind => {
  const xo = offer.xo === undefined ? offer.xoProblem : xoProblem(offer.xo, network);
  if (offer.xo !== undefined && xo === undefined) return { kind: 'xo' };
  if (offer.paths.length === 0) return { kind: 'unusable', reason: xo ?? 'Your wallet shared neither its addresses nor XO requests, so this page cannot work with it.' };
  try {
    const paths = readPaths(offer.paths);
    const wanted = network === 'mainnet' ? 'mainnet' : 'testnet';
    if (networkOf(paths) !== wanted) {
      return { kind: 'unusable', reason: `Your wallet's addresses are for ${networkOf(paths) === 'mainnet' ? 'the main network' : 'a test network'}; this page is on ${network}. Switch the wallet's network and connect again.` };
    }
    return { kind: 'plain', paths };
  } catch (error) {
    return { kind: 'unusable', reason: xo ?? (error as Error).message };
  }
};

/** How far an action has come, for the person waiting. */
export interface Progress {
  text: string;
  /** For an action the wallet carries out: the step of the request. */
  stage?: RequestStage;
}

export interface Done {
  transactionId?: string;
  category?: string;
}

export interface Listing {
  jars: JarView[];
  /** False when the wallet reports nothing because this page has not been used with it yet. */
  trusted: boolean;
  /** For an ordinary wallet: what its coins without tokens hold. */
  balance?: bigint;
}

/** The jars of one connected wallet and what can be done with them. */
export interface JarSource {
  kind: 'xo' | 'plain';
  list(): Promise<Listing>;
  open(satoshis: bigint, unlockTime: number, progress: (step: Progress) => void): Promise<Done>;
  deposit(jar: JarView, satoshis: bigint, progress: (step: Progress) => void): Promise<Done>;
  withdraw(jar: JarView, progress: (step: Progress) => void): Promise<Done>;
  /** Stop listening to the connection. */
  close?(): void;
}

/** A refusal in the wallet's or the network's own words, with what it means where that helps. */
const explained = async <T>(work: Promise<T>): Promise<T> => {
  try {
    return await work;
  } catch (error) {
    const problem = error instanceof Error ? error : new Error(String(error));
    const words = explain(problem.message);
    if (words === problem.message) throw problem;
    const replaced = new Error(words);
    replaced.name = problem.name;
    throw replaced;
  }
};

export const stageProgress = (stage: RequestStage): Progress => ({ text: STAGE_WORDS[stage], stage });

export const xoSource = (requests: DappRequests, store: PendingStore): JarSource & { jars: XoJars } => {
  const jars = new XoJars(requests, store);
  const follow = (progress: (step: Progress) => void) => (stage: RequestStage) => progress(stageProgress(stage));
  return {
    kind: 'xo',
    jars,
    list: () => jars.list(),
    open: (satoshis, unlockTime, progress) => explained(jars.open(satoshis, unlockTime, follow(progress))),
    deposit: (jar, satoshis, progress) => explained(jars.deposit(jar.category, satoshis, follow(progress))),
    withdraw: (jar, progress) => explained(jars.withdraw(jar.category, follow(progress))),
    close: () => requests.detach(),
  };
};

export const plainSource = (chain: PlainChain, paths: WalletPaths, sign: Signer): JarSource & { wallet: PlainWallet } => {
  const wallet = new PlainWallet(chain, paths, sign);
  const say = (progress: (step: Progress) => void) => (text: string) => progress({ text });
  return {
    kind: 'plain',
    wallet,
    list: async () => {
      const scan = await wallet.scan();
      return { jars: await wallet.jars(scan), trusted: true, balance: scan.balance };
    },
    open: (satoshis, unlockTime, progress) => explained(wallet.open(satoshis, unlockTime, say(progress))),
    deposit: async (jar, satoshis, progress) => ({ transactionId: await explained(wallet.deposit(jar, satoshis, say(progress))) }),
    withdraw: async (jar, progress) => ({ transactionId: await explained(wallet.withdraw(jar.category, say(progress))) }),
  };
};
