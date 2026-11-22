import { type Output, binToHex, createCompilerBch, createVirtualMachineBch2025, hexToBin } from '@bitauth/libauth';
import {
  type BuiltTransaction,
  type InputSpec,
  type ReadTemplate,
  type TemplateValues,
  type Utxo,
  buildTransaction,
  checkBeforeSending,
  keyPairFromPrivateKey,
  p2pkhInput,
  p2pkhLockingBytecode,
  readTemplate,
  templateOutput,
  templateTransaction,
  templateUnlockingBytecode,
  typedValues,
} from '@grandmas-wallet/core';
import { buildCompilerBytecodeDataFromCompilationVariables, mergeTemplateConstantsWithInvitationVariables } from '@xo-cash/engine';
import { describe, expect, it } from 'vitest';

import {
  type ParyonAction,
  type ParyonDeployment,
  type ServiceRefusal,
  type ServiceShare,
  CHIPNET_FAST_PERIODS_6,
  MAINNET_V1,
  NO_INTEREST_MANAGER,
  PARYON_ADDRESSES,
  PARYON_SERVICE_SPLIT,
  borrow,
  borrowerShare,
  changeInterestRate,
  closeLoan,
  collateralAtRatio,
  createLoanKey,
  decodeBorrowingPeriod,
  decodeLoanState,
  decodePriceState,
  encodeInterestManagerConfiguration,
  encodeInterestRate,
  finalLockHeight,
  manageLoan,
  minimumCollateral,
  outputsOfRole,
  paryonAddressesAt,
  paryonChipnetTemplateTextV2,
  paryonChipnetTemplateTextV3,
  paryonContracts,
  paryonMainnetTemplateTextV3,
  paryonService,
  paryonTemplateAlone,
  periodAt,
  periodStart,
  possibleActions,
  serviceAddress,
  serviceShare,
  updateBorrowingPeriod,
} from '../src/index.js';
import { FixtureChain, recordedDeployment, recordedOutputs } from './fixture-chain.js';

/**
 * Version 3 of the loan template, in which Paryon's service takes part in every action as a second participant, and the
 * service's share as library code (`service.ts`). For each of Paryon's own deployments, every action's transaction is
 * put together from the borrower's share and the service's share against the deployment's live outputs as they were
 * recorded, checked in the virtual machine, and compared byte for byte with what the plain builders make for the same
 * coins. Nothing is sent anywhere.
 */

interface TemplateParts {
  roles: Record<string, { name: string; description: string }>;
  resources?: { name: string; description: string; url: string }[];
  start: { action: string; role: string }[];
  actions: Record<string, { transaction: string; roles: Record<string, { requirements: { variables: string[] } }>; requirements: { participants: { role: string; slots: { min: number; max: number } }[] } }>;
  transactions: Record<string, { inputs: { input: string; inputIndex: number }[]; outputs: { output: string; outputIndex: number }[]; locktime: number | string }>;
  inputs: Record<string, { unlockingScript: string }>;
  outputs: Record<string, { lockingScript: string; valueSatoshis: string; token?: { category: string; amount: string | null; nft: { capability: string; commitment: string } | null } }>;
  lockingScripts: Record<string, { roles: Record<string, { selectable: boolean; relevant: boolean; actions?: { action: string; role: string }[] }> }>;
  scripts: Record<string, string>;
  constants: Record<string, { type: string; value: string }>;
  variables: Record<string, { type: string }>;
  version: string;
}
const parts = (text: string): TemplateParts => JSON.parse(text) as TemplateParts;
const ACTIONS: ParyonAction[] = ['createKey', 'movePeriod', 'borrow', 'manage', 'repay', 'close', 'changeInterest'];

/** The variables an action's transaction needs: those its outputs, its inputs' unlocking scripts and its lock time name. */
const neededVariables = (template: TemplateParts, action: string): string[] => {
  const transaction = template.transactions[template.actions[action]?.transaction ?? ''];
  if (transaction === undefined) throw new Error(`no transaction for ${action}`);
  const texts: string[] = [String(transaction.locktime)];
  for (const { output } of transaction.outputs) {
    const definition = template.outputs[output];
    texts.push(definition?.lockingScript ?? '', definition?.valueSatoshis ?? '', definition?.token?.category ?? '', definition?.token?.amount ?? '', definition?.token?.nft?.commitment ?? '');
  }
  for (const { input } of transaction.inputs) texts.push(template.scripts[template.inputs[input]?.unlockingScript ?? ''] ?? '');
  const named = texts.flatMap((text) => [...text.matchAll(/<([A-Za-z_][A-Za-z0-9_]*)>/g)].map((match) => match[1] as string));
  return [...new Set(named)].filter((name) => template.constants[name] === undefined && template.scripts[name] === undefined).sort();
};

describe('version 3 of the template', () => {
  for (const [deployment, text] of [[CHIPNET_FAST_PERIODS_6, paryonChipnetTemplateTextV3], [MAINNET_V1, paryonMainnetTemplateTextV3]] as const) {
    const template = parts(text);

    it(`${deployment.name}: is made from the same source, with the service's and the page's addresses`, () => {
      const made = paryonTemplateAlone(paryonContracts(deployment), 3, PARYON_ADDRESSES);
      expect(made.texts.template).toBe(text);
      expect(template.version).toBe('3');
      expect(template.roles).toEqual({
        borrower: { name: 'Borrower', description: 'Holds the loan key, and opens, manages and closes the loan.' },
        service: { name: 'Service', description: 'Supplies Paryon\'s prices, records and shared coins for each action.' },
      });
      expect(template.resources?.map(({ name, url }) => ({ name, url }))).toEqual([
        { name: 'xo_service_v1', url: 'https://paryon.9500.cash/service/v1' },
        { name: 'Loan page', url: 'https://paryon.9500.cash/' },
      ]);
      expect(serviceAddress(readTemplate(text).definition)).toBe('https://paryon.9500.cash/service/v1');
      expect(paryonAddressesAt(PARYON_ADDRESSES.page)).toEqual(PARYON_ADDRESSES);
      expect(paryonAddressesAt('http://localhost:8104/')).toEqual({ service: 'http://localhost:8104/service/v1', page: 'http://localhost:8104/' });
      // Another deployment, on a chain of one's own, names the addresses it is given.
      const local = parts(paryonTemplateAlone(paryonContracts(deployment), 3, { service: 'http://127.0.0.1:9/service/v1', page: 'http://127.0.0.1:9/' }).texts.template);
      expect(local.resources?.map(({ url }) => url)).toEqual(['http://127.0.0.1:9/service/v1', 'http://127.0.0.1:9/']);
      expect(() => paryonTemplateAlone(paryonContracts(deployment), 3, undefined as never)).toThrow(/addresses/);
    });

    it(`${deployment.name}: every action needs one borrower and one service; each variable an action needs belongs to exactly one of the two`, () => {
      for (const action of ACTIONS) {
        const definition = template.actions[action];
        expect(definition?.requirements.participants).toEqual([{ role: 'borrower', slots: { min: 1, max: 1 } }, { role: 'service', slots: { min: 1, max: 1 } }]);
        const borrower = definition?.roles['borrower']?.requirements.variables ?? [];
        const service = definition?.roles['service']?.requirements.variables ?? [];
        expect(borrower).toEqual([...PARYON_SERVICE_SPLIT[action].borrower]);
        expect(service).toEqual([...PARYON_SERVICE_SPLIT[action].service]);
        expect(borrower.filter((name) => service.includes(name))).toEqual([]);
        expect([...borrower, ...service].sort()).toEqual(neededVariables(template, action));
        for (const name of [...borrower, ...service]) expect(template.variables[name]).toBeDefined();
      }
      // The outputs: the borrower adds those that go to its own scripts, the service all the others.
      const read = readTemplate(text).definition;
      expect(Object.fromEntries(ACTIONS.map((action) => [action, outputsOfRole(read, action, 'borrower')]))).toEqual({
        createKey: [],
        movePeriod: [],
        borrow: ['keyOutput', 'tokensOutput'],
        manage: ['keyBackOutput'],
        repay: ['keyBackOutput'],
        close: ['keyBackOutput'],
        changeInterest: ['keyBackOutput'],
      });
    });

    it(`${deployment.name}: every one of Paryon's scripts declares the service as a role that tracks nothing there; the borrower's follow-up actions are those of version 2`, () => {
      const v2 = parts(paryonChipnetTemplateTextV2);
      expect(Object.keys(template.lockingScripts)).toEqual(Object.keys(v2.lockingScripts));
      for (const [name, script] of Object.entries(template.lockingScripts)) {
        expect(script.roles['service']).toEqual({ selectable: false, relevant: false });
        expect(script.roles['borrower']).toEqual(v2.lockingScripts[name]?.roles['borrower']);
      }
      expect(template.start).toEqual(v2.start);
    });

    it(`${deployment.name}: the interest rates are whole numbers; the interest manager is "none", fixed in the scripts`, () => {
      expect(template.variables['startingRate']?.type).toBe('integer');
      expect(template.variables['interestRate']?.type).toBe('integer');
      for (const gone of ['startingInterest', 'nextInterestRate', 'interestManagerConfiguration']) expect(template.variables[gone]).toBeUndefined();
      expect(template.constants['interestManagerConfiguration']).toBeUndefined();
      const none = binToHex(encodeInterestManagerConfiguration(NO_INTEREST_MANAGER));
      expect(none).toBe('000000ff7f');
      for (const script of ['unlockBorrow', 'unlockManage', 'unlockRepay']) expect(template.scripts[script]).toContain(`<0x${none}>`);
      expect(template.scripts['unlockChangeInterest']).toBe('<$(<interestRate> <2> OP_NUM2BIN)>');
    });
  }

  describe('the interest rate, a whole number, gives exactly the two bytes the contracts take', () => {
    const contracts = paryonContracts(CHIPNET_FAST_PERIODS_6);
    const definition = readTemplate(paryonChipnetTemplateTextV3).definition;
    /** The unlocking as the XO engine compiles a script: its compiler set up with the template's variables, its values as committed. */
    const asTheEngine = (lockingScript: string, input: string, variables: { variableIdentifier: string; value: number }[]): Uint8Array => {
      const script = definition.lockingScripts?.[lockingScript]?.lockingBytecode as string;
      const unlocking = definition.inputs?.[input]?.unlockingScript as string;
      const compiler = createCompilerBch({
        scripts: definition.scripts as Record<string, string>,
        variables: Object.fromEntries(Object.entries(definition.variables ?? {}).map(([name, variable]) => [name, { ...(variable as object), type: 'WalletData' }])),
        lockingScriptTypes: { [script]: 'p2sh32' },
        unlockingScripts: { [unlocking]: script },
      } as Parameters<typeof createCompilerBch>[0]);
      const bytecode = buildCompilerBytecodeDataFromCompilationVariables(definition, mergeTemplateConstantsWithInvitationVariables(definition, variables as never));
      const result = compiler.generateBytecode({ scriptId: unlocking, data: { bytecode } });
      if (!result.success) throw new Error(JSON.stringify((result as { errors?: unknown }).errors));
      return result.bytecode;
    };
    for (const rate of [0, 1, 255, 256, 32_767]) {
      it(`rate ${rate}: ${binToHex(encodeInterestRate(rate))}`, () => {
        const changing = contracts.changeInterest.unlock('changeInterest', encodeInterestRate(rate));
        expect(binToHex(templateUnlockingBytecode(definition, 'changeInterestContract', 'changeInterestInput', { interestRate: BigInt(rate) }))).toBe(binToHex(changing));
        expect(binToHex(asTheEngine('changeInterestContract', 'changeInterestInput', [{ variableIdentifier: 'interestRate', value: rate }]))).toBe(binToHex(changing));
        const borrowing = contracts.borrowing.unlock('borrow', encodeInterestRate(rate), encodeInterestManagerConfiguration(NO_INTEREST_MANAGER));
        expect(binToHex(templateUnlockingBytecode(definition, 'borrowingContract', 'borrowingInput', { startingRate: BigInt(rate) }))).toBe(binToHex(borrowing));
        expect(binToHex(asTheEngine('borrowingContract', 'borrowingInput', [{ variableIdentifier: 'startingRate', value: rate }]))).toBe(binToHex(borrowing));
      });
    }
    it('a rate above 32,767 cannot be made into two bytes, and the unlocking is not made', () => {
      expect(() => templateUnlockingBytecode(definition, 'changeInterestContract', 'changeInterestInput', { interestRate: 32_768n })).toThrow();
    });
  });
});

// ------------------------------------------------------------------------------------- the shares, on each deployment

const hex = binToHex;
const outpoint = (utxo: Utxo): string => `${hex(utxo.transactionHash)}:${utxo.index}`;
const vm2025 = createVirtualMachineBch2025(true);
/** Every input passes, under both rule sets, and the fee is exact. */
const accepted = (built: BuiltTransaction): void => {
  expect(checkBeforeSending(built)).toBe(true);
  expect(vm2025.verify({ transaction: built.transaction, sourceOutputs: built.sourceOutputs })).toBe(true);
};
const shared = (result: ServiceShare | ServiceRefusal): ServiceShare => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result;
};
const refusal = (result: ServiceShare | ServiceRefusal): ServiceRefusal => {
  if (result.ok) throw new Error('not refused');
  return result;
};

/**
 * An action's transaction put together from the two shares, as the engine merges them: the template's inputs and
 * outputs at the template's indexes, from the shares' values; the service's coins with its unlocking; the wallet's coins
 * and outputs in the places left, in order. The fee is exact; what is left goes to `remainder`.
 */
const assemble = (
  template: ReadTemplate,
  action: ParyonAction,
  borrower: Record<string, string>,
  service: ServiceShare,
  wallet: InputSpec[],
  walletOutputs: Output[],
  remainder: number,
  allowTokenBurn = false,
): BuiltTransaction => {
  const definition = template.definition;
  const values: TemplateValues = typedValues(definition, { ...borrower, ...service.variables });
  const transaction = templateTransaction(definition, action, values);
  // Every template output is added by one of the two, never both.
  expect([...outputsOfRole(definition, action, 'borrower'), ...service.outputs].sort()).toEqual(transaction.outputs.map(({ output }) => output).sort());
  const inputs: (InputSpec | undefined)[] = Array.from({ length: transaction.inputs.length + wallet.length });
  for (const { input, index } of transaction.inputs) {
    const added = service.inputs.find(({ inputIdentifier }) => inputIdentifier === input);
    if (added === undefined || index === undefined) throw new Error(`the service gives no ${input}`);
    inputs[index] = { utxo: added.coin, sequence: added.sequenceNumber, unlock: () => added.unlockingBytecode };
  }
  const own = [...wallet];
  const outputs: (Output | undefined)[] = Array.from({ length: transaction.outputs.length + walletOutputs.length });
  for (const { output, index } of transaction.outputs) outputs[index as number] = templateOutput(definition, output, values);
  const extra = [...walletOutputs];
  return buildTransaction({
    inputs: inputs.map((input) => input ?? (own.shift() as InputSpec)),
    outputs: outputs.map((output) => output ?? (extra.shift() as Output)),
    remainderOutputIndex: remainder,
    locktime: transaction.locktime,
    allowTokenBurn,
  });
};

const runOn = (deployment: ParyonDeployment, text: string): void => {
  const contracts = paryonContracts(deployment);
  const service = paryonService(contracts, text);
  const template = service.template;
  const recorded = recordedDeployment(deployment.network);
  const all = recordedOutputs(recorded);
  const STORED_PRICE = recorded.price.map((entry) => decodePriceState(hexToBin(entry.token?.nft?.commitment ?? '')).price).reduce((a, b) => (a > b ? a : b));
  // The tip as recorded; where every Borrowing thread is in the tip's period already (as on mainnet), a height in the
  // next period, so that there is something to bring up to date.
  const tipPeriod = periodAt(deployment, finalLockHeight(deployment.network, recorded.tip.height));
  const behind = recorded.borrowing.some((entry) => decodeBorrowingPeriod(hexToBin(entry.token?.nft?.commitment ?? '')) < tipPeriod);
  const TIP = behind ? recorded.tip.height : periodStart(deployment, tipPeriod + 1) + 1;

  const key = keyPairFromPrivateKey(Uint8Array.from({ length: 32 }, () => 7));
  const WALLET = p2pkhLockingBytecode(key.keyHash);
  const WALLET_HEX = hex(WALLET);
  let coins = 0;
  /** A coin of the wallet's, output 0 of a transaction of its own. */
  const walletCoin = (chain: FixtureChain, satoshis: bigint): Utxo => {
    coins += 1;
    const utxo = { transactionHash: hexToBin(coins.toString(16).padStart(2, '0').repeat(32)), index: 0, output: { lockingBytecode: WALLET, valueSatoshis: satoshis } };
    chain.adopt(utxo);
    return utxo;
  };
  const change = (): Output => ({ lockingBytecode: WALLET, valueSatoshis: 0n });
  const at = (built: BuiltTransaction, index: number): Utxo => ({ transactionHash: built.transactionHash, index, output: built.transaction.outputs[index] as Output });
  const coinOf = (share: ServiceShare, input: string): Utxo => share.inputs.find(({ inputIdentifier }) => inputIdentifier === input)?.coin as Utxo;
  const first = { pick: () => 0 };

  const DEBT = 200_00n;
  const COLLATERAL = collateralAtRatio(DEBT, STORED_PRICE, 125n);

  /** The whole course, each action from the two shares, each the plain builders' transaction byte for byte. */
  const course = async () => {
    const chain = new FixtureChain(all, TIP);
    const steps: Record<string, unknown> = {};

    // Make a key: the wallet's coin defines its category; the service adds Paryon's factory.
    const defining = walletCoin(chain, COLLATERAL + 10_000_000n);
    const keyCategory = hex(defining.transactionHash);
    const nothing = await possibleActions(service, {}, chain);
    const createKeyBorrower = borrowerShare('createKey', { keyCategory });
    const createKeyService = shared(await serviceShare(service, 'createKey', { variables: createKeyBorrower, inputs: [outpoint(defining)] }, chain, first));
    expect(createKeyService.variables).toEqual({});
    expect(createKeyService.inputs.map(({ inputIdentifier, lockingScript, sequenceNumber }) => [inputIdentifier, lockingScript, sequenceNumber])).toEqual([['factoryInput', 'loanKeyFactoryContract', 0]]);
    const created = assemble(template, 'createKey', createKeyBorrower, createKeyService, [p2pkhInput(defining, key)], [change()], 0);
    expect(hex(created.encoded)).toBe(hex(createLoanKey({ contracts, factory: coinOf(createKeyService, 'factoryInput'), defining: p2pkhInput(defining, key), changeTo: WALLET }).built.encoded));
    accepted(created);
    chain.add(created);
    const waitingKey = await possibleActions(service, { made: [{ category: keyCategory, transactionId: created.transactionId }] }, chain);

    // Bring Paryon up to date: the service chooses the thread and the lock height.
    const fee1 = walletCoin(chain, 1_000_000n);
    const movePeriodService = shared(await serviceShare(service, 'movePeriod', { variables: {} }, chain));
    const lockHeight = Number(movePeriodService.variables['lockHeight']);
    const moved = assemble(template, 'movePeriod', {}, movePeriodService, [p2pkhInput(fee1, key)], [change()], 1);
    expect(hex(moved.encoded)).toBe(hex(updateBorrowingPeriod({ contracts, borrowing: coinOf(movePeriodService, 'periodBorrowingInput'), wallet: [p2pkhInput(fee1, key)], height: lockHeight, changeTo: WALLET }).built.encoded));
    accepted(moved);
    chain.add(moved);

    // Borrow, at a starting rate of 256.
    const funding = walletCoin(chain, COLLATERAL + 10_000_000n);
    const borrowBorrower = borrowerShare('borrow', { keyCategory, debt: DEBT, collateral: COLLATERAL, rate: 256, keyHolder: WALLET_HEX, tokensHolder: WALLET_HEX });
    const borrowService = shared(await serviceShare(service, 'borrow', { variables: borrowBorrower }, chain));
    expect(Object.keys(borrowService.variables)).toEqual(['borrowingSupply', 'borrowingCommitment', 'priceCommitment', 'loanCommitment', 'borrowingFee']);
    // The Borrowing thread just moved on, the waiting key and its proof.
    expect(outpoint(coinOf(borrowService, 'borrowingInput'))).toBe(`${moved.transactionId}:0`);
    expect([outpoint(coinOf(borrowService, 'enforcerInput')), outpoint(coinOf(borrowService, 'proofInput'))]).toEqual([`${created.transactionId}:2`, `${created.transactionId}:3`]);
    const opened = assemble(template, 'borrow', borrowBorrower, borrowService, [p2pkhInput(funding, key)], [change()], 7, true);
    const plainBorrow = borrow({
      contracts,
      borrowing: coinOf(borrowService, 'borrowingInput'),
      price: coinOf(borrowService, 'priceInput'),
      enforcer: coinOf(borrowService, 'enforcerInput'),
      proof: coinOf(borrowService, 'proofInput'),
      wallet: [p2pkhInput(funding, key)],
      debt: DEBT,
      collateral: COLLATERAL,
      startingInterest: 256,
      keyTo: WALLET,
      tokensTo: WALLET,
      changeTo: WALLET,
    });
    expect(hex(opened.encoded)).toBe(hex(plainBorrow.built.encoded));
    accepted(opened);
    chain.add(opened);
    const keyUsed = refusal(await serviceShare(service, 'borrow', { variables: borrowBorrower }, chain));
    expect(decodeLoanState(at(opened, 2).output.token?.nft?.commitment as Uint8Array)).toMatchObject({ borrowed: DEBT, currentInterestRate: 256, nextInterestRate: 256, interestManager: NO_INTEREST_MANAGER });
    const keyCoin0 = at(opened, 5);
    const tokens = at(opened, 6);
    const openLoan = await possibleActions(service, { tokens: [{ category: keyCategory, commitment: '', capability: 'minting', outpoint: outpoint(keyCoin0) }, { category: hex(contracts.paryonCategory), commitment: '', capability: 'none', outpoint: outpoint(tokens) }] }, chain);

    // Add collateral: the wallet's key coin is read from the chain for what it holds.
    const fee2 = walletCoin(chain, 1_000_000n);
    const manageBorrower = borrowerShare('manage', { keyCategory, collateral: COLLATERAL + 100_000n, keyHolder: WALLET_HEX });
    const belowLine = refusal(await serviceShare(service, 'manage', { variables: { ...manageBorrower, collateral: String(minimumCollateral(DEBT, decodePriceState(coinOf(borrowService, 'priceInput').output.token?.nft?.commitment as Uint8Array).price) - 1n) }, inputs: [outpoint(keyCoin0)] }, chain, first));
    const manageService = shared(await serviceShare(service, 'manage', { variables: manageBorrower, inputs: [outpoint(fee2), outpoint(keyCoin0)] }, chain, first));
    expect(manageService.variables['keySatoshis']).toBe('1000');
    const managed = assemble(template, 'manage', manageBorrower, manageService, [p2pkhInput(keyCoin0, key), p2pkhInput(fee2, key)], [change()], 5);
    const plainManage = manageLoan({
      contracts,
      price: coinOf(manageService, 'priceInput'),
      loan: coinOf(manageService, 'loanInput'),
      sidecar: coinOf(manageService, 'sidecarInput'),
      manageFunction: coinOf(manageService, 'manageInput'),
      key: p2pkhInput(keyCoin0, key),
      wallet: [p2pkhInput(fee2, key)],
      repay: 0n,
      collateral: COLLATERAL + 100_000n,
      changeTo: WALLET,
    });
    expect(hex(managed.encoded)).toBe(hex(plainManage.built.encoded));
    accepted(managed);
    chain.add(managed);
    const spentKey = refusal(await serviceShare(service, 'manage', { variables: manageBorrower, inputs: [outpoint(keyCoin0)] }, chain, first));
    const keyCoin1 = at(managed, 4);

    // Change the interest rate to 100.
    const fee3 = walletCoin(chain, 1_000_000n);
    const changeBorrower = borrowerShare('changeInterest', { keyCategory, rate: 100, keyHolder: WALLET_HEX });
    const tooHigh = refusal(await serviceShare(service, 'changeInterest', { variables: { ...changeBorrower, interestRate: '40000' }, inputs: [outpoint(keyCoin1)] }, chain, first));
    const changeService = shared(await serviceShare(service, 'changeInterest', { variables: changeBorrower, inputs: [outpoint(keyCoin1)] }, chain, first));
    const changed = assemble(template, 'changeInterest', changeBorrower, changeService, [p2pkhInput(keyCoin1, key), p2pkhInput(fee3, key)], [change()], 4);
    const plainChange = changeInterestRate({
      contracts,
      loan: coinOf(changeService, 'loanInput'),
      sidecar: coinOf(changeService, 'sidecarInput'),
      interestFunction: coinOf(changeService, 'changeInterestInput'),
      key: p2pkhInput(keyCoin1, key),
      wallet: [p2pkhInput(fee3, key)],
      rate: 100,
      changeTo: WALLET,
    });
    expect(hex(changed.encoded)).toBe(hex(plainChange.built.encoded));
    accepted(changed);
    chain.add(changed);
    const keyCoin2 = at(changed, 3);

    // Repay 100.00 PUSD; the rest of the PUSD comes back.
    const fee4 = walletCoin(chain, 1_000_000n);
    const repayBorrower = borrowerShare('repay', { keyCategory, repay: 100_00n, keyHolder: WALLET_HEX });
    const tooMuch = refusal(await serviceShare(service, 'repay', { variables: { ...repayBorrower, repayAmount: '15000' }, inputs: [outpoint(keyCoin2)] }, chain, first));
    const repayService = shared(await serviceShare(service, 'repay', { variables: repayBorrower, inputs: [outpoint(keyCoin2), outpoint(tokens), outpoint(fee4)] }, chain, first));
    expect(repayService.variables['collateral']).toBe(String(COLLATERAL + 100_000n));
    const P = contracts.paryonCategory;
    const repaid = assemble(template, 'repay', repayBorrower, repayService, [p2pkhInput(keyCoin2, key), p2pkhInput(tokens, key), p2pkhInput(fee4, key)], [{ lockingBytecode: WALLET, valueSatoshis: 1000n, token: { category: P, amount: DEBT - 100_00n } }, change()], 7);
    const plainRepay = manageLoan({
      contracts,
      price: coinOf(repayService, 'priceInput'),
      loan: coinOf(repayService, 'loanInput'),
      sidecar: coinOf(repayService, 'sidecarInput'),
      manageFunction: coinOf(repayService, 'repayInput'),
      key: p2pkhInput(keyCoin2, key),
      wallet: [p2pkhInput(tokens, key), p2pkhInput(fee4, key)],
      repay: 100_00n,
      collateral: COLLATERAL + 100_000n,
      tokensChangeTo: WALLET,
      changeTo: WALLET,
    });
    expect(hex(repaid.encoded)).toBe(hex(plainRepay.built.encoded));
    accepted(repaid);
    chain.add(repaid);
    expect(decodeLoanState(at(repaid, 1).output.token?.nft?.commitment as Uint8Array)).toMatchObject({ borrowed: 100_00n, currentInterestRate: 256, nextInterestRate: 100 });
    const keyCoin3 = at(repaid, 4);
    const tokensLeft = at(repaid, 6);
    const smallLoan = await possibleActions(service, { tokens: [{ category: keyCategory, commitment: '', capability: 'minting', outpoint: outpoint(keyCoin3) }] }, chain);

    // Close: the whole debt repaid, the collateral back.
    const fee5 = walletCoin(chain, 1_000_000n);
    const closeBorrower = borrowerShare('close', { keyCategory, keyHolder: WALLET_HEX });
    const closeService = shared(await serviceShare(service, 'close', { variables: closeBorrower, inputs: [outpoint(keyCoin3)] }, chain, first));
    expect(closeService.variables['repayAmount']).toBe(String(100_00n));
    const closed = assemble(template, 'close', closeBorrower, closeService, [p2pkhInput(keyCoin3, key), p2pkhInput(tokensLeft, key), p2pkhInput(fee5, key)], [change()], 5, true);
    const plainClose = closeLoan({
      contracts,
      price: coinOf(closeService, 'priceInput'),
      loan: coinOf(closeService, 'loanInput'),
      sidecar: coinOf(closeService, 'sidecarInput'),
      manageFunction: coinOf(closeService, 'repayInput'),
      key: p2pkhInput(keyCoin3, key),
      wallet: [p2pkhInput(tokensLeft, key), p2pkhInput(fee5, key)],
      keyTo: WALLET,
      changeTo: WALLET,
    });
    expect(hex(closed.encoded)).toBe(hex(plainClose.built.encoded));
    accepted(closed);
    chain.add(closed);
    const keyCoin4 = at(closed, 4);
    const closedLoan = await possibleActions(service, { tokens: [{ category: keyCategory, commitment: '', capability: 'minting', outpoint: outpoint(keyCoin4) }] }, chain);
    const afterClose = refusal(await serviceShare(service, 'manage', { variables: manageBorrower, inputs: [outpoint(keyCoin4)] }, chain, first));

    // A minting token of another category, which opens no loan; a coin that carries no key at all.
    const stranger = { transactionHash: hexToBin('cd'.repeat(32)), index: 0, output: { lockingBytecode: WALLET, valueSatoshis: 1000n, token: { category: hexToBin('ce'.repeat(32)), amount: 0n, nft: { capability: 'minting' as const, commitment: new Uint8Array() } } } };
    chain.adopt(stranger);
    const notALoanKey = refusal(await serviceShare(service, 'close', { variables: { keyCategory: 'ce'.repeat(32), keyHolder: WALLET_HEX }, inputs: [outpoint(stranger)] }, chain, first));
    const noKeyCoin = refusal(await serviceShare(service, 'close', { variables: closeBorrower, inputs: [outpoint(walletCoin(chain, 5_000n))] }, chain, first));
    Object.assign(steps, { nothing, waitingKey, openLoan, smallLoan, closedLoan, belowLine, spentKey, tooHigh, tooMuch, afterClose, notALoanKey, noKeyCoin, keyUsed, keyCategory, created, opened, keyCoin0 });
    return steps as {
      nothing: Awaited<ReturnType<typeof possibleActions>>;
      waitingKey: Awaited<ReturnType<typeof possibleActions>>;
      openLoan: Awaited<ReturnType<typeof possibleActions>>;
      smallLoan: Awaited<ReturnType<typeof possibleActions>>;
      closedLoan: Awaited<ReturnType<typeof possibleActions>>;
      belowLine: ServiceRefusal;
      spentKey: ServiceRefusal;
      tooHigh: ServiceRefusal;
      tooMuch: ServiceRefusal;
      afterClose: ServiceRefusal;
      notALoanKey: ServiceRefusal;
      noKeyCoin: ServiceRefusal;
      keyUsed: ServiceRefusal;
      keyCategory: string;
      created: BuiltTransaction;
      opened: BuiltTransaction;
      keyCoin0: Utxo;
    };
  };
  let done: ReturnType<typeof course> | undefined;
  const ran = () => (done ??= course());

  it('every action from the borrower\'s share and the service\'s share: each passes the virtual machine and is the plain builders\' transaction byte for byte', async () => {
    await ran();
  });

  it('the service refuses with a plain reason: below 110%, a spent key coin, a rate the contracts do not take, a repayment that leaves too little, a closed loan, a key that opens no loan, no key coin, a key used already', async () => {
    const steps = await ran();
    expect(steps.belowLine).toMatchObject({ ok: false, code: 'not-possible', reason: expect.stringMatching(/below 110% of the debt at \$[\d,]+\.\d\d/) as unknown });
    expect(steps.spentKey).toEqual({ ok: false, code: 'inputs-spent', reason: 'The coin with the loan key that the wallet gives is spent already.' });
    expect(steps.tooHigh).toMatchObject({ code: 'not-possible', reason: expect.stringMatching(/from 0 to 32,767/) as unknown });
    expect(steps.tooMuch).toMatchObject({ code: 'not-possible', reason: expect.stringMatching(/leaves at least 100\.00 owing; this loan owes 200\.00/) as unknown });
    expect(steps.afterClose).toEqual({ ok: false, code: 'not-possible', reason: 'This key has no open loan: it was closed, or it never opened one.' });
    expect(steps.notALoanKey).toEqual(steps.afterClose);
    expect(steps.noKeyCoin).toEqual({ ok: false, code: 'not-possible', reason: 'The wallet\'s commit holds no coin with the loan key of this category.' });
    expect(steps.keyUsed).toEqual({ ok: false, code: 'not-possible', reason: 'This key has opened its loan already.' });
  });

  it('what is possible: with nothing held, the starting actions; for a key waiting in Paryon\'s contract, the borrowing; for an open loan, its four actions; for a closed loan, nothing', async () => {
    const steps = await ran();
    expect(steps.nothing).toEqual({ starts: [{ action: 'createKey', available: true }, { action: 'movePeriod', available: true }], items: [] });
    expect(steps.waitingKey.items).toEqual([
      {
        category: steps.keyCategory,
        action: 'borrow',
        lockingScript: 'originEnforcerContract',
        coin: `${steps.created.transactionId}:2`,
        about: { category: steps.keyCategory, spent: false },
        bindings: { keyHolder: 'receive', tokensHolder: 'receive' },
      },
    ]);
    const loan = `${steps.opened.transactionId}:2`;
    const onLoan = { category: steps.keyCategory, lockingScript: 'loanContract', coin: loan, about: { category: steps.keyCategory, spent: true } };
    const collateral = String(COLLATERAL);
    expect(steps.openLoan.items).toEqual([
      { ...onLoan, action: 'manage', bindings: { keyHolder: 'return' }, says: [{ variable: 'debt', value: '20000' }, { variable: 'collateral', value: collateral }] },
      { ...onLoan, action: 'repay', bindings: { keyHolder: 'return' }, says: [{ variable: 'debt', value: '20000' }, { variable: 'collateral', value: collateral }] },
      { ...onLoan, action: 'close', bindings: { keyHolder: 'receive' }, says: [{ variable: 'repayAmount', value: '20000' }, { variable: 'collateral', value: collateral }] },
      { ...onLoan, action: 'changeInterest', bindings: { keyHolder: 'return' }, says: [{ variable: 'interestRate', value: '256' }, { variable: 'collateral', value: collateral }] },
    ]);
    // A loan of 100.00 PUSD cannot be repaid in part: Paryon leaves at least 100.00.
    expect(steps.smallLoan.items.map(({ action }) => action)).toEqual(['manage', 'close', 'changeInterest']);
    expect(steps.closedLoan.items).toEqual([]);
  });
};

describe('the service\'s share, against Paryon\'s live outputs as recorded', { timeout: 120_000 }, () => {
  for (const [deployment, text] of [[CHIPNET_FAST_PERIODS_6, paryonChipnetTemplateTextV3], [MAINNET_V1, paryonMainnetTemplateTextV3]] as const) describe(deployment.name, () => runOn(deployment, text));

  it('answers for version 3 only', () => {
    expect(() => paryonService(paryonContracts(CHIPNET_FAST_PERIODS_6), paryonChipnetTemplateTextV2)).toThrow(/version 3/);
  });
});
