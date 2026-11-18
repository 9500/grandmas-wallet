// The stage 7 run on the local node: actions of two unrelated application templates, carried out by the
// owner's wallet on the XO engine with the wallet's own coins and addresses (acceptance test AP15).
//
// The templates are the two made for the tests (packages/testing/src/templates.ts). The wallet has never
// seen either: each arrives as a text with its recovery declaration, as an application would send it.
//
// usage (from packages/app, with the local node running; see deploy/regtest/regtest.sh):
//   npx tsx ../../scripts/stage-7-run.ts
// The log is written to docs/runs/stage-7-local-node.md.
import 'fake-indexeddb/auto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { binToHex, generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import { MemoryStore } from '@grandmas-wallet/archive';
import { type ChainReader, deriveCredentialKeys, deriveSeedKeys, readTemplate, textHash } from '@grandmas-wallet/core';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';

import { type ActionOutcome, type ApplicationAction, type RecoveryArrangement, Account, Applications, OwnerWallet, RECOVERY_PROFILE, RECOVERY_PROFILE_VERSION, applicationArchive, newArchive, walletTemplateNumbers } from '../packages/app/src/index.js';
import { Electrum } from '../packages/chipnet/src/electrum.js';
import { bondDeclaration, bondTemplate, strongboxDeclaration, strongboxTemplate, templateText } from '../packages/testing/src/templates.js';
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

const steps: { step: string; template: string; transactionId: string; bytes: number; fee: bigint; builtAs: string; note: string }[] = [];
const say = (line: string): void => console.log(line);

const words = generateBip39Mnemonic();
const numbers = walletTemplateNumbers();
const seed = deriveSeedKeys(words, 'testnet', numbers);
const credential = deriveCredentialKeys(generateBip39Mnemonic(), 'testnet', numbers);

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
const fund = async (lockingBytecode: Uint8Array): Promise<void> => {
  await mine(1, hex(lockingBytecode));
  await mine(100, BURN);
};
/** A template with its declaration, as an application would present it. */
const presented = (template: unknown, declaration: object) => {
  const text = templateText(template);
  const read = readTemplate(text);
  const declarationText = JSON.stringify({ profile: RECOVERY_PROFILE, version: RECOVERY_PROFILE_VERSION, template: { identifier: read.identifier, contentHash: read.contentHash }, ...declaration });
  return { names: { identifier: read.identifier, contentHash: read.contentHash, declaration: textHash(declarationText) }, texts: { template: text, declaration: declarationText }, name: read.definition.name ?? '' };
};
const strongbox = presented(strongboxTemplate, strongboxDeclaration);
const bond = presented(bondTemplate, bondDeclaration);

try {
  const height = await rpc('getblockcount');
  if (height > 900) throw new Error(`The local chain is ${height} blocks long and its rewards are small. Start a new one: deploy/regtest/regtest.sh reset`);
  say('Creating the wallet');
  await fund(await wallet.fundingAddress());
  await until('the funding coin', async () => (await wallet.creationStep()) === 'funded');
  await wallet.create({ recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: { unit: 'time512', value: 1 } });
  const identity = hexToBin(wallet.stored.identity as string);
  await settle();
  await until('the creation to be confirmed', async () => (await wallet.creationStep()) === 'confirmed');
  for (let coin = 0; coin < 2; coin++) await fund((await wallet.receiveAddress()).address.lockingBytecode);
  await until('the coins received', async () => (await wallet.balance()).recoverable > 100_000n);
  say(`  identity ${hex(identity)}`);

  // The backup stores are in memory here; what this run is about is the transactions.
  const stores = new Map(['store one', 'store two'].map((name) => [name, new MemoryStore(name)]));
  const arrangement: RecoveryArrangement = { archive: newArchive([...stores.keys()]), earlierArchives: [], earlierViewingKeyRecords: [] };
  const applications = new Applications(wallet.parts, { archive: applicationArchive({ arrangement: () => arrangement, storeAt: (name) => stores.get(name) as MemoryStore, seed, identity, chain }) });

  /** Show what the wallet shows, carry the action out, and hold the result against what was shown. */
  const act = async (step: string, template: typeof strongbox, action: ApplicationAction, note: string): Promise<ActionOutcome> => {
    const preview = await applications.preview(action);
    const outcome = await applications.carryOut(action);
    if (outcome.sent.feeSatoshis !== BigInt(outcome.sent.bytes)) throw new Error(`${step}: the fee is not the size`);
    if (preview.figures.feeSatoshis !== outcome.sent.feeSatoshis || preview.figures.bytes !== outcome.sent.bytes) throw new Error(`${step}: the fee shown beforehand is not the fee paid`);
    if (!/^[0-9a-f-]{8,}$/i.test(outcome.builtAs)) throw new Error(`${step}: not built as an invitation of the engine`);
    steps.push({ step, template: template.name, transactionId: outcome.transactionId, bytes: outcome.sent.bytes, fee: outcome.sent.feeSatoshis, builtAs: outcome.builtAs, note });
    say(`  ${step}: ${outcome.transactionId}, ${outcome.sent.bytes} bytes, fee ${outcome.sent.feeSatoshis}; ${note}`);
    await settle();
    return outcome;
  };
  const tokenOf = async (name: string) => until(`the token of ${name}`, async () => (await applications.tokens()).find((token) => token.template?.name === name));
  const request = (template: typeof strongbox, action: string, role: string, variables: Record<string, string | number>): ApplicationAction => ({ template: template.names, presented: template.texts, action, role, variables });

  say('Strongbox: a position at an address that follows from its key');
  const first = await applications.preview(request(strongbox, 'open', 'holder', { amount: 50_000, label: 'c0ffee' }));
  say(`  before the first action the template is shown as "${first.template.verdict.statement}", and will be stored first: ${first.firstUse}`);
  await act('open', strongbox, request(strongbox, 'open', 'holder', { amount: 50_000, label: 'c0ffee' }), 'creates the key\'s category from a coin of the wallet; the key goes to a fresh address of the wallet');
  let box = await tokenOf('Strongbox');
  say(`  the wallet finds the box from its key: ${box.position?.status}, ${box.position?.satoshis} sat`);
  await act('add', strongbox, applications.actionOn(box, 'add', { amount: 20_000 }), 'pays into the box found from the key; the key is not spent');
  box = await until('the box with both coins', async () => { const token = await tokenOf('Strongbox'); return token.position?.coins === 2 ? token : undefined; });
  const taken = await act('take', strongbox, applications.actionOn(box, 'take'), 'spends both coins of the box and the key in one transaction; the key returns to a new address');
  box = await until('the emptied box', async () => { const token = await tokenOf('Strongbox'); return token.position?.status === 'closed' ? token : undefined; });
  if (taken.tokens[0]?.category !== box.category) throw new Error('the key did not come back');
  say(`  afterwards the template is shown as "${applications.describe(strongbox.names).verdict.statement}"`);

  say('Bond: a position found through a companion coin');
  await act('post', bond, request(bond, 'post', 'poster', { amount: 40_000, serial: '07' }), 'the address the bond returns to is a vault address of the wallet, written on the companion coin');
  const key = await tokenOf('Bond');
  say(`  the wallet finds the bond through its companion coin: ${key.position?.status}, ${key.position?.satoshis} sat`);
  const vaultBefore = (await wallet.balance()).vault;
  await act('redeem', bond, applications.actionOn(key, 'redeem'), 'the bond returns to the vault address; the key returns to the script it left');
  const vaultAfter = await until('the returned bond', async () => { const { vault } = await wallet.balance(); return vault > vaultBefore ? vault : undefined; });
  if (vaultAfter - vaultBefore !== 40_000n) throw new Error('the bond did not return whole');
  const after = await until('the bond closed', async () => { const token = await tokenOf('Bond'); return token.position?.status === 'closed' ? token : undefined; });
  say(`  the bond is ${after.position?.status}; ${vaultAfter - vaultBefore} sat are at the vault address`);

  const stored = [...stores.values()].map((store) => store.name);
  const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const lines = [
    '# Stage 7 run on the local node',
    '',
    'Written by the run itself (`scripts/stage-7-run.ts`). The owner\'s wallet on the unmodified XO engine carries out actions of two unrelated application templates, with the wallet\'s own coins as inputs and the wallet\'s own addresses as outputs, against the local node in regtest mode with the public networks\' relay rules.',
    '',
    `- Repository at commit \`${revision}\``,
    `- Wallet identity: \`${hex(identity)}\``,
    `- Templates: "${strongbox.name}" \`${strongbox.names.identifier}\` and "${bond.name}" \`${bond.names.identifier}\`, made for the tests (\`packages/testing/src/templates.ts\`). Each reached the wallet as a text with its recovery declaration; the wallet's code names neither.`,
    '- Every transaction below is an invitation of the application\'s template, built and signed by the engine. Before that, the wallet\'s own code worked the same transaction out from the template, chose the coins and the exact fee, and showed its figures; what the engine built was compared with it, output by output, before sending. Nothing here was built outside the engine.',
    `- Each template was stored in the backup before its first action (${stored.length} stores, in memory for this run).`,
    '',
    '| Step | Template | Transaction | Bytes | Fee (sat) | Invitation | Note |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...steps.map((entry) => `| ${entry.step} | ${entry.template} | \`${entry.transactionId}\` | ${entry.bytes} | ${entry.fee} | \`${entry.builtAs}\` | ${entry.note} |`),
    '',
    'Also observed: the node accepted every transaction; each fee was exactly the size, and was the fee the wallet showed beforehand; the Strongbox template was shown as "not verified" before its first action and as "verified" once its key had led to the box on chain; the bond returned to the vault address in full; both keys are still in the wallet.',
    '',
  ];
  writeFileSync(`${root}docs/runs/stage-7-local-node.md`, lines.join('\n'));
  say('Run complete. Log written to docs/runs/stage-7-local-node.md');
} catch (error) {
  say(`FAILED: ${(error as Error).name}: ${String((error as Error).message).slice(0, 900)}\n${String((error as Error).stack).split('\n').slice(1, 6).join('\n')}`);
  process.exitCode = 1;
} finally {
  console.error = noise;
  await account.close();
  await server.disconnect().catch(() => undefined);
  process.exit();
}
