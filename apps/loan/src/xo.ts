import type { ActionDetails, DappRequests, RequestStage, XoAdvertisement } from '@grandmas-wallet/connect';
import { RequestRefusedError, XO_EXTENSION_VERSION } from '@grandmas-wallet/connect';
import {
  type LoanRequestAlone,
  borrowRequestAlone,
  changeInterestRequestAlone,
  closeRequestAlone,
  createKeyRequestAlone,
  manageRequestAlone,
  movePeriodRequestAlone,
  repayRequestAlone,
} from '@grandmas-wallet/paryon';

import { type BorrowPlan, type Desk, type LoanView, CHIPNET_DESK, interestRateProblem, repaymentProblem } from './loan.js';
import { type MadeKey, type PageChain, keyWaiting, readLoan, readMadeKey } from './market.js';

/**
 * Loans through a wallet that speaks `xo_v1` (proposal sections 14.2 and 15.3). The page builds no transaction and sees
 * no key: it names its template, version 3, and asks for one of the template's actions with what the borrower decides
 * (`packages/paryon`, `page-requests.ts`): the amounts and the rate typed here, which loan the action is about, by its
 * key, and where the key goes. It names no coin. The template names Paryon's loan service (`xo_service_v1`), which the
 * wallet asks to join each action: the service brings Paryon's coins and every value read from them, and the wallet
 * runs Paryon's contracts on the transaction before the user is asked. The wallet can carry out the same actions from
 * the template alone, with this page closed.
 *
 * The page reads the chain only for what it shows and for its own checks of what the user typed.
 *
 * Every request carries the page's address, which the wallet keeps in the record it writes when the key arrives.
 *
 * A request is kept until it has an outcome, under the identifier the page chose. After the page is loaded
 * again it is sent once more with that identifier, and the wallet answers with what became of it.
 */

export type LoanAction = LoanRequestAlone['templateAction'];

/** Seconds within which a server may not yet list the outputs of a key just made. */
export const KEY_LISTED_WITHIN = 600;

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
  if (offered.version !== XO_EXTENSION_VERSION) return 'Your wallet speaks another version of XO requests than this page. Update the wallet and connect again.';
  if (!offered.bindings.includes('receive') || !offered.bindings.includes('return')) return 'Your wallet does not give the kinds of address this page\'s template asks for.';
  return undefined;
};

/** A request of `packages/paryon` as it travels. */
export const detailsOf = (request: LoanRequestAlone): ActionDetails => ({
  template: request.template,
  templateAction: request.templateAction,
  role: request.role,
  variables: request.variables,
  ...(request.bindings === undefined ? {} : { bindings: request.bindings }),
  ...(request.creates === undefined ? {} : { creates: request.creates }),
  ...(request.about === undefined ? {} : { about: request.about }),
  ...(request.inputs === undefined ? {} : { inputs: request.inputs }),
  ...(request.page === undefined ? {} : { page: request.page }),
});

/** The address the page is served from, which goes into every request; `undefined` where it is not a web address. */
export type PageAddress = string | undefined;
const from = (page: PageAddress): { page?: string } => (page === undefined ? {} : { page });

export const createKeyDetails = (page?: PageAddress, desk: Desk = CHIPNET_DESK): ActionDetails => detailsOf(createKeyRequestAlone(desk.template.names, from(page)));
export const movePeriodDetails = (page?: PageAddress, desk: Desk = CHIPNET_DESK): ActionDetails => detailsOf(movePeriodRequestAlone(desk.template.names, from(page)));
/** A loan opened with no interest: the lowest rate there is, which the user may change later. */
export const borrowDetails = (key: Pick<MadeKey, 'category'>, plan: Pick<BorrowPlan, 'debt' | 'collateral'>, page?: PageAddress, desk: Desk = CHIPNET_DESK): ActionDetails =>
  detailsOf(borrowRequestAlone(desk.template.names, { keyCategory: key.category, debt: plan.debt, collateral: plan.collateral, startingRate: 0, ...from(page) }));
export const manageDetails = (category: string, collateral: bigint, page?: PageAddress, desk: Desk = CHIPNET_DESK): ActionDetails => detailsOf(manageRequestAlone(desk.template.names, { keyCategory: category, collateral, ...from(page) }));
export const repayDetails = (category: string, repay: bigint, page?: PageAddress, desk: Desk = CHIPNET_DESK): ActionDetails => detailsOf(repayRequestAlone(desk.template.names, { keyCategory: category, repay, ...from(page) }));
export const closeDetails = (category: string, page?: PageAddress, desk: Desk = CHIPNET_DESK): ActionDetails => detailsOf(closeRequestAlone(desk.template.names, { keyCategory: category, ...from(page) }));
export const changeInterestDetails = (category: string, rate: number, page?: PageAddress, desk: Desk = CHIPNET_DESK): ActionDetails => detailsOf(changeInterestRequestAlone(desk.template.names, { keyCategory: category, rate, ...from(page) }));

/** The wallet says that another transaction spent one of the coins of the action first (`ActionResult.code`). */
export const spentFirst = (error: unknown): boolean => error instanceof RequestRefusedError && error.code === 'inputs-spent';

/** Another transaction spent one of Paryon's coins first: what the page says instead of the wallet's words. */
export class SpentFirstError extends Error {
  constructor() {
    super('Someone else used one of Paryon\'s coins first. Nothing was sent. Try again in a moment.');
    this.name = 'SpentFirstError';
  }
}

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
    /** The page's own address, for the wallet's record of each loan key. */
    private readonly page?: PageAddress,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
    /** The deployment of Paryon's contracts the page uses. */
    private readonly desk: Desk = CHIPNET_DESK,
  ) {}

  /**
   * Requests made before that have no outcome yet. One made with another template than the page's now, such as an
   * earlier version of it, is forgotten: the wallet may still have carried it out, and the lists show what it did.
   */
  pending(): PendingRequest[] {
    const kept = this.store.get();
    const current = kept.filter((request) => request.details.template.identifier === this.desk.template.names.identifier);
    if (current.length !== kept.length) this.store.set(current);
    return current;
  }

  private forget(id: string): void {
    this.store.set(this.store.get().filter((request) => request.id !== id));
  }

  /** Send a request, or send again one kept from before, and keep it until it has an outcome. */
  private async send(request: PendingRequest, onStage: (stage: RequestStage) => void): Promise<Outcome> {
    if (!this.store.get().some((kept) => kept.id === request.id)) this.store.set([...this.store.get(), request]);
    try {
      const outcome = outcomeOf(await this.requests.request(request.details, this.desk.template.texts, onStage, request.id));
      this.forget(request.id);
      await this.settled(request, outcome);
      return outcome;
    } catch (error) {
      // A refusal is the wallet's last word on the request. Anything else, such as no connection, leaves it open.
      if ((error as Error).name === 'RequestRefusedError') this.forget(request.id);
      if (spentFirst(error)) throw new SpentFirstError();
      throw error;
    }
  }

  /** What the page keeps after an action: a key it made, until a loan is opened with it. */
  private async settled(request: PendingRequest, outcome: Outcome): Promise<void> {
    if (request.action === 'createKey' && outcome.transactionId !== undefined && !this.keys.get().some((key) => key.transactionId === outcome.transactionId)) {
      this.keys.set([...this.keys.get(), { transactionId: outcome.transactionId, madeAt: this.now() }]);
    }
    const used = request.details.about?.category;
    if (request.action === 'borrow' && used !== undefined) {
      // The key borrowed with is forgotten: the page knows each kept key by the transaction that made it, and reads its category from there.
      const kept = await Promise.all(this.keys.get().map(async (key) => ({ key, category: (await readMadeKey(this.chain, key.transactionId).catch(() => undefined))?.category })));
      const usedKeys = new Set(kept.filter(({ category }) => category === used).map(({ key }) => key.transactionId));
      this.keys.set(this.keys.get().filter((key) => !usedKeys.has(key.transactionId)));
    }
  }

  private start(action: LoanAction, details: ActionDetails, onStage: (stage: RequestStage) => void): Promise<Outcome> {
    const about = details.about?.category;
    if (this.store.get().some((kept) => kept.action === action || (about !== undefined && kept.details.about?.category === about))) {
      return Promise.reject(new Error('A request like this one is still waiting for your wallet. Approve or decline it there first.'));
    }
    return this.send({ id: newId(), action, details, startedAt: this.now() }, onStage);
  }

  /** Make a loan key. Paryon's service brings the factory; the wallet asks for the user's tick, since the key waits in Paryon's contract. */
  createKey(onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    return this.start('createKey', createKeyDetails(this.page, this.desk), onStage);
  }

  /** Bring Paryon's contracts up to date: Paryon's service chooses which Borrowing contract and the lock time. */
  movePeriod(onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    return this.start('movePeriod', movePeriodDetails(this.page, this.desk), onStage);
  }

  /** Borrow with a key made from this page, which waits in Paryon's contract, as planned here. */
  borrow(key: Pick<MadeKey, 'category'>, plan: BorrowPlan, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    if (plan.problem !== undefined) return Promise.reject(new Error(plan.problem));
    return this.start('borrow', borrowDetails(key, plan, this.page, this.desk), onStage);
  }

  /** Add collateral or take some out: the loan then holds `collateral` satoshis. */
  manage(category: string, collateral: bigint, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    return this.start('manage', manageDetails(category, collateral, this.page, this.desk), onStage);
  }

  /** Repay part of the loan, in PUSD cents, as far as Paryon takes it (`repaymentProblem`). */
  repay(loan: LoanView, repay: bigint, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    const problem = repaymentProblem(loan, repay);
    if (problem !== undefined) return Promise.reject(new Error(problem));
    return this.start('repay', repayDetails(loan.category, repay, this.page, this.desk), onStage);
  }

  /**
   * Change the loan's interest rate for the periods to come: `rate` per 10,000,000 of the debt's value per period, 0 to
   * 32,767 (`interestRateProblem`), the template's variable `interestRate`.
   */
  changeInterest(category: string, rate: number, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    const problem = interestRateProblem(rate);
    if (problem !== undefined) return Promise.reject(new Error(problem));
    return this.start('changeInterest', changeInterestDetails(category, rate, this.page, this.desk), onStage);
  }

  /** Repay the whole debt and close the loan. */
  close(category: string, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    return this.start('close', closeDetails(category, this.page, this.desk), onStage);
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
   * The loans whose keys the wallet holds, each read from the chain. The wallet says, from its records, which keys
   * it holds under this page's template; whether each loan is open, and what it owes and holds, the page reads
   * itself. `trusted: false` means the user has not used this page with this wallet yet: the wallet then reports
   * nothing, whatever it holds.
   */
  async list(): Promise<{ trusted: boolean; loans: LoanView[] }> {
    const { trusted, positions } = await this.requests.recordedPositions(this.desk.template.names.identifier);
    const keys = positions.filter((position, index) => /^[0-9a-f]{64}$/.test(position.category) && position.capability === 'minting' && positions.findIndex((other) => other.category === position.category) === index);
    const loans = await Promise.all(keys.map((position) => readLoan(this.chain, position.category, /^\d+$/.test(position.satoshis) ? BigInt(position.satoshis) : undefined, this.desk)));
    // Open loans first, then the closed ones, each in the order the wallet gave.
    return { trusted, loans: [...loans.filter((loan) => loan.status === 'open'), ...loans.filter((loan) => loan.status !== 'open')] };
  }

  /**
   * Offer this page's template to the wallet, without an action: for a wallet that holds a loan key it was sent
   * and has never used this page. The user decides in the wallet.
   * @returns whether the wallet trusts the template with this page now
   */
  offerTemplate(): Promise<boolean> {
    return this.requests.offerTemplate(this.desk.template.names, this.desk.template.texts);
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
