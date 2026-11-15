// Experiment 15: derive the engine's template key ourselves and spend the engine-created wallet with our own
// transaction builder. Shows that a wallet made through XO is not tied to the engine, and returns the coins
// that the engine could not spend (experiment 14).
// run from the repository root: npx tsx spikes/xo-engine/15-recover-wallet.ts <destination address> [--send]
import { readFileSync } from 'node:fs';
import {
  binToHex, binToNumberUint32LE, cashAddressToLockingBytecode, decodeTransactionBch, deriveHdPath,
  deriveHdPrivateNodeFromSeed, deriveSeedFromBip39Mnemonic, hexToBin, type Output,
} from '@bitauth/libauth';
import { Electrum } from '../../packages/chipnet/src/electrum.js';
import {
  assetScript, buildTransaction, controllerInput, controllerSuccessor, decodeControllerState, keyPairFromPrivateKey,
  protectedInput, verifyTransaction, type Utxo,
} from '../../packages/core/src/index.js';

const here = (path: string) => new URL(path, import.meta.url);
const flow = JSON.parse(readFileSync(here('./.data/flow.json'), 'utf8'));
const template = JSON.parse(readFileSync(here('./flow-template.json'), 'utf8'));
const { generateTemplateIdentifier } = await import('@xo-cash/utils' as string).catch(() => ({ generateTemplateIdentifier: undefined }));
void template; void generateTemplateIdentifier;
const TEMPLATE_IDENTIFIER = '0ca3919524e4f4237311997b989011d2c1df0456f22e34d341b4b5096f36a024';

/** The engine's key for a template: m/42415'/{first 4 bytes of the template identifier, little-endian, 31 bits}'/0'/{index} on test networks. */
const templateKey = (mnemonic: string, templateIdentifier: string, index: number) => {
  const seed = deriveSeedFromBip39Mnemonic(mnemonic);
  const master = deriveHdPrivateNodeFromSeed(seed);
  const templateIndex = binToNumberUint32LE(hexToBin(templateIdentifier).slice(0, 4)) & 0x7fffffff;
  const node = deriveHdPath(master, `m/42415'/${templateIndex}'/0'/${index}`);
  if (typeof node === 'string') throw new Error(node);
  return keyPairFromPrivateKey(node.privateKey);
};

const owner = templateKey(readFileSync(here('./.data/owner.mnemonic'), 'utf8').trim(), TEMPLATE_IDENTIFIER, 0);
const recoverer = templateKey(readFileSync(here('./.data/bank.mnemonic'), 'utf8').trim(), TEMPLATE_IDENTIFIER, 0);
console.log('owner key hash     derived', binToHex(owner.keyHash), '| in wallet state', flow.ownerKeyHash);
console.log('recoverer key hash derived', binToHex(recoverer.keyHash), '| in wallet state', flow.recovererKeyHash);
if (binToHex(owner.keyHash) !== flow.ownerKeyHash) throw new Error('derived owner key does not match the wallet');

const [destination, flag] = process.argv.slice(2);
if (destination === undefined) process.exit(0);
const destinationLocking = cashAddressToLockingBytecode(destination);
if (typeof destinationLocking === 'string') throw new Error(destinationLocking);

const electrum = await Electrum.connect('wss://chipnet.9500.cash:443');
const utxo = async ({ hash, index }: { hash: string; index: number }): Promise<Utxo> => {
  const transaction = decodeTransactionBch(hexToBin((await electrum.getTransaction(hash)) ?? ''));
  if (typeof transaction === 'string') throw new Error(transaction);
  return { transactionHash: hexToBin(hash), index, output: transaction.outputs[index] as Output };
};
const controller = await utxo(flow.controller);
const wallet = await utxo(flow.wallet);
const state = decodeControllerState(controller.output.token!.nft!.commitment);
const action = { kind: 'ownerAuthorize' } as const;
const built = buildTransaction({
  inputs: [controllerInput(controller, state, action, owner), protectedInput(wallet, assetScript(hexToBin(flow.identity)), owner)],
  outputs: [controllerSuccessor(controller, state, action)],
  changeLockingBytecode: destinationLocking.bytecode,
});
console.log('local check', verifyTransaction(built), '| fee', built.feeSatoshis, '| returns', built.transaction.outputs[1]?.valueSatoshis);
if (flag === '--send') console.log('broadcast', await electrum.broadcast(binToHex(built.encoded)));
await electrum.disconnect();
process.exit(0);
