import { binToHex, hexToBin } from '@bitauth/libauth';
import { type ReadTemplate, type TemplateValues, type Utxo, readTemplate, templateLockingBytecode, templateSequenceNumber, templateUnlockingBytecode, typedValues } from '@grandmas-wallet/core';

import { MINIMUM_DEBT, contractCollateralProblem, formatPusd, interestRateProblem, repaymentAllowed } from './amounts.js';
import { type ParyonContracts, finalLockHeight, periodAt } from './deployment.js';
import {
  type LiveOutput,
  type ParyonChain,
  type PriceThread,
  TransactionReader,
  borrowingFor,
  findLoan,
  findWaitingKey,
  interestCoins,
  keyWaiting,
  loanCoins,
  readCoin,
  readMadeKey,
  readParyonState,
} from './live.js';
import { type ActionParts, borrowParts, changeInterestParts, closeParts, createKeyParts, manageParts, movePeriodParts, repayParts } from './page-requests.js';
import { NO_INTEREST_MANAGER, encodeInterestManagerConfiguration } from './state.js';
import { type ParyonAction, PARYON_SERVICE_SPLIT, SERVICE_RESOURCE } from './template-source.js';

/**
 * Paryon's service, as library code: what it supplies to each action of version 3 of the template, and which actions a
 * wallet's holdings make possible. No server and no engine: functions over chain readings, which the service wraps,
 * and which tests run against the recorded deployments.
 *
 * The service trusts nothing the wallet says beyond what the wallet may decide: the key's category (a token of the
 * wallet's), the amounts and the rate the user chooses. Everything else it reads from the chain itself, the wallet's key
 * coin included, and it checks what Paryon's contracts would check before it answers, so that a refusal comes with a
 * plain reason rather than as a failed transaction. Its values come from the same code as the loan page's requests
 * (`page-requests.ts`): the service supplies its share of them (`PARYON_SERVICE_SPLIT`).
 */

/** The service for one deployment and one template text of version 3. */
export interface ParyonService {
  contracts: ParyonContracts;
  template: ReadTemplate;
  /** The network the deployment is on, which says how a lock time is counted (`finalLockHeight`). */
  network: string;
}

/**
 * The service for a deployment, answering for a template text of version 3.
 * @throws when the text is not version 3 of the template with a service role
 */
export const paryonService = (contracts: ParyonContracts, templateText: string, network: string = contracts.deployment.network): ParyonService => {
  const template = readTemplate(templateText);
  const definition = template.definition as { version?: string; roles?: Record<string, unknown> };
  if (definition.version !== '3' || definition.roles?.['service'] === undefined) throw new Error('Paryon\'s service answers for version 3 of the loan template only.');
  return { contracts, template, network };
};

/** What the service reads from: a server, and the height of the chain's last block. */
export interface ParyonServiceChain extends ParyonChain {
  tip(): Promise<{ height: number }>;
}

/** What the wallet committed before the service joins: the borrower's variables, and its coins by outpoint. */
export interface BorrowerCommitted {
  variables: Record<string, string | number | bigint>;
  /** `<transaction id>:<output index>` of each coin the wallet committed; the loan key's coin among them for an action on a loan. */
  inputs?: string[];
}

/** A coin of Paryon's the service adds, with its unlocking compiled from the template. */
export interface ServiceInput {
  outpoint: string;
  inputIdentifier: string;
  /** The template's locking script the coin is at. */
  lockingScript: string;
  unlockingBytecode: Uint8Array;
  sequenceNumber: number;
  coin: Utxo;
}

/** The service's share of an action. Values as text: whole numbers in decimal, bytes in hex. */
export interface ServiceShare {
  ok: true;
  action: ParyonAction;
  variables: Record<string, string>;
  inputs: ServiceInput[];
  /** The template outputs the service adds: every output of the action that does not go to one of the borrower's scripts. */
  outputs: string[];
  /** The wallet's key coin as the chain shows it, for an action on a loan. */
  keyCoin?: Utxo;
}

/**
 * Why the service does not take part. `inputs-spent`: a coin the action would spend is spent already. `not-possible`:
 * anything else the contracts or the loan's state do not allow.
 */
export interface ServiceRefusal {
  ok: false;
  code: 'not-possible' | 'inputs-spent';
  reason: string;
}

class Refused extends Error {
  constructor(
    readonly code: ServiceRefusal['code'],
    reason: string,
  ) {
    super(reason);
  }
}
const refuse = (reason: string, code: ServiceRefusal['code'] = 'not-possible'): never => {
  throw new Refused(code, reason);
};

const NO_MANAGER = binToHex(encodeInterestManagerConfiguration(NO_INTEREST_MANAGER));
const outpointOf = (utxo: Utxo): string => `${binToHex(utxo.transactionHash)}:${utxo.index}`;
/** One of a function's coins, by its place among them in the order of their outpoints. */
const picked = <T extends Utxo>(coins: T[], pick: (count: number) => number): T | undefined => {
  const sorted = coins.slice().sort((a, b) => (outpointOf(a) < outpointOf(b) ? -1 : 1));
  return sorted[Math.min(Math.max(pick(sorted.length), 0), sorted.length - 1)];
};
const highestPrice = (threads: PriceThread[]): PriceThread | undefined =>
  threads.slice().sort((a, b) => (b.state.price > a.state.price ? 1 : b.state.price < a.state.price ? -1 : outpointOf(a) < outpointOf(b) ? -1 : 1))[0];
const random = (count: number): number => Math.floor(Math.random() * count);

/** Which of the template's locking scripts each script is, by its bytecode. */
const scriptsByBytecode = new WeakMap<object, Map<string, string>>();
const lockingScriptAt = (template: ReadTemplate['definition'], lockingBytecode: Uint8Array): string | undefined => {
  let known = scriptsByBytecode.get(template);
  if (known === undefined) {
    known = new Map();
    for (const identifier of Object.keys(template.lockingScripts ?? {})) {
      try {
        known.set(binToHex(templateLockingBytecode(template, identifier, {})), identifier);
      } catch {
        // A script that needs values is none of Paryon's.
      }
    }
    scriptsByBytecode.set(template, known);
  }
  return known.get(binToHex(lockingBytecode));
};

/**
 * The template outputs of an action that a role adds: the borrower adds the outputs that go to its own scripts (a
 * locking script given by one of its variables); the service adds all the others.
 */
export const outputsOfRole = (template: ReadTemplate['definition'], action: ParyonAction, role: 'borrower' | 'service'): string[] => {
  const transaction = template.transactions?.[template.actions?.[action]?.transaction ?? ''] as { outputs?: { output: string }[] } | undefined;
  const borrowerScripts = new Set(PARYON_SERVICE_SPLIT[action].borrower.map((name) => `$(<${name}>)`));
  return (transaction?.outputs ?? []).map(({ output }) => output).filter((output) => borrowerScripts.has(String((template.outputs?.[output] as { lockingScript?: string } | undefined)?.lockingScript)) === (role === 'borrower'));
};

// ------------------------------------------------------------------------------------------ the wallet's values

const valueOf = (committed: BorrowerCommitted, name: string): string => {
  const value = committed.variables[name];
  if (value === undefined) return refuse(`The wallet's commit gives no "${name}".`);
  return String(value);
};
const wholeNumber = (committed: BorrowerCommitted, name: string, what: string): bigint => {
  const text = valueOf(committed, name);
  return /^\d{1,20}$/.test(text) ? BigInt(text) : refuse(`The ${what} the wallet gives is not a whole number.`);
};
const categoryOf = (committed: BorrowerCommitted): string => {
  const text = valueOf(committed, 'keyCategory').toLowerCase();
  return /^[0-9a-f]{64}$/.test(text) ? text : refuse('The loan key\'s category the wallet gives is not a token category.');
};
const rateOf = (committed: BorrowerCommitted, name: string): number => {
  const text = valueOf(committed, name);
  const rate = /^-?\d{1,10}$/.test(text) ? Number(text) : Number.NaN;
  const problem = interestRateProblem(rate);
  return problem === undefined ? rate : refuse(problem);
};

/**
 * The wallet's coin with the loan key, among the coins it committed, read from the chain: an unspent minting NFT of the
 * key's category without commitment.
 */
const keyCoinOf = async (chain: ParyonChain, committed: BorrowerCommitted, category: string, reader: TransactionReader): Promise<LiveOutput> => {
  for (const outpoint of committed.inputs ?? []) {
    const read = await readCoin(chain, outpoint, reader);
    const token = read?.coin.output.token;
    if (read === undefined || token === undefined || binToHex(token.category) !== category || token.nft?.capability !== 'minting' || token.nft.commitment.length !== 0) continue;
    if (!read.unspent) return refuse('The coin with the loan key that the wallet gives is spent already.', 'inputs-spent');
    return read.coin;
  }
  return refuse('The wallet\'s commit holds no coin with the loan key of this category.');
};

const noOpenLoan = 'This key has no open loan: it was closed, or it never opened one.';
/** Managing and repaying write the template's constant "no manager" into the loan's record: only a loan without one keeps its record as it was. */
const withoutManager = (record: Uint8Array): void => {
  if (binToHex(record.slice(22, 27)) !== NO_MANAGER) refuse('This loan names an interest manager. This service changes only loans without one, so that the manager stays as it is.');
};
const shared = async <T>(read: () => Promise<T>): Promise<T> => {
  try {
    return await read();
  } catch (error) {
    if (error instanceof Refused) throw error;
    const message = (error as Error).message;
    // Paryon's shared contracts missing from the chain just now; a server that cannot be reached is thrown on.
    if (/could not be found on the chain/.test(message)) return refuse(message);
    throw error;
  }
};
const parts = (make: () => ActionParts): ActionParts => {
  try {
    return make();
  } catch (error) {
    return refuse((error as Error).message);
  }
};

// ------------------------------------------------------------------------------------------ the service's share

/**
 * The service's share of an action of version 3: its variables, Paryon's coins it adds (with their unlocking, from the
 * template), and the template outputs it adds; or a refusal with a plain reason. Everything is read again from the
 * chain. Shared coins that many users spend (the factory, the manage and interest functions) are picked at random among
 * those listed unless `pick` says otherwise, so that two users seldom spend the same one at once.
 * @throws when the server cannot be read
 */
export const serviceShare = async (
  service: ParyonService,
  action: ParyonAction,
  committed: BorrowerCommitted,
  chain: ParyonServiceChain,
  options: { pick?: (count: number) => number } = {},
): Promise<ServiceShare | ServiceRefusal> => {
  try {
    return await share(service, action, committed, chain, options.pick ?? random);
  } catch (error) {
    if (error instanceof Refused) return { ok: false, code: error.code, reason: error.message };
    throw error;
  }
};

const share = async (service: ParyonService, action: ParyonAction, committed: BorrowerCommitted, chain: ParyonServiceChain, pick: (count: number) => number): Promise<ServiceShare> => {
  const { contracts } = service;
  const split = PARYON_SERVICE_SPLIT[action];
  if (split === undefined) return refuse(`"${String(action)}" is not an action of the loan template.`);
  const reader = new TransactionReader(chain);
  const coins = new Map<string, Utxo>();
  const using = <T extends Utxo>(...utxos: T[]): void => utxos.forEach((utxo) => coins.set(outpointOf(utxo), utxo));
  let made: ActionParts;
  let keyCoin: LiveOutput | undefined;
  switch (action) {
    case 'createKey': {
      categoryOf(committed);
      const factory = picked((await readParyonState(chain, contracts, reader)).loanKeyFactory, pick);
      if (factory === undefined) return refuse('Paryon\'s key factory could not be found on the chain just now.');
      using(factory);
      made = createKeyParts(factory);
      break;
    }
    case 'movePeriod': {
      const lockHeight = finalLockHeight(service.network, (await chain.tip()).height);
      const period = periodAt(contracts.deployment, lockHeight);
      // The one moved on is the one behind that can still lend the most.
      const [thread] = (await readParyonState(chain, contracts, reader)).borrowing
        .filter((candidate) => candidate.period < period)
        .sort((a, b) => (b.supply > a.supply ? 1 : b.supply < a.supply ? -1 : outpointOf(a) < outpointOf(b) ? -1 : 1));
      if (thread === undefined) return refuse('Paryon\'s borrowing contracts are in the current period already: there is nothing to bring up to date.');
      using(thread);
      made = parts(() => movePeriodParts(contracts, thread, lockHeight));
      break;
    }
    case 'borrow': {
      const category = categoryOf(committed);
      const debt = wholeNumber(committed, 'debt', 'debt');
      const collateral = wholeNumber(committed, 'collateral', 'collateral');
      const rate = rateOf(committed, 'startingRate');
      if (debt < MINIMUM_DEBT) return refuse(`Paryon lends at least ${formatPusd(MINIMUM_DEBT)} PUSD.`);
      const waiting = await findWaitingKey(chain, contracts, hexToBin(category), reader);
      if (waiting === undefined) {
        const opened = await findLoan(chain, contracts, hexToBin(category), reader);
        return refuse(opened === undefined ? 'No loan key of this category waits in Paryon\'s contract.' : 'This key has opened its loan already.');
      }
      const state = await readParyonState(chain, contracts, reader);
      const price = highestPrice(state.price);
      if (price === undefined) return refuse('Paryon\'s price contract could not be found on the chain just now.');
      const thread = borrowingFor(state.borrowing, debt);
      if (thread === undefined) return refuse('None of Paryon\'s borrowing contracts can lend this much now.');
      // A loan starts in the period of the contract it is opened from; anyone may charge it a fee for each period it
      // missed. A contract more than one period behind is brought up to date first, as the loan page does.
      const behind = periodAt(contracts.deployment, finalLockHeight(service.network, (await chain.tip()).height)) - thread.period;
      if (behind > 1) return refuse(`Paryon's borrowing contracts are ${behind} periods behind. Bring Paryon up to date first, so that the loan is not charged for the periods it missed.`);
      const problem = contractCollateralProblem(debt, collateral, price.state.price);
      if (problem !== undefined) return refuse(problem);
      using(thread, price, waiting.enforcer, waiting.proof);
      made = parts(() => borrowParts({ borrowing: thread, price, enforcer: waiting.enforcer, proof: waiting.proof, debt, collateral, startingInterest: rate, interestManager: NO_INTEREST_MANAGER }));
      break;
    }
    case 'manage':
    case 'repay':
    case 'close': {
      const category = categoryOf(committed);
      keyCoin = await keyCoinOf(chain, committed, category, reader);
      const key = keyCoin;
      const found = await shared(() => loanCoins(chain, contracts, hexToBin(category), key.output.valueSatoshis, reader, pick));
      if (found === undefined) return refuse(noOpenLoan);
      const loan = { keyCategory: category, keySatoshis: found.keySatoshis, loan: found.loan, sidecar: found.sidecar, price: found.price, manageFunction: found.manageFunction };
      const { borrowed, beingRedeemed } = found.state;
      const now = found.loan.output.valueSatoshis;
      const price = found.price.state.price;
      using(found.price, found.loan, found.sidecar, found.manageFunction);
      if (action === 'manage') {
        withoutManager(found.loan.output.token?.nft?.commitment ?? new Uint8Array());
        const collateral = wholeNumber(committed, 'collateral', 'collateral');
        if (collateral < now) {
          if (beingRedeemed > 0n) return refuse('Part of this loan is being redeemed: no collateral can be taken out until that ends.');
          const problem = contractCollateralProblem(borrowed, collateral, price);
          if (problem !== undefined) return refuse(problem);
        }
        made = parts(() => manageParts(loan, collateral));
      } else if (action === 'repay') {
        withoutManager(found.loan.output.token?.nft?.commitment ?? new Uint8Array());
        const repay = wholeNumber(committed, 'repayAmount', 'repayment');
        if (repay === 0n || repay === borrowed || !repaymentAllowed(repay, borrowed, beingRedeemed) || borrowed - repay < MINIMUM_DEBT) {
          return refuse(`Paryon takes a part repayment of at least ${formatPusd(MINIMUM_DEBT)} PUSD that leaves at least ${formatPusd(MINIMUM_DEBT)} owing; this loan owes ${formatPusd(borrowed)}${beingRedeemed > 0n ? `, of which ${formatPusd(beingRedeemed)} is being redeemed` : ''}. To repay all of it, close the loan.`);
        }
        const problem = contractCollateralProblem(borrowed - repay, now, price);
        if (problem !== undefined) return refuse(`${problem} Add collateral first.`);
        made = parts(() => repayParts(loan, repay, now));
      } else {
        if (beingRedeemed > 0n) return refuse(`${formatPusd(beingRedeemed)} PUSD of this loan is being redeemed: it cannot be closed until that ends.`);
        made = parts(() => closeParts(loan));
      }
      break;
    }
    case 'changeInterest': {
      const category = categoryOf(committed);
      const rate = rateOf(committed, 'interestRate');
      keyCoin = await keyCoinOf(chain, committed, category, reader);
      const found = await shared(() => interestCoins(chain, contracts, hexToBin(category), (keyCoin as LiveOutput).output.valueSatoshis, reader, pick));
      if (found === undefined) return refuse(noOpenLoan);
      using(found.loan, found.sidecar, found.interestFunction);
      made = parts(() => changeInterestParts({ keyCategory: category, keySatoshis: found.keySatoshis, loan: found.loan, sidecar: found.sidecar, interestFunction: found.interestFunction }, rate));
      break;
    }
    default:
      return refuse(`"${String(action)}" is not an action of the loan template.`);
  }
  const variables = Object.fromEntries(split.service.map((name) => [name, String(made.variables[name])]));
  if (split.service.some((name) => made.variables[name] === undefined)) throw new Error(`The service's values for ${action} are incomplete.`);
  // The borrower's values the service read, and its own: what the template's unlocking scripts are compiled with.
  const borrowerValues = Object.fromEntries(split.borrower.flatMap((name) => (committed.variables[name] === undefined ? [] : [[name, committed.variables[name]]]))) as TemplateValues;
  const definition = service.template.definition;
  const values = typedValues(definition, { ...borrowerValues, ...variables });
  const inputs = Object.entries(made.inputs).map(([inputIdentifier, outpoint]): ServiceInput => {
    const coin = coins.get(outpoint);
    if (coin === undefined) throw new Error(`The service names a coin it did not read: ${outpoint}.`);
    const lockingScript = lockingScriptAt(definition, coin.output.lockingBytecode);
    if (lockingScript === undefined) throw new Error(`The coin ${outpoint} is at none of the template's scripts.`);
    return {
      outpoint,
      inputIdentifier,
      lockingScript,
      unlockingBytecode: templateUnlockingBytecode(definition, lockingScript, inputIdentifier, values),
      sequenceNumber: templateSequenceNumber(definition, inputIdentifier, values) ?? 0,
      coin,
    };
  });
  return { ok: true, action, variables, inputs, outputs: outputsOfRole(definition, action, 'service'), ...(keyCoin === undefined ? {} : { keyCoin }) };
};

// ------------------------------------------------------------------------------------------ the borrower's share

/** What the user chooses for an action, and where the wallet's tokens go. */
export interface BorrowerChoices {
  /** The loan key's category, explorer order, hex: made from the wallet's coin, or the key the wallet holds. */
  keyCategory?: string;
  /** PUSD cents to borrow. */
  debt?: bigint;
  /** Satoshis the loan is to hold. */
  collateral?: bigint;
  /** The starting rate when borrowing; the new rate when changing it. Per 10,000,000 per period, 0 to 32,767. */
  rate?: number;
  /** PUSD cents to repay. */
  repay?: bigint;
  /** Where the key goes, and the borrowed PUSD: locking bytecode, hex. */
  keyHolder?: string;
  tokensHolder?: string;
}

/**
 * The borrower's variables for an action of version 3, from the user's choices: what a wallet would commit. For tests
 * and scripted runs; a wallet works its share out from the template itself.
 * @throws when a choice the action needs is missing
 */
export const borrowerShare = (action: ParyonAction, choices: BorrowerChoices): Record<string, string> => {
  const from: Record<string, unknown> = {
    keyCategory: choices.keyCategory,
    debt: choices.debt,
    collateral: choices.collateral,
    startingRate: choices.rate,
    interestRate: choices.rate,
    repayAmount: choices.repay,
    keyHolder: choices.keyHolder,
    tokensHolder: choices.tokensHolder,
  };
  return Object.fromEntries(
    PARYON_SERVICE_SPLIT[action].borrower.map((name) => {
      const value = from[name];
      if (value === undefined) throw new Error(`${action} needs the borrower's "${name}".`);
      return [name, String(value)];
    }),
  );
};

// ------------------------------------------------------------------------------------------ what is possible

/** A token the wallet holds under the template. */
export interface HeldToken {
  category: string;
  commitment: string;
  capability: 'none' | 'mutable' | 'minting';
  outpoint: string;
}

/** A token category the wallet made under the template, and the transaction that made it. */
export interface MadeCategory {
  category: string;
  transactionId: string;
}

/** A starting action, and whether it can be carried out now. */
export interface PossibleStart {
  action: 'createKey' | 'movePeriod';
  available: boolean;
  reason?: string;
}

/**
 * An action a holding of the wallet's makes possible. `lockingScript` and `coin`: the template script and the coin there
 * the action follows from. `about` and `bindings` mean what they mean in a request of the loan page's (which position the
 * action is about and whether it spends its token; which variables the wallet fills with an address of its own). `says`:
 * values for display only.
 */
export interface PossibleItem {
  category: string;
  action: ParyonAction;
  lockingScript?: string;
  coin?: string;
  about?: { category: string; spent: boolean };
  bindings?: Record<string, string>;
  says?: { variable: string; value: string }[];
}

export interface Possible {
  starts: PossibleStart[];
  items: PossibleItem[];
}

/**
 * What a wallet's holdings make possible: the starting actions, and for each loan key the actions its loan offers (an
 * open loan: managing, repaying in part where the debt allows it, closing where nothing is being redeemed, changing the
 * interest rate; a closed loan: nothing), and for each key the wallet made that still waits in Paryon's contract, the
 * borrowing.
 * @throws when the server cannot be read
 */
export const possibleActions = async (service: Pick<ParyonService, 'contracts' | 'network'>, holdings: { tokens?: HeldToken[]; made?: MadeCategory[] }, chain: ParyonServiceChain): Promise<Possible> => {
  const { contracts } = service;
  const reader = new TransactionReader(chain);
  const state = await readParyonState(chain, contracts, reader);
  const period = periodAt(contracts.deployment, finalLockHeight(service.network, (await chain.tip()).height));
  const starts: PossibleStart[] = [
    state.loanKeyFactory.length > 0 ? { action: 'createKey', available: true } : { action: 'createKey', available: false, reason: 'Paryon\'s key factory could not be found on the chain just now.' },
    state.borrowing.some((thread) => thread.period < period)
      ? { action: 'movePeriod', available: true }
      : { action: 'movePeriod', available: false, reason: 'Paryon\'s borrowing contracts are in the current period already.' },
  ];
  const items: PossibleItem[] = [];
  const keys = [...new Set((holdings.tokens ?? []).filter((token) => token.capability === 'minting' && token.commitment === '' && /^[0-9a-f]{64}$/.test(token.category)).map((token) => token.category))];
  for (const category of keys) {
    const found = await findLoan(chain, contracts, hexToBin(category), reader);
    if (found === undefined) continue;
    const { borrowed, beingRedeemed, nextInterestRate } = found.state;
    const collateral = String(found.loan.output.valueSatoshis);
    const onLoan = { category, lockingScript: 'loanContract', coin: outpointOf(found.loan), about: { category, spent: true } };
    const back = { keyHolder: 'return' };
    items.push({ ...onLoan, action: 'manage', bindings: back, says: [{ variable: 'debt', value: String(borrowed) }, { variable: 'collateral', value: collateral }] });
    if (borrowed - beingRedeemed - MINIMUM_DEBT >= MINIMUM_DEBT) items.push({ ...onLoan, action: 'repay', bindings: back, says: [{ variable: 'debt', value: String(borrowed) }, { variable: 'collateral', value: collateral }] });
    if (beingRedeemed === 0n) items.push({ ...onLoan, action: 'close', bindings: { keyHolder: 'receive' }, says: [{ variable: 'repayAmount', value: String(borrowed) }, { variable: 'collateral', value: collateral }] });
    items.push({ ...onLoan, action: 'changeInterest', bindings: back, says: [{ variable: 'interestRate', value: String(nextInterestRate) }, { variable: 'collateral', value: collateral }] });
  }
  for (const made of holdings.made ?? []) {
    const key = await readMadeKey(chain, made.transactionId).catch(() => undefined);
    const token = key?.enforcer.output.token;
    if (key === undefined || key.category !== made.category || token === undefined || binToHex(token.category) !== made.category || token.nft?.capability !== 'minting') continue;
    if (binToHex(key.enforcer.output.lockingBytecode) !== binToHex(contracts.loanKeyOriginEnforcer.lockingBytecode)) continue;
    if (!(await keyWaiting(chain, key))) continue;
    items.push({
      category: made.category,
      action: 'borrow',
      lockingScript: 'originEnforcerContract',
      coin: outpointOf(key.enforcer),
      about: { category: made.category, spent: false },
      bindings: { keyHolder: 'receive', tokensHolder: 'receive' },
    });
  }
  return { starts, items };
};

/** Where a template of version 3 says its service is: the resource named `xo_service_v1`. */
export const serviceAddress = (template: ReadTemplate['definition']): string | undefined =>
  ((template as { resources?: { name: string; url: string }[] }).resources ?? []).find((resource) => resource.name === SERVICE_RESOURCE)?.url;
