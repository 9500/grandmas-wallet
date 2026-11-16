import {
  type ActionRequest,
  type ActionResult,
  type Channel,
  type OfferedTemplate,
  type ParameterValue,
  ACTION_REQUEST,
  ACTION_RESPONSE,
  ACTION_RESULT,
  INVITATION_UPDATE,
  ProtocolError,
  parseRequest,
  sameRequest,
} from './protocol.js';

/**
 * The wallet's side: deciding what to do with each request that arrives, and
 * making sure that a request is carried out at most once however often it is
 * delivered.
 */

/** What the wallet remembers about a request. Kept between sessions. */
export interface LedgerEntry {
  id: string;
  template: string;
  operation: string;
  parameters: Record<string, ParameterValue>;
  /** Unix seconds, by the wallet's clock, when the request first arrived. */
  receivedAt: number;
  /**
   * - `asked`: waiting for the user
   * - `working`: approved and being carried out
   * - `done`, `failed`, `declined`: finished; the outcome is kept and repeated to anyone who asks again
   */
  status: 'asked' | 'working' | 'done' | 'failed' | 'declined';
  result?: Record<string, unknown>;
  error?: string;
}

export interface LedgerStorage {
  load(): LedgerEntry[];
  save(entries: LedgerEntry[]): void;
}

export const temporaryLedger = (): LedgerStorage => {
  let kept: LedgerEntry[] = [];
  return { load: () => kept, save: (entries) => void (kept = entries) };
};

/** What the wallet shows the user before acting. */
export interface Proposal {
  entry: LedgerEntry;
  /** Agree, and have the wallet carry the request out. */
  approve(): Promise<void>;
  decline(): Promise<void>;
}

export interface WalletConnectorOptions {
  templates: OfferedTemplate[];
  storage?: LedgerStorage;
  /**
   * Carry out an approved request. Called at most once per request identifier.
   * `stage` reports progress to the application.
   */
  execute(entry: LedgerEntry, stage: (stage: 'recorded' | 'sent') => void): Promise<Record<string, unknown>>;
  /** Operations that only read and are answered without asking the user. */
  readOnly?: string[];
  /** Called when a request needs the user's decision, and again whenever the list of open proposals changes. */
  onProposals(proposals: Proposal[]): void;
  /** Requests whose time is further than this from the wallet's clock are refused. Default 10 minutes. */
  maximumAgeSeconds?: number;
  /** How long outcomes are kept. Default 30 days. */
  retentionSeconds?: number;
  now?: () => number;
}

export class WalletConnector {
  private entries: LedgerEntry[];
  private readonly storage: LedgerStorage;
  private readonly channels = new Map<string, Channel>();
  /** Which channel each open request came in on, for sending its outcome. */
  private readonly origin = new Map<string, string>();

  constructor(private readonly options: WalletConnectorOptions) {
    this.storage = options.storage ?? temporaryLedger();
    this.entries = this.storage.load();
    // A request that was being carried out when the wallet closed has an unknown outcome; it is not run again.
    for (const entry of this.entries) {
      if (entry.status === 'working') {
        entry.status = 'failed';
        entry.error = 'The wallet was closed while this was being carried out. Check the wallet before asking again.';
      }
    }
    this.persist();
  }

  private now(): number {
    return this.options.now?.() ?? Math.floor(Date.now() / 1000);
  }

  private persist(): void {
    const cutoff = this.now() - (this.options.retentionSeconds ?? 30 * 86_400);
    this.entries = this.entries.filter((entry) => entry.receivedAt >= cutoff || entry.status === 'asked' || entry.status === 'working');
    this.storage.save(this.entries);
  }

  private announce(): void {
    this.options.onProposals(
      this.entries
        .filter((entry) => entry.status === 'asked')
        .map((entry) => ({ entry, approve: () => this.carryOut(entry), decline: () => this.decline(entry) })),
    );
  }

  /** Start answering requests that arrive on a channel. Returns a function that stops. */
  attach(name: string, channel: Channel): () => void {
    this.channels.set(name, channel);
    const stop = channel.onMessage((message) => {
      if ((message as { action?: unknown } | null)?.action === ACTION_REQUEST) void this.receive(name, message);
    });
    return () => {
      stop();
      this.channels.delete(name);
    };
  }

  get ledger(): readonly LedgerEntry[] {
    return this.entries;
  }

  private async send(id: string, message: Parameters<Channel['send']>[0]): Promise<void> {
    const channel = this.channels.get(this.origin.get(id) ?? '');
    // The application may have gone; the outcome is kept and given when it asks again.
    await channel?.send(message).catch(() => undefined);
  }

  private respond(id: string, sequence: number, accepted: boolean, reason?: string): Promise<void> {
    return this.send(id, { action: ACTION_RESPONSE, time: this.now(), sequence, id, accepted, ...(reason === undefined ? {} : { reason }) });
  }

  private outcome(entry: LedgerEntry): ActionResult {
    return {
      action: ACTION_RESULT,
      time: this.now(),
      id: entry.id,
      ok: entry.status === 'done',
      ...(entry.result === undefined ? {} : { result: entry.result }),
      ...(entry.error === undefined ? {} : { error: entry.error }),
    };
  }

  /** Take in one message that claims to be a request. */
  async receive(channelName: string, message: unknown): Promise<void> {
    let request: ActionRequest;
    try {
      request = parseRequest(message);
    } catch (error) {
      // Without a readable identifier there is nothing to answer to.
      const { id, sequence } = (message ?? {}) as { id?: unknown; sequence?: unknown };
      if (typeof id === 'string' && typeof sequence === 'number' && error instanceof ProtocolError) {
        this.origin.set(id, channelName);
        await this.respond(id, sequence, false, error.message);
      }
      return;
    }
    this.origin.set(request.id, channelName);

    const known = this.entries.find((entry) => entry.id === request.id);
    if (known !== undefined) {
      if (!sameRequest(known, request)) {
        await this.respond(request.id, request.sequence, false, 'A different request with this identifier was already received.');
        return;
      }
      // The same request again: say where it stands, and never carry it out a second time.
      if (known.status === 'declined') {
        await this.respond(request.id, request.sequence, false, known.error ?? 'The user declined.');
      } else {
        await this.respond(request.id, request.sequence, true);
        if (known.status === 'done' || known.status === 'failed') await this.send(request.id, this.outcome(known));
      }
      return;
    }

    const age = Math.abs(this.now() - request.time);
    if (age > (this.options.maximumAgeSeconds ?? 600)) {
      await this.respond(request.id, request.sequence, false, 'The request is too old, or the clocks disagree.');
      return;
    }
    const template = this.options.templates.find((offered) => offered.identifier === request.template);
    if (template === undefined) {
      await this.respond(request.id, request.sequence, false, 'This wallet has not reviewed that template.');
      return;
    }
    if (!template.operations.includes(request.operation)) {
      await this.respond(request.id, request.sequence, false, `This wallet does not offer "${request.operation}" for that template.`);
      return;
    }

    const entry: LedgerEntry = {
      id: request.id,
      template: request.template,
      operation: request.operation,
      parameters: request.parameters,
      receivedAt: this.now(),
      status: 'asked',
    };
    this.entries.push(entry);
    this.persist();
    await this.respond(request.id, request.sequence, true);
    if (this.options.readOnly?.includes(request.operation) === true) await this.carryOut(entry);
    else this.announce();
  }

  private async carryOut(entry: LedgerEntry): Promise<void> {
    if (entry.status !== 'asked') return;
    entry.status = 'working';
    this.persist();
    this.announce();
    await this.send(entry.id, { action: INVITATION_UPDATE, time: this.now(), id: entry.id, stage: 'approved' });
    try {
      entry.result = await this.options.execute(entry, (stage) => void this.send(entry.id, { action: INVITATION_UPDATE, time: this.now(), id: entry.id, stage }));
      entry.status = 'done';
    } catch (error) {
      entry.status = 'failed';
      entry.error = (error as Error).message;
    }
    this.persist();
    await this.send(entry.id, this.outcome(entry));
  }

  private async decline(entry: LedgerEntry): Promise<void> {
    if (entry.status !== 'asked') return;
    entry.status = 'declined';
    entry.error = 'The user declined.';
    this.persist();
    this.announce();
    await this.send(entry.id, this.outcome(entry));
  }
}
