// Experiment 5: does the engine's block header verification reach the chipnet tip (1-minute blocks)?
import { openEngine } from './common.mjs';
const engine = await openEngine('owner');
const started = Date.now();
let last = '';
while (Date.now() - started < 240_000) {
  const status = await engine.getChainStatus();
  const line = `${status.verifiedHeight}/${status.currentHeight} (${status.verifiedPercent}%)`;
  if (line !== last) console.log(`${Math.round((Date.now() - started) / 1000)}s`, line);
  last = line;
  if (status.verifiedHeight >= status.currentHeight) break;
  await new Promise((r) => setTimeout(r, 5000));
}
await engine.stop().catch((e) => console.log('stop() failed:', e.constructor.name, e.message));
process.exit(0);
