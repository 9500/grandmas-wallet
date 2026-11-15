// Experiment 14: which message did the engine sign? Try candidate signing inputs against its signature.
// run from the repository root: npx tsx spikes/xo-engine/14-sigcheck.ts [inputIndex]
import { readFileSync } from 'node:fs';
import {
  binToHex, decodeTransactionBch, hexToBin, generateSigningSerializationBch, hash256, secp256k1, type Output,
} from '@bitauth/libauth';
import { Electrum } from '../../packages/chipnet/src/electrum.js';
import { controllerScript, assetScript } from '../../packages/core/src/index.js';

const inputIndex = Number(process.argv[2] ?? 0);
const flow = JSON.parse(readFileSync(new URL('./.data/flow.json', import.meta.url), 'utf8'));
const transaction = decodeTransactionBch(hexToBin(readFileSync(new URL('./.data/last-tx.hex', import.meta.url), 'utf8').trim()));
if (typeof transaction === 'string') throw new Error(transaction);
const electrum = await Electrum.connect('wss://chipnet.9500.cash:443');
const sourceOutputs: Output[] = [];
for (const input of transaction.inputs) {
  const source = decodeTransactionBch(hexToBin((await electrum.getTransaction(binToHex(input.outpointTransactionHash))) ?? ''));
  if (typeof source === 'string') throw new Error(source);
  sourceOutputs.push(source.outputs[input.outpointIndex]!);
}
await electrum.disconnect();

const unlocking = transaction.inputs[inputIndex]!.unlockingBytecode;
const signature = unlocking.slice(1, 65);
const signingType = unlocking[65]!;
const publicKey = unlocking.slice(67, 100);
const identity = hexToBin(flow.identity);
const redeem = inputIndex === 0 ? controllerScript(identity).redeemBytecode : assetScript(identity).redeemBytecode;
console.log('signing type byte', signingType.toString(16), 'public key', binToHex(publicKey));

const withoutTokens = sourceOutputs.map(({ lockingBytecode, valueSatoshis }) => ({ lockingBytecode, valueSatoshis }));
// The engine fills in the spent output of the input being signed and leaves the others empty.
const onlyOwn: Output[] = [];
onlyOwn[inputIndex] = sourceOutputs[inputIndex]!;
const candidates: [string, Uint8Array, Output[]][] = [
  ['redeem script, real spent outputs', redeem, sourceOutputs],
  ['locking bytecode, real spent outputs', sourceOutputs[inputIndex]!.lockingBytecode, sourceOutputs],
  ['redeem script minus its first push (contract body only)', redeem.slice(33), sourceOutputs],
  ['redeem script, spent outputs without tokens', redeem, withoutTokens],
  ['locking bytecode, spent outputs without tokens', sourceOutputs[inputIndex]!.lockingBytecode, withoutTokens],
  ['redeem script, only this input\'s spent output known', redeem, onlyOwn],
];
for (const [label, coveredBytecode, sources] of candidates) {
  for (const type of [signingType, 0x41]) {
    let ok = false;
    try {
      const message = hash256(generateSigningSerializationBch(
        { inputIndex, sourceOutputs: sources, transaction },
        { coveredBytecode, signingSerializationType: Uint8Array.of(type) },
      ));
      ok = secp256k1.verifySignatureSchnorr(signature, publicKey, message);
    } catch (error) {
      console.log('  err', `type ${type.toString(16)}:`, label, '-', (error as Error).message.slice(0, 80));
      continue;
    }
    console.log(ok ? 'MATCH' : '  no ', `type ${type.toString(16)}:`, label);
  }
}
process.exit(0);
