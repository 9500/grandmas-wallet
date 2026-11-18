import {
  type ActionDetails,
  type ActionRequest,
  type ActionResult,
  type Channel,
  type ReportedPosition,
  type TemplateTexts,
  ACTION_REQUEST,
  ACTION_RESPONSE,
  ACTION_RESULT,
  INVITATION_UPDATE,
  POSITIONS,
  POSITIONS_REQUEST,
} from './protocol.js';

/**
 * The application's side: asking the wallet to do something and following
 * what becomes of it. A request that has not been answered is sent again
 * when the connection returns; the wallet treats it as the same request.
 */

export type RequestStage = 'sent' | 'accepted' | 'approved' | 'recorded' | 'on-network';

/** The wallet refused, the user declined, or the action failed in the wallet. */
export class RequestRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestRefusedError';
  }
}

/** The wallet did not answer a question in time. Nothing is known about what it holds. */
export class WalletSilentError extends Error {
  constructor() {
    super('Your wallet did not answer. Check that its page is open, then try again.');
    this.name = 'WalletSilentError';
  }
}

interface Pending {
  request: ActionRequest;
  /** The texts the request names, sent when the wallet says that it does not have the template. */
  texts?: TemplateTexts;
  onStage: (stage: RequestStage) => void;
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

const newId = (): string => Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('');

export class DappRequests {
  private readonly pending = new Map<string, Pending>();
  private readonly listing = new Map<string, (answer: { trusted: boolean; positions: ReportedPosition[]; error?: string }) => void>();
  private channel: Channel | undefined;
  private stop: (() => void) | undefined;

  constructor(private readonly now: () => number = () => Math.floor(Date.now() / 1000)) {}

  /** Use a channel from now on, and send again whatever is still open. */
  attach(channel: Channel): void {
    this.stop?.();
    this.channel = channel;
    this.stop = channel.onMessage((message) => this.receive(message));
    for (const { request } of this.pending.values()) void channel.send({ ...request, time: this.now(), sequence: channel.nextSequence() }).catch(() => undefined);
  }

  detach(): void {
    this.stop?.();
    this.stop = undefined;
    this.channel = undefined;
  }

  get open(): number {
    return this.pending.size;
  }

  /**
   * Ask the wallet to carry out an action of the application's template. The request names the template;
   * the texts are sent only when the wallet answers that it does not have it.
   *
   * @param texts - the template, its recovery declaration and what that refers to, as the request names them
   * @param id - to continue a request made before, for example after the page was loaded again
   * @throws RequestRefusedError
   */
  request(details: ActionDetails, texts?: TemplateTexts, onStage: (stage: RequestStage) => void = () => undefined, id: string = newId()): Promise<Record<string, unknown>> {
    const { channel } = this;
    if (channel === undefined) return Promise.reject(new Error('No wallet is connected.'));
    const { definition: _texts, ...lean } = details;
    const request: ActionRequest = { action: ACTION_REQUEST, time: this.now(), sequence: channel.nextSequence(), id, ...lean };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { request, ...(texts === undefined ? {} : { texts }), onStage, resolve, reject });
      onStage('sent');
      // If it is not delivered now, it goes out again when a channel is attached.
      channel.send(request).catch(() => undefined);
    });
  }

  /**
   * Ask which tokens of a template the wallet holds. A wallet in which the user has not trusted the template
   * with this application says so and reports nothing.
   *
   * The question is asked again a few times if no answer comes: a relay may deliver messages out of order,
   * and the session then discards the older one.
   *
   * @throws WalletSilentError if the wallet does not answer; RequestRefusedError if it could not read the chain
   */
  positions(templateIdentifier: string, attempts = 4, intervalMs = 7_000): Promise<{ trusted: boolean; positions: ReportedPosition[] }> {
    const { channel } = this;
    if (channel === undefined) return Promise.reject(new Error('No wallet is connected.'));
    const id = newId();
    return new Promise((resolve, reject) => {
      let asked = 0;
      const finish = (): void => {
        clearInterval(timer);
        this.listing.delete(id);
      };
      const ask = (): void => {
        if (asked >= attempts) {
          finish();
          reject(new WalletSilentError());
          return;
        }
        asked += 1;
        // Each asking carries the current time; the wallet answers every one, and the first answer is taken.
        (this.channel ?? channel).send({ action: POSITIONS_REQUEST, time: this.now(), id, template: templateIdentifier }).catch(() => undefined);
      };
      const timer = setInterval(ask, intervalMs);
      this.listing.set(id, (answer) => {
        finish();
        if (answer.error !== undefined) reject(new RequestRefusedError(`Your wallet could not read what it holds: ${answer.error}`));
        else resolve({ trusted: answer.trusted, positions: answer.positions });
      });
      ask();
    });
  }

  private receive(message: unknown): void {
    const { action, id } = (message ?? {}) as { action?: unknown; id?: unknown };
    if (typeof id !== 'string') return;
    if (action === POSITIONS) {
      const { trusted, positions, error } = message as { trusted?: unknown; positions?: unknown; error?: unknown };
      this.listing.get(id)?.({ trusted: trusted === true, positions: Array.isArray(positions) ? (positions as ReportedPosition[]) : [], ...(typeof error === 'string' && error !== '' ? { error } : {}) });
      return;
    }
    const open = this.pending.get(id);
    if (open === undefined) return;
    if (action === ACTION_RESPONSE) {
      const { accepted, reason, templateNeeded } = message as { accepted?: unknown; reason?: unknown; templateNeeded?: unknown };
      if (accepted === true) {
        open.onStage('accepted');
      } else if (templateNeeded === true && open.texts !== undefined && open.request.definition === undefined) {
        // The wallet does not have the template: the same request goes out again, whole.
        open.request = { ...open.request, definition: open.texts };
        const channel = this.channel;
        if (channel !== undefined) void channel.send({ ...open.request, time: this.now(), sequence: channel.nextSequence() }).catch(() => undefined);
      } else {
        this.pending.delete(id);
        open.reject(new RequestRefusedError(typeof reason === 'string' ? reason : 'The wallet refused the request.'));
      }
    } else if (action === INVITATION_UPDATE) {
      const { stage } = message as { stage?: unknown };
      if (stage === 'approved' || stage === 'recorded') open.onStage(stage);
      if (stage === 'sent') open.onStage('on-network');
    } else if (action === ACTION_RESULT) {
      const { ok, result, error } = message as ActionResult;
      this.pending.delete(id);
      if (ok) open.resolve(result ?? {});
      else open.reject(new RequestRefusedError(typeof error === 'string' ? error : 'The wallet could not carry out the request.'));
    }
  }
}
