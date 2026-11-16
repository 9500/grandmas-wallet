// Serves one of the web applications: the files of its build, plus `config.json` taken from the
// environment's configuration file, so that one build runs anywhere.
//
// usage: node deploy/serve.mjs --root apps/wallet/dist --config deploy/config/local.json --host 127.0.0.1 --port 8101
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
  console.error(`No index.html in ${root}. Build the applications first: npm run build:web`);
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, 'utf8'));

// The Electrum servers the XO engine connects to by itself on this network.
const ENGINE_SERVERS = { chipnet: ['wss://chipnet.imaginary.cash:50004', 'wss://chipnet.bch.ninja:50004'] };

/** A page may only talk to the servers its configuration names. */
const contentSecurityPolicy = [
  "default-src 'none'",
  // The cryptography library runs as WebAssembly.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data:",
  `connect-src 'self' ${[...config.chain, ...config.stores, ...config.relays, ...(ENGINE_SERVERS[config.network] ?? [])].join(' ')}`,
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
  const requested = normalize(join(root, path));
  const inside = requested.startsWith(root) && existsSync(requested) && statSync(requested).isFile();
  // Anything that is not a file is the application itself.
  const file = inside ? requested : join(root, 'index.html');
  const hashed = inside && path.startsWith('/assets/');
  response.writeHead(200, {
    ...headers,
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).pipe(response);
});

server.listen(port, host, () => console.log(`${root} at http://${host}:${port} with ${configPath}`));
