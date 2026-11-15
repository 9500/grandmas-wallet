// Local fix for the engine's signing of "all outputs, all UTXOs" signatures (see docs/xo-spike.md).
//
// The engine gives the signing code only the spent output of the input being signed. A signature that covers
// all spent outputs is then wrong for any transaction with more than one input. This fills in the spent
// outputs of the other inputs, looked up by outpoint through the engine's own Electrum helper.
//
// usage: node patches/engine-sign-all-utxos.mjs [--revert]
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../node_modules/@xo-cash/engine/dist/index.mjs', import.meta.url);
const original = `	const sourceOutputs = [];
	sourceOutputs[inputIndex] = sourceOutputCompatibleWithCompiler;`;
const patched = `	const sourceOutputs = [];
	/* grandmas-wallet patch: provide every input's spent output, so signatures covering all UTXOs are valid */
	for (const [otherInputIndex, otherInput] of mergedInvitation.inputs.entries()) {
		if (otherInputIndex === inputIndex) continue;
		if (otherInput.outpointTransactionHash === void 0 || otherInput.outpointIndex === void 0) continue;
		sourceOutputs[otherInputIndex] = await fetchDecodedTransactionOutput(binToHex(otherInput.outpointTransactionHash), otherInput.outpointIndex);
	}
	sourceOutputs[inputIndex] = sourceOutputCompatibleWithCompiler;`;

const source = readFileSync(file, 'utf8');
const revert = process.argv.includes('--revert');
const [from, to] = revert ? [patched, original] : [original, patched];
if (source.includes(to)) {
  console.log(revert ? 'engine is already unpatched' : 'engine is already patched');
} else if (source.split(from).length === 2) {
  writeFileSync(file, source.replace(from, to));
  console.log(revert ? 'patch reverted' : 'patch applied');
} else {
  throw new Error('The engine build does not contain the expected code; is this engine 0.1.1-next.18029697917?');
}
