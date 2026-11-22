import { binToHex } from '@bitauth/libauth';

import type { ParyonContracts } from './deployment.js';

/**
 * The XO template of a ParyonUSD loan, for one deployment of ParyonUSD.
 *
 * Every script in the template is one of Paryon's contracts as published (`@paryonusd/contracts` 1.1.0), built
 * with the deployment's parameters: the template carries each contract's redeem bytecode whole, so that the
 * scripts it gives are exactly the ones on chain. The template holds no key and no secret. Authority over a
 * loan is its loan key, a minting NFT that the wallet keeps at an address of its own; the loan is found from
 * the key through its sidecar, the coin beside it that carries the key's category.
 *
 * Positions in the transactions are the contracts' own: the template gives each of its inputs and outputs the
 * index the contracts require (`inputIndex`, `outputIndex`). Where it leaves a position free, the wallet puts
 * its own coin or output there: the coin that defines the loan key's category is input 0 of the key's
 * creation, and output 0 of that transaction is what the wallet keeps of its coin.
 *
 * What the wallet cannot read from the chain comes from the page as values: amounts, the loan's new state,
 * the borrowing fee, a lock time. The wallet does not check Paryon's arithmetic; every input of every
 * transaction is evaluated in the virtual machine before anything is signed, so a wrong value is a refusal.
 *
 * The text a wallet is sent is the frozen copy in `frozen/`, made from this source by `npm run freeze`.
 *
 * Versions. Version 1 offers all six of its actions as starting actions. Version 2 starts only what needs no coin of
 * the borrower's (making a key, bringing Paryon up to date) and declares the rest where the contracts give them: the
 * loan key waiting in Paryon's contract offers the borrowing, and a loan offers managing, repaying, closing and changing
 * its interest rate, an action version 1 does not have. A loan that one of these actions leaves open is again at the
 * loan's script, with the same actions. Version 1 is kept, as it was frozen, for what was recorded under it.
 *
 * Version 3 adds a second participant: Paryon's service, an application's service in a role of its own (`service`),
 * which takes part in every action. What the user decides and what is the wallet's own comes from the wallet (the key's
 * category, the amounts, the interest rate, its addresses); what only the chain or Paryon's state gives comes from the
 * service (prices, records, the borrowing contract's state, what the key's coin holds), together with Paryon's shared
 * coins and the outputs that put them back. Each variable of an action belongs to exactly one of the two roles
 * (`PARYON_SERVICE_SPLIT`). The interest rates are whole numbers a person can be asked for; the unlocking scripts turn
 * them into the two bytes the contracts take. The interest manager is fixed in the unlocking scripts as "no manager":
 * the service cannot set one on a loan. The template names where the service and the loan page are (`resources`); the wallet finds the service
 * by the resource named `xo_service_v1`.
 */

const view = (name: string, description: string) => ({ name, description });
/** A version of this template. Versions 1 and 2 are kept as frozen; the pages and runs send version 2. */
export type ParyonTemplateVersion = 1 | 2 | 3;
/** What the pages and runs send; the names without a version mean it. Version 3 is named by its number only. */
export const PARYON_TEMPLATE_VERSION = 2 as const;

/** The actions of the template; `changeInterest` from version 2 on. */
export type ParyonAction = 'createKey' | 'movePeriod' | 'borrow' | 'manage' | 'repay' | 'close' | 'changeInterest';

/**
 * Version 3: which variables of each action the borrower supplies and which Paryon's service supplies. Each variable an
 * action needs belongs to exactly one of the two. The borrower supplies what the user decides or what is the wallet's
 * own; the service what only the chain or Paryon's state gives.
 */
export const PARYON_SERVICE_SPLIT: Record<ParyonAction, { borrower: readonly string[]; service: readonly string[] }> = {
  createKey: { borrower: ['keyCategory'], service: [] },
  movePeriod: { borrower: [], service: ['borrowingSupply', 'newBorrowingCommitment', 'lockHeight'] },
  borrow: { borrower: ['keyCategory', 'debt', 'collateral', 'startingRate', 'keyHolder', 'tokensHolder'], service: ['borrowingSupply', 'borrowingCommitment', 'priceCommitment', 'loanCommitment', 'borrowingFee'] },
  manage: { borrower: ['keyCategory', 'collateral', 'keyHolder'], service: ['priceCommitment', 'loanCommitment', 'keySatoshis'] },
  repay: { borrower: ['keyCategory', 'repayAmount', 'keyHolder'], service: ['priceCommitment', 'collateral', 'loanCommitment', 'keySatoshis'] },
  close: { borrower: ['keyCategory', 'keyHolder'], service: ['priceCommitment', 'loanCommitment', 'repayAmount', 'keySatoshis'] },
  changeInterest: { borrower: ['keyCategory', 'interestRate', 'keyHolder'], service: ['collateral', 'loanCommitment', 'keySatoshis'] },
};

/** Where Paryon's service and the loan page are, as version 3 names them. */
export interface ParyonAddresses {
  /** The service's address: the resource `xo_service_v1`. */
  service: string;
  /** The loan page's address. */
  page: string;
}
/** The addresses for Paryon's own deployments, chipnet's and mainnet's alike: one address serves several networks. */
export const PARYON_ADDRESSES: ParyonAddresses = { service: 'https://paryon.9500.cash/service/v1', page: 'https://paryon.9500.cash/' };
/**
 * The addresses for a deployment whose loan page is at `page`: the service at `service/v1` on the same host, as for
 * Paryon's own (`PARYON_ADDRESSES`). For a deployment on a chain of one's own, whose template is made at run time.
 */
export const paryonAddressesAt = (page: string): ParyonAddresses => ({ service: new URL('service/v1', page).href, page });
/** The resource by which a wallet finds an application's service. */
export const SERVICE_RESOURCE = 'xo_service_v1';

/**
 * A contract's script: the redeem bytecode, whole. Spent with the unlocking script its input names; never the
 * wallet's, never selected to pay. Every script of Paryon's is shared by all its users, so each is marked as one
 * a wallet need not track: following it would bring every user's coins there, and every transaction of its
 * history (the Borrowing contract's alone has some 76,000 on chipnet), into the wallet's store. The wallet gives
 * such a coin to its key holder with the unlocking it works out from this template.
 */
const contractOf = (withService: boolean) => (name: string, description: string, script: string, followUps: string[] = []) => ({
  ...view(name, description),
  lockingType: 'p2sh',
  lockingBytecode: script,
  selectable: false,
  roles: {
    borrower: { selectable: false, relevant: false, ...(followUps.length === 0 ? {} : { actions: followUps.map((action) => ({ action, role: 'borrower' })) }) },
    // Version 3: the service need not track any of Paryon's scripts either; it offers nothing there.
    ...(withService ? { service: { selectable: false, relevant: false } } : {}),
  },
});
const THREAD = '1000';
/**
 * Version 3's interest manager, in the scripts that take one: none, any rate from 0 to 32,767 (what the loan page has
 * always sent). Written into the scripts rather than named as a constant: the XO engine compiles a script with the
 * template's variables only, and does not know a constant there.
 */
export const NO_MANAGER_SCRIPT = '/* no interest manager: none, rates 0 to 32,767 */ <0x000000ff7f>';
const NO_MANAGER = NO_MANAGER_SCRIPT;

const source = (contracts: ParyonContracts, version: ParyonTemplateVersion, addresses: ParyonAddresses | undefined) => {
  /** From version 2 on: follow-up actions, and changing the interest rate. */
  const latest = version >= 2;
  /** Version 3: Paryon's service takes part in every action. */
  const withService = version === 3;
  if (withService && addresses === undefined) throw new Error('Version 3 of the template names the service\'s and the page\'s addresses; none were given.');
  /** Parts version 1 does not have; each is added after the parts it had, so that version 1 is made as it was frozen. */
  const added = <T extends object>(parts: T): T | Record<string, never> => (latest ? parts : {});
  /** Parts of version 3 only. */
  const serviced = <T extends object>(parts: T): T | Record<string, never> => (withService ? parts : {});
  /** Parts of versions 1 and 2 only. */
  const unserviced = <T extends object>(parts: T): T | Record<string, never> => (withService ? {} : parts);
  /** The actions a script offers a borrower who holds a coin there: none in version 1. */
  const offers = (...actions: string[]): string[] => (latest ? actions : []);
  const contract = contractOf(withService);
  /** An action: the borrower alone in versions 1 and 2; in version 3 the borrower and the service, each with its own variables. */
  const action = (name: string, description: string, variables: string[], transaction: string, split?: { borrower: readonly string[]; service: readonly string[] }) =>
    withService && split !== undefined
      ? {
          ...view(name, description),
          roles: { borrower: { requirements: { variables: [...split.borrower] } }, service: { requirements: { variables: [...split.service] } } },
          requirements: { participants: [{ role: 'borrower', slots: { min: 1, max: 1 } }, { role: 'service', slots: { min: 1, max: 1 } }] },
          transaction,
        }
      : {
          ...view(name, description),
          roles: { borrower: { requirements: { variables } } },
          requirements: { participants: [{ role: 'borrower', slots: { min: 1, max: 1 } }] },
          transaction,
        };
  const split = PARYON_SERVICE_SPLIT;
  const P = binToHex(contracts.paryonCategory);
  const F = binToHex(contracts.loanKeyFactoryCategory);
  const deployment = contracts.deployment.name;
  return {
    $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
    ...view(
      `ParyonUSD loan (${deployment})`,
      `Borrow ParyonUSD (PUSD) against BCH. The loan key, a token that stays in your wallet, manages the loan: whoever holds it can add or take out collateral, repay and close${latest ? ', and change the interest rate' : ''}. Interest is taken from the collateral; the debt in PUSD does not grow. A loan whose collateral falls below 110% of the debt at the price in Paryon's price contract can be liquidated by anyone. Paryon's deployment "${deployment}".`,
    ),
    version: String(version),
    supported: ['BCH_2026_05'],
    roles: {
      borrower: view('Borrower', 'Holds the loan key, and opens, manages and closes the loan.'),
      ...serviced({ service: view('Service', 'Supplies Paryon\'s prices, records and shared coins for each action.') }),
    },
    ...serviced({
      resources: [
        { name: SERVICE_RESOURCE, description: 'Paryon\'s service, which takes part in every action of this template as the service.', url: addresses?.service ?? '' },
        { name: 'Loan page', description: 'The page that shows your loans and starts their actions.', url: addresses?.page ?? '' },
      ],
    }),
    start: [
      { action: 'createKey', role: 'borrower' },
      { action: 'movePeriod', role: 'borrower' },
      // Version 1 offered every action as a starting one.
      ...(latest ? [] : ['borrow', 'manage', 'repay', 'close'].map((action) => ({ action, role: 'borrower' }))),
    ],
    actions: {
      createKey: action('Make a loan key', 'Make the key of a new loan. It waits in Paryon\'s contract until the loan is opened with it, and comes to your wallet then.', ['keyCategory'], 'createKeyTransaction', split.createKey),
      movePeriod: action(
        'Bring Paryon up to date',
        'Move one of Paryon\'s borrowing contracts on to the current period, so that a loan opened from it is charged no interest for periods before today. Anyone may do this; it costs only the network fee.',
        ['borrowingSupply', 'newBorrowingCommitment', 'lockHeight'],
        'movePeriodTransaction',
        split.movePeriod,
      ),
      borrow: action(
        'Borrow PUSD',
        'Open the loan: your BCH goes into the loan as collateral, Paryon takes its borrowing fee, and the borrowed PUSD and the loan key come to your wallet.',
        ['keyCategory', 'borrowingSupply', 'borrowingCommitment', 'priceCommitment', 'debt', 'collateral', 'loanCommitment', 'borrowingFee', 'startingInterest', 'interestManagerConfiguration', 'keyHolder', 'tokensHolder'],
        'borrowTransaction',
        split.borrow,
      ),
      manage: action(
        'Change the collateral',
        'Add BCH to the loan, or take some out while it stays above 110% of the debt. The loan key goes back to the address it came from.',
        ['keyCategory', 'priceCommitment', 'collateral', 'loanCommitment', 'interestManagerConfiguration', 'keySatoshis', 'keyHolder'],
        'manageTransaction',
        split.manage,
      ),
      repay: action(
        'Repay part of the loan',
        'Pay back part of the debt in PUSD; at least 100.00 PUSD, and at least 100.00 PUSD stays owed. The PUSD paid back is destroyed. The loan key goes back to the address it came from.',
        ['keyCategory', 'priceCommitment', 'collateral', 'loanCommitment', 'repayAmount', 'interestManagerConfiguration', 'keySatoshis', 'keyHolder'],
        'repayTransaction',
        split.repay,
      ),
      close: action(
        'Repay and close the loan',
        'Pay back the whole debt in PUSD and close the loan. The PUSD paid back and the loan\'s record are destroyed; the collateral comes back to your wallet, and the loan key stays with you.',
        ['keyCategory', 'priceCommitment', 'loanCommitment', 'repayAmount', 'interestManagerConfiguration', 'keySatoshis', 'keyHolder'],
        'closeTransaction',
        split.close,
      ),
      ...added({
        changeInterest: action(
          'Change the interest rate',
          'Choose the rate the loan pays from its next interest payment on. Interest is paid in BCH out of the collateral each period; the debt in PUSD does not grow. A lower rate costs less, but a redemption may be moved onto a loan with a lower rate: someone hands in PUSD for the same value in BCH out of that loan\'s collateral, and its debt falls by as much. The loan key goes back to the address it came from.',
          ['keyCategory', 'collateral', 'loanCommitment', 'nextInterestRate', 'keySatoshis', 'keyHolder'],
          'changeInterestTransaction',
          split.changeInterest,
        ),
      }),
    },
    transactions: {
      createKeyTransaction: {
        ...view('Loan key made', 'A loan key was made. It waits in Paryon\'s contract until the loan is opened.'),
        // Input 0 is the wallet's coin whose transaction's identifier becomes the key's category; output 0 is what the wallet keeps of it.
        inputs: [{ input: 'factoryInput', inputIndex: 1 }],
        outputs: [
          { output: 'factoryOutput', outputIndex: 1 },
          { output: 'enforcerOutput', outputIndex: 2 },
          { output: 'proofOutput', outputIndex: 3 },
        ],
        version: 2,
        locktime: 0,
      },
      movePeriodTransaction: {
        ...view('Paryon brought up to date', 'A borrowing contract of Paryon was moved on to the current period.'),
        inputs: [{ input: 'periodBorrowingInput', inputIndex: 0 }],
        outputs: [{ output: 'periodBorrowingOutput', outputIndex: 0 }],
        version: 2,
        // The contract takes the period from the lock time.
        locktime: '$(<lockHeight>)',
      },
      borrowTransaction: {
        ...view('PUSD borrowed', '$(<debt>) PUSD cents were borrowed against $(<collateral>) satoshis of collateral.'),
        inputs: [
          { input: 'borrowingInput', inputIndex: 0 },
          { input: 'priceInput', inputIndex: 1 },
          { input: 'enforcerInput', inputIndex: 2 },
          { input: 'proofInput', inputIndex: 3 },
        ],
        outputs: [
          { output: 'borrowingOutput', outputIndex: 0 },
          { output: 'priceOutput', outputIndex: 1 },
          { output: 'loanOutput', outputIndex: 2 },
          { output: 'sidecarOutput', outputIndex: 3 },
          { output: 'feeOutput', outputIndex: 4 },
          { output: 'keyOutput', outputIndex: 5 },
          { output: 'tokensOutput', outputIndex: 6 },
        ],
        version: 2,
        locktime: 0,
      },
      manageTransaction: {
        ...view('Collateral changed', 'The loan now holds $(<collateral>) satoshis of collateral.'),
        inputs: [
          { input: 'priceInput', inputIndex: 0 },
          { input: 'loanInput', inputIndex: 1 },
          { input: 'sidecarInput', inputIndex: 2 },
          { input: 'manageInput', inputIndex: 3 },
        ],
        outputs: [
          { output: 'priceOutput', outputIndex: 0 },
          { output: 'loanOutput', outputIndex: 1 },
          { output: 'sidecarOutput', outputIndex: 2 },
          { output: 'manageOutput', outputIndex: 3 },
          { output: 'keyBackOutput', outputIndex: 4 },
        ],
        version: 2,
        locktime: 0,
      },
      repayTransaction: {
        ...view('Part of the loan repaid', '$(<repayAmount>) PUSD cents were repaid and destroyed; the loan holds $(<collateral>) satoshis of collateral.'),
        inputs: [
          { input: 'priceInput', inputIndex: 0 },
          { input: 'loanInput', inputIndex: 1 },
          { input: 'sidecarInput', inputIndex: 2 },
          { input: 'repayInput', inputIndex: 3 },
        ],
        outputs: [
          { output: 'priceOutput', outputIndex: 0 },
          { output: 'loanOutput', outputIndex: 1 },
          { output: 'sidecarOutput', outputIndex: 2 },
          { output: 'manageOutput', outputIndex: 3 },
          { output: 'keyBackOutput', outputIndex: 4 },
          { output: 'repaidOutput', outputIndex: 5 },
        ],
        version: 2,
        locktime: 0,
      },
      closeTransaction: {
        ...view('Loan closed', 'The loan was closed: $(<repayAmount>) PUSD cents were repaid and destroyed, and the collateral came back.'),
        inputs: [
          { input: 'priceInput', inputIndex: 0 },
          { input: 'loanInput', inputIndex: 1 },
          { input: 'sidecarInput', inputIndex: 2 },
          { input: 'repayInput', inputIndex: 3 },
        ],
        outputs: [
          { output: 'priceOutput', outputIndex: 0 },
          { output: 'closedManageOutput', outputIndex: 1 },
          { output: 'repaidOutput', outputIndex: 2 },
          { output: 'loanRecordOutput', outputIndex: 3 },
          { output: 'keyBackOutput', outputIndex: 4 },
        ],
        version: 2,
        locktime: 0,
      },
      ...added({
        changeInterestTransaction: {
          ...view('Interest rate changed', 'The loan\'s rate for the periods to come was changed; the loan holds $(<collateral>) satoshis of collateral.'),
          // Input 3 is the loan key, the wallet's; output 3 takes it back to the script it was spent from.
          inputs: [
            { input: 'loanInput', inputIndex: 0 },
            { input: 'sidecarInput', inputIndex: 1 },
            { input: 'changeInterestInput', inputIndex: 2 },
          ],
          outputs: [
            { output: 'loanOutput', outputIndex: 0 },
            { output: 'sidecarOutput', outputIndex: 1 },
            { output: 'changeInterestOutput', outputIndex: 2 },
            { output: 'keyBackOutput', outputIndex: 3 },
          ],
          version: 2,
          locktime: 0,
        },
      }),
    },
    inputs: {
      factoryInput: { ...view('Paryon\'s key factory', 'A contract of Paryon that makes loan keys. It is put back as it was.'), unlockingScript: 'unlockWithoutArguments' },
      periodBorrowingInput: { ...view('Paryon\'s borrowing contract', 'The contract that lends PUSD. Its period is moved on.'), unlockingScript: 'unlockMovePeriod' },
      borrowingInput: { ...view('Paryon\'s borrowing contract', 'The contract that lends PUSD. It is put back with the borrowed PUSD less.'), unlockingScript: 'unlockBorrow' },
      priceInput: { ...view('Paryon\'s price contract', 'The BCH price the loan is reckoned at. It is put back as it was.'), unlockingScript: 'unlockSharePrice' },
      enforcerInput: { ...view('The new loan key', 'The loan key made for this loan, waiting in Paryon\'s contract.'), unlockingScript: 'unlockWithoutArguments' },
      proofInput: { ...view('The loan key\'s proof of origin', 'Shows that the loan key was made by Paryon\'s factory. It is used up.'), unlockingScript: 'unlockWithoutArguments' },
      loanInput: { ...view('The loan', 'The loan\'s collateral and its record.'), unlockingScript: 'unlockWithoutArguments' },
      sidecarInput: { ...view('The loan\'s sidecar', 'The coin beside the loan that names its key.'), unlockingScript: 'unlockWithoutArguments' },
      manageInput: { ...view('Paryon\'s manage function', 'The contract that checks a change to a loan. It is put back as it was.'), unlockingScript: 'unlockManage' },
      repayInput: { ...view('Paryon\'s manage function', 'The contract that checks a repayment. It is put back as it was.'), unlockingScript: 'unlockRepay' },
      ...added({ changeInterestInput: { ...view('Paryon\'s interest function', 'The contract that checks a change of a loan\'s interest rate. It is put back as it was.'), unlockingScript: 'unlockChangeInterest' } }),
    },
    outputs: {
      factoryOutput: { ...view('Paryon\'s key factory', 'Put back as it was.'), lockingScript: 'loanKeyFactoryContract', valueSatoshis: THREAD, token: { category: F, amount: null, nft: { capability: 'minting', commitment: '' } } },
      enforcerOutput: { ...view('The new loan key, waiting', 'The loan key, held by Paryon\'s contract until the loan is opened.'), lockingScript: 'originEnforcerContract', valueSatoshis: THREAD, token: { category: '$(<keyCategory>)', amount: null, nft: { capability: 'minting', commitment: '' } } },
      proofOutput: { ...view('The loan key\'s proof of origin', 'Shows that the key comes from Paryon\'s factory.'), lockingScript: 'originProofContract', valueSatoshis: THREAD, token: { category: F, amount: null, nft: { capability: 'none', commitment: '' } } },
      periodBorrowingOutput: {
        ...view('Paryon\'s borrowing contract', 'Put back, in the current period.'),
        lockingScript: 'borrowingContract',
        valueSatoshis: THREAD,
        token: { category: P, amount: '$(<borrowingSupply>)', nft: { capability: 'minting', commitment: '$(<newBorrowingCommitment>)' } },
      },
      borrowingOutput: {
        ...view('Paryon\'s borrowing contract', 'Put back with the borrowed PUSD less.'),
        lockingScript: 'borrowingContract',
        valueSatoshis: THREAD,
        token: { category: P, amount: '$(<borrowingSupply> <debt> OP_SUB)', nft: { capability: 'minting', commitment: '$(<borrowingCommitment>)' } },
      },
      priceOutput: { ...view('Paryon\'s price contract', 'Put back as it was.'), lockingScript: 'priceContract', valueSatoshis: THREAD, token: { category: P, amount: null, nft: { capability: 'mutable', commitment: '$(<priceCommitment>)' } } },
      loanOutput: {
        ...view('The loan', '$(<collateral>) satoshis of collateral, with the loan\'s record.'),
        lockingScript: 'loanContract',
        valueSatoshis: '$(<collateral>)',
        token: { category: P, amount: null, nft: { capability: 'mutable', commitment: '$(<loanCommitment>)' } },
      },
      sidecarOutput: { ...view('The loan\'s sidecar', 'Names the loan\'s key, so that the loan can be found from it.'), lockingScript: 'sidecarContract', valueSatoshis: THREAD, token: { category: '$(<keyCategory>)', amount: null, nft: { capability: 'none', commitment: '01' } } },
      feeOutput: { ...view('Borrowing fee', '$(<borrowingFee>) satoshis to Paryon: 0.25% of the debt\'s value, at least 1,000 satoshis.'), lockingScript: '$(<protocolFeeLockingBytecode>)', valueSatoshis: '$(<borrowingFee>)' },
      keyOutput: {
        ...view('Loan key', 'The token that manages the loan. Keep it in the wallet.'),
        lockingScript: '$(<keyHolder>)',
        valueSatoshis: THREAD,
        token: { category: '$(<keyCategory>)', amount: null, nft: { capability: 'minting', commitment: '' } },
      },
      tokensOutput: { ...view('Borrowed PUSD', '$(<debt>) PUSD cents, to the wallet.'), lockingScript: '$(<tokensHolder>)', valueSatoshis: THREAD, token: { category: P, amount: '$(<debt>)', nft: null } },
      manageOutput: { ...view('Paryon\'s manage function', 'Put back as it was.'), lockingScript: 'manageContract', valueSatoshis: THREAD, token: { category: P, amount: null, nft: { capability: 'none', commitment: '02' } } },
      closedManageOutput: { ...view('Paryon\'s manage function', 'Put back as it was.'), lockingScript: 'manageContract', valueSatoshis: THREAD, token: { category: P, amount: null, nft: { capability: 'none', commitment: '02' } } },
      keyBackOutput: {
        ...view('Loan key', 'The loan key, back to the wallet.'),
        lockingScript: '$(<keyHolder>)',
        valueSatoshis: '$(<keySatoshis>)',
        token: { category: '$(<keyCategory>)', amount: null, nft: { capability: 'minting', commitment: '' } },
      },
      repaidOutput: { ...view('PUSD repaid', '$(<repayAmount>) PUSD cents, destroyed.'), lockingScript: '$(<burnLockingBytecode>)', valueSatoshis: '0', token: { category: P, amount: '$(<repayAmount>)', nft: null } },
      loanRecordOutput: { ...view('The loan\'s record', 'Destroyed: the loan is over.'), lockingScript: '$(<burnLockingBytecode>)', valueSatoshis: '0', token: { category: P, amount: null, nft: { capability: 'mutable', commitment: '$(<loanCommitment>)' } } },
      ...added({
        changeInterestOutput: { ...view('Paryon\'s interest function', 'Put back as it was.'), lockingScript: 'changeInterestContract', valueSatoshis: THREAD, token: { category: P, amount: null, nft: { capability: 'none', commitment: '08' } } },
      }),
    },
    lockingScripts: {
      borrowingContract: contract('Paryon\'s borrowing contract', 'Lends PUSD against BCH (Borrowing).', 'borrowingBytecode'),
      priceContract: contract('Paryon\'s price contract', 'Keeps the BCH price from the oracle (PriceContractGuarded).', 'priceBytecode'),
      loanKeyFactoryContract: contract('Paryon\'s key factory', 'Makes loan keys (LoanKeyFactory).', 'loanKeyFactoryBytecode'),
      // The borrower's coins are the key waiting here and, once the loan is open, the loan: each offers what can follow.
      originEnforcerContract: contract('A loan key, waiting', 'Holds a loan key until its loan is opened (LoanKeyOriginEnforcer).', 'originEnforcerBytecode', offers('borrow')),
      originProofContract: contract('A loan key\'s proof of origin', 'Shows where a loan key comes from (LoanKeyOriginProof).', 'originProofBytecode'),
      loanContract: contract('A loan', 'A loan\'s collateral and record (Loan).', 'loanBytecode', offers('manage', 'repay', 'close', 'changeInterest')),
      sidecarContract: contract('A loan\'s sidecar', 'Names a loan\'s key (LoanTokenSidecar).', 'sidecarBytecode'),
      manageContract: contract('Paryon\'s manage function', 'Checks every change to a loan (manageLoan).', 'manageBytecode'),
      ...added({ changeInterestContract: contract('Paryon\'s interest function', 'Checks every change of a loan\'s interest rate (changeInterest).', 'changeInterestBytecode') }),
    },
    scripts: {
      // Each contract's redeem bytecode: the compiled contract with the deployment's parameters, as on chain.
      borrowingBytecode: `0x${binToHex(contracts.borrowing.redeemBytecode)}`,
      priceBytecode: `0x${binToHex(contracts.price.redeemBytecode)}`,
      loanKeyFactoryBytecode: `0x${binToHex(contracts.loanKeyFactory.redeemBytecode)}`,
      originEnforcerBytecode: `0x${binToHex(contracts.loanKeyOriginEnforcer.redeemBytecode)}`,
      originProofBytecode: `0x${binToHex(contracts.loanKeyOriginProof.redeemBytecode)}`,
      loanBytecode: `0x${binToHex(contracts.loan.redeemBytecode)}`,
      sidecarBytecode: `0x${binToHex(contracts.loanSidecar.redeemBytecode)}`,
      manageBytecode: `0x${binToHex(contracts.manage.redeemBytecode)}`,
      // A contract's function is called with its arguments, last first, then the function's number when the contract has more than one.
      unlockWithoutArguments: '// a function without arguments, of a contract with one function',
      // Version 3 takes the rate as a whole number and makes the two bytes the contract takes of it. Its interest manager
      // is fixed in the scripts: none (five bytes), so that the service cannot set one on the borrower's loan.
      unlockBorrow: withService ? `${NO_MANAGER} <$(<startingRate> <2> OP_NUM2BIN)> <0>` : '<interestManagerConfiguration> <startingInterest> <0>',
      unlockMovePeriod: '<1>',
      unlockSharePrice: '<1>',
      unlockManage: withService ? `${NO_MANAGER} <0>` : '<interestManagerConfiguration> <0>',
      unlockRepay: withService ? `${NO_MANAGER} <repayAmount>` : '<interestManagerConfiguration> <repayAmount>',
      ...added({
        changeInterestBytecode: `0x${binToHex(contracts.changeInterest.redeemBytecode)}`,
        unlockChangeInterest: withService ? '<$(<interestRate> <2> OP_NUM2BIN)>' : '<nextInterestRate>',
      }),
    },
    constants: {
      protocolFeeLockingBytecode: { ...view('Paryon\'s fee address', 'Where borrowing fees go.'), type: 'locking_script', value: binToHex(contracts.protocolFeeLockingBytecode) },
      burnLockingBytecode: { ...view('Destroyed', 'A data output: what is sent there can never be spent.'), type: 'locking_script', value: '6a' },
    },
    variables: {
      keyCategory: { ...view('Loan key', 'The token category of the loan\'s key.'), type: 'token_category' },
      keyHolder: { ...view('Key holder', 'Where the loan key goes: an address of the wallet.'), type: 'locking_script' },
      tokensHolder: { ...view('PUSD holder', 'Where the borrowed PUSD go: an address of the wallet.'), type: 'locking_script' },
      keySatoshis: { ...view('Satoshis with the key', withService ? 'What the coin that carries the loan key holds, as the chain shows it; it goes back unchanged.' : 'What the coin that carries the loan key holds; it goes back unchanged.'), type: 'satoshis' },
      borrowingSupply: { ...view('PUSD left to lend', 'What the borrowing contract can still lend, in PUSD cents, before this loan.'), type: 'token_amount' },
      borrowingCommitment: { ...view('Period of the borrowing contract', 'The borrowing contract\'s state, as it is.'), type: 'bytes' },
      newBorrowingCommitment: { ...view('New period', 'The borrowing contract\'s state in the current period.'), type: 'bytes' },
      lockHeight: { ...view('Block height', 'The height the transaction is locked to; the period follows from it.'), type: 'integer' },
      priceCommitment: { ...view('Price', 'The state of the price contract used: the oracle\'s sequence and the price in US cents.'), type: 'bytes' },
      debt: { ...view('Debt', 'PUSD borrowed, in cents.'), type: 'token_amount' },
      collateral: { ...view('Collateral', 'Satoshis the loan holds as collateral.'), type: 'satoshis' },
      loanCommitment: { ...view('Loan record', 'The loan\'s state: its debt, interest and period, as Paryon\'s contracts write it.'), type: 'bytes' },
      borrowingFee: { ...view('Borrowing fee', 'Satoshis to Paryon for opening the loan.'), type: 'satoshis' },
      ...unserviced({
        startingInterest: { ...view('Starting interest', 'Interest per 10,000,000 per period, as two bytes.'), type: 'bytes' },
        interestManagerConfiguration: { ...view('Interest manager', 'Who may change the loan\'s interest, and within which limits, as five bytes.'), type: 'bytes' },
      }),
      repayAmount: { ...view('Repayment', 'PUSD repaid, in cents.'), type: 'token_amount' },
      ...(withService
        ? {
            startingRate: { ...view('Starting interest rate', 'The rate the loan starts with: per 10,000,000 of the debt\'s value, per period, a whole number from 0 to 32,767.'), type: 'integer' },
            interestRate: { ...view('New interest rate', 'The rate from the next interest payment on: per 10,000,000 of the debt\'s value, per period, a whole number from 0 to 32,767.'), type: 'integer' },
          }
        : added({ nextInterestRate: { ...view('Interest rate', 'The rate from the next interest payment on: per 10,000,000 of the debt\'s value, per period, as two bytes.'), type: 'bytes' } })),
    },
  };
};

/** The template's source for a deployment: versions 1 and 2 as frozen; version 3 with the service's and the page's addresses. */
export type ParyonTemplateSource = ReturnType<typeof source>;
export function paryonTemplateSource(contracts: ParyonContracts, version?: 1 | 2): ParyonTemplateSource;
export function paryonTemplateSource(contracts: ParyonContracts, version: 3, addresses: ParyonAddresses): ParyonTemplateSource;
export function paryonTemplateSource(contracts: ParyonContracts, version: ParyonTemplateVersion, addresses?: ParyonAddresses): ParyonTemplateSource;
export function paryonTemplateSource(contracts: ParyonContracts, version: ParyonTemplateVersion = PARYON_TEMPLATE_VERSION, addresses?: ParyonAddresses): ParyonTemplateSource {
  return source(contracts, version, version === 3 ? addresses : undefined);
}
