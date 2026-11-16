import type { XOTemplate } from '@xo-cash/types';
import { generateTemplateIdentifier, parseTemplate } from '@xo-cash/utils';

import { grandmasWalletTemplate as walletSource } from './grandmas-wallet.js';

/** The wallet template, validated against the XO template schema. */
export const grandmasWalletTemplate: XOTemplate = parseTemplate(walletSource);

/** Hash of the wallet template's content. XO keys are derived under it. */
export const grandmasWalletTemplateIdentifier: string = generateTemplateIdentifier(grandmasWalletTemplate);
