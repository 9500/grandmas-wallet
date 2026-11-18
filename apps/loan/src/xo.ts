import type { ActionDetails, DappRequests, RequestStage, XoAdvertisement } from '@grandmas-wallet/connect';
import { type BorrowingThread, type LoanRequest, type PresentedTemplate, borrowRequest, closeRequest, createKeyRequest, manageRequest, movePeriodRequest, repayRequest } from '@grandmas-wallet/paryon';

import { type BorrowPlan, type LoanView, type Market, CONTRACTS, LOAN_TEMPLATE } from './loan.js';
import { type MadeKey, type PageChain, keyWaiting, readLoan, readMadeKey } from './market.js';

/**
 * Loans through a wallet that speaks `xo_v1`. The page builds no transaction and sees no key: it names its
 * template and asks for one of the template's actions, with the values only Paryon's arithmetic gives and the
 * contracts' coins it chose. The wallet fills in its own coins and addresses, reads the rest from the chain,
 * checks every value in the virtual machine with Paryon's contracts, and shows the user its own figures.
 *
 * A request is kept until it has an outcome, under the identifier the page chose. After the page is loaded
 * again it is sent once more with that identifier, and the wallet answers with what became of it.
 */

export type LoanAction = LoanRequest['templateAction'];

/** Seconds within which a server may not yet list the outputs of a key just made. */
export const KEY_LISTED_WITHIN = 600;

/** The template as `packages/paryon`'s request makers take it. Only its names go into a request. */
const PRESENTED: PresentedTemplate = { names: LOAN_TEMPLATE.names, texts: LOAN_TEMPLATE.texts, ...LOAN_TEMPLATE.texts } as PresentedTemplate;

/** A request that has no outcome yet. */
export interface PendingRequest {
  id: string;
  action: LoanAction;
  details: ActionDetails;
  /** Unix seconds. */
  startedAt: number;
}

/** A loan key the page had the wallet make, until a loan is opened with it. */
export interface KeptKey {
  transactionId: string;
  /** Unix seconds. */
  madeAt: number;
}

/** Where something is kept between visits. */
export interface Kept<T> {
  get(): T[];
  set(items: T[]): void;
}

export const memoryKept = <T>(): Kept<T> => {
  let kept: T[] = [];
  return { get: () => kept, set: (items) => void (kept = items) };
};

/** What each step of a request means, in words for the person waiting. */
export const STAGE_WORDS: Record<RequestStage, string> = {
  sent: 'Sent to your wallet',
  accepted: 'Your wallet has the request. Check it there and approve it.',
  approved: 'Approved in your wallet',
  recorded: 'Your wallet has saved this page\'s template in its backup and is signing',
  'on-network': 'Sent to the network',
};

/**
 * Whether a wallet's offer is one this page can work with.
 * @returns a reason in plain words, or `undefined`
 */
export const xoProblem = (offered: XoAdvertisement | undefined, network: string): string | undefined => {
  if (offered === undefined) return 'Your wallet does not carry out actions of a template itself (xo_v1). Paryon\'s contracts take only wallets that do, or an ordinary wallet through Paryon\'s own site; this page works with the first kind only.';
  if (offered.network !== network) return `Your wallet is on ${offered.network}; this page is on ${network}. Switch the wallet to ${network} and connect again.`;
  if (!offered.profiles.includes('recoverable-app-v1')) return 'Your wallet does not read the recovery declarations this page\'s template comes with.';
  if (!offered.bindings.includes('receive') || !offered.bindings.includes('return')) return 'Your wallet does not give the kinds of address this page\'s template asks for.';
  return undefined;
};

/** A request of `packages/paryon` as it travels. */
export const detailsOf = (request: LoanRequest): ActionDetails => ({
  template: request.template,
  templateAction: request.templateAction,
  role: request.role,
  variables: request.variables,
  ...(request.bindings === undefined ? {} : { bindings: request.bindings }),
  ...(request.creates === undefined ? {} : { creates: request.creates }),
  ...(request.spends === undefined ? {} : { spends: request.spends }),
  ...(request.inputs === undefined ? {} : { inputs: request.inputs }),
});

export const createKeyDetails = (): ActionDetails => detailsOf(createKeyRequest(PRESENTED));
export const movePeriodDetails = (thread: BorrowingThread, lockHeight: number): ActionDetails => detailsOf(movePeriodRequest(PRESENTED, CONTRACTS, { borrowing: thread, lockHeight }));
export const borrowDetails = (key: MadeKey, thread: BorrowingThread, market: Pick<Market, 'priceThread'>, plan: Pick<BorrowPlan, 'debt' | 'collateral'>): ActionDetails =>
  detailsOf(borrowRequest(PRESENTED, { borrowing: thread, price: market.priceThread, enforcer: key.enforcer, proof: key.proof, debt: plan.debt, collateral: plan.collateral, startingInterest: 0 }));
export const manageDetails = (category: string, collateral: bigint): ActionDetails => detailsOf(manageRequest(PRESENTED, { keyCategory: category, collateral }));
export const repayDetails = (loan: LoanView, repay: bigint, collateral: bigint): ActionDetails => {
  if (loan.found === undefined) throw new Error('The loan could not be read from the chain.');
  return detailsOf(repayRequest(PRESENTED, { keyCategory: loan.category, loan: loan.found.loan, repay, collateral }));
};
export const closeDetails = (category: string): ActionDetails => detailsOf(closeRequest(PRESENTED, { keyCategory: category }));

const newId = (): string => `loan-${Array.from(crypto.getRandomValues(new Uint8Array(10)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

export interface Outcome {
  transactionId?: string;
}

const outcomeOf = (result: Record<string, unknown>): Outcome => (typeof result['transactionId'] === 'string' ? { transactionId: result['transactionId'] } : {});

export class XoLoans {
  constructor(
    private readonly requests: DappRequests,
    private readonly chain: PageChain,
    private readonly store: Kept<PendingRequest>,
    private readonly keys: Kept<KeptKey>,
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
      const outcome = outcomeOf(await this.requests.request(request.details, LOAN_TEMPLATE.texts, onStage, request.id));
      this.forget(request.id);
      await this.settled(request, outcome);
      return outcome;
    } catch (error) {
      // A refusal is the wallet's last word on the request. Anything else, such as no connection, leaves it open.
      if ((error as Error).name === 'RequestRefusedError') this.forget(request.id);
      throw error;
    }
  }

  /** What the page keeps after an action: a key it made, until a loan is opened with it. */
  private async settled(request: PendingRequest, outcome: Outcome): Promise<void> {
    if (request.action === 'createKey' && outcome.transactionId !== undefined && !this.keys.get().some((key) => key.transactionId === outcome.transactionId)) {
      this.keys.set([...this.keys.get(), { transactionId: outcome.transactionId, madeAt: this.now() }]);
    }
    if (request.action === 'borrow') {
      const used = request.details.inputs?.['enforcerInput']?.split(':')[0];
      this.keys.set(this.keys.get().filter((key) => key.transactionId !== used));
    }
  }

  private start(action: LoanAction, details: ActionDetails, onStage: (stage: RequestStage) => void): Promise<Outcome> {
    const about = details.spends?.[0];
    if (this.store.get().some((kept) => kept.action === action || (about !== undefined && kept.details.spends?.[0] === about))) {
      return Promise.reject(new Error('A request like this one is still waiting for your wallet. Approve or decline it there first.'));
    }
    return this.send({ id: newId(), action, details, startedAt: this.now() }, onStage);
  }

  createKey(onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    return this.start('createKey', createKeyDetails(), onStage);
  }

  movePeriod(thread: BorrowingThread, lockHeight: number, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    return this.start('movePeriod', movePeriodDetails(thread, lockHeight), onStage);
  }

  borrow(key: MadeKey, thread: BorrowingThread, market: Pick<Market, 'priceThread'>, plan: BorrowPlan, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    if (plan.problem !== undefined) return Promise.reject(new Error(plan.problem));
    return this.start('borrow', borrowDetails(key, thread, market, plan), onStage);
  }

  manage(category: string, collateral: bigint, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    return this.start('manage', manageDetails(category, collateral), onStage);
  }

  repay(loan: LoanView, repay: bigint, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    return this.start('repay', repayDetails(loan, repay, loan.found?.loan.output.valueSatoshis ?? 0n), onStage);
  }

  close(category: string, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    return this.start('close', closeDetails(category), onStage);
  }

  /**
   * Send again, with the same identifier, a request kept from before. The wallet carries out a request at most
   * once: it answers with the outcome it stored, or goes on with it.
   */
  resume(request: PendingRequest, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    return this.send(request, onStage);
  }

  /** Stop waiting for a request. The wallet may still carry it out; the lists will show it. */
  abandon(id: string): void {
    this.forget(id);
  }

  /**
   * The loans whose keys the wallet holds, each read from the chain. `trusted: false` means the user has not
   * used this page with this wallet yet: the wallet then reports nothing, whatever it holds.
   */
  async list(): Promise<{ trusted: boolean; loans: LoanView[] }> {
    const { trusted, positions } = await this.requests.positions(LOAN_TEMPLATE.names.identifier);
    const loans = await Promise.all(
      positions.filter((position) => /^[0-9a-f]{64}$/.test(position.category)).map((position) => readLoan(this.chain, position.category, { status: position.status, satoshis: /^\d+$/.test(position.satoshis) ? BigInt(position.satoshis) : 0n })),
    );
    // Open loans first, then the closed ones, each in the order the wallet gave.
    return { trusted, loans: [...loans.filter((loan) => loan.status === 'open'), ...loans.filter((loan) => loan.status !== 'open')] };
  }

  /**
   * Loan keys made from this page that wait for a loan. A key whose outputs were spent is forgotten; one made
   * in the last minutes counts as waiting even where a server does not list its outputs yet.
   */
  async waitingKeys(): Promise<MadeKey[]> {
    const waiting: MadeKey[] = [];
    for (const kept of this.keys.get()) {
      const key = await readMadeKey(this.chain, kept.transactionId).catch(() => undefined);
      if (key === undefined) {
        // Not known to the server yet: kept, and read again later.
        continue;
      }
      if (await keyWaiting(this.chain, key)) waiting.push(key);
      else if (this.now() - kept.madeAt < KEY_LISTED_WITHIN) waiting.push(key);
      else this.keys.set(this.keys.get().filter((other) => other.transactionId !== kept.transactionId));
    }
    return waiting;
  }
}
