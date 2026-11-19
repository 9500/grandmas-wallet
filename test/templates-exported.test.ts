import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { WALLET_TEMPLATES, walletTemplateIdentifiers } from '../packages/app/src/templates.js';

const read = (file: string): string => readFileSync(new URL(`../docs/templates/${file}`, import.meta.url), 'utf8');

describe('the wallet\'s templates as files (scripts/export-templates.ts)', () => {
  it('are the templates the wallet uses, with the identifiers the engine gives them', () => {
    const index = JSON.parse(read('index.json')) as { file: string; templateIdentifier: string }[];
    const identifiers = walletTemplateIdentifiers();
    expect(index.map((entry) => entry.file)).toEqual(Object.keys(WALLET_TEMPLATES).map((name) => `grandmas-wallet-${name}.json`));
    for (const [name, template] of Object.entries(WALLET_TEMPLATES)) {
      expect(read(`grandmas-wallet-${name}.json`)).toBe(`${JSON.stringify(template, null, 2)}\n`);
      expect(index.find((entry) => entry.file === `grandmas-wallet-${name}.json`)?.templateIdentifier).toBe(identifiers[name as keyof typeof identifiers]);
    }
  });
});
