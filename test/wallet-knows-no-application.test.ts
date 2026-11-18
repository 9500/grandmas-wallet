import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Acceptance test AP07 of the proposal: the wallet, the recoverer and the libraries they are built from
 * know their own templates and nothing of any application. An application's template reaches a wallet over
 * a connection, at the time it is used; the templates made for the tests, the demonstration applications
 * and the applications the proposal discusses are named nowhere in this code.
 */

const root = new URL('..', import.meta.url).pathname;
const WALLET_SIDE = [
  'packages/app/src',
  'packages/archive/src',
  'packages/chipnet/src',
  'packages/connect/src',
  'packages/core/src',
  'packages/enrollment/src',
  'packages/ui/src',
  'apps/wallet/src',
  'apps/wallet/index.html',
  'apps/wallet/public',
  'apps/recoverer/src',
  'apps/recoverer/index.html',
  'apps/recoverer/public',
  'apps/archive-store/src',
  'contracts/controller.cash',
  'contracts/recoverableAddress.cash',
  'contracts/vaultAddress.cash',
  'contracts/lib',
];
/** Names of applications: the demonstrations, the ones the proposal discusses, and the templates made for the tests. */
const NAMES = /jar|savings|paryon|pusd|\bloans?\b|moria|cauldron|anyhedge|bch ?bull|strongbox|\bbonds?\b/i;

const files = (path: string): string[] => (statSync(path).isDirectory() ? readdirSync(path).flatMap((name) => files(join(path, name))) : [path]);
const isText = (path: string): boolean => /\.(ts|tsx|js|mjs|json|html|css|cash|svg|md|txt)$/.test(path);

describe('the wallet and the recoverer', () => {
  const sources = WALLET_SIDE.flatMap((path) => files(join(root, path))).filter(isText);

  it('AP07: their code names no application', () => {
    expect(sources.length).toBeGreaterThan(60);
    const mentioning = sources.flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, index) => (NAMES.test(line) ? [`${path.slice(root.length)}:${index + 1}: ${line.trim().slice(0, 160)}`] : [])),
    );
    expect(mentioning).toEqual([]);
  });

  it('AP07: their code depends on no application\'s package, contract or test template', () => {
    const importing = sources.filter((path) => /@grandmas-wallet\/(testing|[a-z-]*jar[a-z-]*)|contracts\/(?!controller|recoverableAddress|vaultAddress|artifacts\/(controller|recoverableAddress|vaultAddress))[A-Za-z]+/.test(readFileSync(path, 'utf8')));
    // The scripted run of the contracts (stage 1) is a tool for tests and uses the tests' own wallet; no page loads it.
    const tools = ['packages/chipnet/src/cli.ts', 'packages/chipnet/src/lifecycle.ts'];
    expect(importing.map((path) => path.slice(root.length)).filter((path) => !tools.includes(path))).toEqual([]);
  });

  it('AP07: the wallet\'s pages are given no application\'s address', () => {
    for (const page of ['apps/wallet/public/config.json', 'apps/recoverer/public/config.json']) {
      const config = JSON.parse(readFileSync(join(root, page), 'utf8')) as Record<string, unknown>;
      expect(Object.keys(config).sort()).toEqual(['chain', 'explorer', 'network', 'recovererUrl', 'relays', 'secondsPerBlock', 'stores', 'walletUrl']);
    }
  });
});
