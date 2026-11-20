import { type ReadTemplate, readTemplate } from '@grandmas-wallet/core';

/**
 * The template a request names (proposal section 14.3): the text an application presents has to be the template the
 * request names, by identifier and content hash, and one this wallet's engine can run. A later download does not
 * replace it. What each of its actions would leave behind is worked out apart (`findings.ts`).
 */

/** A template as an application presents it: its text, which the request names by its hash. */
export interface PresentedTexts {
  template: string;
}

/** How a request names a template. */
export interface TemplateNames {
  identifier: string;
  contentHash: string;
}

/** What was presented is not what the request names, or cannot be used. The request is refused. */
export class PresentationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PresentationError';
  }
}

/**
 * Read the template an application presents, and check that it is the one the request names and one this wallet's
 * engine can run.
 * @throws PresentationError
 */
export const readPresented = (names: TemplateNames, texts: PresentedTexts): ReadTemplate => {
  let template: ReadTemplate;
  try {
    template = readTemplate(texts.template);
  } catch (error) {
    throw new PresentationError((error as Error).message);
  }
  if (template.identifier !== names.identifier || template.contentHash !== names.contentHash) {
    throw new PresentationError('The template sent with the request is not the one the request names.');
  }
  // The engine reads a stored value of this type back as text when it unlocks a coin later (section 13.1).
  const unreadable = Object.entries(template.definition.variables ?? {}).find(([, variable]) => (variable as { type?: string }).type === 'timestamp');
  if (unreadable !== undefined) {
    throw new PresentationError(`The template uses a kind of value ("timestamp", for "${unreadable[0]}") that this wallet's engine cannot read back when it unlocks a coin. What is put under it might not come out again.`);
  }
  return template;
};
