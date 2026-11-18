import { binToHex, hexToBin } from '@bitauth/libauth';

/**
 * A wallet and a recoverer's page, connected for a moment to hand something sealed from one to the other.
 *
 * Setting up recovery passes two things between two screens: the recoverer's particulars (its name, its page,
 * its encryption key) to the wallet, and then a recovery kit, sealed to that key, back to the recoverer. Both
 * can travel as links. When both pages are open at the same time they can also travel over a WizardConnect
 * session that the recoverer's page offers: its QR code carries its link together with the session's address,
 * so the wallet has the particulars at once and knows where to send the kit.
 *
 * The session adds transport and nothing else. What goes over it is what the links carry: the particulars,
 * which are not secret, and messages sealed to the recoverer's key, which only that key opens. The recoverer
 * takes a sealed message from the session through the same checks as one from a link. Nothing the session
 * says about the other side is proof of who it is: the wallet still shows the recoverer's fingerprint.
 *
 * The messages are custom actions of the session, under an extension of their own, `gw_recoverer_v1`. They
 * are not part of `xo_v1`, the extension between a wallet and an application, and neither side takes the
 * other's messages.
 */

export const RECOVERER_EXTENSION = 'gw_recoverer_v1';
export const RECOVERER_EXTENSION_VERSION = 1;

/** Recoverer's page → wallet: who it is, as its link says. Sent when a wallet connects. */
export const PARTICULARS = 'gw_recoverer_particulars';
/** Wallet → recoverer's page: something sealed to the recoverer's key, and what it is. */
export const SEALED = 'gw_recoverer_sealed';
/** Recoverer's page → wallet: what became of it. */
export const SEALED_ANSWER = 'gw_recoverer_sealed_answer';

/**
 * What a sealed message is, as the link that would carry it names it: a recovery kit for a wallet (`enroll`,
 * for a first recoverer and for a replacement alike) or a new phone's takeover request (`takeover`).
 */
export type HandOffKind = 'enroll' | 'takeover';
const KINDS: readonly HandOffKind[] = ['enroll', 'takeover'];

/** The recoverer as its link describes it. Not secret. */
export interface Particulars {
  name: string;
  /** The address of the recoverer's page. */
  page: string;
  /** Its encryption key, 32 bytes as hex. */
  publicKey: string;
}

export interface ParticularsMessage extends Particulars {
  action: typeof PARTICULARS;
  time: number;
}

export interface SealedMessage {
  action: typeof SEALED;
  time: number;
  /** Chosen by the wallet. The same identifier is the same message, however often it arrives. */
  id: string;
  kind: HandOffKind;
  /** The sealed bytes, as hex: exactly what the link of this kind carries. */
  sealed: string;
}

/**
 * `received`: the page has it and could open it with its key; the recoverer has not yet decided.
 * `kept`: it passed the page's checks and is kept (for a kit, the receipt is on the stores).
 * `refused`: with the reason.
 */
export type SealedStatus = 'received' | 'kept' | 'refused';

export interface SealedAnswer {
  action: typeof SEALED_ANSWER;
  time: number;
  id: string;
  status: SealedStatus;
  reason?: string;
}

export type RecovererMessage = ParticularsMessage | SealedMessage | SealedAnswer;

/** The largest sealed message taken: far above a kit, which names what it does not carry. */
const LARGEST_SEALED = 1_000_000;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown, longest: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= longest;

const readParticulars = (value: Record<string, unknown>): Particulars | undefined => {
  const { name, page, publicKey } = value;
  if (typeof name !== 'string' || name.length > 200 || !isText(page, 400) || typeof publicKey !== 'string' || !/^[0-9a-f]{64}$/.test(publicKey)) return undefined;
  try {
    if (!/^https?:$/.test(new URL(page).protocol)) return undefined;
  } catch {
    return undefined;
  }
  return { name, page, publicKey };
};

/**
 * A message of this extension, checked, or `undefined` for anything else: a message of another extension, or
 * one that is not in the form this version knows. Those are not answered.
 */
export const readRecovererMessage = (message: unknown): RecovererMessage | undefined => {
  if (!isObject(message) || typeof message['time'] !== 'number') return undefined;
  const { action, time } = message;
  if (action === PARTICULARS) {
    const particulars = readParticulars(message);
    return particulars === undefined ? undefined : { action, time, ...particulars };
  }
  if (action === SEALED) {
    const { id, kind, sealed } = message;
    if (!isText(id, 80) || !KINDS.includes(kind as HandOffKind) || !isText(sealed, 2 * LARGEST_SEALED) || sealed.length % 2 !== 0 || !/^[0-9a-f]+$/.test(sealed)) return undefined;
    return { action, time, id, kind: kind as HandOffKind, sealed };
  }
  if (action === SEALED_ANSWER) {
    const { id, status, reason } = message;
    if (!isText(id, 80) || !['received', 'kept', 'refused'].includes(status as string) || (reason !== undefined && !isText(reason, 600))) return undefined;
    return { action, time, id, status: status as SealedStatus, ...(reason === undefined ? {} : { reason }) };
  }
  return undefined;
};

/** What the extension's announcement says, under `gw_recoverer_v1` in a session's extensions. */
export const recovererAnnouncement = (): { version: number } => ({ version: RECOVERER_EXTENSION_VERSION });

/** Whether the other side of a session announced this extension in a version this software knows. */
export const speaksRecoverer = (extensions: unknown): boolean => {
  if (!isObject(extensions)) return false;
  const offered = extensions[RECOVERER_EXTENSION];
  return isObject(offered) && offered['version'] === RECOVERER_EXTENSION_VERSION;
};

/** Where this extension's messages go and come from: a WizardConnect session in the pages, a pair of queues in tests. */
export interface RecovererChannel {
  send(message: RecovererMessage): Promise<void>;
  /** Called for every message of this extension that arrives, already checked. Returns a function that stops the calls. */
  onMessage(handler: (message: RecovererMessage) => void): () => void;
}

const now = (): number => Math.floor(Date.now() / 1000);
const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

// ── The recoverer's page ────────────────────────────────────────────────────

/** A sealed message as the recoverer's page receives it. */
export interface ReceivedSealed {
  id: string;
  kind: HandOffKind;
  sealed: Uint8Array;
}

/**
 * The recoverer's side: it says who it is when a wallet connects, hands every sealed message it receives to
 * the page once, and answers. What the page does with a message is the page's own: it opens and checks it as it
 * would if it came from a link.
 */
export class SealedDesk {
  private readonly answers = new Map<string, SealedAnswer>();
  private readonly seen = new Set<string>();
  private channel: RecovererChannel | undefined;

  constructor(
    private readonly options: {
      particulars: () => Particulars;
      /** A sealed message, the first time its identifier arrives. */
      onSealed: (received: ReceivedSealed) => void;
    },
  ) {}

  /** Serve a connection: say who this recoverer is, and listen. */
  attach(channel: RecovererChannel): () => void {
    this.channel = channel;
    const stop = channel.onMessage((message) => void this.receive(message));
    void this.introduce();
    return () => {
      stop();
      if (this.channel === channel) this.channel = undefined;
    };
  }

  /** Say again who this recoverer is, for a wallet that connected again. */
  async introduce(): Promise<void> {
    await this.channel?.send({ action: PARTICULARS, time: now(), ...this.options.particulars() }).catch(() => undefined);
  }

  private async receive(message: RecovererMessage): Promise<void> {
    if (message.action !== SEALED) return;
    // A repeat gets the answer it had; the page sees each message once.
    if (this.seen.has(message.id)) {
      const known = this.answers.get(message.id);
      if (known !== undefined) await this.channel?.send({ ...known, time: now() }).catch(() => undefined);
      return;
    }
    this.seen.add(message.id);
    this.options.onSealed({ id: message.id, kind: message.kind, sealed: hexToBin(message.sealed) });
  }

  /** Tell the wallet what became of a message. The last answer is repeated to a wallet that asks again. */
  async answer(id: string, status: SealedStatus, reason?: string): Promise<void> {
    const answer: SealedAnswer = { action: SEALED_ANSWER, time: now(), id, status, ...(reason === undefined ? {} : { reason: reason.slice(0, 600) }) };
    this.answers.set(id, answer);
    await this.channel?.send(answer).catch(() => undefined);
  }
}

// ── The wallet ──────────────────────────────────────────────────────────────

/** The recoverer's page refused what was sent, with its reason. */
export class SealedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealedRefusedError';
  }
}

/** The recoverer's page did not answer in time: it may have been closed. The link is the way then. */
export class RecovererSilentError extends Error {
  constructor() {
    super('The recoverer\'s page did not answer.');
    this.name = 'RecovererSilentError';
  }
}

/** The page answered in the name of another recoverer than the link names. Nothing is sent to it. */
export class OtherRecovererError extends Error {
  constructor() {
    super('The page at the other end of the connection is not the recoverer the link names.');
    this.name = 'OtherRecovererError';
  }
}

/** The same recoverer: the same key at the same page. The name is the recoverer's to change while the code is shown. */
const sameRecoverer = (a: Particulars, b: Particulars): boolean => a.publicKey === b.publicKey && a.page === b.page;

/**
 * The wallet's side: it learns who is at the other end, sends a sealed message, and follows the answers. A
 * message is sent again every few seconds until the page answers, since a relay may lose one.
 */
export class SealedCourier {
  private introduced: Particulars | undefined;
  private readonly waiting = new Set<(particulars: Particulars) => void>();
  private readonly listeners = new Set<(answer: SealedAnswer) => void>();
  private readonly stop: () => void;

  constructor(private readonly channel: RecovererChannel) {
    this.stop = channel.onMessage((message) => {
      if (message.action === PARTICULARS) {
        const { action: _action, time: _time, ...particulars } = message;
        this.introduced = particulars;
        for (const resolve of [...this.waiting]) resolve(particulars);
        this.waiting.clear();
      } else if (message.action === SEALED_ANSWER) {
        for (const listener of [...this.listeners]) listener(message);
      }
    });
  }

  /**
   * Who the page at the other end says it is.
   * @throws RecovererSilentError if it does not say within the time
   */
  particulars(timeoutMs: number): Promise<Particulars> {
    if (this.introduced !== undefined) return Promise.resolve(this.introduced);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(done);
        reject(new RecovererSilentError());
      }, timeoutMs);
      const done = (particulars: Particulars): void => {
        clearTimeout(timer);
        resolve(particulars);
      };
      this.waiting.add(done);
    });
  }

  /** Every answer from now on, for any message. Returns a function that stops the calls. */
  onAnswer(listener: (answer: SealedAnswer) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /**
   * Send a sealed message to the recoverer the link names, and wait for the page to say that it has it.
   * @param expected - the particulars the link gave; the page must say the same
   * @returns the first answer: `received` or `kept`
   * @throws OtherRecovererError, SealedRefusedError, RecovererSilentError
   */
  async send(options: { expected: Particulars; kind: HandOffKind; sealed: Uint8Array; id?: string; timeoutMs: number; resendMs?: number }): Promise<SealedAnswer> {
    const until = Date.now() + options.timeoutMs;
    const said = await this.particulars(options.timeoutMs);
    if (!sameRecoverer(said, options.expected)) throw new OtherRecovererError();
    const id = options.id ?? binToHex(crypto.getRandomValues(new Uint8Array(12)));
    const message: SealedMessage = { action: SEALED, time: now(), id, kind: options.kind, sealed: binToHex(options.sealed) };
    let answered: SealedAnswer | undefined;
    const stop = this.onAnswer((answer) => {
      if (answer.id === id) answered ??= answer;
    });
    try {
      while (answered === undefined && Date.now() < until) {
        await this.channel.send({ ...message, time: now() }).catch(() => undefined);
        const next = Math.min(until, Date.now() + (options.resendMs ?? 4_000));
        while (answered === undefined && Date.now() < next) await wait(50);
      }
    } finally {
      stop();
    }
    if (answered === undefined) throw new RecovererSilentError();
    if (answered.status === 'refused') throw new SealedRefusedError(answered.reason ?? 'The recoverer\'s page refused it.');
    return answered;
  }

  close(): void {
    this.stop();
  }
}
