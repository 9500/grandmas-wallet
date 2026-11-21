// Serves one of the web applications: the files of its build, plus `config.json` taken from the
// environment's configuration file, so that one build runs anywhere.
//
// usage: node deploy/serve.mjs --root apps/wallet/dist --config deploy/config/local.json --host 127.0.0.1 --port 8101
//        [--version <file>]   a record of what was released, shown at /version.json
//        [--connect <origin>] another server this page alone may talk to (repeatable): the loan page reads the
//                             oracle's prices this way, and the other pages are not given it
//        [--document <file>]  a file of the root that is a document complete in itself, its styles and scripts
//                             written in the page (repeatable): the design overview beside the landing page
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};

const root = resolve(argument('root', '.'));
const configPath = resolve(argument('config', 'deploy/config/local.json'));
const host = argument('host', '127.0.0.1');
const port = Number(argument('port', '8080'));
if (!existsSync(join(root, 'index.html'))) {
  console.error(`No index.html in ${root}. Build the applications first: deploy/preview.sh build`);
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, 'utf8'));
// Mainnet only with the parameter that allows it; the pages refuse it too.
if (config.network === 'mainnet' && config.mainnetEnabled !== true) {
  console.error(`${configPath} names mainnet but does not allow it ("mainnetEnabled": true). Not served.`);
  process.exit(1);
}
// What is being served, for checking a deployment from outside: the record written when the pages were
// released if there is one, and otherwise the checkout and its commit when the server started.
const version = (() => {
  const startedAt = new Date().toISOString();
  const released = argument('version', undefined);
  if (released !== undefined) return { ...JSON.parse(readFileSync(resolve(released), 'utf8')), network: config.network, startedAt };
  try {
    const git = (...parameters) => execFileSync('git', parameters, { cwd: root, encoding: 'utf8' }).trim();
    return { commit: git('rev-parse', '--short', 'HEAD'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'), network: config.network, startedAt };
  } catch {
    return { commit: 'unknown', network: config.network, startedAt };
  }
})();

/** Servers named for this page alone. */
const extra = process.argv.flatMap((word, index) => (word === '--connect' && process.argv[index + 1] !== undefined ? [process.argv[index + 1]] : []));

// The Electrum servers the XO engine connects to by itself on this network.
const ENGINE_SERVERS = {
  chipnet: ['wss://chipnet.imaginary.cash:50004', 'wss://chipnet.bch.ninja:50004'],
  mainnet: ['wss://bch.imaginary.cash:50004', 'wss://electrum.imaginary.cash:50004', 'wss://cashnode.bch.ninja:50004', 'wss://fulcrum.greyh.at:50004'],
};

/** A page may only talk to the servers its configuration names. */
const contentSecurityPolicy = [
  "default-src 'none'",
  // The cryptography library runs as WebAssembly.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  // The QR code scanner reads codes in a worker made from its own code, and a picture chosen from the device.
  "worker-src blob:",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${[...config.chain, ...config.stores, ...config.relays, ...(ENGINE_SERVERS[config.network] ?? []), ...extra].join(' ')}`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Files named as documents complete in themselves. */
const documents = new Set(process.argv.flatMap((word, index) => (word === '--document' && process.argv[index + 1] !== undefined ? [resolve(root, process.argv[index + 1])] : [])));

/**
 * A document may run and show what is written in it, and take its fonts from where it names them. It talks to
 * no server, and no other page is served with this policy.
 */
const documentPolicy = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

const server = createServer((request, response) => {
  const headers = {
    'content-security-policy': contentSecurityPolicy,
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'cross-origin-opener-policy': 'same-origin',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, headers).end();
    return;
  }
  const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  if (path === '/config.json') {
    response.writeHead(200, { ...headers, 'content-type': TYPES['.json'], 'cache-control': 'no-store' }).end(JSON.stringify(config));
    return;
  }
  if (path === '/version.json') {
    response.writeHead(200, { ...headers, 'content-type': TYPES['.json'], 'cache-control': 'no-store' }).end(JSON.stringify(version));
    return;
  }
  const requested = normalize(join(root, path));
  const inside = requested.startsWith(root) && existsSync(requested) && statSync(requested).isFile();
  // Anything that is not a file is the application itself.
  const file = inside ? requested : join(root, 'index.html');
  const hashed = inside && path.startsWith('/assets/');
  response.writeHead(200, {
    ...headers,
    ...(documents.has(file) ? { 'content-security-policy': documentPolicy } : {}),
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).pipe(response);
});

server.listen(port, host, () => console.log(`${root} at http://${host}:${port} with ${configPath}`));
