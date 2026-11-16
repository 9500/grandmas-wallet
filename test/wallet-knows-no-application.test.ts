import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The wallet, the recoverer and the libraries they are built from know their own template and nothing of
 * any application. The Savings Jar is an application like any other: its template reaches a wallet over a
 * connection, at the time it is used.
 */

const root = new URL('..', import.meta.url).pathname;
const WALLET_SIDE = ['packages/app/src', 'packages/archive/src', 'packages/connect/src', 'packages/core/src', 'packages/enrollment/src', 'packages/templates/src', 'packages/ui/src', 'apps/wallet/src', 'apps/recoverer/src'];

const files = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

describe('the wallet side', () => {
  const sources = WALLET_SIDE.flatMap((directory) => files(join(root, directory)));

  it('does not depend on the Savings Jar application', () => {
    const importing = sources.filter((path) => /@grandmas-wallet\/(savings-jar|testing)|contracts\/(savingsJar|keyJar)/.test(readFileSync(path, 'utf8')));
    expect(importing.map((path) => path.slice(root.length))).toEqual([]);
  });

  it('does not mention it either', () => {
    const mentioning = sources.flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, index) => (/jar/i.test(line) ? [`${path.slice(root.length)}:${index + 1}: ${line.trim()}`] : [])),
    );
    // The wallet template's description of its "approve" action gives a savings jar as an example of an
    // application. The template is frozen: every wallet's keys are derived under its exact content.
    const allowed = mentioning.filter((line) => line.startsWith('packages/templates/src/grandmas-wallet.ts:') && line.includes('such as a savings jar'));
    expect(mentioning.filter((line) => !allowed.includes(line))).toEqual([]);
  });
});
