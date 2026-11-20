import { binToHex } from '@bitauth/libauth';
import type { ActionDetails, DappRequests, RequestStage, XoAdvertisement } from '@grandmas-wallet/connect';
import { RequestRefusedError, XO_EXTENSION_VERSION } from '@grandmas-wallet/connect';
import {
  type BorrowingThread,
  type LoanCoins,
  type LoanRequestAlone,
  borrowRequestAlone,
  closeRequestAlone,
  createKeyRequestAlone,
  manageRequestAlone,
  movePeriodRequestAlone,
  repayRequestAlone,
} from '@grandmas-wallet/paryon';
import type { Utxo } from '@grandmas-wallet/core';

import { type BorrowPlan, type Desk, type LoanView, type Market, CHIPNET_DESK } from './loan.js';
import { type MadeKey, type PageChain, keyWaiting, readFactory, readLoan, readLoanCoins, readMadeKey } from './market.js';

/**
 * Loans through a wallet that speaks `xo_v1`, version 2 (proposal sections 14.2 and 15.3). The page builds no
 * transaction and sees no key: it names its template and asks for one of the template's actions. It sends no
 * recovery declaration; what the declaration told the wallet, the page's requests now say (`packages/paryon`,
 * `page-requests.ts`): every coin of Paryon's the action spends, by outpoint, found and read by the page itself
 * (the loan and its sidecar from the key, the shared contracts it chose); the values read from them; which loan
 * the action is about, by its key, and that the key is spent; that the key goes back to the script it left; and
 * what the key's coin holds, as the wallet reported it. The wallet fills in its own coins and addresses, runs
 * Paryon's contracts on the transaction before the user is asked, and shows the user its own figures.
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

export const createKeyDetails = (factory: Utxo, page?: PageAddress, desk: Desk = CHIPNET_DESK): ActionDetails => detailsOf(createKeyRequestAlone(desk.template.names, { factory, ...from(page) }));
export const movePeriodDetails = (thread: BorrowingThread, lockHeight: number, page?: PageAddress, desk: Desk = CHIPNET_DESK): ActionDetails => detailsOf(movePeriodRequestAlone(desk.template.names, desk.contracts, { borrowing: thread, lockHeight, ...from(page) }));
export const borrowDetails = (key: MadeKey, thread: BorrowingThread, market: Pick<Market, 'priceThread'>, plan: Pick<BorrowPlan, 'debt' | 'collateral'>, page?: PageAddress, desk: Desk = CHIPNET_DESK): ActionDetails =>
  detailsOf(borrowRequestAlone(desk.template.names, { borrowing: thread, price: market.priceThread, enforcer: key.enforcer, proof: key.proof, debt: plan.debt, collateral: plan.collateral, startingInterest: 0, ...from(page) }));
export const manageDetails = (coins: LoanCoins, collateral: bigint, page?: PageAddress, desk: Desk = CHIPNET_DESK): ActionDetails => detailsOf(manageRequestAlone(desk.template.names, { ...coins, collateral, ...from(page) }));
export const repayDetails = (coins: LoanCoins, repay: bigint, collateral: bigint, page?: PageAddress, desk: Desk = CHIPNET_DESK): ActionDetails => detailsOf(repayRequestAlone(desk.template.names, { ...coins, repay, collateral, ...from(page) }));
export const closeDetails = (coins: LoanCoins, page?: PageAddress, desk: Desk = CHIPNET_DESK): ActionDetails => detailsOf(closeRequestAlone(desk.template.names, { ...coins, ...from(page) }));

/**
 * How many times in a row an action that names Paryon's shared coins is asked for, when each time another transaction
 * spent one of those coins first. Each try is a new transaction, which the user approves anew in the wallet.
 */
export const TRIES = 3;

/** What the page says while it asks again. */
export const ASKING_AGAIN = 'Someone else used one of Paryon\'s coins first. Asking your wallet again with the current ones.';

/** Each try in a row found one of Paryon's coins spent by someone else first. */
export class SpentFirstError extends Error {
  constructor() {
    super(`Someone else used one of Paryon's coins first, ${TRIES} times in a row. Nothing was sent. Try again in a moment.`);
    this.name = 'SpentFirstError';
  }
}

/** The wallet says that another transaction spent one of the coins the request named first (`ActionResult.code`). */
export const spentFirst = (error: unknown): boolean => error instanceof RequestRefusedError && error.code === 'inputs-spent';

/** The loan, as read for a try after the first, differs from what the first try was about. */
export class LoanChangedError extends Error {
  constructor() {
    super('The loan has changed since you asked: another transaction spent it. Nothing was sent. Look at the loan again before you ask.');
    this.name = 'LoanChangedError';
  }
}

const outpointOf = (utxo: Utxo): string => `${binToHex(utxo.transactionHash)}:${utxo.index}`;

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
      const outcome = outcomeOf(await this.requests.request(request.details, this.desk.template.texts, onStage, request.id));
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
    const about = details.about?.category;
    if (this.store.get().some((kept) => kept.action === action || (about !== undefined && kept.details.about?.category === about))) {
      return Promise.reject(new Error('A request like this one is still waiting for your wallet. Approve or decline it there first.'));
    }
    return this.send({ id: newId(), action, details, startedAt: this.now() }, onStage);
  }

  /** Make a loan key, from a factory of Paryon's the page reads from the chain. The wallet asks for the user's tick: the key waits in Paryon's contract. */
  async createKey(onStage: (stage: RequestStage) => void = () => undefined, onAgain: (words: string) => void = () => undefined): Promise<Outcome> {
    return this.tries('createKey', async () => createKeyDetails(await readFactory(this.chain, this.desk), this.page, this.desk), onStage, onAgain);
  }

  movePeriod(thread: BorrowingThread, lockHeight: number, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    return this.start('movePeriod', movePeriodDetails(thread, lockHeight, this.page, this.desk), onStage);
  }

  borrow(key: MadeKey, thread: BorrowingThread, market: Pick<Market, 'priceThread'>, plan: BorrowPlan, onStage: (stage: RequestStage) => void = () => undefined): Promise<Outcome> {
    if (plan.problem !== undefined) return Promise.reject(new Error(plan.problem));
    return this.start('borrow', borrowDetails(key, thread, market, plan, this.page, this.desk), onStage);
  }

  /**
   * What a request on the loan of a key names, read now: what the key's coin holds, as the wallet reports it, and
   * the loan, its sidecar and Paryon's coins, as the chain shows them.
   */
  private async coinsOf(category: string): Promise<LoanCoins> {
    const { positions } = await this.requests.recordedPositions(this.desk.template.names.identifier);
    const reported = positions.find((position) => position.category === category && position.capability === 'minting');
    if (reported === undefined || !/^\d+$/.test(reported.satoshis)) throw new Error('Your wallet does not report this loan key as one of this page\'s. Connect the wallet that holds it.');
    return readLoanCoins(this.chain, category, BigInt(reported.satoshis), this.desk);
  }

  /**
   * Ask for an action, and ask again at once, up to {@link TRIES} times in a row, while the wallet says that another
   * transaction spent one of the coins the request named first: the request is built anew each time from the coins
   * read now. The wallet shows each try to the user, who approves it anew. Any other outcome ends the tries.
   * @param build - reads the coins and builds the request; `first` for the first try
   * @param onAgain - told, before each try after the first, what the page says while it asks again
   * @throws SpentFirstError when every try found a coin spent first
   */
  private async tries(action: LoanAction, build: (first: boolean) => Promise<ActionDetails>, onStage: (stage: RequestStage) => void, onAgain: (words: string) => void): Promise<Outcome> {
    for (let attempt = 1; ; attempt++) {
      const details = await build(attempt === 1);
      try {
        return await this.start(action, details, onStage);
      } catch (error) {
        if (!spentFirst(error)) throw error;
        if (attempt >= TRIES) throw new SpentFirstError();
        onAgain(ASKING_AGAIN);
      }
    }
  }

  /**
   * The coins of a loan's request, read anew for each try. A try after the first is about the loan the first was
   * about: if the loan is gone, or another transaction has changed it, the page says so and asks nothing.
   */
  private loanTries(category: string): (first: boolean) => Promise<LoanCoins> {
    let loan: string | undefined;
    return async (first) => {
      const coins = await this.coinsOf(category);
      if (first) loan = outpointOf(coins.loan);
      else if (outpointOf(coins.loan) !== loan) throw new LoanChangedError();
      return coins;
    };
  }

  async manage(category: string, collateral: bigint, onStage: (stage: RequestStage) => void = () => undefined, onAgain: (words: string) => void = () => undefined): Promise<Outcome> {
    const read = this.loanTries(category);
    return this.tries('manage', async (first) => manageDetails(await read(first), collateral, this.page, this.desk), onStage, onAgain);
  }

  async repay(loan: LoanView, repay: bigint, onStage: (stage: RequestStage) => void = () => undefined, onAgain: (words: string) => void = () => undefined): Promise<Outcome> {
    const read = this.loanTries(loan.category);
    return this.tries(
      'repay',
      async (first) => {
        const coins = await read(first);
        return repayDetails(coins, repay, coins.loan.output.valueSatoshis, this.page, this.desk);
      },
      onStage,
      onAgain,
    );
  }

  async close(category: string, onStage: (stage: RequestStage) => void = () => undefined, onAgain: (words: string) => void = () => undefined): Promise<Outcome> {
    const read = this.loanTries(category);
    return this.tries('close', async (first) => closeDetails(await read(first), this.page, this.desk), onStage, onAgain);
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
