// Trial: ParyonUSD's transactions from an XO template through the unmodified engine, with the wallet's coins
// at recoverable addresses. Paryon's contracts, as published, are deployed on the local node by this project's
// own code (packages/paryon/src/local-deployment.ts); every transaction is asked of the engine as an
// invitation of the Paryon template, with the contracts' coins as inputs it follows, and compared output by
// output and input by input with what this project's own builders (step 1 of stage 9) make for the same choices.
//
// Ran on 18 November 2026 with the template's first text, in which Paryon's scripts were not yet marked as ones
// a wallet need not track (`relevant: false`): the engine followed them and compiled every unlocking itself. With
// the frozen text it no longer follows them; the wallet gives those coins with their unlocking instead.
//
// usage (from packages/app): npx tsx ../../spikes/xo-engine/33-paryon-template.ts
import { type Output, binToHex, decodeTransactionBch, encodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { type AccountCoin, type BuiltTransaction, type InputSpec, type Utxo, ADDRESS_KIND, buildTransaction, checkBeforeSending, deriveSeedKeys, keyPairFromPrivateKey, p2pkhInput, p2pkhLockingBytecode, readTemplate, recoverableInput, walletAddress } from '@grandmas-wallet/core';

import { Account } from '../../packages/app/src/account.ts';
import { walletTemplateNumbers } from '../../packages/app/src/templates.ts';
import { borrow, borrowingFee, closeLoan, createLoanKey, encodeBorrowingPeriod, manageLoan, minimumCollateral, periodAt, updateBorrowingPeriod } from '../../packages/paryon/src/index.ts';
import { localDeployment } from '../../packages/paryon/src/local-deployment.ts';
import { paryonTemplateSource } from '../../packages/paryon/src/template-source.ts';
// @ts-expect-error plain script
import { openEngineRegtest, mine, rpc, BURN } from './regtest.mjs';
// @ts-expect-error plain script
import { mnemonicFor } from './common.mjs';

console.error = () => {};
const hex = binToHex;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async <T>(what: string, check: () => Promise<T | undefined>, attempts = 120): Promise<T> => {
  for (let attempt = 0; attempt < attempts; attempt++) { const found = await check(); if (found) return found; await wait(500); }
  throw new Error(`timed out waiting for ${what}`);
};
const send = async (built: { encoded: Uint8Array } | string): Promise<string> => rpc('sendrawtransaction', typeof built === 'string' ? built : hex(built.encoded));

const name = `trial33-${Date.now()}`;
const account = await Account.open(await openEngineRegtest(name));
try {
  const seed = deriveSeedKeys(mnemonicFor(name), 'testnet', walletTemplateNumbers());
  const identity = new Uint8Array(32).fill(9);
  const made: number[] = [];
  /** The wallet's change address of a number, made known to the engine; numbers in order from 0. */
  const address = async (number: number) => {
    const ours = walletAddress(identity, seed.viewingKey, ADDRESS_KIND.change, number);
    while (made.length <= number) {
      const next = walletAddress(identity, seed.viewingKey, ADDRESS_KIND.change, made.length);
      const engine = await account.nextAddress(ADDRESS_KIND.change, next.tag);
      if (hex(engine.lockingBytecode) !== hex(next.lockingBytecode)) throw new Error('address differs');
      made.push(made.length);
    }
    return ours;
  };
  const byKey = async (number: number, utxo: Utxo): Promise<InputSpec> => { const at = await address(number); return recoverableInput(utxo, at.script as never, seed.addressKey(ADDRESS_KIND.change, number)); };

  // The funder: three coinbase coins, each output 0 of its transaction.
  const funder = keyPairFromPrivateKey(crypto.getRandomValues(new Uint8Array(32)));
  const funderLocking = p2pkhLockingBytecode(funder.keyHash);
  const hashes: string[] = await mine(3, hex(funderLocking));
  await mine(100, BURN);
  const coinbase = async (blockHash: string): Promise<Utxo> => {
    const block = await rpc('getblock', blockHash, 2);
    const tx = block.tx[0];
    return { transactionHash: hexToBin(tx.txid), index: 0, output: { lockingBytecode: funderLocking, valueSatoshis: BigInt(Math.round(tx.vout[0].value * 1e8)) } };
  };
  const [paryonCoin, factoryCoin, money] = await Promise.all(hashes.map(coinbase)) as [Utxo, Utxo, Utxo];
  const height: number = await rpc('getblockcount');
  const PRICE = 20_000n;
  const local = localDeployment({ funder, paryonCoin, factoryCoin, price: PRICE, period: 10 });
  for (const built of local.transactions) await send(built);
  await mine(1, BURN);
  const { contracts } = local;
  console.log('deployed: categories', hex(contracts.paryonCategory).slice(0, 12), hex(contracts.loanKeyFactoryCategory).slice(0, 12), 'at height', height);

  // The template, for this deployment.
  const text = JSON.stringify(paryonTemplateSource(contracts, 2));
  const template = readTemplate(text);
  const identifier = await account.importTemplate(text);
  console.log('template identifier as this project works it out:', identifier === template.identifier);

  // The wallet's coin: output 0 of the funder's payment.
  const DEBT = 100_00n;
  const COLLATERAL = (minimumCollateral(DEBT, PRICE) * 125n) / 110n;
  const first = await address(0);
  const paid = buildTransaction({ inputs: [p2pkhInput(money, funder)], outputs: [{ lockingBytecode: first.lockingBytecode, valueSatoshis: COLLATERAL + 2_000_000n }], changeLockingBytecode: funderLocking });
  await send(paid);
  const coin = await waitFor('the wallet\'s coin', async () => (await account.coinsAt(first.lockingBytecode)).find((c) => c.utxo.index === 0));

  /** Follow a script of the template, and wait for a coin there. */
  const follow = async (lockingScript: string, utxo: Utxo): Promise<AccountCoin> => {
    await account.followScript({ template: identifier, lockingScript, role: 'borrower', variables: {} });
    return waitFor(`the coin at ${lockingScript}`, async () => (await account.coins()).find((c) => hex(c.utxo.transactionHash) === hex(utxo.transactionHash) && c.utxo.index === utxo.index));
  };
  const asCoin = async (utxo: Utxo, number: number): Promise<AccountCoin> => waitFor('a wallet coin', async () => { await address(number); return (await account.coins()).find((c) => hex(c.utxo.transactionHash) === hex(utxo.transactionHash) && c.utxo.index === utxo.index); });

  /** What the engine built against what the builders of step 1 make: every output, every input's outpoint and unlocking of the contracts' inputs. */
  const compare = (what: string, engineHex: string, expected: BuiltTransaction, contractInputs: number[]) => {
    const built = decodeTransactionBch(hexToBin(engineHex));
    if (typeof built === 'string') throw new Error(built);
    const sameOutputs = built.outputs.length === expected.transaction.outputs.length && built.outputs.every((o, i) => hex(encodeTransactionBch({ ...expected.transaction, inputs: [], outputs: [o] })) === hex(encodeTransactionBch({ ...expected.transaction, inputs: [], outputs: [expected.transaction.outputs[i] as Output] })));
    const sameInputs = built.inputs.every((input, i) => hex(input.outpointTransactionHash) === hex(expected.transaction.inputs[i]?.outpointTransactionHash ?? new Uint8Array()) && input.outpointIndex === expected.transaction.inputs[i]?.outpointIndex);
    const sameUnlocking = contractInputs.every((i) => hex(built.inputs[i]?.unlockingBytecode ?? new Uint8Array()) === hex(expected.transaction.inputs[i]?.unlockingBytecode ?? new Uint8Array()));
    console.log(`${what}: ${engineHex.length / 2} bytes (builders: ${expected.encoded.length}); outputs equal ${sameOutputs}; inputs equal ${sameInputs}; contracts' unlocking equal ${sameUnlocking}; locktime ${built.locktime}/${expected.transaction.locktime}; sequences ${built.inputs.map((i) => i.sequenceNumber).join(',')}`);
    if (!sameOutputs || !sameInputs || !sameUnlocking) throw new Error(`${what}: the engine built another transaction`);
  };
  const outputsOf = (built: BuiltTransaction) => built.transaction.outputs;
  /** An output the builders worked out, in the transaction the engine built: the same output, another identifier (other signatures). */
  const sent = (utxo: Utxo, prepared: { transactionId: string }): Utxo => ({ ...utxo, transactionHash: hexToBin(prepared.transactionId) });

  // 1. The loan key: the wallet's coin at input 0, the factory at 1; output 0 the wallet's.
  const factory = await follow('loanKeyFactoryContract', local.loanKeyFactory[0] as Utxo);
  const changeA = await address(1);
  const expectedKey = createLoanKey({ contracts, factory: factory.utxo, defining: await byKey(0, coin.utxo), changeTo: changeA.lockingBytecode });
  const keyCategory = hex(coin.utxo.transactionHash);
  const createdKey = await account.prepare({
    template: identifier, action: 'createKey', role: 'borrower', variables: { keyCategory },
    inputs: [{ coin }, { coin: factory, inputIdentifier: 'factoryInput' }],
    outputs: [outputsOf(expectedKey.built)[0] as Output, { outputIdentifier: 'factoryOutput' }, { outputIdentifier: 'enforcerOutput' }, { outputIdentifier: 'proofOutput' }],
  });
  compare('create a loan key', createdKey.transactionHex, expectedKey.built, [1]);
  await account.send(createdKey);

  // 2. The Borrowing thread moved on (lock time a height).
  const tip: number = await rpc('getblockcount');
  const thread = await follow('borrowingContract', local.borrowing[0] as Utxo);
  const changeB = await address(2);
  const changeAcoin = await asCoin(sent(expectedKey.change, createdKey), 1);
  const expectedMove = updateBorrowingPeriod({ contracts, borrowing: thread.utxo, wallet: [await byKey(1, changeAcoin.utxo)], height: tip, changeTo: changeB.lockingBytecode });
  const moved = await account.prepare({
    template: identifier, action: 'movePeriod', role: 'borrower',
    variables: { borrowingSupply: thread.utxo.output.token?.amount as bigint, newBorrowingCommitment: hex(encodeBorrowingPeriod(periodAt(contracts.deployment, tip))), lockHeight: tip },
    inputs: [{ coin: thread, inputIdentifier: 'periodBorrowingInput' }, { coin: changeAcoin }],
    outputs: [{ outputIdentifier: 'periodBorrowingOutput' }, outputsOf(expectedMove.built)[1] as Output],
  });
  compare('move the Borrowing thread on', moved.transactionHex, expectedMove.built, [0]);
  await account.send(moved);

  // 3. Borrow: Borrowing, price, enforcer, proof, then the wallet's coin; the key and the PUSD to the wallet.
  const price = await follow('priceContract', local.price[0] as Utxo);
  const enforcer = await follow('originEnforcerContract', sent(expectedKey.enforcer, createdKey));
  const proof = await follow('originProofContract', sent(expectedKey.proof, createdKey));
  const movedThread = await waitFor('the moved thread', async () => (await account.coins()).find((c) => hex(c.utxo.transactionHash) === moved.transactionId && c.utxo.index === 0));
  const changeBcoin = await asCoin(sent(expectedMove.change, moved), 2);
  const keyAt = await address(3);
  const tokensAt = await address(4);
  const changeC = await address(5);
  const expectedBorrow = borrow({ contracts, borrowing: movedThread.utxo, price: price.utxo, enforcer: enforcer.utxo, proof: proof.utxo, wallet: [await byKey(2, changeBcoin.utxo)], debt: DEBT, collateral: COLLATERAL, startingInterest: 0, keyTo: keyAt.lockingBytecode, tokensTo: tokensAt.lockingBytecode, changeTo: changeC.lockingBytecode });
  const borrowed = await account.prepare({
    template: identifier, action: 'borrow', role: 'borrower',
    variables: {
      keyCategory, borrowingSupply: movedThread.utxo.output.token?.amount as bigint, borrowingCommitment: hex(movedThread.utxo.output.token?.nft?.commitment as Uint8Array),
      priceCommitment: hex(price.utxo.output.token?.nft?.commitment as Uint8Array), debt: DEBT, collateral: COLLATERAL,
      loanCommitment: hex(expectedBorrow.loan.output.token?.nft?.commitment as Uint8Array), borrowingFee: borrowingFee(DEBT, PRICE),
      startingInterest: '0000', interestManagerConfiguration: '000000ff7f', keyHolder: hex(keyAt.lockingBytecode), tokensHolder: hex(tokensAt.lockingBytecode),
    },
    inputs: [{ coin: movedThread, inputIdentifier: 'borrowingInput' }, { coin: price, inputIdentifier: 'priceInput' }, { coin: enforcer, inputIdentifier: 'enforcerInput' }, { coin: proof, inputIdentifier: 'proofInput' }, { coin: changeBcoin }],
    outputs: [...['borrowingOutput', 'priceOutput', 'loanOutput', 'sidecarOutput', 'feeOutput', 'keyOutput', 'tokensOutput'].map((outputIdentifier) => ({ outputIdentifier })), outputsOf(expectedBorrow.built)[7] as Output],
  });
  compare('borrow', borrowed.transactionHex, expectedBorrow.built, [0, 1, 2, 3]);
  await account.send(borrowed);

  // 4. Manage, adding collateral: price, loan, sidecar, manage, then the key, then the wallet's coin.
  const manageFn = await follow('manageContract', local.manage[0] as Utxo);
  const loan = await follow('loanContract', sent(expectedBorrow.loan, borrowed));
  const sidecar = await follow('sidecarContract', sent(expectedBorrow.sidecar, borrowed));
  const price2 = await waitFor('the price again', async () => (await account.coins()).find((c) => hex(c.utxo.transactionHash) === borrowed.transactionId && c.utxo.index === 1));
  const key = await asCoin(sent(expectedBorrow.key, borrowed), 3);
  const changeCcoin = await asCoin(sent(expectedBorrow.change, borrowed), 5);
  const changeD = await address(6);
  const ADD = 100_000n;
  const expectedManage = manageLoan({ contracts, price: price2.utxo, loan: loan.utxo, sidecar: sidecar.utxo, manageFunction: manageFn.utxo, key: await byKey(3, key.utxo), wallet: [await byKey(5, changeCcoin.utxo)], repay: 0n, collateral: COLLATERAL + ADD, changeTo: changeD.lockingBytecode });
  const managed = await account.prepare({
    template: identifier, action: 'manage', role: 'borrower',
    variables: { keyCategory, priceCommitment: hex(price2.utxo.output.token?.nft?.commitment as Uint8Array), collateral: COLLATERAL + ADD, loanCommitment: hex(loan.utxo.output.token?.nft?.commitment as Uint8Array), interestManagerConfiguration: '000000ff7f', keySatoshis: key.utxo.output.valueSatoshis, keyHolder: hex(key.utxo.output.lockingBytecode) },
    inputs: [{ coin: price2, inputIdentifier: 'priceInput' }, { coin: loan, inputIdentifier: 'loanInput' }, { coin: sidecar, inputIdentifier: 'sidecarInput' }, { coin: manageFn, inputIdentifier: 'manageInput' }, { coin: key }, { coin: changeCcoin }],
    outputs: [...['priceOutput', 'loanOutput', 'sidecarOutput', 'manageOutput', 'keyBackOutput'].map((outputIdentifier) => ({ outputIdentifier })), outputsOf(expectedManage.built)[5] as Output],
  });
  compare('manage, adding collateral', managed.transactionHex, expectedManage.built, [0, 1, 2, 3]);
  await account.send(managed);

  // 5. Close: the PUSD and the loan's NFT burned in data outputs; the key and the collateral to the wallet.
  const at = (built: { transactionId: string }, index: number) => waitFor(`output ${index}`, async () => (await account.coins()).find((c) => hex(c.utxo.transactionHash) === built.transactionId && c.utxo.index === index));
  const [price3, loan2, sidecar2, manage2, key2] = [await at(managed, 0), await at(managed, 1), await at(managed, 2), await at(managed, 3), await at(managed, 4)];
  const tokens = await asCoin(sent(expectedBorrow.tokens, borrowed), 4);
  const keyLast = await address(7);
  const changeE = await address(8);
  const expectedClose = closeLoan({ contracts, price: price3.utxo, loan: loan2.utxo, sidecar: sidecar2.utxo, manageFunction: manage2.utxo, key: await byKey(3, key2.utxo), wallet: [await byKey(4, tokens.utxo)], keyTo: keyLast.lockingBytecode, changeTo: changeE.lockingBytecode });
  const closed = await account.prepare({
    template: identifier, action: 'close', role: 'borrower',
    variables: { keyCategory, priceCommitment: hex(price3.utxo.output.token?.nft?.commitment as Uint8Array), loanCommitment: hex(loan2.utxo.output.token?.nft?.commitment as Uint8Array), repayAmount: DEBT, interestManagerConfiguration: '000000ff7f', keySatoshis: key2.utxo.output.valueSatoshis, keyHolder: hex(keyLast.lockingBytecode) },
    inputs: [{ coin: price3, inputIdentifier: 'priceInput' }, { coin: loan2, inputIdentifier: 'loanInput' }, { coin: sidecar2, inputIdentifier: 'sidecarInput' }, { coin: manage2, inputIdentifier: 'repayInput' }, { coin: key2 }, { coin: tokens }],
    outputs: [...['priceOutput', 'closedManageOutput', 'repaidOutput', 'loanRecordOutput', 'keyBackOutput'].map((outputIdentifier) => ({ outputIdentifier })), outputsOf(expectedClose.built)[5] as Output],
  });
  compare('close', closed.transactionHex, expectedClose.built, [0, 1, 2, 3]);
  await account.send(closed);
  await mine(1, BURN);
  const back = await waitFor('the collateral back', async () => (await account.coinsAt(changeE.lockingBytecode))[0]);
  console.log('the collateral came back:', back.utxo.output.valueSatoshis, 'sat; the key at the wallet:', (await account.coinsAt(keyLast.lockingBytecode)).length === 1);
  const check = checkBeforeSending({ transaction: decodeTransactionBch(hexToBin(closed.transactionHex)) as never, sourceOutputs: [price3, loan2, sidecar2, manage2, key2, tokens].map((c) => c.utxo.output) });
  console.log('close passes the check:', check);
} catch (error) {
  console.log('FAILED:', (error as Error).name, String((error as Error).message).slice(0, 1500), (error as Error).cause ?? '');
  process.exitCode = 1;
} finally {
  await account.close();
  process.exit();
}
