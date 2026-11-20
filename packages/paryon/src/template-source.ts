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
 */

const view = (name: string, description: string) => ({ name, description });
const action = (name: string, description: string, variables: string[], transaction: string) => ({
  ...view(name, description),
  roles: { borrower: { requirements: { variables } } },
  requirements: { participants: [{ role: 'borrower', slots: { min: 1, max: 1 } }] },
  transaction,
});
/**
 * A contract's script: the redeem bytecode, whole. Spent with the unlocking script its input names; never the
 * wallet's, never selected to pay. Every script of Paryon's is shared by all its users, so each is marked as one
 * a wallet need not track: following it would bring every user's coins there, and every transaction of its
 * history (the Borrowing contract's alone has some 76,000 on chipnet), into the wallet's store. The wallet gives
 * such a coin to its key holder with the unlocking it works out from this template.
 */
const contract = (name: string, description: string, script: string) => ({
  ...view(name, description),
  lockingType: 'p2sh',
  lockingBytecode: script,
  selectable: false,
  roles: { borrower: { selectable: false, relevant: false } },
});
const THREAD = '1000';

export const paryonTemplateSource = (contracts: ParyonContracts) => {
  const P = binToHex(contracts.paryonCategory);
  const F = binToHex(contracts.loanKeyFactoryCategory);
  const deployment = contracts.deployment.name;
  return {
    $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
    ...view(
      `ParyonUSD loan (${deployment})`,
      `Borrow ParyonUSD (PUSD) against BCH. The loan key, a token that stays in your wallet, manages the loan: whoever holds it can add or take out collateral, repay and close. Interest is taken from the collateral; the debt in PUSD does not grow. A loan whose collateral falls below 110% of the debt at the price in Paryon's price contract can be liquidated by anyone. Paryon's deployment "${deployment}".`,
    ),
    version: '1',
    supported: ['BCH_2026_05'],
    roles: { borrower: view('Borrower', 'Holds the loan key, and opens, manages and closes the loan.') },
    start: [
      { action: 'createKey', role: 'borrower' },
      { action: 'movePeriod', role: 'borrower' },
      { action: 'borrow', role: 'borrower' },
      { action: 'manage', role: 'borrower' },
      { action: 'repay', role: 'borrower' },
      { action: 'close', role: 'borrower' },
    ],
    actions: {
      createKey: action('Make a loan key', 'Make the key of a new loan. It waits in Paryon\'s contract until the loan is opened with it, and comes to your wallet then.', ['keyCategory'], 'createKeyTransaction'),
      movePeriod: action(
        'Bring Paryon up to date',
        'Move one of Paryon\'s borrowing contracts on to the current period, so that a loan opened from it is charged no interest for periods before today. Anyone may do this; it costs only the network fee.',
        ['borrowingSupply', 'newBorrowingCommitment', 'lockHeight'],
        'movePeriodTransaction',
      ),
      borrow: action(
        'Borrow PUSD',
        'Open the loan: your BCH goes into the loan as collateral, Paryon takes its borrowing fee, and the borrowed PUSD and the loan key come to your wallet.',
        ['keyCategory', 'borrowingSupply', 'borrowingCommitment', 'priceCommitment', 'debt', 'collateral', 'loanCommitment', 'borrowingFee', 'startingInterest', 'interestManagerConfiguration', 'keyHolder', 'tokensHolder'],
        'borrowTransaction',
      ),
      manage: action(
        'Change the collateral',
        'Add BCH to the loan, or take some out while it stays above 110% of the debt. The loan key goes back to the address it came from.',
        ['keyCategory', 'priceCommitment', 'collateral', 'loanCommitment', 'interestManagerConfiguration', 'keySatoshis', 'keyHolder'],
        'manageTransaction',
      ),
      repay: action(
        'Repay part of the loan',
        'Pay back part of the debt in PUSD; at least 100.00 PUSD, and at least 100.00 PUSD stays owed. The PUSD paid back is destroyed. The loan key goes back to the address it came from.',
        ['keyCategory', 'priceCommitment', 'collateral', 'loanCommitment', 'repayAmount', 'interestManagerConfiguration', 'keySatoshis', 'keyHolder'],
        'repayTransaction',
      ),
      close: action(
        'Repay and close the loan',
        'Pay back the whole debt in PUSD and close the loan. The PUSD paid back and the loan\'s record are destroyed; the collateral comes back to your wallet, and the loan key stays with you.',
        ['keyCategory', 'priceCommitment', 'loanCommitment', 'repayAmount', 'interestManagerConfiguration', 'keySatoshis', 'keyHolder'],
        'closeTransaction',
      ),
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
    },
    lockingScripts: {
      borrowingContract: contract('Paryon\'s borrowing contract', 'Lends PUSD against BCH (Borrowing).', 'borrowingBytecode'),
      priceContract: contract('Paryon\'s price contract', 'Keeps the BCH price from the oracle (PriceContractGuarded).', 'priceBytecode'),
      loanKeyFactoryContract: contract('Paryon\'s key factory', 'Makes loan keys (LoanKeyFactory).', 'loanKeyFactoryBytecode'),
      originEnforcerContract: contract('A loan key, waiting', 'Holds a loan key until its loan is opened (LoanKeyOriginEnforcer).', 'originEnforcerBytecode'),
      originProofContract: contract('A loan key\'s proof of origin', 'Shows where a loan key comes from (LoanKeyOriginProof).', 'originProofBytecode'),
      loanContract: contract('A loan', 'A loan\'s collateral and record (Loan).', 'loanBytecode'),
      sidecarContract: contract('A loan\'s sidecar', 'Names a loan\'s key (LoanTokenSidecar).', 'sidecarBytecode'),
      manageContract: contract('Paryon\'s manage function', 'Checks every change to a loan (manageLoan).', 'manageBytecode'),
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
      unlockBorrow: '<interestManagerConfiguration> <startingInterest> <0>',
      unlockMovePeriod: '<1>',
      unlockSharePrice: '<1>',
      unlockManage: '<interestManagerConfiguration> <0>',
      unlockRepay: '<interestManagerConfiguration> <repayAmount>',
    },
    constants: {
      protocolFeeLockingBytecode: { ...view('Paryon\'s fee address', 'Where borrowing fees go.'), type: 'locking_script', value: binToHex(contracts.protocolFeeLockingBytecode) },
      burnLockingBytecode: { ...view('Destroyed', 'A data output: what is sent there can never be spent.'), type: 'locking_script', value: '6a' },
    },
    variables: {
      keyCategory: { ...view('Loan key', 'The token category of the loan\'s key.'), type: 'token_category' },
      keyHolder: { ...view('Key holder', 'Where the loan key goes: an address of the wallet.'), type: 'locking_script' },
      tokensHolder: { ...view('PUSD holder', 'Where the borrowed PUSD go: an address of the wallet.'), type: 'locking_script' },
      keySatoshis: { ...view('Satoshis with the key', 'What the coin that carries the loan key holds; it goes back unchanged.'), type: 'satoshis' },
      borrowingSupply: { ...view('PUSD left to lend', 'What the borrowing contract can still lend, in PUSD cents, before this loan.'), type: 'token_amount' },
      borrowingCommitment: { ...view('Period of the borrowing contract', 'The borrowing contract\'s state, as it is.'), type: 'bytes' },
      newBorrowingCommitment: { ...view('New period', 'The borrowing contract\'s state in the current period.'), type: 'bytes' },
      lockHeight: { ...view('Block height', 'The height the transaction is locked to; the period follows from it.'), type: 'integer' },
      priceCommitment: { ...view('Price', 'The state of the price contract used: the oracle\'s sequence and the price in US cents.'), type: 'bytes' },
      debt: { ...view('Debt', 'PUSD borrowed, in cents.'), type: 'token_amount' },
      collateral: { ...view('Collateral', 'Satoshis the loan holds as collateral.'), type: 'satoshis' },
      loanCommitment: { ...view('Loan record', 'The loan\'s state: its debt, interest and period, as Paryon\'s contracts write it.'), type: 'bytes' },
      borrowingFee: { ...view('Borrowing fee', 'Satoshis to Paryon for opening the loan.'), type: 'satoshis' },
      startingInterest: { ...view('Starting interest', 'Interest per 10,000,000 per period, as two bytes.'), type: 'bytes' },
      interestManagerConfiguration: { ...view('Interest manager', 'Who may change the loan\'s interest, and within which limits, as five bytes.'), type: 'bytes' },
      repayAmount: { ...view('Repayment', 'PUSD repaid, in cents.'), type: 'token_amount' },
    },
  };
};
