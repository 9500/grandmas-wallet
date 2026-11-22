import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The engine's part of a join, in a process of its own: one XO engine is open in a process at a time, and nothing of
 * a join is to outlive it. For each join a child process opens an engine with a seed made up for it (a participant's
 * identity is new for each invitation, and the service signs nothing on chain), imports the served template, checks the
 * wallet's invitation against the template as the engine stored it (`validateInvitation`), and, once the server has
 * worked out the service's share, joins the invitation in the service's role with one commit that carries the whole
 * share. It answers with the invitation's text and ends; it is killed when it takes longer than it may.
 *
 * The two processes speak in lines of JSON over the child's standard input and output; nothing is written to disk.
 */

/** The Electrum server the child's engine is given: the one the server reads the network from. */
export interface EngineServer {
  url: string;
  /** For a chain of one's own (regtest rules): a block of it the engine starts from, as the server states it. */
  checkpoint?: { height: number; blockHash: string; merkleRoot: string };
}

/** What the child is given first. */
export interface EngineJob {
  /** The engine's network: mainnet's keys on mainnet, chipnet's on every test network. */
  engineNetwork: 'mainnet' | 'chipnet';
  server?: EngineServer;
  templateText: string;
  invitation: string;
}

/** The service's share as the child commits it. Values as text; bytes as hex. */
export interface EngineShare {
  variables: Record<string, string>;
  inputs: { outpoint: string; inputIdentifier: string; unlockingBytecode: string; sequenceNumber: number }[];
  outputs: string[];
}

export type EngineCheck = { ok: true } | { ok: false; reason: string };

/** One join's engine. */
export interface EngineSession {
  /** Whether the engine takes the wallet's invitation. Rejects when the child fails or runs out of time. */
  checked: Promise<EngineCheck>;
  /** Join with the service's share: the invitation's text with the service's commit. */
  join(share: EngineShare): Promise<string>;
  /** End the child, whatever it is doing. */
  stop(): void;
}

/** The parent's messages and the child's, one per line. */
export type ParentMessage = ({ kind: 'job' } & EngineJob) | ({ kind: 'share' } & EngineShare) | { kind: 'stop' };
export type ChildMessage = { kind: 'checked' } | { kind: 'refused'; reason: string } | { kind: 'joined'; invitation: string } | { kind: 'failed'; reason: string };

const CHILD = fileURLToPath(new URL('./engine-child.ts', import.meta.url));
/** The child runs the TypeScript sources as the server does. */
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

/**
 * Start a child for one join.
 * @param timeoutMs the most the child may live, from its start
 */
export const startEngineChild = (job: Promise<EngineJob>, timeoutMs: number): EngineSession => {
  const child = spawn(process.execPath, ['--import', TSX, CHILD], { stdio: ['pipe', 'pipe', 'ignore'] });
  let ended: Error | undefined;
  const waiting: { kinds: ChildMessage['kind'][]; resolve(message: ChildMessage): void; reject(error: Error): void }[] = [];
  const received: ChildMessage[] = [];
  const end = (error: Error): void => {
    if (ended !== undefined) return;
    ended = error;
    clearTimeout(timer);
    child.kill('SIGKILL');
    for (const waiter of waiting.splice(0)) waiter.reject(error);
  };
  const timer = setTimeout(() => end(new Error(`The engine's part took longer than ${Math.round(timeoutMs / 1000)} seconds.`)), timeoutMs);
  child.on('error', (error) => end(error));
  // After its output has been read to the end.
  child.on('close', () => end(new Error('The engine\'s process ended.')));
  child.stdin.on('error', () => undefined);
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message: ChildMessage;
    try {
      message = JSON.parse(line) as ChildMessage;
    } catch {
      return;
    }
    const at = waiting.findIndex((waiter) => waiter.kinds.includes(message.kind));
    if (at === -1) received.push(message);
    else waiting.splice(at, 1)[0]?.resolve(message);
  });
  const next = (kinds: ChildMessage['kind'][]): Promise<ChildMessage> => {
    const at = received.findIndex((message) => kinds.includes(message.kind));
    if (at !== -1) return Promise.resolve(received.splice(at, 1)[0] as ChildMessage);
    if (ended !== undefined) return Promise.reject(ended);
    return new Promise((resolve, reject) => waiting.push({ kinds, resolve, reject }));
  };
  const send = (message: ParentMessage): void => {
    if (ended === undefined) child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  job.then(
    (given) => send({ kind: 'job', ...given }),
    (error: unknown) => end(error instanceof Error ? error : new Error(String(error))),
  );
  const checked = next(['checked', 'refused', 'failed']).then((message): EngineCheck => {
    if (message.kind === 'checked') return { ok: true };
    if (message.kind === 'refused') return { ok: false, reason: message.reason };
    throw new Error(message.kind === 'failed' ? message.reason : 'The engine answered out of turn.');
  });
  checked.catch(() => undefined);
  return {
    checked,
    join: async (share) => {
      send({ kind: 'share', ...share });
      const message = await next(['joined', 'failed']);
      if (message.kind !== 'joined') throw new Error(message.kind === 'failed' ? message.reason : 'The engine answered out of turn.');
      return message.invitation;
    },
    stop: () => {
      send({ kind: 'stop' });
      end(new Error('Stopped.'));
    },
  };
};
