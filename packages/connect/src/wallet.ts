import {
  type ActionDetails,
  type ActionRequest,
  type ActionResult,
  type Channel,
  type ReportedPosition,
  type TemplateName,
  type TemplateTexts,
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
 *
 * A request is identified by its identifier within the pairing it arrived on.
 * Two applications that happen to choose the same identifier do not meet.
 */

/** What the wallet remembers about a request. Kept between sessions. */
export interface LedgerEntry extends ActionDetails {
  id: string;
  /** The pairing the request arrived on: which application asked. */
  application: string;
  /** Whether the wallet had the template when the request arrived. If not, approving the request means trusting it. */
  templateKnown: boolean;
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
  /** Agree, and have the wallet carry the request out. For a template the wallet did not have, this also trusts it. */
  approve(): Promise<void>;
  decline(): Promise<void>;
}

export interface WalletConnectorOptions {
  /** Whether the wallet has the template a request names: the same identifier, text and recovery declaration. */
  has(template: TemplateName): boolean;
  /**
   * Check that the texts an application sent are what its request names, without taking them in.
   * @throws with the reason if they are not, or if the wallet could not use them
   */
  check(template: TemplateName, texts: TemplateTexts): void;
  storage?: LedgerStorage;
  /**
   * Carry out an approved request. Called at most once per request.
   * `stage` reports progress to the application.
   */
  execute(entry: LedgerEntry, stage: (stage: 'recorded' | 'sent') => void): Promise<Record<string, unknown>>;
  /**
   * The tokens of a template the wallet holds, for the application that asks.
   * @returns `undefined` when the user has not trusted the template in a session with that application
   */
  positions(templateIdentifier: string, application: string): Promise<ReportedPosition[] | undefined>;
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
  /** The open channel of each pairing. */
  private readonly channels = new Map<string, Channel>();

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
    // The texts that came with a request are kept only until the request is decided.
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

  /**
   * Start answering requests that arrive on a channel.
   * @param application - the name of the pairing: the same whenever this application comes back
   * @returns a function that stops
   */
  attach(application: string, channel: Channel): () => void {
    this.channels.set(application, channel);
    const stop = channel.onMessage((message) => {
      const kind = (message as { action?: unknown } | null)?.action;
      if (kind === ACTION_REQUEST) void this.receive(application, message);
      if (kind === POSITIONS_REQUEST) void this.report(application, channel, message);
    });
    // Whoever connects sees what is waiting for a decision.
    this.announce();
    return () => {
      stop();
      if (this.channels.get(application) === channel) this.channels.delete(application);
    };
  }

  get ledger(): readonly LedgerEntry[] {
    return this.entries;
  }

  private async send(application: string, message: Parameters<Channel['send']>[0]): Promise<void> {
    // The application may have gone; the outcome is kept and given when it asks again.
    await this.channels.get(application)?.send(message).catch(() => undefined);
  }

  private respond(application: string, id: string, sequence: number, accepted: boolean, reason?: string, templateNeeded = false): Promise<void> {
    return this.send(application, { action: ACTION_RESPONSE, time: this.now(), sequence, id, accepted, ...(reason === undefined ? {} : { reason }), ...(templateNeeded ? { templateNeeded: true } : {}) });
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

  /** Say which tokens of a template the wallet holds. Only a template the user trusted with this application gets an answer other than none. */
  private async report(application: string, channel: Channel, message: unknown): Promise<void> {
    const { id, template } = (message ?? {}) as { id?: unknown; template?: unknown };
    if (typeof id !== 'string' || typeof template !== 'string') return;
    let positions: ReportedPosition[] | undefined;
    let error: string | undefined;
    try {
      positions = await this.options.positions(template, application);
    } catch (problem) {
      // Not being able to read the chain is not the same as holding nothing, and must not look like it.
      error = (problem as Error).message || 'The wallet could not read its positions.';
    }
    const trusted = positions !== undefined || error !== undefined;
    // An error is reported only for a template the application may ask about: otherwise it would say whether the wallet has the template.
    await channel.send({ action: POSITIONS, time: this.now(), id, trusted, positions: positions ?? [], ...(error === undefined ? {} : { error }) }).catch(() => undefined);
  }

  /** Take in one message that claims to be a request. */
  async receive(application: string, message: unknown): Promise<void> {
    let request: ActionRequest;
    try {
      request = parseRequest(message);
    } catch (error) {
      // Without a readable identifier there is nothing to answer to.
      const { id, sequence } = (message ?? {}) as { id?: unknown; sequence?: unknown };
      if (typeof id === 'string' && typeof sequence === 'number' && error instanceof ProtocolError) await this.respond(application, id, sequence, false, error.message);
      return;
    }
    const answer = (accepted: boolean, reason?: string, templateNeeded = false): Promise<void> => this.respond(application, request.id, request.sequence, accepted, reason, templateNeeded);

    const known = this.entries.find((entry) => entry.application === application && entry.id === request.id);
    if (known !== undefined) {
      if (!sameRequest(known, request)) {
        await answer(false, 'A different request with this identifier was already received.');
        return;
      }
      // The same request again: say where it stands, and never carry it out a second time.
      if (known.status === 'declined') {
        await answer(false, known.error ?? 'The user declined.');
      } else {
        await answer(true);
        if (known.status === 'done' || known.status === 'failed') await this.send(application, this.outcome(known));
      }
      return;
    }

    const age = Math.abs(this.now() - request.time);
    if (age > (this.options.maximumAgeSeconds ?? 600)) {
      await answer(false, 'The request is too old, or the clocks disagree.');
      return;
    }
    const templateKnown = this.options.has(request.template);
    if (!templateKnown) {
      // The wallet says that it does not have the template; the application sends the same request again with it.
      if (request.definition === undefined) {
        await answer(false, 'This wallet does not have that template. Send the template with the request.', true);
        return;
      }
      try {
        this.options.check(request.template, request.definition);
      } catch (error) {
        await answer(false, (error as Error).message);
        return;
      }
    }

    const { action: _action, time: _time, sequence: _sequence, id, definition, ...details } = request;
    const entry: LedgerEntry = {
      id,
      application,
      ...details,
      // The wallet has its own copy of a template it trusts.
      ...(templateKnown || definition === undefined ? {} : { definition }),
      templateKnown,
      receivedAt: this.now(),
      status: 'asked',
    };
    this.entries.push(entry);
    this.persist();
    await answer(true);
    this.announce();
  }

  private async carryOut(entry: LedgerEntry): Promise<void> {
    if (entry.status !== 'asked') return;
    entry.status = 'working';
    this.persist();
    this.announce();
    const { application } = entry;
    await this.send(application, { action: INVITATION_UPDATE, time: this.now(), id: entry.id, stage: 'approved' });
    try {
      entry.result = await this.options.execute(entry, (stage) => void this.send(application, { action: INVITATION_UPDATE, time: this.now(), id: entry.id, stage }));
      entry.status = 'done';
    } catch (error) {
      entry.status = 'failed';
      entry.error = (error as Error).message;
    }
    this.persist();
    await this.send(application, this.outcome(entry));
  }

  private async decline(entry: LedgerEntry): Promise<void> {
    if (entry.status !== 'asked') return;
    entry.status = 'declined';
    entry.error = 'The user declined.';
    this.persist();
    this.announce();
    await this.send(entry.application, this.outcome(entry));
  }
}
