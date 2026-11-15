import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

import { type Output, type TransactionCommon, binToHex, hexToBin } from '@bitauth/libauth';
import type { Utxo } from '@grandmas-wallet/core';

/**
 * The run's state on disk. Everything needed to continue after an
 * interruption — keys, tracked outputs, and each step's transaction — is
 * written here before it is needed.
 */

export type Role = 'funder' | 'controller' | 'asset' | 'jar';

export interface StoredUtxo {
  role: Role;
  transactionId: string;
  index: number;
  lockingBytecode: string;
  valueSatoshis: string;
  token?: { category: string; amount: string; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string } };
}

export type StepStatus =
  /** Built and saved; broadcast not yet confirmed to have been accepted. */
  | 'pending'
  | 'done'
  /** A transaction that must be refused, and was. */
  | 'refused-as-expected'
  /** A transaction that must be refused, but was accepted. */
  | 'ACCEPTED-UNEXPECTEDLY';

export interface StepRecord {
  status: StepStatus;
  description: string;
  transactionId: string;
  transactionHex: string;
  at: string;
  /** For refusals: what the local check and the network said. */
  localCheck?: string;
  networkReply?: string;
  note?: string;
}

export interface RunState {
  version: 1;
  endpoint?: string;
  keys: { funder: string; owner: string; recoverer: string; replacement: string };
  /** Wallet identity (token category), as shown by explorers. */
  identity?: string;
  /** Savings Jar unlock time, Unix seconds. */
  unlockTime?: number;
  utxos: StoredUtxo[];
  steps: Record<string, StepRecord>;
  stepOrder: string[];
}

export const load = (path: string): RunState | undefined =>
  existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as RunState) : undefined;

/** Write the whole state, replacing the file in one step so an interruption cannot leave it half-written. */
export const save = (path: string, state: RunState): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
};

export const toUtxo = (stored: StoredUtxo): Utxo => ({
  transactionHash: hexToBin(stored.transactionId),
  index: stored.index,
  output: {
    lockingBytecode: hexToBin(stored.lockingBytecode),
    valueSatoshis: BigInt(stored.valueSatoshis),
    ...(stored.token === undefined
      ? {}
      : {
          token: {
            category: hexToBin(stored.token.category),
            amount: BigInt(stored.token.amount),
            ...(stored.token.nft === undefined
              ? {}
              : { nft: { capability: stored.token.nft.capability, commitment: hexToBin(stored.token.nft.commitment) } }),
          },
        }),
  },
});

export const toStored = (role: Role, transactionId: string, index: number, output: Output): StoredUtxo => ({
  role,
  transactionId,
  index,
  lockingBytecode: binToHex(output.lockingBytecode),
  valueSatoshis: output.valueSatoshis.toString(),
  ...(output.token === undefined
    ? {}
    : {
        token: {
          category: binToHex(output.token.category),
          amount: output.token.amount.toString(),
          ...(output.token.nft === undefined
            ? {}
            : { nft: { capability: output.token.nft.capability, commitment: binToHex(output.token.nft.commitment) } }),
        },
      }),
});

/**
 * Update the tracked outputs for an accepted transaction: drop what it
 * spends, add the outputs `roleOf` recognises.
 */
export const applyTransaction = (
  state: RunState,
  transaction: TransactionCommon,
  transactionId: string,
  roleOf: (output: Output) => Role | undefined,
): void => {
  const spent = new Set(
    transaction.inputs.map((input) => `${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`),
  );
  const remaining = state.utxos.filter((utxo) => !spent.has(`${utxo.transactionId}:${utxo.index}`));
  const created = transaction.outputs.flatMap((output, index) => {
    const role = roleOf(output);
    const known = remaining.some((utxo) => utxo.transactionId === transactionId && utxo.index === index);
    return role === undefined || known ? [] : [toStored(role, transactionId, index, output)];
  });
  state.utxos = [...remaining, ...created];
};
