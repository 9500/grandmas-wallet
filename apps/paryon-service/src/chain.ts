import { Electrum } from '@grandmas-wallet/chipnet/electrum';
import type { ListedOutput, ParyonServiceChain } from '@grandmas-wallet/paryon';

import type { EngineServer } from './engine.js';

/**
 * What the service reads of each network: one Electrum connection per network, to the first of the configuration's
 * servers (`chain`) that answers, opened when first needed and opened again after a reading that took too long. Every
 * reading waits for a place among a few at once, shared by all networks, and gives up after a time.
 */

/** Places for a few at a time, and a queue of limited length behind them. */
export class Gate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    readonly concurrent: number,
    readonly queue: number,
  ) {}

  /** @returns how to give the place back, or `undefined` when the queue is full or no place frees up in time */
  enter(waitMs: number): Promise<(() => void) | undefined> {
    if (this.active < this.concurrent) {
      this.active += 1;
      return Promise.resolve(this.leaving());
    }
    if (this.waiting.length >= this.queue) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const wake = (): void => {
        clearTimeout(timer);
        this.active += 1;
        resolve(this.leaving());
      };
      const timer = setTimeout(() => {
        const at = this.waiting.indexOf(wake);
        if (at !== -1) this.waiting.splice(at, 1);
        resolve(undefined);
      }, waitMs);
      this.waiting.push(wake);
    });
  }

  get busy(): number {
    return this.active + this.waiting.length;
  }

  private leaving(): () => void {
    let left = false;
    return () => {
      if (left) return;
      left = true;
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }
}

class TooLong extends Error {}
const within = <T>(work: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TooLong(`${what} took longer than ${Math.round(ms / 1000)} seconds.`)), ms);
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

/** A network's chain as the service reads it, and the server its engine is given. */
export interface ServiceChain extends ParyonServiceChain {
  engineServer(): Promise<EngineServer | undefined>;
}

export interface ChainOptions {
  /** Readings at once, over every network. */
  reads: Gate;
  /** The most a connection or a reading may take. */
  timeoutMs: number;
  /** A chain of one's own (regtest rules), whose engine is given a block of it to start from. */
  ownChain: boolean;
}

export class NetworkChain implements ServiceChain {
  private connecting: Promise<Electrum> | undefined;
  private checkpoint: EngineServer['checkpoint'];

  constructor(
    private readonly endpoints: readonly string[],
    private readonly options: ChainOptions,
  ) {}

  private connection(): Promise<Electrum> {
    if (this.connecting !== undefined) return this.connecting;
    const attempt = (async () => {
      for (const endpoint of this.endpoints) {
        const opening = Electrum.connect(endpoint);
        try {
          return await within(opening, this.options.timeoutMs, 'Connecting to the network\'s server');
        } catch {
          // A connection that opens after all is closed again.
          opening.then((late) => late.disconnect(), () => undefined).catch(() => undefined);
        }
      }
      throw new Error('No server of this network can be reached just now.');
    })();
    this.connecting = attempt;
    attempt.catch(() => {
      if (this.connecting === attempt) this.connecting = undefined;
    });
    return attempt;
  }

  private drop(server: Electrum): void {
    if (this.connecting === undefined) return;
    void this.connecting.then((current) => {
      if (current === server) {
        this.connecting = undefined;
        void server.disconnect().catch(() => undefined);
      }
    }, () => undefined);
  }

  private async read<T>(work: (server: Electrum) => Promise<T>): Promise<T> {
    const leave = await this.options.reads.enter(this.options.timeoutMs);
    if (leave === undefined) throw new Error('The service is reading too much of the chain just now.');
    try {
      const server = await this.connection();
      try {
        return await within(work(server), this.options.timeoutMs, 'Reading the chain');
      } catch (error) {
        if (error instanceof TooLong) this.drop(server);
        throw error;
      }
    } finally {
      leave();
    }
  }

  tip(): Promise<{ height: number }> {
    return this.read((server) => server.tip());
  }

  getTransaction(transactionId: string): Promise<string | undefined> {
    return this.read((server) => server.getTransaction(transactionId));
  }

  listUnspent(lockingBytecode: Uint8Array): Promise<ListedOutput[]> {
    return this.read((server) => server.listUnspent(lockingBytecode));
  }

  async engineServer(): Promise<EngineServer | undefined> {
    const server = await this.connection().catch(() => undefined);
    if (server === undefined) return undefined;
    if (!this.options.ownChain) return /^wss?:/.test(server.endpoint) ? { url: server.endpoint } : undefined;
    this.checkpoint ??= await this.read((reading) => reading.checkpoint(1));
    return { url: server.endpoint, checkpoint: this.checkpoint };
  }

  async close(): Promise<void> {
    const current = this.connecting;
    this.connecting = undefined;
    await current?.then((server) => server.disconnect(), () => undefined).catch(() => undefined);
  }
}
