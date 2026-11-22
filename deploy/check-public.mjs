// Looks at a deployment from outside, as a browser would reach it: which version each page serves, whether
// it sends the content security policy, whether each backup store answers the wallet's page, and whether Paryon's
// service beside the loan page answers a hello on each network offered with the template it is to serve.
//
// usage: node deploy/check-public.mjs [configuration file] [--expect <commit>]
//   node deploy/check-public.mjs deploy/config/production.json --expect "$(git rev-parse --short HEAD)"
//
// Prints one line per page, per store and per network of the service. With --expect, exits with an error unless the wallet and the
// recoverer pages both say that they were built from that commit.
/* global AbortSignal */
import { readFileSync } from 'node:fs';

const parameters = process.argv.slice(2);
const expectAt = parameters.indexOf('--expect');
const expected = expectAt === -1 ? undefined : parameters[expectAt + 1];
const configPath = parameters.find((parameter, index) => !parameter.startsWith('--') && (expectAt === -1 || index !== expectAt + 1)) ?? 'deploy/config/production.json';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
let failed = false;
// A configuration of more than one network gives what differs by network under `networks`; mainnet is offered only with "mainnetEnabled": true.
const offered = config.networks === undefined ? [config.network] : Object.keys(config.networks).filter((name) => name !== 'mainnet' || config.mainnetEnabled === true);
if (config.networks !== undefined) console.log(`configuration: networks ${offered.join(', ')}, starting on ${config.network}${config.networks.mainnet !== undefined && config.mainnetEnabled !== true ? '; mainnet described but NOT allowed (no "mainnetEnabled": true)' : ''}`);
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

/**
 * The frozen text of version 3 of the loan template for Paryon's own deployments (packages/paryon/frozen), by its
 * identifier and content hash; apps/paryon-service/test checks that these are the frozen texts'. On another network
 * the template is made from the deployment the configuration names, so only that the network is served is checked.
 */
const FROZEN_V3 = {
  chipnet: { identifier: '160a451f5398db649de7d660855db24113b774559534361f8334cbfe9a583e20', contentHash: 'f7cdfbc37a81b71dd879bc3c07756151501aea5bfce0f5c51e7147c18d66deab' },
  mainnet: { identifier: '89b1af236ace2e5544f28f286a830186dc742597ddb9a7e7e3a205ad1b48092a', contentHash: '6b671ec1e9df62b4e3e9f6f8d723effa4bcc69e28e4fe859f7f1cc04dea75b7b' },
};

const service = async (url, network) => {
  const template = FROZEN_V3[network] ?? FROZEN_V3.chipnet;
  const message = { action: 'xo_service_hello', version: 1, network, id: `check-${network}`, time: Math.floor(Date.now() / 1000), template, role: 'borrower' };
  try {
    const answer = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ xo_service_v1: message }), redirect: 'error', signal: AbortSignal.timeout(10_000) });
    const allowed = answer.headers.get('access-control-allow-origin');
    const body = (await answer.json().catch(() => ({})))?.xo_service_v1 ?? {};
    const served = body.ok === true ? body.serves?.find((entry) => entry.role === 'service')?.template : undefined;
    const ok =
      answer.status === 200 &&
      allowed === '*' &&
      (FROZEN_V3[network] === undefined ? body.ok === false && body.code === 'unknown-template' : served?.identifier === template.identifier && served?.contentHash === template.contentHash);
    const says = body.ok === true ? `serves ${served?.identifier ?? 'nothing'} as the service` : `refuses: ${body.code ?? body.error ?? 'no answer of the protocol'}`;
    console.log(`service: ${url} on ${network} answers ${answer.status}, ${says}, ${allowed === null ? 'no CORS header' : `allows ${allowed}`}${ok ? '' : `; expected ${FROZEN_V3[network] === undefined ? 'the network served (another template refused as unknown-template)' : `template ${template.identifier}`} and CORS for any page`}`);
    if (!ok) failed = true;
  } catch (error) {
    console.log(`service: ${url} on ${network} cannot be reached: ${error.message}`);
    failed = true;
  }
};

await page('wallet', config.walletUrl, true);
await page('recoverer', config.recovererUrl, true);
if (config.jarUrl !== undefined) await page('savings jar', config.jarUrl, false);
if (config.loanUrl !== undefined) await page('loan page', config.loanUrl, false);
const stores = new Set(config.networks === undefined ? config.stores : offered.flatMap((name) => config.networks[name].stores ?? config.stores ?? []));
for (const url of stores) await store(url, new URL(config.walletUrl).origin);
// Paryon's service, where the loan page is served: on the same host, at service/v1 beside it.
if (config.loanUrl !== undefined) for (const network of offered) await service(new URL('service/v1', config.loanUrl).href, network);
process.exit(failed ? 1 : 0);
