import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { binToHex, generatePrivateKey, hexToBin } from '@bitauth/libauth';
import { keyPairFromPrivateKey, p2pkhLockingBytecode } from '@grandmas-wallet/core';

import { Electrum } from './electrum.js';
import { type Chain, type Environment, type EndState, MINIMUM_FUNDING, Run, addressOf, previewFirstTransaction, readEndState, returnAll, runLifecycle } from './lifecycle.js';
import { LocalNode, REGTEST_PREFIX } from './local-node.js';
import { type RunSurroundings, renderLog } from './log.js';
import { type NodeRpc, type NodeRpcSettings, nodeRpc, testMempoolAccept } from './node-rpc.js';
import { ChainPool } from './pool.js';
import { type RunState, load, save } from './store.js';

/**
 * The scripted run of stage 1 on a real chain.
 *
 *   npm run chipnet -- run local            the local node (deploy/regtest/regtest.sh)
 *   npm run chipnet -- run chipnet          chipnet, paid from the key in .chipnet/funder-design-2.json
 *   npm run chipnet -- preflight chipnet    the checks before a chipnet run, sending nothing
 *   npm run chipnet -- status <chain>       where a run stands
 *   npm run chipnet -- return <chain>       return everything to the funding address from wherever a run stopped
 *   npm run chipnet -- drop-pending <chain> <step>
 *
 * Options: --state <file>, --funder-key <file>, --fresh (set a finished run aside and start a new one),
 * --stop-before <step> and --stop-after <step> (stop the run there, to try continuing it).
 * Keys and progress are kept in .chipnet/, which git does not track.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MAINNET_GENESIS = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const CHIPNET_GENESIS = '000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b';
/** The user's own server first: it is the one the run sends to. */
const CHIPNET_SERVERS = ['wss://chipnet.9500.cash:443', 'wss://chipnet.imaginary.cash:50004'];
const CHIPNET_PREFIX = 'bchtest';
const CHIPNET_FUNDER_KEY = resolve(ROOT, '.chipnet/funder-design-2.json');
const CHIPNET_NODE_RPC = resolve(ROOT, '.chipnet/node-rpc.json');

type ChainName = 'local' | 'chipnet';
const isChainName = (value: string | undefined): value is ChainName => value === 'local' || value === 'chipnet';

const say = (message: string): void => {
  console.log(message);
};
const pause = (milliseconds: number): Promise<void> => new Promise((done) => setTimeout(done, milliseconds));

interface Options {
  state?: string;
  funderKey?: string;
  fresh: boolean;
  stopBefore?: string;
  stopAfter?: string;
  rest: string[];
}

const parseOptions = (args: string[]): Options => {
  const options: Options = { fresh: false, rest: [] };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--fresh') options.fresh = true;
    else if (argument === '--state' || argument === '--funder-key' || argument === '--stop-before' || argument === '--stop-after') {
      const value = args[++index];
      if (value === undefined) throw new Error(`${argument} needs a value.`);
      if (argument === '--state') options.state = resolve(value);
      else if (argument === '--funder-key') options.funderKey = resolve(value);
      else if (argument === '--stop-before') options.stopBefore = value;
      else options.stopAfter = value;
    } else if (argument !== undefined) options.rest.push(argument);
  }
  return options;
};

const paths = (chain: ChainName, options: Options) => {
  const statePath = options.state ?? resolve(ROOT, `.chipnet/run-a-${chain}.json`);
  return {
    statePath,
    logBeside: statePath.replace(/\.json$/, '') + '.md',
    logInDocs: resolve(ROOT, `docs/runs/stage-1-${chain === 'local' ? 'local-node' : 'chipnet'}.md`),
  };
};

/** A new run: random keys for everything but the funding key, which may be given. */
const newState = (chain: ChainName, funderKey?: string): RunState => {
  const key = (): string => binToHex(generatePrivateKey());
  const seed = () => ({ controllerKey: key(), blindingSeed: randomBytes(32).toString('hex'), addressKeys: randomBytes(32).toString('hex') });
  return {
    version: 2,
    chain,
    keys: { funder: funderKey ?? key(), recoverer: key(), recovererFee: key(), old: seed(), new: seed() },
    utxos: [],
    steps: {},
    stepOrder: [],
  };
};

const funderKeyFrom = (file: string): string => {
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { privateKey?: string };
  if (typeof saved.privateKey !== 'string' || !/^[0-9a-f]{64}$/.test(saved.privateKey)) throw new Error(`${file} holds no private key.`);
  return saved.privateKey;
};

/** The state of the run on this chain: the one on disk, or a new one that is saved before anything else happens. */
const openState = (chain: ChainName, options: Options): { state: RunState; statePath: string } => {
  const { statePath } = paths(chain, options);
  let state = load(statePath);
  if (state !== undefined && options.fresh) {
    if (state.utxos.some((utxo) => utxo.role !== 'funder')) {
      throw new Error('The run on disk still holds coins away from the funding address. Finish it, or use "return", before starting a fresh one.');
    }
    const aside = statePath.replace(/\.json$/, '') + `-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    renameSync(statePath, aside);
    say(`The earlier run was set aside as ${aside}`);
    state = undefined;
  }
  if (state === undefined) {
    const keyFile = options.funderKey ?? (chain === 'chipnet' ? CHIPNET_FUNDER_KEY : undefined);
    if (chain === 'chipnet' && (keyFile === undefined || !existsSync(keyFile))) throw new Error(`A chipnet run is paid from a saved key; ${keyFile ?? 'no file'} was not found.`);
    state = newState(chain, keyFile === undefined ? undefined : funderKeyFrom(keyFile));
    // The keys are on disk before any address of the run is shown or paid.
    save(statePath, state);
  }
  if (state.version !== 2 || state.chain !== chain) throw new Error(`${statePath} belongs to another kind of run (${state.chain ?? 'unknown chain'}).`);
  return { state, statePath };
};

interface OpenChain {
  chain: Chain;
  prefix: string;
  timing: Pick<Environment, 'sleep' | 'now' | 'retryIntervalMs'>;
  /** One line for each server or node, for the log. */
  servers: () => Promise<string[]>;
  versions: () => Promise<Record<string, string>>;
  local?: LocalNode;
  chipnet?: { servers: Electrum[]; rpc?: NodeRpc };
  close: () => Promise<void>;
}

const openLocal = async (): Promise<OpenChain> => {
  const node = await LocalNode.open();
  return {
    chain: node,
    prefix: REGTEST_PREFIX,
    // One wait takes the chain's clock past the waiting period of 512 seconds.
    timing: { sleep: node.sleep, now: node.now, retryIntervalMs: 600_000 },
    servers: async () => [`Server: Fulcrum at \`${node.endpoint}\`; blocks made and the clock moved through the node's RPC`],
    versions: async () => {
      const { node: nodeVersion, server } = await node.software();
      return { Node: nodeVersion, Server: server };
    },
    local: node,
    close: () => node.close(),
  };
};

const openChipnet = async (): Promise<OpenChain> => {
  const servers: Electrum[] = [];
  for (const endpoint of CHIPNET_SERVERS) {
    const server = await Electrum.connect(endpoint);
    const genesis = (await server.features())['genesis_hash'];
    if (genesis === MAINNET_GENESIS) throw new Error(`${endpoint} is on mainnet. The run refuses to continue.`);
    if (genesis !== CHIPNET_GENESIS) throw new Error(`${endpoint} is not on chipnet (genesis ${String(genesis)}).`);
    servers.push(server);
  }
  const [first] = servers;
  if (first === undefined) throw new Error('No server.');
  const pool = new ChainPool(servers);
  let rpc: NodeRpc | undefined;
  if (existsSync(CHIPNET_NODE_RPC)) rpc = nodeRpc(JSON.parse(readFileSync(CHIPNET_NODE_RPC, 'utf8')) as NodeRpcSettings);
  return {
    chain: {
      listUnspent: (lockingBytecode) => pool.listUnspent(lockingBytecode),
      getTransaction: (transactionId) => pool.getTransaction(transactionId),
      getHistory: (lockingBytecode) => pool.getHistory(lockingBytecode),
      broadcast: (transactionHex) => first.broadcast(transactionHex),
    },
    prefix: CHIPNET_PREFIX,
    timing: { sleep: pause, now: () => Date.now() },
    servers: async () => servers.map((server, index) => `Server ${index + 1}: \`${server.endpoint}\`${index === 0 ? ' (transactions are sent here)' : ''}`),
    versions: async () => {
      const versions: Record<string, string> = {};
      servers.forEach((server, index) => {
        versions[`Server ${index + 1}`] = server.software;
      });
      if (rpc !== undefined) versions['Node used for the check before starting'] = (await rpc<{ subversion: string }>('getnetworkinfo')).subversion.replaceAll('/', '');
      return versions;
    },
    chipnet: { servers, ...(rpc === undefined ? {} : { rpc }) },
    close: async () => {
      await Promise.all(servers.map((server) => server.disconnect()));
    },
  };
};

const openChain = (chain: ChainName): Promise<OpenChain> => (chain === 'local' ? openLocal() : openChipnet());

const installedVersion = (packageName: string): string =>
  (JSON.parse(readFileSync(resolve(ROOT, 'node_modules', packageName, 'package.json'), 'utf8')) as { version: string }).version;

/** Size and hash of each compiled contract, read from the files the contracts are built into. */
const compiledContracts = (): RunSurroundings['contracts'] =>
  ['controller', 'recoverableAddress', 'vaultAddress'].map((name) => {
    const match = /BytecodeHex =\s*'([0-9a-f]+)'/.exec(readFileSync(resolve(ROOT, `contracts/artifacts/${name}.ts`), 'utf8'));
    if (match?.[1] === undefined) throw new Error(`The compiled ${name} contract was not found.`);
    const bytecode = hexToBin(match[1]);
    return { name, bytes: bytecode.length, sha256: createHash('sha256').update(bytecode).digest('hex') };
  });

const commit = (): string | undefined => {
  try {
    const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const changed = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim() !== '';
    return changed ? `${hash}, with changes not yet committed` : hash;
  } catch {
    return undefined;
  }
};

const writeLogs = async (chainName: ChainName, options: Options, state: RunState, open: OpenChain, end?: EndState): Promise<void> => {
  const { logBeside, logInDocs } = paths(chainName, options);
  const committed = commit();
  const text = renderLog(state, {
    title: chainName === 'local' ? 'Stage 1 run on the local node' : 'Stage 1 run on chipnet (run A)',
    chain: chainName === 'local' ? 'local node, regtest, with mainnet\'s rules and the public networks\' relay rules' : 'chipnet',
    servers: await open.servers(),
    versions: {
      'cashc (compiler)': installedVersion('cashc'),
      '@bitauth/libauth': installedVersion('@bitauth/libauth'),
      'Node.js': process.version,
      ...(await open.versions()),
    },
    contracts: compiledContracts(),
    ...(committed === undefined ? {} : { commit: committed }),
    ...(end === undefined ? {} : { end }),
  });
  for (const file of [logBeside, logInDocs]) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
};

const environment = (statePath: string, open: OpenChain, options: Options): Environment => ({
  persist: (state) => save(statePath, state),
  log: say,
  ...open.timing,
  beforeSending: (step) => {
    if (step === options.stopBefore) throw new Error(`Stopped before sending "${step}", as asked.`);
  },
  afterStep: (step) => {
    if (step === options.stopAfter) throw new Error(`Stopped after "${step}", as asked.`);
  },
});

/** The end state as the servers report it, allowing them a moment to catch up with the last transaction. */
const settledEndState = async (run: Run): Promise<EndState> => {
  let end = await readEndState(run);
  for (let attempt = 0; attempt < 10 && (end.leftBehind.length > 0 || !end.closed); attempt++) {
    await pause(1_000);
    end = await readEndState(run);
  }
  return end;
};

/** The checks before a chipnet run starts. Nothing is sent. */
const preflight = async (run: Run, open: OpenChain): Promise<void> => {
  const servers = open.chipnet?.servers ?? [];
  const tips = await Promise.all(servers.map((server) => server.tip()));
  const lowest = Math.min(...tips.map((tip) => tip.height));
  const highest = Math.max(...tips.map((tip) => tip.height));
  if (highest - lowest > 1) throw new Error(`The servers are ${highest - lowest} blocks apart (${tips.map((tip) => tip.height).join(', ')}).`);
  const headers = await Promise.all(servers.map((server) => server.header(lowest)));
  if (new Set(headers).size !== 1) throw new Error(`The servers disagree about block ${lowest}.`);
  say(`  the servers agree on the chain: tip ${tips.map((tip) => tip.height).join(' and ')}, same block ${lowest}`);

  if (run.state.steps['create'] !== undefined) {
    say('  the run has already begun; it continues from where it stopped');
    return;
  }
  await run.syncFunder();
  const funded = run.balance('funder');
  say(`  funding address ${addressOf(run.funderLocking, open.prefix)} holds ${funded} satoshis`);
  if (run.state.steps['prepare'] === undefined && funded < MINIMUM_FUNDING) throw new Error(`At least ${MINIMUM_FUNDING} satoshis are needed at the funding address.`);

  const rpc = open.chipnet?.rpc;
  if (rpc === undefined) {
    say(`  no node RPC in ${CHIPNET_NODE_RPC}: the first transaction is not tried on a node beforehand`);
    return;
  }
  const { chain } = await rpc<{ chain: string }>('getblockchaininfo');
  if (chain !== 'chip') throw new Error(`The node for the check before starting is on "${chain}", not chipnet.`);
  const first = await previewFirstTransaction(run);
  if (first === undefined) return;
  const verdict = await testMempoolAccept(rpc, binToHex(first.built.encoded));
  if (!verdict.allowed) throw new Error(`The node would refuse the first transaction (${first.name}): ${verdict.reason}`);
  say(`  the node would accept the first transaction (${first.name}, ${first.built.encoded.length} bytes); nothing was sent`);
};

const withRun = async (chainName: ChainName, options: Options, work: (run: Run, open: OpenChain, statePath: string) => Promise<void>): Promise<void> => {
  const { state, statePath } = openState(chainName, options);
  const open = await openChain(chainName);
  try {
    await work(new Run(state, open.chain, environment(statePath, open, options)), open, statePath);
  } finally {
    await open.close();
  }
};

const commands: Record<string, (chain: ChainName, options: Options) => Promise<void>> = {
  /** The whole run. Safe to run again after an interruption. */
  run: (chainName, options) =>
    withRun(chainName, options, async (run, open, statePath) => {
      say(`Run on ${chainName}; keys and progress in ${statePath}`);
      run.state.starts = [...(run.state.starts ?? []), new Date().toISOString()];
      run.persist();
      if (open.local !== undefined && run.state.steps['create'] === undefined && run.state.steps['prepare'] === undefined) {
        await run.syncFunder();
        if (run.balance('funder') < MINIMUM_FUNDING) {
          say('  paying a block reward to the funding address');
          await open.local.fund(run.funderLocking);
          await run.syncFunder();
          if (run.balance('funder') < MINIMUM_FUNDING) throw new Error('Block rewards on this chain have become too small. Start a new chain: deploy/regtest/regtest.sh reset');
        }
      }
      if (open.chipnet !== undefined) {
        say('Checks before starting');
        await preflight(run, open);
      }
      let end: EndState | undefined;
      try {
        await runLifecycle(run);
        end = await settledEndState(run);
      } finally {
        await writeLogs(chainName, options, run.state, open, end);
      }
      const { logInDocs } = paths(chainName, options);
      say(`Run complete. ${end.returnedSatoshis} satoshis are at the funding address ${addressOf(run.funderLocking, open.prefix)}.`);
      say(end.leftBehind.length === 0 && end.closed ? 'Nothing is left anywhere else, and the wallet is closed.' : `LEFT BEHIND: ${JSON.stringify(end.leftBehind, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value))}; closed: ${end.closed}`);
      say(`Log written to ${logInDocs}`);
      if (end.leftBehind.length > 0 || !end.closed) throw new Error('The run finished but did not leave the chain as it should.');
    }),

  /** The checks before a chipnet run, alone. */
  preflight: (chainName, options) =>
    withRun(chainName, options, async (run, open) => {
      if (open.chipnet === undefined) throw new Error('The checks before starting are for chipnet.');
      await preflight(run, open);
      say('Ready.');
    }),

  status: (chainName, options) =>
    withRun(chainName, options, async (run, open) => {
      await run.syncFunder();
      say(`funding address ${addressOf(run.funderLocking, open.prefix)}`);
      for (const role of ['funder', 'fee', 'controller', 'address'] as const) say(`${role.padEnd(10)} ${run.utxos(role).length} output(s), ${run.balance(role)} sat`);
      for (const name of run.state.stepOrder) say(`${(run.state.steps[name]?.status ?? '').padEnd(22)} ${name}`);
    }),

  /** Return everything to the funding address from wherever a run stopped. */
  return: (chainName, options) =>
    withRun(chainName, options, async (run, open) => {
      let end: EndState | undefined;
      try {
        await returnAll(run);
        end = await settledEndState(run);
      } finally {
        await writeLogs(chainName, options, run.state, open, end);
      }
      say(`${end.returnedSatoshis} satoshis are at the funding address ${addressOf(run.funderLocking, open.prefix)}.`);
      if (end.leftBehind.length > 0) say(`Left behind: ${end.leftBehind.map(({ name, valueSatoshis }) => `${name} ${valueSatoshis} sat`).join('; ')}`);
    }),

  /** Forget a saved transaction that can no longer be sent, so its step is built again. */
  'drop-pending': async (chainName, options) => {
    const { state, statePath } = openState(chainName, options);
    const [name] = options.rest;
    if (name === undefined || state.steps[name]?.status !== 'pending') throw new Error('Usage: drop-pending <chain> <step name with status pending>');
    const { [name]: _dropped, ...rest } = state.steps;
    state.steps = rest;
    state.stepOrder = state.stepOrder.filter((step) => step !== name);
    save(statePath, state);
    say(`Dropped ${name}.`);
  },

  /** Where to send coins for a run on this chain. The keys are saved first. */
  address: async (chainName, options) => {
    const { state, statePath } = openState(chainName, options);
    const funder = keyPairFromPrivateKey(hexToBin(state.keys.funder));
    say(`Keys are saved in ${statePath} (not tracked by git).`);
    say(`Funding address: ${addressOf(p2pkhLockingBytecode(funder.keyHash), chainName === 'local' ? REGTEST_PREFIX : CHIPNET_PREFIX)} (at least ${MINIMUM_FUNDING} satoshis)`);
  },
};

const [command = 'help', chainArgument, ...rest] = process.argv.slice(2);
const handler = commands[command];
if (handler === undefined || !isChainName(chainArgument)) {
  say('Usage: <run | preflight | status | return | drop-pending | address> <local | chipnet> [--state file] [--funder-key file] [--fresh]');
  process.exit(command === 'help' ? 0 : 1);
}
Promise.resolve()
  .then(() => handler(chainArgument, parseOptions(rest)))
  .then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(`\nStopped: ${error instanceof Error ? error.message : String(error)}`);
      console.error('Nothing is lost: keys and progress are saved, and the same command can be run again.');
      process.exit(1);
    },
  );
