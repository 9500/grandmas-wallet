import type { XOTemplate } from '@xo-cash/types';
import { generateTemplateIdentifier, parseTemplate } from '@xo-cash/utils';

import { grandmasWalletTemplate as source } from './grandmas-wallet.js';

/** The template, validated against the XO template schema. */
export const grandmasWalletTemplate: XOTemplate = parseTemplate(source);

/** Hash of the template's content. XO keys are derived under it. */
export const grandmasWalletTemplateIdentifier: string = generateTemplateIdentifier(grandmasWalletTemplate);
