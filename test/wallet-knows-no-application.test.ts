import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Acceptance tests AP07 and PR21 of the proposal: the wallet, the recoverer and the libraries they are built from
 * know their own templates and nothing of any application. An application's template reaches a wallet over
 * a connection, at the time it is used; the templates made for the tests, the demonstration applications
 * and the applications the proposal discusses are named nowhere in this code. And since the third design no
 * document beside a template is read: the code holds no reader of a recovery declaration (section 13.3).
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

/**
 * What a reader of a recovery declaration would need: the word, the profile it was announced by, and the forms a
 * declaration gave the places it took values from (a token, a companion coin, a coin of the application's).
 * Comments may still say that none is read; code and the words on the screens may not.
 */
const DECLARATION = /declaration|recoverable-app|\bprofiles?\b|['"`](token|companion|position)\.(category|commitment|inputIndex|valueSatoshis)|input\.[A-Za-z]+\.(category|commitment|tokenAmount|valueSatoshis)|positionFound/i;
/** A source without its comments, line for line: block comments become empty lines, line comments are cut. */
const withoutComments = (text: string): string[] =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ''))
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'));

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

  it('PR21: their code holds no reader of a recovery declaration', () => {
    const code = sources.filter((path) => /\.(ts|tsx|js|mjs|html)$/.test(path));
    expect(code.length).toBeGreaterThan(60);
    const reading = code.flatMap((path) =>
      withoutComments(readFileSync(path, 'utf8')).flatMap((line, index) => (DECLARATION.test(line) ? [`${path.slice(root.length)}:${index + 1}: ${line.trim().slice(0, 160)}`] : [])),
    );
    expect(reading).toEqual([]);
    // The search finds what it looks for: the second design's code, as it was at the tag `design-2`, would not pass.
    expect(withoutComments('const { declaration } = readDeclaration(text); // a declaration').some((line) => DECLARATION.test(line))).toBe(true);
    expect(withoutComments('/* a declaration */ const a = 1; // no declaration').some((line) => DECLARATION.test(line))).toBe(false);
  });

  it('TR13: their code names no token: no category of a token the tests or the demonstrations use, and no symbol', () => {
    // The demonstration's token on chipnet, its staking receipt, and their names and symbols; the registry the wallet reads is the token's own.
    const TOKENS = /e7979ccdae259293|b48e931a1389d37e|PUSDTEST|ParyonUSD|\bXDOL\b|Example Dollar/i;
    const mentioning = sources.flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, index) => (TOKENS.test(line) ? [`${path.slice(root.length)}:${index + 1}: ${line.trim().slice(0, 160)}`] : [])),
    );
    expect(mentioning).toEqual([]);
    // No list of tokens is built in: the only list of symbols is the specification's reserved ones. The fixtures page,
    // which the build of the page does not include, shows the screens with invented ones.
    const lists = sources.filter((path) => /\.(ts|tsx)$/.test(path) && !path.endsWith('apps/wallet/src/fixtures.tsx') && /symbol['"]?\s*:\s*['"][A-Z0-9-]+['"]/.test(readFileSync(path, 'utf8')));
    expect(lists.map((path) => path.slice(root.length))).toEqual([]);
  });

  it('PR21: their code names no application', () => {
    const mentioning = sources.flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, index) => (NAMES.test(line) ? [`${path.slice(root.length)}:${index + 1}: ${line.trim().slice(0, 160)}`] : [])),
    );
    expect(mentioning).toEqual([]);
  });
});
