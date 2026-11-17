// Where does the engine's header check stand on chipnet, with the published packages as installed?
import 'fake-indexeddb/auto';
import { generateBip39Mnemonic } from '@bitauth/libauth';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';
console.error = () => {};
const engine = await Engine.create(generateBip39Mnemonic(), { network: XO_SUPPORTED_NETWORKS.chipnet });
for (let second = 0; second < 40; second += 5) {
  const status = await engine.getChainStatus();
  console.log(`${second} s: checked ${status.verifiedHeight} of ${status.currentHeight}`);
  if (status.verifiedHeight >= status.currentHeight) break;
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
await engine.stop().catch(() => {});
process.exit();
