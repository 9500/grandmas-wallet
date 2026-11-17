import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { type Output, type TransactionCommon, binToHex, hexToBin } from '@bitauth/libauth';
import type { AddressKind, Utxo } from '@grandmas-wallet/core';

/**
 * The run's state on disk. Everything needed to continue after an
 * interruption — keys, tracked outputs, and each step's transaction — is
 * written here before it is needed.
 */

/** The two seeds of the run: the owner's before the recovery, and the new owner's after it. */
export type SeedName = 'old' | 'new';

/** Which address of the run an output is at. */
export interface AddressPlace {
  seed: SeedName;
  kind: AddressKind;
  number: number;
}

/**
 * What an output is to the run:
 * - `funder`: the ordinary address the run is paid from and returns everything to;
 * - `fee`: the recoverer's ordinary address for its fees;
 * - `controller`: the wallet's controller;
 * - `address`: a recoverable or vault address of one of the seeds.
 */
export type Role = 'funder' | 'fee' | 'controller' | 'address';

export interface StoredUtxo {
  role: Role;
  /** For role `address`. */
  place?: AddressPlace;
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
  /** Size of the transaction in bytes. */
  bytes: number;
  /** What the transaction pays, and what nodes require for its size. */
  feeSatoshis: string;
  requiredFeeSatoshis: string;
  /** For refusals: what the local check and the network said. */
  localCheck?: string;
  networkReply?: string;
  note?: string;
}

/** The secrets of one seed. Keys are plain random values here; the key tree comes with the wallet's own library. */
export interface SeedSecrets {
  /** The controller key of this seed. */
  controllerKey: string;
  /** Source of every address secret of this seed. */
  blindingSeed: string;
  /** Random value from which the run makes each address key of this seed. */
  addressKeys: string;
}

export interface RunState {
  version: 2;
  /** Name of the chain the run is on. A state file is never continued on another chain. */
  chain?: string;
  keys: {
    funder: string;
    /** The recoverer's recovery key, whose hash is in the controller. */
    recoverer: string;
    /** The recoverer's fee key: an ordinary address that pays for its requests and its completion. */
    recovererFee: string;
    old: SeedSecrets;
    new: SeedSecrets;
  };
  /** Wallet identity (token category), as shown by explorers. */
  identity?: string;
  /** When each process that worked on this run started, by the real clock. More than one means the run was continued from this file. */
  starts?: string[];
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

export const toStored = (what: { role: Role; place?: AddressPlace }, transactionId: string, index: number, output: Output): StoredUtxo => ({
  role: what.role,
  ...(what.place === undefined ? {} : { place: what.place }),
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
  roleOf: (output: Output) => { role: Role; place?: AddressPlace } | undefined,
): void => {
  const spent = new Set(transaction.inputs.map((input) => `${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`));
  const remaining = state.utxos.filter((utxo) => !spent.has(`${utxo.transactionId}:${utxo.index}`));
  const created = transaction.outputs.flatMap((output, index) => {
    const what = roleOf(output);
    const known = remaining.some((utxo) => utxo.transactionId === transactionId && utxo.index === index);
    return what === undefined || known ? [] : [toStored(what, transactionId, index, output)];
  });
  state.utxos = [...remaining, ...created];
};
