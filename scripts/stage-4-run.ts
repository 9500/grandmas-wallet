// The stage 4 run on the local node: an owner and a recoverer, each on the XO engine, through a request
// that the owner cancels and one that completes.
//
// Only one engine can be open in a process, so each part is a process of its own with an empty engine
// state, as a device session would be. What a device keeps between sessions is in a file.
//
// usage (from packages/app, with the local node running; see deploy/regtest/regtest.sh):
//   npx tsx ../../scripts/stage-4-run.ts
import 'fake-indexeddb/auto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { binToHex, generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import { type ChainReader, deriveCredentialKeys, deriveSeedKeys, p2pkhLockingBytecode, readControllerHistory } from '@grandmas-wallet/core';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';

import { Electrum } from '../packages/chipnet/src/electrum.js';
import { Account, OwnerWallet, type OwnerWalletState, RecovererWallet, feeReserve, walletTemplateNumbers } from '../packages/app/src/index.js';
// @ts-expect-error a plain script: the engine's settings for the local chain, and the node's RPC
import { regtestServers, rpc, mine, BURN } from '../spikes/xo-engine/regtest.mjs';

const hex = binToHex;
const root = fileURLToPath(new URL('..', import.meta.url));
const [file, phase] = process.argv.slice(2);
const PHASES = ['owner creates', 'recoverer requests', 'owner cancels', 'recoverer recovers'];

if (file === undefined) {
  const facts = join(mkdtempSync(join(tmpdir(), 'stage-4-')), 'facts.json');
  for (const next of PHASES) {
    const result = spawnSync('npx', ['tsx', fileURLToPath(import.meta.url), facts, next], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  const { log, identity } = JSON.parse(readFileSync(facts, 'utf8')) as { log: { step: string; transactionId: string; bytes: number; fee: string; note: string }[]; identity: string };
  writeFileSync(
    `${root}docs/runs/stage-4-local-node.md`,
    [
      '# Stage 4 run on the local node',
      '',
      'Written by the run itself (`scripts/stage-4-run.ts`). An owner\'s wallet and a recoverer, each on the unmodified XO engine with the wallet\'s templates, against the local node in regtest mode with the public networks\' relay rules. Each part ran in a process of its own with an empty engine state.',
      '',
      `- Wallet identity: \`${identity}\``,
      '',
      '| Step | Transaction | Bytes | Fee (sat) | Note |',
      '| --- | --- | --- | --- | --- |',
      ...log.map((entry) => `| ${entry.step} | \`${entry.transactionId}\` | ${entry.bytes} | ${entry.fee} | ${entry.note} |`),
      '',
    ].join('\n'),
  );
  console.log('Run complete. Log written to docs/runs/stage-4-local-node.md');
  process.exit(0);
}

interface Facts {
  ownerWords: string;
  credentialWords: string;
  newDeviceKeyHash: string;
  identity?: string;
  ownerState?: OwnerWalletState;
  log: { step: string; transactionId: string; bytes: number; fee: string; note: string }[];
}
const facts: Facts = existsSync(file)
  ? (JSON.parse(readFileSync(file, 'utf8')) as Facts)
  : { ownerWords: generateBip39Mnemonic(), credentialWords: generateBip39Mnemonic(), newDeviceKeyHash: hex(new Uint8Array(20).fill(0x9d)), log: [] };
const keep = (): void => writeFileSync(file, JSON.stringify(facts, null, 1));
const say = (line: string): void => console.log(line);
const record = (step: string, sent: { transactionId: string; bytes: number; feeSatoshis: bigint }, note = ''): void => {
  facts.log.push({ step, transactionId: sent.transactionId, bytes: sent.bytes, fee: String(sent.feeSatoshis), note });
  keep();
  say(`  ${step}: ${sent.transactionId}, ${sent.bytes} bytes, fee ${sent.feeSatoshis}${note === '' ? '' : `; ${note}`}`);
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
const server = await Electrum.connect('ws://127.0.0.1:60403');
const chain: ChainReader = {
  getHistory: (lockingBytecode) => server.getHistory(lockingBytecode),
  getTransaction: (transactionId) => server.getTransaction(transactionId),
  listUnspent: async (lockingBytecode) => (await server.listUnspent(lockingBytecode)).map((entry) => ({ ...entry, hasToken: entry.token !== undefined })),
};
const openAccount = async (words: string): Promise<Account> => Account.open(await Engine.create(words, { network: XO_SUPPORTED_NETWORKS.chipnet, electrumServers: await regtestServers() }));
const controllerState = async () => (await readControllerHistory(chain, hexToBin(facts.identity as string))).current.state;
let account: Account | undefined;

try {
  say(phase ?? '');
  if (phase === 'owner creates' || phase === 'owner cancels') {
    account = await openAccount(facts.ownerWords);
    const seed = deriveSeedKeys(facts.ownerWords, 'testnet', numbers);
    const wallet = await OwnerWallet.open({
      backend: account,
      chain,
      seed,
      ...(facts.ownerState === undefined ? {} : { state: facts.ownerState }),
      save: (state) => {
        facts.ownerState = state;
        keep();
      },
    });
    if (phase === 'owner creates') {
      if ((await rpc('getblockcount')) > 900) throw new Error('The local chain is worn out. Start a new one: deploy/regtest/regtest.sh reset');
      await mine(1, hex(await wallet.fundingAddress()));
      await mine(100, BURN);
      await until('the funding coin', async () => (await wallet.creationStep()) === 'funded');
      await wallet.create({
        recovererKeyHash: credential.recoveryKey.keyHash,
        challengeDelay: { unit: 'time512', value: 1 },
      });
      // The recoverer's fee coins, paid here from the run's own coins; the owner gives no allowance.
      await wallet.pay([{ lockingBytecode: p2pkhLockingBytecode(credential.feeKey.keyHash), valueSatoshis: feeReserve() }]);
      facts.identity = wallet.stored.identity as string;
      keep();
      // The wallet is in use as soon as the network has its creation; no block is waited for.
      const createdIn = wallet.stored.creation.createTransactionId as string;
      const bytes = ((await server.getTransaction(createdIn)) as string).length / 2;
      record('create', { transactionId: createdIn, bytes, feeSatoshis: BigInt(bytes) }, `with an allowance of ${feeReserve()} for the recoverer: four requests and one completion`);
      say(`  recovery is shown as "${wallet.recovery}"`);
    } else {
      const state = await controllerState();
      say(`  the owner's device starts again and sees a request for ${state.proposedOwnerKeyHash === undefined ? 'nothing' : hex(state.proposedOwnerKeyHash)}`);
      record('cancel', await wallet.cancel(), 'the fee paid by the smallest coin of the wallet that pays alone, with change if there is enough');
      await mine(1, BURN);
      say(`  the wallet's coins pay for another cancellation: ${await wallet.canCancel()}`);
    }
  } else {
    account = await openAccount(facts.credentialWords);
    const recoverer = await RecovererWallet.open({ backend: account, chain, identity: hexToBin(facts.identity as string) });
    const readiness = await until('the fee coins', async () => { const r = await recoverer.feeReadiness(); return r.holds > 0n ? r : undefined; });
    say(`  fee address holds ${readiness.holds}; a request costs ${readiness.request}, a completion ${readiness.completion}; enough for a recovery: ${readiness.canRecover}`);
    const requested = await recoverer.request(hexToBin(facts.newDeviceKeyHash));
    record('request', requested, 'paid from the recoverer\'s fee address');
    await mine(1, BURN);
    if (phase === 'recoverer recovers') {
      let early = '';
      try { await recoverer.complete(); } catch (error) { early = String((error as Error).message); }
      say(`  completing at once is refused: ${early.includes('non-BIP68-final') || early !== ''}`);
      // The waiting period passes on the chain's clock.
      const now = (await rpc('getblockheader', await rpc('getbestblockhash'))).time as number;
      await rpc('setmocktime', now + 700);
      await mine(11, BURN);
      await until('the engine to see the request', async () => (await recoverer.state()).status === 'pending');
      record('complete', await recoverer.complete(), 'after the waiting period');
      await mine(1, BURN);
      await rpc('setmocktime', 0);
      const state = await until('the completion', async () => { const s = await controllerState(); return s.ownerEpoch === 1 ? s : undefined; });
      say(`  the owner is now ${hex(state.ownerKeyHash)}, epoch ${state.ownerEpoch}; the recoverer's fee address holds ${(await recoverer.feeReadiness()).holds}`);
    }
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
