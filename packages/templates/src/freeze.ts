// Writes the current template to frozen/ under its version. Run only when a new template version is intended:
// a wallet's keys depend on the exact content of the template it was created with.
import { writeFileSync } from 'node:fs';

import { serializeTemplate } from '@xo-cash/utils';

import { grandmasWalletTemplate, grandmasWalletTemplateIdentifier } from './index.js';

const path = new URL(`../frozen/grandmas-wallet-v${grandmasWalletTemplate.version ?? '0'}.json`, import.meta.url);
writeFileSync(path, `${serializeTemplate(grandmasWalletTemplate)}\n`);
console.log(`${path.pathname}\nidentifier ${grandmasWalletTemplateIdentifier}`);
