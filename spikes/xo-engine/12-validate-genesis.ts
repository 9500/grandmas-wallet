// Experiment 12: does a wallet created through the XO engine pass our own genesis validation?
// run from the repository root: npx tsx spikes/xo-engine/12-validate-genesis.ts
import { readFileSync } from 'node:fs';
import { binToHex, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { validateGenesis, controllerScript, assetScript } from '../../packages/core/src/index.js';
import { Electrum } from '../../packages/chipnet/src/electrum.js';

const flow = JSON.parse(readFileSync(new URL(`./.data/${process.env.FLOW_NAME ?? 'flow'}.json`, import.meta.url), 'utf8'));
const electrum = await Electrum.connect('wss://chipnet.9500.cash:443');
const hex = await electrum.getTransaction(flow.controller.hash);
await electrum.disconnect();
if (hex === undefined) throw new Error('genesis transaction not found');
const transaction = decodeTransactionBch(hexToBin(hex));
if (typeof transaction === 'string') throw new Error(transaction);
const identity = hexToBin(flow.identity);
const snapshot = validateGenesis(transaction, hexToBin(flow.controller.hash), identity);
console.log('genesis valid; state', { ...snapshot.state, ownerKeyHash: binToHex(snapshot.state.ownerKeyHash), recovererKeyHash: binToHex(snapshot.state.recovererKeyHash) });
console.log('controller address matches ours', binToHex(transaction.outputs[0]!.lockingBytecode) === binToHex(controllerScript(identity).lockingBytecode));
console.log('wallet address matches ours    ', binToHex(transaction.outputs[1]!.lockingBytecode) === binToHex(assetScript(identity).lockingBytecode));
process.exit(0);
