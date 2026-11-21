import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { type BuiltTransaction, type KeyPair, type Utxo, buildTransaction, p2pkhInput, p2pkhLockingBytecode } from '@grandmas-wallet/core';

import { type ParyonContracts, type ParyonDeployment, paryonContracts } from './deployment.js';
import { MANAGE_FUNCTION_COMMITMENT, encodeBorrowingPeriod, paddedNumber } from './state.js';

/**
 * A deployment of Paryon's contracts, as published, on a chain of one's own: the local node in regtest mode,
 * or the simulated chain of the tests. Paryon's own deployments exist on chipnet and mainnet only; this one
 * lets a run be rehearsed with the same contracts before it goes to chipnet.
 *
 * It holds what a borrower's transactions spend: Borrowing threads with PUSD to lend, price threads, the
 * manage function's NFTs and loan key factories. Everything else (the stability pool, redemptions,
 * liquidations, interest payments) is not deployed: a borrower's own transactions do not touch it.
 *
 * Two coins of a single-key address, each output 0 of its transaction, define the deployment's two token
 * categories: PUSD with every NFT of the protocol, and the factories'. A coinbase output is one.
 */

export interface LocalDeployment {
  deployment: ParyonDeployment;
  contracts: ParyonContracts;
  /** The two transactions that create the deployment's outputs, to be sent in this order. */
  transactions: BuiltTransaction[];
  borrowing: Utxo[];
  price: Utxo[];
  manage: Utxo[];
  loanKeyFactory: Utxo[];
}

export interface LocalDeploymentParameters {
  /** The key whose two coins define the categories, and which gets the change. */
  funder: KeyPair;
  /** A coin of the funder that is output 0 of its transaction: its transaction's identifier becomes PUSD's category. */
  paryonCoin: Utxo;
  /** Another such coin: the factories' category. */
  factoryCoin: Utxo;
  /** US cents per BCH, written into the price threads. */
  price: bigint;
  /** The period the Borrowing threads start in. */
  period: number;
  startBlockHeight?: number;
  periodLengthBlocks?: number;
  /** PUSD cents each Borrowing thread can lend. */
  supply?: bigint;
  threads?: number;
  /**
   * A token registry to publish for PUSD on the transaction that makes its first outputs, a link of PUSD's authchain:
   * the file, and the address it can be had at. As an issuer publishes one; wallets that read registries show PUSD by it.
   */
  registry?: { file: Uint8Array; uri: string };
}

/** A registry file (Bitcoin Cash Metadata Registries) for the local deployment's PUSD, as Paryon's chipnet one is written. */
export const localRegistry = (category: string): Uint8Array =>
  utf8ToBin(
    JSON.stringify(
      {
        $schema: 'https://cashtokens.org/bcmr-v2.schema.json',
        version: { major: 1, minor: 0, patch: 0 },
        latestRevision: '2026-01-01T00:00:00.000Z',
        registryIdentity: { name: 'ParyonUSD (local)', description: 'A deployment of Paryon\'s contracts on a local test chain.' },
        identities: { [category]: { '2026-01-01T00:00:00.000Z': { name: 'ParyonUSD (local)', description: 'PUSD on a local test chain.', token: { category, symbol: 'PUSDLOCAL', decimals: 2 } } } },
      },
      null,
      2,
    ),
  );

/** The output that publishes a registry: OP_RETURN, `BCMR`, the file's SHA-256 and its address. */
const publicationOutput = (registry: { file: Uint8Array; uri: string }): Utxo['output'] => {
  const uri = utf8ToBin(registry.uri);
  if (uri.length > 75) throw new Error('The registry\'s address is too long for this output.');
  return { lockingBytecode: Uint8Array.of(0x6a, 0x04, 0x42, 0x43, 0x4d, 0x52, 0x20, ...sha256.hash(registry.file), uri.length, ...uri), valueSatoshis: 0n };
};

/** Any valid public key will do: nobody updates the price here. */
const ORACLE_KEY = '02d09db08af1ff4e8453919cc866a4be427d7bfe18f2c05e5444c196fcf6fd2818';

/** The deployment's parameters and the two transactions that create its outputs. Nothing is sent. */
export const localDeployment = (parameters: LocalDeploymentParameters): LocalDeployment => {
  const { funder, paryonCoin, factoryCoin } = parameters;
  if (paryonCoin.index !== 0 || factoryCoin.index !== 0) throw new Error('A token category comes from a coin that is output 0 of its transaction.');
  const funderLocking = p2pkhLockingBytecode(funder.keyHash);
  const deployment: ParyonDeployment = {
    name: 'local',
    network: 'chipnet',
    apiBaseUrl: '',
    tokenIds: {
      paryon: binToHex(paryonCoin.transactionHash),
      pool: '00'.repeat(32),
      redeemer: '00'.repeat(32),
      loanKeyFactory: binToHex(factoryCoin.transactionHash),
      oracleMigrationKey: '11'.repeat(32),
    },
    oraclePublicKey: ORACLE_KEY,
    // Fees go back to whoever deployed.
    protocolFeeLockingBytecode: binToHex(funderLocking),
    startBlockHeight: parameters.startBlockHeight ?? 0,
    periodLengthBlocks: parameters.periodLengthBlocks ?? 3,
    timeLockRedemption: 1,
  };
  const contracts = paryonContracts(deployment);
  const threads = parameters.threads ?? 2;
  const supply = parameters.supply ?? 1_000_000_000_00n;
  const thread = (lockingBytecode: Uint8Array, token: NonNullable<Utxo['output']['token']>) => ({ lockingBytecode, valueSatoshis: 1000n, token });
  const P = contracts.paryonCategory;
  const paryon = buildTransaction({
    inputs: [p2pkhInput(paryonCoin, funder)],
    outputs: [
      ...Array.from({ length: threads }, () => thread(contracts.borrowing.lockingBytecode, { category: P, amount: supply, nft: { capability: 'minting', commitment: encodeBorrowingPeriod(parameters.period) } })),
      ...Array.from({ length: threads }, (_, index) =>
        thread(contracts.price.lockingBytecode, { category: P, amount: 0n, nft: { capability: 'mutable', commitment: Uint8Array.of(0x00, ...paddedNumber(BigInt(1_000 + index), 4), ...paddedNumber(parameters.price, 4)) } }),
      ),
      ...Array.from({ length: threads }, () => thread(contracts.manage.lockingBytecode, { category: P, amount: 0n, nft: { capability: 'none', commitment: MANAGE_FUNCTION_COMMITMENT } })),
      ...(parameters.registry === undefined ? [] : [publicationOutput(parameters.registry)]),
    ],
    changeLockingBytecode: funderLocking,
  });
  const factories = buildTransaction({
    inputs: [p2pkhInput(factoryCoin, funder)],
    outputs: Array.from({ length: threads }, () => thread(contracts.loanKeyFactory.lockingBytecode, { category: contracts.loanKeyFactoryCategory, amount: 0n, nft: { capability: 'minting', commitment: new Uint8Array() } })),
    changeLockingBytecode: funderLocking,
  });
  const at = (built: BuiltTransaction, from: number, count: number): Utxo[] =>
    Array.from({ length: count }, (_, offset) => ({ transactionHash: built.transactionHash, index: from + offset, output: built.transaction.outputs[from + offset] as Utxo['output'] }));
  return {
    deployment,
    contracts,
    transactions: [paryon, factories],
    borrowing: at(paryon, 0, threads),
    price: at(paryon, threads, threads),
    manage: at(paryon, 2 * threads, threads),
    loanKeyFactory: at(factories, 0, threads),
  };
};
