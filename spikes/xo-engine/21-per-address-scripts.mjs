// Trial: can the engine make many addresses of one script, each with its own tag and key,
// and which keys does it use for them?
//
// The script here stands in for RecoverableAddress: a tag and a key hash, both different per address.
import { deriveHdPath, deriveHdPrivateNodeFromSeed, deriveSeedFromBip39Mnemonic, secp256k1, binToHex, hexToBin, sha256, hash160 } from '@bitauth/libauth';
import { generateTemplateIdentifier } from '@xo-cash/utils';
import { openEngine, mnemonicFor, show } from './common.mjs';

const view = (name, description = name) => ({ name, description });
const template = {
  $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
  ...view('Per-address script (trial)'),
  version: '0',
  supported: ['BCH_2026_05'],
  defaults: {
    address: { lockingScript: 'addressLockingScript', role: 'owner', generate: ['addressKey'], variables: [{ tag: null }] },
  },
  roles: { owner: view('Owner') },
  start: [],
  actions: {},
  transactions: {},
  inputs: { addressInput: { ...view('Address'), unlockingScript: 'unlockAddress' } },
  outputs: {},
  lockingScripts: {
    addressLockingScript: {
      ...view('Address'),
      lockingType: 'p2sh',
      lockingBytecode: 'addressBytecode',
      state: { variables: ['tag'] },
      roles: { owner: { state: { secrets: ['addressKey'] }, balance: { satoshis: true, fungibleTokens: true, nonfungibleTokens: true }, selectable: true } },
    },
  },
  scripts: {
    addressBytecode: '<tag> OP_DROP OP_DUP OP_HASH160 <$(<addressKey.public_key> OP_HASH160)> OP_EQUALVERIFY OP_CHECKSIG',
    unlockAddress: '<addressKey.schnorr_signature.all_outputs> <addressKey.public_key>',
  },
  variables: {
    addressKey: { ...view('Address key'), type: 'private_key' },
    tag: { ...view('Address tag'), type: 'bytes' },
  },
};

const account = process.argv[2] ?? 'trial21';
const engine = await openEngine(account);
try {
  const imported = await engine.importTemplate(template);
  const templateIdentifier = imported.templateIdentifier ?? generateTemplateIdentifier(template);
  show('template', { templateIdentifier, imported: Object.keys(imported) });
  await engine.setDefaultPolicies({ address: { templateIdentifier } });
  show('required variables', await engine.listDefaultPolicyRequiredVariables('address'));

  const tags = [1, 2, 3].map((n) => '0x' + binToHex(sha256.hash(Uint8Array.of(n))));
  const made = [];
  for (const tag of tags) made.push(await engine.generateLockingBytecodeFromDefaultPolicy('address', { tag }));
  show('locking bytecodes', made);
  show('same tag again gives', await engine.generateLockingBytecodeFromDefaultPolicy('address', { tag: tags[0] }));

  const secrets = await engine.listSecretData();
  show('secrets', secrets.map(({ secretIdentifier, value, isEntropy, templateIdentifier: t }) => ({ secretIdentifier, value, isEntropy, sameTemplate: t === templateIdentifier })));
  const hashes = await engine.listScriptHashes();
  show('tracked script hashes', hashes.length);
  show('first tracked', hashes[0]);

  // Our own derivation of the same keys: m / 42415' / T' / 0' / index, T from the template identifier.
  const seed = deriveSeedFromBip39Mnemonic(mnemonicFor(account));
  const master = deriveHdPrivateNodeFromSeed(seed);
  const idBytes = hexToBin(templateIdentifier);
  const T = (idBytes[0] | (idBytes[1] << 8) | (idBytes[2] << 16) | (idBytes[3] << 24)) & 0x7fffffff;
  for (const index of [0, 1, 2, 3]) {
    const node = deriveHdPath(master, `m/42415'/${T >>> 0}'/0'/${index}`);
    const pub = secp256k1.derivePublicKeyCompressed(node.privateKey);
    const keyHash = binToHex(hash160(pub));
    console.log(`index ${index}: our key hash is in address`, made.findIndex((bytecode) => false), '| engine public key', await engine.getSecretPublicKey(secrets[index]?.secretLookupKey ?? ''), '| ours', binToHex(pub), '| key hash', keyHash);
  }
} finally {
  await engine.stop();
}
