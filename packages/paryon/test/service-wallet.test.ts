import { readFileSync } from 'node:fs';

import { type Output, type TransactionCommon, binToHex, createVirtualMachineBch2025, decodeTransactionBch, encodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { type RecordedPosition, Applications, applicationArchive } from '@grandmas-wallet/app';
import { type ServiceHandlers, type ServiceItem, answerServiceRequest } from '@grandmas-wallet/connect';
import { type BuiltTransaction, type InputSpec, type Utxo, invitationFromText, invitationToText, readTemplate, templateLockingBytecode, typedValues } from '@grandmas-wallet/core';
import { describe, expect, it } from 'vitest';

import { type Device, deviceWith, seedOf } from '../../../test/support/applications.js';
import {
  type ParyonAction,
  type ParyonDeployment,
  type ParyonServiceChain,
  CHIPNET_FAST_PERIODS_6,
  MAINNET_V1,
  borrow,
  changeInterestRate,
  closeLoan,
  collateralAtRatio,
  createLoanKey,
  decodeBorrowingPeriod,
  decodeLoanState,
  decodePriceState,
  finalLockHeight,
  findLoan,
  manageLoan,
  paryonContracts,
  paryonService,
  paryonTemplateAlone,
  periodAt,
  periodStart,
  possibleActions,
  serviceShare,
  updateBorrowingPeriod,
} from '../src/index.js';

/**
 * Version 3 of the loan template, operated from the wallet with no page: the wallet's generic handling of applications
 * (`Applications`) and an in-memory service built on Paryon's service library (`paryonService`, `serviceShare`,
 * `possibleActions`), which joins each invitation with one commit. The service here is application data for the test,
 * as the template is: nothing in the wallet knows it. For each of Paryon's own deployments, on the simulated chain that
 * holds Paryon's live outputs as recorded, every action's transaction is the plain builders' byte for byte and passes the
 * virtual machine.
 */

interface RecordedOutput {
  transactionId: string;
  index: number;
  valueSatoshis: string;
  lockingBytecode: string;
  token?: { category: string; amount: string; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string } };
}
type Invitation = ReturnType<typeof invitationFromText>;
type Commit = Invitation['commits'][number];

const hex = binToHex;
const ADDRESSES = { service: 'https://paryon.example/service/v1', page: 'https://paryon.example/' };
const vm2025 = createVirtualMachineBch2025(true);

const runOn = (deployment: ParyonDeployment): void => {
  const contracts = paryonContracts(deployment);
  const v3 = paryonTemplateAlone(contracts, 3, ADDRESSES);
  const service = paryonService(contracts, v3.texts.template);
  const { definition } = readTemplate(v3.texts.template);
  const NETWORK = deployment.network;
  const recorded = JSON.parse(readFileSync(new URL(`fixtures/${deployment.network}-live.json`, import.meta.url), 'utf8')) as Record<'borrowing' | 'price' | 'loanKeyFactory' | 'manage' | 'changeInterest', RecordedOutput[]> & { tip: { height: number } };
  const shared = (): RecordedOutput[] => [...recorded.borrowing, ...recorded.price, ...recorded.loanKeyFactory, ...recorded.manage, ...recorded.changeInterest];
  const outputOf = (entry: RecordedOutput): Output => ({
    lockingBytecode: hexToBin(entry.lockingBytecode),
    valueSatoshis: BigInt(entry.valueSatoshis),
    ...(entry.token === undefined
      ? {}
      : { token: { category: hexToBin(entry.token.category), amount: BigInt(entry.token.amount), ...(entry.token.nft === undefined ? {} : { nft: { capability: entry.token.nft.capability, commitment: hexToBin(entry.token.nft.commitment) } }) } }),
  });
  const STORED_PRICE = recorded.price.map((entry) => decodePriceState(hexToBin(entry.token?.nft?.commitment ?? '')).price).reduce((a, b) => (a > b ? a : b));
  // As in the service's own tests: the tip as recorded, or a height in the next period, so that a Borrowing thread is behind.
  const tipPeriod = periodAt(deployment, finalLockHeight(deployment.network, recorded.tip.height));
  const behind = recorded.borrowing.some((entry) => decodeBorrowingPeriod(hexToBin(entry.token?.nft?.commitment ?? '')) < tipPeriod);
  const TIP = behind ? recorded.tip.height : periodStart(deployment, tipPeriod + 1) + 1;
  const DEBT = 200_00n;
  const COLLATERAL = collateralAtRatio(DEBT, STORED_PRICE, 125n);

  /** The service's view of the chain: the simulated chain, read as a server would answer it, at the recorded tip. */
  const serviceChain = (device: Device): ParyonServiceChain => ({
    getTransaction: (transactionId) => device.chain.getTransaction(transactionId),
    listUnspent: async (lockingBytecode) => (await device.chain.listUnspent(lockingBytecode)).map(({ token: _token, hasToken: _has, ...rest }) => rest),
    tip: async () => ({ height: TIP }),
  });

  /** Paryon's service in memory: `xo_service_v1` over the library, with a join that appends one commit of the service's share. */
  const inMemoryService = (device: Device) => {
    const calls: string[] = [];
    const chain = serviceChain(device);
    const scriptHex = (identifier: string | undefined): string | undefined => {
      if (identifier === undefined) return undefined;
      try {
        return hex(templateLockingBytecode(definition, identifier, {}));
      } catch {
        return undefined;
      }
    };
    const handlers: ServiceHandlers = {
      hello: (asked) => (asked.template.identifier === v3.names.identifier ? { ok: true, serves: [{ template: v3.names, role: 'service' }] } : { ok: false, error: 'This service does not serve that template.', code: 'unknown-template' }),
      possible: async (asked) => {
        const { starts, items } = await possibleActions(service, { tokens: asked.tokens, made: asked.made }, chain);
        return {
          ok: true,
          height: TIP,
          start: starts,
          items: items.map(({ lockingScript, ...item }): ServiceItem => {
            const script = scriptHex(lockingScript);
            return { ref: `${item.action}:${item.category}`, ...item, ...(script === undefined ? {} : { lockingScript: script }) };
          }),
        };
      },
      join: async (asked) => {
        const invitation = invitationFromText(asked.invitation);
        const [first] = invitation.commits;
        const committed = {
          variables: Object.fromEntries((first?.data.variables ?? []).map(({ variableIdentifier, value }) => [variableIdentifier, String(value)])),
          inputs: (first?.data.inputs ?? []).map((input) => `${hex(input.outpointTransactionHash ?? new Uint8Array())}:${input.outpointIndex ?? 0}`),
        };
        const share = await serviceShare(service, invitation.actionIdentifier as ParyonAction, committed, chain, { pick: () => 0 });
        if (!share.ok) return { ok: false, error: share.reason, code: share.code };
        const values = typedValues(definition, share.variables);
        const previous = invitation.commits.at(-1) as Commit;
        const now = Date.now();
        invitation.commits.push({
          commitIdentifier: `service-${now}`,
          previousCommitIdentifier: previous.commitIdentifier,
          entityIdentifier: 'paryon-service',
          createdAtTimestamp: now,
          expiresAtTimestamp: now + 60_000,
          signature: 'service-signature',
          data: {
            roleIdentifier: 'service',
            ...(Object.keys(values).length === 0 ? {} : { variables: Object.entries(values).map(([variableIdentifier, value]) => ({ variableIdentifier, roleIdentifier: 'service', value: value as never })) }),
            inputs: share.inputs.map(({ outpoint, inputIdentifier, unlockingBytecode, sequenceNumber }) => ({
              outpointTransactionHash: hexToBin(outpoint.split(':')[0] as string),
              outpointIndex: Number(outpoint.split(':')[1]),
              inputIdentifier,
              unlockingBytecode,
              sequenceNumber,
            })),
            outputs: share.outputs.map((outputIdentifier) => ({ outputIdentifier, roleIdentifier: 'service' })),
          },
        });
        return { ok: true, invitation: invitationToText(invitation) };
      },
    };
    const fetch = async (url: string, init: RequestInit): Promise<Response> => {
      expect(url).toBe(ADDRESSES.service);
      calls.push(String((JSON.parse(String(init.body)) as { xo_service_v1: { action: string } }).xo_service_v1.action));
      const answer = await answerServiceRequest({ method: init.method ?? 'GET', body: String(init.body) }, { [NETWORK]: handlers });
      return new Response(answer.status === 204 ? null : answer.body, { status: answer.status, headers: answer.headers });
    };
    return { fetch, calls };
  };

  const setUp = async () => {
    const device = await deviceWith([COLLATERAL + 10_000_000n]);
    device.chain.adopt(shared().map((entry) => ({ transactionId: entry.transactionId, index: entry.index, output: outputOf(entry) })));
    const paryon = inMemoryService(device);
    const applications = new Applications(device.wallet.parts, {
      archive: applicationArchive({ arrangement: () => device.arrangement, storeAt: (address) => device.stores.get(address) as never, seed: seedOf(0), identity: device.identity, chain: device.chain }),
      now: () => 1_795_000_000,
      service: { network: NETWORK, kind: 'public', fetch: paryon.fetch },
    });
    return { device, paryon, applications };
  };

  const decoded = async (device: Device, transactionId: string): Promise<TransactionCommon> => {
    const transaction = decodeTransactionBch(hexToBin((await device.chain.getTransaction(transactionId)) ?? ''));
    if (typeof transaction === 'string') throw new Error(transaction);
    return transaction;
  };
  const spent = async (device: Device, transaction: TransactionCommon): Promise<Utxo[]> =>
    Promise.all(transaction.inputs.map(async (input) => ({ transactionHash: input.outpointTransactionHash, index: input.outpointIndex, output: (await decoded(device, hex(input.outpointTransactionHash))).outputs[input.outpointIndex] as Output })));
  const asSpent = (transaction: TransactionCommon, sources: Utxo[], index: number): InputSpec => ({ utxo: sources[index] as Utxo, unlock: () => transaction.inputs[index]?.unlockingBytecode as Uint8Array });
  const walletFrom = (transaction: TransactionCommon, sources: Utxo[], from: number): InputSpec[] => transaction.inputs.slice(from).map((_, index) => asSpent(transaction, sources, index + from));
  const sameAsBuilders = (transaction: TransactionCommon, expected: BuiltTransaction): void => {
    expect(hex(encodeTransactionBch(transaction))).toBe(hex(expected.encoded));
    expect(vm2025.verify({ transaction, sourceOutputs: expected.sourceOutputs })).toBe(true);
  };
  const keyOf = async (applications: Applications, category: string): Promise<RecordedPosition> => {
    const position = (await applications.recordedPositions({ template: v3.names.identifier })).find(({ token }) => token.category === category);
    if (position === undefined) throw new Error('the wallet lists no key');
    return position;
  };

  it('the whole course with no page: the key, Paryon brought up to date, the loan, collateral added, the rate changed, part repaid, closed; each transaction the builders\' byte for byte', async () => {
    const { device, paryon, applications } = await setUp();
    const id = v3.names.identifier;

    // Trusted on the user's word: its service is asked who it is and what is possible.
    await applications.trust(v3.names, v3.texts, undefined, { contact: true });
    await applications.serviceContact(id);
    expect(paryon.calls).toEqual(['xo_service_hello', 'xo_service_possible_request']);
    const first = await applications.templateActions(id);
    expect(first?.service).toMatchObject({ state: 'reached', role: { role: 'service', name: 'Service' }, walletRole: { role: 'borrower', name: 'Borrower' } });
    expect(first?.starting.map(({ action, service: said }) => [action, said?.available])).toEqual([
      ['createKey', true],
      ['movePeriod', true],
    ]);
    expect(first?.waiting).toEqual([]);

    // Make a key: it waits in Paryon's contract, a token made from the wallet's coin that goes elsewhere: the user's tick.
    const createKey = applications.startAction(id, 'createKey');
    const review = await applications.preview(createKey);
    expect(review.tokensLeaving).toEqual([expect.objectContaining({ how: 'leaves', made: true, to: 'The new loan key, waiting' })]);
    expect(review.service?.values).toEqual([]);
    const made = await applications.carryOut(createKey, undefined, { tokensLeave: true });
    const created = await decoded(device, made.transactionId);
    const keyCategory = hex(created.inputs[0]?.outpointTransactionHash as Uint8Array);
    const createdSources = await spent(device, created);
    sameAsBuilders(created, createLoanKey({ contracts, factory: createdSources[1] as Utxo, defining: asSpent(created, createdSources, 0), changeTo: created.outputs[0]?.lockingBytecode as Uint8Array }).built);
    // The waiting key is offered under the template, by the template's name for where it waits.
    const waiting = await applications.templateActions(id);
    expect(waiting?.waiting.map(({ action, waiting: at, asks }) => ({ action, at, asks: asks?.map(({ variable }) => variable) }))).toEqual([
      { action: 'borrow', at: { category: keyCategory, at: definition.lockingScripts?.['originEnforcerContract']?.name }, asks: ['debt', 'collateral', 'startingRate'] },
    ]);

    // Bring Paryon up to date: the service chooses the thread and the lock height.
    const moving = await applications.carryOut(applications.startAction(id, 'movePeriod'));
    const moved = await decoded(device, moving.transactionId);
    const movedSources = await spent(device, moved);
    sameAsBuilders(moved, updateBorrowingPeriod({ contracts, borrowing: movedSources[0] as Utxo, wallet: walletFrom(moved, movedSources, 1), height: moved.locktime, changeTo: moved.outputs[1]?.lockingBytecode as Uint8Array }).built);

    // Borrow with the waiting key: the values the user gives, committed as numbers.
    const borrowing = applications.waitingAction(id, keyCategory, 'borrow', { debt: String(DEBT), collateral: String(COLLATERAL), startingRate: '256' });
    const borrowReview = await applications.preview(borrowing);
    expect(borrowReview.service?.values.map(({ variable }) => variable)).toEqual(['borrowingSupply', 'borrowingCommitment', 'priceCommitment', 'loanCommitment', 'borrowingFee']);
    expect(borrowReview.figures.toWallet.map(({ kind, token }) => [kind, token?.nft?.capability ?? (token === undefined ? 'none' : 'tokens')])).toEqual([['receive', 'minting'], ['receive', 'tokens'], ['left over', 'none']]);
    const opened = await applications.carryOut(borrowing);
    const borrowed = await decoded(device, opened.transactionId);
    const borrowedSources = await spent(device, borrowed);
    sameAsBuilders(
      borrowed,
      borrow({
        contracts,
        borrowing: borrowedSources[0] as Utxo,
        price: borrowedSources[1] as Utxo,
        enforcer: borrowedSources[2] as Utxo,
        proof: borrowedSources[3] as Utxo,
        wallet: walletFrom(borrowed, borrowedSources, 4),
        debt: DEBT,
        collateral: COLLATERAL,
        startingInterest: 256,
        keyTo: borrowed.outputs[5]?.lockingBytecode as Uint8Array,
        tokensTo: borrowed.outputs[6]?.lockingBytecode as Uint8Array,
        changeTo: borrowed.outputs[7]?.lockingBytecode as Uint8Array,
      }).built,
    );
    // The key is held now: its loan's actions are offered under it, and nothing waits under the template.
    expect((await applications.templateActions(id))?.waiting).toEqual([]);
    let key = await keyOf(applications, keyCategory);
    expect(key).toMatchObject({ status: 'held', actions: ['manage', 'repay', 'close', 'changeInterest'] });
    expect(applications.offeredActions(key).map(({ action, asks }) => [action, asks?.map(({ variable }) => variable) ?? []])).toEqual([
      ['manage', ['collateral']],
      ['repay', ['repayAmount']],
      ['close', []],
      ['changeInterest', ['interestRate']],
    ]);

    // Add collateral.
    const managed = await decoded(device, (await applications.carryOut(applications.actionOn(key, 'manage', { collateral: String(COLLATERAL + 100_000n) }))).transactionId);
    const managedSources = await spent(device, managed);
    sameAsBuilders(
      managed,
      manageLoan({
        contracts,
        price: managedSources[0] as Utxo,
        loan: managedSources[1] as Utxo,
        sidecar: managedSources[2] as Utxo,
        manageFunction: managedSources[3] as Utxo,
        key: asSpent(managed, managedSources, 4),
        wallet: walletFrom(managed, managedSources, 5),
        repay: 0n,
        collateral: COLLATERAL + 100_000n,
        changeTo: managed.outputs[5]?.lockingBytecode as Uint8Array,
      }).built,
    );

    // Change the interest rate to 100.
    key = await keyOf(applications, keyCategory);
    const changed = await decoded(device, (await applications.carryOut(applications.actionOn(key, 'changeInterest', { interestRate: 100 }))).transactionId);
    const changedSources = await spent(device, changed);
    sameAsBuilders(
      changed,
      changeInterestRate({ contracts, loan: changedSources[0] as Utxo, sidecar: changedSources[1] as Utxo, interestFunction: changedSources[2] as Utxo, key: asSpent(changed, changedSources, 3), wallet: walletFrom(changed, changedSources, 4), rate: 100, changeTo: changed.outputs[4]?.lockingBytecode as Uint8Array }).built,
    );
    expect(decodeLoanState(changed.outputs[0]?.token?.nft?.commitment as Uint8Array)).toMatchObject({ borrowed: DEBT, nextInterestRate: 100 });

    // Repay 100.00 PUSD from the wallet's own PUSD; the rest comes back.
    key = await keyOf(applications, keyCategory);
    const repaid = await decoded(device, (await applications.carryOut(applications.actionOn(key, 'repay', { repayAmount: String(100_00n) }))).transactionId);
    const repaidSources = await spent(device, repaid);
    expect(decodeLoanState(repaid.outputs[1]?.token?.nft?.commitment as Uint8Array).borrowed).toBe(100_00n);
    // The wallet's PUSD left over comes back on a coin of the least the network relays, where the builders put 1,000
    // satoshis: everything else is theirs, and every input passes the virtual machine.
    const plainRepay = manageLoan({
      contracts,
      price: repaidSources[0] as Utxo,
      loan: repaidSources[1] as Utxo,
      sidecar: repaidSources[2] as Utxo,
      manageFunction: repaidSources[3] as Utxo,
      key: asSpent(repaid, repaidSources, 4),
      wallet: walletFrom(repaid, repaidSources, 5),
      repay: 100_00n,
      collateral: COLLATERAL + 100_000n,
      tokensChangeTo: repaid.outputs[6]?.lockingBytecode as Uint8Array,
      changeTo: repaid.outputs[7]?.lockingBytecode as Uint8Array,
    }).built.transaction;
    expect(repaid.inputs.map((input) => [hex(input.outpointTransactionHash), input.outpointIndex])).toEqual(plainRepay.inputs.map((input) => [hex(input.outpointTransactionHash), input.outpointIndex]));
    expect(repaid.inputs.slice(0, 4).map((input) => hex(input.unlockingBytecode))).toEqual(plainRepay.inputs.slice(0, 4).map((input) => hex(input.unlockingBytecode)));
    expect(hex(encodeTransactionBch({ ...repaid, inputs: [], outputs: repaid.outputs.slice(0, 6) }))).toBe(hex(encodeTransactionBch({ ...plainRepay, inputs: [], outputs: plainRepay.outputs.slice(0, 6) })));
    expect(repaid.outputs[6]?.token?.amount).toBe(DEBT - 100_00n);
    expect(vm2025.verify({ transaction: repaid, sourceOutputs: repaidSources.map(({ output }) => output) })).toBe(true);
    // A loan of 100.00 PUSD cannot be repaid in part any more: the service no longer offers it.
    key = await keyOf(applications, keyCategory);
    expect(applications.offeredActions(key).map(({ action }) => action)).toEqual(['manage', 'close', 'changeInterest']);

    // Close: the whole debt repaid, the collateral and the key back.
    const closing = await applications.carryOut(applications.actionOn(key, 'close'));
    const closed = await decoded(device, closing.transactionId);
    const closedSources = await spent(device, closed);
    sameAsBuilders(
      closed,
      closeLoan({
        contracts,
        price: closedSources[0] as Utxo,
        loan: closedSources[1] as Utxo,
        sidecar: closedSources[2] as Utxo,
        manageFunction: closedSources[3] as Utxo,
        key: asSpent(closed, closedSources, 4),
        wallet: walletFrom(closed, closedSources, 5),
        keyTo: closed.outputs[4]?.lockingBytecode as Uint8Array,
        changeTo: closed.outputs.at(-1)?.lockingBytecode as Uint8Array,
      }).built,
    );
    expect(closing.tokens.map(({ category, capability }) => [category, capability])).toEqual([[keyCategory, 'minting']]);
    expect(await findLoan(serviceChain(device), contracts, hexToBin(keyCategory))).toBeUndefined();
    // Nothing is offered under the key any more.
    key = await keyOf(applications, keyCategory);
    expect(applications.offeredActions(key)).toEqual([]);
    // One join for each action, and what is possible asked after each.
    expect(paryon.calls.filter((call) => call === 'xo_service_join_request')).toHaveLength(7);
  });
};

describe('version 3 of the loan template, from the wallet with no page', { timeout: 120_000 }, () => {
  for (const deployment of [CHIPNET_FAST_PERIODS_6, MAINNET_V1]) describe(deployment.name, () => runOn(deployment));
});
