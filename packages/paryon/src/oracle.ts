import { hexToBin, secp256k1, sha256 } from '@bitauth/libauth';

import type { ParyonDeployment } from './deployment.js';
import { readNumber } from './state.js';

/**
 * The price General Protocols' oracle publishes, which the price contracts take when anyone brings it. The
 * contracts never check how old their price is, so a stale price can be replaced at any moment by the
 * current one; a loan is made safe for the price the oracle gives now, not only for the one stored.
 */

/** A signed oracle message: 16 bytes, four numbers. */
export interface OracleMessage {
  /** Unix seconds. */
  time: number;
  messageSequence: number;
  /** What the price contract compares with its own sequence. */
  contentSequence: number;
  /** US cents per BCH. */
  price: bigint;
}

export const decodeOracleMessage = (message: Uint8Array): OracleMessage => {
  if (message.length !== 16) throw new Error(`An oracle message is 16 bytes, got ${message.length}.`);
  const at = (start: number): number => Number(readNumber(Uint8Array.of(...message.slice(start, start + 4), 0)));
  return { time: at(0), messageSequence: at(4), contentSequence: at(8), price: BigInt(at(12)) };
};

/** Whether the oracle's key signed the message, as `checkDataSig` checks it: a signature over its SHA-256. */
export const oracleSigned = (message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean => {
  const digest = sha256.hash(message);
  return signature.length === 64 ? secp256k1.verifySignatureSchnorr(signature, publicKey, digest) : secp256k1.verifySignatureDERLowS(signature, publicKey, digest);
};

/** The oracle's latest message, checked against the deployment's oracle key. Reads General Protocols' public server. */
export const latestOraclePrice = async (deployment: ParyonDeployment, get: typeof fetch = fetch): Promise<OracleMessage & { signed: true }> => {
  const response = await get(`https://oracles.generalprotocols.com/api/v1/oracleMessages?publicKey=${deployment.oraclePublicKey}&count=5`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`The oracle's server answered HTTP ${response.status}.`);
  const body = (await response.json()) as { oracleMessages?: { message: string; signature: string }[] };
  const messages = (body.oracleMessages ?? []).map((entry) => ({ ...decodeOracleMessage(hexToBin(entry.message)), message: entry.message, signature: entry.signature }));
  const latest = messages.sort((a, b) => b.messageSequence - a.messageSequence)[0];
  if (latest === undefined) throw new Error('The oracle\'s server gave no message.');
  if (!oracleSigned(hexToBin(latest.message), hexToBin(latest.signature), hexToBin(deployment.oraclePublicKey))) throw new Error('The oracle\'s latest message is not signed by its key.');
  return { time: latest.time, messageSequence: latest.messageSequence, contentSequence: latest.contentSequence, price: latest.price, signed: true };
};
