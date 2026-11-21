// Closes the wallet of a chipnet course in browsers once the course is over, as the scripted runs closed theirs:
// the controller's value and every coin left at the wallet's addresses go to the funding address in one
// transaction, and the wallet's identity ends. The pages offer no closing of a wallet; this is the run's own clean-up.
//
// The words come from what the course kept beside its profiles (`storage-<phone>.json`); the identity from the
// wallet's state there. A coin that carries a token is taken only when its category is named with --destroy: a key
// that opens nothing any more (an emptied jar, a closed loan) is destroyed in the closing, as the funder destroyed
// such keys after the scripted runs. Any other token, a coin at a vault address or one of a seed without words
// stops the script before anything is built. Where nothing but the controller is left, one coin of the funding
// address goes beside it, so that what arrives is above the dust limit; the funder gains the controller's value
// less the fee.
//
// usage: npx tsx scripts/close-run-wallet.ts <directory under .chipnet/> [--destroy <category>]... [--send]
//    or, for a run on mainnet with everything in its folder (scripts/browser-course.ts):
//        npx tsx scripts/close-run-wallet.ts mainnet --folder <absolute path> [--funder <funding key file>] [--destroy <category>]... [--send]
//   On mainnet the coins go to the funding address that the run's key names (run-key.json in the folder); the
//   funding key is needed only where nothing but the controller is left. There is no node of this project's own on
//   mainnet, so the node's testmempoolaccept is not asked: only this project's check is made before sending.
//   Without --send the transaction is built and checked (this project's check and the node's testmempoolaccept)
//   and nothing is sent. Prints one line for the run's record, and with --send writes it to closing.txt in the
//   run's directory, where the run's record takes it from.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { binToHex, cashAddressToLockingBytecode, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import {
  type InputSpec,
  type Utxo,
  ADDRESS_KIND,
  buildTransaction,
  checkBeforeSending,
  controllerInput,
  controllerScript,
  deriveSeedKeys,
  keyPairFromPrivateKey,
  p2pkhInput,
  p2pkhLockingBytecode,
  readControllerHistory,
  recoverableInput,
  searchWallet,
} from '@grandmas-wallet/core';

import { walletTemplateNumbers } from '../packages/app/src/templates.js';
import { Electrum } from '../packages/chipnet/src/electrum.js';
import { nodeRpc, testMempoolAccept } from '../packages/chipnet/src/node-rpc.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const mainnet = process.argv[2] === 'mainnet';
const valueOf = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const [directory] = process.argv.slice(2).filter((word, index, all) => !word.startsWith('--') && !['--destroy', '--folder', '--funder'].includes(all[index - 1] ?? ''));
const send = process.argv.includes('--send');
const destroy = new Set(process.argv.flatMap((word, index) => (word === '--destroy' && process.argv[index + 1] !== undefined ? [process.argv[index + 1] as string] : [])));
const usage = 'usage: npx tsx scripts/close-run-wallet.ts <directory under .chipnet/> [--destroy <category>]... [--send]\n   or: npx tsx scripts/close-run-wallet.ts mainnet --folder <absolute path> [--funder <funding key file>] [--destroy <category>]... [--send]';
const folder = valueOf('folder');
if (mainnet ? folder === undefined || !folder.startsWith('/') || !existsSync(`${folder.replace(/\/+$/, '')}/run-key.json`) : directory === undefined || !/^[a-z0-9][a-z0-9-]*$/.test(directory) || !existsSync(`${root}.chipnet/${directory}`)) {
  console.error(usage);
  process.exit(2);
}
const work = mainnet ? `${(folder ?? '').replace(/\/+$/, '')}/` : `${root}.chipnet/${directory}/`;
/** On mainnet, the funding address the run's key names; on chipnet, the address of the chipnet funder's key. */
const fundingAddress = mainnet ? (JSON.parse(readFileSync(`${work}run-key.json`, 'utf8')) as { funding: string; network: string }).funding : undefined;
const lockingOf = (address: string): Uint8Array => {
  const decoded = cashAddressToLockingBytecode(address);
  if (typeof decoded === 'string') throw new Error(`not an address: ${address}`);
  return decoded.bytecode;
};
/** The funder's key: on chipnet always, on mainnet only from --funder, which has to be the key of the funding address. */
const funderKey = (): ReturnType<typeof keyPairFromPrivateKey> => {
  const file = mainnet ? valueOf('funder') : `${root}.chipnet/funder-design-2.json`;
  if (file === undefined || !existsSync(file)) throw new Error('nothing but the controller is left: a coin of the funding address goes beside it, and --funder names the funding key\'s file');
  const pair = keyPairFromPrivateKey(hexToBin((JSON.parse(readFileSync(file, 'utf8')) as { privateKey: string }).privateKey));
  if (fundingAddress !== undefined && binToHex(p2pkhLockingBytecode(pair.keyHash)) !== binToHex(lockingOf(fundingAddress))) throw new Error(`${file} is not the key of the funding address ${fundingAddress}`);
  return pair;
};
const funderLocking = fundingAddress === undefined ? p2pkhLockingBytecode(funderKey().keyHash) : lockingOf(fundingAddress);
const addressOf = (bytecode: Uint8Array): string => {
  const made = lockingBytecodeToCashAddress({ prefix: mainnet ? 'bitcoincash' : 'bchtest', bytecode });
  return typeof made === 'string' ? binToHex(bytecode) : made.address;
};
/** The names under which the wallet page keeps things: mainnet's apart from the test networks'. */
const keptName = (name: string): string => `${mainnet ? 'gw2-wallet-mainnet' : 'gw2-wallet'}:${name}`;

// The words and the identity, from what the course kept of each phone's wallet page.
const words = new Set<string>();
let identity: string | undefined;
for (const file of readdirSync(work).filter((name) => /^storage-.*\.json$/.test(name))) {
  for (const items of Object.values(JSON.parse(readFileSync(`${work}${file}`, 'utf8')) as Record<string, Record<string, string>>)) {
    const said = items[keptName('words')];
    if (said !== undefined) words.add(JSON.parse(said) as string);
    const stored = items[keptName('state')];
    const state = stored === undefined ? undefined : (JSON.parse(stored) as { identity?: string | { $bytes: string } });
    const found = typeof state?.identity === 'string' ? state.identity : state?.identity?.$bytes;
    if (found !== undefined) {
      if (identity !== undefined && identity !== found) throw new Error('the phones of the run kept two different wallets');
      identity = found;
    }
  }
}
if (identity === undefined) throw new Error(`no wallet is kept in ${work}storage-*.json`);
const numbers = walletTemplateNumbers();
const seeds = [...words].map((said, index) => ({ label: `seed ${index + 1}`, keys: deriveSeedKeys(said, mainnet ? 'mainnet' : 'testnet', numbers) }));

const connect = async (): Promise<Electrum> => {
  if (!mainnet) return Electrum.connect('wss://chipnet.9500.cash:443');
  const servers = (JSON.parse(readFileSync(`${root}deploy/config/mainnet.example.json`, 'utf8')) as { chain: string[] }).chain;
  for (const endpoint of servers) {
    try {
      return await Electrum.connect(endpoint);
    } catch {
      // The next server of the configuration.
    }
  }
  throw new Error(`none of mainnet's servers answered: ${servers.join(', ')}`);
};
const server = await connect();
try {
  const chain = { getHistory: (bytecode: Uint8Array) => server.getHistory(bytecode), getTransaction: (id: string) => server.getTransaction(id), listUnspent: (bytecode: Uint8Array) => server.listUnspent(bytecode) };
  const history = await readControllerHistory(chain, hexToBin(identity));
  if (history.closed !== undefined) {
    console.log(`The wallet ${identity} was closed already, in ${history.closed.transactionId}.`);
    process.exit(0);
  }
  const { state, utxo } = history.current;
  const owner = seeds.find((seed) => binToHex(seed.keys.controllerKey.keyHash) === binToHex(state.ownerKeyHash));
  if (owner === undefined) throw new Error('none of the kept words holds the controller\'s owner key');
  const listed = await server.listUnspent(controllerScript(hexToBin(identity)).lockingBytecode);
  if (listed.length !== 1 || listed[0]?.transactionId !== binToHex(utxo.transactionHash)) throw new Error('the controller is not the one unspent output at its address');

  const search = await searchWallet(chain, hexToBin(identity), seeds.map(({ label, keys }) => ({ label, viewingKey: keys.viewingKey })), { passes: ['quick'] });
  if (search.reasons.length > 0) throw new Error(`the search of the wallet's addresses did not finish: ${search.reasons.join('; ')}`);
  const beside: InputSpec[] = [];
  const taken: string[] = [];
  for (const searched of search.seeds) {
    const seed = seeds.find((candidate) => candidate.label === searched.label);
    for (const found of searched.quick?.found ?? []) {
      for (const coin of found.coins) {
        const { address } = coin;
        if (address.kind === ADDRESS_KIND.vault) throw new Error(`a coin at a vault address (${binToHex(coin.utxo.transactionHash)}:${coin.utxo.index}): send it out through the controller first`);
        // A coin of a seed that no longer owns the wallet is released through the controller, not by its key.
        if (seed?.label !== owner.label) throw new Error(`a coin at an address of an earlier seed (${binToHex(coin.utxo.transactionHash)}:${coin.utxo.index}): sweep it first`);
        const { token } = coin.utxo.output;
        if (token !== undefined && !destroy.has(binToHex(token.category))) throw new Error(`a coin carries a token of ${binToHex(token.category)}, which was not named with --destroy`);
        const key = owner.keys.addressKey(address.kind, address.number);
        if (binToHex(key.keyHash) !== binToHex(address.keyHash)) throw new Error('an address key does not match its address');
        beside.push(recoverableInput(coin.utxo as Utxo, address.script, key));
        taken.push(`${coin.utxo.output.valueSatoshis.toLocaleString('en-US')} sat${token === undefined ? '' : ` with the NFT of ${binToHex(token.category).slice(0, 12)}…, destroyed`}`);
      }
    }
  }
  if (beside.length === 0) {
    const coins = (await server.listUnspent(funderLocking, 'exclude')).sort((a, b) => Number(a.valueSatoshis - b.valueSatoshis));
    const [smallest] = coins;
    if (smallest === undefined) throw new Error('the funding address holds no coin');
    beside.push(p2pkhInput({ transactionHash: hexToBin(smallest.transactionId), index: smallest.index, output: { lockingBytecode: funderLocking, valueSatoshis: smallest.valueSatoshis } }, funderKey()));
    taken.push(`a coin of the funding address of ${smallest.valueSatoshis.toLocaleString('en-US')} sat`);
  }
  const built = buildTransaction({
    inputs: [controllerInput(utxo, state, { kind: 'ownerClose' }, owner.keys.controllerKey), ...beside],
    outputs: [{ lockingBytecode: funderLocking, valueSatoshis: 0n }],
    remainderOutputIndex: 0,
    allowTokenBurn: true,
  });
  const check = checkBeforeSending(built);
  if (check !== true) throw new Error(`the closing fails the check before sending: ${check}`);
  const [arrives] = built.transaction.outputs;
  if (built.transaction.outputs.length !== 1 || arrives === undefined || binToHex(arrives.lockingBytecode) !== binToHex(funderLocking)) throw new Error('the closing does not pay the funding address alone');
  if (!mainnet) {
    const verdict = await testMempoolAccept(nodeRpc(JSON.parse(readFileSync(`${root}.chipnet/node-rpc.json`, 'utf8'))), binToHex(built.encoded));
    if (!verdict.allowed) throw new Error(`the node refuses the closing: ${verdict.reason}`);
  }
  const line = `The wallet \`${identity}\` was closed (transaction \`${built.transactionId}\`, ${built.encoded.length} bytes, fee ${built.feeSatoshis} sat): its controller of ${utxo.output.valueSatoshis.toLocaleString('en-US')} sat and ${taken.join(', ')} went to ${addressOf(funderLocking)}, where ${arrives.valueSatoshis.toLocaleString('en-US')} sat arrived.`;
  if (!send) {
    console.log(`Checked, not sent: ${line}`);
  } else {
    const result = await server.broadcast(binToHex(built.encoded));
    if (!result.accepted) throw new Error(`the network refused the closing: ${result.reason}`);
    console.log(line);
    // For the run's record, which names it under "The wallet closed".
    writeFileSync(`${work}closing.txt`, `${line}\n`);
  }
} finally {
  await server.disconnect();
}
