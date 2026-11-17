// The stage 5 run on the local node: the complete course. An owner's wallet with coins, a token and a
// vault coin; the device is lost; the recoverer requests, waits and completes; a new device takes over,
// runs both passes over the earlier seed, sweeps, pays from what it swept, sends everything and closes.
//
// Only one engine can be open in a process, so each part is a process of its own with an empty engine
// state, as a device session would be.
//
// usage (from packages/app, with the local node running; see deploy/regtest/regtest.sh):
//   npx tsx ../../scripts/stage-5-run.ts
import 'fake-indexeddb/auto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { binToHex, generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import { type ChainReader, buildTransaction, deriveCredentialKeys, deriveSeedKeys, keyPairFromPrivateKey, p2pkhInput, p2pkhLockingBytecode, readControllerHistory } from '@grandmas-wallet/core';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';

import { Electrum } from '../packages/chipnet/src/electrum.js';
import { Account, OwnerWallet, RecovererWallet, suggestedAllowance, walletTemplateNumbers } from '../packages/app/src/index.js';
// @ts-expect-error a plain script: the engine's settings for the local chain, and the node's RPC
import { regtestServers, rpc, mine, BURN } from '../spikes/xo-engine/regtest.mjs';

const hex = binToHex;
const root = fileURLToPath(new URL('..', import.meta.url));
const [file, phase] = process.argv.slice(2);
const PHASES = ['the owner uses the wallet', 'the recoverer recovers', 'the new device takes over'];

interface Entry { step: string; transactionId: string; bytes: number; fee: string; note: string }
interface Facts { ownerWords: string; newWords: string; credentialWords: string; identity?: string; held?: string; log: Entry[]; notes: string[] }

if (file === undefined) {
  const factsFile = join(mkdtempSync(join(tmpdir(), 'stage-5-')), 'facts.json');
  for (const next of PHASES) {
    const result = spawnSync('npx', ['tsx', fileURLToPath(import.meta.url), factsFile, next], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  const { log, identity, notes } = JSON.parse(readFileSync(factsFile, 'utf8')) as Facts;
  writeFileSync(
    `${root}docs/runs/stage-5-local-node.md`,
    [
      '# Stage 5 run on the local node: the complete course',
      '',
      'Written by the run itself (`scripts/stage-5-run.ts`). The owner\'s wallet, the recoverer and the new device, each on the unmodified XO engine with the wallet\'s templates, against the local node in regtest mode with the public networks\' relay rules. Each part ran in a process of its own with an empty engine state.',
      '',
      `- Wallet identity: \`${identity}\``,
      '',
      '| Step | Transaction | Bytes | Fee (sat) | Note |',
      '| --- | --- | --- | --- | --- |',
      ...log.map((entry) => `| ${entry.step} | \`${entry.transactionId}\` | ${entry.bytes} | ${entry.fee} | ${entry.note} |`),
      '',
      'Also observed:',
      '',
      ...notes.map((note) => `- ${note}`),
      '',
    ].join('\n'),
  );
  console.log('Run complete. Log written to docs/runs/stage-5-local-node.md');
  process.exit(0);
}

const facts: Facts = existsSync(file)
  ? (JSON.parse(readFileSync(file, 'utf8')) as Facts)
  : { ownerWords: generateBip39Mnemonic(), newWords: generateBip39Mnemonic(), credentialWords: generateBip39Mnemonic(), log: [], notes: [] };
const keep = (): void => writeFileSync(file, JSON.stringify(facts, null, 1));
const say = (line: string): void => console.log(line);
const note = (line: string): void => {
  facts.notes.push(line);
  keep();
  say(`  ${line}`);
};
const record = (step: string, sent: { transactionId: string; bytes: number; feeSatoshis: bigint }, about = ''): void => {
  facts.log.push({ step, transactionId: sent.transactionId, bytes: sent.bytes, fee: String(sent.feeSatoshis), note: about });
  keep();
  say(`  ${step}: ${sent.transactionId}, ${sent.bytes} bytes, fee ${sent.feeSatoshis}${about === '' ? '' : `; ${about}`}`);
  if (sent.feeSatoshis < BigInt(sent.bytes)) throw new Error('a fee below the size');
};
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const until = async <T>(what: string, check: () => Promise<T | undefined | false>): Promise<T> => {
  for (let attempt = 0; attempt < 120; attempt++) {
    const found = await check();
    if (found !== undefined && found !== false) return found;
    await wait(500);
  }
  throw new Error(`timed out waiting for ${what}`);
};
console.error = () => undefined;

const numbers = walletTemplateNumbers();
const credential = deriveCredentialKeys(facts.credentialWords, 'testnet', numbers);
const ownerSeed = deriveSeedKeys(facts.ownerWords, 'testnet', numbers);
const newSeed = deriveSeedKeys(facts.newWords, 'testnet', numbers);
const payee = p2pkhLockingBytecode(keyPairFromPrivateKey(new Uint8Array(32).fill(0x44)).keyHash);
const server = await Electrum.connect('ws://127.0.0.1:60403');
const chain: ChainReader = {
  getHistory: (lockingBytecode) => server.getHistory(lockingBytecode),
  getTransaction: (transactionId) => server.getTransaction(transactionId),
  listUnspent: async (lockingBytecode) => (await server.listUnspent(lockingBytecode)).map((entry) => ({ ...entry, hasToken: entry.token !== undefined })),
};
const openAccount = async (words: string): Promise<Account> => Account.open(await Engine.create(words, { network: XO_SUPPORTED_NETWORKS.chipnet, electrumServers: await regtestServers() }));
const fund = async (lockingBytecode: Uint8Array): Promise<void> => {
  await mine(1, hex(lockingBytecode));
  await mine(100, BURN);
};
let account: Account | undefined;
/** Make a block, and wait until the engine no longer lists anything the node knows to be spent. */
const settle = async (): Promise<void> => {
  await mine(1, BURN);
  await until('the engine to follow the chain', async () => {
    for (const coin of (await account?.coins()) ?? []) {
      if ((await rpc('gettxout', hex(coin.utxo.transactionHash), coin.utxo.index, true)) === null) return false;
    }
    return true;
  });
};

try {
  say(phase ?? '');
  if (phase === 'the owner uses the wallet') {
    if ((await rpc('getblockcount')) > 600) throw new Error('The local chain is worn out. Start a new one: deploy/regtest/regtest.sh reset');
    account = await openAccount(facts.ownerWords);
    const wallet = await OwnerWallet.open({ backend: account, chain, seed: ownerSeed });
    await fund(await wallet.fundingAddress());
    await until('the funding coin', async () => (await wallet.creationStep()) === 'funded');
    await wallet.create({ recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: { unit: 'time512', value: 1 }, allowance: { feeLockingBytecode: p2pkhLockingBytecode(credential.feeKey.keyHash), satoshis: suggestedAllowance() } });
    facts.identity = wallet.stored.identity as string;
    keep();
    await settle();
    await until('the creation to be confirmed', async () => (await wallet.creationStep()) === 'confirmed');
    const createdIn = wallet.stored.creation.createTransactionId as string;
    const bytes = ((await server.getTransaction(createdIn)) as string).length / 2;
    record('create', { transactionId: createdIn, bytes, feeSatoshis: BigInt(bytes) }, 'the old device creates the wallet, with an allowance for the recoverer');

    const first = await wallet.receiveAddress();
    const second = await wallet.receiveAddress();
    const vault = await wallet.vaultAddress();
    const tokenAddress = await wallet.receiveAddress();
    for (const address of [first, second, vault]) await fund(address.address.lockingBytecode);
    // A token: a new category, made from a block reward, sent to an address of the wallet.
    const minter = keyPairFromPrivateKey(new Uint8Array(32).fill(0x66));
    const minterLocking = p2pkhLockingBytecode(minter.keyHash);
    const [minted] = await mine(1, hex(minterLocking));
    await mine(100, BURN);
    const reward = (await rpc('getblock', minted)).tx[0] as string;
    const rewardValue = BigInt(Math.round((await rpc('getrawtransaction', reward, true)).vout[0].value * 1e8));
    const minting = buildTransaction({
      inputs: [p2pkhInput({ transactionHash: hexToBin(reward), index: 0, output: { lockingBytecode: minterLocking, valueSatoshis: rewardValue } }, minter)],
      outputs: [{ lockingBytecode: tokenAddress.address.lockingBytecode, valueSatoshis: 1_000n, token: { amount: 0n, category: hexToBin(reward), nft: { capability: 'none', commitment: Uint8Array.of(0xca, 0xfe) } } }],
      changeLockingBytecode: minterLocking,
    });
    await rpc('sendrawtransaction', hex(minting.encoded));
    await settle();
    await until('the coins and the token', async () => { const b = await wallet.balance(); return b.vault > 0n && b.tokens.length === 1 && (await account?.coinsAt(second.address.lockingBytecode))?.length === 1; });
    record('pay', await wallet.pay([{ lockingBytecode: payee, valueSatoshis: 300_000n }]), 'an everyday payment by key, with change');
    await settle();
    const balance = await wallet.balance();
    facts.held = String(balance.recoverable + balance.cancelling + balance.vault + 1_000n);
    keep();
    note(`The old device holds ${facts.held} satoshis at two addresses given out, change addresses and a vault address, and an NFT. Then it is lost.`);
  }

  if (phase === 'the recoverer recovers') {
    account = await openAccount(facts.credentialWords);
    const recoverer = await RecovererWallet.open({ backend: account, chain, identity: hexToBin(facts.identity as string) });
    await until('the fee coins', async () => (await recoverer.feeReadiness()).canRecover);
    // The new device made its seed and told the recoverer the hash of its controller key.
    record('request', await recoverer.request(newSeed.controllerKey.keyHash), 'the recoverer names the new device\'s key');
    await mine(1, BURN);
    const now = (await rpc('getblockheader', await rpc('getbestblockhash'))).time as number;
    await rpc('setmocktime', now + 700);
    await mine(11, BURN);
    await until('the engine to see the request', async () => (await recoverer.state()).status === 'pending');
    record('complete', await recoverer.complete(), 'after the waiting period; no coin has moved');
    await mine(1, BURN);
    await rpc('setmocktime', 0);
  }

  if (phase === 'the new device takes over') {
    account = await openAccount(facts.newWords);
    const identity = hexToBin(facts.identity as string);
    // The recoverer hands over the identity and the earlier seed's viewing key.
    const wallet = await OwnerWallet.takeOver({ backend: account, chain, seed: newSeed, identity, earlierViewingKeys: [ownerSeed.viewingKey] });
    const quick = await wallet.search({ passes: ['quick'] });
    note(`The new device's quick pass found ${quick.coins.length} coins; the wallet is reported as "${quick.status}", not as fully found.`);
    const started = Date.now();
    const full = await wallet.search();
    note(`The full pass over both seeds (${full.seeds.reduce((sum, seed) => sum + (seed.full?.lookups ?? 0), 0)} addresses) took ${((Date.now() - started) / 1000).toFixed(1)} seconds; the wallet is then "${full.status}".`);
    const toSweep = await until('the earlier coins in the engine', async () => { const b = await wallet.balance(); return b.toSweep === BigInt(facts.held as string) ? b.toSweep : undefined; });
    const swept = await wallet.sweepEarlier();
    for (const sent of swept.transactions) record('sweep', sent, `${swept.coins} coins of the earlier seed, the vault coin and the NFT among them, to an address of the new seed`);
    await settle();
    const after = await until('the swept coins', async () => { const b = await wallet.balance(); return b.toSweep === 0n && b.recoverable > 0n ? b : undefined; });
    const fees = swept.transactions.reduce((sum, sent) => sum + sent.feeSatoshis, 0n);
    if (after.recoverable + 1_000n !== toSweep - fees) throw new Error(`after the sweep the new device holds ${after.recoverable}, expected ${toSweep - fees - 1_000n}`);
    note(`After the sweep the new device holds everything at its own addresses: ${after.recoverable} satoshis and ${after.tokens.length} NFT, reported as a token of unknown meaning (${swept.tokens.length}).`);
    record('pay', await wallet.pay([{ lockingBytecode: payee, valueSatoshis: 100_000n }]), 'the new owner pays from what it swept, by its own key');
    await settle();
    const [holding] = (await wallet.balance()).tokens;
    if (holding === undefined) throw new Error('the NFT is missing');
    record('send the NFT', await wallet.sendToken(holding, payee), 'unchanged');
    await settle();
    const closing = await wallet.close(payee);
    for (const sent of closing.transactions) record('close', sent, 'everything, and the controller\'s value, to one address');
    await mine(1, BURN);
    const history = await until('the closing', async () => { const read = await readControllerHistory(chain, identity); return read.closed === undefined ? undefined : read; });
    note(`The controller's history: ${history.transitions.map((step) => step.kind).join(', ')}, then closed. Owners: ${history.owners.length}.`);
  }
} catch (error) {
  say(`FAILED: ${(error as Error).name}: ${String((error as Error).message).slice(0, 700)}\n${String((error as Error).stack).split('\n').slice(1, 5).join('\n')}`);
  process.exitCode = 1;
} finally {
  await rpc('setmocktime', 0).catch(() => undefined);
  await server.disconnect().catch(() => undefined);
  await account?.close();
  process.exit();
}
