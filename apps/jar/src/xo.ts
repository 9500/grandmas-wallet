import { binToHex, hexToBin } from '@bitauth/libauth';
import type { ActionDetails, DappRequests, RecordedPositionReport, RequestStage, XoAdvertisement } from '@grandmas-wallet/connect';
import { speaks } from '@grandmas-wallet/connect';
import { unlockTimeBytes } from '@grandmas-wallet/savings-jar';

import { type JarView, JAR_TEMPLATE, byDate, dateOnKey, jarLockingBytecode } from './jar.js';

/**
 * Savings jars for a wallet that speaks `xo_v1`, version 2 (proposal sections 14.2 and 15.3). The page builds no
 * transaction and sees no key: it names its template and asks for one of the template's actions, and the wallet
 * does the rest. No recovery declaration is sent: the wallet fills in the key's category and its own addresses
 * itself, and takes a jar's values from its own record of the jar.
 *
 * - Opening sends the date, twice (as a number for the script and as it is written on the key), and the amount.
 * - Paying in says which jar, by its key, and that the key is not spent; and the amount.
 * - Emptying says which jar, and that the key is spent. Nothing else: the rest is in the wallet's record.
 * - Every request carries the page's address, which the wallet keeps in the jar's record.
 *
 * The wallet says which keys of this template it holds, from its records; the page reads each jar's balance from
 * the chain itself.
 *
 * A request is kept until it has an outcome, under the identifier the page chose. After the page is loaded
 * again it is sent once more with that identifier, and the wallet answers with what became of it.
 */

/** What the page reads from the chain for a jar: the coins at its address. */
export interface JarChain {
  listUnspent(lockingBytecode: Uint8Array): Promise<{ valueSatoshis: bigint }[]>;
}

export type JarAction = 'open' | 'deposit' | 'withdraw';

/** A request that has no outcome yet. */
export interface PendingRequest {
  id: string;
  action: JarAction;
  details: ActionDetails;
  /** Unix seconds. */
  startedAt: number;
}

/** Where the open requests are kept between visits. */
export interface PendingStore {
  get(): PendingRequest[];
  set(requests: PendingRequest[]): void;
}

export const memoryStore = (): PendingStore => {
  let kept: PendingRequest[] = [];
  return { get: () => kept, set: (requests) => void (kept = requests) };
};

/** What each step of a request means, in words for the person waiting. */
export const STAGE_WORDS: Record<RequestStage, string> = {
  sent: 'Sent to your wallet',
  accepted: 'Your wallet has the request. Check it there and approve it.',
  approved: 'Approved in your wallet',
  recorded: 'Your wallet has saved this application\'s template in its backup and is signing',
  'on-network': 'Sent to the network',
};

/**
 * Whether a wallet's offer is one this page can work with.
 * @returns a reason in plain words, or `undefined`
 */
export const xoProblem = (offered: XoAdvertisement, network: string): string | undefined => {
  if (offered.network !== network) return `Your wallet is on ${offered.network}; this page is on ${network}. Switch the wallet to ${network} and connect again.`;
  if (!speaks(offered, 2)) return 'Your wallet answers only the earlier version of XO requests, whose templates came with a recovery declaration. This page sends its template alone. Update the wallet and connect again.';
  if (!offered.bindings.includes('receive')) return 'Your wallet does not give addresses for what an application sends it.';
  return undefined;
};

/** The address the page is served from, which goes into every request; `undefined` where it is not a web address. */
export type PageAddress = string | undefined;
const from = (page: PageAddress): Pick<ActionDetails, 'page'> => (page === undefined ? {} : { page });

export const openRequest = (satoshis: bigint, unlockTime: number, page?: PageAddress): ActionDetails => ({
  template: JAR_TEMPLATE.names,
  templateAction: 'open',
  role: 'saver',
  variables: { unlockTime, unlockTimeBytes: binToHex(unlockTimeBytes(unlockTime)), savedSatoshis: Number(satoshis) },
  ...from(page),
});

export const depositRequest = (category: string, satoshis: bigint, page?: PageAddress): ActionDetails => ({
  template: JAR_TEMPLATE.names,
  templateAction: 'deposit',
  role: 'saver',
  variables: { savedSatoshis: Number(satoshis) },
  about: { category, spent: false },
  ...from(page),
});

export const withdrawRequest = (category: string, page?: PageAddress): ActionDetails => ({
  template: JAR_TEMPLATE.names,
  templateAction: 'withdraw',
  role: 'saver',
  variables: {},
  about: { category, spent: true },
  ...from(page),
});

/**
 * A position the wallet reported from its records, as a jar, with the jar's balance as the chain shows it.
 * `undefined` for a token whose commitment is not a date, and for a record whose script is not this page's jar:
 * the jar's address is worked out here from the key's category and its date, and must be the record's.
 */
export const jarOfPosition = (position: RecordedPositionReport, satoshis: bigint): JarView | undefined => {
  const unlockTime = dateOnKey(position.commitment);
  if (unlockTime === undefined || !/^[0-9a-f]{64}$/.test(position.category)) return undefined;
  const recorded = position.variables;
  if (position.lockingScript !== 'savingsJarLockingScript' || recorded?.['keyCategory'] !== position.category || recorded['unlockTime'] !== String(unlockTime)) return undefined;
  return {
    category: position.category,
    unlockTime,
    satoshis,
    // The jar's address follows from the key; the page works it out itself.
    lockingBytecode: jarLockingBytecode(position.category, unlockTime),
    status: position.status === 'unconfirmed' ? 'unconfirmed' : satoshis > 0n ? 'open' : 'empty',
  };
};

const newId = (): string => `jar-${Array.from(crypto.getRandomValues(new Uint8Array(10)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

export interface Outcome {
  transactionId?: string;
  /** The key's category, for a jar just opened. */
  category?: string;
}

const outcomeOf = (result: Record<string, unknown>): Outcome => {
  const { transactionId, tokens } = result as { transactionId?: unknown; tokens?: unknown };
  const [first] = Array.isArray(tokens) ? (tokens as { category?: unknown }[]) : [];
  return {
    ...(typeof transactionId === 'string' ? { transactionId } : {}),
    ...(typeof first?.category === 'string' ? { category: first.category } : {}),
  };
};

export class XoJars {
  constructor(
    private readonly requests: DappRequests,
    private readonly store: PendingStore,
    private readonly chain: JarChain,
    /** The page's own address, for the wallet's record of each jar. */
    private readonly page?: PageAddress,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  /** Requests made before that have no outcome yet. */
  pending(): PendingRequest[] {
    return this.store.get();
  }

  private forget(id: string): void {
    this.store.set(this.store.get().filter((request) => request.id !== id));
  }

  /** Send a request, or send again one kept from before, and keep it until it has an outcome. */
  private async send(request: PendingRequest, onStage: (stage: RequestStage) => void): Promise<Outcome> {
    if (!this.store.get().some((kept) => kept.id === request.id)) this.store.set([...this.store.get(), request]);
    try {
      const outcome = outcomeOf(await this.requests.request(request.details, JAR_TEMPLATE.texts, onStage, request.id));
      this.forget(request.id);
      return outcome;
    } catch (error) {
      // A refusal is the wallet's last word on the request. Anything else, such as no connection, leaves it open.
      if ((error as Error).name === 'RequestRefusedError') this.forget(request.id);
      throw error;
    }
  }

  private start(action: JarAction, details: ActionDetails, onStage: (stage: RequestStage) => void): Promise<Outcome> {
    if (this.store.get().some((kept) => kept.action === action && (action === 'open' || kept.details.about?.category === details.about?.category))) {
      return Promise.reject(new Error('A request like this one is still waiting for your wallet. Approve or decline it there first.'));
    }
    return this.send({ id: newId(), action, details, startedAt: this.now() }, onStage);
  }

  open(satoshis: bigint, unlockTime: number, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    return this.start('open', openRequest(satoshis, unlockTime, this.page), onStage);
  }

  deposit(category: string, satoshis: bigint, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    return this.start('deposit', depositRequest(category, satoshis, this.page), onStage);
  }

  withdraw(category: string, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    return this.start('withdraw', withdrawRequest(category, this.page), onStage);
  }

  /**
   * Send again, with the same identifier, a request kept from before. The wallet carries out a request
   * at most once: it answers with the outcome it stored, or goes on with it.
   */
  resume(request: PendingRequest, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    return this.send(request, onStage);
  }

  /** Stop waiting for a request. The wallet may still carry it out; the list of jars will show it. */
  abandon(id: string): void {
    this.forget(id);
  }

  /** Offer this page's template to the wallet, without an action. @returns whether the wallet trusts it with this page now */
  offerTemplate(): Promise<boolean> {
    return this.requests.offerTemplate(JAR_TEMPLATE.names, JAR_TEMPLATE.texts);
  }

  /**
   * The jars whose keys the wallet holds, as its records say, each with its balance read from the chain.
   * `trusted: false` means the user has not used this page with this wallet yet: the wallet then reports
   * nothing, whatever it holds. A key the wallet holds without a record of it is not reported.
   */
  async list(): Promise<{ trusted: boolean; jars: JarView[] }> {
    const { trusted, positions } = await this.requests.recordedPositions(JAR_TEMPLATE.names.identifier);
    const jars: JarView[] = [];
    for (const position of positions) {
      const unlockTime = dateOnKey(position.commitment);
      if (unlockTime === undefined || !/^[0-9a-f]{64}$/.test(position.category)) continue;
      const coins = await this.chain.listUnspent(hexToBin(jarLockingBytecode(position.category, unlockTime)));
      const jar = jarOfPosition(position, coins.reduce((sum, coin) => sum + coin.valueSatoshis, 0n));
      if (jar !== undefined && !jars.some((known) => known.category === jar.category)) jars.push(jar);
    }
    return { trusted, jars: jars.sort(byDate) };
  }
}
