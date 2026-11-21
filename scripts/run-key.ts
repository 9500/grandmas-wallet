// A key of a run's own, that the run pays from, so that two runs never draw on the funding address at the same
// moment: at the start one payment from the funding address (scripts/chipnet-pay.ts, or scripts/local-pay.ts on the
// local node) gives it what the run needs; the run pays from it alone; at the end what it holds goes back to the
// funding address. The key is kept in the run's folder (`run-key.json`, under .chipnet/ or .local-runs/, not in git),
// so that what a stopped run's key holds can always be sent back.
//
// usage (from the repository's root):
//   npx tsx scripts/run-key.ts fund <key file> <satoshis>             make the key if it is not there, and pay it from the funding address
//   npx tsx scripts/run-key.ts pay <key file> <address> <satoshis>    pay from the run's key (on the local node, then make one block)
//   npx tsx scripts/run-key.ts balance <key file>                     what the run's key holds
//   npx tsx scripts/run-key.ts return <key file or run folder>        send everything it holds back to the funding address
//   npx tsx scripts/run-key.ts holds <address> <network>              what an address holds (for a funding address)
//
// The network is the key file's (`chipnet`, `regtest` or `mainnet`), written when the key is made.
//
// On mainnet the coins are real. The funding address is the owner's, given by its key file:
//   npx tsx scripts/run-key.ts fund <key file> <satoshis> mainnet <funding key file>
// A run's key is given at most MAINNET_MOST satoshis, a payment from it is at most that too, and every payment says
// what it is about to send (on the standard error) before it is sent. The funding key file is only read.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { binToHex, cashAddressToLockingBytecode, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { type Utxo, buildTransaction, checkBeforeSending, keyPairFromPrivateKey, p2pkhInput, p2pkhLockingBytecode } from '@grandmas-wallet/core';

import { Electrum } from '../packages/chipnet/src/electrum.js';

const root = fileURLToPath(new URL('..', import.meta.url));

// ------------------------------------------------------------------ the local chain, one run at a time

/**
 * Runs `work` while this machine's other runs wait: what makes blocks, moves the chain's clock or pays from the local
 * payer on the local node goes one at a time, so that two runs at once do not undo each other's clock or spend the
 * same coin. A lock left by a process that is gone is taken over after a minute.
 */
export const takeChainLock = (): (() => void) => {
  const lock = `${root}.local-runs/chain.lock`;
  mkdirSync(`${root}.local-runs`, { recursive: true });
  const until = Date.now() + 120_000;
  for (;;) {
    try {
      mkdirSync(lock);
      return () => rmSync(lock, { recursive: true, force: true });
    } catch {
      const age = (() => {
        try {
          return Date.now() - statSync(lock).mtimeMs;
        } catch {
          return 0;
        }
      })();
      if (age > 60_000) rmSync(lock, { recursive: true, force: true });
      else if (Date.now() > until) throw new Error(`the local chain stayed taken by another run for two minutes (${lock})`);
      else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
};
export const withChainLock = <T>(work: () => T): T => {
  const release = takeChainLock();
  try {
    return work();
  } finally {
    release();
  }
};

// ------------------------------------------------------------------ the key

/** On mainnet, the most a run's key is given or pays at once, in satoshis: what a run may put at risk. */
export const MAINNET_MOST = 150_000n;

interface KeyFile {
  privateKey: string;
  network: 'chipnet' | 'regtest' | 'mainnet';
  address: string;
  /** Where its coins go back to at the end. */
  funding: string;
  made: string;
}

const prefixOf = (network: KeyFile['network']): 'bchtest' | 'bchreg' | 'bitcoincash' => (network === 'mainnet' ? 'bitcoincash' : network === 'chipnet' ? 'bchtest' : 'bchreg');
const addressOf = (network: KeyFile['network'], lockingBytecode: Uint8Array): string => {
  const made = lockingBytecodeToCashAddress({ prefix: prefixOf(network), bytecode: lockingBytecode });
  if (typeof made === 'string') throw new Error(made);
  return made.address;
};
/** Mainnet's servers, as deploy/config/mainnet.example.json names them: the first that answers is used. */
export const MAINNET_SERVERS = ['wss://bch.imaginary.cash:50004', 'wss://electrum.imaginary.cash:50004', 'wss://fulcrum.greyh.at:50004'];
const server = async (network: KeyFile['network']): Promise<Electrum> => {
  if (network !== 'mainnet') return Electrum.connect(network === 'chipnet' ? 'wss://chipnet.9500.cash:443' : 'ws://127.0.0.1:60403');
  const problems: string[] = [];
  for (const endpoint of MAINNET_SERVERS) {
    try {
      return await Electrum.connect(endpoint);
    } catch (error) {
      problems.push(`${endpoint}: ${(error as Error).message}`);
    }
  }
  throw new Error(`no mainnet server answered: ${problems.join('; ')}`);
};
const cli = (...parameters: string[]): string => execFileSync(`${root}deploy/regtest/regtest.sh`, ['cli', ...parameters], { encoding: 'utf8' }).trim();
const tsx = (script: string, args: string[]): string => execFileSync('npx', ['tsx', script, ...args], { cwd: root, encoding: 'utf8' }).trim();

/** The owner's funding key on mainnet, read from its file; its address is checked against the one the file names. */
const mainnetFunder = (file: string | undefined): KeyFile => {
  if (file === undefined || !existsSync(file)) throw new Error(`on mainnet the funding key file is named, and it is not there: ${file ?? '(none named)'}`);
  const kept = JSON.parse(readFileSync(file, 'utf8')) as { privateKey: string; address: string };
  const address = addressOf('mainnet', p2pkhLockingBytecode(keyPairFromPrivateKey(hexToBin(kept.privateKey)).keyHash));
  if (address !== kept.address) throw new Error(`the funding key file names ${kept.address}, but its key's address is ${address}`);
  return { privateKey: kept.privateKey, network: 'mainnet', address, funding: address, made: '' };
};

/** The funding address of a network: the key of scripts/chipnet-pay.ts, or the local payer of scripts/local-pay.ts, or on mainnet the owner's. */
const fundingAddress = (network: KeyFile['network'], funderFile?: string): string => {
  if (network === 'mainnet') return mainnetFunder(funderFile).address;
  if (network === 'chipnet') return tsx('scripts/chipnet-pay.ts', ['address']);
  const file = `${root}.local-runs/local-funder.json`;
  if (!existsSync(file)) {
    mkdirSync(`${root}.local-runs`, { recursive: true });
    writeFileSync(file, JSON.stringify({ privateKey: binToHex(crypto.getRandomValues(new Uint8Array(32))) }), { mode: 0o600 });
  }
  const funder = keyPairFromPrivateKey(hexToBin((JSON.parse(readFileSync(file, 'utf8')) as { privateKey: string }).privateKey));
  return addressOf('regtest', p2pkhLockingBytecode(funder.keyHash));
};

/** The run's key, made and written to `file` if it is not there yet. */
export const runKey = (file: string, network: KeyFile['network'], funderFile?: string): KeyFile => {
  if (existsSync(file)) {
    const kept = JSON.parse(readFileSync(file, 'utf8')) as KeyFile;
    if (kept.network !== network) throw new Error(`${file} holds a key of ${kept.network}, not ${network}`);
    return kept;
  }
  const privateKey = binToHex(crypto.getRandomValues(new Uint8Array(32)));
  const pair = keyPairFromPrivateKey(hexToBin(privateKey));
  const made: KeyFile = { privateKey, network, address: addressOf(network, p2pkhLockingBytecode(pair.keyHash)), funding: fundingAddress(network, funderFile), made: new Date().toISOString() };
  writeFileSync(file, `${JSON.stringify(made, null, 1)}\n`, { mode: 0o600 });
  return made;
};

const readKey = (file: string): KeyFile => {
  const path = existsSync(file) && statSync(file).isDirectory() ? `${file.replace(/\/$/, '')}/run-key.json` : file;
  if (!existsSync(path)) throw new Error(`no run key at ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as KeyFile;
};

const coinsOf = async (electrum: Electrum, key: KeyFile): Promise<Utxo[]> => {
  const locking = p2pkhLockingBytecode(keyPairFromPrivateKey(hexToBin(key.privateKey)).keyHash);
  return (await electrum.listUnspent(locking, 'exclude')).map((entry) => ({ transactionHash: hexToBin(entry.transactionId), index: entry.index, output: { lockingBytecode: locking, valueSatoshis: entry.valueSatoshis } }));
};

/**
 * Pay from the run's key: every coin it holds goes in, the change comes back to it. `amount` undefined sends
 * everything, less the fee. On the local node one block is made afterwards unless `block` is false.
 */
const payFrom = async (key: KeyFile, to: string, amount: bigint | undefined, block = true): Promise<string> => {
  const decoded = /^[0-9a-f]+$/.test(to) ? hexToBin(to) : cashAddressToLockingBytecode(to.includes(':') ? to : `${prefixOf(key.network)}:${to}`);
  const lockingBytecode = decoded instanceof Uint8Array ? decoded : typeof decoded === 'string' ? undefined : decoded.bytecode;
  if (lockingBytecode === undefined) throw new Error(`not an address: ${to}`);
  const pair = keyPairFromPrivateKey(hexToBin(key.privateKey));
  const electrum = await server(key.network);
  try {
    // A coin the funding payment just made may take a moment to be listed.
    let coins = await coinsOf(electrum, key);
    for (let attempt = 0; attempt < 20 && coins.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      coins = await coinsOf(electrum, key);
    }
    const holds = coins.reduce((sum, coin) => sum + coin.output.valueSatoshis, 0n);
    if (amount === undefined && holds === 0n) return `${key.address} holds nothing`;
    if (key.network === 'mainnet' && amount !== undefined && amount > MAINNET_MOST) throw new Error(`on mainnet a payment of at most ${MAINNET_MOST} satoshis is made, not ${amount}`);
    if (amount !== undefined && holds < amount + 1_000n) throw new Error(`the run's key ${key.address} holds ${holds} satoshis, too little to pay ${amount}`);
    const built =
      amount === undefined
        ? buildTransaction({ inputs: coins.map((coin) => p2pkhInput(coin, pair)), outputs: [{ lockingBytecode, valueSatoshis: 0n }], remainderOutputIndex: 0 })
        : buildTransaction({ inputs: coins.map((coin) => p2pkhInput(coin, pair)), outputs: [{ lockingBytecode, valueSatoshis: amount }], changeLockingBytecode: lockingBytecodeOf(key) });
    const check = checkBeforeSending(built);
    if (check !== true) throw new Error(`the payment fails the check before sending: ${check}`);
    const paying = built.transaction.outputs[0]?.valueSatoshis ?? 0n;
    // Said before it is sent: what is about to go where, and the transaction's identifier.
    console.error(`about to send ${built.transactionId}: ${paying} satoshis from ${key.address} to ${to}, ${coins.length} coin${coins.length === 1 ? '' : 's'} in, a fee of ${holds - built.transaction.outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n)} satoshis for ${built.encoded.length} bytes`);
    const result = await electrum.broadcast(binToHex(built.encoded));
    if (!result.accepted) throw new Error(`not paid: ${result.reason}`);
    const paid = built.transaction.outputs[0]?.valueSatoshis ?? 0n;
    if (key.network === 'regtest' && block) {
      withChainLock(() => cli('generatetoaddress', '1', addressOf('regtest', hexToBin(`76a914${'00'.repeat(20)}88ac`))));
      return `paid ${paid} satoshis in ${built.transactionId}:0 from the run's key, confirmed at height ${cli('getblockcount')}`;
    }
    return `paid ${paid} satoshis in ${built.transactionId}:0 from ${key.address}, unconfirmed`;
  } finally {
    await electrum.disconnect();
  }
};
const lockingBytecodeOf = (key: KeyFile): Uint8Array => p2pkhLockingBytecode(keyPairFromPrivateKey(hexToBin(key.privateKey)).keyHash);

/** The run's key as hex of its locking bytecode, for naming it in a record; empty when there is none. */
export const runKeyLocking = (file: string): string => (existsSync(file) ? binToHex(lockingBytecodeOf(JSON.parse(readFileSync(file, 'utf8')) as KeyFile)) : '');

const balanceOf = async (key: KeyFile): Promise<bigint> => {
  const electrum = await server(key.network);
  try {
    return (await coinsOf(electrum, key)).reduce((sum, coin) => sum + coin.output.valueSatoshis, 0n);
  } finally {
    await electrum.disconnect();
  }
};

/** What an address holds, confirmed or not, and in how many coins. */
const holdsAt = async (address: string, network: KeyFile['network']): Promise<string> => {
  const decoded = cashAddressToLockingBytecode(address);
  if (typeof decoded === 'string') throw new Error(`not an address: ${address}`);
  const electrum = await server(network);
  try {
    const coins = await electrum.listUnspent(decoded.bytecode);
    return `${coins.reduce((sum, coin) => sum + coin.valueSatoshis, 0n)} satoshis in ${coins.length} coin${coins.length === 1 ? '' : 's'} at ${address}`;
  } finally {
    await electrum.disconnect();
  }
};

// ------------------------------------------------------------------ as a command

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, file, third, fourth, fifth] = process.argv.slice(2);
  const usage = 'usage: npx tsx scripts/run-key.ts fund <key file> <satoshis> [chipnet|regtest|mainnet <funding key file>] | pay <key file> <address> <satoshis> [--no-block] | balance <key file> | return <key file or run folder> | holds <address> <network>';
  if (command === undefined || file === undefined) {
    console.error(usage);
    process.exit(2);
  }
  try {
    if (command === 'fund' && third !== undefined) {
      const network = (fourth ?? 'regtest') as KeyFile['network'];
      if (!['chipnet', 'regtest', 'mainnet'].includes(network)) throw new Error(`not a network: ${network}`);
      if (network === 'mainnet') {
        // The run's key is made and written to its file before any coin is sent to it.
        const funder = mainnetFunder(fifth);
        const key = runKey(file, network, fifth);
        if (key.funding !== funder.address) throw new Error(`${file} returns its coins to ${key.funding}, not to the funding address ${funder.address}`);
        const amount = BigInt(third);
        if (amount > MAINNET_MOST) throw new Error(`on mainnet a run's key is given at most ${MAINNET_MOST} satoshis, not ${amount}`);
        console.log(`the run's key ${key.address}: ${await payFrom(funder, key.address, amount, false)}`);
      } else {
        const key = runKey(file, network);
        const said = tsx(network === 'chipnet' ? 'scripts/chipnet-pay.ts' : 'scripts/local-pay.ts', [key.address, third]);
        console.log(`the run's key ${key.address}: ${said}`);
      }
    } else if (command === 'pay' && third !== undefined && fourth !== undefined) {
      console.log(await payFrom(readKey(file), third, BigInt(fourth), !process.argv.includes('--no-block')));
    } else if (command === 'holds' && third !== undefined) {
      console.log(await holdsAt(file, third as KeyFile['network']));
    } else if (command === 'balance') {
      const key = readKey(file);
      console.log(`${await balanceOf(key)} satoshis at ${key.address}`);
    } else if (command === 'return') {
      const key = readKey(file);
      console.log(`back to the funding address ${key.funding}: ${await payFrom(key, key.funding, undefined)}`);
    } else {
      console.error(usage);
      process.exit(2);
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  process.exit(0);
}
