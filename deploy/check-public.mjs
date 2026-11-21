// Looks at a deployment from outside, as a browser would reach it: which version each page serves, whether
// it sends the content security policy, and whether each backup store answers the wallet's page.
//
// usage: node deploy/check-public.mjs [configuration file] [--expect <commit>]
//   node deploy/check-public.mjs deploy/config/production.json --expect "$(git rev-parse --short HEAD)"
//
// Prints one line per page and per store. With --expect, exits with an error unless the wallet and the
// recoverer pages both say that they were built from that commit.
import { readFileSync } from 'node:fs';

const parameters = process.argv.slice(2);
const expectAt = parameters.indexOf('--expect');
const expected = expectAt === -1 ? undefined : parameters[expectAt + 1];
const configPath = parameters.find((parameter, index) => !parameter.startsWith('--') && index !== expectAt + 1) ?? 'deploy/config/production.json';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
let failed = false;
if (config.network === 'mainnet') console.log(`configuration: mainnet, ${config.mainnetEnabled === true ? 'allowed by "mainnetEnabled": true' : 'NOT allowed (no "mainnetEnabled": true): the pages refuse to start'}`);

const page = async (name, url, mustMatch) => {
  try {
    const index = await fetch(url);
    const title = /<title>([^<]*)<\/title>/.exec(await index.text())?.[1] ?? '(no title)';
    const policy = index.headers.get('content-security-policy') === null ? 'no content security policy' : 'content security policy sent';
    const answer = await fetch(new URL('version.json', url));
    // A server without a version record answers every unknown path with the page itself.
    const version = (answer.headers.get('content-type') ?? '').includes('json') ? await answer.json() : undefined;
    const serving = version === undefined ? 'no version record (a server of the first design)' : `commit ${version.commit} of ${version.branch}${version.uncommittedChanges === true ? ' with uncommitted changes' : ''}, network ${version.network}${version.releasedAt === undefined ? '' : `, released ${version.releasedAt}`}`;
    console.log(`${name}: ${url} answers ${index.status}, "${title}", ${policy}; ${serving}`);
    if (mustMatch && expected !== undefined && version?.commit !== expected) {
      console.log(`  expected commit ${expected}`);
      failed = true;
    }
  } catch (error) {
    console.log(`${name}: ${url} cannot be reached: ${error.message}`);
    failed = true;
  }
};

const store = async (url, origin) => {
  try {
    // An archive nobody uses: the store answers with an empty list, and names the wallet's page as allowed.
    const answer = await fetch(new URL(`/v1/archives/${'0'.repeat(32)}/blobs`, url), { headers: { origin } });
    const allowed = answer.headers.get('access-control-allow-origin');
    const body = await answer.json();
    const ok = answer.status === 200 && Array.isArray(body.blobs) && (allowed === origin || allowed === '*');
    console.log(`store: ${url} answers ${answer.status}, ${ok ? `lists an unused archive as empty and allows ${origin}` : `unexpected: allows ${allowed}, body ${JSON.stringify(body)}`}`);
    if (!ok) failed = true;
  } catch (error) {
    console.log(`store: ${url} cannot be reached: ${error.message}`);
    failed = true;
  }
};

await page('wallet', config.walletUrl, true);
await page('recoverer', config.recovererUrl, true);
if (config.jarUrl !== undefined) await page('savings jar', config.jarUrl, false);
if (config.loanUrl !== undefined) await page('loan page', config.loanUrl, false);
for (const url of config.stores) await store(url, new URL(config.walletUrl).origin);
process.exit(failed ? 1 : 0);
