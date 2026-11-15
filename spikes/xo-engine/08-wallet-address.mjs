// Experiment 8: does the engine's wallet (asset covenant) locking bytecode match what our own code derives?
import { readFileSync } from 'node:fs';
import { hexToBin, binToHex, hash256, encodeLockingBytecodeP2sh32 } from '@bitauth/libauth';
const assetHex = /'([0-9a-f]+)'/.exec(readFileSync(new URL('../../contracts/artifacts/asset.ts', import.meta.url), 'utf8'))[1];
const identity = hexToBin('11'.repeat(4) + '22'.repeat(28));
const redeem = Uint8Array.from([0x20, ...identity.slice().reverse(), ...hexToBin(assetHex)]);
console.log('our derivation   ', binToHex(encodeLockingBytecodeP2sh32(hash256(redeem))));
console.log('engine (exp. 3)   aa20f1e4026fa21437d63ac50a9dc02b23cc3ad968683a95f3ce3ee9a58d7e9721d187');
