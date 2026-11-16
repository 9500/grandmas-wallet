// Writes the current template to frozen/ under its version. Run when a new template version is intended.
import { writeFileSync } from 'node:fs';

import { serializeTemplate } from '@xo-cash/utils';

import { savingsJarTemplate, savingsJarTemplateIdentifier } from './index.js';

const path = new URL(`../frozen/savings-jar-v${savingsJarTemplate.version ?? '0'}.json`, import.meta.url);
writeFileSync(path, `${serializeTemplate(savingsJarTemplate)}\n`);
console.log(`savings-jar: ${savingsJarTemplateIdentifier}`);
