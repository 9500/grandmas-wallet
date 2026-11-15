// Experiment 13: check a transaction built by the engine against the network rules locally, input by input.
// run from the repository root: npx tsx spikes/xo-engine/13-inspect.ts
import { readFileSync } from 'node:fs';
import { binToHex, decodeTransactionBch, hexToBin, createVirtualMachineBch2026, type Output } from '@bitauth/libauth';
import { Electrum } from '../../packages/chipnet/src/electrum.js';
import { controllerScript, assetScript, decodeControllerState } from '../../packages/core/src/index.js';

const flow = JSON.parse(readFileSync(new URL('./.data/flow.json', import.meta.url), 'utf8'));
const transaction = decodeTransactionBch(hexToBin(readFileSync(new URL('./.data/last-tx.hex', import.meta.url), 'utf8').trim()));
if (typeof transaction === 'string') throw new Error(transaction);
const electrum = await Electrum.connect('wss://chipnet.9500.cash:443');
const sourceOutputs: Output[] = [];
for (const input of transaction.inputs) {
  const hex = await electrum.getTransaction(binToHex(input.outpointTransactionHash));
  const source = decodeTransactionBch(hexToBin(hex ?? ''));
  if (typeof source === 'string') throw new Error(source);
  sourceOutputs.push(source.outputs[input.outpointIndex]!);
}
await electrum.disconnect();

const identity = hexToBin(flow.identity);
const controller = controllerScript(identity);
const asset = assetScript(identity);
console.log('version', transaction.version, 'locktime', transaction.locktime);
transaction.inputs.forEach((input, index) => {
  const unlocking = binToHex(input.unlockingBytecode);
  const tail = (redeem: Uint8Array) => unlocking.endsWith(binToHex(redeem));
  console.log(`input ${index}: sequence ${input.sequenceNumber}, unlocking ${input.unlockingBytecode.length} bytes, ends with controller redeem: ${tail(controller.redeemBytecode)}, asset redeem: ${tail(asset.redeemBytecode)}`);
  console.log(`   unlocking starts ${unlocking.slice(0, 210)}`);
});
transaction.outputs.forEach((output, index) => {
  const commitment = output.token?.nft?.commitment;
  console.log(`output ${index}: ${output.valueSatoshis} sat, locking ${binToHex(output.lockingBytecode).slice(0, 20)}…, token ${output.token ? binToHex(output.token.category).slice(0, 16) + ' ' + output.token.nft?.capability : 'none'}`);
  if (commitment) {
    console.log('   commitment', binToHex(commitment));
    try { console.log('   decodes to', decodeControllerState(commitment).status); } catch (error) { console.log('   does not decode:', (error as Error).message); }
  }
});
console.log('input 0 state     ', binToHex(sourceOutputs[0]!.token!.nft!.commitment));
const vm = createVirtualMachineBch2026(true);
console.log('verify:', vm.verify({ transaction, sourceOutputs }));
process.exit(0);
