import type { XOTemplate } from '@xo-cash/types';
import { generateTemplateIdentifier, parseTemplate } from '@xo-cash/utils';

import { savingsJarTemplate as source } from './template-source.js';

/**
 * The Savings Jar application's own definitions: its XO template and its script. Wallets do not depend
 * on this package; a wallet learns of the template when the application presents it.
 */

/** The application's template, validated against the XO template schema. It has no keys. */
export const savingsJarTemplate: XOTemplate = parseTemplate(source);

export const savingsJarTemplateIdentifier: string = generateTemplateIdentifier(savingsJarTemplate);

export * from './script.js';
