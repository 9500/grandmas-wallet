// Experiment 1: does the engine start on chipnet in Node with the pinned versions?
import { p2pkhTemplate } from '@xo-cash/templates';
import { openEngine, address, show } from './common.mjs';

const started = Date.now();
const engine = await openEngine(process.argv[2] ?? 'owner');
console.log(`engine started in ${Date.now() - started} ms`);
try {
  show('connections', await engine.listElectrumConnections());
  show('chain status', await engine.getChainStatus());
  const { templateIdentifier } = await engine.importTemplate(p2pkhTemplate);
  console.log('p2pkh template', templateIdentifier);
  await engine.setDefaultPolicies({ change: { templateIdentifier }, receive: { templateIdentifier }, address: { templateIdentifier } });
  const locking = await engine.generateLockingBytecodeFromDefaultPolicy('receive');
  console.log('receive address', address(locking));
  show('unspent', await engine.listUnspentOutputs());
} finally {
  await engine.stop();
}
