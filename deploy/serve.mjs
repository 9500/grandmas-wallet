// Serves one of the web applications: the files of its build, plus `config.json` taken from the
// environment's configuration file, so that one build runs anywhere.
//
// usage: node deploy/serve.mjs --root apps/wallet/dist --config deploy/config/local.json --host 127.0.0.1 --port 8101
//        [--version <file>]   a record of what was released, shown at /version.json
//        [--connect <origin>] another server this page alone may talk to (repeatable): the loan page reads the
//                             oracle's prices this way, and the other pages are not given it
//        [--document <file>]  a file of the root that is a document complete in itself, its styles and scripts
//                             written in the page (repeatable): the design overview beside the landing page
//        [--forward <prefix>=<address>]  requests whose path starts with the prefix are passed to a server on this
//                             machine (repeatable): the loan page's host forwards /service/ to Paryon's service,
//                             --forward /service/=http://127.0.0.1:8106
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';

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
// The wallet's page reads token registries from whatever host a token's issuer published on chain, when the configuration says `chain`.
if (config.registries?.mode === 'chain' && /(^|[\\/])wallet([\\/]dist)?$/.test(root)) extra.push('https:', ...(config.registries.ipfsGateway ? [new URL(config.registries.ipfsGateway).origin] : []));

// The Electrum servers the XO engine connects to by itself on this network.
const ENGINE_SERVERS = {
  chipnet: ['wss://chipnet.imaginary.cash:50004', 'wss://chipnet.bch.ninja:50004'],
  mainnet: ['wss://bch.imaginary.cash:50004', 'wss://electrum.imaginary.cash:50004', 'wss://cashnode.bch.ninja:50004', 'wss://fulcrum.greyh.at:50004'],
};

/**
 * The networks the page may run on: the configuration's one, or, where it describes more than one under
 * `networks`, each of those it allows (mainnet only with "mainnetEnabled": true), with what differs by network
 * taken over the shared entries.
 */
const described = config.networks === undefined
  ? [config]
  : Object.entries(config.networks)
      .filter(([name]) => name !== 'mainnet' || config.mainnetEnabled === true)
      .map(([name, part]) => ({ ...config, ...part, network: name }));
if (config.networks !== undefined && !described.some((part) => part.network === config.network)) {
  console.error(`${configPath} starts on ${config.network} but does not describe it under "networks". Not served.`);
  process.exit(1);
}
const servers = [...new Set(described.flatMap((part) => [...(part.chain ?? []), ...(part.stores ?? []), ...(part.relays ?? []), ...(part.mockupService ? [part.mockupService] : []), ...(ENGINE_SERVERS[part.network] ?? [])]))];

/** A page may only talk to the servers its configuration names. */
const contentSecurityPolicy = [
  "default-src 'none'",
  // The cryptography library runs as WebAssembly.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  // The QR code scanner reads codes in a worker made from its own code, and a picture chosen from the device.
  "worker-src blob:",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${[...servers, ...extra].join(' ')}`,
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

/**
 * Paths passed to another server on this machine. The request goes as it came: its method, path, body and the headers
 * a service reads, with the client's address in X-Forwarded-For (as the reverse proxy in front gave it, or the
 * connection's when there is none), so that the service's limits count each client. The answer comes back as the
 * service gave it: its status, its headers (its own CORS headers among them; none of this server's are added) and its
 * body. Bodies are capped both ways, and a service that does not answer in time or at all is answered for with 504 or 502.
 */
const forwards = process.argv
  .flatMap((word, index) => (word === '--forward' && process.argv[index + 1] !== undefined ? [process.argv[index + 1]] : []))
  .map((given) => {
    const at = given.indexOf('=');
    const prefix = given.slice(0, at);
    let target;
    try {
      target = new URL(given.slice(at + 1));
    } catch {
      target = undefined;
    }
    if (at < 1 || !prefix.startsWith('/') || target?.protocol !== 'http:') {
      console.error(`--forward ${given}: give a path prefix and a plain HTTP address on this machine, as /service/=http://127.0.0.1:8106. Not served.`);
      process.exit(1);
    }
    return { prefix, target };
  });
const FORWARD_REQUEST_BYTES = 128 * 1024;
const FORWARD_ANSWER_BYTES = 256 * 1024;
const FORWARD_TIMEOUT_MS = 30_000;
// cf-connecting-ip: the client's address as Cloudflare in front gives it, which the service may be told to trust.
const FORWARDED_HEADERS = ['content-type', 'accept', 'origin', 'access-control-request-method', 'access-control-request-headers', 'cf-connecting-ip'];
/** Headers of one connection, not of the answer. */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'proxy-connection', 'upgrade', 'te', 'trailer']);

const forward = (request, response, target) => {
  let settled = false;
  const fail = (status, error) => {
    if (settled) return;
    settled = true;
    if (!response.headersSent) response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }).end(JSON.stringify({ error }));
    else response.destroy();
  };
  const chunks = [];
  let size = 0;
  request.on('data', (chunk) => {
    size += chunk.length;
    if (size <= FORWARD_REQUEST_BYTES) chunks.push(chunk);
    else if (!settled) {
      fail(413, 'The request is too large.');
      request.destroy();
    }
  });
  request.on('error', () => fail(400, 'The request broke off.'));
  request.on('end', () => {
    if (settled) return;
    const body = Buffer.concat(chunks);
    const headers = Object.fromEntries(FORWARDED_HEADERS.flatMap((name) => (request.headers[name] === undefined ? [] : [[name, request.headers[name]]])));
    const forwardedFor = request.headers['x-forwarded-for'];
    headers['x-forwarded-for'] = (Array.isArray(forwardedFor) ? forwardedFor.join(', ') : forwardedFor) || request.socket.remoteAddress || 'unknown';
    headers['content-length'] = String(body.length);
    const outgoing = httpRequest({ host: target.hostname, port: target.port, method: request.method, path: request.url, headers }, (answer) => {
      const parts = [];
      let length = 0;
      answer.on('data', (chunk) => {
        length += chunk.length;
        if (length <= FORWARD_ANSWER_BYTES) parts.push(chunk);
        else {
          answer.destroy();
          fail(502, 'The service answered with more than is passed on.');
        }
      });
      answer.on('error', () => fail(502, 'The service\'s answer broke off.'));
      answer.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const passed = Object.fromEntries(Object.entries(answer.headers).filter(([name]) => !HOP_BY_HOP.has(name) && name !== 'content-length'));
        const answerBody = Buffer.concat(parts);
        response.writeHead(answer.statusCode ?? 502, { ...passed, 'content-length': String(answerBody.length) }).end(answerBody);
      });
    });
    const timer = setTimeout(() => {
      outgoing.destroy();
      fail(504, 'The service did not answer in time.');
    }, FORWARD_TIMEOUT_MS);
    outgoing.on('error', () => {
      clearTimeout(timer);
      fail(502, 'The service cannot be reached just now.');
    });
    outgoing.end(body);
  });
};

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
  const forwarded = forwards.find(({ prefix }) => (request.url ?? '/').startsWith(prefix));
  if (forwarded !== undefined) {
    forward(request, response, forwarded.target);
    return;
  }
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

server.listen(port, host, () => console.log(`${root} at http://${host}:${port} with ${configPath}${forwards.map(({ prefix, target }) => `, ${prefix} to ${target.origin}`).join('')}`));
