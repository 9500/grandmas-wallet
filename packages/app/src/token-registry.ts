import { binToHex, decodeTransactionBch, hexToBin, sha256 } from '@bitauth/libauth';
import { type ChainReader, type RegistryToken, cleanName, isReservedSymbol, readPublication, readRegistry, registryUrl, shownSymbol } from '@grandmas-wallet/core';

/**
 * Token names, symbols and decimals from the token's own registry, checked against the chain (proposal section
 * 13.3): the authchain from the category, the publication on its latest link that has one, and the file whose
 * SHA-256 is the published hash. No index is asked and no list of tokens is built in.
 *
 * What comes out of here changes what the screens write and how a typed amount is read. It never enters a
 * transaction, a position record, a finding, the check of a record or an answer to an application, and it is not
 * written to the backup: a new phone resolves again.
 */

/** The configuration's entry: `chain` resolves from the chain; `off`, or no entry, resolves nothing. */
export interface RegistriesConfig {
  mode: 'chain' | 'off';
  /** The gateway `ipfs://` addresses are fetched through, as a prefix of the address. */
  ipfsGateway?: string;
}

/** Fetch a file: its bytes, or `undefined` when it could not be had. The pages hand in the browser's fetch; tests, files in memory. */
export type RegistryFetch = (url: string) => Promise<Uint8Array | undefined>;

/** What the wallet keeps of one category, on the device only. */
export interface KeptRegistry {
  category: string;
  /** The issuer's words, from a file checked against the chain. Absent while unresolved. */
  token?: RegistryToken;
  /** Where the words came from. */
  source?: { authhead: string; publication: string; hash: string; uri: string };
  checkedAt?: number;
  /** Why nothing is shown, when nothing is. */
  unresolved?: string;
  /** The last link of the authchain the walk reached, to go on from. */
  reachedLink?: string;
  /** The publication of the latest link the walk has seen that carries one, while the walk is under way. */
  seen?: { transactionId: string; hash: string; uris: string[] };
}

export interface RegistryState {
  entries: KeptRegistry[];
}

export const REGISTRY_LIMITS = {
  /** Links of an authchain walked in one pass. */
  links: 10,
  /** History entries read at one link. */
  history: 1_000,
  /** The largest registry file taken. */
  bytes: 2_000_000,
  /** How long one file may take. */
  milliseconds: 10_000,
};

/**
 * The browser's fetch, for registry files only: no credentials, no referrer, redirects followed, at most 2 MB and
 * 10 seconds. A failure gives `undefined`.
 */
export const httpRegistryFetch: RegistryFetch = async (url) => {
  try {
    const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow', cache: 'no-store', mode: 'cors', signal: AbortSignal.timeout(REGISTRY_LIMITS.milliseconds) });
    if (!response.ok || response.body === null) return undefined;
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > REGISTRY_LIMITS.bytes) {
        await reader.cancel();
        return undefined;
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const part of parts) {
      bytes.set(part, at);
      at += part.length;
    }
    return bytes;
  } catch {
    return undefined;
  }
};

const equalBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, index) => byte === b[index]);

/** What one pass over a category found. */
type Walk =
  | { kind: 'head'; authhead: string; publication?: KeptRegistry['seen'] }
  | { kind: 'partway'; reachedLink: string; seen?: KeptRegistry['seen']; reason: string }
  | { kind: 'burned' }
  | { kind: 'failed'; reason: string };

export class TokenRegistries {
  /** Categories looked at while this page is open: each is looked at once, and again on "Read again". */
  private readonly looked = new Set<string>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly options: {
      chain: ChainReader;
      fetch: RegistryFetch;
      kept: () => RegistryState | undefined;
      store: (state: RegistryState) => void;
      config?: RegistriesConfig;
      now?: () => number;
    },
  ) {}

  get on(): boolean {
    return this.options.config?.mode === 'chain';
  }

  private get entries(): KeptRegistry[] {
    return this.options.kept()?.entries ?? [];
  }

  /** What is kept of a category. */
  kept(category: string): KeptRegistry | undefined {
    return this.entries.find((entry) => entry.category === category);
  }

  private put(entry: KeptRegistry): void {
    this.options.store({ entries: [...this.entries.filter((known) => known.category !== entry.category), entry] });
    for (const listener of [...this.listeners]) listener();
  }

  /** Be told when a result is kept. */
  watch(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** The issuer's words for a category, as kept; nothing is asked of the network. */
  known(category: string): RegistryToken | undefined {
    return this.on ? this.kept(category)?.token : undefined;
  }

  /**
   * Look at each category not looked at yet while the page is open (all of them with `again`): a kept result is
   * checked with one request, whether its authhead is still the head; anything else is walked and fetched.
   * Categories are looked at one after another. Nothing is done when the configuration does not say `chain`.
   */
  async refresh(categories: string[], again = false): Promise<void> {
    if (!this.on) return;
    for (const category of new Set(categories.map((value) => value.toLowerCase()))) {
      if (!/^[0-9a-f]{64}$/.test(category)) continue;
      if (!again && this.looked.has(category)) continue;
      this.looked.add(category);
      const running = this.running.get(category) ?? this.look(category).finally(() => this.running.delete(category));
      this.running.set(category, running);
      await running.catch(() => undefined);
    }
  }

  private async look(category: string): Promise<void> {
    const before = this.kept(category);
    const now = this.options.now?.() ?? Date.now();
    const start = before?.reachedLink ?? before?.source?.authhead ?? category;
    const seen = before?.seen ?? (before?.source === undefined ? undefined : { transactionId: before.source.publication, hash: before.source.hash, uris: [before.source.uri] });
    let walk: Walk;
    try {
      walk = await this.walk(start, seen);
    } catch (error) {
      walk = { kind: 'failed', reason: `The network could not be read: ${(error as Error).message}` };
    }
    const keepShown = before?.token === undefined ? {} : { token: before.token, ...(before.source === undefined ? {} : { source: before.source }), ...(before.checkedAt === undefined ? {} : { checkedAt: before.checkedAt }) };
    if (walk.kind === 'burned') return this.put({ category, unresolved: 'The identity was burned.' });
    if (walk.kind === 'failed') return this.put({ ...keepShown, category, unresolved: walk.reason, ...(before?.reachedLink === undefined ? {} : { reachedLink: before.reachedLink }), ...(before?.seen === undefined ? {} : { seen: before.seen }) });
    if (walk.kind === 'partway') return this.put({ ...keepShown, category, unresolved: walk.reason, reachedLink: walk.reachedLink, ...(walk.seen === undefined ? {} : { seen: walk.seen }) });
    const publication = walk.publication;
    if (publication === undefined) return this.put({ category, unresolved: 'The token\'s authchain publishes no registry.', reachedLink: walk.authhead });
    // The hash fixes the content: a file already read for this hash is not fetched again.
    if (before?.token !== undefined && before.source?.hash === publication.hash) {
      return this.put({ category, token: before.token, source: { ...before.source, authhead: walk.authhead, publication: publication.transactionId }, checkedAt: now, reachedLink: walk.authhead });
    }
    const fetched = await this.fetchFile(publication);
    if (typeof fetched === 'string') return this.put({ category, unresolved: fetched, reachedLink: walk.authhead, seen: publication });
    const reading = readRegistry(fetched.text, category, now);
    if (!reading.ok) return this.put({ category, unresolved: reading.reason, reachedLink: walk.authhead, seen: publication });
    this.put({ category, token: reading.token, source: { authhead: walk.authhead, publication: publication.transactionId, hash: publication.hash, uri: fetched.uri }, checkedAt: now, reachedLink: walk.authhead });
  }

  /** Fetch the file from the publication's addresses in order, until one gives bytes with the published hash. */
  private async fetchFile(publication: NonNullable<KeptRegistry['seen']>): Promise<{ text: string; uri: string } | string> {
    const hash = hexToBin(publication.hash);
    let reason = 'The registry\'s publication names no address this wallet can fetch.';
    for (const uri of publication.uris) {
      const url = registryUrl(uri, this.options.config?.ipfsGateway);
      if (url === undefined) continue;
      const bytes = await this.options.fetch(url).catch(() => undefined);
      if (bytes === undefined) {
        reason = 'The registry file could not be fetched.';
        continue;
      }
      if (bytes.length > REGISTRY_LIMITS.bytes) {
        reason = 'The registry file is too large.';
        continue;
      }
      if (!equalBytes(sha256.hash(bytes), hash)) {
        reason = 'The registry file is not the one the chain publishes: its hash differs.';
        continue;
      }
      return { text: new TextDecoder('utf-8', { fatal: false }).decode(bytes), uri };
    }
    return reason;
  }

  /**
   * Follow the authchain from a link, through output 0, for at most `REGISTRY_LIMITS.links` links. The head is the
   * link whose output 0 is unspent.
   */
  private async walk(start: string, seen: KeptRegistry['seen']): Promise<Walk> {
    const { chain } = this.options;
    let link = start;
    let publication = seen;
    for (let step = 0; step < REGISTRY_LIMITS.links; step += 1) {
      const raw = await chain.getTransaction(link);
      if (raw === undefined) return { kind: 'failed', reason: 'A transaction of the token\'s authchain could not be read.' };
      const transaction = decodeTransactionBch(hexToBin(raw));
      if (typeof transaction === 'string') return { kind: 'failed', reason: 'A transaction of the token\'s authchain could not be read.' };
      const found = readPublication(transaction.outputs);
      if (found !== undefined) publication = { transactionId: link, hash: binToHex(found.hash), uris: found.uris };
      const identity = transaction.outputs[0];
      if (identity === undefined) return { kind: 'failed', reason: 'An authchain transaction has no output 0.' };
      if (identity.lockingBytecode[0] === 0x6a) return { kind: 'burned' };
      const unspent = await chain.listUnspent(identity.lockingBytecode);
      if (unspent.some((entry) => entry.transactionId === link && entry.index === 0)) return { kind: 'head', authhead: link, ...(publication === undefined ? {} : { publication }) };
      const history = await chain.getHistory(identity.lockingBytecode);
      if (history.length > REGISTRY_LIMITS.history) return { kind: 'partway', reachedLink: link, ...(publication === undefined ? {} : { seen: publication }), reason: 'The token\'s authchain passes an address with too many transactions to follow.' };
      const linkHeight = history.find((entry) => entry.transactionId === link)?.height ?? 0;
      const order = (height: number): number => (height <= 0 ? Number.MAX_SAFE_INTEGER : height);
      const candidates = history
        .filter((entry) => entry.transactionId !== link && (linkHeight <= 0 ? entry.height <= 0 : order(entry.height) >= linkHeight))
        .sort((a, b) => order(a.height) - order(b.height));
      let spender: string | undefined;
      for (const candidate of candidates) {
        const text = await chain.getTransaction(candidate.transactionId);
        const decoded = text === undefined ? undefined : decodeTransactionBch(hexToBin(text));
        if (decoded === undefined || typeof decoded === 'string') continue;
        if (decoded.inputs.some((input) => input.outpointIndex === 0 && binToHex(input.outpointTransactionHash) === link)) {
          spender = candidate.transactionId;
          break;
        }
      }
      if (spender === undefined) return { kind: 'partway', reachedLink: link, ...(publication === undefined ? {} : { seen: publication }), reason: 'The transaction that continues the token\'s authchain could not be found.' };
      link = spender;
    }
    return { kind: 'partway', reachedLink: link, ...(publication === undefined ? {} : { seen: publication }), reason: 'The token\'s authchain is longer than one look follows; the next look goes on from here.' };
  }
}

/** A token's registry words as the screens use them. */
export interface ShownRegistry {
  /** The name's first line, whole. */
  name: string;
  /** The symbol as shown: the part before the first hyphen. */
  symbol: string;
  decimals: number;
  /** The registry's name for this NFT's type, by its commitment. */
  nftType?: string;
  /** Another held category is shown with the same symbol: the screens write the short category beside it. */
  sameSymbol?: boolean;
}

/** What the screens show of a kept registry: nothing for a reserved symbol. */
export const shownRegistry = (token: RegistryToken | undefined, commitment?: string): ShownRegistry | undefined => {
  if (token === undefined || isReservedSymbol(token.symbol)) return undefined;
  const nftType = commitment === undefined || commitment === '' ? undefined : token.nftTypes?.[commitment];
  return { name: cleanName(token.name, Infinity), symbol: shownSymbol(token.symbol), decimals: token.decimals, ...(nftType === undefined ? {} : { nftType }) };
};
