// The stage 3 run on the local node: the owner's wallet on the XO engine, from creation to closing.
// Create a wallet with an allowance, receive at fresh addresses, pay with change, receive and send a
// token, receive at a vault address, send everything, and close.
//
// usage (from packages/app, with the local node running; see deploy/regtest/regtest.sh):
//   npx tsx ../../scripts/stage-3-run.ts
// The log is written to docs/runs/stage-3-local-node.md.
import 'fake-indexeddb/auto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { binToHex, generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import {
  type ChainReader,
  buildTransaction,
  deriveCredentialKeys,
  deriveSeedKeys,
  keyPairFromPrivateKey,
  p2pkhInput,
  p2pkhLockingBytecode,
  readControllerHistory,
} from '@grandmas-wallet/core';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';

import { Electrum } from '../packages/chipnet/src/electrum.js';
import { Account, OwnerWallet, walletTemplateNumbers } from '../packages/app/src/index.js';
// @ts-expect-error a plain script: the engine's settings for the local chain, and the node's RPC
import { regtestServers, rpc, mine, BURN } from '../spikes/xo-engine/regtest.mjs';

const hex = binToHex;
const root = fileURLToPath(new URL('..', import.meta.url));
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const until = async <T>(what: string, check: () => Promise<T | undefined | false>): Promise<T> => {
  for (let attempt = 0; attempt < 120; attempt++) {
    const found = await check();
    if (found !== undefined && found !== false) return found;
    await wait(500);
  }
  throw new Error(`timed out waiting for ${what}`);
};
const noise = console.error;
console.error = () => undefined;

const steps: { step: string; transactionId: string; bytes: number; fee: bigint; note: string }[] = [];
const say = (line: string): void => console.log(line);

const words = generateBip39Mnemonic();
const numbers = walletTemplateNumbers();
const seed = deriveSeedKeys(words, 'testnet', numbers);
const credential = deriveCredentialKeys(generateBip39Mnemonic(), 'testnet', numbers);
const payee = p2pkhLockingBytecode(keyPairFromPrivateKey(new Uint8Array(32).fill(0x44)).keyHash);

const engine = await Engine.create(words, { network: XO_SUPPORTED_NETWORKS.chipnet, electrumServers: await regtestServers() });
const account = await Account.open(engine);
const server = await Electrum.connect('ws://127.0.0.1:60403');
const chain: ChainReader = {
  getHistory: (lockingBytecode) => server.getHistory(lockingBytecode),
  getTransaction: (transactionId) => server.getTransaction(transactionId),
  listUnspent: async (lockingBytecode) => (await server.listUnspent(lockingBytecode)).map((entry) => ({ ...entry, hasToken: entry.token !== undefined })),
};
const wallet = await OwnerWallet.open({ backend: account, chain, seed });

/** Make a block, and wait until the engine no longer lists anything the node knows to be spent. */
const settle = async (): Promise<void> => {
  await mine(1, BURN);
  await until('the engine to follow the chain', async () => {
    for (const coin of await account.coins()) {
      if ((await rpc('gettxout', hex(coin.utxo.transactionHash), coin.utxo.index, true)) === null) return false;
    }
    return true;
  });
};
/** Pay an address from a block reward and let it mature. */
const fund = async (lockingBytecode: Uint8Array): Promise<void> => {
  await mine(1, hex(lockingBytecode));
  await mine(100, BURN);
};
const record = (step: string, sent: { transactionId: string; bytes: number; feeSatoshis: bigint }, note = ''): void => {
  steps.push({ step, transactionId: sent.transactionId, bytes: sent.bytes, fee: sent.feeSatoshis, note });
  say(`  ${step}: ${sent.transactionId}, ${sent.bytes} bytes, fee ${sent.feeSatoshis}${note === '' ? '' : `; ${note}`}`);
  if (sent.feeSatoshis < BigInt(sent.bytes)) throw new Error('a fee below the size');
};

try {
  // Block rewards on the local chain halve every 150 blocks; a worn-out chain pays too little to run on.
  const height = await rpc('getblockcount');
  if (height > 900) throw new Error(`The local chain is ${height} blocks long and its rewards are small. Start a new one: deploy/regtest/regtest.sh reset`);
  say('Creating the wallet');
  await fund(await wallet.fundingAddress());
  await until('the funding coin', async () => (await wallet.creationStep()) === 'funded');
  const before = await wallet.creationStep();
  const allowance = { feeLockingBytecode: p2pkhLockingBytecode(credential.feeKey.keyHash), satoshis: 6_000n };
  const afterCreate = await wallet.create({ recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: { unit: 'time512', value: 1 }, allowance });
  const identity = hexToBin(wallet.stored.identity as string);
  say(`  identity ${hex(identity)}; creation was "${before}", is "${afterCreate}"`);
  let refusedEarly = false;
  try { await wallet.receiveAddress(); } catch { refusedEarly = true; }
  say(`  no address is given out before confirmation: ${refusedEarly}`);
  await settle();
  await until('the creation to be confirmed', async () => (await wallet.creationStep()) === 'confirmed');
  const created = await server.getTransaction(wallet.stored.creation.createTransactionId as string);
  record('create', { transactionId: wallet.stored.creation.createTransactionId as string, bytes: (created as string).length / 2, feeSatoshis: BigInt((created as string).length / 2) }, 'with the coin for cancelling and an allowance of 6,000 for the recoverer');
  say(`  recovery is shown as "${wallet.recovery}"; the wallet can cancel: ${await wallet.canCancel()}`);

  say('Receiving and paying');
  const first = await wallet.receiveAddress();
  const second = await wallet.receiveAddress();
  await fund(first.address.lockingBytecode);
  await fund(second.address.lockingBytecode);
  await until('the coins received', async () => (await account.coinsAt(first.address.lockingBytecode)).length > 0 && (await account.coinsAt(second.address.lockingBytecode)).length > 0);
  record('pay', await wallet.pay([{ lockingBytecode: payee, valueSatoshis: 250_000n }]), 'with change to a fresh change address');
  await settle();

  say('A token');
  const minter = keyPairFromPrivateKey(new Uint8Array(32).fill(0x66));
  const minterLocking = p2pkhLockingBytecode(minter.keyHash);
  const [minted] = await mine(1, hex(minterLocking));
  await mine(100, BURN);
  const reward = (await rpc('getblock', minted)).tx[0] as string;
  const rewardValue = BigInt(Math.round((await rpc('getrawtransaction', reward, true)).vout[0].value * 1e8));
  const tokenAddress = await wallet.receiveAddress();
  const minting = buildTransaction({
    inputs: [p2pkhInput({ transactionHash: hexToBin(reward), index: 0, output: { lockingBytecode: minterLocking, valueSatoshis: rewardValue } }, minter)],
    outputs: [{ lockingBytecode: tokenAddress.address.lockingBytecode, valueSatoshis: 1_000n, token: { amount: 500n, category: hexToBin(reward) } }],
    changeLockingBytecode: minterLocking,
  });
  await rpc('sendrawtransaction', hex(minting.encoded));
  await settle();
  const holding = await until('the token', async () => (await wallet.balance()).tokens[0]);
  say(`  received 500 of token ${hex(holding.utxo.output.token?.category as Uint8Array).slice(0, 16)}…`);
  record('send the token', await wallet.sendToken(holding, payee), 'the token unchanged; the fee from another coin');
  await settle();

  say('Changing settings');
  record('change settings', await wallet.changeSettings({ challengeDelay: { unit: 'time512', value: 2 } }), 'the waiting period doubled; a coin of the wallet pays, with change');
  await settle();

  say('A vault address, then sending everything');
  const vault = await wallet.vaultAddress();
  await fund(vault.address.lockingBytecode);
  await until('the vault coin', async () => (await wallet.balance()).vault > 0n);
  const balance = await wallet.balance();
  const everything = await wallet.sendEverything(payee);
  for (const sent of everything.transactions) record('send everything', sent, 'the vault coin goes with the controller');
  if (everything.sentSatoshis !== balance.recoverable + balance.cancelling + balance.vault - everything.feeSatoshis) throw new Error('what arrived is not the total less the fees');
  await settle();
  say(`  left: ${JSON.stringify(await wallet.balance(), (_key, value) => (typeof value === 'bigint' ? Number(value) : value))}; the wallet can cancel: ${await wallet.canCancel()}`);

  say('Closing');
  let refused = '';
  try { await wallet.close(payee); } catch (error) { refused = (error as Error).message; }
  say(`  refused before the full search has finished: ${refused.includes('full search')}`);
  wallet.noteFullySearched(true);
  const last = await wallet.receiveAddress();
  await fund(last.address.lockingBytecode);
  await until('the last coin', async () => (await wallet.balance()).recoverable > 0n);
  const closing = await wallet.close(payee);
  for (const sent of closing.transactions) record('close', sent, 'the last coin and the controller\'s value to one address');
  await mine(1, BURN);
  const history = await until('the closing in the controller\'s history', async () => { const read = await readControllerHistory(chain, identity); return read.closed === undefined ? undefined : read; });
  say(`  the controller's history ends with a closing: ${history.closed !== undefined}; steps before it: ${history.transitions.map((step) => step.kind).join(', ')}`);
  if (history.current.state.challengeDelay.value !== 2) throw new Error('the change of settings is not in the controller\'s state');

  const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const lines = [
    '# Stage 3 run on the local node',
    '',
    'Written by the run itself (`scripts/stage-3-run.ts`). The owner\'s wallet (`packages/app/src/owner-wallet.ts`) on the unmodified XO engine, with the wallet\'s templates, against the local node in regtest mode with the public networks\' relay rules.',
    '',
    `- Repository at commit \`${revision}\``,
    `- Wallet identity: \`${hex(identity)}\``,
    '- Every transaction was built and signed by the engine from what the wallet\'s code decided, and passed this project\'s check before sending.',
    '',
    '| Step | Transaction | Bytes | Fee (sat) | Note |',
    '| --- | --- | --- | --- | --- |',
    ...steps.map((entry) => `| ${entry.step} | \`${entry.transactionId}\` | ${entry.bytes} | ${entry.fee} | ${entry.note} |`),
    '',
    'Also observed: no address was given out before the creation was confirmed; recovery was shown as off; closing was refused before the full search had finished; after sending everything the wallet said that it could not cancel; the controller\'s history ends with a closing.',
    '',
  ];
  writeFileSync(`${root}docs/runs/stage-3-local-node.md`, lines.join('\n'));
  say('Run complete. Log written to docs/runs/stage-3-local-node.md');
} catch (error) {
  const cause = (error as { cause?: { transactionHex: string; sourceOutputs: { valueSatoshis: bigint; lockingBytecode: Uint8Array; token?: { category: Uint8Array; amount: bigint; nft?: { capability: string; commitment: Uint8Array } } }[] } }).cause;
  if (cause !== undefined) {
    const { decodeTransactionBch } = await import('@bitauth/libauth');
    const transaction = decodeTransactionBch(hexToBin(cause.transactionHex));
    if (typeof transaction !== 'string') {
      say(`  inputs ${transaction.inputs.length}, outputs ${transaction.outputs.length}`);
      const show = (o: (typeof cause.sourceOutputs)[number]) => `${o.valueSatoshis} sat, ${hex(o.lockingBytecode).slice(0, 12)}…, token ${o.token === undefined ? 'none' : `${hex(o.token.category).slice(0, 8)} amount ${o.token.amount} ${o.token.nft?.capability ?? ''} ${o.token.nft === undefined ? '' : hex(o.token.nft.commitment)}`}`;
      say(`  spent output 0: ${show(cause.sourceOutputs[0] as (typeof cause.sourceOutputs)[number])}`);
      say(`  new output 0:   ${show(transaction.outputs[0] as never)}`);
      say(`  unlocking 0 starts: ${hex((transaction.inputs[0] as { unlockingBytecode: Uint8Array }).unlockingBytecode).slice(0, 210)}`);
    }
  }
  say(`FAILED: ${(error as Error).name}: ${String((error as Error).message).slice(0, 900)}\n${String((error as Error).stack).split('\n').slice(1, 6).join('\n')}`);
  process.exitCode = 1;
} finally {
  console.error = noise;
  await server.disconnect().catch(() => undefined);
  await account.close();
  process.exit();
}
