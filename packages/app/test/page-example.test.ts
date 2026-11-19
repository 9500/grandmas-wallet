import { readFileSync } from 'node:fs';
import { hexToBin } from '@bitauth/libauth';
import { deriveSeedKeys, walletAddress } from '@grandmas-wallet/core';
import { expect, it } from 'vitest';
import { walletTemplateNumbers } from '../src/templates.js';

it.each(['design_v0.4.html', 'design_v0.5.html'])('the worked example on the design page %s shows the addresses the library gives', (name) => {
  const page = readFileSync(new URL(`../../../docs/${name}`, import.meta.url), 'utf8');
  const ex = JSON.parse(/var EX = (\{.*?\});\n/s.exec(page)?.[1] as string) as { words: string; identity: string; rows: Record<string, { address: string }[]> };
  const seed = deriveSeedKeys(ex.words, 'testnet', walletTemplateNumbers());
  for (const kind of [0, 1, 2] as const) {
    ex.rows[String(kind)]?.forEach((row, number) => expect(walletAddress(hexToBin(ex.identity), seed.viewingKey, kind, number).address).toBe(row.address));
  }
});
