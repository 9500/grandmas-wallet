import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';

import { binToHex } from '@bitauth/libauth';
import {
  type ServiceHandlers,
  type ServiceHttpAnswer,
  type ServiceItem,
  type ServiceJoinOutcome,
  type ServiceNetworks,
  type ServicePossibleOutcome,
  SERVICE_HELLO,
  SERVICE_JOIN_REQUEST,
  SERVICE_LIMITS,
  SERVICE_NETWORK_NAMES,
  SERVICE_POSSIBLE_REQUEST,
  answerServiceRequest,
  checkJoinedInvitation,
  decodeServiceBody,
  serviceCarriageFailure,
} from '@grandmas-wallet/connect';
import { templateLockingBytecode } from '@grandmas-wallet/core';
import { deskFor } from '@grandmas-wallet/loan-app/src/loan.js';
import {
  type ParyonService,
  type ParyonServiceChain,
  type PossibleItem,
  type ServiceShare,
  paryonAddressesAt,
  paryonChipnetTemplateTextV3,
  paryonMainnetTemplateTextV3,
  paryonService,
  paryonTemplateAlone,
  possibleActions,
  serviceShare,
} from '@grandmas-wallet/paryon';

import { type ChainOptions, Gate, NetworkChain, type ServiceChain } from './chain.js';
import { type EngineJob, type EngineSession, type EngineShare, startEngineChild } from './engine.js';
import { SERVICE_ROLE, WALLET_ROLE, readWalletInvitation } from './invitation.js';

export { Gate } from './chain.js';

/**
 * Paryon's service: the server that takes part in every action of version 3 of the ParyonUSD loan template as the
 * template's `service`, over `xo_service_v1` (docs/xo-service.md). It answers which template it serves on each network,
 * what a wallet's holdings make possible, and joins the wallet's invitations with Paryon's values, shared coins and
 * outputs, worked out by packages/paryon's library from the chain.
 *
 *   POST    <path>   one message of xo_service_v1, answered in kind
 *   OPTIONS <path>   a browser's preflight
 *
 * It keeps nothing between messages and holds no key that matters: the engine that signs its commit to an invitation
 * has a seed made up for that join alone, in a process that ends with the join. The networks and Paryon's deployment on
 * each come from the same configuration file as the pages (deploy/config/*.json), read as the loan page reads it.
 */

// ------------------------------------------------------------------ the networks served

/** The parts of a configuration file (deploy/config/*.json) the service reads. */
export interface ServiceConfig {
  network: string;
  mainnetEnabled?: boolean;
  loanUrl?: string;
  chain?: string[];
  paryon?: unknown;
  networks?: Record<string, { chain?: string[]; paryon?: unknown; loanUrl?: string }>;
}

/** A network the service serves: Paryon's deployment there and the template of version 3 for it. */
export interface ServedNetwork {
  network: string;
  service: ParyonService;
  template: { identifier: string; contentHash: string };
  templateText: string;
  /** The template's actions. */
  actions: string[];
  /** Electrum servers, from the configuration. */
  chain: string[];
  /** The engine's network: mainnet's keys on mainnet, chipnet's on every test network. */
  engineNetwork: 'mainnet' | 'chipnet';
  /** A chain of one's own (regtest rules): the local node or the mockup network. */
  ownChain: boolean;
}

const OWN_CHAINS = ['regtest', 'mockup'];

/**
 * The networks a configuration has the service serve: those the pages are offered on (mainnet only with
 * `"mainnetEnabled": true`, exactly as deploy/serve.mjs decides it), each with the deployment the loan page uses there
 * (`deskFor`): Paryon's own on chipnet and mainnet, with the frozen text of version 3; elsewhere the one the
 * configuration names (`paryon`), with the template made for it here, naming the service beside the loan page
 * (`loanUrl`). A network without a deployment, or without servers to read, is not served.
 * @throws when the configuration names mainnet alone and does not allow it
 */
export const servedNetworks = (config: ServiceConfig): { served: ServedNetwork[]; skipped: { network: string; reason: string }[] } => {
  if (config.networks === undefined && config.network === 'mainnet' && config.mainnetEnabled !== true) throw new Error('The configuration names mainnet but does not allow it ("mainnetEnabled": true).');
  const described =
    config.networks === undefined
      ? [{ ...config }]
      : Object.entries(config.networks)
          .filter(([name]) => name !== 'mainnet' || config.mainnetEnabled === true)
          .map(([name, part]) => ({ ...config, ...part, network: name }));
  const served: ServedNetwork[] = [];
  const skipped: { network: string; reason: string }[] = [];
  for (const part of described) {
    const { network } = part;
    const chain = (part.chain ?? []).filter((url) => typeof url === 'string');
    if (network !== 'mainnet' && network !== 'chipnet' && !OWN_CHAINS.includes(network)) {
      skipped.push({ network, reason: 'not a network the service knows' });
      continue;
    }
    const desk = deskFor({ network, paryon: part.paryon });
    if (desk === undefined) {
      skipped.push({ network, reason: 'the configuration names no deployment of Paryon\'s there ("paryon")' });
      continue;
    }
    if (chain.length === 0) {
      skipped.push({ network, reason: 'the configuration names no server to read the chain from ("chain")' });
      continue;
    }
    let templateText: string;
    if (desk.paryons) templateText = network === 'mainnet' ? paryonMainnetTemplateTextV3 : paryonChipnetTemplateTextV3;
    else if (typeof part.loanUrl === 'string') templateText = paryonTemplateAlone(desk.contracts, 3, paryonAddressesAt(part.loanUrl)).texts.template;
    else {
      skipped.push({ network, reason: 'the configuration names no address of the loan page ("loanUrl"), beside which the template names the service' });
      continue;
    }
    const service = paryonService(desk.contracts, templateText, network);
    served.push({
      network,
      service,
      template: { identifier: service.template.identifier, contentHash: service.template.contentHash },
      templateText,
      actions: Object.keys(service.template.definition.actions ?? {}),
      chain,
      engineNetwork: network === 'mainnet' ? 'mainnet' : 'chipnet',
      ownChain: OWN_CHAINS.includes(network),
    });
  }
  return { served, skipped };
};

// ------------------------------------------------------------------ the messages

/** The engine's part of a join (engine.ts), or a stand-in in tests. */
export type EnginePart = (job: { served: ServedNetwork; invitation: string }) => EngineSession;

export interface HandlerDependencies {
  chainOf(network: string): ParyonServiceChain;
  engine: EnginePart;
  /** Which of several shared coins a join takes; random unless given. */
  pick?: (count: number) => number;
  /** The most a join may take in all, and what is possible: well inside the 25 s and 10 s a wallet waits. Defaults 18 s and 8 s. */
  joinTimeoutMs?: number;
  possibleTimeoutMs?: number;
}

/** A wallet that cannot be told what is possible because the chain cannot be read is told so, in plain words. */
const CHAIN_TROUBLE = 'The service cannot read the chain just now. Try again in a minute.';

/** The work, or a failure once the time is up. */
const inTime = <T>(work: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Out of time.')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });

/** An item's `ref`: its action and its token, which a join is checked against. Nothing else is kept. */
export const itemRef = (action: string, category: string): string => `${action}:${category}`;

const scriptHex = new Map<string, string | undefined>();
/** A template locking script as hex, for the wallet to check the position on the chain. */
const lockingScriptHex = (served: ServedNetwork, identifier: string): string | undefined => {
  const key = `${served.template.identifier} ${identifier}`;
  if (!scriptHex.has(key)) {
    try {
      scriptHex.set(key, binToHex(templateLockingBytecode(served.service.template.definition, identifier, {})));
    } catch {
      scriptHex.set(key, undefined);
    }
  }
  return scriptHex.get(key);
};

const itemOf = (served: ServedNetwork, item: PossibleItem): ServiceItem => {
  const script = item.lockingScript === undefined ? undefined : lockingScriptHex(served, item.lockingScript);
  return {
    ref: itemRef(item.action, item.category),
    category: item.category,
    action: item.action,
    ...(script === undefined ? {} : { lockingScript: script }),
    ...(item.coin === undefined ? {} : { coin: item.coin }),
    ...(item.about === undefined ? {} : { about: item.about }),
    ...(item.bindings === undefined ? {} : { bindings: item.bindings as NonNullable<ServiceItem['bindings']> }),
    ...(item.says === undefined ? {} : { says: item.says }),
  };
};

const shareOf = (share: ServiceShare): EngineShare => ({
  variables: share.variables,
  inputs: share.inputs.map(({ outpoint, inputIdentifier, unlockingBytecode, sequenceNumber }) => ({ outpoint, inputIdentifier, unlockingBytecode: binToHex(unlockingBytecode), sequenceNumber })),
  outputs: share.outputs,
});

/** The handlers of one served network. */
const handlersOf = (served: ServedNetwork, dependencies: HandlerDependencies): ServiceHandlers => {
  const ours = (template: { identifier: string; contentHash: string }, role: string): boolean =>
    template.identifier === served.template.identifier && template.contentHash === served.template.contentHash && role === WALLET_ROLE;
  const unknown = { ok: false as const, code: 'unknown-template' as const, error: `This service serves Paryon's loan template, version 3, in which the wallet is the ${WALLET_ROLE}; not this template or role.` };
  return {
    hello: (request) => (ours(request.template, request.role) ? { ok: true, serves: [{ template: served.template, role: SERVICE_ROLE }] } : unknown),

    possible: async (request): Promise<ServicePossibleOutcome> => {
      if (!ours(request.template, request.role)) return unknown;
      const chain = dependencies.chainOf(served.network);
      let possible: Awaited<ReturnType<typeof possibleActions>>;
      let height: number;
      try {
        [possible, { height }] = await inTime(Promise.all([possibleActions(served.service, { tokens: request.tokens, made: request.made }, chain), chain.tip()]), dependencies.possibleTimeoutMs ?? 8_000);
      } catch {
        return { ok: false, error: CHAIN_TROUBLE };
      }
      return {
        ok: true,
        height,
        start: possible.starts.map(({ action, available, reason }) => ({ action, available, ...(reason === undefined ? {} : { reason }) })),
        items: possible.items.slice(0, SERVICE_LIMITS.entries).map((item) => itemOf(served, item)),
      };
    },

    join: async (request): Promise<ServiceJoinOutcome> => {
      const read = readWalletInvitation(request.invitation, { identifier: served.template.identifier, actions: served.actions });
      if (!read.ok) return { ok: false, code: read.code, error: read.reason };
      if (request.ref !== undefined) {
        const category = read.committed.variables['keyCategory'];
        if (request.ref !== itemRef(read.action, String(category ?? '').toLowerCase())) return { ok: false, code: 'bad-invitation', error: 'The invitation is not for the item its ref names.' };
      }
      const session = dependencies.engine({ served, invitation: request.invitation });
      const deadline = Date.now() + (dependencies.joinTimeoutMs ?? 18_000);
      try {
        const sharing = serviceShare(served.service, read.action, read.committed, dependencies.chainOf(served.network), dependencies.pick === undefined ? {} : { pick: dependencies.pick }).then(
          (share) => ({ share }),
          () => ({ share: undefined }),
        );
        const [check, { share }] = await inTime(Promise.all([session.checked, sharing]), deadline - Date.now());
        if (!check.ok) return { ok: false, code: 'bad-invitation', error: check.reason };
        if (share === undefined) return { ok: false, error: CHAIN_TROUBLE };
        if (!share.ok) return { ok: false, code: share.code, error: share.reason };
        const joined = await inTime(session.join(shareOf(share)), deadline - Date.now());
        // Exactly one commit added, the service's, and nothing else changed.
        const added = checkJoinedInvitation(request.invitation, joined);
        if (!added.ok) throw new Error(added.reason);
        return { ok: true, invitation: joined };
      } finally {
        session.stop();
      }
    },
  };
};

/** The handlers of every served network, keyed by network as `answerServiceRequest` takes them. */
export const paryonServiceHandlers = (served: readonly ServedNetwork[], dependencies: HandlerDependencies): ServiceNetworks =>
  Object.fromEntries(served.map((network) => [network.network, handlersOf(network, dependencies)]));

// ------------------------------------------------------------------ the carriage

/** Messages of each kind taken from one address in an hour. */
export const PER_HOUR = { hello: 120, possible: 60, join: 30 } as const;
type Kind = keyof typeof PER_HOUR;

/** Requests per address and hour, kept in memory: the address the reverse proxy adds last to X-Forwarded-For, or the connection's. */
export const clientOf = (request: IncomingMessage): string => {
  const forwarded = request.headers['x-forwarded-for'];
  const last = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? '')).split(',').map((part) => part.trim()).filter((part) => part !== '').pop();
  return last ?? request.socket.remoteAddress ?? 'unknown';
};

export class RateLimit {
  private readonly recent = new Map<string, number[]>();

  constructor(
    private readonly perHour: Readonly<Record<Kind, number>> = PER_HOUR,
    private readonly now: () => number = Date.now,
  ) {}

  /** @returns `undefined` if taken, or the seconds until the address may send another */
  take(kind: Kind, client: string): number | undefined {
    const key = `${kind} ${client}`;
    const now = this.now();
    const times = (this.recent.get(key) ?? []).filter((time) => now - time < 3_600_000);
    if (times.length >= this.perHour[kind]) {
      this.recent.set(key, times);
      return Math.max(1, Math.ceil((3_600_000 - (now - (times[0] as number))) / 1000));
    }
    times.push(now);
    this.recent.set(key, times);
    return undefined;
  }

  /** Forget what is older than an hour. */
  sweep(): void {
    const now = this.now();
    for (const [key, times] of this.recent) if (times.every((time) => now - time >= 3_600_000)) this.recent.delete(key);
  }
}

export interface ServerOptions {
  handlers: ServiceNetworks;
  /** Where the service answers. Default `/service/v1`. */
  path?: string;
  limit?: RateLimit;
  /** Joins at once, and joins waiting for a place. */
  joins?: Gate;
  /** How long a join waits for a place before it is answered with 429. */
  joinWaitMs?: number;
  /** One line per answered message. Default: standard output. */
  log?: (line: string) => void;
}

const KINDS: Record<string, Kind> = { [SERVICE_HELLO]: 'hello', [SERVICE_POSSIBLE_REQUEST]: 'possible', [SERVICE_JOIN_REQUEST]: 'join' };
/** A network named in the log only if it is one of the protocol's names; nothing a sender wrote is logged. */
const networkLabel = (value: unknown): string => ((SERVICE_NETWORK_NAMES as readonly unknown[]).includes(value) ? (value as string) : '-');

/** What became of a message: `ok`, the refusal's code (`refused` without one), or the HTTP status of a failure of the carriage. */
const outcomeOf = (answer: ServiceHttpAnswer): string => {
  if (answer.status !== 200) return `http-${answer.status}`;
  try {
    const message = decodeServiceBody(answer.body) as { ok?: unknown; code?: unknown };
    return message.ok === true ? 'ok' : typeof message.code === 'string' ? message.code : 'refused';
  } catch {
    return 'unreadable';
  }
};

/** The body, read up to one byte more than a service takes. */
const readBody = (request: IncomingMessage, limit: number): Promise<{ bytes: Uint8Array; whole: boolean }> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const done = (whole: boolean): void => resolve({ bytes: new Uint8Array(Buffer.concat(chunks)).subarray(0, limit + 1), whole });
    request.on('data', (chunk: Buffer) => {
      if (size > limit) return;
      size += chunk.length;
      chunks.push(chunk);
      if (size > limit) {
        request.pause();
        done(false);
      }
    });
    request.on('end', () => done(true));
    request.on('error', reject);
  });

/**
 * The HTTP server of the service: Node's own, answering at one path through `answerServiceRequest`, with the rate
 * limits, the queue of joins, and one line of log per answered message: its kind, its network, what became of it and
 * how long it took. Nothing else of a message is logged: no address, token, coin, invitation or value.
 */
export const createServiceServer = (options: ServerOptions): Server => {
  const path = options.path ?? '/service/v1';
  const limit = options.limit ?? new RateLimit();
  const joins = options.joins ?? new Gate(2, 4);
  const joinWaitMs = options.joinWaitMs ?? 5_000;
  const log = options.log ?? ((line: string) => console.log(line));
  const sweeper = setInterval(() => limit.sweep(), 600_000);
  sweeper.unref();

  const send = (response: ServerResponse, answer: ServiceHttpAnswer, close = false): void => {
    response.writeHead(answer.status, { ...answer.headers, ...(answer.body === '' ? {} : { 'content-length': String(Buffer.byteLength(answer.body)) }), ...(close ? { connection: 'close' } : {}) });
    response.end(answer.body);
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const started = performance.now();
    const pathname = new URL(request.url ?? '/', 'http://service').pathname;
    if (pathname !== path) {
      response.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ error: `Nothing here. The service answers at ${path}.` }));
      return;
    }
    const method = (request.method ?? '').toUpperCase();
    if (method !== 'POST') {
      send(response, await answerServiceRequest({ method }, options.handlers));
      return;
    }
    const { bytes, whole } = await readBody(request, SERVICE_LIMITS.requestBytes);
    let kind: Kind | undefined;
    let network = '-';
    try {
      const message = decodeServiceBody(new TextDecoder().decode(bytes)) as { action?: unknown; network?: unknown };
      kind = typeof message.action === 'string' ? KINDS[message.action] : undefined;
      network = networkLabel(message.network);
    } catch {
      // Answered below as the protocol says.
    }
    const finish = (answer: ServiceHttpAnswer): void => {
      send(response, answer, !whole);
      if (!whole) request.destroy();
      log(`${kind ?? 'unreadable'} ${network} ${outcomeOf(answer)} ${Math.round(performance.now() - started)}ms`);
    };
    const wait = limit.take(kind ?? 'hello', clientOf(request));
    if (wait !== undefined) {
      finish(serviceCarriageFailure(429, `At most ${PER_HOUR[kind ?? 'hello']} such messages an hour are taken from one address. Try again later.`, { code: 'too-many', retryAfter: wait }));
      return;
    }
    let leave: (() => void) | undefined;
    if (kind === 'join' && whole) {
      leave = await joins.enter(joinWaitMs);
      if (leave === undefined) {
        finish(serviceCarriageFailure(429, 'The service is joining as many invitations as it can just now. Ask again shortly.', { code: 'too-many', retryAfter: 5 }));
        return;
      }
    }
    try {
      finish(await answerServiceRequest({ method, body: bytes }, options.handlers));
    } finally {
      leave?.();
    }
  };

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) send(response, serviceCarriageFailure(500, 'The service failed to answer.'));
      else response.end();
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.on('close', () => clearInterval(sweeper));
  return server;
};

// ------------------------------------------------------------------ all of it

export interface ServiceOptions {
  config: ServiceConfig;
  path?: string;
  /** The most a join's engine may take, from the start of its process. Default 15 s, well inside a wallet's 25 s. */
  joinTimeoutMs?: number;
  /** Joins at once (default 2) and joins waiting (default 4). */
  joinsAtOnce?: number;
  joinsWaiting?: number;
  /** Readings of the chain at once, over every network. Default 8. */
  readsAtOnce?: number;
  log?: (line: string) => void;
}

/**
 * The service for a configuration: the networks it serves, their chains and the HTTP server.
 * @throws when the configuration serves nothing
 */
export const paryonServiceServer = (options: ServiceOptions): { server: Server; served: ServedNetwork[]; skipped: { network: string; reason: string }[]; close(): Promise<void> } => {
  const { served, skipped } = servedNetworks(options.config);
  if (served.length === 0) throw new Error(`The configuration has the service serve no network: ${skipped.map(({ network, reason }) => `${network}: ${reason}`).join('; ') || 'none described'}.`);
  const reads = new Gate(options.readsAtOnce ?? 8, 200);
  const chains = new Map(served.map((network): [string, NetworkChain] => [network.network, new NetworkChain(network.chain, { reads, timeoutMs: 8_000, ownChain: network.ownChain } satisfies ChainOptions)]));
  const chainOf = (network: string): ServiceChain => {
    const chain = chains.get(network);
    if (chain === undefined) throw new Error(`No chain for ${network}.`);
    return chain;
  };
  const joinTimeoutMs = options.joinTimeoutMs ?? 15_000;
  const engine: EnginePart = ({ served: network, invitation }) =>
    startEngineChild(
      chainOf(network.network)
        .engineServer()
        .then((server): EngineJob => ({ engineNetwork: network.engineNetwork, ...(server === undefined ? {} : { server }), templateText: network.templateText, invitation })),
      joinTimeoutMs,
    );
  const server = createServiceServer({
    handlers: paryonServiceHandlers(served, { chainOf, engine }),
    ...(options.path === undefined ? {} : { path: options.path }),
    joins: new Gate(options.joinsAtOnce ?? 2, options.joinsWaiting ?? 4),
    ...(options.log === undefined ? {} : { log: options.log }),
  });
  return {
    server,
    served,
    skipped,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await Promise.all([...chains.values()].map((chain) => chain.close()));
    },
  };
};
