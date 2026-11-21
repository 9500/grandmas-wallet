// The mockup network's service: the chain's only miner, the owner of its clock and the source of play coins, so
// that every flow of the demonstration can be tried without waiting. See docs/mockup.md.
//
// usage (from the repository's root):
//   node --import tsx deploy/mockup/service.ts --host 192.168.88.112 --port 8122 --data ~/.local/share/grandmas-wallet/mockup
//        [--rpc 127.0.0.1:18453] [--public-url https://mockup-api.9500.cash] [--origin https://wallet.9500.cash ...]
//
// The node's RPC password is read from <data>/node/bitcoin.conf. The service keeps what it needs under
// <data>/service: the treasury's key (treasury.json, mode 600), what was skipped of the clock (state.json) and
// Paryon's deployment (paryon.json).
//
//   GET  /status                  the chain's height and clock, and what the treasury can pay
//   POST /coins {address, satoshis}   play coins from the treasury: {"transactionId": …}
//   POST /skip {seconds}          move the chain's clock on: {"time": <new median time>, "height": …}
//   GET  /paryon                  Paryon's contracts as deployed on this chain, and PUSD's registry
//   GET  /paryon/registry.json    PUSD's registry, as published on its authchain
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { binToHex, cashAddressToLockingBytecode, hexToBin, lockingBytecodeToCashAddress, utf8ToBin } from '@bitauth/libauth';
import { type Utxo, buildTransaction, checkBeforeSending, keyPairFromPrivateKey, p2pkhInput, p2pkhLockingBytecode } from '@grandmas-wallet/core';
import { type ParyonDeployment, localDeployment, periodAt } from '@grandmas-wallet/paryon';

const { values } = parseArgs({
  options: {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '8122' },
    data: { type: 'string' },
    rpc: { type: 'string', default: '127.0.0.1:18453' },
    'public-url': { type: 'string', default: 'https://mockup-api.9500.cash' },
    origin: { type: 'string', multiple: true, default: [] },
  },
});
if (values.data === undefined) {
  console.error('usage: node --import tsx deploy/mockup/service.ts --data <folder of deploy/mockup/mockup.sh> [--host …] [--port …] [--rpc …] [--public-url …] [--origin …]');
  process.exit(2);
}
const DATA = values.data;
const OWN = join(DATA, 'service');
mkdirSync(OWN, { recursive: true, mode: 0o700 });
const PUBLIC_URL = values['public-url'].replace(/\/$/, '');
const ORIGINS = new Set(values.origin);

// ------------------------------------------------------------------ limits

/** Regtest's coinbase maturity: a block reward is spent after this many blocks. */
const MATURITY = 100;
/** Blocks paid to the treasury at the start. Regtest halves the reward every 150 blocks; these are all of 50 BCH. */
const TREASURY_BLOCKS = 110;
/** A block when the mempool is not empty, checked this often. */
const TICK_MS = 2_000;
/** A block at least this often by the chain's clock, so that its median time follows the clock. */
const HEARTBEAT_SECONDS = 600;
const MOST_SATOSHIS = 200_000_000;
const LEAST_SATOSHIS = 1_000;
const MOST_SKIP_SECONDS = 8 * 24 * 3600;
const PER_HOUR = { coins: 30, skip: 60 };
/** Paryon's deployment: the price written into its price threads, its period and the number of each kind of thread. */
const PARYON_PRICE_CENTS = 50_000n;
const PARYON_PERIOD_BLOCKS = 144;
const PARYON_THREADS = 10;

const log = (line: string): void => console.log(`${new Date().toISOString()} ${line}`);

// ------------------------------------------------------------------ files

const readJson = <T>(file: string): T | undefined => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined);
const writeJson = (file: string, value: unknown): void => {
  writeFileSync(`${file}.new`, `${JSON.stringify(value, null, 1)}\n`, { mode: 0o600 });
  renameSync(`${file}.new`, file);
};

const addressOf = (bytecode: Uint8Array): string => {
  const made = lockingBytecodeToCashAddress({ prefix: 'bchreg', bytecode });
  if (typeof made === 'string') throw new Error(made);
  return made.address;
};

const treasuryFile = join(OWN, 'treasury.json');
if (!existsSync(treasuryFile)) {
  const privateKey = crypto.getRandomValues(new Uint8Array(32));
  writeJson(treasuryFile, { privateKey: binToHex(privateKey), address: addressOf(p2pkhLockingBytecode(keyPairFromPrivateKey(privateKey).keyHash)), made: new Date().toISOString() });
}
const treasury = keyPairFromPrivateKey(hexToBin((readJson<{ privateKey: string }>(treasuryFile) as { privateKey: string }).privateKey));
const treasuryLocking = p2pkhLockingBytecode(treasury.keyHash);
const TREASURY = addressOf(treasuryLocking);

interface State {
  /** Seconds the chain's clock is ahead of real time: everything skipped so far. */
  skipped: number;
}
const stateFile = join(OWN, 'state.json');
const state: State = readJson<State>(stateFile) ?? { skipped: 0 };
const saveState = (): void => writeJson(stateFile, state);

interface Paryon {
  deployment: ParyonDeployment;
  priceCents: string;
  registry: { uri: string; file: string; category: string };
  transactions: string[];
  deployedAt: number;
}
const paryonFile = join(OWN, 'paryon.json');
let paryon = readJson<Paryon>(paryonFile);

// ------------------------------------------------------------------ the node

const password = /^rpcpassword=(.*)$/m.exec(readFileSync(join(DATA, 'node', 'bitcoin.conf'), 'utf8'))?.[1];
const user = /^rpcuser=(.*)$/m.exec(readFileSync(join(DATA, 'node', 'bitcoin.conf'), 'utf8'))?.[1] ?? 'mockup';
if (password === undefined) throw new Error(`No rpcpassword in ${join(DATA, 'node', 'bitcoin.conf')}`);
const authorization = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

class NodeError extends Error {}

const rpc = async <T>(method: string, ...params: unknown[]): Promise<T> => {
  const response = await fetch(`http://${values.rpc}/`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '1.0', id: method, method, params }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let answer: { result: T; error: { message: string } | null };
  try {
    answer = JSON.parse(text) as typeof answer;
  } catch {
    throw new NodeError(`The node answered ${method} with HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  if (answer.error !== null) throw new NodeError(answer.error.message);
  return answer.result;
};

/** Everything that touches the node goes through here, one at a time. */
let tail: Promise<unknown> = Promise.resolve();
const serial = <T>(work: () => Promise<T>): Promise<T> => {
  const run = tail.then(work, work);
  tail = run.catch(() => undefined);
  return run;
};

// ------------------------------------------------------------------ the clock and blocks

const realNow = (): number => Math.floor(Date.now() / 1000);
/** The chain's clock: real time plus everything skipped. */
const chainNow = (): number => realNow() + state.skipped;

interface ChainInfo {
  blocks: number;
  mediantime: number;
  initialblockdownload: boolean;
}
const chainInfo = (): Promise<ChainInfo> => rpc<ChainInfo>('getblockchaininfo');
const tipTime = async (): Promise<number> => (await rpc<{ time: number }>('getblockheader', await rpc<string>('getbestblockhash'))).time;
const mempoolSize = async (): Promise<number> => (await rpc<{ size: number }>('getmempoolinfo')).size;

/**
 * Blocks paid to the treasury, stamped with the chain's clock. A node refuses a block more than two hours ahead of
 * its own clock, so the node's clock is set to the chain's before every block.
 */
const mine = async (count: number): Promise<void> => {
  for (let done = 0; done < count; done += 50) {
    await rpc('setmocktime', chainNow());
    await rpc('generatetoaddress', Math.min(50, count - done), TREASURY);
  }
};

/** Every 2 seconds: a block if the mempool holds anything, or if the last block is ten minutes old by the chain's clock. */
const tick = async (): Promise<void> => {
  await rpc('setmocktime', chainNow());
  if ((await mempoolSize()) > 0 || chainNow() - (await tipTime()) >= HEARTBEAT_SECONDS) await mine(1);
};

/**
 * Pending transactions go in a block, then the chain's median time is moved on by at least `seconds`: the clock is
 * moved on and blocks stamped with it are made until the median of the last eleven is past the mark (six suffice).
 */
const skip = async (seconds: number): Promise<{ time: number; height: number; skipped: number }> => {
  if ((await mempoolSize()) > 0) await mine(1);
  const before = (await chainInfo()).mediantime;
  // Blocks made quickly one after another are stamped a second apart at least, which can leave the median a little
  // ahead of the clock: the new clock is counted from the later of the two.
  state.skipped += seconds + Math.max(0, before - chainNow());
  saveState();
  let info = await chainInfo();
  for (let blocks = 0; info.mediantime < before + seconds && blocks < 20; blocks++) {
    await mine(1);
    info = await chainInfo();
  }
  if (info.mediantime < before + seconds) throw new Error(`The chain's median time moved only from ${before} to ${info.mediantime}.`);
  log(`skipped ${seconds} s: median time ${before} → ${info.mediantime}, height ${info.blocks}, clock ${state.skipped} s ahead of real time`);
  return { time: info.mediantime, height: info.blocks, skipped: state.skipped };
};

// ------------------------------------------------------------------ the treasury's coins

interface Coin {
  utxo: Utxo;
  /** The height of its block, 0 while unconfirmed. */
  height: number;
  coinbase: boolean;
}
const outpoint = (utxo: Pick<Utxo, 'transactionHash' | 'index'>): string => `${binToHex(utxo.transactionHash)}:${utxo.index}`;
/** What the treasury can spend now: confirmed coins found by a scan, and the change of its own unconfirmed payments. */
const coins = new Map<string, Coin>();
const coinbaseOf = new Map<string, boolean>();

const isCoinbase = async (transactionId: string): Promise<boolean> => {
  let known = coinbaseOf.get(transactionId);
  if (known === undefined) {
    const transaction = await rpc<{ vin: { coinbase?: string }[] }>('getrawtransaction', transactionId, true);
    known = transaction.vin[0]?.coinbase !== undefined;
    coinbaseOf.set(transactionId, known);
  }
  return known;
};

/** Whether a coin can go in a transaction for the next block. */
const spendable = (coin: Coin, tip: number): boolean => !coin.coinbase || tip + 1 - coin.height >= MATURITY;

/** Read the treasury's coins from the chain. Only with no payment of the treasury unconfirmed: a block is made first. */
const scan = async (): Promise<void> => {
  if ((await mempoolSize()) > 0) await mine(1);
  const found = await rpc<{ unspents: { txid: string; vout: number; amount: number; height: number }[] }>('scantxoutset', 'start', [`addr(${TREASURY})`]);
  coins.clear();
  for (const entry of found.unspents) {
    const utxo: Utxo = { transactionHash: hexToBin(entry.txid), index: entry.vout, output: { lockingBytecode: treasuryLocking, valueSatoshis: BigInt(Math.round(entry.amount * 1e8)) } };
    coins.set(outpoint(utxo), { utxo, height: entry.height, coinbase: await isCoinbase(entry.txid) });
  }
};

const spendableTotal = (tip: number): bigint => [...coins.values()].filter((coin) => spendable(coin, tip)).reduce((sum, coin) => sum + coin.utxo.output.valueSatoshis, 0n);

/** Pay from the treasury, spending its unconfirmed change, so that many payments in a row work. */
const pay = async (lockingBytecode: Uint8Array, satoshis: bigint, retried = false): Promise<string> => {
  const tip = (await chainInfo()).blocks;
  const needed = satoshis + 5_000n;
  const candidates = [...coins.values()].filter((coin) => spendable(coin, tip)).sort((a, b) => (a.utxo.output.valueSatoshis < b.utxo.output.valueSatoshis ? -1 : 1));
  // The smallest coin that pays it alone; otherwise the largest coins until they do.
  let inputs = candidates.filter((coin) => coin.utxo.output.valueSatoshis >= needed).slice(0, 1);
  if (inputs.length === 0) {
    inputs = [];
    let total = 0n;
    for (const coin of candidates.slice().reverse()) {
      if (total >= needed || inputs.length >= 50) break;
      inputs.push(coin);
      total += coin.utxo.output.valueSatoshis;
    }
    if (total < needed) {
      if (!retried) {
        await scan();
        return pay(lockingBytecode, satoshis, true);
      }
      throw new Error('The treasury cannot pay this now.');
    }
  }
  const built = buildTransaction({ inputs: inputs.map((coin) => p2pkhInput(coin.utxo, treasury)), outputs: [{ lockingBytecode, valueSatoshis: satoshis }], changeLockingBytecode: treasuryLocking });
  const check = checkBeforeSending(built);
  if (check !== true) throw new Error(`The payment fails the check before sending: ${check}`);
  try {
    await rpc('sendrawtransaction', binToHex(built.encoded));
  } catch (error) {
    if (retried || !(error instanceof NodeError)) throw error;
    // A coin the service took for unspent was not: read them again from the chain and try once more.
    log(`a payment was refused (${error.message}); reading the treasury's coins again`);
    await scan();
    return pay(lockingBytecode, satoshis, true);
  }
  for (const coin of inputs) coins.delete(outpoint(coin.utxo));
  if (built.changeIndex !== undefined) {
    const utxo: Utxo = { transactionHash: built.transactionHash, index: built.changeIndex, output: built.transaction.outputs[built.changeIndex] as Utxo['output'] };
    coins.set(outpoint(utxo), { utxo, height: 0, coinbase: false });
  }
  return built.transactionId;
};

// ------------------------------------------------------------------ Paryon's contracts on this chain

const REGISTRY_PATH = '/paryon/registry.json';

/** A registry file (Bitcoin Cash Metadata Registries) for the deployment's PUSD, as Paryon's chipnet one is written. */
const registryFile = (category: string): Uint8Array =>
  utf8ToBin(
    JSON.stringify(
      {
        $schema: 'https://cashtokens.org/bcmr-v2.schema.json',
        version: { major: 1, minor: 0, patch: 0 },
        latestRevision: '2026-01-01T00:00:00.000Z',
        registryIdentity: { name: 'ParyonUSD (mockup network)', description: 'A deployment of Paryon\'s published contracts on the mockup network, a sandbox chain with play coins.' },
        identities: { [category]: { '2026-01-01T00:00:00.000Z': { name: 'ParyonUSD (mockup network)', description: 'PUSD on the mockup network, a sandbox chain with play coins.', token: { category, symbol: 'PUSDMOCK', decimals: 2 } } } },
      },
      null,
      2,
    ),
  );

/**
 * Deploy Paryon's contracts as published (`packages/paryon/src/local-deployment.ts`), once: the rewards of blocks 1
 * and 2, which paid the treasury, define PUSD's category and the key factories'. PUSD's registry is published on the
 * transaction that makes PUSD's first outputs, at this service's public address.
 */
const deployParyon = async (): Promise<void> => {
  const rewardOf = async (height: number): Promise<Utxo | undefined> => {
    const block = await rpc<{ tx: string[] }>('getblock', await rpc<string>('getblockhash', height), 1);
    const transactionId = block.tx[0] as string;
    const unspent = await rpc<{ value: number } | null>('gettxout', transactionId, 0, true);
    return unspent === null ? undefined : { transactionHash: hexToBin(transactionId), index: 0, output: { lockingBytecode: treasuryLocking, valueSatoshis: BigInt(Math.round(unspent.value * 1e8)) } };
  };
  const [paryonCoin, factoryCoin] = [await rewardOf(1), await rewardOf(2)];
  if (paryonCoin === undefined || factoryCoin === undefined) {
    log('Paryon\'s contracts are not deployed: the rewards of blocks 1 and 2 are spent (reset the chain to deploy them)');
    return;
  }
  const height = (await chainInfo()).blocks;
  const category = binToHex(paryonCoin.transactionHash);
  const file = registryFile(category);
  const uri = `${PUBLIC_URL}${REGISTRY_PATH}`;
  const parameters = { funder: treasury, paryonCoin, factoryCoin, price: PARYON_PRICE_CENTS, startBlockHeight: 0, periodLengthBlocks: PARYON_PERIOD_BLOCKS, threads: PARYON_THREADS, registry: { file, uri } };
  const deployed = localDeployment({ ...parameters, period: periodAt({ startBlockHeight: 0, periodLengthBlocks: PARYON_PERIOD_BLOCKS } as ParyonDeployment, height + 1) });
  for (const built of deployed.transactions) await rpc('sendrawtransaction', binToHex(built.encoded));
  await mine(1);
  paryon = {
    deployment: { ...deployed.deployment, name: 'mockup' },
    priceCents: PARYON_PRICE_CENTS.toString(),
    registry: { uri, file: binToHex(file), category },
    transactions: deployed.transactions.map((built) => built.transactionId),
    deployedAt: height + 1,
  };
  writeJson(paryonFile, paryon);
  log(`Paryon's contracts deployed at height ${height + 1}: PUSD ${category}, key factories ${deployed.deployment.tokenIds.loanKeyFactory}`);
};

// ------------------------------------------------------------------ start

let ready = false;

const start = async (): Promise<void> => {
  for (let attempt = 0; ; attempt++) {
    try {
      await rpc('getblockcount');
      break;
    } catch (error) {
      if (attempt % 15 === 0) log(`waiting for the node at ${values.rpc}: ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  await serial(async () => {
    const info = await chainInfo();
    // A chain that is days ahead keeps its clock even if the state was lost.
    if (info.mediantime > chainNow()) {
      state.skipped = info.mediantime - realNow();
      saveState();
    }
    await rpc('setmocktime', chainNow());
    if (info.blocks < TREASURY_BLOCKS + MATURITY) {
      log(`a new chain: ${TREASURY_BLOCKS + MATURITY - info.blocks} blocks to the treasury ${TREASURY}`);
      await mine(TREASURY_BLOCKS + MATURITY - info.blocks);
    }
    if (paryon === undefined) await deployParyon();
    await scan();
    const tip = (await chainInfo()).blocks;
    log(`ready at height ${tip}: the treasury can spend ${spendableTotal(tip)} satoshis; the clock is ${state.skipped} s ahead of real time`);
  });
  ready = true;
  const loop = (): void => {
    setTimeout(() => {
      serial(tick)
        .catch((error: unknown) => log(`a block could not be made: ${(error as Error).message}`))
        .finally(loop);
    }, TICK_MS);
  };
  loop();
};

// ------------------------------------------------------------------ HTTP

class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Requests per client and hour: the address the reverse proxy adds last to X-Forwarded-For, or the connection's. */
const recent = new Map<string, number[]>();
const clientOf = (request: IncomingMessage): string => {
  const forwarded = request.headers['x-forwarded-for'];
  const last = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? '')).split(',').map((part) => part.trim()).filter((part) => part !== '').pop();
  return last ?? request.socket.remoteAddress ?? 'unknown';
};
const limit = (kind: keyof typeof PER_HOUR, client: string): void => {
  const key = `${kind} ${client}`;
  const now = Date.now();
  const times = (recent.get(key) ?? []).filter((time) => now - time < 3_600_000);
  if (times.length >= PER_HOUR[kind]) {
    const minutes = Math.ceil((3_600_000 - (now - (times[0] as number))) / 60_000);
    throw new Refusal(429, `At most ${PER_HOUR[kind]} such requests an hour are taken from one address. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }
  times.push(now);
  recent.set(key, times);
};
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of recent) if (times.every((time) => now - time >= 3_600_000)) recent.delete(key);
}, 600_000).unref();

const allowedOrigin = (origin: string | undefined): string | undefined =>
  origin !== undefined && (ORIGINS.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin)) ? origin : undefined;

const readBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 4_096) throw new Refusal(413, 'The request is too large.');
    chunks.push(chunk as Buffer);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new Refusal(400, 'The request is not JSON.');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Refusal(400, 'The request is not a JSON object.');
  return body as Record<string, unknown>;
};

const wholeNumber = (value: unknown): number | undefined => {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) ? number : undefined;
};

/** The locking bytecode of a `bchreg:` or `bchtest:` address (P2PKH or P2SH, token-aware or not); the prefix may be left out. */
const lockingOf = (address: unknown): Uint8Array => {
  if (typeof address !== 'string' || address.length > 200) throw new Refusal(400, 'Name the address to pay ("address").');
  const text = address.trim().toLowerCase();
  const tries = text.includes(':') ? [text] : [`bchreg:${text}`, `bchtest:${text}`];
  for (const attempt of tries) {
    const decoded = cashAddressToLockingBytecode(attempt);
    if (typeof decoded === 'string') continue;
    if (decoded.prefix !== 'bchreg' && decoded.prefix !== 'bchtest') throw new Refusal(400, 'Only addresses of a test network (bchreg: or bchtest:) are paid here.');
    return decoded.bytecode;
  }
  throw new Refusal(400, `This is not an address: ${address.slice(0, 100)}.`);
};

const status = async (): Promise<Record<string, unknown>> => {
  const info = await chainInfo();
  return {
    height: info.blocks,
    medianTime: info.mediantime,
    tipTime: await tipTime(),
    realTime: realNow(),
    secondsAhead: info.mediantime - realNow(),
    skipped: state.skipped,
    mempool: await mempoolSize(),
    treasury: { address: TREASURY, spendableSatoshis: Number(spendableTotal(info.blocks)) },
    paryon: paryon !== undefined,
  };
};

const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
  const origin = allowedOrigin(request.headers.origin);
  const url = new URL(request.url ?? '/', 'http://mockup');
  const send = (code: number, body: unknown, headers: Record<string, string> = {}): void => {
    response.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      vary: 'Origin',
      ...(origin === undefined ? {} : { 'access-control-allow-origin': origin }),
      ...headers,
    });
    response.end(JSON.stringify(body));
  };
  try {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        vary: 'Origin',
        ...(origin === undefined ? {} : { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' }),
      });
      response.end();
      return;
    }
    const route = `${request.method ?? ''} ${url.pathname}`;
    // PUSD's registry is read by any wallet, from wherever it is.
    if (route === `GET ${REGISTRY_PATH}`) {
      if (paryon === undefined) throw new Refusal(404, 'Paryon\'s contracts are not deployed on this chain.');
      response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' });
      response.end(Buffer.from(hexToBin(paryon.registry.file)));
      return;
    }
    if (!['GET /status', 'POST /coins', 'POST /skip', 'GET /paryon', 'GET /'].includes(route)) {
      throw new Refusal(['/status', '/coins', '/skip', '/paryon'].includes(url.pathname) ? 405 : 404, 'There is nothing here. The service answers GET /status, POST /coins, POST /skip and GET /paryon.');
    }
    if (route === 'GET /') {
      send(200, { service: 'The mockup network: a sandbox chain with play coins.', endpoints: ['GET /status', 'POST /coins {"address", "satoshis"}', 'POST /skip {"seconds"}', 'GET /paryon', `GET ${REGISTRY_PATH}`] });
      return;
    }
    if (!ready) throw new Refusal(503, 'The mockup network is starting. Try again in a minute.');
    if (route === 'GET /status') {
      send(200, await serial(status));
    } else if (route === 'GET /paryon') {
      if (paryon === undefined) throw new Refusal(404, 'Paryon\'s contracts are not deployed on this chain.');
      send(200, { deployment: paryon.deployment, priceCents: Number(paryon.priceCents), registry: { uri: paryon.registry.uri, category: paryon.registry.category }, deployedAt: paryon.deployedAt, transactions: paryon.transactions });
    } else if (route === 'POST /coins') {
      const body = await readBody(request);
      const lockingBytecode = lockingOf(body['address']);
      const satoshis = wholeNumber(body['satoshis']);
      if (satoshis === undefined || satoshis < LEAST_SATOSHIS || satoshis > MOST_SATOSHIS) throw new Refusal(400, `Ask for a whole number of satoshis from ${LEAST_SATOSHIS} to ${MOST_SATOSHIS} ("satoshis").`);
      limit('coins', clientOf(request));
      const transactionId = await serial(() => pay(lockingBytecode, BigInt(satoshis)));
      log(`paid ${satoshis} satoshis to ${addressOf(lockingBytecode)} in ${transactionId}`);
      send(200, { transactionId });
    } else {
      const body = await readBody(request);
      const seconds = wholeNumber(body['seconds']);
      if (seconds === undefined || seconds < 1 || seconds > MOST_SKIP_SECONDS) throw new Refusal(400, `Ask for a whole number of seconds from 1 to ${MOST_SKIP_SECONDS} (eight days) ("seconds").`);
      limit('skip', clientOf(request));
      send(200, await serial(() => skip(seconds)));
    }
  } catch (error) {
    if (error instanceof Refusal) {
      send(error.status, { error: error.message });
    } else {
      log(`${request.method} ${url.pathname} failed: ${(error as Error).stack ?? String(error)}`);
      send(500, { error: `The mockup network could not do this just now: ${(error as Error).message.replace(/\.?$/, '.')}` });
    }
  }
};

createServer((request, response) => void handle(request, response)).listen(Number(values.port), values.host, () => {
  log(`mockup service on http://${values.host}:${values.port}, the node at ${values.rpc}, the treasury ${TREASURY}`);
  void start().catch((error: unknown) => {
    log(`the service could not start: ${(error as Error).stack ?? String(error)}`);
    process.exit(1);
  });
});
