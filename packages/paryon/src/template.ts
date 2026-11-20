import { readTemplate } from '@grandmas-wallet/core';

import type { ParyonContracts } from './deployment.js';
import { paryonTemplateSource } from './template-source.js';

/**
 * The template for a deployment, as a request names and sends it (proposal section 15.3). For Paryon's chipnet
 * deployment the text is frozen (`frozen/`); for a deployment on a chain of one's own it is made here, the same way.
 */
export const paryonTemplateAlone = (contracts: ParyonContracts): { names: { identifier: string; contentHash: string }; texts: { template: string } } => {
  const template = JSON.stringify(paryonTemplateSource(contracts));
  const read = readTemplate(template);
  return { names: { identifier: read.identifier, contentHash: read.contentHash }, texts: { template } };
};
