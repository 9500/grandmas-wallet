// Trial: does the engine run against the local regtest chain, and does it see a coin mined to its address?
import { p2pkhTemplate } from '@xo-cash/templates';
import { openEngineRegtest, rpc, mine, BURN, regtestAddress } from './regtest.mjs';
import { show } from './common.mjs';

const errors = [];
console.error = (...args) => errors.push(String(args[0]).slice(0, 160));
const engine = await openEngineRegtest('trial22');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const p2pkh = (await engine.importTemplate(p2pkhTemplate)).templateIdentifier;
  await engine.setDefaultPolicies({ change: { templateIdentifier: p2pkh }, receive: { templateIdentifier: p2pkh }, address: { templateIdentifier: p2pkh } });
  const locking = await engine.generateLockingBytecodeFromDefaultPolicy('receive');
  console.log('address', regtestAddress(locking), 'connections', engine.listElectrumConnections().map((c) => `${c.host ?? c.hostname} ${c.status}`));
  if ((await rpc('getblockcount')) < 101) { await mine(1, locking); await mine(100, BURN); } else await mine(1, BURN);
  for (let attempt = 0; attempt < 20; attempt++) {
    const coins = await engine.listSpendableUnspentOutputs({ templateIdentifier: p2pkh });
    if (coins.length > 0) { show('coins', coins.map((u) => `${u.outpointTransactionHash}:${u.outpointIndex} ${u.valueSatoshis}`)); break; }
    await wait(1000);
  }
  show('chain status', await engine.getChainStatus());
  show('unspent', (await engine.listUnspentOutputs()).length);
  show('distinct engine errors', [...new Set(errors)].slice(0, 5));
} finally {
  await engine.stop().catch(() => {});
  process.exit(0);
}
