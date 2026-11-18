import { readFileSync } from 'node:fs';

import { type Output, type TransactionCommon, binToHex, createVirtualMachineBch2025, decodeTransactionBch, encodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { type ApplicationAction, type HeldToken, ActionRefusedError, readDeclaration } from '@grandmas-wallet/app';
import { type BuiltTransaction, type InputSpec, type Utxo, readTemplate } from '@grandmas-wallet/core';
import { describe, expect, it } from 'vitest';

import { type Device, deviceWith } from '../../../test/support/applications.js';
import {
  type LoanRequest,
  CHIPNET_FAST_PERIODS_6,
  borrow,
  borrowRequest,
  closeLoan,
  closeRequest,
  collateralAtRatio,
  createKeyRequest,
  createLoanKey,
  decodeLoanState,
  decodePriceState,
  manageLoan,
  manageRequest,
  minimumCollateral,
  movePeriodRequest,
  paryonChipnetDeclarationText,
  paryonChipnetTemplateText,
  paryonContracts,
  paryonTemplateTexts,
  repayRequest,
  updateBorrowingPeriod,
} from '../src/index.js';

/**
 * PY02 and PY03 on the simulated chain: a ParyonUSD loan carried out through this project's wallet from the
 * Paryon template, by the general route of stage 7, against Paryon's live chipnet outputs as they were
 * recorded (`fixtures/chipnet-live.json`). The page's part is `packages/paryon`'s requests; the wallet supplies
 * only its own parts and reads everything else from the chain. The simulated chain evaluates every input of
 * every transaction in the virtual machine before it takes it.
 *
 * Each transaction is compared with what the builders of step 1 make for the same choices: the same inputs, the
 * same outputs, the same unlocking of Paryon's contracts, and, where the wallet's own outputs are the builders'
 * too, the same bytes.
 */

const contracts = paryonContracts(CHIPNET_FAST_PERIODS_6);
const presented = paryonTemplateTexts(contracts);
const hex = binToHex;

interface RecordedOutput {
  transactionId: string;
  index: number;
  height: number;
  valueSatoshis: string;
  lockingBytecode: string;
  token?: { category: string; amount: string; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string } };
}
const recorded = JSON.parse(readFileSync(new URL('fixtures/chipnet-live.json', import.meta.url), 'utf8')) as Record<'borrowing' | 'price' | 'loanKeyFactory' | 'manage', RecordedOutput[]> & { tip: { height: number } };
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
const LOCK_HEIGHT = recorded.tip.height;

/** A request of the page's, as the wallet's session turns it into an action (`actionOf`). */
const asked = (request: LoanRequest): ApplicationAction => ({
  template: request.template,
  presented: presented.texts,
  action: request.templateAction,
  role: request.role,
  variables: request.variables,
  ...(request.bindings === undefined ? {} : { bindings: request.bindings }),
  ...(request.creates === undefined ? {} : { creates: request.creates }),
  ...(request.spends === undefined ? {} : { tokens: request.spends }),
  ...(request.inputs === undefined ? {} : { inputs: request.inputs }),
  application: 'the loan page',
});

/** A wallet with coins, on a simulated chain that holds Paryon's live outputs as recorded. */
const loanDevice = async (satoshis: bigint): Promise<Device> => {
  const device = await deviceWith([satoshis]);
  device.chain.adopt([...recorded.borrowing, ...recorded.price, ...recorded.loanKeyFactory, ...recorded.manage].map((entry) => ({ transactionId: entry.transactionId, index: entry.index, output: outputOf(entry) })));
  return device;
};

const decoded = async (device: Device, transactionId: string): Promise<TransactionCommon> => {
  const text = await device.chain.getTransaction(transactionId);
  const transaction = decodeTransactionBch(hexToBin(text ?? ''));
  if (typeof transaction === 'string') throw new Error(transaction);
  return transaction;
};
const spent = async (device: Device, transaction: TransactionCommon): Promise<Utxo[]> =>
  Promise.all(transaction.inputs.map(async (input) => ({ transactionHash: input.outpointTransactionHash, index: input.outpointIndex, output: (await decoded(device, hex(input.outpointTransactionHash))).outputs[input.outpointIndex] as Output })));
/** A coin of the wallet's in the transaction, unlocked as it was there: the builders put it in unchanged. */
const asSpent = (transaction: TransactionCommon, sources: Utxo[], index: number): InputSpec => ({ utxo: sources[index] as Utxo, unlock: () => transaction.inputs[index]?.unlockingBytecode as Uint8Array });
const vm2025 = createVirtualMachineBch2025(true);

/** The wallet's transaction is the builders' for the same choices: byte for byte. */
const sameAsBuilders = (transaction: TransactionCommon, expected: BuiltTransaction): void => {
  expect(hex(encodeTransactionBch(transaction))).toBe(hex(expected.encoded));
  expect(vm2025.verify({ transaction, sourceOutputs: expected.sourceOutputs })).toBe(true);
};

/** The course up to the open loan, through the wallet: a key, the Borrowing thread moved on, the loan. */
const openLoan = async (debt: bigint, collateral: bigint) => {
  const device = await loanDevice(collateral + 10_000_000n);
  const factory = utxoOf(first(recorded.loanKeyFactory));
  const made = await device.applications.carryOut(asked(createKeyRequest(presented, { factory })));
  const created = await decoded(device, made.transactionId);
  const keyCategory = hex(created.inputs[0]?.outpointTransactionHash as Uint8Array);
  const createdSources = await spent(device, created);
  const expectedKey = createLoanKey({ contracts, factory, defining: asSpent(created, createdSources, 0), changeTo: created.outputs[0]?.lockingBytecode as Uint8Array });
  const at = (transactionId: string, transaction: TransactionCommon, index: number): Utxo => ({ transactionHash: hexToBin(transactionId), index, output: transaction.outputs[index] as Output });

  const thread = utxoOf(first(recorded.borrowing));
  const movedOutcome = await device.applications.carryOut(asked(movePeriodRequest(presented, contracts, { borrowing: thread, lockHeight: LOCK_HEIGHT })));
  const moved = await decoded(device, movedOutcome.transactionId);
  const movedSources = await spent(device, moved);
  const expectedMove = updateBorrowingPeriod({ contracts, borrowing: thread, wallet: moved.inputs.slice(1).map((_, index) => asSpent(moved, movedSources, index + 1)), height: LOCK_HEIGHT, changeTo: moved.outputs[1]?.lockingBytecode as Uint8Array });

  const choice = { borrowing: at(movedOutcome.transactionId, moved, 0), price: utxoOf(PRICE), enforcer: at(made.transactionId, created, 2), proof: at(made.transactionId, created, 3), debt, collateral, startingInterest: 0 };
  const opened = await device.applications.carryOut(asked(borrowRequest(presented, choice)));
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
  return { device, keyCategory, made, created, expectedKey, moved, expectedMove, opened, borrowed, expectedBorrow, at };
};

const loanOf = async (device: Device, keyCategory: string): Promise<HeldToken> => {
  const token = (await device.applications.tokens()).find((held) => held.category === keyCategory && held.capability === 'minting');
  if (token === undefined) throw new Error('the wallet holds no loan key');
  return token;
};
const refused = async (device: Device, request: ApplicationAction, reason: RegExp): Promise<void> => {
  const before = device.chain.broadcasts;
  await expect(device.applications.preview(request)).rejects.toThrow(reason);
  await expect(device.applications.carryOut(request)).rejects.toBeInstanceOf(ActionRefusedError);
  expect(device.chain.broadcasts).toBe(before);
};

describe('the Paryon template', () => {
  it('PY02: is served as the text made from its source, passes the XO validator, holds no key, and has the identifier it was frozen with', () => {
    expect(paryonChipnetTemplateText).toBe(presented.template);
    expect(paryonChipnetDeclarationText).toBe(presented.declaration);
    const template = readTemplate(paryonChipnetTemplateText);
    expect(template.identifier).toBe('aeeaed2e63426a0e0a8fb5fd7db8744c7a880f1b5a6df4521170a701ef8bd8be');
    expect(paryonChipnetTemplateText).not.toContain('private_key');
    expect(readDeclaration(paryonChipnetDeclarationText).declaration.template).toEqual({ identifier: template.identifier, contentHash: template.contentHash });
  });

  it('PY02: the wallet finds no violation of the three rules in it, and says it is not verified until a loan key has led to its loan', async () => {
    const device = await loanDevice(1_000_000n);
    const summary = device.applications.describe(presented.names, presented.texts);
    expect(summary.verdict.statement).toBe('not verified');
    expect(summary.actions.map(({ action }) => action)).toEqual(['createKey', 'movePeriod', 'borrow', 'manage', 'repay', 'close']);
  });
});

describe('a ParyonUSD loan through the wallet, from the template (PY02)', () => {
  const DEBT = 200_00n;
  const COLLATERAL = collateralAtRatio(DEBT, STORED_PRICE, 125n);

  it('PY02: a key, the Borrowing thread moved on, a loan of 200 PUSD: each the builders\' transaction byte for byte; the key and the PUSD at the wallet\'s addresses', async () => {
    const { device, keyCategory, created, expectedKey, moved, expectedMove, borrowed, expectedBorrow, opened } = await openLoan(DEBT, COLLATERAL);
    sameAsBuilders(created, expectedKey.built);
    sameAsBuilders(moved, expectedMove.built);
    sameAsBuilders(borrowed, expectedBorrow.built);
    expect(opened.tokens.map(({ category, capability, amount }) => ({ category, capability, amount }))).toEqual([
      { category: keyCategory, capability: 'minting', amount: undefined },
      { category: hex(contracts.paryonCategory), capability: 'none', amount: String(DEBT) },
    ]);
    const loan = await loanOf(device, keyCategory);
    expect(loan).toMatchObject({ meaning: 'position', authority: 'loanKey', place: 'address', position: { status: 'open', satoshis: COLLATERAL } });
    expect(loan.position?.state).toEqual([
      { variable: 'debt', name: 'Debt', description: 'PUSD borrowed, in cents.', type: 'token_amount', value: String(DEBT) },
      { variable: 'collateral', name: 'Collateral', description: 'Satoshis the loan holds as collateral.', type: 'satoshis', value: String(COLLATERAL) },
    ]);
    expect(loan.actions?.map(({ action, asks, needsApplication }) => ({ action, asks: asks?.map(({ variable }) => variable), needs: needsApplication !== undefined }))).toEqual([
      { action: 'manage', asks: ['collateral'], needs: false },
      { action: 'repay', asks: ['collateral', 'repayAmount'], needs: true },
      { action: 'close', asks: undefined, needs: false },
    ]);
    expect(device.applications.describe(presented.names).verdict.statement).toBe('verified');
  });

  it('PY02: the wallet\'s own figures for the loan: what leaves the wallet, what goes into the loan, the fee to Paryon, the tokens it gets', async () => {
    const device = await loanDevice(COLLATERAL + 10_000_000n);
    const made = await device.applications.carryOut(asked(createKeyRequest(presented)));
    const created = await decoded(device, made.transactionId);
    const at = (index: number): Utxo => ({ transactionHash: hexToBin(made.transactionId), index, output: created.outputs[index] as Output });
    const preview = await device.applications.preview(asked(borrowRequest(presented, { borrowing: utxoOf(first(recorded.borrowing)), price: utxoOf(PRICE), enforcer: at(2), proof: at(3), debt: DEBT, collateral: COLLATERAL, startingInterest: 0 })));
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
  });

  it('PY02: collateral added, 100 PUSD repaid, the rest repaid and the loan closed: each the builders\' transaction; the key back where it was until the closing', async () => {
    const { device, keyCategory, borrowed, opened, at } = await openLoan(DEBT, COLLATERAL);
    // Add collateral: the page names nothing but the amount; the wallet finds Paryon's price and manage coins itself.
    const managedOutcome = await device.applications.carryOut(asked(manageRequest(presented, { keyCategory, collateral: COLLATERAL + 100_000n })));
    const managed = await decoded(device, managedOutcome.transactionId);
    const managedSources = await spent(device, managed);
    expect(hex(managed.outputs[4]?.lockingBytecode as Uint8Array)).toBe(hex(borrowed.outputs[5]?.lockingBytecode as Uint8Array));
    const expectedManage = manageLoan({
      contracts,
      price: managedSources[0] as Utxo,
      loan: at(opened.transactionId, borrowed, 2),
      sidecar: at(opened.transactionId, borrowed, 3),
      manageFunction: managedSources[3] as Utxo,
      key: asSpent(managed, managedSources, 4),
      wallet: managed.inputs.slice(5).map((_, index) => asSpent(managed, managedSources, index + 5)),
      repay: 0n,
      collateral: COLLATERAL + 100_000n,
      changeTo: managed.outputs[5]?.lockingBytecode as Uint8Array,
    });
    sameAsBuilders(managed, expectedManage.built);

    // Repay 100 PUSD: the page works out the loan's new record.
    const loanCoin = at(managedOutcome.transactionId, managed, 1);
    const repaidOutcome = await device.applications.carryOut(asked(repayRequest(presented, { keyCategory, loan: loanCoin, repay: 100_00n, collateral: loanCoin.output.valueSatoshis })));
    const repaid = await decoded(device, repaidOutcome.transactionId);
    const repaidSources = await spent(device, repaid);
    expect(decodeLoanState(repaid.outputs[1]?.token?.nft?.commitment as Uint8Array).borrowed).toBe(100_00n);
    // The repaid PUSD go to a data output; the rest comes back to a fresh address of the wallet.
    expect(repaid.outputs[5]).toMatchObject({ lockingBytecode: Uint8Array.of(0x6a), valueSatoshis: 0n, token: { amount: 100_00n } });
    expect(repaid.outputs[6]?.token?.amount).toBe(100_00n);
    const expectedRepay = manageLoan({
      contracts,
      price: repaidSources[0] as Utxo,
      loan: loanCoin,
      sidecar: at(managedOutcome.transactionId, managed, 2),
      manageFunction: repaidSources[3] as Utxo,
      key: asSpent(repaid, repaidSources, 4),
      wallet: repaid.inputs.slice(5).map((_, index) => asSpent(repaid, repaidSources, index + 5)),
      repay: 100_00n,
      collateral: loanCoin.output.valueSatoshis,
      tokensChangeTo: repaid.outputs[6]?.lockingBytecode as Uint8Array,
      changeTo: repaid.outputs[7]?.lockingBytecode as Uint8Array,
    });
    // The builders give the PUSD left over 1,000 satoshis; the wallet gives it the least an output of its kind may hold.
    expect(repaid.outputs.length).toBe(expectedRepay.built.transaction.outputs.length);
    for (const index of [0, 1, 2, 3, 4, 5]) expect(hex(encodeTransactionBch({ ...repaid, inputs: [], outputs: [repaid.outputs[index] as Output] }))).toBe(hex(encodeTransactionBch({ ...repaid, inputs: [], outputs: [expectedRepay.built.transaction.outputs[index] as Output] })));
    for (const index of [0, 1, 2, 3]) expect(hex(repaid.inputs[index]?.unlockingBytecode as Uint8Array)).toBe(hex(expectedRepay.built.transaction.inputs[index]?.unlockingBytecode as Uint8Array));

    // Close: every value from the chain.
    const closedOutcome = await device.applications.carryOut(asked(closeRequest(presented, { keyCategory })));
    const closed = await decoded(device, closedOutcome.transactionId);
    const closedSources = await spent(device, closed);
    const expectedClose = closeLoan({
      contracts,
      price: closedSources[0] as Utxo,
      loan: at(repaidOutcome.transactionId, repaid, 1),
      sidecar: at(repaidOutcome.transactionId, repaid, 2),
      manageFunction: closedSources[3] as Utxo,
      key: asSpent(closed, closedSources, 4),
      wallet: closed.inputs.slice(5).map((_, index) => asSpent(closed, closedSources, index + 5)),
      keyTo: closed.outputs[4]?.lockingBytecode as Uint8Array,
      changeTo: closed.outputs.at(-1)?.lockingBytecode as Uint8Array,
    });
    sameAsBuilders(closed, expectedClose.built);
    const after = await loanOf(device, keyCategory);
    expect(after.position?.status).toBe('closed');
    expect((await device.applications.tokens()).some((token) => token.category === hex(contracts.paryonCategory))).toBe(false);
  });

  it('PY02: refused before anything is sent: too little collateral, a tampered value, the key not returned, a coin of the page\'s that is not Paryon\'s', async () => {
    const device = await loanDevice(COLLATERAL + 10_000_000n);
    const made = await device.applications.carryOut(asked(createKeyRequest(presented)));
    const created = await decoded(device, made.transactionId);
    const at = (index: number): Utxo => ({ transactionHash: hexToBin(made.transactionId), index, output: created.outputs[index] as Output });
    const choice = { borrowing: utxoOf(first(recorded.borrowing)), price: utxoOf(PRICE), enforcer: at(2), proof: at(3), debt: DEBT, startingInterest: 0 };
    // One satoshi below what the contract takes at the stored price.
    await refused(device, asked(borrowRequest(presented, { ...choice, collateral: minimumCollateral(DEBT, STORED_PRICE) - 1n })), /contract, "Paryon's borrowing contract" at input 0, does not accept/);
    // The loan's record says another debt than is borrowed.
    const honest = borrowRequest(presented, { ...choice, collateral: COLLATERAL });
    const tampered = { ...honest, variables: { ...honest.variables, loanCommitment: hex(Uint8Array.of(0x01, 0x10, ...hexToBin(String(honest.variables['loanCommitment'])).slice(2))) } };
    await refused(device, asked(tampered), /does not accept the transaction the wallet worked out/);
    await refused(device, asked({ ...honest, variables: { ...honest.variables, borrowingFee: '1000' } }), /does not accept/);
    // A page that names one of Paryon's coins for an input where the declaration expects another contract.
    await refused(device, asked({ ...honest, inputs: { ...honest.inputs, priceInput: `${first(recorded.manage).transactionId}:${first(recorded.manage).index}` } }), /is not unspent at the script the template gives it/);
    // The page's address for the key is not used; the wallet puts its own there.
    const own = await device.applications.preview(asked({ ...honest, variables: { ...honest.variables, keyHolder: '76a914' + '11'.repeat(20) + '88ac' } }));
    expect(own.figures.toWallet[0]?.kind).toBe('receive');

    await device.applications.carryOut(asked(honest));
    const keyCategory = hex(created.inputs[0]?.outpointTransactionHash as Uint8Array);
    // Managing sends the key back to where it was: a page that asks for it at a fresh address is refused.
    await refused(device, asked({ ...manageRequest(presented, { keyCategory, collateral: COLLATERAL }), bindings: { keyHolder: 'receive' } }), /disagree about the wallet's output "keyHolder"/);
    // Taking out so much collateral that the loan falls below 110%: Paryon's manage function refuses it.
    await refused(device, asked(manageRequest(presented, { keyCategory, collateral: minimumCollateral(DEBT, STORED_PRICE) - 1n })), /"Paryon's manage function" at input 3, does not accept/);
  });
});

describe('a live loan through the loss of the device (PY03)', { timeout: 120_000 }, () => {
  const DEBT = 100_00n;
  const COLLATERAL = collateralAtRatio(DEBT, STORED_PRICE, 125n);

  const recovered = async () => {
    const { device, keyCategory, opened, borrowed } = await openLoan(DEBT, COLLATERAL);
    // The device is lost. The recoverer requests, waits and completes; a new device takes over.
    await device.recover();
    const taken = await device.takeOver();
    await taken.wallet.search();
    const swept = await taken.wallet.sweepEarlier();
    return { device, taken, swept, keyCategory, opened, borrowed };
  };

  it('PY03: the new device sweeps the loan key and the PUSD, and finds the loan from the key with the template from the backup and the chain alone', async () => {
    const { taken, swept, keyCategory } = await recovered();
    expect(swept.coins).toBeGreaterThanOrEqual(2);
    // Before reading the backup the key is a token of unknown meaning; it was swept all the same.
    expect((await taken.applications.tokens()).find((token) => token.category === keyCategory)?.meaning).toBe('unknown');
    expect(await taken.applications.readBackup()).toEqual({ suggested: 1, notes: 1 });
    const [suggested] = taken.applications.suggestions;
    expect(suggested?.identifier).toBe(presented.names.identifier);
    await taken.applications.trust(suggested as never, undefined);
    const loan = await loanOf(taken, keyCategory);
    expect(loan).toMatchObject({ meaning: 'position', place: 'address', authority: 'loanKey', position: { status: 'open', satoshis: COLLATERAL } });
    expect(loan.position?.state?.map(({ variable, value }) => [variable, value])).toEqual([['debt', String(DEBT)], ['collateral', String(COLLATERAL)]]);
  });

  it('PY03: look-alike sidecars are not taken for the loan', async () => {
    const { taken, keyCategory, opened, borrowed } = await recovered();
    await taken.applications.readBackup();
    await taken.applications.trust(first(taken.applications.suggestions), undefined);
    const lookAlike = (lockingBytecode: Uint8Array, token?: Output['token']): Output => ({ lockingBytecode, valueSatoshis: 1000n, ...(token === undefined ? {} : { token }) });
    const sidecar = { lockingBytecode: contracts.loanSidecar.lockingBytecode, valueSatoshis: 1000n, token: { category: hexToBin(keyCategory), amount: 0n, nft: { capability: 'none' as const, commitment: Uint8Array.of(0x01) } } };
    taken.chain.adopt([
      // Beside an output that is not at the Loan script.
      { transactionId: 'a1'.repeat(32), index: 0, output: lookAlike(Uint8Array.of(0x51)) },
      { transactionId: 'a1'.repeat(32), index: 1, output: sidecar },
      // Beside an output at the Loan script that carries no loan of Paryon's.
      { transactionId: 'a2'.repeat(32), index: 0, output: lookAlike(contracts.loan.lockingBytecode, { category: hexToBin(keyCategory), amount: 0n, nft: { capability: 'mutable', commitment: borrowed.outputs[2]?.token?.nft?.commitment as Uint8Array } }) },
      { transactionId: 'a2'.repeat(32), index: 1, output: sidecar },
    ]);
    const loan = await loanOf(taken, keyCategory);
    expect(loan.position).toMatchObject({ status: 'open', satoshis: COLLATERAL });
    expect(loan.position?.lockingBytecode).toBe(hex(contracts.loan.lockingBytecode));
    void opened;
  });

  it('PY03: from its own list of tokens, the new device adds collateral (the key back at its new address) and closes the loan, with Paryon\'s site not consulted', async () => {
    const { taken, keyCategory } = await recovered();
    await taken.applications.readBackup();
    await taken.applications.trust(first(taken.applications.suggestions), undefined);
    const loan = await loanOf(taken, keyCategory);
    const keyAt = (await taken.wallet.balance()).tokens.find((coin) => hex(coin.utxo.output.token?.category ?? new Uint8Array()) === keyCategory)?.utxo.output.lockingBytecode as Uint8Array;
    // The sweep needs the controller at input 0 and Paryon's manage needs the price there: the key was swept in a transaction of its own first.
    const added = await taken.applications.carryOut(taken.applications.actionOn(loan, 'manage', { collateral: String(COLLATERAL + 50_000n) }));
    const managed = await decoded(taken, added.transactionId);
    expect(hex(managed.outputs[4]?.lockingBytecode as Uint8Array)).toBe(hex(keyAt));
    expect(managed.outputs[1]?.valueSatoshis).toBe(COLLATERAL + 50_000n);
    // A repayment that leaves the loan open is offered through the application only.
    const after = await loanOf(taken, keyCategory);
    expect(after.actions?.find(({ action }) => action === 'repay')?.needsApplication).toMatch(/Loan record/);
    const preview = await taken.applications.preview(taken.applications.actionOn(after, 'close'));
    expect(preview.figures.tokensDestroyed.map(({ name, how, wallet }) => [name, how, wallet])).toEqual([
      ['PUSD repaid', 'data output', true],
      ['The loan\'s record', 'data output', false],
      ['The loan\'s sidecar', 'not carried on', false],
    ]);
    expect(preview.figures.tokensNet).toEqual([{ category: hex(contracts.paryonCategory), amount: -DEBT }]);
    expect(preview.figures.intoApplicationSatoshis).toBeLessThan(-COLLATERAL);
    const closed = await taken.applications.carryOut(taken.applications.actionOn(after, 'close'));
    expect(closed.tokens.map(({ category, capability }) => [category, capability])).toEqual([[keyCategory, 'minting']]);
    expect((await loanOf(taken, keyCategory)).position?.status).toBe('closed');
  });
});
