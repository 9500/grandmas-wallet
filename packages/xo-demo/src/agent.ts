// One XO account, kept open for the whole run so its engine state persists between steps.
// Started by run.ts as a child process; takes one JSON request per line on stdin and answers on stdout.
//
// usage: tsx agent.ts <account name>
import 'fake-indexeddb/auto'; // the engine's SQLite storage is unfinished, so Node needs an IndexedDB

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { generateBip39Mnemonic } from '@bitauth/libauth';
import { type ContinueRequest, type JoinRequest, type StartRequest, type Variables, XoAccount } from '@grandmas-wallet/app/account';
import { savingsJarTemplate } from '@grandmas-wallet/savings-jar';

const account = process.argv[2] ?? 'account';
const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.xo-demo');
mkdirSync(DATA, { recursive: true });
const mnemonicPath = resolve(DATA, `${account}.mnemonic`);
if (!existsSync(mnemonicPath)) writeFileSync(mnemonicPath, generateBip39Mnemonic(), { mode: 0o600 });
const mnemonic = readFileSync(mnemonicPath, 'utf8').trim();

// The engine reports problems on the console; stdout is reserved for answers.
const engineMessages: string[] = [];
console.error = (...parts: unknown[]) => engineMessages.push(String(parts[0]).slice(0, 200));
console.warn = console.error;

const xo = await XoAccount.open(mnemonic);

type Json = Record<string, unknown>;

const operations: Record<string, (request: Json) => Promise<unknown>> = {
  describe: async () => ({ account, coinLockingBytecode: xo.coinLockingBytecode, walletTemplate: xo.walletTemplate }),
  coins: async () => xo.coins(),
  unspent: async () => xo.unspent(),
  keyHash: async ({ secret }) => xo.keyHash(secret as string),
  messages: async () => engineMessages.splice(0),
  start: async (request) => xo.start(request as unknown as StartRequest),
  join: async (request) => xo.join(request as unknown as JoinRequest),
  continue: async (request) => xo.continue(request as unknown as ContinueRequest),
  broadcast: async ({ invitationIdentifier }) => xo.broadcast(invitationIdentifier as string),
  // The wallet's own address, or the address of a savings jar. The account knows nothing of jars: it takes
  // the application's template in and has the engine work the address out, which also makes it follow it.
  track: async ({ what, variables }) => {
    if (what !== 'jar') return xo.trackWallet((variables ?? {}) as Variables);
    const templateIdentifier = await xo.importTemplate(savingsJarTemplate);
    const deposit = await xo.resolveAction({ templateIdentifier, action: 'deposit', role: 'saver', variables: { ...((variables ?? {}) as Variables), savedSatoshis: 1_000 } });
    return deposit.outputs[0]?.lockingBytecode;
  },
  pay: async ({ lockingBytecode, satoshis }) => xo.pay(lockingBytecode as string, satoshis as string),
  stop: async () => {
    setTimeout(() => process.exit(0), 50);
    return 'stopping';
  },
};

const answer = (message: Json): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, operation, ...request } = JSON.parse(line) as { id: number; operation: string } & Json;
  const run = operations[operation];
  if (run === undefined) {
    answer({ id, error: `unknown operation ${operation}` });
    return;
  }
  run(request).then(
    (result) => answer({ id, result }),
    (error: Error) => answer({ id, error: `${error.name}: ${error.message}`.slice(0, 600) }),
  );
});

answer({ id: 0, result: 'ready' });
