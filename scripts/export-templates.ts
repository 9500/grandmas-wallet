// The wallet's own XO templates as files, for XO's tools and for anyone who wants to read them: one JSON file
// each under docs/templates/, with the identifier the engine gives each in index.json. The templates are defined
// in packages/app/src/templates.ts; a test (test/templates-exported.test.ts) keeps the files in step with it.
//
// usage (from packages/app): npx tsx ../../scripts/export-templates.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { WALLET_TEMPLATES, walletTemplateIdentifiers } from '../packages/app/src/index.js';

const directory = fileURLToPath(new URL('../docs/templates/', import.meta.url));
mkdirSync(directory, { recursive: true });
const identifiers = walletTemplateIdentifiers();
const index = Object.entries(WALLET_TEMPLATES).map(([name, template]) => {
  const file = `grandmas-wallet-${name}.json`;
  writeFileSync(`${directory}${file}`, `${JSON.stringify(template, null, 2)}\n`);
  return { file, name: (template as { name?: string }).name ?? name, templateIdentifier: identifiers[name as keyof typeof identifiers] };
});
writeFileSync(`${directory}index.json`, `${JSON.stringify(index, null, 2)}\n`);
for (const entry of index) console.log(`${entry.templateIdentifier}  ${entry.file}  ${entry.name}`);
