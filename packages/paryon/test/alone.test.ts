import { readFileSync } from 'node:fs';

import { type Output, type TransactionCommon, binToHex, createVirtualMachineBch2025, decodeTransactionBch, encodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { type ApplicationAction, ActionRefusedError, NeedsApplicationError, TickNeededError, reportedFromRecord } from '@grandmas-wallet/app';
import { type BuiltTransaction, type InputSpec, type Utxo } from '@grandmas-wallet/core';
import { describe, expect, it } from 'vitest';

import { type Device, deviceWith, finishCopying } from '../../../test/support/applications.js';
import {
  type LoanRequestAlone,
  type ParyonChain,
  type ParyonDeployment,
  CHIPNET_FAST_PERIODS_6,
  MAINNET_V1,
  borrow,
  borrowRequestAloneV2,
  changeInterestRate,
  changeInterestRequestAloneV2,
  closeLoan,
  closeRequestAloneV2,
  collateralAtRatio,
  createKeyRequestAloneV2,
  createLoanKey,
  decodeBorrowingPeriod,
  decodeLoanState,
  decodePriceState,
  findLoan,
  interestCoins,
  loanCoins,
  manageLoan,
  manageRequestAloneV2,
  minimumCollateral,
  movePeriodRequestAloneV2,
  paryonChipnetTemplateTextV2,
  paryonChipnetTemplateTextV1,
  paryonMainnetTemplateTextV2,
  paryonMainnetTemplateTextV1,
  paryonContracts,
  periodAt,
  periodStart,
  paryonTemplateAlone,
  repayRequestAloneV2,
} from '../src/index.js';

/**
 * PR20 on the simulated chain: a ParyonUSD loan through this project's wallet with no recovery declaration
 * (proposal section 15.3). The wallet is sent the Paryon template alone; every request is what the loan's page
 * sends in version 2 of `xo_v1` (`page-requests.ts`), naming each of Paryon's coins by outpoint and giving the
 * values it read from them. It runs for each of Paryon's own deployments, chipnet's and mainnet's, whose live outputs
 * are as they were recorded (`fixtures/chipnet-live.json`, `fixtures/mainnet-live.json`);
 * the simulated chain evaluates every input of every transaction in the virtual machine before it takes it.
 *
 * Each transaction is compared with what the builders of step 1 make for the same choices, byte for byte.
 */

interface RecordedOutput {
  transactionId: string;
  index: number;
  valueSatoshis: string;
  lockingBytecode: string;
  token?: { category: string; amount: string; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string } };
}
const runOn = (deployment: ParyonDeployment): void => {
const contracts = paryonContracts(deployment);
const alone = paryonTemplateAlone(contracts, 2);
const hex = binToHex;
const PAGE = 'https://loan.example/';

const recorded = JSON.parse(readFileSync(new URL(`fixtures/${deployment.network}-live.json`, import.meta.url), 'utf8')) as Record<'borrowing' | 'price' | 'loanKeyFactory' | 'manage' | 'changeInterest', RecordedOutput[]> & { tip: { height: number } };
/** Paryon's shared outputs as recorded, on the simulated chain. */
const sharedOutputs = (): RecordedOutput[] => [...recorded.borrowing, ...recorded.price, ...recorded.loanKeyFactory, ...recorded.manage, ...recorded.changeInterest];
const outputOf = (entry: RecordedOutput): Output => ({
  lockingBytecode: hexToBin(entry.lockingBytecode),
  valueSatoshis: BigInt(entry.valueSatoshis),
  ...(entry.token === undefined
    ? {}
    : { token: { category: hexToBin(entry.token.category), amount: BigInt(entry.token.amount), ...(entry.token.nft === undefined ? {} : { nft: { capability: entry.token.nft.capability, commitment: hexToBin(entry.token.nft.commitment) } }) } }),
});
const utxoOf = (entry: RecordedOutput): Utxo => ({ transactionHash: hexToBin(entry.transactionId), index: entry.index, output: outputOf(entry) });
const first = <T>(items: T[]): T => {
  const [item] = items;
  if (item === undefined) throw new Error('none');
  return item;
};
const PRICE = first(recorded.price.slice().sort((a, b) => Number(decodePriceState(hexToBin(b.token?.nft?.commitment ?? '')).price - decodePriceState(hexToBin(a.token?.nft?.commitment ?? '')).price)));
const STORED_PRICE = decodePriceState(hexToBin(PRICE.token?.nft?.commitment ?? '')).price;
// The tip's height, or where every Borrowing thread is already in the tip's period (as on mainnet), the first height
// of the next period, so that a thread is moved on.
const tipPeriod = periodAt(deployment, recorded.tip.height);
const LOCK_HEIGHT = recorded.borrowing.some((entry) => decodeBorrowingPeriod(hexToBin(entry.token?.nft?.commitment ?? '')) < tipPeriod) ? recorded.tip.height : periodStart(deployment, tipPeriod + 1);

/** A request of the page's, as the wallet's session turns it into an action (`actionOf`). */
const asked = (request: LoanRequestAlone, texts: { template: string } = alone.texts): ApplicationAction => ({
  template: request.template,
  presented: texts,
  action: request.templateAction,
  role: request.role,
  variables: request.variables,
  ...(request.bindings === undefined ? {} : { bindings: request.bindings }),
  ...(request.creates === undefined ? {} : { creates: request.creates }),
  ...(request.about === undefined ? {} : { about: request.about }),
  ...(request.inputs === undefined ? {} : { inputs: request.inputs }),
  ...(request.page === undefined ? {} : { page: request.page }),
  application: 'the loan page',
});
/** The user's tick in the wallet, for a token made from the wallet's coin that goes into Paryon's contract. */
const TICKED = { tokensLeave: true };

/** A wallet with coins, on a simulated chain that holds Paryon's live outputs as recorded. */
const loanDevice = async (satoshis: bigint): Promise<Device> => {
  const device = await deviceWith([satoshis]);
  device.chain.adopt(sharedOutputs().map((entry) => ({ transactionId: entry.transactionId, index: entry.index, output: outputOf(entry) })));
  return device;
};
/** The chain as the page reads it: the simulated chain lists a token's category only, so the page reads each output itself. */
const pageChain = (device: Device): ParyonChain => ({
  getTransaction: (transactionId) => device.chain.getTransaction(transactionId),
  listUnspent: async (lockingBytecode) => (await device.chain.listUnspent(lockingBytecode)).map(({ token: _token, ...rest }) => rest),
});
const decoded = async (device: Device, transactionId: string): Promise<TransactionCommon> => {
  const transaction = decodeTransactionBch(hexToBin((await device.chain.getTransaction(transactionId)) ?? ''));
  if (typeof transaction === 'string') throw new Error(transaction);
  return transaction;
};
const spent = async (device: Device, transaction: TransactionCommon): Promise<Utxo[]> =>
  Promise.all(transaction.inputs.map(async (input) => ({ transactionHash: input.outpointTransactionHash, index: input.outpointIndex, output: (await decoded(device, hex(input.outpointTransactionHash))).outputs[input.outpointIndex] as Output })));
const asSpent = (transaction: TransactionCommon, sources: Utxo[], index: number): InputSpec => ({ utxo: sources[index] as Utxo, unlock: () => transaction.inputs[index]?.unlockingBytecode as Uint8Array });
const at = (transactionId: string, transaction: TransactionCommon, index: number): Utxo => ({ transactionHash: hexToBin(transactionId), index, output: transaction.outputs[index] as Output });
const vm2025 = createVirtualMachineBch2025(true);
const sameAsBuilders = (transaction: TransactionCommon, expected: BuiltTransaction): void => {
  expect(hex(encodeTransactionBch(transaction))).toBe(hex(expected.encoded));
  expect(vm2025.verify({ transaction, sourceOutputs: expected.sourceOutputs })).toBe(true);
};
/** What the wallet answers the page about the loan key, from its records (version 2). */
const reportedKey = async (device: Device, keyCategory: string) => {
  const positions = (await device.applications.positionsFromRecords(alone.names.identifier, 'the loan page')) ?? [];
  return positions.map(reportedFromRecord).find((position) => position.category === keyCategory);
};
/** What the page reads before an action on the loan: the loan and its sidecar from the key, and Paryon's shared coins. */
const coinsOf = async (device: Device, keyCategory: string) => {
  const reported = await reportedKey(device, keyCategory);
  if (reported === undefined) throw new Error('the wallet does not report the key');
  const found = await loanCoins(pageChain(device), contracts, hexToBin(keyCategory), BigInt(reported.satoshis));
  if (found === undefined) throw new Error('the page finds no loan for the key');
  return { keyCategory, keySatoshis: found.keySatoshis, loan: found.loan, sidecar: found.sidecar, price: found.price, manageFunction: found.manageFunction, page: PAGE };
};

/** The course up to the open loan, from the page's requests: a key (with the user's tick), the Borrowing thread moved on, the loan. */
const openLoan = async (debt: bigint, collateral: bigint, template: ReturnType<typeof paryonTemplateAlone> = alone) => {
  const asked_ = (request: LoanRequestAlone): ApplicationAction => asked(request, template.texts);
  const device = await loanDevice(collateral + 10_000_000n);
  const factory = utxoOf(first(recorded.loanKeyFactory));
  const makeKey = asked_(createKeyRequestAloneV2(template.names, { factory, page: PAGE }));
  const made = await device.applications.carryOut(makeKey, undefined, TICKED);
  const created = await decoded(device, made.transactionId);
  const keyCategory = hex(created.inputs[0]?.outpointTransactionHash as Uint8Array);
  const expectedKey = createLoanKey({ contracts, factory, defining: asSpent(created, await spent(device, created), 0), changeTo: created.outputs[0]?.lockingBytecode as Uint8Array });

  const thread = utxoOf(first(recorded.borrowing));
  const moving = asked_(movePeriodRequestAloneV2(template.names, contracts, { borrowing: thread, lockHeight: LOCK_HEIGHT, page: PAGE }));
  // The Borrowing contract's minting NFT goes on with the new period in its commitment: carried on, not destroyed.
  expect((await device.applications.preview(moving)).figures.tokensDestroyed).toEqual([]);
  const movedOutcome = await device.applications.carryOut(moving);
  const moved = await decoded(device, movedOutcome.transactionId);

  const choice = { borrowing: at(movedOutcome.transactionId, moved, 0), price: utxoOf(PRICE), enforcer: at(made.transactionId, created, 2), proof: at(made.transactionId, created, 3), debt, collateral, startingInterest: 0 };
  const opened = await device.applications.carryOut(asked_(borrowRequestAloneV2(template.names, { ...choice, page: PAGE })));
  const borrowed = await decoded(device, opened.transactionId);
  const borrowedSources = await spent(device, borrowed);
  const expectedBorrow = borrow({
    contracts,
    ...choice,
    wallet: borrowed.inputs.slice(4).map((_, index) => asSpent(borrowed, borrowedSources, index + 4)),
    keyTo: borrowed.outputs[5]?.lockingBytecode as Uint8Array,
    tokensTo: borrowed.outputs[6]?.lockingBytecode as Uint8Array,
    changeTo: borrowed.outputs[7]?.lockingBytecode as Uint8Array,
  });
  return { device, keyCategory, made, created, expectedKey, opened, borrowed, expectedBorrow, makeKey };
};

describe('a ParyonUSD loan from the template alone (PR20)', () => {
  const DEBT = 200_00n;
  const COLLATERAL = collateralAtRatio(DEBT, STORED_PRICE, 125n);

  it('PY02: the template sent is the frozen one of version 2, alone; it holds no key', () => {
    const frozen = deployment === MAINNET_V1 ? paryonMainnetTemplateTextV2 : paryonChipnetTemplateTextV2;
    expect(alone.texts).toEqual({ template: frozen });
    expect(alone.names.identifier).toBe(deployment === MAINNET_V1 ? '30647ea4b817c4e58b32fb4fc104643af9c1e92295729b33d5551dc875569364' : '3fa4baf9f313ee2a5046ae30fdf1f7affc6aca21a29e3f6b38227b4a826e9235');
    expect(frozen).not.toContain('private_key');
  });

  it('PY02: a wallet without a coin that can define the key pays itself first, and the key is made with what is left over at output 0', async () => {
    const device = await deviceWith([10_000_000n], { outputIndex: 1 });
    device.chain.adopt(sharedOutputs().map((entry) => ({ transactionId: entry.transactionId, index: entry.index, output: outputOf(entry) })));
    const request = asked(createKeyRequestAloneV2(alone.names, { factory: utxoOf(first(recorded.loanKeyFactory)), page: PAGE }));
    const preview = await device.applications.preview(request);
    expect(preview.figures.payingItself?.feeSatoshis).toBeGreaterThan(0n);
    const made = await device.applications.carryOut(request, undefined, TICKED);
    const created = await decoded(device, made.transactionId);
    // Output 0 is the wallet's: Paryon's contract leaves that place to whoever makes the key.
    expect(created.outputs[0]?.token).toBeUndefined();
    expect(created.outputs).toHaveLength(4);
  });

  it('PY02: the wallet\'s own figures for the borrowing: what leaves the wallet, what goes into the loan, the fee to Paryon, the tokens it gets', async () => {
    const device = await loanDevice(COLLATERAL + 10_000_000n);
    const made = await device.applications.carryOut(asked(createKeyRequestAloneV2(alone.names, { factory: utxoOf(first(recorded.loanKeyFactory)), page: PAGE })), undefined, TICKED);
    const created = await decoded(device, made.transactionId);
    const preview = await device.applications.preview(asked(borrowRequestAloneV2(alone.names, { borrowing: utxoOf(first(recorded.borrowing)), price: utxoOf(PRICE), enforcer: at(made.transactionId, created, 2), proof: at(made.transactionId, created, 3), debt: DEBT, collateral: COLLATERAL, startingInterest: 0, page: PAGE })));
    expect(preview.words.action.name).toBe('Borrow PUSD');
    expect(preview.figures.applicationInputs.map(({ name }) => name)).toEqual(['Paryon\'s borrowing contract', 'Paryon\'s price contract', 'The new loan key', 'The loan key\'s proof of origin']);
    expect(preview.figures.toOthers.map(({ name }) => name)).toEqual(['Paryon\'s borrowing contract', 'Paryon\'s price contract', 'The loan', 'The loan\'s sidecar', 'Borrowing fee']);
    expect(preview.figures.toWallet.map(({ kind, token }) => [kind, token?.nft?.capability ?? (token === undefined ? 'none' : 'tokens')])).toEqual([['receive', 'minting'], ['receive', 'tokens'], ['left over', 'none']]);
    expect(preview.figures.tokensNet).toEqual([{ category: hex(contracts.paryonCategory), amount: DEBT }]);
    // The collateral and the fee go into the application. Of the 4,000 satoshis of Paryon's coins the transaction
    // spends, 3,000 stay with Paryon's coins and the key's 1,000 come to the wallet.
    const fee = preview.figures.toOthers.find(({ name }) => name === 'Borrowing fee')?.satoshis ?? 0n;
    expect(preview.figures.intoApplicationSatoshis).toBe(COLLATERAL + fee - 1_000n);
    expect(preview.figures.tokensDestroyed).toEqual([{ name: 'The loan key\'s proof of origin', token: { category: hex(contracts.loanKeyFactoryCategory), amount: 0n, nft: { capability: 'none', commitment: '' } }, how: 'not carried on', wallet: false }]);
    expect(preview.recordsPosition).toBe(true);
  });

  it('PY02: a borrowing refused before anything is sent: too little collateral, a tampered value, a coin of Paryon\'s named for another input; an address the page gives for the key is not used', async () => {
    const device = await loanDevice(COLLATERAL + 10_000_000n);
    const made = await device.applications.carryOut(asked(createKeyRequestAloneV2(alone.names, { factory: utxoOf(first(recorded.loanKeyFactory)), page: PAGE })), undefined, TICKED);
    const created = await decoded(device, made.transactionId);
    const choice = { borrowing: utxoOf(first(recorded.borrowing)), price: utxoOf(PRICE), enforcer: at(made.transactionId, created, 2), proof: at(made.transactionId, created, 3), debt: DEBT, startingInterest: 0, page: PAGE };
    const refused = async (request: ApplicationAction, reason: RegExp): Promise<void> => {
      const before = device.chain.broadcasts;
      await expect(device.applications.preview(request)).rejects.toThrow(reason);
      await expect(device.applications.carryOut(request)).rejects.toBeInstanceOf(ActionRefusedError);
      expect(device.chain.broadcasts).toBe(before);
    };
    // One satoshi below what the contract takes at the stored price.
    await refused(asked(borrowRequestAloneV2(alone.names, { ...choice, collateral: minimumCollateral(DEBT, STORED_PRICE) - 1n })), /contract, "Paryon's borrowing contract" at input 0, does not accept/);
    // The loan's record says another debt than is borrowed; the fee is too small.
    const honest = borrowRequestAloneV2(alone.names, { ...choice, collateral: COLLATERAL });
    const tampered = { ...honest, variables: { ...honest.variables, loanCommitment: hex(Uint8Array.of(0x01, 0x10, ...hexToBin(String(honest.variables['loanCommitment'])).slice(2))) } };
    await refused(asked(tampered), /does not accept the transaction the wallet worked out/);
    await refused(asked({ ...honest, variables: { ...honest.variables, borrowingFee: '1000' } }), /does not accept/);
    // Paryon's manage function, named where the price contract is spent: its own contract refuses the transaction.
    await refused(asked({ ...honest, inputs: { ...honest.inputs, priceInput: `${first(recorded.manage).transactionId}:${first(recorded.manage).index}` } }), /does not accept/);
    // The page's address for the key is not used: the request names a kind, and the wallet puts its own there.
    const own = await device.applications.preview(asked({ ...honest, variables: { ...honest.variables, keyHolder: '76a914' + '11'.repeat(20) + '88ac' } }));
    expect(own.figures.toWallet[0]?.kind).toBe('receive');
    expect(own.figures.toOthers.map(({ lockingBytecode }) => lockingBytecode)).not.toContain('76a914' + '11'.repeat(20) + '88ac');
  });

  it('a key made with the user\'s tick, the Borrowing thread moved on, a loan of 200 PUSD: each from the page\'s requests, each the builders\' transaction byte for byte; one record, written when the key arrives', async () => {
    const device = await loanDevice(COLLATERAL + 10_000_000n);
    const factory = utxoOf(first(recorded.loanKeyFactory));
    const makeKey = asked(createKeyRequestAloneV2(alone.names, { factory, page: PAGE }));
    // Making the key leaves it, a token made from the wallet's coin, in Paryon's contract: shown, and refused without the tick.
    const preview = await device.applications.preview(makeKey);
    expect(preview.template).not.toHaveProperty('declaration');
    expect(preview.tokensLeaving).toEqual([{ token: expect.objectContaining({ capability: 'minting', commitment: '' }) as object, how: 'leaves', made: true, to: 'The new loan key, waiting' }]);
    expect(preview.recordsPosition).toBeUndefined();
    const before = device.chain.broadcasts;
    await expect(device.applications.carryOut(makeKey)).rejects.toBeInstanceOf(TickNeededError);
    expect(device.chain.broadcasts).toBe(before);
    // The course, in a wallet of its own: the test ticks for the key, as the user would in the wallet.
    const { keyCategory, created, expectedKey, opened, borrowed, expectedBorrow } = await openLoan(DEBT, COLLATERAL);
    sameAsBuilders(created, expectedKey.built);
    sameAsBuilders(borrowed, expectedBorrow.built);
    expect(opened.tokens.map(({ category, capability, amount }) => ({ category, capability, amount }))).toEqual([
      { category: keyCategory, capability: 'minting', amount: undefined },
      { category: hex(contracts.paryonCategory), capability: 'none', amount: String(DEBT) },
    ]);
  });

  it('the record names the key and the template, no script, and the page; the wallet answers the page that it holds the key, with what its coin holds, and no word on the loan', async () => {
    const { device, keyCategory } = await openLoan(DEBT, COLLATERAL);
    const [record] = device.applications.positionRecords;
    expect(device.applications.positionRecords).toHaveLength(1);
    expect(record).toMatchObject({ kind: 'position', token: { category: keyCategory, commitment: '', capability: 'minting' }, templateIdentifier: alone.names.identifier, applicationPage: PAGE });
    expect(record).not.toHaveProperty('lockingScriptIdentifier');
    // The values of the borrowing, without an address of the wallet's.
    expect(Object.keys(record?.values ?? {}).sort()).toEqual(['borrowingCommitment', 'borrowingFee', 'borrowingSupply', 'collateral', 'debt', 'interestManagerConfiguration', 'keyCategory', 'loanCommitment', 'priceCommitment', 'startingInterest']);
    expect(await reportedKey(device, keyCategory)).toEqual({ category: keyCategory, commitment: '', capability: 'minting', satoshis: '1000', status: 'held' });
    // The page finds the loan from the key, as the declaration used to tell the wallet.
    const found = await findLoan(pageChain(device), contracts, hexToBin(keyCategory));
    expect(found?.state.borrowed).toBe(DEBT);
    expect(found?.loan.output.valueSatoshis).toBe(COLLATERAL);
  });

  it('takes one of the manage function\'s coins as told, not always the first, so that two users\' actions seldom spend the same one', async () => {
    const { device, keyCategory } = await openLoan(DEBT, COLLATERAL);
    const listed = recorded.manage.map((entry) => `${entry.transactionId}:${entry.index}`).sort();
    expect(listed.length).toBeGreaterThan(1);
    const taken = async (pick: (count: number) => number): Promise<string> => {
      const found = await loanCoins(pageChain(device), contracts, hexToBin(keyCategory), 1_000n, undefined, pick);
      return `${hex(found?.manageFunction.transactionHash as Uint8Array)}:${found?.manageFunction.index}`;
    };
    expect(await taken(() => 0)).toBe(listed[0]);
    expect(await taken((count) => count - 1)).toBe(listed[listed.length - 1]);
    // Out of range is held to the list.
    expect(await taken(() => 99)).toBe(listed[listed.length - 1]);
  });

  it('collateral added, 100 PUSD repaid, the rest repaid and the loan closed, each from the page\'s requests; the key back where it was until the closing', async () => {
    const { device, keyCategory, borrowed } = await openLoan(DEBT, COLLATERAL);
    // Add collateral: the page names the loan, its sidecar, the price and the manage function, and the key's coin value.
    const manage = manageRequestAloneV2(alone.names, { ...(await coinsOf(device, keyCategory)), collateral: COLLATERAL + 100_000n });
    // The key's category is said once, as what the action is about: the wallet takes the value from there.
    expect(manage).toMatchObject({ about: { category: keyCategory, spent: true }, bindings: { keyHolder: 'return' }, page: PAGE, variables: { keySatoshis: '1000' } });
    expect(manage.variables).not.toHaveProperty('keyCategory');
    const managing = await device.applications.preview(asked(manage));
    expect(managing.tokensLeaving).toBeUndefined();
    expect(managing.figures.toWallet.map(({ kind }) => kind)).toEqual(['return', 'left over']);
    const managedOutcome = await device.applications.carryOut(asked(manage));
    const managed = await decoded(device, managedOutcome.transactionId);
    const managedSources = await spent(device, managed);
    expect(hex(managed.outputs[4]?.lockingBytecode as Uint8Array)).toBe(hex(borrowed.outputs[5]?.lockingBytecode as Uint8Array));
    const coins = await coinsOf(device, keyCategory);
    sameAsBuilders(
      managed,
      manageLoan({
        contracts,
        price: managedSources[0] as Utxo,
        loan: managedSources[1] as Utxo,
        sidecar: managedSources[2] as Utxo,
        manageFunction: managedSources[3] as Utxo,
        key: asSpent(managed, managedSources, 4),
        wallet: managed.inputs.slice(5).map((_, index) => asSpent(managed, managedSources, index + 5)),
        repay: 0n,
        collateral: COLLATERAL + 100_000n,
        changeTo: managed.outputs[5]?.lockingBytecode as Uint8Array,
      }).built,
    );
    expect(coins.loan.output.valueSatoshis).toBe(COLLATERAL + 100_000n);

    // Repay 100 PUSD: the page works out the loan's new record.
    const repaidOutcome = await device.applications.carryOut(asked(repayRequestAloneV2(alone.names, { ...coins, repay: 100_00n, collateral: coins.loan.output.valueSatoshis })));
    const repaid = await decoded(device, repaidOutcome.transactionId);
    expect(decodeLoanState(repaid.outputs[1]?.token?.nft?.commitment as Uint8Array).borrowed).toBe(100_00n);
    expect(repaid.outputs[5]).toMatchObject({ lockingBytecode: Uint8Array.of(0x6a), valueSatoshis: 0n, token: { amount: 100_00n } });
    expect(hex(repaid.outputs[4]?.lockingBytecode as Uint8Array)).toBe(hex(borrowed.outputs[5]?.lockingBytecode as Uint8Array));

    // Close: everything the page read from the chain.
    const closing = await coinsOf(device, keyCategory);
    const closedOutcome = await device.applications.carryOut(asked(closeRequestAloneV2(alone.names, closing)));
    const closed = await decoded(device, closedOutcome.transactionId);
    const closedSources = await spent(device, closed);
    sameAsBuilders(
      closed,
      closeLoan({
        contracts,
        price: closedSources[0] as Utxo,
        loan: closing.loan,
        sidecar: closing.sidecar,
        manageFunction: closedSources[3] as Utxo,
        key: asSpent(closed, closedSources, 4),
        wallet: closed.inputs.slice(5).map((_, index) => asSpent(closed, closedSources, index + 5)),
        keyTo: closed.outputs[4]?.lockingBytecode as Uint8Array,
        changeTo: closed.outputs.at(-1)?.lockingBytecode as Uint8Array,
      }).built,
    );
    expect(closedOutcome.tokens.map(({ category, capability }) => [category, capability])).toEqual([[keyCategory, 'minting']]);
    expect(await findLoan(pageChain(device), contracts, hexToBin(keyCategory))).toBeUndefined();
    // The wallet still holds the key, under the template; whether the loan is open is the page's to say.
    expect((await reportedKey(device, keyCategory))?.status).toBe('held');
    expect((await device.wallet.balance()).tokens.some((coin) => hex(coin.utxo.output.token?.category ?? new Uint8Array()) === hex(contracts.paryonCategory))).toBe(false);
  });

  it('the interest rate changed from the page\'s request, the builders\' transaction byte for byte: the loan key at input 3 and back where it was; the loan then repaid in part and closed', async () => {
    const { device, keyCategory, borrowed } = await openLoan(DEBT, COLLATERAL);
    const reported = await reportedKey(device, keyCategory);
    const found = await interestCoins(pageChain(device), contracts, hexToBin(keyCategory), BigInt(reported?.satoshis ?? 0));
    if (found === undefined) throw new Error('the page finds no loan for the key');
    const request = changeInterestRequestAloneV2(alone.names, { keyCategory, keySatoshis: found.keySatoshis, loan: found.loan, sidecar: found.sidecar, interestFunction: found.interestFunction, rate: 100, page: PAGE });
    expect(request).toMatchObject({ templateAction: 'changeInterest', about: { category: keyCategory, spent: true }, bindings: { keyHolder: 'return' }, page: PAGE, variables: { nextInterestRate: '6400', keySatoshis: '1000', collateral: String(COLLATERAL) } });
    expect(Object.keys(request.inputs ?? {})).toEqual(['loanInput', 'sidecarInput', 'changeInterestInput']);
    const preview = await device.applications.preview(asked(request));
    expect(preview.words.action.name).toBe('Change the interest rate');
    expect(preview.figures.applicationInputs.map(({ name }) => name)).toEqual(['The loan', 'The loan\'s sidecar', 'Paryon\'s interest function']);
    expect(preview.figures.toWallet.map(({ kind }) => kind)).toEqual(['return', 'left over']);
    expect(preview.figures.tokensDestroyed).toEqual([]);
    expect(preview.tokensLeaving).toBeUndefined();
    const outcome = await device.applications.carryOut(asked(request));
    const changed = await decoded(device, outcome.transactionId);
    const sources = await spent(device, changed);
    sameAsBuilders(
      changed,
      changeInterestRate({
        contracts,
        loan: sources[0] as Utxo,
        sidecar: sources[1] as Utxo,
        interestFunction: sources[2] as Utxo,
        key: asSpent(changed, sources, 3),
        wallet: changed.inputs.slice(4).map((_, index) => asSpent(changed, sources, index + 4)),
        rate: 100,
        changeTo: changed.outputs[4]?.lockingBytecode as Uint8Array,
      }).built,
    );
    expect(hex(changed.outputs[3]?.lockingBytecode as Uint8Array)).toBe(hex(borrowed.outputs[5]?.lockingBytecode as Uint8Array));
    expect(decodeLoanState(changed.outputs[0]?.token?.nft?.commitment as Uint8Array)).toMatchObject({ borrowed: DEBT, currentInterestRate: 0, nextInterestRate: 100 });
    expect((await reportedKey(device, keyCategory))?.status).toBe('held');
    // A rate the contracts do not take is refused by the page's library before anything is asked.
    expect(() => changeInterestRequestAloneV2(alone.names, { keyCategory, keySatoshis: 1_000n, loan: found.loan, sidecar: found.sidecar, interestFunction: found.interestFunction, rate: 40_000 })).toThrow(/from 0 to 32767/);

    // The loan with its new rate, repaid in part and closed from the page's requests.
    const coins = await coinsOf(device, keyCategory);
    const repaid = await device.applications.carryOut(asked(repayRequestAloneV2(alone.names, { ...coins, repay: 100_00n, collateral: coins.loan.output.valueSatoshis })));
    expect(decodeLoanState((await decoded(device, repaid.transactionId)).outputs[1]?.token?.nft?.commitment as Uint8Array)).toMatchObject({ borrowed: 100_00n, nextInterestRate: 100 });
    await device.applications.carryOut(asked(closeRequestAloneV2(alone.names, await coinsOf(device, keyCategory))));
    expect(await findLoan(pageChain(device), contracts, hexToBin(keyCategory))).toBeUndefined();
  });

  it('a loan opened with version 1: the wallet reports its key only under version 1, so a page that sends version 2 neither lists it nor names it; a request about the key under version 2 is carried out once the user trusts version 2', async () => {
    const v1 = paryonTemplateAlone(contracts, 1);
    expect(v1.texts.template).toBe(deployment === MAINNET_V1 ? paryonMainnetTemplateTextV1 : paryonChipnetTemplateTextV1);
    const { device, keyCategory } = await openLoan(DEBT, COLLATERAL, v1);
    expect(device.applications.positionRecords.map(({ templateIdentifier }) => templateIdentifier)).toEqual([v1.names.identifier]);
    // The page of version 2 asks which keys of its template the wallet holds: not trusted, nothing.
    expect(await device.applications.positionsFromRecords(alone.names.identifier, 'the loan page')).toBeUndefined();
    // The page offers version 2 and the user trusts it: still no key, since the record names version 1.
    await device.applications.trust({ identifier: alone.names.identifier, contentHash: alone.names.contentHash }, alone.texts, 'the loan page');
    expect(await device.applications.positionsFromRecords(alone.names.identifier, 'the loan page')).toEqual([]);
    expect((await device.applications.positionsFromRecords(v1.names.identifier, 'the loan page'))?.map(({ token }) => token.category)).toEqual([keyCategory]);
    // Asked about the key under version 2 all the same (the page would need the key's coin value from elsewhere), the
    // wallet carries the action out: it takes the key by its category, and every value from the request.
    const found = await interestCoins(pageChain(device), contracts, hexToBin(keyCategory), 1_000n);
    if (found === undefined) throw new Error('no loan');
    const changed = await device.applications.carryOut(asked(changeInterestRequestAloneV2(alone.names, { keyCategory, keySatoshis: 1_000n, loan: found.loan, sidecar: found.sidecar, interestFunction: found.interestFunction, rate: 50, page: PAGE })));
    expect(decodeLoanState((await decoded(device, changed.transactionId)).outputs[0]?.token?.nft?.commitment as Uint8Array).nextInterestRate).toBe(50);
    expect(device.applications.positionRecords.map(({ templateIdentifier }) => templateIdentifier)).toEqual([v1.names.identifier]);
    expect(await device.applications.positionsFromRecords(alone.names.identifier, 'the loan page')).toEqual([]);
  });

  it('refused before anything is sent: a look-alike sidecar, a request about no key that names none, the key not returned, too much collateral taken out, a coin at no script of the template', async () => {
    const { device, keyCategory } = await openLoan(DEBT, COLLATERAL);
    const coins = await coinsOf(device, keyCategory);
    const refused = async (request: ApplicationAction, reason: RegExp): Promise<void> => {
      const before = device.chain.broadcasts;
      await expect(device.applications.preview(request)).rejects.toThrow(reason);
      await expect(device.applications.carryOut(request)).rejects.toBeInstanceOf(ActionRefusedError);
      expect(device.chain.broadcasts).toBe(before);
    };
    // A coin at the sidecar's script with an NFT of the key's category, that someone holding the key could make.
    const lookAlike = { transactionId: 'a1'.repeat(32), index: 1, output: { lockingBytecode: contracts.loanSidecar.lockingBytecode, valueSatoshis: 1000n, token: { category: hexToBin(keyCategory), amount: 0n, nft: { capability: 'none' as const, commitment: Uint8Array.of(0x01) } } } };
    device.chain.adopt([lookAlike]);
    const manage = manageRequestAloneV2(alone.names, { ...coins, collateral: COLLATERAL + 1_000n });
    await refused(asked({ ...manage, inputs: { ...manage.inputs, sidecarInput: `${lookAlike.transactionId}:1` } }), /The application's own contract, .* does not accept the transaction the wallet worked out/);
    // A request that says neither which key the action is about nor the key's category: the output that carries the
    // key names a category no input of the template names, so the wallet would make a new one, and Paryon's price
    // contract holds the place such a coin has to take.
    const { about: _about, ...aboutNothing } = manage;
    await refused(asked({ ...aboutNothing, bindings: { keyHolder: 'receive' } }), /input 0, where the coin that defines a new token category has to be/);
    // Managing sends the key back to where it was: a request that asks for it at a fresh address is refused by Paryon's contract.
    await refused(asked({ ...manage, bindings: { keyHolder: 'receive' } }), /does not accept/);
    // Taking out so much collateral that the loan falls below 110%: Paryon's manage function refuses it.
    await refused(asked(manageRequestAloneV2(alone.names, { ...coins, collateral: minimumCollateral(DEBT, STORED_PRICE) - 1n })), /"Paryon's manage function" at input 3, does not accept/);
    // A coin of the wallet's own, named as Paryon's price.
    const own = first(await device.wallet.parts.ownCoins()).utxo;
    await refused(asked({ ...manage, inputs: { ...manage.inputs, priceInput: `${hex(own.transactionHash)}:${own.index}` } }), /is at no script of the template/);
  });
});

describe('a ParyonUSD loan through the loss of the device, from the page alone (PR20)', { timeout: 120_000 }, () => {
  const DEBT = 100_00n;
  const COLLATERAL = collateralAtRatio(DEBT, STORED_PRICE, 125n);

  const recovered = async () => {
    const { device, keyCategory } = await openLoan(DEBT, COLLATERAL);
    // A collateral added before the device is lost.
    await device.applications.carryOut(asked(manageRequestAloneV2(alone.names, { ...(await coinsOf(device, keyCategory)), collateral: COLLATERAL + 50_000n })));
    await device.recover();
    const taken = await device.takeOver();
    await taken.wallet.search();
    await taken.wallet.sweepEarlier();
    await finishCopying(taken);
    await taken.applications.readBackup();
    for (const suggested of taken.applications.suggestions) await taken.applications.trust(suggested, undefined);
    await taken.applications.confirmRecords();
    return { device, taken, keyCategory };
  };

  it('the new device holds the swept key under the template, from the earlier seed\'s record; the wallet by itself sends the user to the page', async () => {
    const { taken, keyCategory } = await recovered();
    const positions = await taken.applications.recordedPositions();
    expect(positions.map(({ token, status, standing, template, record }) => ({ category: token.category, place: token.place, status, standing, template: template.identifier, page: record.applicationPage }))).toEqual([
      { category: keyCategory, place: 'address', status: 'held', standing: 'own', template: alone.names.identifier, page: PAGE },
    ]);
    const [position] = positions;
    if (position === undefined) throw new Error('no position');
    // A record that names no script offers nothing the wallet could do by itself: the loan is the page's to operate.
    expect(taken.applications.offeredActions(position)).toEqual([]);
    const error = await taken.applications.carryOut(taken.applications.actionOn(position, 'close')).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(NeedsApplicationError);
    expect((error as NeedsApplicationError).page).toBe(PAGE);
  });

  it('the page, on the new device, is told of the key once the user allows it, finds the loan, and closes it: the collateral comes back to the new seed', async () => {
    const { taken, keyCategory } = await recovered();
    // The template came from the backup: the page is answered once the user allows it.
    expect(await taken.applications.positionsFromRecords(alone.names.identifier, 'the loan page')).toBeUndefined();
    taken.applications.allow(alone.names.identifier, 'the loan page');
    const reported = await reportedKey(taken, keyCategory);
    expect(reported).toMatchObject({ category: keyCategory, capability: 'minting', status: 'held' });
    const coins = await coinsOf(taken, keyCategory);
    expect(coins.loan.output.valueSatoshis).toBe(COLLATERAL + 50_000n);
    const balance = (await taken.wallet.balance()).recoverable;
    const closing = asked(closeRequestAloneV2(alone.names, coins));
    const preview = await taken.applications.preview(closing);
    expect(preview.notConfirmed).toBeUndefined();
    expect(preview.tokensLeaving).toBeUndefined();
    expect(preview.figures.tokensDestroyed.map(({ name, how, wallet }) => [name, how, wallet])).toEqual([
      ['PUSD repaid', 'data output', true],
      ['The loan\'s record', 'data output', false],
      ['The loan\'s sidecar', 'not carried on', false],
    ]);
    expect(preview.figures.tokensNet).toEqual([{ category: hex(contracts.paryonCategory), amount: -DEBT }]);
    const closed = await taken.applications.carryOut(closing);
    expect(closed.tokens.map(({ category, capability }) => [category, capability])).toEqual([[keyCategory, 'minting']]);
    expect((await taken.wallet.balance()).recoverable - balance).toBeGreaterThan(COLLATERAL);
    expect(await findLoan(pageChain(taken), contracts, hexToBin(keyCategory))).toBeUndefined();
  });
});
};

for (const deployment of [CHIPNET_FAST_PERIODS_6, MAINNET_V1]) describe(deployment.name, () => runOn(deployment));
