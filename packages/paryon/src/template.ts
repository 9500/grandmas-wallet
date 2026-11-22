import { readTemplate } from '@grandmas-wallet/core';

import { type ParyonContracts, type ParyonDeployment, CHIPNET_FAST_PERIODS_6, MAINNET_V1 } from './deployment.js';
import { type ParyonAddresses, type ParyonTemplateVersion, PARYON_ADDRESSES, PARYON_TEMPLATE_VERSION, paryonTemplateSource } from './template-source.js';

/** A template as a request names and sends it. */
export interface ParyonTemplateAlone {
  names: { identifier: string; contentHash: string };
  texts: { template: string };
}

/** Whether a deployment is one of Paryon's own, whose service and page are at Paryon's addresses (`PARYON_ADDRESSES`). */
export const paryonsOwn = (deployment: ParyonDeployment): boolean => [CHIPNET_FAST_PERIODS_6, MAINNET_V1].some((own) => own.name === deployment.name && own.network === deployment.network && own.tokenIds.paryon === deployment.tokenIds.paryon && own.tokenIds.loanKeyFactory === deployment.tokenIds.loanKeyFactory);

/**
 * The template for a deployment, as a request names and sends it (proposal section 15.3). For Paryon's chipnet and
 * mainnet deployments the text is frozen (`frozen/`); for a deployment on a chain of one's own it is made here, the same
 * way. Version 3 unless another is named: it names where the service and the page are, Paryon's own addresses for
 * Paryon's own deployments unless others are given; a deployment on a chain of one's own, whose addresses differ per
 * machine, must be given them.
 * @throws for version 3 without addresses, unless no version is named and the deployment is Paryon's own
 */
export function paryonTemplateAlone(contracts: ParyonContracts, addresses?: ParyonAddresses): ParyonTemplateAlone;
export function paryonTemplateAlone(contracts: ParyonContracts, version: 1 | 2): ParyonTemplateAlone;
export function paryonTemplateAlone(contracts: ParyonContracts, version: 3, addresses: ParyonAddresses): ParyonTemplateAlone;
export function paryonTemplateAlone(contracts: ParyonContracts, version: ParyonTemplateVersion, addresses?: ParyonAddresses): ParyonTemplateAlone;
export function paryonTemplateAlone(contracts: ParyonContracts, versionOrAddresses?: ParyonTemplateVersion | ParyonAddresses, given?: ParyonAddresses): ParyonTemplateAlone {
  const version = typeof versionOrAddresses === 'number' ? versionOrAddresses : PARYON_TEMPLATE_VERSION;
  let addresses = typeof versionOrAddresses === 'object' ? versionOrAddresses : given;
  // Paryon's own addresses only where no version is named; version 3 named is given its addresses.
  if (version === 3 && addresses === undefined && versionOrAddresses === undefined) {
    if (!paryonsOwn(contracts.deployment)) throw new Error(`Version 3 of the template for the deployment ${contracts.deployment.name} names where its service and page are: give their addresses.`);
    addresses = PARYON_ADDRESSES;
  }
  const template = JSON.stringify(paryonTemplateSource(contracts, version, addresses));
  const read = readTemplate(template);
  return { names: { identifier: read.identifier, contentHash: read.contentHash }, texts: { template } };
}
