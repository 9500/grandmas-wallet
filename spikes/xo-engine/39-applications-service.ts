// Trial: an action of a template with a service, carried out through the wallet's handling of applications
// (`Applications`) with the page closed, on the local node. The wallet side is the wallet's own code on the real XO
// engine (`Account`), under a small stand-in for the owner's wallet that hands `Applications` the account's ordinary
// coins and address; the service is a separate process with its own engine and seed, an HTTP server on 127.0.0.1 that
// answers `xo_service_v1` with `answerServiceRequest`, as in trial 38. The template is trial 38's minimal two-role
// template with a resource that names the service.
//
// Steps: the user trusts the template (the wallet asks the service hello and what is possible); the template's
// starting action is offered under it; the user carries it out with an amount: the review is worked out with the
// service (the wallet's figures and the service's value apart), the approval finishes the invitation the service
// joined, and the transaction is sent and confirmed in a block; the service is asked again what is possible.
//
// usage (from packages/app): timeout 300 npx tsx ../../spikes/xo-engine/39-applications-service.ts
import 'fake-indexeddb/auto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { type ServiceHandlers, answerServiceRequest } from '@grandmas-wallet/connect';
import { type AccountCoin, type Utxo, buildTransaction, keyPairFromPrivateKey, p2pkhInput, p2pkhLockingBytecode, readTemplate, templateLockingBytecode, templateUnlockingBytecode } from '@grandmas-wallet/core';
import { type Engine, XO_SUPPORTED_NETWORKS, validateInvitation } from '@xo-cash/engine';
import type { XOTemplate } from '@xo-cash/types';
import { deserializeInvitation, serializeInvitation } from '@xo-cash/utils';
import { Account } from '../../packages/app/src/account.ts';
import { type ApplicationsState, Applications } from '../../packages/app/src/applications.ts';
import type { ReservedAddress, WalletParts } from '../../packages/app/src/owner-wallet.ts';
import { Electrum } from '../../packages/chipnet/src/electrum.ts';
// @ts-expect-error plain script
import { openEngineRegtest, mine, rpc, BURN } from './regtest.mjs';
// @ts-expect-error plain script
import { DATA } from './common.mjs';

const engineErrors: string[] = [];
console.error = (...args: unknown[]) => engineErrors.push(String(args[0]).slice(0, 300));
const hex = binToHex;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errorText = (error: unknown) => `${(error as Error).name}: ${String((error as Error).message).replace(/\s+/g, ' ').slice(0, 400)}`;
const json = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? hex(v) : v));
const SELF = fileURLToPath(import.meta.url);
const NETWORK = 'regtest';

// --- The template: trial 38's, with a resource naming the service -------------------------------------------
const view = (name: string, description: string) => ({ name, description });
const templateFor = (port: number) =>
  ({
    $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
    ...view('Two-party trial 39', 'A user and a service: the service brings a coin at a shared script and a price; the user is paid an amount plus that price.'),
    version: '1',
    supported: ['BCH_2026_05'],
    resources: [{ name: 'xo_service_v1', description: 'The trial\'s service', url: `http://127.0.0.1:${port}/xo` }],
    roles: { user: view('User', 'The wallet.'), service: view('Service', 'The application\'s service.') },
    start: [{ action: 'act', role: 'user' }],
    actions: {
      act: {
        ...view('Act', 'The service brings its coin and price; the user is paid.'),
        roles: { user: { requirements: { variables: ['userAmount', 'userHolder'] } }, service: { requirements: { variables: ['servicePrice'] } } },
        requirements: { participants: [{ role: 'user', slots: { min: 1, max: 1 } }, { role: 'service', slots: { min: 1, max: 1 } }] },
        transaction: 'actTransaction',
      },
    },
    transactions: {
      actTransaction: {
        ...view('Acted', 'The user was paid.'),
        inputs: [{ input: 'sharedInput', inputIndex: 0 }],
        outputs: [{ output: 'sharedOutput', outputIndex: 0 }, { output: 'userOutput', outputIndex: 1 }],
        version: 2,
        locktime: 0,
      },
    },
    inputs: { sharedInput: { ...view('Shared coin', 'A coin at the shared script, brought by the service.'), unlockingScript: 'unlockShared' } },
    outputs: {
      sharedOutput: { ...view('Shared coin', 'Put back.'), lockingScript: 'sharedScript', valueSatoshis: '2000' },
      userOutput: { ...view('To the user', 'The amount plus the service\'s price.'), lockingScript: '$(<userHolder>)', valueSatoshis: '$(<userAmount> <servicePrice> OP_ADD)' },
    },
    lockingScripts: {
      sharedScript: {
        ...view('Shared script', 'Anyone may spend it with a positive number.'),
        lockingType: 'p2sh',
        lockingBytecode: 'sharedBytecode',
        selectable: false,
        roles: { user: { selectable: false, relevant: false }, service: { selectable: false, relevant: false } },
      },
    },
    scripts: { sharedBytecode: 'OP_0 OP_GREATERTHAN', unlockShared: '<servicePrice>' },
    variables: {
      userAmount: { ...view('Amount', 'Satoshis to the user.'), type: 'satoshis' },
      userHolder: { ...view('Holder', 'The user\'s address.'), type: 'locking_script' },
      servicePrice: { ...view('Price', 'The service\'s price.'), type: 'integer' },
    },
  }) as unknown as XOTemplate;
const PRICE = 7n;

// --- The service: a process of its own with its own engine and seed ----------------------------------------
interface ServiceJob {
  account: string;
  port: number;
  shared: { transactionHash: string; index: number }[];
  readyFile: string;
}

const runService = async (job: ServiceJob) => {
  const trialTemplate = templateFor(job.port);
  const text = JSON.stringify(trialTemplate);
  const engine: Engine = await openEngineRegtest(job.account);
  const { templateIdentifier } = await engine.importTemplate(text);
  const template = (await engine.getTemplate(templateIdentifier)) as XOTemplate;
  const name = { identifier: templateIdentifier, contentHash: readTemplate(text).contentHash };
  let next = 0;
  const handlers: ServiceHandlers = {
    hello: (request) => (request.template.identifier === name.identifier ? { ok: true, serves: [{ template: name, role: 'service' }] } : { ok: false, error: 'This service does not serve that template.', code: 'unknown-template' }),
    possible: () => ({ ok: true, height: 0, start: [{ action: 'act', available: next < job.shared.length }], items: [] }),
    join: async (request) => {
      const received = deserializeInvitation(request.invitation);
      try {
        validateInvitation(received, template, XO_SUPPORTED_NETWORKS.chipnet);
      } catch (error) {
        return { ok: false, error: `The invitation is not valid: ${errorText(error).slice(0, 120)}`, code: 'bad-invitation' };
      }
      const coin = job.shared[next++];
      if (coin === undefined) return { ok: false, error: 'No shared coin is left.', code: 'inputs-spent' };
      const variables = [{ variableIdentifier: 'servicePrice', roleIdentifier: 'service', value: PRICE }];
      const inputs = [{ outpointTransactionHash: hexToBin(coin.transactionHash), outpointIndex: coin.index, inputIdentifier: 'sharedInput', roleIdentifier: 'service', unlockingBytecode: templateUnlockingBytecode(trialTemplate, 'sharedScript', 'sharedInput', { servicePrice: PRICE }), sequenceNumber: 0 }];
      const outputs = [{ outputIdentifier: 'sharedOutput', roleIdentifier: 'service' }];
      const invitationIdentifier = (await engine.acceptInvitation(received, { roleIdentifier: 'service', variables, inputs, outputs } as unknown as Parameters<Engine['acceptInvitation']>[1])).invitation.invitationIdentifier;
      const stored = await engine.getInvitation(invitationIdentifier);
      if (stored === undefined) throw new Error('the service lost its invitation');
      await engine.archiveInvitation(invitationIdentifier).catch(() => undefined);
      return { ok: true, invitation: serializeInvitation(stored.invitation) };
    },
  };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      answerServiceRequest({ method: request.method ?? 'GET', body: new Uint8Array(Buffer.concat(chunks)) }, { [NETWORK]: handlers })
        .then((answer) => {
          response.writeHead(answer.status, answer.headers);
          response.end(answer.body);
        })
        .catch(() => {
          response.writeHead(500);
          response.end();
        });
    });
  });
  server.listen(job.port, '127.0.0.1', () => writeFileSync(job.readyFile, 'ready'));
};

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = netServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });

if (process.argv[2] === 'service') {
  await runService(JSON.parse(readFileSync(process.argv[3]!, 'utf8')) as ServiceJob);
} else {
  // --- The wallet -------------------------------------------------------------------------------------------
  const RUN = String(Date.now());
  const results: Record<string, unknown> = {};
  const note = (key: string, value: unknown) => {
    results[key] = value;
    console.log(`${key}: ${json(value)}`);
  };
  const account = await Account.open(await openEngineRegtest(`trial39-wallet-${RUN}`));
  const chain = await Electrum.connect('ws://127.0.0.1:60403');
  let service: ReturnType<typeof spawn> | undefined;
  try {
    const port = await freePort();
    const text = JSON.stringify(templateFor(port));
    const read = readTemplate(text);
    const sharedLocking = templateLockingBytecode(read.definition, 'sharedScript', {});
    const walletAddress = await account.ordinaryAddress();

    // Funding: a plain key's coinbase coin pays three coins to the wallet and two to the shared script.
    const funder = keyPairFromPrivateKey(crypto.getRandomValues(new Uint8Array(32)));
    const funderLocking = p2pkhLockingBytecode(funder.keyHash);
    const [blockHash] = (await mine(1, hex(funderLocking))) as string[];
    await mine(100, BURN);
    const block = await rpc('getblock', blockHash, 2);
    const coinbase: Utxo = { transactionHash: hexToBin(block.tx[0].txid), index: 0, output: { lockingBytecode: funderLocking, valueSatoshis: BigInt(Math.round(block.tx[0].vout[0].value * 1e8)) } };
    const funding = buildTransaction({
      inputs: [p2pkhInput(coinbase, funder)],
      outputs: [...Array.from({ length: 3 }, () => ({ lockingBytecode: walletAddress, valueSatoshis: 100_000n })), ...Array.from({ length: 2 }, () => ({ lockingBytecode: sharedLocking, valueSatoshis: 2000n }))],
      changeLockingBytecode: funderLocking,
    });
    await rpc('sendrawtransaction', hex(funding.encoded));
    await mine(1, BURN);
    const fundingId = hex(funding.transactionHash);
    let coins: AccountCoin[] = [];
    for (let i = 0; i < 60; i++) {
      coins = (await account.coins()).filter((coin) => hex(coin.utxo.transactionHash) === fundingId);
      if (coins.length >= 3) break;
      await wait(500);
    }
    if (coins.length < 3) throw new Error('the wallet did not list its three coins');

    // The service, in its own process.
    const readyFile = `${DATA}trial39-${RUN}-ready`;
    const jobFile = `${DATA}trial39-${RUN}-job.json`;
    writeFileSync(jobFile, JSON.stringify({ account: `trial39-service-${RUN}`, port, shared: [3, 4].map((index) => ({ transactionHash: fundingId, index })), readyFile } satisfies ServiceJob));
    service = spawn('npx', ['tsx', SELF, 'service', jobFile], { stdio: ['ignore', 'ignore', 'ignore'], detached: true });
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      await wait(250);
      try { ready = readFileSync(readyFile, 'utf8') === 'ready'; } catch { ready = false; }
    }
    if (!ready) throw new Error('the service did not start within 30 seconds');
    note('setup', { templateIdentifier: read.identifier, walletCoins: coins.length, sharedCoins: 2, port });

    // A stand-in for the owner's wallet: the account's ordinary coins and address, the applications' state in memory.
    let state: ApplicationsState | undefined;
    const reserved = (kinds: (1 | 2)[]): ReservedAddress[] => kinds.map((kind, number) => ({ address: { kind, number, lockingBytecode: walletAddress } as unknown as ReservedAddress['address'], fresh: true }));
    const parts: WalletParts = {
      backend: account,
      chain,
      feeRate: 1,
      requireUsable: () => undefined,
      ownCoins: async () => (await account.coins()).filter((coin) => hex(coin.utxo.output.lockingBytecode) === hex(walletAddress) && coin.utxo.output.token === undefined),
      tokenCoins: async () => (await account.coins()).filter((coin) => coin.utxo.output.token !== undefined).map((coin) => ({ coin, place: 'address' as const })),
      reserve: reserved,
      hold: async () => undefined,
      keep: () => undefined,
      giveBack: () => undefined,
      prepare: (request) => account.prepare(request),
      send: async (prepared) => void (await account.send(prepared)),
      payItself: () => Promise.reject(new Error('not in this trial')),
      quotePayItself: () => Promise.reject(new Error('not in this trial')),
      kept: () => state,
      store: (kept) => void (state = kept),
    };
    const fetches: string[] = [];
    const applications = new Applications(parts, {
      archive: { write: async () => ({ confirmedBy: ['memory'], failed: [] }) as never, read: async () => ({ templates: [], tokenNotes: [] }) },
      service: {
        network: NETWORK,
        kind: 'local',
        fetch: (url, init) => {
          fetches.push(String((JSON.parse(String(init.body)) as { xo_service_v1: { action: string } }).xo_service_v1.action));
          return fetch(url, init);
        },
      },
    });

    // The user trusts the template: hello, then what is possible.
    await applications.trust({ identifier: read.identifier, contentHash: read.contentHash }, { template: text }, undefined, { contact: true });
    note('trusted', { status: await applications.serviceContact(read.identifier), asked: [...fetches] });
    const offered = await applications.templateActions(read.identifier);
    note('offered', offered?.starting.map(({ action, asks, service: said }) => ({ action, asks: asks?.map(({ variable }) => variable), said })));

    // The starting action, with an amount: the review with the service, then the approval.
    const act = applications.startAction(read.identifier, 'act', { userAmount: '10000' });
    const started = Date.now();
    const preview = await applications.preview(act);
    note('review', { values: preview.words.values, service: preview.service, figures: { gives: preview.figures.givesSatoshis, gets: preview.figures.getsSatoshis, fee: preview.figures.feeSatoshis, fromApplication: preview.figures.fromApplication, toOthers: preview.figures.toOthers.map(({ name, satoshis }) => [name, satoshis]) }, ms: Date.now() - started });
    const outcome = await applications.carryOut(act);
    await mine(1, BURN);
    const raw = await rpc('getrawtransaction', outcome.transactionId, true);
    const transaction = decodeTransactionBch(hexToBin(raw.hex));
    if (typeof transaction === 'string') throw new Error(transaction);
    note('sent', {
      transactionId: outcome.transactionId,
      confirmations: raw.confirmations,
      inputs: transaction.inputs.map((input, i) => `${i}: ${hex(input.outpointTransactionHash).slice(0, 8)}:${input.outpointIndex} unlocking ${input.unlockingBytecode.length} B`),
      outputs: transaction.outputs.map((output, i) => `${i}: ${output.valueSatoshis} sat ${hex(output.lockingBytecode) === hex(sharedLocking) ? 'shared script' : hex(output.lockingBytecode) === hex(walletAddress) ? 'wallet' : hex(output.lockingBytecode).slice(0, 12)}`),
      fee: outcome.sent.feeSatoshis,
    });
    note('after', { status: applications.serviceOf(read.identifier), asked: fetches });
    writeFileSync(`${DATA}trial39-${RUN}-results.json`, json(results));
  } catch (error) {
    console.log('FAILED:', errorText(error));
    console.log('engine errors:', [...new Set(engineErrors)].slice(0, 5));
    process.exitCode = 1;
  } finally {
    if (service?.pid !== undefined) {
      try { process.kill(-service.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    await chain.disconnect().catch(() => undefined);
    await account.close();
    process.exit();
  }
}
