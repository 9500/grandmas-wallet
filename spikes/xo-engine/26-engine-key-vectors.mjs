// Records the public keys the engine makes for a known seed, as test vectors: this project's own derivation
// must give the same keys (acceptance test KV07).
// usage: node 26-engine-key-vectors.mjs > ../../test/vectors/engine-keys.json
import { binToHex, hash160, hexToBin } from '@bitauth/libauth';
import { openEngineRegtest } from './regtest.mjs';
import { mnemonicFor } from './common.mjs';
import { addressTemplate, controllerTemplate } from './split-templates.mjs';

const log = console.log;
console.error = () => {};
const engine = await openEngineRegtest('vectors');
try {
  const controller = (await engine.importTemplate(controllerTemplate)).templateIdentifier;
  const addresses = (await engine.importTemplate(addressTemplate)).templateIdentifier;
  // The controller key: the first key of the controller template.
  await engine.createInvitation({ templateIdentifier: controller, actionIdentifier: 'create', intent: controllerTemplate.start[0] });
  await engine.setDefaultPolicies({ address: { templateIdentifier: addresses } });
  const identity = '11'.repeat(32);
  for (let n = 0; n < 4; n++) await engine.generateLockingBytecodeFromDefaultPolicy('address', { tag: `${n}${n}`.repeat(32), identity, addressSecret: '22'.repeat(32) });
  const keysOf = async (templateIdentifier) => {
    const secrets = (await engine.listSecretData()).filter((s) => s.templateIdentifier === templateIdentifier).sort((a, b) => Number(a.value) - Number(b.value));
    return Promise.all(secrets.map(async (s) => ({ number: Number(s.value), publicKey: await engine.getSecretPublicKey(s.secretLookupKey) })));
  };
  const withHash = (keys) => keys.map((k) => ({ ...k, keyHash: binToHex(hash160(hexToBin(k.publicKey))) }));
  log(JSON.stringify({
    description: 'Public keys made by the XO engine 0.1.1-next.18029697917 for a known seed, on a test network. Made by spikes/xo-engine/26-engine-key-vectors.mjs.',
    mnemonic: mnemonicFor('vectors'),
    network: 'testnet',
    templates: [
      { templateIdentifier: controller, keys: withHash(await keysOf(controller)) },
      { templateIdentifier: addresses, keys: withHash(await keysOf(addresses)) },
    ],
  }, null, 1));
} finally {
  await engine.stop().catch(() => {});
  process.exit();
}
