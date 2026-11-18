// Trial: how the engine copes with following a script every user of an application shares (Paryon's contracts on
// chipnet), as it must to spend one coin there. Nothing is sent. Run with the chipnet header fix applied.
//
// usage (from packages/app): npx tsx ../../spikes/xo-engine/34-follow-shared-script.ts <lockingScript> [...]
import 'fake-indexeddb/auto';
import { generateBip39Mnemonic } from '@bitauth/libauth';
import { Engine, XO_SUPPORTED_NETWORKS, resolveElectrumServersForNetwork } from '@xo-cash/engine';

import { Account } from '../../packages/app/src/account.ts';
import { paryonChipnetTemplateText } from '../../packages/paryon/src/index.ts';

console.error = () => {};
const scripts = process.argv.slice(2);
const [first] = resolveElectrumServersForNetwork(XO_SUPPORTED_NETWORKS.chipnet);
if (first === undefined) throw new Error('no server');
const started = Date.now();
const account = await Account.open(await Engine.create(generateBip39Mnemonic(), { network: XO_SUPPORTED_NETWORKS.chipnet, electrumServers: [{ host: 'chipnet.9500.cash', version: first.version, transports: { wss: 443 }, blockchain: first.blockchain }] }));
console.log('open after', Date.now() - started, 'ms');
const identifier = await account.importTemplate(paryonChipnetTemplateText);
for (const lockingScript of scripts) {
  const t0 = Date.now();
  await account.followScript({ template: identifier, lockingScript, role: 'borrower', variables: {} });
  let last = -1;
  for (let i = 0; i < 120; i++) {
    const t = Date.now();
    const count = (await account.coins()).length;
    console.log(`${lockingScript}: ${count} coins listed at ${Date.now() - t0} ms (listing took ${Date.now() - t} ms)`);
    if (count === last && count > 0) break;
    last = count;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
await account.close();
process.exit();
