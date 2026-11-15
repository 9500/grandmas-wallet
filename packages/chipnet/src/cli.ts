import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { binToHex, cashAddressToLockingBytecode, generatePrivateKey, hexToBin } from '@bitauth/libauth';
import { buildTransaction, keyPairFromPrivateKey, p2pkhLockingBytecode } from '@grandmas-wallet/core';

import { Electrum } from './electrum.js';
import {
  ADDRESS_PREFIX,
  CHALLENGE_DELAY,
  type Environment,
  MINIMUM_FUNDING,
  Run,
  addressOf,
  numbered,
  runLifecycle,
  sweepAll,
} from './lifecycle.js';
import { type RunState, load, save } from './store.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const STATE_PATH = resolve(ROOT, '.chipnet/run.json');
const LOG_PATH = resolve(ROOT, 'docs/chipnet-log.md');

const MAINNET_GENESIS = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';

const say = (message: string): void => {
  console.log(message);
};

const sleep = (milliseconds: number): Promise<void> => new Promise((done) => setTimeout(done, milliseconds));

const environment: Environment = {
  persist: (state) => save(STATE_PATH, state),
  sleep,
  now: () => Date.now(),
  log: say,
};

const lockingOf = (address: string): Uint8Array => {
  const result = cashAddressToLockingBytecode(address);
  if (typeof result === 'string') throw new Error(`Not a valid address: ${result}`);
  if (result.prefix !== ADDRESS_PREFIX) {
    throw new Error(`Expected a chipnet address (${ADDRESS_PREFIX}:...), got prefix "${result.prefix}".`);
  }
  return result.bytecode;
};

const requireState = (): RunState => {
  const state = load(STATE_PATH);
  if (state === undefined) throw new Error('No run state yet. Start with: npm run chipnet -- address');
  return state;
};

const connect = async (state: RunState): Promise<Electrum> => {
  if (state.endpoint === undefined) throw new Error('No server set. First run: npm run chipnet -- probe <endpoint>');
  const electrum = await Electrum.connect(state.endpoint);
  const features = await electrum.features();
  if (features['genesis_hash'] === MAINNET_GENESIS) {
    await electrum.disconnect();
    throw new Error('This server is on mainnet. The chipnet run refuses to continue.');
  }
  return electrum;
};

const newState = (): RunState => {
  const key = (): string => binToHex(generatePrivateKey());
  return {
    version: 1,
    keys: { funder: key(), owner: key(), recoverer: key(), replacement: key() },
    utxos: [],
    steps: {},
    stepOrder: [],
  };
};

const writeLog = (state: RunState): void => {
  const rows = state.stepOrder.map((name) => {
    const step = state.steps[name];
    if (step === undefined) return '';
    const detail = step.networkReply === undefined ? (step.note ?? '') : `network: ${step.networkReply}; local check: ${step.localCheck ?? ''}`;
    return `| ${name} | ${step.description} | ${step.status} | \`${step.transactionId}\` | ${detail.replaceAll('|', '/')} |`;
  });
  const text = [
    '# Chipnet run log',
    '',
    'Written by `npm run chipnet -- run`. Transactions marked refused were deliberately invalid and were never mined.',
    '',
    `- Wallet identity: \`${state.identity ?? 'not created'}\``,
    `- Server: \`${state.endpoint ?? 'unset'}\``,
    `- Challenge delay: ${CHALLENGE_DELAY.value} x 512 seconds (time-based)`,
    '',
    '| Step | What it shows | Result | Transaction | Detail |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
  writeFileSync(LOG_PATH, text);
};

const commands: Record<string, (args: string[]) => Promise<void>> = {
  /** Check a server without sending anything, and remember it. */
  probe: async ([endpoint]) => {
    if (endpoint === undefined) throw new Error('Usage: probe <tcp|ssl|ws|wss>://host:port');
    const electrum = await Electrum.connect(endpoint);
    try {
      const features = await electrum.features();
      const tip = await electrum.tip();
      say(`server software : ${electrum.software}`);
      say(`genesis hash    : ${String(features['genesis_hash'])}`);
      if (features['genesis_hash'] === MAINNET_GENESIS) throw new Error('This server is on mainnet; refusing to use it.');
      say(`relay fee       : ${await electrum.relayFeePerKilobyte()} BCH/kB`);
      say(`tip height      : ${tip.height}`);
      say(`tip time        : ${new Date(tip.time * 1000).toISOString()} (${Math.round(Date.now() / 1000 - tip.time)} s ago)`);
      const times: number[] = [];
      for (let height = tip.height - 6; height <= tip.height; height++) times.push(await electrum.headerTime(height));
      const gaps = times.slice(1).map((time, i) => time - (times[i] ?? time));
      say(`last 6 header intervals (s): ${gaps.join(', ')}`);
    } finally {
      await electrum.disconnect();
    }
    const state = load(STATE_PATH) ?? newState();
    state.endpoint = endpoint;
    save(STATE_PATH, state);
    say(`Server saved. Keys and progress are kept in ${STATE_PATH}`);
  },

  /** Create the run's keys if needed and show where to send test coins. */
  address: async () => {
    const state = load(STATE_PATH) ?? newState();
    save(STATE_PATH, state);
    const funder = keyPairFromPrivateKey(hexToBin(state.keys.funder));
    say(`Keys are saved in ${STATE_PATH} (not tracked by git).`);
    say(`Send at least ${MINIMUM_FUNDING} satoshis of chipnet BCH to:`);
    say(`  ${addressOf(p2pkhLockingBytecode(funder.keyHash))}`);
  },

  status: async () => {
    const state = requireState();
    const electrum = await connect(state);
    try {
      const run = new Run(state, electrum, environment);
      await run.syncFunder();
      for (const role of ['funder', 'controller', 'asset', 'jar'] as const) {
        say(`${role.padEnd(10)} ${run.utxos(role).length} output(s), ${run.balance(role)} sat`);
      }
      for (const name of state.stepOrder) say(`${(state.steps[name]?.status ?? '').padEnd(22)} ${name}`);
    } finally {
      await electrum.disconnect();
    }
  },

  /** Send the funds to their own address once, to confirm the server relays and confirms transactions. */
  selftest: async () => {
    const state = requireState();
    const electrum = await connect(state);
    try {
      const run = new Run(state, electrum, environment);
      await run.syncFunder();
      if (run.balance('funder') === 0n) throw new Error('No funds yet at the funding address.');
      const name = numbered(state, 'selftest');
      await run.accept(name, 'Funds sent to their own address', () =>
        buildTransaction({ inputs: run.funderInputs(), outputs: [], changeLockingBytecode: run.funderLocking }),
      );
      const transactionId = state.steps[name]?.transactionId ?? '';
      const started = Date.now();
      say('Waiting for the first confirmation (up to 15 minutes)...');
      while (Date.now() - started < 15 * 60_000) {
        const confirmations = await electrum.confirmations(transactionId);
        if (confirmations !== undefined && confirmations > 0) {
          say(`Confirmed after ${Math.round((Date.now() - started) / 1000)} s.`);
          return;
        }
        await sleep(10_000);
      }
      say('Not confirmed within 15 minutes. The transaction was accepted; check the server and chain before the full run.');
    } finally {
      await electrum.disconnect();
    }
  },

  /** The full lifecycle. Safe to run again after an interruption. */
  run: async () => {
    const state = requireState();
    const electrum = await connect(state);
    try {
      const run = new Run(state, electrum, environment);
      await runLifecycle(run);
      writeLog(state);
      say(`Run complete. Log written to ${LOG_PATH}`);
      say('Return the remaining coins with: npm run chipnet -- sweep <your chipnet address>');
    } finally {
      writeLog(state);
      await electrum.disconnect();
    }
  },

  /** Return everything that can be returned. The controller output itself stays on chain. */
  sweep: async ([address]) => {
    if (address === undefined) throw new Error('Usage: sweep <chipnet address>');
    const destination = lockingOf(address);
    const state = requireState();
    const electrum = await connect(state);
    try {
      const run = new Run(state, electrum, environment);
      await sweepAll(run, destination);
      writeLog(state);
      say(`Swept to ${address}. Still on chain: controller ${run.balance('controller')} sat (cannot be closed), jar ${run.balance('jar')} sat.`);
    } finally {
      await electrum.disconnect();
    }
  },

  /** Forget a saved transaction that can no longer be sent, so its step is built again. */
  'drop-pending': async ([name]) => {
    const state = requireState();
    if (name === undefined || state.steps[name]?.status !== 'pending') throw new Error('Usage: drop-pending <step name with status pending>');
    const { [name]: _dropped, ...rest } = state.steps;
    state.steps = rest;
    state.stepOrder = state.stepOrder.filter((step) => step !== name);
    save(STATE_PATH, state);
    say(`Dropped ${name}.`);
  },
};

const [command = 'help', ...args] = process.argv.slice(2);
const handler = commands[command];
if (handler === undefined) {
  say('Commands: probe <endpoint> | address | status | selftest | run | sweep <address> | drop-pending <step>');
  process.exit(command === 'help' ? 0 : 1);
}
handler(args).then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`\nStopped: ${error instanceof Error ? error.message : String(error)}`);
    console.error('Nothing is lost: progress is saved, and the same command can be run again.');
    process.exit(1);
  },
);
