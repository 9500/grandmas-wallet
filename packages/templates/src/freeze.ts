// Writes the current templates to frozen/ under their versions. Run only when a new template version is
// intended: a wallet's keys depend on the exact content of the wallet template it was created with.
import { writeFileSync } from 'node:fs';

import { serializeTemplate } from '@xo-cash/utils';

import {
  grandmasWalletTemplate,
  grandmasWalletTemplateIdentifier,
  savingsJarTemplate,
  savingsJarTemplateIdentifier,
} from './index.js';

for (const [name, template, identifier] of [
  ['grandmas-wallet', grandmasWalletTemplate, grandmasWalletTemplateIdentifier],
  ['savings-jar', savingsJarTemplate, savingsJarTemplateIdentifier],
] as const) {
  const path = new URL(`../frozen/${name}-v${template.version ?? '0'}.json`, import.meta.url);
  writeFileSync(path, `${serializeTemplate(template)}\n`);
  console.log(`${name}: ${identifier}`);
}
