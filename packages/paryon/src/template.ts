import { readTemplate, textHash } from '@grandmas-wallet/core';

import type { ParyonContracts } from './deployment.js';
import { paryonDeclarationSource, paryonTemplateSource } from './template-source.js';

/** A template as the page presents it: the two texts, and the names a request gives them. */
export interface PresentedTemplate {
  names: { identifier: string; contentHash: string; declaration: string };
  texts: { template: string; declaration: string };
  /** The same texts, under the names an `xo_action_request` uses for them. */
  template: string;
  declaration: string;
}

/**
 * The template and its declaration as texts, for a deployment. For Paryon's chipnet deployment the texts are
 * frozen (`frozen/`); for a deployment on a chain of one's own they are made here, the same way.
 */
export const paryonTemplateTexts = (contracts: ParyonContracts): PresentedTemplate => {
  const template = JSON.stringify(paryonTemplateSource(contracts));
  const read = readTemplate(template);
  const declaration = JSON.stringify({ profile: 'recoverable-app-v1', version: 1, template: { identifier: read.identifier, contentHash: read.contentHash }, ...paryonDeclarationSource(contracts) });
  return {
    names: { identifier: read.identifier, contentHash: read.contentHash, declaration: textHash(declaration) },
    texts: { template, declaration },
    template,
    declaration,
  };
};

/**
 * The template alone, as a request of version 2 names and sends it (proposal section 15.3): the same text as
 * `paryonTemplateTexts` gives, with no declaration.
 */
export const paryonTemplateAlone = (contracts: ParyonContracts): { names: { identifier: string; contentHash: string }; texts: { template: string } } => {
  const template = JSON.stringify(paryonTemplateSource(contracts));
  const read = readTemplate(template);
  return { names: { identifier: read.identifier, contentHash: read.contentHash }, texts: { template } };
};
