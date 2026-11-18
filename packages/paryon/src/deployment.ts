import { hexToBin } from '@bitauth/libauth';
import { paryonArtifacts } from '@paryonusd/contracts';

import { type ContractScript, contractScript } from './contract.js';

/**
 * A deployment of ParyonUSD: its token categories and the parameters its contracts were built with. With
 * the published artifacts (`@paryonusd/contracts` 1.1.0) these give every contract's address.
 */
export interface ParyonDeployment {
  name: string;
  network: 'chipnet' | 'mainnet';
  /** Paryon's own server for this deployment. Nothing here reads it; it is named for reference. */
  apiBaseUrl: string;
  /** Token categories in the byte order shown by explorers. */
  tokenIds: {
    /** PUSD, and every NFT of the protocol: Borrowing, price, loans, function NFTs. */
    paryon: string;
    pool: string;
    redeemer: string;
    loanKeyFactory: string;
    oracleMigrationKey: string;
  };
  /** The General Protocols oracle whose signed messages the price contracts take. */
  oraclePublicKey: string;
  protocolFeeLockingBytecode: string;
  startBlockHeight: number;
  periodLengthBlocks: number;
  timeLockRedemption: number;
}

/**
 * Paryon's test deployment on chipnet with periods of three blocks. Its parameters are published only in
 * Paryon's web application (`paryonusd.com/app`), from which they were read on 18 November 2026; every
 * address they give holds the deployment's live outputs.
 */
export const CHIPNET_FAST_PERIODS_6: ParyonDeployment = {
  name: 'chipnet-fast-periods-6',
  network: 'chipnet',
  apiBaseUrl: 'https://chipnet-fast-periods-6.paryonusd.com',
  tokenIds: {
    paryon: 'e7979ccdae259293c7d0bee45ce8b7ad7660ea99477f802ed6a5161b0d30e6b8',
    pool: 'b48e931a1389d37e7c6f1ae2c0ef56e9231d7bd2042b55d754317ac9e8e2232b',
    redeemer: 'e6163de49b0cdfc55564d7b7fcaa209de441d5df966ac9967096870b344f24c9',
    loanKeyFactory: '8a51671cdc956212bd6b9c5ff2ad75a5d5364ef916162d1b82ee64a3438557f8',
    oracleMigrationKey: '6cb2f717c4ceb36e04db5935db9135ab37aa6178db92a2e653e4a7c936bd5195',
  },
  oraclePublicKey: '02d09db08af1ff4e8453919cc866a4be427d7bfe18f2c05e5444c196fcf6fd2818',
  protocolFeeLockingBytecode: 'aa20a026712851b7f1121f0a3e9dc9544ae83b89948d71d08426f22068cd7d0a2dfa87',
  startBlockHeight: 301_978,
  periodLengthBlocks: 3,
  timeLockRedemption: 1,
};

/** A token category as contracts see it: reversed. */
export const categoryForScript = (category: Uint8Array): Uint8Array => category.slice().reverse();

/** The contracts a borrower's transactions spend or create, for one deployment. */
export interface ParyonContracts {
  deployment: ParyonDeployment;
  /** PUSD's category, also that of every NFT of the protocol (explorer order). */
  paryonCategory: Uint8Array;
  loanKeyFactoryCategory: Uint8Array;
  protocolFeeLockingBytecode: Uint8Array;
  borrowing: ContractScript;
  /** The price contract its threads now live at: the guarded one. */
  price: ContractScript;
  loanKeyFactory: ContractScript;
  loanKeyOriginEnforcer: ContractScript;
  loanKeyOriginProof: ContractScript;
  loan: ContractScript;
  loanSidecar: ContractScript;
  manage: ContractScript;
}

/** Build every contract a borrower needs from the published artifacts and a deployment's parameters. */
export const paryonContracts = (deployment: ParyonDeployment): ParyonContracts => {
  const paryonCategory = hexToBin(deployment.tokenIds.paryon);
  const loanKeyFactoryCategory = hexToBin(deployment.tokenIds.loanKeyFactory);
  const protocolFeeLockingBytecode = hexToBin(deployment.protocolFeeLockingBytecode);
  const loan = contractScript(paryonArtifacts.artifactLoan, []);
  const loanSidecar = contractScript(paryonArtifacts.artifactLoanSidecar, []);
  const loanKeyOriginProof = contractScript(paryonArtifacts.loanKey.artifactLoanKeyOriginProof, []);
  const loanKeyOriginEnforcer = contractScript(paryonArtifacts.loanKey.artifactLoanKeyOriginEnforcer, [categoryForScript(loanKeyFactoryCategory), categoryForScript(paryonCategory)]);
  const loanKeyFactory = contractScript(paryonArtifacts.loanKey.artifactLoanKeyFactory, [loanKeyOriginEnforcer.lockingBytecode, loanKeyOriginProof.lockingBytecode]);
  const borrowing = contractScript(paryonArtifacts.artifactBorrowing, [
    loan.lockingBytecode,
    loanSidecar.lockingBytecode,
    protocolFeeLockingBytecode,
    loanKeyOriginEnforcer.lockingBytecode,
    BigInt(deployment.startBlockHeight),
    BigInt(deployment.periodLengthBlocks),
  ]);
  const price = contractScript(paryonArtifacts.artifactPriceContractGuarded, [hexToBin(deployment.oraclePublicKey), categoryForScript(hexToBin(deployment.tokenIds.oracleMigrationKey))]);
  const manage = contractScript(paryonArtifacts.loanContractFunctions.artifactFunctionManage, []);
  return { deployment, paryonCategory, loanKeyFactoryCategory, protocolFeeLockingBytecode, borrowing, price, loanKeyFactory, loanKeyOriginEnforcer, loanKeyOriginProof, loan, loanSidecar, manage };
};

/** The period a block height falls in, as the Borrowing contract counts it. */
export const periodAt = (deployment: ParyonDeployment, height: number): number => Math.floor((height - deployment.startBlockHeight) / deployment.periodLengthBlocks);

/** The first height of a period. */
export const periodStart = (deployment: ParyonDeployment, period: number): number => deployment.startBlockHeight + period * deployment.periodLengthBlocks;
