// Experiment 17: after reaching the tip, does header verification keep up with new blocks, without errors?
import { openEngine } from './common.mjs';
const errors = [];
const original = console.error;
console.error = (...args) => errors.push(String(args[0]).slice(0, 160));
const engine = await openEngine('owner');
const started = Date.now();
let last = '';
while (Date.now() - started < 200_000) {
  const status = await engine.getChainStatus();
  const line = `${status.verifiedHeight}/${status.currentHeight}`;
  if (line !== last) console.log(`${Math.round((Date.now() - started) / 1000)}s`, line);
  last = line;
  await new Promise((r) => setTimeout(r, 5000));
}
console.error = original;
console.log('errors logged:', errors.length, [...new Set(errors)].slice(0, 3));
await engine.stop().catch(() => undefined);
process.exit(0);
