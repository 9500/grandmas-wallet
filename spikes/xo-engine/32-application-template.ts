// Trial: an application's template through the unmodified engine, with the wallet's coins as inputs and
// the wallet's addresses as outputs: an action that creates a token category, and one that spends a coin of
// the application's script together with the token. What the engine builds is compared with what this
// project's own reading of the template works out.
import { binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { ADDRESS_KIND, INPUT_BYTES, deriveSeedKeys, readTemplate, requiredFee, templateLockingBytecode, templateOutput, templateUnlockingBytecode, transactionBytes, walletAddress } from '@grandmas-wallet/core';
import { Account } from '../../packages/app/src/account.ts';
import { walletTemplateNumbers } from '../../packages/app/src/templates.ts';
import { strongboxTemplate, templateText } from '../../packages/testing/src/templates.ts';
// @ts-expect-error plain script
import { openEngineRegtest, mine, BURN } from './regtest.mjs';
// @ts-expect-error plain script
import { mnemonicFor } from './common.mjs';

console.error = () => {};
const hex = binToHex;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async <T>(what: string, check: () => Promise<T | undefined>): Promise<T> => {
  for (let attempt = 0; attempt < 60; attempt++) { const found = await check(); if (found) return found; await wait(500); }
  throw new Error(`timed out waiting for ${what}`);
};
const name = `trial32-${Date.now()}`;
const account = await Account.open(await openEngineRegtest(name));
try {
  const seed = deriveSeedKeys(mnemonicFor(name), 'testnet', walletTemplateNumbers());
  const identity = new Uint8Array(32).fill(9);
  const address = async (number: number) => {
    const ours = walletAddress(identity, seed.viewingKey, ADDRESS_KIND.change, number);
    const made = await account.nextAddress(ADDRESS_KIND.change, ours.tag);
    if (hex(made.lockingBytecode) !== hex(ours.lockingBytecode)) throw new Error('address differs');
    return made.lockingBytecode;
  };
  const first = await address(0);
  await mine(1, hex(first));
  await mine(100, BURN);
  const coin = await waitFor('the first coin', async () => (await account.coinsAt(first)).find((c) => c.utxo.index === 0));

  const text = templateText(strongboxTemplate);
  const template = readTemplate(text);
  const identifier = await account.importTemplate(text);
  console.log('identifier as this project works it out:', identifier === template.identifier);

  // Open: the coin defines the category; the key goes to an address of the wallet; change to another.
  const keyAt = await address(1);
  const changeAt = await address(2);
  const boxKey = hex(coin.utxo.transactionHash);
  const open = { boxKey, amount: 50_000n, holder: hex(keyAt), label: 'c0ffee' };
  const planned = [templateOutput(template.definition, 'boxOutput', open), templateOutput(template.definition, 'keyOutput', open)];
  const bytes = transactionBytes([INPUT_BYTES.byKey], [...planned, { lockingBytecode: changeAt, valueSatoshis: 0n }]);
  const change = coin.utxo.output.valueSatoshis - 51_000n - requiredFee(bytes);
  const opened = await account.prepare({
    template: identifier, action: 'open', role: 'holder', variables: open,
    inputs: [{ coin }],
    outputs: [{ outputIdentifier: 'boxOutput' }, { outputIdentifier: 'keyOutput' }, { lockingBytecode: changeAt, valueSatoshis: change }],
  });
  const openTx = decodeTransactionBch(hexToBin(opened.transactionHex));
  if (typeof openTx === 'string') throw new Error(openTx);
  console.log('open:', opened.bytes, 'bytes', opened.bytes === bytes ? '(as worked out)' : `(worked out ${bytes})`, '| outputs as worked out:',
    planned.every((output, index) => hex(output.lockingBytecode) === hex(openTx.outputs[index]!.lockingBytecode) && output.valueSatoshis === openTx.outputs[index]!.valueSatoshis && hex(output.token?.nft?.commitment ?? new Uint8Array()) === hex(openTx.outputs[index]!.token?.nft?.commitment ?? new Uint8Array())),
    '| sequence', openTx.inputs.map((i) => i.sequenceNumber), 'locktime', openTx.locktime);
  await account.send(opened);
  await mine(1, BURN);

  // The box is followed, and so is the key.
  const boxAt = await account.followScript({ template: identifier, lockingScript: 'boxLockingScript', role: 'holder', variables: { boxKey } });
  console.log('box script as worked out:', hex(boxAt) === hex(templateLockingBytecode(template.definition, 'boxLockingScript', { boxKey })));
  const box = await waitFor('the box', async () => (await account.coinsAt(boxAt))[0]);
  const key = await waitFor('the key', async () => (await account.coinsAt(keyAt))[0]);
  console.log('box followed under', box.template === identifier ? 'the application\'s template' : box.template, '| key under', key.template, 'with token', hex(key.utxo.output.token!.category) === boxKey);

  // Take: the box, then the key, both in one invitation of the application's template.
  const keyBack = await address(3);
  const payout = await address(4);
  const take = { boxKey, holder: hex(keyBack), label: 'c0ffee', keyInput: 1n };
  const unlocking = templateUnlockingBytecode(template.definition, 'boxLockingScript', 'boxInput', take);
  const boxBytes = 32 + 4 + 1 + unlocking.length + 4;
  const takeOutputs = [templateOutput(template.definition, 'keyOutput', take)];
  const takeBytes = transactionBytes([boxBytes, INPUT_BYTES.byKey], [...takeOutputs, { lockingBytecode: payout, valueSatoshis: 0n }]);
  const back = box.utxo.output.valueSatoshis + key.utxo.output.valueSatoshis - 1000n - requiredFee(takeBytes);
  const taken = await account.prepare({
    template: identifier, action: 'take', role: 'holder', variables: take,
    inputs: [{ coin: box, inputIdentifier: 'boxInput' }, { coin: key }],
    outputs: [{ outputIdentifier: 'keyOutput' }, { lockingBytecode: payout, valueSatoshis: back }],
  });
  const takeTx = decodeTransactionBch(hexToBin(taken.transactionHex));
  if (typeof takeTx === 'string') throw new Error(takeTx);
  console.log('take:', taken.bytes, 'bytes', taken.bytes === takeBytes ? '(as worked out)' : `(worked out ${takeBytes})`, '| box unlocked as worked out:', hex(takeTx.inputs[0]!.unlockingBytecode) === hex(unlocking), '| sequence', takeTx.inputs.map((i) => i.sequenceNumber));
  await account.send(taken);
  await mine(1, BURN);
  const paid = await waitFor('the payout', async () => (await account.coinsAt(payout))[0]);
  const keyAgain = await waitFor('the key again', async () => (await account.coinsAt(keyBack))[0]);
  console.log('paid out', paid.utxo.output.valueSatoshis, 'sat; the key is back with its token:', keyAgain.utxo.output.token !== undefined);
} catch (error) {
  console.log('FAILED:', (error as Error).name, String((error as Error).message).slice(0, 900), (error as Error).cause ?? '');
  process.exitCode = 1;
} finally {
  await account.close();
  process.exit();
}
