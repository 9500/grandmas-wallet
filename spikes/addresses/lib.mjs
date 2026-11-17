// Shared helpers of the address trial: scripts, keys, secrets, tags, and a
// small transaction builder that pays the exact fee. Nothing here is meant
// for production; stage 1 builds the real thing in packages/core.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as L from '@bitauth/libauth';

export { L };
export const hex = L.binToHex;
export const bin = L.hexToBin;

const here = dirname(fileURLToPath(import.meta.url));
const bytecode = (name) => bin(readFileSync(join(here, 'artifacts', `${name}.hex`), 'utf8').trim());
export const CONTROLLER = bytecode('controller');
export const RECOVERABLE = bytecode('recoverableAddress');
export const VAULT = bytecode('vaultAddress');

export const key = (seedByte) => {
  const privateKey = new Uint8Array(32).fill(seedByte);
  const publicKey = L.secp256k1.derivePublicKeyCompressed(privateKey);
  return { privateKey, publicKey, keyHash: L.hash160(publicKey) };
};

export const p2pkh = (k) => L.encodeLockingBytecodeP2pkh(k.keyHash);
const push = L.encodeDataPush;
const pushNumber = (n) => push(L.bigIntToVmNumber(BigInt(n)));
/** Constructor arguments precede the contract body, last argument first. */
const instantiate = (body, args) => L.flattenBinArray([...[...args].reverse().map(push), body]);
const p2sh32 = (redeem) => L.encodeLockingBytecodeP2sh32(L.hash256(redeem));
const le4 = (n) => Uint8Array.of(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);

export const ZERO20 = new Uint8Array(20);
/** One unit of 512 seconds, as a BIP68 relative lock. */
export const DELAY = 0x400001;
const delayBytes = (sequence) => Uint8Array.of(sequence & 0xff, (sequence >> 8) & 0xff, (sequence >> 16) & 0xff);

/** The 69 bytes of controller state (proposal section 5.1). */
export const state = ({ status = 0, epoch = 0, owner, recoverer, delay = DELAY, proposed = ZERO20 }) =>
  L.flattenBinArray([Uint8Array.of(1, status), le4(epoch), owner, recoverer, delayBytes(delay), proposed]);

/**
 * The scripts of one wallet. `identity` is in the byte order explorers show;
 * scripts see it reversed.
 */
export const wallet = (identity, blindingSeed) => {
  const forScript = identity.slice().reverse();
  const controllerRedeem = instantiate(CONTROLLER, [forScript]);
  const secret = (kind, n) => L.hash256(L.flattenBinArray([blindingSeed, Uint8Array.of(kind), le4(n)]));
  const tag = (s) => L.hash256(L.flattenBinArray([forScript, s]));
  return {
    identity,
    forScript,
    controller: { redeem: controllerRedeem, locking: p2sh32(controllerRedeem) },
    controllerOutput: (stateBytes, valueSatoshis = 1000n) => ({
      lockingBytecode: p2sh32(controllerRedeem),
      valueSatoshis,
      token: { amount: 0n, category: identity, nft: { capability: 'mutable', commitment: stateBytes } },
    }),
    /** Recoverable address (kind, n) for the key `k`. */
    recoverable: (kind, n, k) => {
      const s = secret(kind, n);
      const redeem = instantiate(RECOVERABLE, [tag(s), k.keyHash]);
      return { kind: 'recoverable', key: k, secret: s, redeem, locking: p2sh32(redeem) };
    },
    vault: (n) => {
      const s = secret(2, n);
      const redeem = instantiate(VAULT, [tag(s)]);
      return { kind: 'vault', secret: s, redeem, locking: p2sh32(redeem) };
    },
  };
};

// ---- inputs. A coin is { txid, index, output }; txid as explorers show it.

const SELECTOR = { ownerAuthorize: 0, requestRecovery: 1, finalizeRecovery: 2, ownerUpdate: 3, ownerClose: 4 };

/** The controller, spent with `action`. `args` are the action's arguments after the key and signature, in declaration order. */
export const controllerInput = (w, coin, action, k, args = [], sequence = 0) => ({
  label: `controller ${action}`,
  coin,
  sequence,
  covered: w.controller.redeem,
  key: k,
  unlock: (sig) => L.flattenBinArray([...[...args].reverse().map(push), push(sig), push(k.publicKey), pushNumber(SELECTOR[action]), push(w.controller.redeem)]),
});

/** A recoverable address spent by its own key. `k` defaults to the address's key. */
export const keyInput = (coin, address, k = address.key) => ({
  label: 'spent by key',
  coin,
  covered: address.redeem,
  key: k,
  unlock: (sig) => L.flattenBinArray([push(sig), push(k.publicKey), pushNumber(0), push(address.redeem)]),
});

/** A recoverable address swept through the controller. Identity and secret can be overridden to try wrong ones. */
export const sweepInput = (w, coin, address, { identity = w.forScript, secret = address.secret } = {}) => ({
  label: 'swept',
  coin,
  covered: address.redeem,
  unlock: () => L.flattenBinArray([push(secret), push(identity), pushNumber(1), push(address.redeem)]),
});

export const vaultInput = (w, coin, address, { identity = w.forScript, secret = address.secret } = {}) => ({
  label: 'vault',
  coin,
  covered: address.redeem,
  unlock: () => L.flattenBinArray([push(secret), push(identity), push(address.redeem)]),
});

export const p2pkhInput = (coin, k) => ({
  label: 'P2PKH',
  coin,
  covered: coin.output.lockingBytecode,
  key: k,
  unlock: (sig) => L.flattenBinArray([push(sig), push(k.publicKey)]),
});

const sign = (transaction, sourceOutputs, inputIndex, coveredBytecode, k, signingType) => {
  const serialization = L.generateSigningSerializationBch(
    { inputIndex, sourceOutputs, transaction },
    { coveredBytecode, signingSerializationType: Uint8Array.of(signingType) },
  );
  return L.flattenBinArray([L.secp256k1.signMessageHashSchnorr(k.privateKey, L.hash256(serialization)), Uint8Array.of(signingType)]);
};

/**
 * Build and sign. If `remainder` names an output, that output receives what
 * is left after the exact fee of one satoshi per byte (plus `extraFee`).
 */
export const build = (inputs, outputs, { remainder, signingType = 0x61, extraFee = 0n } = {}) => {
  const sourceOutputs = inputs.map((i) => i.coin.output);
  const make = (outs) => {
    const transaction = {
      version: 2,
      locktime: 0,
      inputs: inputs.map((i) => ({ outpointTransactionHash: bin(i.coin.txid), outpointIndex: i.coin.index, sequenceNumber: i.sequence ?? 0, unlockingBytecode: new Uint8Array(0) })),
      outputs: outs,
    };
    inputs.forEach((i, n) => {
      const sig = i.key === undefined ? undefined : sign(transaction, sourceOutputs, n, i.covered, i.key, signingType);
      transaction.inputs[n].unlockingBytecode = i.unlock(sig);
    });
    return transaction;
  };
  const total = sourceOutputs.reduce((sum, o) => sum + o.valueSatoshis, 0n);
  let outs = outputs;
  if (remainder !== undefined) {
    const fixed = outputs.reduce((sum, o, n) => sum + (n === remainder ? 0n : o.valueSatoshis), 0n);
    const size = BigInt(L.encodeTransactionBch(make(outputs)).length);
    outs = outputs.map((o, n) => (n === remainder ? { ...o, valueSatoshis: total - fixed - size - extraFee } : o));
  }
  const transaction = make(outs);
  const encoded = L.encodeTransactionBch(transaction);
  const txid = hex(L.hashTransactionUiOrder(encoded));
  return {
    transaction,
    sourceOutputs,
    hex: hex(encoded),
    txid,
    size: encoded.length,
    fee: total - outs.reduce((sum, o) => sum + o.valueSatoshis, 0n),
    inputSizes: transaction.inputs.map((i) => 40 + L.bigIntToCompactUint(BigInt(i.unlockingBytecode.length)).length + i.unlockingBytecode.length),
    outputSizes: outs.map((o) => L.encodeTransactionOutput(o).length),
    labels: inputs.map((i) => i.label),
    /** Output `n` of this transaction as a coin. */
    coin: (n) => ({ txid, index: n, output: outs[n] }),
  };
};

const vm = L.createVirtualMachineBch2026(true);
/** `true`, or the reason the 2026 rules with standardness refuse the transaction. */
export const verify = (built) => vm.verify({ transaction: built.transaction, sourceOutputs: built.sourceOutputs });
/** The index of the input whose script refused, if the reason names one. */
export const failingInput = (reason) => {
  const match = /input index (\d+)/.exec(String(reason));
  return match === null ? undefined : Number(match[1]);
};
export const dust = (output) => L.getDustThreshold(output);
