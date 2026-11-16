import {
  type ActionDetails,
  type ActionRequest,
  type ActionResult,
  type Channel,
  type ReportedPosition,
  type TemplateName,
  ACTION_REQUEST,
  ACTION_RESPONSE,
  ACTION_RESULT,
  INVITATION_UPDATE,
  POSITIONS,
  POSITIONS_REQUEST,
  ProtocolError,
  parseRequest,
  sameRequest,
} from './protocol.js';

/**
 * The wallet's side: deciding what to do with each request that arrives, and
 * making sure that a request is carried out at most once however often it is
 * delivered. Nothing here is about any particular application or template.
 */

/** What the wallet remembers about a request. Kept between sessions. */
export interface LedgerEntry extends ActionDetails {
  id: string;
  /** Whether the wallet trusted the template when the request arrived. If not, approving the request means trusting it. */
  templateTrusted: boolean;
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
  /** Agree, and have the wallet carry the request out. For a template not yet trusted, this also trusts it. */
  approve(): Promise<void>;
  decline(): Promise<void>;
}

export interface WalletConnectorOptions {
  /** The templates the wallet trusts now. */
  trusted(): TemplateName[];
  /**
   * Read a template an application sent and say what it is, without taking it in.
   * @throws if it is not a template the wallet could use
   */
  identify(definition: unknown): TemplateName;
  storage?: LedgerStorage;
  /**
   * Carry out an approved request. Called at most once per request identifier.
   * `stage` reports progress to the application.
   */
  execute(entry: LedgerEntry, stage: (stage: 'recorded' | 'sent') => void): Promise<Record<string, unknown>>;
  /** The positions of a trusted template the wallet holds. */
  positions(templateIdentifier: string): Promise<ReportedPosition[]>;
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
    // A template that came with a request is kept only until the request is decided.
    for (const entry of this.entries) if (entry.status !== 'asked' && entry.status !== 'working') delete entry.definition;
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
      const kind = (message as { action?: unknown } | null)?.action;
      if (kind === ACTION_REQUEST) void this.receive(name, message);
      if (kind === POSITIONS_REQUEST) void this.report(channel, message);
    });
    // Whoever connects sees what is waiting for a decision.
    this.announce();
    return () => {
      stop();
      this.channels.delete(name);
    };
  }

  /** The name of the channel a request arrived on in this session, if it did. */
  cameFrom(id: string): string | undefined {
    return this.origin.get(id);
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

  private trusts(template: TemplateName): boolean {
    return this.options.trusted().some((known) => known.identifier === template.identifier && known.contentHash === template.contentHash);
  }

  /** Say which positions of a template the wallet holds. Only a template the wallet trusts gets an answer other than none. */
  private async report(channel: Channel, message: unknown): Promise<void> {
    const { id, template } = (message ?? {}) as { id?: unknown; template?: unknown };
    if (typeof id !== 'string' || typeof template !== 'string') return;
    const trusted = this.options.trusted().some((known) => known.identifier === template);
    const positions = trusted ? await this.options.positions(template).catch(() => []) : [];
    await channel.send({ action: POSITIONS, time: this.now(), id, positions }).catch(() => undefined);
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
    const templateTrusted = this.trusts(request.template);
    if (!templateTrusted) {
      // A template the wallet has not seen has to come with the request, and be the one the request names.
      if (request.definition === undefined) {
        await this.respond(request.id, request.sequence, false, 'This wallet does not know that template. Send the template with the request.');
        return;
      }
      let sent: TemplateName;
      try {
        sent = this.options.identify(request.definition);
      } catch (error) {
        await this.respond(request.id, request.sequence, false, `The template sent with the request cannot be used: ${(error as Error).message}`);
        return;
      }
      if (sent.identifier !== request.template.identifier || sent.contentHash !== request.template.contentHash) {
        await this.respond(request.id, request.sequence, false, 'The template sent with the request is not the one the request names.');
        return;
      }
    }

    const { action: _action, time: _time, sequence: _sequence, id, definition, ...details } = request;
    const entry: LedgerEntry = {
      id,
      ...details,
      // The wallet has its own copy of a template it trusts.
      ...(templateTrusted || definition === undefined ? {} : { definition }),
      templateTrusted,
      receivedAt: this.now(),
      status: 'asked',
    };
    this.entries.push(entry);
    this.persist();
    await this.respond(request.id, request.sequence, true);
    this.announce();
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
