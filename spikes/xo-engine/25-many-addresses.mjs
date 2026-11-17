// Trial: what does it cost the engine to hold many addresses? A new device has to make every address again,
// in order, because the engine hands out key numbers one after another.
import { binToHex, sha256 } from '@bitauth/libauth';
import { openEngineRegtest } from './regtest.mjs';
import { addressTemplate } from './split-templates.mjs';

console.error = () => {};
const count = Number(process.argv[2] ?? 300);
const engine = await openEngineRegtest(`trial25-${Date.now()}`);
try {
  const addresses = (await engine.importTemplate(addressTemplate)).templateIdentifier;
  await engine.setDefaultPolicies({ address: { templateIdentifier: addresses } });
  const identity = binToHex(sha256.hash(Uint8Array.of(1)));
  const marks = [];
  const started = Date.now();
  for (let n = 0; n < count; n++) {
    const s = binToHex(sha256.hash(Uint8Array.of(n & 0xff, n >> 8)));
    await engine.generateLockingBytecodeFromDefaultPolicy('address', { tag: s, identity, addressSecret: s });
    if ((n + 1) % (count / 5) === 0) marks.push(`${n + 1}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
  console.log('addresses made:', marks.join(' | '));
  const listed = Date.now();
  console.log('script hashes followed:', (await engine.listScriptHashes()).length, `(listing took ${Date.now() - listed} ms)`);
  const secrets = (await engine.listSecretData()).map((s) => Number(s.value)).sort((a, b) => a - b);
  console.log('key numbers used:', secrets[0], 'to', secrets[secrets.length - 1], 'without a gap:', secrets.every((value, index) => value === index));
  console.log('memory:', Math.round(process.memoryUsage().rss / 1e6), 'MB');
} finally {
  await engine.stop().catch(() => {});
  process.exit();
}
