// What the courses of stage 17 in browsers share beyond scripts/browser-course.ts: the record of every request a
// phone's browser makes, reading a screen as text, and what the wallet pages kept, for naming the run's coins.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

import { binToHex, cashAddressToLockingBytecode, hexToBin } from '@bitauth/libauth';
import { type ChainReader, ADDRESS_KIND, deriveSeedKeys, keyPairFromPrivateKey, p2pkhLockingBytecode, quickPass, readControllerHistory } from '@grandmas-wallet/core';
import type { BrowserContext, Locator } from 'playwright';

import { walletTemplateNumbers } from '../packages/app/src/templates.js';
import { chipnet, root } from './browser-course.js';
import { chainServer } from './browser-ledger.js';

/** Text without its line breaks and repeated spaces. */
export const flat = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();
/** What a part of a page says, as one line. */
export const textOf = async (locator: Locator): Promise<string> => flat(await locator.first().innerText());
/** Open every fold of a part of a page, so that what it says can be read and pictured whole. */
export const openFolds = (locator: Locator): Promise<void> => locator.first().evaluate((element) => element.querySelectorAll('details').forEach((fold) => (fold.open = true)));

/** A cash address as the hex of its locking bytecode; empty for something that is not one. */
export const lockingOf = (address: string): string => {
  const decoded = cashAddressToLockingBytecode(address);
  return typeof decoded === 'string' ? '' : binToHex(decoded.bytecode);
};

/**
 * The locking bytecode of the payer of the course, as hex: the local payer of `scripts/local-pay.ts`, or on chipnet
 * the funding address of `scripts/chipnet-pay.ts`. Empty before it has a key.
 */
export const localPayerLocking = (): string => {
  const file = chipnet ? `${root}.chipnet/funder-design-2.json` : `${root}.local-runs/local-funder.json`;
  if (!existsSync(file)) return '';
  return binToHex(p2pkhLockingBytecode(keyPairFromPrivateKey(hexToBin((JSON.parse(readFileSync(file, 'utf8')) as { privateKey: string }).privateKey)).keyHash));
};

// ------------------------------------------------------------------ requests

export interface RequestLog {
  /** Record every request of a browser profile from now on: each page's, each web socket's. */
  watch(context: BrowserContext): void;
  urls(): string[];
}

/**
 * Every request a browser makes, kept in a file as it is made, so that a run continued from its profiles keeps
 * what the part before it recorded.
 * @param continuing - the file holds the requests of the part before, which are kept
 */
export const recordRequests = (file: string, continuing: boolean): RequestLog => {
  if (!continuing || !existsSync(file)) writeFileSync(file, '');
  const seen = new WeakSet<object>();
  const add = (url: string): void => appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), url })}\n`);
  return {
    watch: (context) => {
      if (seen.has(context)) return;
      seen.add(context);
      context.on('request', (asked) => add(asked.url()));
      const sockets = (page: import('playwright').Page): void => void page.on('websocket', (socket) => add(socket.url()));
      context.pages().forEach(sockets);
      context.on('page', sockets);
    },
    urls: () =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => (JSON.parse(line) as { url: string }).url),
  };
};

/** The record's part about a phone's requests: how many to each origin, and what each origin was asked. */
export const requestsSection = (requests: RequestLog, pageOrigin: string, pageName: string, toPage: string[], note = ''): string[] => {
  const urls = requests.urls();
  const byOrigin = new Map<string, string[]>();
  for (const url of urls) {
    let origin = url;
    let path = '';
    try {
      const parsed = new URL(url);
      origin = parsed.protocol === 'data:' || parsed.protocol === 'blob:' ? parsed.protocol : parsed.origin;
      path = parsed.protocol === 'data:' || parsed.protocol === 'blob:' ? '' : parsed.pathname;
    } catch {
      // kept whole
    }
    byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), path]);
  }
  return [
    `Every request the new phone's browser made, from the moment its profile was made until the end of the run, recorded by Playwright for every page of the profile (requests of the pages and of their workers, and web sockets): ${urls.length} in all.${note === '' ? '' : ` ${note}`}`,
    '',
    '| Origin | Requests | What was asked |',
    '| --- | --- | --- |',
    ...[...byOrigin].map(([origin, paths]) => {
      const distinct = [...new Set(paths)];
      const shown = distinct.length > 8 ? [...distinct.slice(0, 8), `and ${distinct.length - 8} more`] : distinct;
      return `| ${origin} | ${paths.length} | ${shown.map((path) => (path.startsWith('and ') ? path : `\`${path === '' ? '(the whole address)' : path}\``)).join(', ')} |`;
    }),
    '',
    toPage.length === 0 ? `None went to ${pageName} (${pageOrigin}).` : `${toPage.length} went to ${pageName} (${pageOrigin}): ${toPage.join(', ')}.`,
    '',
  ];
};

// ------------------------------------------------------------------ what the wallet pages kept

export interface WalletKept {
  identity?: string;
  /** Each phone's words, by the name of its profile. */
  words: Record<string, string>;
  activity: { who: string; what: string; transactionId: string }[];
}

/** What the wallet page kept in each phone's profile, from the copies a course makes beside the profiles. */
export const walletKept = (work: string, phones: string[], walletUrl: string): WalletKept => {
  const origin = new URL(walletUrl).origin;
  const found: WalletKept = { words: {}, activity: [] };
  for (const phone of phones) {
    const file = `${work}storage-${phone}.json`;
    if (!existsSync(file)) continue;
    const items = (JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, string>>)[origin] ?? {};
    const value = <T>(name: string): T | undefined => (items[`gw2-wallet:${name}`] === undefined ? undefined : (JSON.parse(items[`gw2-wallet:${name}`] as string) as T));
    const words = value<string>('words');
    if (words !== undefined) found.words[phone] = words;
    const state = value<{ identity?: string | { $bytes: string } }>('state');
    const identity = typeof state?.identity === 'string' ? state.identity : state?.identity?.$bytes;
    if (identity !== undefined) found.identity = identity;
    for (const entry of value<{ what: string; transactionId: string }[]>('activity') ?? []) found.activity.push({ who: phone, what: entry.what, transactionId: entry.transactionId });
  }
  return found;
};

const localChain = async <T>(work: (chain: ChainReader) => Promise<T>): Promise<T> => {
  const server = await chainServer();
  try {
    return await work({
      getHistory: (lockingBytecode) => server.getHistory(lockingBytecode),
      getTransaction: (transactionId) => server.getTransaction(transactionId),
      listUnspent: async (lockingBytecode) => (await server.listUnspent(lockingBytecode)).map((entry) => ({ ...entry, hasToken: entry.token !== undefined })),
    });
  } finally {
    await server.disconnect();
  }
};

const TRANSITIONS: Record<string, string> = {
  requestRecovery: 'The recoverer asks to move the wallet to the new phone\'s key (the controller\'s request), paid from her balance',
  finalizeRecovery: 'The recoverer completes the move after the waiting period, paid from her balance',
  ownerUpdate: 'The controller\'s owner changes its settings',
  ownerAuthorize: 'The owner approves a spend at the controller',
};

/** What each transaction of the wallet's controller was, from its history on the course's chain. */
export const controllerLabels = async (identity: string | undefined): Promise<Map<string, string>> => {
  const labels = new Map<string, string>();
  if (identity === undefined) return labels;
  const history = await localChain((chain) => readControllerHistory(chain, hexToBin(identity)));
  history.transactions.forEach(({ transactionId }, index) => {
    const kind = index === 0 ? undefined : history.transitions[index - 1]?.kind;
    labels.set(transactionId, index === 0 ? 'The recoverer creates the wallet for the phone: the controller, its identity token and the starting balance, from her balance' : (TRANSITIONS[kind ?? ''] ?? `A transaction of the controller (${kind ?? 'unknown'})`));
  });
  if (history.closed !== undefined) labels.set(history.closed.transactionId, 'The wallet is closed');
  return labels;
};

/** The wallet's addresses that the chain shows were used, for each phone's seed: locking bytecode as hex → whose. */
export const walletPlaces = async (kept: WalletKept, names: Record<string, string> = { 'old-phone': 'an address of the lost phone\'s seed', 'new-phone': 'an address of the new phone\'s seed' }): Promise<Map<string, string>> => {
  const places = new Map<string, string>();
  if (kept.identity === undefined) return places;
  const server = await chainServer();
  try {
    const chain: ChainReader = {
      getHistory: (lockingBytecode) => server.getHistory(lockingBytecode),
      getTransaction: (transactionId) => server.getTransaction(transactionId),
      listUnspent: async (lockingBytecode) => (await server.listUnspent(lockingBytecode)).map((entry) => ({ ...entry, hasToken: entry.token !== undefined })),
    };
    const numbers = walletTemplateNumbers();
    for (const [phone, words] of Object.entries(kept.words)) {
      const seed = deriveSeedKeys(words, 'testnet', numbers);
      const pass = await quickPass(chain, hexToBin(kept.identity), seed.viewingKey);
      for (const found of pass.found) places.set(binToHex(found.address.lockingBytecode), `${names[phone] ?? phone}${found.address.kind === ADDRESS_KIND.vault ? ' (a vault address)' : ''}`);
    }
  } finally {
    await server.disconnect();
  }
  return places;
};
