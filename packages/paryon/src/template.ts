import { readTemplate } from '@grandmas-wallet/core';

import type { ParyonContracts } from './deployment.js';
import { type ParyonAddresses, type ParyonTemplateVersion, PARYON_TEMPLATE_VERSION, paryonTemplateSource } from './template-source.js';

/** A template as a request names and sends it. */
export interface ParyonTemplateAlone {
  names: { identifier: string; contentHash: string };
  texts: { template: string };
}

/**
 * The template for a deployment, as a request names and sends it (proposal section 15.3). For Paryon's chipnet and
 * mainnet deployments the text is frozen (`frozen/`); for a deployment on a chain of one's own it is made here, the same
 * way. Version 2 unless another is named; version 3 names where the service and the page are, which differ per machine
 * for a chain of one's own.
 */
export function paryonTemplateAlone(contracts: ParyonContracts, version?: 1 | 2): ParyonTemplateAlone;
export function paryonTemplateAlone(contracts: ParyonContracts, version: 3, addresses: ParyonAddresses): ParyonTemplateAlone;
export function paryonTemplateAlone(contracts: ParyonContracts, version: ParyonTemplateVersion, addresses?: ParyonAddresses): ParyonTemplateAlone;
export function paryonTemplateAlone(contracts: ParyonContracts, version: ParyonTemplateVersion = PARYON_TEMPLATE_VERSION, addresses?: ParyonAddresses): ParyonTemplateAlone {
  const template = JSON.stringify(paryonTemplateSource(contracts, version, addresses));
  const read = readTemplate(template);
  return { names: { identifier: read.identifier, contentHash: read.contentHash }, texts: { template } };
}
