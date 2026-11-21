// Trial: the wallet's core for an action another participant joins, on the local node. The wallet side is the
// wallet's own code: `Account` (startShared, takeShared, finishShared, abandonShared), the client for a service
// (askServiceHello, askServiceJoin), `takeJoinedInvitation`, `checkOtherParticipant`, `planSharedFinish` and
// `builtAsPlanned`. The service is a separate process with its own XO engine and seed, an HTTP server on 127.0.0.1
// that answers `xo_service_v1` with `answerServiceRequest`; the invitation travels in the protocol's messages.
//
// The template is a minimal two-role template of this script's own (as in trial 36). The service joins in one
// commit: `acceptInvitation` with its role, its value, the shared coin with its unlocking and the shared output.
// Cases, each in an invitation of its own:
//
//   wallet-variable  the service states the user's amount and address again, tagged with its own role (trial 36, 7b)
//   forge-output     the service gives the shared output another script and amount than the template's (trial 36, 11)
//   two-commits      the service joins with acceptInvitation and then appendInvitation, as trial 36 did: two commits
//   honest           the honest answer: the wallet finishes, signs, sends; confirmed in a block
//
// The join request's `ref` (opaque to a wallet) carries the case to this trial's service.
//
// usage (from packages/app): timeout 600 npx tsx ../../spikes/xo-engine/38-shared-action-core.ts
import 'fake-indexeddb/auto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { type ServiceHandlers, answerServiceRequest } from '@grandmas-wallet/connect';
import { type AccountCoin, type Utxo, INPUT_BYTES, buildTransaction, keyPairFromPrivateKey, p2pkhInput, p2pkhLockingBytecode, templateLockingBytecode, templateUnlockingBytecode, textHash } from '@grandmas-wallet/core';
import { type Engine, XO_SUPPORTED_NETWORKS, validateInvitation } from '@xo-cash/engine';
import type { XOTemplate } from '@xo-cash/types';
import { deserializeInvitation, serializeInvitation } from '@xo-cash/utils';
import { type SentInvitation, Account } from '../../packages/app/src/account.ts';
import { askServiceHello, askServiceJoin, servedRole } from '../../packages/app/src/service-client.ts';
import { builtAsPlanned, planSharedFinish, takeJoinedInvitation } from '../../packages/app/src/shared-action.ts';
import { checkOtherParticipant } from '../../packages/app/src/shared-checks.ts';
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

// --- The template -------------------------------------------------------------------------------------------
const view = (name: string, description: string) => ({ name, description });
const trialTemplate = {
  $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
  ...view('Two-party trial 38', 'A user and a service: the service brings a coin at a shared script and a price; the user is paid an amount plus that price.'),
  version: '1',
  supported: ['BCH_2026_05'],
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
} as unknown as XOTemplate;
const TEMPLATE_TEXT = JSON.stringify(trialTemplate);
const SHARED_LOCKING = templateLockingBytecode(trialTemplate, 'sharedScript', {});
const PRICE = 7n;
const ELSEWHERE = hexToBin(`76a914${'77'.repeat(20)}88ac`);

// --- The service: a process of its own with its own engine and seed ----------------------------------------
interface ServiceJob {
  account: string;
  shared: { transactionHash: string; index: number }[];
  readyFile: string;
}

const runService = async (job: ServiceJob) => {
  const engine: Engine = await openEngineRegtest(job.account);
  const { templateIdentifier } = await engine.importTemplate(TEMPLATE_TEXT);
  const template = (await engine.getTemplate(templateIdentifier)) as XOTemplate;
  const name = { identifier: templateIdentifier, contentHash: textHash(TEMPLATE_TEXT) };
  let next = 0;
  const handlers: ServiceHandlers = {
    hello: (request) => (request.template.identifier === name.identifier ? { ok: true, serves: [{ template: name, role: 'service' }] } : { ok: false, error: 'This service does not serve that template.', code: 'unknown-template' }),
    possible: () => ({ ok: true, height: 0, start: [{ action: 'act', available: true }], items: [] }),
    join: async (request) => {
      const received = deserializeInvitation(request.invitation);
      // acceptInvitation checks no signature; the exported validator does.
      try {
        validateInvitation(received, template, XO_SUPPORTED_NETWORKS.chipnet);
      } catch (error) {
        return { ok: false, error: `The invitation is not valid: ${errorText(error).slice(0, 120)}`, code: 'bad-invitation' };
      }
      const mode = request.ref ?? 'honest';
      const coin = job.shared[next++];
      if (coin === undefined) return { ok: false, error: 'No shared coin is left.', code: 'inputs-spent' };
      const variables: { variableIdentifier: string; roleIdentifier: string; value: unknown }[] = [{ variableIdentifier: 'servicePrice', roleIdentifier: 'service', value: PRICE }];
      if (mode === 'wallet-variable') variables.push({ variableIdentifier: 'userAmount', roleIdentifier: 'service', value: 1n }, { variableIdentifier: 'userHolder', roleIdentifier: 'service', value: hex(ELSEWHERE) });
      const inputs = [{ outpointTransactionHash: hexToBin(coin.transactionHash), outpointIndex: coin.index, inputIdentifier: 'sharedInput', roleIdentifier: 'service', unlockingBytecode: templateUnlockingBytecode(trialTemplate, 'sharedScript', 'sharedInput', { servicePrice: PRICE }), sequenceNumber: 0 }];
      const outputs = [mode === 'forge-output' ? { outputIdentifier: 'sharedOutput', roleIdentifier: 'service', lockingBytecode: ELSEWHERE, valueSatoshis: 1500n } : { outputIdentifier: 'sharedOutput', roleIdentifier: 'service' }];
      let invitationIdentifier: string;
      if (mode === 'two-commits') {
        invitationIdentifier = (await engine.acceptInvitation(received, { roleIdentifier: 'service' })).invitation.invitationIdentifier;
        await engine.appendInvitation(invitationIdentifier, { variables, inputs, outputs } as unknown as Parameters<Engine['appendInvitation']>[1]);
      } else {
        invitationIdentifier = (await engine.acceptInvitation(received, { roleIdentifier: 'service', variables, inputs, outputs } as unknown as Parameters<Engine['acceptInvitation']>[1])).invitation.invitationIdentifier;
      }
      const stored = await engine.getInvitation(invitationIdentifier);
      if (stored === undefined) throw new Error('the service lost its invitation');
      // Nothing is kept for the next message.
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
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    writeFileSync(job.readyFile, String(typeof address === 'object' && address !== null ? address.port : 0));
  });
};

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
  const sent: SentInvitation[] = [];
  const account = await Account.open(await openEngineRegtest(`trial38-wallet-${RUN}`), { onSent: (invitation) => void sent.push(invitation) });
  const chain = await Electrum.connect('ws://127.0.0.1:60403');
  let service: ReturnType<typeof spawn> | undefined;
  try {
    const templateIdentifier = await account.importTemplate(TEMPLATE_TEXT);
    const walletAddress = await account.ordinaryAddress();

    // Funding: a plain key's coinbase coin pays four coins to the wallet and four to the shared script.
    const funder = keyPairFromPrivateKey(crypto.getRandomValues(new Uint8Array(32)));
    const funderLocking = p2pkhLockingBytecode(funder.keyHash);
    const [blockHash] = (await mine(1, hex(funderLocking))) as string[];
    await mine(100, BURN);
    const block = await rpc('getblock', blockHash, 2);
    const coinbase: Utxo = { transactionHash: hexToBin(block.tx[0].txid), index: 0, output: { lockingBytecode: funderLocking, valueSatoshis: BigInt(Math.round(block.tx[0].vout[0].value * 1e8)) } };
    const funding = buildTransaction({
      inputs: [p2pkhInput(coinbase, funder)],
      outputs: [...Array.from({ length: 4 }, () => ({ lockingBytecode: walletAddress, valueSatoshis: 100_000n })), ...Array.from({ length: 4 }, () => ({ lockingBytecode: SHARED_LOCKING, valueSatoshis: 2000n }))],
      changeLockingBytecode: funderLocking,
    });
    await rpc('sendrawtransaction', hex(funding.encoded));
    await mine(1, BURN);
    const fundingId = hex(funding.transactionHash);
    let coins: AccountCoin[] = [];
    for (let i = 0; i < 60; i++) {
      coins = (await account.coins()).filter((coin) => hex(coin.utxo.transactionHash) === fundingId);
      if (coins.length >= 4) break;
      await wait(500);
    }
    if (coins.length < 4) throw new Error('the wallet did not list its four coins');
    note('setup', { templateIdentifier, walletCoins: coins.length, sharedCoins: 4, coinbaseSatoshis: coinbase.output.valueSatoshis });

    // The service, in its own process.
    const readyFile = `${DATA}trial38-${RUN}-ready`;
    const jobFile = `${DATA}trial38-${RUN}-job.json`;
    writeFileSync(jobFile, JSON.stringify({ account: `trial38-service-${RUN}`, shared: [4, 5, 6, 7].map((index) => ({ transactionHash: fundingId, index })), readyFile } satisfies ServiceJob));
    // Its own process group, so that the whole of it is stopped at the end.
    service = spawn('npx', ['tsx', SELF, 'service', jobFile], { stdio: ['ignore', 'ignore', 'ignore'], detached: true });
    let port = 0;
    for (let i = 0; i < 120 && port === 0; i++) {
      await wait(250);
      try { port = Number(readFileSync(readyFile, 'utf8')); } catch { port = 0; }
    }
    if (port === 0) throw new Error('the service did not start within 30 seconds');
    const url = `http://127.0.0.1:${port}/xo`;
    const name = { identifier: templateIdentifier, contentHash: textHash(TEMPLATE_TEXT) };
    const hello = await askServiceHello(url, { template: name, role: 'user' }, { network: NETWORK });
    if (!hello.ok) throw new Error(hello.message);
    const otherRole = servedRole(hello.serves, name, 'user');
    if (otherRole === undefined) throw new Error('the service does not serve the template');
    note('hello', { url, serves: hello.serves.map((entry) => entry.role), otherRole });

    const brought = coins[0] as AccountCoin;
    const available = coins.slice(1);
    const runCase = async (mode: string) => {
      const started = Date.now();
      const invitation = await account.startShared({ template: templateIdentifier, action: 'act', role: 'user', variables: { userAmount: 10_000n, userHolder: hex(walletAddress) }, inputs: [{ coin: brought }] });
      const answerBy = Date.now() + 25_000;
      const answer = await askServiceJoin(url, { invitation: invitation.text, ref: mode }, { network: NETWORK });
      if (!answer.ok) {
        await account.abandonShared(invitation.invitationIdentifier);
        return { mode, refused: answer.kind, reason: answer.message, ms: Date.now() - started };
      }
      const commitsBack = deserializeInvitation(answer.invitation).commits.length;
      const took = await takeJoinedInvitation(account, invitation, answer.invitation);
      if (!took.ok) {
        await account.abandonShared(invitation.invitationIdentifier);
        return { mode, commitsBack, refused: took.code, reason: took.reason, signed: false, ms: Date.now() - started };
      }
      const verdict = await checkOtherParticipant({ template: trialTemplate, action: 'act', walletRole: 'user', otherRole, committed: took.taken.own, added: took.taken.others, chain, now: Date.now(), answerBy });
      if (!verdict.ok) {
        await account.abandonShared(invitation.invitationIdentifier);
        return { mode, commitsBack, refused: verdict.code, reason: verdict.reason, signed: false, ms: Date.now() - started };
      }
      const plan = planSharedFinish({
        template: trialTemplate,
        action: 'act',
        invitationIdentifier: invitation.invitationIdentifier,
        committed: [{ coin: brought, bytes: INPUT_BYTES.p2pkh }],
        accepted: verdict,
        outputs: verdict.left.outputs.map((outputIdentifier) => ({ outputIdentifier })),
        available: available.map((coin) => ({ coin, bytes: INPUT_BYTES.p2pkh })),
        change: walletAddress,
        feeRate: 1,
      });
      if (!plan.ok) {
        await account.abandonShared(invitation.invitationIdentifier);
        return { mode, refused: plan.code, reason: plan.reason, signed: false };
      }
      const prepared = await account.finishShared(plan.finish);
      const differs = builtAsPlanned(plan.planned, prepared);
      if (differs !== undefined) {
        await account.discard(prepared.invitationIdentifier);
        return { mode, refused: 'built-differs', reason: differs };
      }
      const transaction = decodeTransactionBch(hexToBin(prepared.transactionHex));
      if (typeof transaction === 'string') throw new Error(transaction);
      const transactionId = await account.send(prepared);
      await mine(1, BURN);
      const confirmations = (await rpc('getrawtransaction', transactionId, true)).confirmations as number;
      return {
        mode,
        commitsBack,
        accepted: true,
        left: verdict.left,
        planned: { feeSatoshis: plan.feeSatoshis, bytes: plan.bytes, feeCoins: plan.finish.inputs.length },
        built: { feeSatoshis: prepared.feeSatoshis, bytes: prepared.bytes, asPlanned: differs === undefined },
        inputs: transaction.inputs.map((input, i) => `${i}: ${hex(input.outpointTransactionHash).slice(0, 8)}:${input.outpointIndex} unlocking ${input.unlockingBytecode.length} B`),
        outputs: transaction.outputs.map((output, i) => `${i}: ${output.valueSatoshis} sat ${hex(output.lockingBytecode) === hex(SHARED_LOCKING) ? 'shared script' : hex(output.lockingBytecode) === hex(walletAddress) ? 'wallet' : hex(output.lockingBytecode).slice(0, 12)}`),
        transactionId,
        confirmations,
        onSentTold: sent.some((entry) => entry.transactionId === transactionId),
        ms: Date.now() - started,
      };
    };

    for (const mode of ['wallet-variable', 'forge-output', 'two-commits', 'honest']) {
      try {
        note(mode, await runCase(mode));
      } catch (error) {
        note(mode, { failed: errorText(error), engineErrors: [...new Set(engineErrors)].slice(0, 3) });
      }
    }
    const told = sent.at(-1);
    if (told !== undefined) writeFileSync(`${DATA}trial38-${RUN}-sent-invitation.json`, told.text);
    writeFileSync(`${DATA}trial38-${RUN}-results.json`, json(results));
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
