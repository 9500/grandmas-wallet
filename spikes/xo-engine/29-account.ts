// Trial: the engine driver of packages/app (Account) on the local node: create a wallet, make addresses,
// receive, pay with change. Each transaction is prepared, checked by the project's own rules, then sent.
import { hexToBin, binToHex } from '@bitauth/libauth';
import { type ControllerState, ADDRESS_KIND, INPUT_BYTES, chooseCoins, deriveSeedKeys, encodeControllerState, requiredFee, transactionBytes, walletAddress } from '@grandmas-wallet/core';
import { Account } from '../../packages/app/src/account.ts';
import { walletTemplateNumbers } from '../../packages/app/src/templates.ts';
// @ts-expect-error plain script
import { openEngineRegtest, mine, BURN } from './regtest.mjs';
// @ts-expect-error plain script
import { mnemonicFor } from './common.mjs';

console.error = () => {};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async <T>(what: string, check: () => Promise<T | undefined>): Promise<T> => {
  for (let attempt = 0; attempt < 60; attempt++) { const found = await check(); if (found) return found; await wait(500); }
  throw new Error(`timed out waiting for ${what}`);
};
const name = `trial29-${Date.now()}`;
const account = await Account.open(await openEngineRegtest(name));
try {
  const seed = deriveSeedKeys(mnemonicFor(name), 'testnet', walletTemplateNumbers());
  const funding = await account.ordinaryAddress();
  await mine(1, binToHex(funding));
  await mine(100, BURN);
  const coin = await waitFor('the funding coin', async () => (await account.coinsAt(funding)).find((c) => c.utxo.index === 0));
  const identity = coin.utxo.transactionHash;
  const owner = await account.controllerKey('owner');
  console.log('controller key equal to the library\'s:', binToHex(owner.publicKey) === binToHex(seed.controllerKey.publicKey));
  const state: ControllerState = { version: 1, status: 'active', ownerEpoch: 0, ownerKeyHash: owner.keyHash, recovererKeyHash: new Uint8Array(20).fill(7), challengeDelay: { unit: 'time512', value: 1 } };
  const controllerOutput = { lockingBytecode: new Uint8Array(35), valueSatoshis: 1000n, token: { amount: 0n, category: identity, nft: { capability: 'mutable' as const, commitment: encodeControllerState(state) } } };
  const createBytes = transactionBytes([INPUT_BYTES.p2pkh], [controllerOutput, { lockingBytecode: funding, valueSatoshis: 0n }]);
  const create = await account.prepare({
    template: 'controller', action: 'create', role: 'owner',
    variables: { identity: binToHex(identity), nextState: binToHex(encodeControllerState(state)) },
    inputs: [{ coin }],
    outputs: [{ outputIdentifier: 'controllerOutput' }, { lockingBytecode: funding, valueSatoshis: coin.utxo.output.valueSatoshis - 1000n - requiredFee(createBytes) }],
  });
  console.log('create prepared:', create.bytes, 'bytes, fee', create.feeSatoshis, create.bytes === createBytes ? '(as worked out)' : '(UNEXPECTED SIZE)');
  await account.send(create);
  const controllerLocking = await account.knowController(identity, 'owner');
  const controller = await waitFor('the controller', async () => (await account.coinsAt(controllerLocking))[0]);
  console.log('controller followed, under the', controller.template, 'template; state', binToHex(controller.utxo.output.token!.nft!.commitment).slice(0, 12), '…');

  const first = walletAddress(identity, seed.viewingKey, ADDRESS_KIND.givenOut, 0);
  const made = await account.nextAddress(ADDRESS_KIND.givenOut, first.tag);
  const change = walletAddress(identity, seed.viewingKey, ADDRESS_KIND.change, 0);
  const madeChange = await account.nextAddress(ADDRESS_KIND.change, change.tag);
  console.log('addresses equal to the library\'s:', binToHex(made.lockingBytecode) === binToHex(first.lockingBytecode), binToHex(madeChange.lockingBytecode) === binToHex(change.lockingBytecode), '| numbers', made.number, madeChange.number);
  await mine(1, binToHex(made.lockingBytecode));
  await mine(100, BURN);
  const received = await waitFor('the coin received', async () => { const c = await account.coinsAt(made.lockingBytecode); return c.length > 0 ? c : undefined; });

  // A payment: the coins and the amounts are the wallet's choice; the engine builds and signs.
  const outputs = [{ lockingBytecode: hexToBin(BURN), valueSatoshis: 40_000n }];
  const choice = chooseCoins({ available: received.map((c) => ({ utxo: c.utxo, inputBytes: INPUT_BYTES.byKey })), outputs, changeLockingBytecode: madeChange.lockingBytecode });
  const pay = await account.prepare({
    template: 'actions', action: 'pay', role: 'owner',
    inputs: choice.coins.map(({ utxo }) => ({ coin: received.find((c) => c.utxo === utxo)! })),
    outputs: [...outputs, ...(choice.changeSatoshis === undefined ? [] : [{ lockingBytecode: madeChange.lockingBytecode, valueSatoshis: choice.changeSatoshis }])],
  });
  console.log('payment prepared:', pay.bytes, 'bytes, fee', pay.feeSatoshis, pay.bytes === choice.bytes && pay.feeSatoshis === choice.feeSatoshis ? '(as the choice of coins worked out)' : '(UNEXPECTED)');
  await account.send(pay);
  await mine(1, BURN);
  const changeCoin = await waitFor('the change', async () => (await account.coinsAt(madeChange.lockingBytecode))[0]);
  console.log('change of', changeCoin.utxo.output.valueSatoshis, 'sat is at the change address, under the', changeCoin.template, 'template');

  // A transaction that breaks the fee rule is not prepared.
  try {
    await account.prepare({ template: 'actions', action: 'pay', role: 'owner', inputs: [{ coin: changeCoin }], outputs: [{ lockingBytecode: hexToBin(BURN), valueSatoshis: 1_000n }] });
    console.log('UNEXPECTED: a transaction leaving almost everything to the fee was prepared');
    process.exitCode = 1;
  } catch (error) {
    console.log('refused before sending:', String((error as Error).message).slice(0, 110));
  }
  console.log('the coin is free again after the refusal:', (await account.coinsAt(madeChange.lockingBytecode)).length === 1);
} catch (error) {
  console.log('FAILED:', (error as Error).name, String((error as Error).message).slice(0, 700));
  process.exitCode = 1;
} finally {
  await account.close();
  process.exit();
}
