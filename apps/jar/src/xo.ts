import { binToHex } from '@bitauth/libauth';
import type { ActionDetails, DappRequests, ReportedPosition, RequestStage, XoAdvertisement } from '@grandmas-wallet/connect';
import { unlockTimeBytes } from '@grandmas-wallet/savings-jar';

import { type JarView, JAR_TEMPLATE, byDate, dateOnKey, jarLockingBytecode } from './jar.js';

/**
 * Savings jars for a wallet that speaks `xo_v1`. The page builds no transaction and sees no key: it names
 * its template and asks for one of the template's actions, and the wallet does the rest. The wallet fills
 * in the key's category and its own addresses itself.
 *
 * A request is kept until it has an outcome, under the identifier the page chose. After the page is loaded
 * again it is sent once more with that identifier, and the wallet answers with what became of it.
 */

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
  if (!offered.profiles.includes('recoverable-app-v1')) return 'Your wallet does not read the recovery declarations this page\'s template comes with.';
  if (!offered.bindings.includes('receive')) return 'Your wallet does not give addresses for what an application sends it.';
  return undefined;
};

export const openRequest = (satoshis: bigint, unlockTime: number): ActionDetails => ({
  template: JAR_TEMPLATE.names,
  templateAction: 'open',
  role: 'saver',
  variables: { unlockTime, unlockTimeBytes: binToHex(unlockTimeBytes(unlockTime)), savedSatoshis: Number(satoshis) },
});

export const depositRequest = (category: string, satoshis: bigint): ActionDetails => ({
  template: JAR_TEMPLATE.names,
  templateAction: 'deposit',
  role: 'saver',
  variables: { savedSatoshis: Number(satoshis) },
  spends: [category],
});

export const withdrawRequest = (category: string): ActionDetails => ({
  template: JAR_TEMPLATE.names,
  templateAction: 'withdraw',
  role: 'saver',
  variables: {},
  spends: [category],
});

/** A position the wallet reported, as a jar. `undefined` for a token whose commitment is not a date. */
export const jarOfPosition = (position: ReportedPosition): JarView | undefined => {
  const unlockTime = dateOnKey(position.commitment);
  if (unlockTime === undefined || !/^[0-9a-f]{64}$/.test(position.category)) return undefined;
  const satoshis = /^\d+$/.test(position.satoshis) ? BigInt(position.satoshis) : 0n;
  return {
    category: position.category,
    unlockTime,
    satoshis,
    // The jar's address follows from the key; the page works it out itself.
    lockingBytecode: jarLockingBytecode(position.category, unlockTime),
    status: position.status === 'open' ? (satoshis > 0n ? 'open' : 'empty') : position.status === 'closed' ? 'empty' : 'unknown',
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
    if (this.store.get().some((kept) => kept.action === action && (action === 'open' || kept.details.spends?.[0] === details.spends?.[0]))) {
      return Promise.reject(new Error('A request like this one is still waiting for your wallet. Approve or decline it there first.'));
    }
    return this.send({ id: newId(), action, details, startedAt: this.now() }, onStage);
  }

  open(satoshis: bigint, unlockTime: number, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    return this.start('open', openRequest(satoshis, unlockTime), onStage);
  }

  deposit(category: string, satoshis: bigint, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    return this.start('deposit', depositRequest(category, satoshis), onStage);
  }

  withdraw(category: string, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    return this.start('withdraw', withdrawRequest(category), onStage);
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

  /**
   * The jars whose keys the wallet holds. `trusted: false` means the user has not used this page with this
   * wallet yet: the wallet then reports nothing, whatever it holds.
   */
  /** Offer this page's template to the wallet, without an action. @returns whether the wallet trusts it with this page now */
  offerTemplate(): Promise<boolean> {
    return this.requests.offerTemplate(JAR_TEMPLATE.names, JAR_TEMPLATE.texts);
  }

  async list(): Promise<{ trusted: boolean; jars: JarView[] }> {
    const { trusted, positions } = await this.requests.positions(JAR_TEMPLATE.names.identifier);
    return { trusted, jars: positions.flatMap((position) => jarOfPosition(position) ?? []).sort(byDate) };
  }
}
