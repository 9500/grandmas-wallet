import {
  type ActionDetails,
  type ActionRequest,
  type ActionResult,
  type Channel,
  type ReportedPosition,
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

interface Pending {
  request: ActionRequest;
  onStage: (stage: RequestStage) => void;
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

const newId = (): string => Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('');

export class DappRequests {
  private readonly pending = new Map<string, Pending>();
  private readonly listing = new Map<string, (positions: ReportedPosition[]) => void>();
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
   * Ask the wallet to carry out an action of the application's template.
   * @param id - to continue a request made before, for example after the page was loaded again
   * @throws RequestRefusedError
   */
  request(details: ActionDetails, onStage: (stage: RequestStage) => void = () => undefined, id: string = newId()): Promise<Record<string, unknown>> {
    const { channel } = this;
    if (channel === undefined) return Promise.reject(new Error('No wallet is connected.'));
    const request: ActionRequest = { action: ACTION_REQUEST, time: this.now(), sequence: channel.nextSequence(), id, ...details };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { request, onStage, resolve, reject });
      onStage('sent');
      // If it is not delivered now, it goes out again when a channel is attached.
      channel.send(request).catch(() => undefined);
    });
  }

  /**
   * Ask which positions of a template the wallet holds. A wallet that does not trust the template says none.
   * @throws if the wallet does not answer in time
   */
  positions(templateIdentifier: string, timeoutMs = 20_000): Promise<ReportedPosition[]> {
    const { channel } = this;
    if (channel === undefined) return Promise.reject(new Error('No wallet is connected.'));
    const id = newId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listing.delete(id);
        reject(new Error('The wallet did not answer.'));
      }, timeoutMs);
      this.listing.set(id, (positions) => {
        clearTimeout(timer);
        this.listing.delete(id);
        resolve(positions);
      });
      channel.send({ action: POSITIONS_REQUEST, time: this.now(), id, template: templateIdentifier }).catch(() => undefined);
    });
  }

  private receive(message: unknown): void {
    const { action, id } = (message ?? {}) as { action?: unknown; id?: unknown };
    if (typeof id !== 'string') return;
    if (action === POSITIONS) {
      const { positions } = message as { positions?: unknown };
      this.listing.get(id)?.(Array.isArray(positions) ? (positions as ReportedPosition[]) : []);
      return;
    }
    const open = this.pending.get(id);
    if (open === undefined) return;
    if (action === ACTION_RESPONSE) {
      const { accepted, reason } = message as { accepted?: unknown; reason?: unknown };
      if (accepted === true) {
        open.onStage('accepted');
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
