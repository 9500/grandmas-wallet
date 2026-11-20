// The stage 17 run on the local node for a ParyonUSD loan (acceptance test PR20 of proposal v0.6, on the local node):
// the loan without a recovery declaration, through the loss of a device.
//
// Paryon's contracts as published are deployed on the local chain by this script, as the run of stage 9 did
// (packages/paryon/src/local-deployment.ts). An owner's wallet is created on the XO engine, with a recoverer. The
// loan page's part is played by the library the page uses (packages/paryon: `page-requests.ts`, `findLoan`,
// `loanCoins`, `readParyonState`), its requests sent with the page's `DappRequests` to the wallet's connector for
// applications over a session in memory, every message through JSON and back as it travels. The page reads Paryon's
// coins from the chain itself, names each by outpoint, gives the values it read from them and from the loan, says
// which loan key an action is about, where the key goes, what the key's coin holds as the wallet reported it, and its
// own address; it sends the Paryon template alone. A loan key is made (the user ticks that the key, made from the
// wallet's coin, waits in Paryon's contract), the Borrowing thread is brought up to date, 100.00 PUSD are borrowed and
// collateral is added. The device is lost. The recoverer requests, waits and completes; a new device takes the wallet
// over with the project's recovery flow, sweeps the key and the PUSD, copies the earlier archive, reads the record of
// the key from a store, and is told by the user to trust the template the earlier owner stored. The wallet by itself
// sends the user to the page. The page, connected to the new device and allowed by the user, is told of the key, finds
// the loan and closes it. At the end the wallet is closed and every coin is back at the address that paid for the run.
//
// No recovery declaration is read anywhere: none is sent, stored or kept, and the run checks that.
//
// Each part is a process of its own with an empty engine state, as a device session would be. What the run knows
// between parts is in .local-runs/stage-17-loan-local.json; the stores are directories beside it. A run that stops
// is continued with the same command; `--new` starts again.
//
// usage (from packages/app, with the local node running; see deploy/regtest/regtest.sh):
//   npx tsx ../../scripts/stage-17-loan-run.ts
// The log is written to docs/runs/stage-17-loan-local-node.md.
import 'fake-indexeddb/auto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Output, binToHex, decodeTransactionBch, generateBip39Mnemonic, hexToBin } from '@bitauth/libauth';
import { type ArchiveStore, type PositionRecordEntry, blobIdOf } from '@grandmas-wallet/archive';
import { type ChainReader, type KeyPair, type Utxo, buildTransaction, checkBeforeSending, deriveCredentialKeys, deriveSeedKeys, keyPairFromPrivateKey, p2pkhInput, p2pkhLockingBytecode, readControllerHistory, readTemplate } from '@grandmas-wallet/core';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';

import { Electrum } from '../packages/chipnet/src/electrum.js';
import { invitationFiles, writeInvitationFiles } from './invitation-files.js';
import {
  type OwnerWalletState,
  NeedsApplicationError,
  type RecoveryArrangement,
  Account,
  Applications,
  OwnerWallet,
  RecovererFunds,
  RecovererWallet,
  actionSent,
  applicationArchive,
  checkPositionRecord,
  copyEarlierArchives,
  newArchive,
  recoveryFees,
  walletTemplateNumbers,
} from '../packages/app/src/index.js';
// The application's own definitions, and the library its page uses. The wallet's code has none of them: the template
// reaches it as a text, in the page's requests.
import {
  type FoundLoan,
  type LoanRequestAlone,
  type ParyonContracts,
  type ParyonDeployment,
  borrowRequestAlone,
  borrowingFee,
  closeRequestAlone,
  collateralAtRatio,
  createKeyRequestAlone,
  decodeLoanState,
  findLoan,
  loanCoins,
  localDeployment,
  manageRequestAlone,
  movePeriodRequestAlone,
  paryonContracts,
  paryonTemplateAlone,
  periodAt,
  readParyonState,
} from '../packages/paryon/src/index.js';
import { detailsOf } from '../apps/loan/src/xo.js';
import { type PageLink, pageLink } from './stage-17-page-link.js';
// @ts-expect-error a plain script: the engine's settings for the local chain, and the node's RPC
import { regtestServers, rpc, mine, BURN } from '../spikes/xo-engine/regtest.mjs';

const hex = binToHex;
const root = fileURLToPath(new URL('..', import.meta.url));
const [phase] = process.argv.slice(2).filter((word) => !word.startsWith('--'));
/** The exit code of a part that stopped at a step of its own and said why. */
const STOPPED = 3;
const PHASES = ['the owner opens a loan', 'the recoverer recovers', 'the new device closes the loan from the page', 'the recoverer returns its balance', 'the run returns what is left'];
const runDirectory = `${root}.local-runs`;
mkdirSync(runDirectory, { recursive: true });
const stateFile = `${runDirectory}/stage-17-loan-local.json`;
const storeDirectory = `${runDirectory}/stage-17-loan-stores`;
const invitations = `${runDirectory}/invitations/stage-17-loan/`;
const logFile = `${root}docs/runs/stage-17-loan-local-node.md`;
/** Where the page says it is served from; the run has no web server, and the address is only kept in the record. */
const PAGE = 'https://loan.example/';
/** PUSD cents borrowed, the collateral's share of the debt at the stored price, and what is added later. */
const DEBT = 100_00n;
const PERCENT = 125n;
const MANAGE_ADD = 100_000n;
/** US cents per BCH in the deployment's price threads, as in the run of stage 9. */
const PRICE = 20_870n;

interface Entry { step: string; transactionId: string; bytes: number; fee: string; note: string }
interface Facts {
  startedAt: string;
  words: { owner: string; next: string; credential: string };
  localFunder?: string;
  identity?: string;
  ownerState?: OwnerWalletState;
  newState?: OwnerWalletState;
  ownerArrangement?: RecoveryArrangement;
  newArrangement?: RecoveryArrangement;
  deployment?: ParyonDeployment;
  loan?: { keyCategory?: string; collateral?: string };
  amounts?: string[];
  record?: PositionRecordEntry;
  steps: Record<string, { transactionIds: string[]; data?: Record<string, number | string> }>;
  finished: string[];
  held?: string;
  funderAtStart?: string;
  log: Entry[];
  notes: string[];
}

// ------------------------------------------------------------------ the driver: one process for each part

if (phase === undefined) {
  if (process.argv.includes('--new')) {
    rmSync(stateFile, { force: true });
    rmSync(storeDirectory, { recursive: true, force: true });
  }
  if (!existsSync(stateFile)) rmSync(invitations, { recursive: true, force: true });
  if (!existsSync(stateFile) && Number(execFileSync(`${root}deploy/regtest/regtest.sh`, ['cli', 'getblockcount'], { encoding: 'utf8' })) > 1500) {
    console.error('The local chain is long and its block rewards are small. Start a new one: deploy/regtest/regtest.sh reset');
    process.exit(1);
  }
  const finished = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, 'utf8')) as Facts).finished : [];
  for (const next of PHASES) {
    if (finished.includes(next)) {
      console.log(`${next}: done before`);
      continue;
    }
    // A part that ends without saying why (the engine's packages can end the process) is continued, a few times.
    let result = spawnSync('npx', ['tsx', fileURLToPath(import.meta.url), next], { stdio: 'inherit' });
    for (let again = 0; again < 3 && result.status !== 0 && result.status !== STOPPED; again += 1) {
      console.log(`"${next}" ended unexpectedly; continuing it`);
      result = spawnSync('npx', ['tsx', fileURLToPath(import.meta.url), next], { stdio: 'inherit' });
    }
    if (result.status !== 0) {
      console.error(`Stopped in "${next}". The same command continues the run.`);
      process.exit(result.status ?? 1);
    }
  }
  const facts = JSON.parse(readFileSync(stateFile, 'utf8')) as Facts;
  const written = invitationFiles(invitations);
  const invitationOf = (transactionId: string): string => {
    const found = written.find((entry) => entry.transactionId === transactionId);
    return found === undefined ? '' : `${found.action} (${found.templateName})`;
  };
  const sent = paryonTemplateAlone(paryonContracts(facts.deployment as ParyonDeployment));
  const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const changed = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).split('\n').filter((line) => line.trim() !== '' && !line.includes('docs/runs/') && !line.includes('.chipnet'));
  writeFileSync(
    logFile,
    [
      '# Stage 17 run on the local node: a ParyonUSD loan without a declaration, through the loss of a device (PR20)',
      '',
      'Written by the run itself (`scripts/stage-17-loan-run.ts`). The owner\'s wallet, the recoverer and the new device, each on the unmodified XO engine, against the local node in regtest mode with the public networks\' relay rules, on which the run deployed Paryon\'s contracts as published, as the run of stage 9 did (`packages/paryon/src/local-deployment.ts`). Each part ran in a process of its own with an empty engine state. The Paryon template reached the wallet alone, as a text, in the requests of the loan page: the library the page uses (`packages/paryon`: `page-requests.ts`, `findLoan`, `loanCoins`, `readParyonState`) made each request from what it read on the chain, and the page\'s `DappRequests` sent it to the wallet\'s connector for applications over a session in memory, every message through JSON and back as it travels; only the relay and the page\'s screens were left out. Every transaction of the loan is an invitation of that template, built by the unmodified engine, which signed the wallet\'s own inputs, and compared with what the wallet\'s own code had worked out before it was sent; every input of Paryon\'s was evaluated in the virtual machine before the user was asked. The backup stores are two directories of the run, read and written as a store server\'s are. No recovery declaration was sent, stored, kept or read anywhere in the run.',
      '',
      `- Wallet identity: \`${facts.identity}\``,
      `- Loan key (token category): \`${facts.loan?.keyCategory}\``,
      `- Template "${readTemplate(sent.texts.template).definition.name ?? ''}" \`${sent.names.identifier}\`, content \`${sent.names.contentHash}\`, with no declaration`,
      `- Paryon's deployment on the local chain: PUSD \`${facts.deployment?.tokenIds.paryon}\`, factories \`${facts.deployment?.tokenIds.loanKeyFactory}\``,
      `- The page's address in its requests: ${PAGE}`,
      `- Repository at commit \`${revision}\`${changed.length === 0 ? '' : `, with uncommitted changes to ${changed.map((line) => line.slice(3)).join(', ')}`}`,
      `- Started ${facts.startedAt}`,
      '',
      'The position record the earlier device wrote before the borrowing was signed, when the key reached the wallet, as the new device read it from a store:',
      '',
      '```json',
      JSON.stringify(facts.record ?? null, null, 1),
      '```',
      '',
      '| Step | Transaction | Bytes | Fee (sat) | Note | Invitation |',
      '| --- | --- | --- | --- | --- | --- |',
      ...facts.log.map((entry) => `| ${entry.step} | \`${entry.transactionId}\` | ${entry.bytes} | ${entry.fee} | ${entry.note} | ${invitationOf(entry.transactionId)} |`),
      '',
      'Amounts:',
      '',
      ...(facts.amounts ?? []).map((line) => `- ${line}`),
      '',
      'Also observed:',
      '',
      ...facts.notes.map((line) => `- ${line}`),
      '',
    ].join('\n'),
  );
  console.log(`Run complete. Log written to ${logFile.slice(root.length)}`);
  process.exit(0);
}

// ------------------------------------------------------------------ what every part shares

const facts: Facts = existsSync(stateFile)
  ? (JSON.parse(readFileSync(stateFile, 'utf8')) as Facts)
  : { startedAt: new Date().toISOString(), words: { owner: generateBip39Mnemonic(), next: generateBip39Mnemonic(), credential: generateBip39Mnemonic() }, steps: {}, finished: [], log: [], notes: [] };
const keep = (): void => writeFileSync(stateFile, JSON.stringify(facts, (_key, value: unknown) => (typeof value === 'bigint' ? String(value) : value), 1), { mode: 0o600 });
keep();
const say = (line: string): void => console.log(line);
const note = (line: string, name?: string): void => {
  if (name !== undefined) {
    if (facts.steps[`observed: ${name}`] !== undefined) return;
    facts.steps[`observed: ${name}`] = { transactionIds: [] };
  }
  if (!facts.notes.includes(line)) facts.notes.push(line);
  keep();
  say(`  ${line}`);
};
const record = (step: string, sent: { transactionId: string; bytes: number; feeSatoshis: bigint }, about = ''): void => {
  if (!facts.log.some((entry) => entry.transactionId === sent.transactionId)) facts.log.push({ step, transactionId: sent.transactionId, bytes: sent.bytes, fee: String(sent.feeSatoshis), note: about });
  keep();
  say(`  ${step}: ${sent.transactionId}, ${sent.bytes} bytes, fee ${sent.feeSatoshis}${about === '' ? '' : `; ${about}`}`);
  if (sent.feeSatoshis < BigInt(sent.bytes)) throw new Error('a fee below the size');
};
const once = async (name: string, work: () => Promise<{ transactionIds?: string[]; data?: Record<string, number | string> } | undefined>): Promise<Record<string, number | string>> => {
  if (facts.steps[name] === undefined) {
    const done = (await work()) ?? {};
    facts.steps[name] = { transactionIds: done.transactionIds ?? [], ...(done.data === undefined ? {} : { data: done.data }) };
    keep();
    if (process.env['STOP_AFTER'] === name) throw new Error(`stopped after "${name}", as asked`);
  } else {
    say(`  (${name}: done before)`);
  }
  return facts.steps[name]?.data ?? {};
};
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const until = async <T>(what: string, check: () => Promise<T | undefined | false>, patienceMs = 60_000, everyMs = 500): Promise<T> => {
  const deadline = Date.now() + patienceMs;
  for (;;) {
    const found = await check();
    if (found !== undefined && found !== false) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await wait(everyMs);
  }
};
console.error = () => undefined;

const numbers = walletTemplateNumbers();
const credential = deriveCredentialKeys(facts.words.credential, 'testnet', numbers);
const RECOVERER_COINS = 5_000n;
const ownerSeed = deriveSeedKeys(facts.words.owner, 'testnet', numbers);
const newSeed = deriveSeedKeys(facts.words.next, 'testnet', numbers);

const server = await Electrum.connect('ws://127.0.0.1:60403');
/** The chain as the wallet reads it, with every lookup counted. */
const lookups = { history: 0, transactions: 0, unspent: 0 };
const chain: ChainReader = {
  getHistory: (lockingBytecode) => ((lookups.history += 1), server.getHistory(lockingBytecode)),
  getTransaction: (transactionId) => ((lookups.transactions += 1), server.getTransaction(transactionId)),
  listUnspent: async (lockingBytecode) => ((lookups.unspent += 1), (await server.listUnspent(lockingBytecode)).map((entry) => ({ ...entry, hasToken: entry.token !== undefined }))),
};

if (facts.localFunder === undefined) {
  facts.localFunder = hex(crypto.getRandomValues(new Uint8Array(32)));
  keep();
}
const funder: KeyPair = keyPairFromPrivateKey(hexToBin(facts.localFunder));
const funderLocking = p2pkhLockingBytecode(funder.keyHash);
const block = async (): Promise<void> => {
  await mine(1, BURN);
};
const confirmed = async (transactionId: string): Promise<void> => {
  await mine(1, BURN);
  await until(`the first confirmation of ${transactionId.slice(0, 12)}…`, async () => ((await server.confirmations(transactionId)) ?? 0) > 0);
};
const funderCoins = async (): Promise<Utxo[]> =>
  (await server.listUnspent(funderLocking, 'exclude')).map((entry) => ({ transactionHash: hexToBin(entry.transactionId), index: entry.index, output: { lockingBytecode: funderLocking, valueSatoshis: entry.valueSatoshis } }));
const funderPays = async (outputs: Output[], options: { burn?: boolean; extraInputs?: Utxo[] } = {}): Promise<string> => {
  const coins = await until('the funder\'s coins', async () => { const found = await funderCoins(); return found.length > 0 ? found : undefined; });
  const built = buildTransaction({ inputs: [...coins, ...(options.extraInputs ?? [])].map((coin) => p2pkhInput(coin, funder)), outputs, changeLockingBytecode: funderLocking, allowTokenBurn: options.burn === true });
  const check = checkBeforeSending(built);
  if (check !== true) throw new Error(`a payment of the funder fails the check before sending: ${check}`);
  const result = await server.broadcast(hex(built.encoded));
  if (!result.accepted && !/already/i.test(result.reason)) throw new Error(`a payment of the funder was refused: ${result.reason}`);
  await until('the funder\'s change', async () => (await server.getTransaction(built.transactionId)) !== undefined);
  await wait(1_200);
  return built.transactionId;
};

const openAccount = async (words: string, who: string): Promise<Account> =>
  Account.open(await Engine.create(words, { network: XO_SUPPORTED_NETWORKS.chipnet, electrumServers: await regtestServers() }), { onSent: writeInvitationFiles(invitations, who) });
let account: Account | undefined;

/** A backup store kept as a directory of the run: sealed blobs under their own names, as a store server keeps them. */
const fileStore = (name: string): ArchiveStore => {
  const directory = (archiveId: string): string => {
    const path = `${storeDirectory}/${name}/${archiveId}`;
    mkdirSync(path, { recursive: true });
    return path;
  };
  return {
    name,
    put: async (archiveId, sealed) => {
      const blobId = blobIdOf(sealed);
      writeFileSync(`${directory(archiveId)}/${blobId}`, sealed);
      return blobId;
    },
    list: async (archiveId) => readdirSync(directory(archiveId)),
    get: async (archiveId, blobId) => (existsSync(`${directory(archiveId)}/${blobId}`) ? new Uint8Array(readFileSync(`${directory(archiveId)}/${blobId}`)) : undefined),
  };
};
const STORES = ['store-1', 'store-2'];
const stores = new Map(STORES.map((name) => [name, fileStore(name)]));
const storeAt = (name: string): ArchiveStore => stores.get(name) as ArchiveStore;

/** The deployment's contracts and the template the page sends, once the deployment is known. */
let contractsCache: ParyonContracts | undefined;
const contracts = (): ParyonContracts => {
  if (facts.deployment === undefined) throw new Error('Paryon\'s contracts are not deployed yet');
  return (contractsCache ??= paryonContracts(facts.deployment));
};
const template = () => paryonTemplateAlone(contracts());
/** What a transaction paid in fees, from its own inputs and outputs as the server gives them. */
const sentAs = async (transactionId: string): Promise<{ transactionId: string; bytes: number; feeSatoshis: bigint }> => {
  const read = async (id: string) => {
    const decoded = decodeTransactionBch(hexToBin((await until(`the transaction ${id.slice(0, 12)}…`, async () => server.getTransaction(id))) as string));
    if (typeof decoded === 'string') throw new Error(decoded);
    return decoded;
  };
  const transaction = await read(transactionId);
  let spent = 0n;
  for (const input of transaction.inputs) spent += (await read(hex(input.outpointTransactionHash))).outputs[input.outpointIndex]?.valueSatoshis ?? 0n;
  const paid = transaction.outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n);
  return { transactionId, bytes: ((await server.getTransaction(transactionId)) as string).length / 2, feeSatoshis: spent - paid };
};
/** No declaration anywhere: what the wallet keeps of each template. */
const noDeclaration = (applications: Applications, where: string): string => {
  const kept = applications.templates.filter((kept) => kept.declaration !== undefined || kept.identifier !== template().names.identifier);
  if (kept.length > 0) throw new Error(`${where} keeps a template with a declaration, or another template`);
  return `${where} keeps ${applications.templates.length} template, Paryon's, with no declaration`;
};
const amount = (line: string, name: string): void => {
  facts.amounts = [...(facts.amounts ?? []).filter((known) => !known.startsWith(`${name}:`)), `${name}: ${line}`];
  keep();
};
const pusd = (cents: bigint): string => `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
const dollars = (cents: bigint): string => `$${pusd(cents)}`;
const sat = (value: bigint): string => `${value.toLocaleString('en-US')} sat`;

/**
 * The page's side, on a device: its requests, from the library the page uses, sent as the page sends them. Every
 * request is checked to carry no declaration and the page's address; the request as it travelled is noted.
 */
const thePage = (applications: Applications, wallet: OwnerWallet) => {
  const link: PageLink = pageLink(applications, 'the loan page');
  const ask = async (request: LoanRequestAlone, about: string, tick = false): Promise<{ transactionId: string; tokens: { category: string; capability: string; amount?: string }[] }> => {
    const asked = link.requests.request(detailsOf(request), template().texts);
    const result = (await link.approve(asked, {
      tick,
      seen: (preview) =>
        note(
          `${about}: the wallet showed the page's request with its own figures: it gives ${sat(preview.figures.givesSatoshis)}, gets ${sat(preview.figures.getsSatoshis)}, ${sat(preview.figures.intoApplicationSatoshis)} go into the application, the fee is ${sat(preview.figures.feeSatoshis)}; Paryon's coins spent: ${preview.figures.applicationInputs.map(({ name }) => `"${name}"`).join(', ')}; to the wallet: ${preview.figures.toWallet.map(({ kind }) => kind).join(', ')}${preview.figures.tokensNet.length === 0 ? '' : `; tokens ${preview.figures.tokensNet.map(({ amount: change }) => (change > 0n ? `+${change}` : String(change))).join(', ')}`}${preview.figures.tokensDestroyed.length === 0 ? '' : `; destroyed: ${preview.figures.tokensDestroyed.map(({ name, how, wallet }) => `"${name}" (${how}, ${wallet ? 'the wallet\'s' : 'the application\'s'})`).join(', ')}`}${preview.tokensLeaving === undefined ? '' : `; it asks for the user's tick: ${preview.tokensLeaving.map(({ how, made, to }) => `a token ${made === true ? 'made from the wallet\'s coin ' : ''}${how} to "${to ?? ''}"`).join(', ')}`}; it ${preview.recordsPosition === true ? 'records a position' : 'records nothing'}; the template is shown with ${preview.template.declaration === undefined ? 'no declaration' : 'a declaration'}.`,
        ),
    })) as { transactionId: string; tokens: { category: string; capability: string; amount?: string }[] };
    const travelled = link.sent.filter((message) => message.action === 'xo_action_request');
    if (travelled.some((message) => message.template.declaration !== undefined || message.definition?.declaration !== undefined)) throw new Error('the page sent a declaration');
    const last = travelled.at(-1);
    if (last?.page !== PAGE) throw new Error('the page\'s request did not carry its address');
    note(`${about}: the page's request, as it travelled: ${JSON.stringify({ templateAction: last.templateAction, variables: last.variables, ...(last.bindings === undefined ? {} : { bindings: last.bindings }), ...(last.about === undefined ? {} : { about: last.about }), ...(last.creates === undefined ? {} : { creates: last.creates }), inputs: last.inputs, page: last.page })}.`);
    // The next action takes what this one left the wallet: the engine lists it a moment after the transaction is sent.
    await until(`the wallet's outputs of ${result.transactionId.slice(0, 12)}…`, async () => {
      const coins = [...(await wallet.parts.ownCoins()), ...(await wallet.parts.tokenCoins()).map(({ coin }) => coin)];
      return coins.some((coin) => hex(coin.utxo.transactionHash) === result.transactionId);
    }, 120_000);
    return result;
  };
  return { link, ask };
};
/** What the page reads before an action on the loan: the key as the wallet reports it, the loan from the key, Paryon's coins. */
const readLoanForPage = async (link: PageLink, keyCategory: string): Promise<FoundLoan & { coins: Parameters<typeof closeRequestAlone>[1] }> => {
  const { trusted, positions } = await link.requests.recordedPositions(template().names.identifier);
  const reported = positions.find((position) => position.category === keyCategory);
  if (!trusted || reported === undefined) throw new Error('the wallet does not report the loan key to the page');
  const found = await loanCoins(server, contracts(), hexToBin(keyCategory), BigInt(reported.satoshis));
  if (found === undefined) throw new Error('the page finds no loan for the key');
  return { ...found, coins: { keyCategory, keySatoshis: found.keySatoshis, loan: found.loan, sidecar: found.sidecar, price: found.price, manageFunction: found.manageFunction, page: PAGE } };
};
const medianTime = async (height: number): Promise<number> => {
  const times = await Promise.all(Array.from({ length: 11 }, (_, back) => server.headerTime(Math.max(height - back, 0))));
  return times.sort((a, b) => a - b)[5] as number;
};

// ------------------------------------------------------------------ the parts

try {
  say(phase);

  if (phase === 'the owner opens a loan') {
    await once('Paryon\'s contracts are deployed on the local chain', async () => {
      // Four block rewards: two define the deployment's categories, two pay for the run.
      const hashes = (await mine(4, hex(funderLocking))) as string[];
      await mine(100, BURN);
      const coinbase = async (hash: string): Promise<Utxo> => {
        const read = (await rpc('getblock', hash, 2)) as { tx: { txid: string; vout: { value: number }[] }[] };
        const [tx] = read.tx;
        if (tx === undefined) throw new Error('no coinbase');
        return { transactionHash: hexToBin(tx.txid), index: 0, output: { lockingBytecode: funderLocking, valueSatoshis: BigInt(Math.round((tx.vout[0]?.value ?? 0) * 1e8)) } };
      };
      const [paryonCoin, factoryCoin] = await Promise.all(hashes.slice(0, 2).map(coinbase));
      const deployed = localDeployment({ funder, paryonCoin: paryonCoin as Utxo, factoryCoin: factoryCoin as Utxo, price: PRICE, period: 1 });
      for (const built of deployed.transactions) await rpc('sendrawtransaction', hex(built.encoded));
      await block();
      facts.deployment = deployed.deployment;
      keep();
      await until('the deployment at the server', async () => {
        const state = await readParyonState(server, contracts());
        return state.borrowing.length > 0 && state.price.length > 0 && state.loanKeyFactory.length > 0 && state.manage.length > 0;
      });
      note(`Paryon's contracts as published (\`@paryonusd/contracts\` 1.1.0) were deployed on the local chain by this script, with categories of its own: PUSD \`${deployed.deployment.tokenIds.paryon}\`, factories \`${deployed.deployment.tokenIds.loanKeyFactory}\`; two Borrowing threads in period 1, two price threads at ${dollars(PRICE)}, two manage NFTs and two key factories. Paryon's fee goes to the address that paid for the run.`);
      return undefined;
    });
    if (facts.funderAtStart === undefined) {
      const coins = await until('the funder\'s coins', async () => { const found = await funderCoins(); return found.length > 0 ? found : undefined; });
      facts.funderAtStart = String(coins.reduce((sum, coin) => sum + coin.output.valueSatoshis, 0n));
      keep();
    }
    account = await openAccount(facts.words.owner, "the owner's device");
    const wallet = await OwnerWallet.open({ backend: account, chain, seed: ownerSeed, ...(facts.ownerState === undefined ? {} : { state: facts.ownerState }), save: (state) => { facts.ownerState = state; keep(); } });
    const funding = await wallet.fundingAddress();
    await once('the wallet is funded', async () => ({ transactionIds: [await funderPays([{ lockingBytecode: funding, valueSatoshis: 80_000n }])] }));
    if ((await wallet.creationStep()) !== 'created') {
      await until('the funding coin in the engine', async () => (await wallet.creationStep()) !== 'not funded');
      await wallet.create({ recovererKeyHash: credential.recoveryKey.keyHash, challengeDelay: { unit: 'time512', value: 1 } });
      await wallet.pay([{ lockingBytecode: p2pkhLockingBytecode(credential.feeKey.keyHash), valueSatoshis: RECOVERER_COINS }]);
      facts.identity = wallet.stored.identity as string;
      keep();
    }
    const createdAt = wallet.stored.creation.createTransactionId;
    if (createdAt !== undefined) {
      const bytes = ((await until('the transaction', async () => server.getTransaction(createdAt))) as string).length / 2;
      record('create', { transactionId: createdAt, bytes, feeSatoshis: BigInt(bytes) }, 'the controller and the rest');
    }
    const created = await once('the wallet holds its first coin', async () => {
      const first = await until('the wallet\'s first coin', async () => { const now = await wallet.balance(); return now.recoverable > 0n ? now : undefined; });
      return { data: { recoverable: String(first.recoverable) } };
    });
    // What the loan takes: the collateral, Paryon's fee, the collateral added later, and a margin for the keys' coins and the fees.
    const collateral = collateralAtRatio(DEBT, PRICE, PERCENT);
    const fee = borrowingFee(DEBT, PRICE);
    const pay = collateral + fee + MANAGE_ADD + 50_000n;
    const arrived = BigInt(created['recoverable'] as string) + pay;
    const identity = hexToBin(facts.identity as string);
    const given = await once('an address is given out', async () => ({ data: { first: (await wallet.receiveAddress()).address.number } }));
    await once('someone pays the wallet', async () => {
      const transactionId = await funderPays([{ lockingBytecode: wallet.address(0, given['first'] as number).lockingBytecode, valueSatoshis: pay }]);
      record('pay the wallet', await sentAs(transactionId), `${sat(pay)} from the funder to an address the wallet gave out, as output 0`);
      return { transactionIds: [transactionId] };
    });
    await block();
    // A run continued after the key was made finds that coin spent already.
    if (facts.steps['a loan key is made'] === undefined) await until('the coin in the wallet', async () => (await wallet.balance()).recoverable === arrived);

    if (facts.ownerArrangement === undefined) {
      facts.ownerArrangement = { archive: newArchive(STORES), earlierArchives: [], earlierViewingKeyRecords: [] };
      keep();
    }
    const applications = new Applications(wallet.parts, { archive: applicationArchive({ arrangement: () => facts.ownerArrangement, storeAt, seed: ownerSeed, identity, chain }) });
    const { link, ask } = thePage(applications, wallet);
    facts.loan ??= { collateral: String(collateral) };
    keep();

    // 1. A loan key. The page names a factory of Paryon's it read from the chain. The key is made from the wallet's
    // coin and waits in Paryon's contract: the wallet asks for the user's tick, and the user gives it.
    const made = await once('a loan key is made', async () => {
      const state = await readParyonState(server, contracts());
      const [factory] = state.loanKeyFactory;
      if (factory === undefined) throw new Error('no factory');
      const outcome = await ask(createKeyRequestAlone(template().names, { factory, page: PAGE }), 'Making a loan key', true);
      record('make a loan key', await sentAs(outcome.transactionId), 'from the page\'s request, with the user\'s tick: the wallet\'s coin that is output 0 defines the key\'s category (input 0); Paryon\'s factory, named by the page; the key waits in Paryon\'s contract; output 0 is what the wallet keeps of its coin');
      return { transactionIds: [outcome.transactionId], data: { transactionId: outcome.transactionId } };
    });
    const madeId = made['transactionId'] as string;
    const madeTransaction = decodeTransactionBch(hexToBin((await until('the key\'s transaction', async () => server.getTransaction(madeId))) as string));
    if (typeof madeTransaction === 'string') throw new Error(madeTransaction);
    const keyCategory = hex(madeTransaction.inputs[0]?.outpointTransactionHash as Uint8Array);
    (facts.loan as { keyCategory?: string }).keyCategory = keyCategory;
    keep();
    note(`After the key was made the wallet holds ${applications.positionRecords.length} position record: the key is in Paryon's contract, not in the wallet, and the wallet follows nothing there.`, 'no record for the key yet');

    // 2. Bring the Borrowing thread up to date, so that the loan is charged no interest for the periods before.
    await once('the Borrowing thread is brought up to date', async () => {
      await block();
      const height = (await server.tip()).height - 1;
      const state = await readParyonState(server, contracts());
      const [thread] = state.borrowing.slice().sort((a, b) => (b.supply > a.supply ? 1 : -1));
      if (thread === undefined) throw new Error('no Borrowing thread');
      if (thread.period >= periodAt(contracts().deployment, height)) return undefined;
      const outcome = await ask(movePeriodRequestAlone(template().names, contracts(), { borrowing: thread, lockHeight: height, page: PAGE }), 'Bringing Paryon up to date');
      record('bring the Borrowing thread up to date', await sentAs(outcome.transactionId), `from the page's request: the thread named by the page, moved from period ${thread.period} to ${periodAt(contracts().deployment, height)} (lock time ${height}); its supply as the page read it`);
      amount(`period ${thread.period} moved to ${periodAt(contracts().deployment, height)} (lock time ${height}); the loan's interest starts there`, 'Borrowing thread');
      return { transactionIds: [outcome.transactionId] };
    });
    await block();

    // 3. Borrow: the page names the thread, the price, the key waiting in Paryon's contract and its proof.
    const opened = await once('100.00 PUSD are borrowed', async () => {
      const state = await readParyonState(server, contracts());
      // The thread in the latest period, the one just brought up to date; of those, the one that can lend the most.
      const [thread] = state.borrowing.slice().sort((a, b) => b.period - a.period || (b.supply > a.supply ? 1 : b.supply < a.supply ? -1 : 0));
      const [price] = state.price.slice().sort((a, b) => (b.state.price > a.state.price ? 1 : -1));
      if (thread === undefined || price === undefined) throw new Error('no thread or price');
      const at = (index: number): Utxo => ({ transactionHash: hexToBin(madeId), index, output: madeTransaction.outputs[index] as Output });
      const outcome = await ask(borrowRequestAlone(template().names, { borrowing: thread, price, enforcer: at(2), proof: at(3), debt: DEBT, collateral, startingInterest: 0, page: PAGE }), 'Borrowing');
      record('borrow', await sentAs(outcome.transactionId), `from the page's request: ${pusd(DEBT)} PUSD against ${sat(collateral)} of collateral, Paryon's fee ${sat(fee)}, starting interest 0; the page named the Borrowing thread, the price, the key waiting in Paryon's contract and its proof, and gave the values it read from them; the key and the PUSD to fresh addresses of the wallet; the record of the key on both stores before the engine signed`);
      amount(`${pusd(DEBT)} PUSD`, 'Debt');
      amount(`${sat(collateral)}: ${PERCENT}% of the debt at the stored price ${dollars(PRICE)}; Paryon's fee ${sat(fee)}, paid to the address that paid for the run`, 'Collateral');
      return { transactionIds: [outcome.transactionId] };
    });
    void opened;
    await block();
    const [written] = applications.positionRecords;
    note(`The earlier device holds ${applications.positionRecords.length} position record, written when the key reached the wallet: the key ${written?.token?.category.slice(0, 12)}… (${written?.token?.capability}, commitment "${written?.token?.commitment}"), the template, ${written?.lockingScriptIdentifier === undefined ? 'no script (the loan is at Paryon\'s shared contracts)' : `the script ${written.lockingScriptIdentifier}`}, the values ${Object.keys(written?.values ?? {}).join(', ')}, and the page's address ${written?.applicationPage}.`, 'the record written');
    note(`${noDeclaration(applications, 'The earlier device')}.`, 'no declaration on the earlier device');
    const reported = await link.requests.recordedPositions(template().names.identifier);
    note(`The wallet answered the page's positions request (version 2): ${JSON.stringify(reported)}. Whether the loan is open the page finds out itself.`, 'the answer before');
    const found = await until('the page to find the loan', async () => findLoan(server, contracts(), hexToBin(keyCategory)));
    note(`The page found the loan from the key, through its sidecar: the loan at ${hex(found.loan.transactionHash).slice(0, 16)}…:${found.loan.index} with ${sat(found.loan.output.valueSatoshis)}, debt ${pusd(found.state.borrowed)} PUSD; the sidecar at …:${found.sidecar.index}.`, 'the page finds the loan');

    // 4. Add collateral: the page names the loan, its sidecar, the price and a manage function, and the key's coin value.
    await once('collateral is added', async () => {
      const { coins } = await readLoanForPage(link, keyCategory);
      const outcome = await ask(manageRequestAlone(template().names, { ...coins, collateral: coins.loan.output.valueSatoshis + MANAGE_ADD }), 'Adding collateral');
      record('add collateral', await sentAs(outcome.transactionId), `from the page's request: ${sat(MANAGE_ADD)} more collateral; the page named the price, the loan, its sidecar and a manage function, and gave the key's coin value as the wallet reported it; the key back to the address it was spent from (\`return\`)`);
      return { transactionIds: [outcome.transactionId] };
    });
    await block();
    const after = await until('the loan with the collateral added', async () => { const now = await findLoan(server, contracts(), hexToBin(keyCategory)); return now !== undefined && now.loan.output.valueSatoshis === collateral + MANAGE_ADD ? now : undefined; });
    facts.loan = { keyCategory, collateral: String(after.loan.output.valueSatoshis) };
    keep();
    const balance = await until('the wallet after the loan', async () => { const now = await wallet.balance(); return now.tokens.length === 2 ? now : undefined; });
    facts.held = String(balance.recoverable + balance.tokens.reduce((sum, coin) => sum + coin.utxo.output.valueSatoshis, 0n));
    keep();
    note(`The old device holds the loan key and ${pusd(DEBT)} PUSD at its addresses, and ${sat(balance.recoverable)} without tokens; the loan holds ${sat(after.loan.output.valueSatoshis)}. Then the device is lost, with the loan open.`, 'what the old device holds');
  }

  if (phase === 'the recoverer recovers') {
    const identity = hexToBin(facts.identity as string);
    account = await openAccount(facts.words.credential, 'the recoverer');
    const funds = await RecovererFunds.open({ backend: account, chain });
    const recoverer = await RecovererWallet.open({ funds, chain, identity, recoveryKey: credential.recoveryKey });
    const fees = recoveryFees();
    const before = await recoverer.state();
    if (hex(before.ownerKeyHash) !== hex(newSeed.controllerKey.keyHash)) {
      if (before.status === 'active') {
        await until('the recoverer\'s balance', async () => { const now = await funds.balance(); return now >= fees.request + fees.completion ? now : undefined; });
        const requested = await recoverer.request(newSeed.controllerKey.keyHash);
        record('request', requested, 'the recoverer names the new device\'s key; paid from its balance in the same transaction');
        await confirmed(requested.transactionId);
      }
      await until('the request in the engine', async () => (await recoverer.state()).status === 'pending');
      // The waiting period: 512 seconds of the chain's own time, moved on as the earlier runs do.
      const now = (await rpc('getblockheader', await rpc('getbestblockhash'))).time as number;
      await rpc('setmocktime', now + 700);
      await mine(11, BURN);
      await until(
        'the waiting period on the chain\'s clock',
        async () => {
          const request = (await readControllerHistory(chain, identity)).transactions.at(-1);
          const confirmations = request === undefined ? 0 : ((await server.confirmations(request.transactionId)) ?? 0);
          if (confirmations < 1) return false;
          const tip = await server.tip();
          return (await medianTime(tip.height)) >= (await medianTime(tip.height - confirmations)) + 512;
        },
        10 * 60_000,
      );
      const completed = await until(
        'the waiting period to pass',
        async () => {
          try {
            return await recoverer.complete();
          } catch (error) {
            if (/non-?BIP68-final/i.test(String((error as Error).message))) return undefined;
            throw error;
          }
        },
        10 * 60_000,
      );
      record('complete', completed, 'after the waiting period; no coin has moved, the loan is still open under the key the earlier seed holds');
      await rpc('setmocktime', 0);
      await block();
    }
  }

  if (phase === 'the new device closes the loan from the page') {
    const identity = hexToBin(facts.identity as string);
    account = await openAccount(facts.words.next, 'the new device');
    const save = (state: OwnerWalletState): void => { facts.newState = state; keep(); };
    const wallet = facts.newState === undefined
      ? await OwnerWallet.takeOver({ backend: account, chain, seed: newSeed, identity, earlierViewingKeys: [ownerSeed.viewingKey], save })
      : await OwnerWallet.open({ backend: account, chain, seed: newSeed, state: facts.newState, save });
    if ((await wallet.checkOwnership()) === 'closed') {
      say('  (the wallet is closed: done before)');
    } else {
      const keyCategory = facts.loan?.keyCategory as string;
      const full = await wallet.search();
      note(`The new device's search over both seeds ended as "${full.status}".`, 'the search');
      if (facts.steps['the new device sweeps'] === undefined) {
        await until('the earlier coins in the engine', async () => (await wallet.balance()).toSweep === BigInt(facts.held as string));
        const sent = await wallet.sweepEarlier();
        for (const transaction of sent.transactions) record('sweep', transaction, `${sent.coins} coins of the earlier seed, the loan key and the PUSD among them, to addresses of the new seed, in a transaction of its own (the sweep needs the controller at input 0; Paryon's actions need their price contract there)`);
        facts.steps['the new device sweeps'] = { transactionIds: sent.transactions.map((transaction) => transaction.transactionId) };
        keep();
      }
      await block();
      await until('the swept key and PUSD at addresses of the new seed', async () => { const now = await wallet.balance(); return now.toSweep === 0n && now.tokens.length === 2; });

      // The new device's own archive, with the earlier one's records copied into it (section 10.6).
      if (facts.newArrangement === undefined || (facts.newArrangement.copiedArchives ?? []).length === 0) {
        const copied = await copyEarlierArchives({ arrangement: facts.newArrangement ?? { archive: newArchive(STORES), earlierArchives: [(facts.ownerArrangement as RecoveryArrangement).archive], earlierViewingKeyRecords: [] }, storeAt, whetherSent: actionSent(wallet.parts) });
        facts.newArrangement = copied.arrangement;
        keep();
        if (copied.unfinished.length > 0) throw new Error(`the earlier archive was not copied in full: ${copied.unfinished.join(' ')}`);
        note(`The new device copied ${copied.copied} records of the earlier archive into its own.`, 'the copy');
      }
      const applications = new Applications(wallet.parts, { archive: applicationArchive({ arrangement: () => facts.newArrangement, storeAt, seed: newSeed, identity, chain }) });
      await once('the new device reads the record from a store', async () => {
        await applications.readBackup();
        const [suggestedRecord] = applications.suggestedRecords;
        if (suggestedRecord === undefined) throw new Error('the backup held no position record');
        facts.record = suggestedRecord;
        keep();
        const [suggested] = applications.suggestions;
        if (suggested === undefined || suggested.identifier !== template().names.identifier) throw new Error('the backup did not hold Paryon\'s template');
        if (suggested.declaration !== undefined || suggested.texts.declaration !== undefined) throw new Error('the backup held a declaration');
        note(`The new device read the record of the key from a store, the earlier seed's, a suggestion; the backup held Paryon's template as the earlier owner stored it, with no declaration.`);
        await applications.trust(suggested, undefined);
        note(`The user trusted the template "${suggested.name}" the earlier owner stored, on the user's word.`);
        const check = await checkPositionRecord(suggestedRecord, wallet.parts, readTemplate(template().texts.template));
        note(`The check of section 10.4 found that the record ${check.counts ? 'counts' : 'does not count'}: ${check.reason}`);
        const confirmation = await applications.confirmRecords();
        note(`The record was written again as the new owner's own on the stores (${confirmation.confirmed} record); it names no script, so nothing was handed to the engine (${confirmation.followed} scripts).`);
        return undefined;
      });
      const [position] = await applications.recordedPositions();
      if (position === undefined) throw new Error('the key is not listed');
      note(`The new device lists the key from the record: "${position.status}", ${position.standing === 'own' ? 'a record of its own' : 'a record of the earlier seed'}, under the template "${position.template.name}", the key at ${position.token.place === 'address' ? 'an address of the new seed' : position.token.place}; whether the loan is open is the page's to say.`, 'the key listed');
      // The wallet by itself: it offers nothing it can do alone, and sends the user to the page the record names.
      const offered = applications.offeredActions(position);
      const byItself = await applications.carryOut(applications.actionOn(position, 'close')).then(
        () => undefined,
        (error: unknown) => error,
      );
      if (!(byItself instanceof NeedsApplicationError)) throw new Error(`the wallet did not send the user to the page: ${String(byItself)}`);
      note(`From its own list the wallet offers ${offered.length} actions for the key, and asked to close the loan by itself it answers: "${byItself.message}" (the page: ${byItself.page}).`, 'the wallet sends the user to the page');

      // The page on the new phone: connected afresh, it is told of the key once the user allows it, finds the loan and closes it.
      await once('the page closes the loan', async () => {
        const { link, ask } = thePage(applications, wallet);
        const asked = await link.requests.recordedPositions(template().names.identifier);
        note(`The page on the new phone asked which keys of its template the wallet holds: ${asked.trusted ? 'answered' : 'not answered, since the template came from the backup and this page has not been allowed yet'}.`);
        applications.allow(template().names.identifier, 'the loan page');
        const { coins, state } = await readLoanForPage(link, keyCategory);
        note(`Once the user allowed the page, the wallet answered ${JSON.stringify((await link.requests.recordedPositions(template().names.identifier)).positions)}; the page found the loan from the key: ${sat(coins.loan.output.valueSatoshis)}, debt ${pusd(state.borrowed)} PUSD.`);
        const outcome = await ask(closeRequestAlone(template().names, coins), 'Closing the loan on the new phone');
        record('close the loan', await sentAs(outcome.transactionId), 'from the page\'s request on the new phone: the page named the price, the loan, its sidecar and a manage function, and gave the loan\'s record, the debt and the key\'s coin value as the wallet reported it; the whole debt repaid, the PUSD and the loan\'s record sent to data outputs, the sidecar not carried on; the collateral and the key to fresh addresses of the new seed');
        const record_ = decodeLoanState(coins.loan.output.token?.nft?.commitment as Uint8Array);
        amount(`the loan held ${sat(coins.loan.output.valueSatoshis)} and a debt of ${pusd(record_.borrowed)} PUSD; the collateral came back to addresses of the new seed, and the PUSD repaid were destroyed`, 'Closing');
        return { transactionIds: [outcome.transactionId] };
      });
      await block();
      await until('the loan closed', async () => ((await findLoan(server, contracts(), hexToBin(keyCategory))) === undefined ? true : undefined));
      note(`After closing, the page finds no loan for the key; the key is still in the wallet (${(await wallet.balance()).tokens.length === 1}); the wallet holds no PUSD. ${noDeclaration(applications, 'The new device')}.`, 'the loan closed');

      await once('the key is sent on', async () => {
        const holding = await until('the key', async () => { const now = await wallet.balance(); return now.tokens.length === 1 && now.toSweep === 0n ? now.tokens[0] : undefined; });
        const sent = await wallet.sendToken(holding, funderLocking);
        record('send the key on', sent, 'the loan key, unchanged, to the address that paid for the run');
        return { transactionIds: [sent.transactionId] };
      });
      await block();
      await until('the wallet without a token', async () => (await wallet.balance()).tokens.length === 0);
      await wait(1_500);
      const closing = await wallet.close(funderLocking);
      for (const sent of closing.transactions) record('close the wallet', sent, 'everything, and the controller\'s value, back to the address that paid for the run');
      await block();
    }
    const history = await until('the closing', async () => { const read = await readControllerHistory(chain, identity); return read.closed === undefined ? undefined : read; });
    note(`The controller's history: ${history.transitions.map((step) => step.kind).join(', ')}, then closed. It has had ${history.owners.length} owners.`, 'the closing');
  }

  if (phase === 'the recoverer returns its balance') {
    await once('the recoverer returns its balance', async () => {
      account = await openAccount(facts.words.credential, 'the recoverer');
      const funds = await RecovererFunds.open({ backend: account, chain });
      await until('the recoverer\'s balance', async () => (await funds.balance()) > 0n);
      const [sent] = (await funds.sendEverything(funderLocking)).transactions;
      if (sent === undefined) return {};
      record('return the recoverer\'s balance', sent, 'what the recoverer did not use');
      return { transactionIds: [sent.transactionId] };
    });
    await block();
  }

  if (phase === 'the run returns what is left') {
    await once('the key is destroyed', async () => {
      const nfts = await until('the key at the funder', async () => { const found = await server.listUnspent(funderLocking, 'only'); return found.length > 0 ? found : undefined; });
      const extra: Utxo[] = nfts.map((entry) => ({
        transactionHash: hexToBin(entry.transactionId),
        index: entry.index,
        output: {
          lockingBytecode: funderLocking,
          valueSatoshis: entry.valueSatoshis,
          token: { amount: entry.token?.amount ?? 0n, category: hexToBin(entry.token?.category ?? ''), ...(entry.token?.nft === undefined ? {} : { nft: { capability: entry.token.nft.capability, commitment: hexToBin(entry.token.nft.commitment) } }) },
        },
      }));
      const transactionId = await funderPays([], { burn: true, extraInputs: extra });
      record('destroy the key', await sentAs(transactionId), 'the funder spends the loan key without carrying it on, and keeps its satoshis');
      return { transactionIds: [transactionId] };
    });
    await block();
    const identity = hexToBin(facts.identity as string);
    const total = await until('the funder\'s coins', async () => { const coins = await funderCoins(); return coins.length > 0 ? coins.reduce((sum, coin) => sum + coin.output.valueSatoshis, 0n) : undefined; });
    const places: [string, Uint8Array][] = [
      ['the wallet\'s funding address', p2pkhLockingBytecode(ownerSeed.fundingKey.keyHash)],
      ['the new device\'s funding address', p2pkhLockingBytecode(newSeed.fundingKey.keyHash)],
      ['the recoverer\'s balance', p2pkhLockingBytecode(credential.feeKey.keyHash)],
    ];
    const left: string[] = [];
    for (const [name, lockingBytecode] of places) {
      const sum = (await server.listUnspent(lockingBytecode)).reduce((value, entry) => value + entry.valueSatoshis, 0n);
      if (sum > 0n) left.push(`${sum} at ${name}`);
    }
    for (const seed of [ownerSeed, newSeed]) {
      const { quickPass } = await import('@grandmas-wallet/core');
      const found = (await quickPass(chain, identity, seed.viewingKey)).found.flatMap((address) => address.coins);
      if (found.length > 0) left.push(`${found.length} coins at addresses of a seed`);
    }
    if ((await findLoan(server, contracts(), hexToBin(facts.loan?.keyCategory as string))) !== undefined) left.push('the loan');
    const spent = BigInt(facts.funderAtStart as string) - total;
    amount(`${sat(BigInt(facts.funderAtStart as string))} before the run (after deploying Paryon's contracts), ${sat(total)} after it`, 'Funder');
    note(`The funding address held ${facts.funderAtStart} satoshis before the run and holds ${total} after it: the run cost ${spent} satoshis in network fees (Paryon's fee went to the same address and came back). ${left.length === 0 ? 'Nothing is left anywhere else: no PUSD (all of it was destroyed at the closing), no loan key (destroyed by the funder), no coin at the wallet\'s or the recoverer\'s addresses, and no loan. Paryon\'s deployment stays on the local chain.' : `LEFT BEHIND: ${left.join('; ')}.`}`);
    if (left.length > 0) throw new Error(`coins were left behind: ${left.join('; ')}`);
  }
  if (!facts.finished.includes(phase)) facts.finished.push(phase);
  keep();
} catch (error) {
  say(`FAILED: ${(error as Error).name}: ${String((error as Error).message).slice(0, 700)}\n${String((error as Error).stack).split('\n').slice(1, 5).join('\n')}`);
  process.exitCode = STOPPED;
} finally {
  await rpc('setmocktime', 0).catch(() => undefined);
  await server.disconnect().catch(() => undefined);
  await account?.close();
  process.exit();
}
