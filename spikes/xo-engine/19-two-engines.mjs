// Experiment 19: can two accounts run in one process, each keeping its own state?
import { p2pkhTemplate } from '@xo-cash/templates';
import { openEngine, address } from './common.mjs';
console.error = () => undefined;
const report = async (name) => {
  const engine = await openEngine(name);
  const { templateIdentifier } = await engine.importTemplate(p2pkhTemplate);
  await engine.setDefaultPolicies({ change: { templateIdentifier }, receive: { templateIdentifier }, address: { templateIdentifier } });
  const first = await engine.generateLockingBytecodeFromDefaultPolicy('receive');
  for (let i = 0; i < 16; i++) await engine.generateLockingBytecodeFromDefaultPolicy('receive');
  return { engine, name, first, templateIdentifier };
};
const owner = await report('owner');
const bank = await report('bank');
await new Promise((r) => setTimeout(r, 6000));
for (const { engine, name, first, templateIdentifier } of [owner, bank]) {
  const coins = await engine.listSpendableUnspentOutputs({ templateIdentifier });
  console.log(name, address(first), 'coins', coins.map((c) => c.valueSatoshis), 'secrets', (await engine.listSecretData()).length, 'script hashes', (await engine.listScriptHashes()).length);
}
process.exit(0);
